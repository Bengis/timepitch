"""Crónica IA en vivo (TP253): al acabar un partido simulado, la web pide su crónica al crew en Azure.

El servidor público construye el FactPack del partido del dueño (GRF físico o TouchLines), comprueba el sobre fijo de
gasto y encola la petición con la SAS de solo añadir; después consulta el blob del informe con la SAS de solo lectura y
lo revalida entero con ``cloud.fetch`` antes de servirlo. Sin SDK de Azure: dos llamadas REST con la SAS (que nunca se
imprime). Topes: los del sobre (dinero, informes, caducidad; el job solo acepta ese sobre) y, aquí, una petición en
curso por dueño, unas pocas al día por dueño y por IP (TP257: borrar la cookie no da más) y nunca más informes que
``max_reports``. La IP no se guarda: solo un HMAC con una sal aleatoria propia del fichero de estado.
"""
from __future__ import annotations

from dataclasses import dataclass
import gzip
import hmac
import json
import os
from pathlib import Path
import secrets
import threading
import time
import urllib.error
import urllib.request
from xml.sax.saxutils import escape

from ..chronicles.models import fact_pack_hash
from ..fictional import fictional_pack
from .cloud import ACCOUNT, QUEUE, REPORTS, FetchRejected, build_request, fetch
from .ledger import MAX_ENVELOPE_BYTES, EnvelopeRefused, _private_file, parse_grant
from .models import CrewReport, default_binding, request_hash

ENGINES = ('grf', 'touchlines')
PENDING_TIMEOUT_S = 15 * 60
OWNER_DAILY = 6
CLIENT_DAILY = 5  # por IP (TP261): una red no agota el sobre compartido; los jueces siguen cabiendo


def _match(record: dict) -> tuple:
    return record.get('engine'), record.get('match_id')


def _matches_today(records, now: float, current: tuple) -> int:
    """Distinct matches with a report asked in the last 24 h; a match already counted does not count again."""
    seen = {_match(r) for r in records if now - r['at'] < 86400}
    return 0 if current in seen else len(seen)


class LiveCrewUnavailable(RuntimeError):
    pass


class LiveCrewBusy(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class LiveCrewSettings:
    mode: str = 'off'
    envelope: Path | None = None
    queue_sas: Path | None = None
    reports_sas: Path | None = None
    account: str = ACCOUNT

    @classmethod
    def from_env(cls) -> 'LiveCrewSettings':
        path = lambda name: Path(os.environ[name]) if os.environ.get(name) else None  # noqa: E731
        return cls(mode=os.getenv('TIMEPITCH_LIVE_CREW_MODE', 'off'), envelope=path('TIMEPITCH_LIVE_CREW_ENVELOPE'),
                   queue_sas=path('TIMEPITCH_LIVE_CREW_QUEUE_SAS'), reports_sas=path('TIMEPITCH_LIVE_CREW_REPORTS_SAS'),
                   account=os.getenv('TIMEPITCH_LIVE_CREW_ACCOUNT', ACCOUNT))

    @property
    def enabled(self) -> bool:
        return self.mode == 'on' and all(p is not None and p.is_file() for p in (self.envelope, self.queue_sas, self.reports_sas))


def _sas(path: Path) -> str:
    from .agents import read_credential
    return read_credential(path).lstrip('?')


class RestQueue:
    def __init__(self, account: str, sas: str):
        self.url = f'https://{account}.queue.core.windows.net/{QUEUE}/messages?{sas}'

    def send(self, body: bytes) -> None:
        # Same text the SDK sends (no base64 policy): the job reads it back unchanged.
        xml = f'<QueueMessage><MessageText>{escape(body.decode("ascii"))}</MessageText></QueueMessage>'.encode()
        request = urllib.request.Request(self.url, data=xml, method='POST', headers={'Content-Type': 'application/xml'})
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 201:
                raise LiveCrewUnavailable('queue_send_failed')


class RestBlobs:
    def __init__(self, account: str, sas: str):
        self.base, self.sas = f'https://{account}.blob.core.windows.net/{REPORTS}/', sas

    def get(self, name: str) -> bytes | None:
        try:
            with urllib.request.urlopen(f'{self.base}{name}?{self.sas}', timeout=20) as response:
                return response.read(512 * 1024 + 1)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise


def report_view(report: CrewReport) -> dict:
    """Lo que la web muestra (forma de ``CrewReportView``), sin nada que no esté en el informe sellado."""
    draft = report.draft
    if draft is not None:
        headline, paragraphs = draft.headline.text, [[s.text for s in p.sentences] for p in draft.paragraphs]
    else:
        # El texto de reserva llega como bloques separados por una línea en blanco: el primero, el marcador, es el
        # titular y cada uno de los demás, un párrafo.
        blocks = [b.strip() for b in (report.fallback_text or '').split('\n\n') if b.strip()]
        headline, paragraphs = (blocks[0] if blocks else None), [[b] for b in blocks[1:]]
    models = sorted({s.model for s in report.steps if s.model})
    return {'trace_hash': report.source.trace_hash, 'locale': report.locale, 'engine': report.source.engine,
            'headline': headline, 'paragraphs': paragraphs, 'coverage_notes': list(report.coverage_notes),
            'model': ', '.join(models) or None, 'total_cost': str(report.total_cost),
            'report_sha256': report.report_sha256, 'provenance': report.provenance, 'evaluation': None}


class LiveCrew:
    def __init__(self, source, settings: LiveCrewSettings, state_dir: Path, *, queue=None, blobs=None, now=time.time,
                 translator=None):
        self.source, self.settings, self.now = source, settings, now
        self.translator = translator  # TP265: the server-side agent service (AskService) that translates checked text
        self.binding = default_binding()
        self.dir = Path(state_dir)
        self._queue, self._blobs = queue, blobs
        self._lock = threading.Lock()

    # -- infraestructura --
    def available(self) -> bool:
        return self.settings.enabled or (self._queue is not None and self.settings.envelope is not None)

    def _envelope(self) -> bytes:
        return _private_file(self.settings.envelope, MAX_ENVELOPE_BYTES)

    def _grant(self):
        return parse_grant(self._envelope(), self.binding, now=self.now)[0]

    def queue(self):
        return self._queue or RestQueue(self.settings.account, _sas(self.settings.queue_sas))

    def blobs(self):
        return self._blobs or RestBlobs(self.settings.account, _sas(self.settings.reports_sas))

    def _state_path(self) -> Path:
        return self.dir / 'requests.json'

    def _load(self) -> dict:
        path = self._state_path()
        return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {'version': 1, 'requests': {}}

    def _save(self, state: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self._state_path().with_suffix('.tmp')
        tmp.write_text(json.dumps(state, sort_keys=True), encoding='utf-8')
        os.replace(tmp, self._state_path())

    def remaining(self) -> int | None:
        if not self.available():
            return None
        try:
            grant = self._grant()
        except EnvelopeRefused:
            return 0
        return max(0, grant.max_reports - len(self._load()['requests']))

    # -- API --
    def _pack(self, engine: str, match_id: str, owner: str, names: str = 'real', period: str = 'full_time'):
        if engine not in ENGINES:
            raise KeyError(engine)
        # TP262: the half-time report reads the first half only; the full-time call stays as before.
        pack = self.source(engine, match_id, owner, period) if period != 'full_time' else self.source(engine, match_id, owner)
        # TP259: in the fictional league the report must name what the viewer sees; the swap happens before the
        # request hash, so each naming mode is its own report.
        return fictional_pack(pack) if names == 'fictional' else pack

    @staticmethod
    def _client_key(state: dict, client: str | None) -> str | None:
        if not client:
            return None
        salt = state.setdefault('salt', secrets.token_hex(16))
        return hmac.new(bytes.fromhex(salt), client.encode(), 'sha256').hexdigest()[:32]

    def request(self, engine: str, match_id: str, owner: str, locale: str, client: str | None = None,
                names: str = 'real', audience: str = 'fan', period: str = 'full_time') -> dict:
        if not self.available():
            raise LiveCrewUnavailable('disabled')
        from .translate import native_locale
        locale = native_locale(locale)  # TP265: the crew writes in English or Spanish; the rest is translated
        pack = self._pack(engine, match_id, owner, names, period)
        rh = request_hash(fact_pack_hash(pack), locale, self.binding, audience)
        with self._lock:
            state = self._load()
            known = state['requests'].get(rh)
            if known:
                return {'status': 'pending', 'request_hash': rh}
            now = self.now()
            match = (engine, match_id)
            mine = [r for r in state['requests'].values() if r['owner'] == owner]
            # TP262: the half-time and full-time reports (and each audience) of one match count as that match once.
            if any(not r.get('done') and now - r['at'] < PENDING_TIMEOUT_S and _match(r) != match for r in mine):
                raise LiveCrewBusy('one_in_flight')
            if _matches_today(mine, now, match) >= OWNER_DAILY:
                raise LiveCrewBusy('daily_limit')
            key = self._client_key(state, client)
            if key and _matches_today([r for r in state['requests'].values() if r.get('client') == key], now, match) >= CLIENT_DAILY:
                raise LiveCrewBusy('daily_limit')
            grant = self._grant()
            if len(state['requests']) >= grant.max_reports:
                raise LiveCrewBusy('budget_exhausted')
            body, rh = build_request(pack, locale, self._envelope(), self.binding, now=self.now, audience=audience)
            self.queue().send(body)
            state['requests'][rh] = {'owner': owner, 'client': key, 'at': now, 'engine': engine, 'match_id': match_id,
                                     'locale': locale, 'period': period}
            self._save(state)
        return {'status': 'pending', 'request_hash': rh}

    def status(self, engine: str, match_id: str, owner: str, locale: str, names: str = 'real', audience: str = 'fan',
               period: str = 'full_time') -> dict:
        from .translate import native_locale
        language, locale = locale, native_locale(locale)
        result = self._status(engine, match_id, owner, locale, names, audience, period)
        if language != locale and result.get('status') == 'ready':
            result['report'] = self._translated(result['report'], self._pack(engine, match_id, owner, names, period), language)
        return result

    def _translated(self, view: dict, pack, language: str) -> dict:
        """TP265: the checked report in another language; without the translator it stays in its checked language."""
        translator = self.translator
        if translator is None or not translator.available():
            return view
        from .checks import recorded_names
        sentences = ([view['headline']] if view.get('headline') else []) + [s for p in view['paragraphs'] for s in p]
        try:
            done = translator.translate(sentences, recorded_names(pack), language)
        except Exception:
            return view
        out = list(done['sentences'])
        headline = out.pop(0) if view.get('headline') else None
        paragraphs = []
        for p in view['paragraphs']:
            paragraphs.append(out[:len(p)])
            out = out[len(p):]
        return {**view, 'headline': headline, 'paragraphs': paragraphs, 'language': language,
                'translated': f"{done['translated']}/{done['total']}"}

    def _status(self, engine: str, match_id: str, owner: str, locale: str, names: str = 'real', audience: str = 'fan',
                period: str = 'full_time') -> dict:
        pack = self._pack(engine, match_id, owner, names, period)
        rh = request_hash(fact_pack_hash(pack), locale, self.binding, audience)
        cached = self.dir / 'reports' / f'{rh}.json.gz'
        if cached.is_file():
            return {'status': 'ready', 'request_hash': rh,
                    'report': report_view(CrewReport.model_validate_json(gzip.decompress(cached.read_bytes())))}
        known = self._load()['requests'].get(rh)
        if known is None:
            return {'status': 'none', 'request_hash': rh}
        if not self.available():
            raise LiveCrewUnavailable('disabled')
        try:
            result = fetch(pack=pack, locale=locale, reports=self.blobs(), out_dir=self.dir / 'reports', binding=self.binding,
                           audience=audience)
        except FetchRejected as error:
            return self._done(rh, {'status': 'failed', 'request_hash': rh, 'code': error.code})
        if result['status'] == 'fetched':
            self._done(rh, {})
            return self._status(engine, match_id, owner, locale, names, audience, period)
        if result['status'] == 'failed':
            return self._done(rh, {'status': 'failed', 'request_hash': rh, 'code': result['code']})
        if self.now() - known['at'] > PENDING_TIMEOUT_S:
            return self._done(rh, {'status': 'failed', 'request_hash': rh, 'code': 'timeout'})
        return {'status': 'pending', 'request_hash': rh}

    def _done(self, rh: str, result: dict) -> dict:
        with self._lock:
            state = self._load()
            if rh in state['requests']:
                state['requests'][rh]['done'] = True
                self._save(state)
        return result
