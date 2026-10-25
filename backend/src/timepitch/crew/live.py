"""Crónica IA en vivo (TP253): al acabar un partido simulado, la web pide su crónica al crew en Azure.

El servidor público construye el FactPack del partido del dueño (GRF físico o TouchLines), comprueba el sobre fijo de
gasto y encola la petición con la SAS de solo añadir; después consulta el blob del informe con la SAS de solo lectura y
lo revalida entero con ``cloud.fetch`` antes de servirlo. Sin SDK de Azure: dos llamadas REST con la SAS (que nunca se
imprime). Topes: los del sobre (dinero, informes, caducidad; el job solo acepta ese sobre) y, aquí, una petición en
curso por dueño, unas pocas al día por dueño y nunca más informes que ``max_reports``.
"""
from __future__ import annotations

from dataclasses import dataclass
import gzip
import json
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.request
from xml.sax.saxutils import escape

from ..chronicles.models import fact_pack_hash
from .cloud import ACCOUNT, QUEUE, REPORTS, FetchRejected, build_request, fetch
from .ledger import MAX_ENVELOPE_BYTES, EnvelopeRefused, _private_file, parse_grant
from .models import CrewReport, default_binding, request_hash

ENGINES = ('grf', 'touchlines')
PENDING_TIMEOUT_S = 15 * 60
OWNER_DAILY = 6


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
        headline, paragraphs = None, [[report.fallback_text or '']]
    models = sorted({s.model for s in report.steps if s.model})
    return {'trace_hash': report.source.trace_hash, 'locale': report.locale, 'engine': report.source.engine,
            'headline': headline, 'paragraphs': paragraphs, 'coverage_notes': list(report.coverage_notes),
            'model': ', '.join(models) or None, 'total_cost': str(report.total_cost),
            'report_sha256': report.report_sha256, 'provenance': report.provenance, 'evaluation': None}


class LiveCrew:
    def __init__(self, source, settings: LiveCrewSettings, state_dir: Path, *, queue=None, blobs=None, now=time.time):
        self.source, self.settings, self.now = source, settings, now
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
    def _pack(self, engine: str, match_id: str, owner: str):
        if engine not in ENGINES:
            raise KeyError(engine)
        return self.source(engine, match_id, owner)

    def request(self, engine: str, match_id: str, owner: str, locale: str) -> dict:
        if not self.available():
            raise LiveCrewUnavailable('disabled')
        pack = self._pack(engine, match_id, owner)
        rh = request_hash(fact_pack_hash(pack), locale, self.binding)
        with self._lock:
            state = self._load()
            known = state['requests'].get(rh)
            if known:
                return {'status': 'pending', 'request_hash': rh}
            now = self.now()
            mine = [r for r in state['requests'].values() if r['owner'] == owner]
            if any(not r.get('done') and now - r['at'] < PENDING_TIMEOUT_S for r in mine):
                raise LiveCrewBusy('one_in_flight')
            if sum(1 for r in mine if now - r['at'] < 86400) >= OWNER_DAILY:
                raise LiveCrewBusy('daily_limit')
            grant = self._grant()
            if len(state['requests']) >= grant.max_reports:
                raise LiveCrewBusy('budget_exhausted')
            body, rh = build_request(pack, locale, self._envelope(), self.binding, now=self.now)
            self.queue().send(body)
            state['requests'][rh] = {'owner': owner, 'at': now, 'engine': engine, 'match_id': match_id, 'locale': locale}
            self._save(state)
        return {'status': 'pending', 'request_hash': rh}

    def status(self, engine: str, match_id: str, owner: str, locale: str) -> dict:
        pack = self._pack(engine, match_id, owner)
        rh = request_hash(fact_pack_hash(pack), locale, self.binding)
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
            result = fetch(pack=pack, locale=locale, reports=self.blobs(), out_dir=self.dir / 'reports', binding=self.binding)
        except FetchRejected as error:
            return self._done(rh, {'status': 'failed', 'request_hash': rh, 'code': error.code})
        if result['status'] == 'fetched':
            self._done(rh, {})
            return self.status(engine, match_id, owner, locale)
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
