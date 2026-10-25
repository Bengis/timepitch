"""TouchLines en vivo (TP243): «Jugar partido» con el motor TouchLines en su reloj original.

Cada partido lanza Node con el bundle nativo de `engines/touchlines` (AGPL-3.0-or-later; ver su README) en un proceso
aparte, con tiempo y memoria acotados, y guarda la grabación y sus eventos (`recorded-events-1`) comprimidos por
dueño, como los partidos GRF. La entrada es la misma que GRF (`make_statistics_input`): el arnés la acepta tal cual.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import gzip
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
from collections import Counter

from ..grf.input import make_statistics_input
from ..grf.models import EngineCapability, GrfJob, GrfSummary
from ..matches.service import QueueFullError
from .events import touchlines as touchlines_events

ENGINE_VERSION = 'touchlines-5c5c71a-native'
BUNDLE = 'build/freeplay-native.mjs'
BUNDLE_SHA256 = 'b01720c941359da2db4b17680e91060ac4dc021b7fa2d8d5f8e8e2efe0efc46d'
CALIBRATION = 'cal-native.json'
#: Un partido nativo son ~3 300 muestras; 4 500 deja margen al descuento sin permitir partidos sin fin.
TICKS = 4500
TIMEOUT_S = 120
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
EVENTS_SCHEMA = 'recorded-events-1'


class TouchLinesError(RuntimeError): code = 'native_failed'
class TouchLinesUnavailable(TouchLinesError): code = 'native_unavailable'


class TouchLinesRepository:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('''CREATE TABLE IF NOT EXISTS touchlines_matches (
                id TEXT PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL,config TEXT NOT NULL,
                summary TEXT,record BLOB,events BLOB,error TEXT,created_ns INTEGER NOT NULL)''')
            conn.execute('CREATE INDEX IF NOT EXISTS touchlines_owner_recent ON touchlines_matches(owner,created_ns DESC)')
            conn.execute("UPDATE touchlines_matches SET state='failed',error='interrupted' WHERE state IN ('queued','running')")

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=10); conn.row_factory = sqlite3.Row
        try:
            with conn: yield conn
        finally: conn.close()

    @staticmethod
    def _job(row):
        return GrfJob(id=row['id'], state=row['state'], config=json.loads(row['config']), error=row['error'],
                      summary=json.loads(row['summary']) if row['summary'] else None)

    def create(self, config, owner):
        id = 'tl-' + secrets.token_urlsafe(18)
        with self.connection() as conn:
            conn.execute('INSERT INTO touchlines_matches(id,owner,state,config,created_ns) VALUES(?,?,?,?,?)',
                         (id, owner, 'queued', config.model_dump_json(), time.time_ns()))
        return GrfJob(id=id, state='queued', config=config)

    def get_job(self, id, owner):
        with self.connection() as conn:
            row = conn.execute('SELECT id,state,config,summary,error FROM touchlines_matches WHERE id=? AND owner=?', (id, owner)).fetchone()
        if row is None: raise KeyError(id)
        return self._job(row)

    def start(self, id, owner):
        with self.connection() as conn:
            return conn.execute("UPDATE touchlines_matches SET state='running' WHERE id=? AND owner=? AND state='queued'", (id, owner)).rowcount == 1

    def finish(self, id, owner, summary: GrfSummary, record_gz: bytes, events_gz: bytes):
        with self.connection() as conn:
            conn.execute("UPDATE touchlines_matches SET state='ready',summary=?,record=?,events=?,error=NULL WHERE id=? AND owner=? AND state='running'",
                         (summary.model_dump_json(), record_gz, events_gz, id, owner))
            # Como GRF: los 30 últimos partidos terminados de cada dueño.
            conn.execute('''DELETE FROM touchlines_matches WHERE owner=? AND state IN ('ready','failed') AND id NOT IN
                (SELECT id FROM touchlines_matches WHERE owner=? AND state IN ('ready','failed') ORDER BY created_ns DESC LIMIT 30)''', (owner, owner))

    def fail(self, id, owner, code):
        with self.connection() as conn:
            conn.execute("UPDATE touchlines_matches SET state='failed',error=? WHERE id=? AND owner=? AND state IN ('queued','running')", (code, id, owner))

    def blob(self, id, owner, column):
        assert column in ('record', 'events')
        with self.connection() as conn:
            row = conn.execute(f"SELECT {column} FROM touchlines_matches WHERE id=? AND owner=? AND state='ready'", (id, owner)).fetchone()
        if row is None or row[column] is None: raise KeyError(id)
        return bytes(row[column])


class TouchLinesService:
    def __init__(self, catalog, repository: TouchLinesRepository, engine_dir: Path, node: str | None):
        self.catalog = catalog; self.repository = repository
        self.engine_dir = engine_dir.resolve(); self.node = node
        self._slots = threading.BoundedSemaphore(5); self._lock = threading.Lock(); self._closed = threading.Event()
        self._worker = ThreadPoolExecutor(max_workers=2, thread_name_prefix='timepitch-touchlines')

    def capability(self) -> EngineCapability:
        reason = None
        if not self.node or not Path(self.node).is_file(): reason = 'missing_runtime'
        else:
            bundle = self.engine_dir / BUNDLE
            if not bundle.is_file() or not (self.engine_dir / CALIBRATION).is_file(): reason = 'missing_assets'
            elif hashlib.sha256(bundle.read_bytes()).hexdigest() != BUNDLE_SHA256: reason = 'unsupported_native_binary'
        return EngineCapability(id='touchlines', available=reason is None, reason=reason)

    def create_match(self, config, owner):
        request = make_statistics_input(config, self.catalog)
        if self._closed.is_set() or not self.capability().available: raise TouchLinesUnavailable()
        if not self._slots.acquire(blocking=False): raise QueueFullError()
        try:
            job = self.repository.create(config, owner)
            future = self._worker.submit(self._run, job, owner, request)
        except Exception:
            self._slots.release(); raise
        future.add_done_callback(lambda _f: self._slots.release())
        return job

    def _run(self, job, owner, request):
        try:
            if self._closed.is_set() or not self.repository.start(job.id, owner): return
            raw = self._simulate(request)
            record = json.loads(raw)
            if record.get('engine_version') != ENGINE_VERSION or record.get('touchlines', {}).get('stop_reason') != 'match_end':
                raise TouchLinesError()
            events = touchlines_events(record)
            body = json.dumps(self._events_document(record, events), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            last = record['samples'][-1]
            summary = GrfSummary(home_name=request.home_name, away_name=request.away_name, score=tuple(last['score']),
                                 duration_ms=(len(record['samples']) - 1) * 100, trace_hash=record['trace_hash'])
            self.repository.finish(job.id, owner, summary, gzip.compress(raw, 6), gzip.compress(body, 6))
        except TouchLinesError as error: self.repository.fail(job.id, owner, error.code)
        except Exception: self.repository.fail(job.id, owner, 'native_failed')

    def _simulate(self, request) -> bytes:
        with tempfile.TemporaryDirectory(prefix='timepitch-touchlines-') as tmp:
            source, out = Path(tmp) / 'input.json', Path(tmp) / 'match.json'
            source.write_text(request.model_dump_json(), encoding='utf-8')
            command = [self.node, '--max-old-space-size=1024', str(self.engine_dir / BUNDLE), '--seed', str(request.config.seed),
                       '--ticks', str(TICKS), '--cal-file', str(self.engine_dir / CALIBRATION), '--lineup', str(source), '--out', str(out)]
            env = {k: v for k, v in os.environ.items() if not k.startswith('NODE_')}
            try:
                done = subprocess.run(command, cwd=tmp, env=env, capture_output=True, timeout=TIMEOUT_S, shell=False,
                                      creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            except subprocess.TimeoutExpired: raise TouchLinesError() from None
            if done.returncode != 0 or not out.is_file() or out.stat().st_size > MAX_OUTPUT_BYTES: raise TouchLinesError()
            return out.read_bytes()

    @staticmethod
    def _events_document(record, builder):
        events = sorted(builder.events, key=lambda e: (e['t_ms'], e['sample_index']))
        return {
            'schema': EVENTS_SCHEMA, 'engine': 'touchlines', 'engine_version': record['engine_version'],
            'recording': {'id': f"live:{record['trace_hash'][:16]}", 'file': None, 'sha256': None, 'trace_hash': record['trace_hash'],
                          'seed': record['input']['config']['seed']},
            'synthetic': True,
            'notice': 'SIMULATED: events recorded by the engine during this synthetic match; not a real match, not historical data.',
            'time_basis': 't_ms = elapsed ms of the recording (sample i at i*100 ms); match_ms = samples[sample_index].match_time_ms',
            'xy_basis': "actor's recorded position in samples[sample_index] (ball if no actor)", 'sources': [],
            'counts': dict(sorted(Counter(e['kind'] for e in events).items())), 'not_exported': dict(sorted(builder.skipped.items())),
            'events': events,
        }

    def close(self):
        self._closed.set(); self._worker.shutdown(wait=False, cancel_futures=True)


def default_node() -> str | None:
    return os.environ.get('TIMEPITCH_NODE') or shutil.which('node')
