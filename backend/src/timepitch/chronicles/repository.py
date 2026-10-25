"""Transactional queue: exactly one fenced lease, immutable accepted output."""
from contextlib import contextmanager
from hashlib import sha256
import hmac
import json
import math
from pathlib import Path
import secrets
import sqlite3
import time
from .models import (ChronicleRequest, ChronicleView, FactPack, ClaimedJob, LeaseRef, WorkerIdentity,
                     WorkerResult, WorkerStatus, PROFILE, PROMPT_VERSION, MODEL, canonical_bytes, fact_pack_hash)
from .usage import legacy_usage


class ChronicleConflict(ValueError): pass
class ChronicleQueueFull(ValueError): pass


class ChronicleRepository:
    def __init__(self, path: Path, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS chronicle_jobs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, engine TEXT NOT NULL, match_id TEXT NOT NULL,
                    revision TEXT NOT NULL, locale TEXT NOT NULL, cache_key TEXT NOT NULL UNIQUE,
                    fact_hash TEXT NOT NULL, pack_json TEXT NOT NULL, state TEXT NOT NULL,
                    created REAL NOT NULL, queue_deadline REAL NOT NULL, job_deadline REAL,
                    lease_deadline REAL, generation INTEGER NOT NULL DEFAULT 0, worker_id TEXT,
                    lease_hash TEXT, result_hash TEXT, text TEXT NOT NULL DEFAULT '',
                    refs TEXT NOT NULL DEFAULT '[]', error TEXT,
                    profile TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS chronicle_owner ON chronicle_jobs(owner,id);
                CREATE TABLE IF NOT EXISTS chronicle_usage (
                    job_id TEXT PRIMARY KEY, owner TEXT NOT NULL, engine TEXT NOT NULL,
                    match_id TEXT NOT NULL, revision TEXT NOT NULL, locale TEXT NOT NULL,
                    reserved INTEGER NOT NULL, actual INTEGER);
                CREATE TABLE IF NOT EXISTS chronicle_worker (
                    worker_id TEXT PRIMARY KEY, seen REAL NOT NULL, ready INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS chronicle_clock (id INTEGER PRIMARY KEY CHECK(id=1), high_water REAL NOT NULL);
                INSERT OR IGNORE INTO chronicle_clock VALUES(1,0);
            ''')

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn: yield conn
        finally: conn.close()

    @contextmanager
    def _transaction(self):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            now = self.clock()
            high = conn.execute('SELECT high_water FROM chronicle_clock WHERE id=1').fetchone()[0]
            if not isinstance(now, (float,int)) or isinstance(now,bool) or not math.isfinite(now) or now < high:
                conn.execute("UPDATE chronicle_jobs SET state='unavailable',error='clock_regressed' WHERE state IN ('queued','running')")
                conn.commit()  # Preserve failure, even though the requesting operation is refused.
                raise ChronicleConflict('Clock cannot extend a job')
            conn.execute('UPDATE chronicle_clock SET high_water=? WHERE id=1', (now,))
            conn.execute("UPDATE chronicle_jobs SET state='unavailable',error='queue_expired' WHERE state='queued' AND queue_deadline<=?",(now,))
            conn.execute("UPDATE chronicle_jobs SET state='unavailable',error='job_timeout' WHERE state='running' AND job_deadline<=?",(now,))
            conn.execute("UPDATE chronicle_jobs SET state='unavailable',error='lease_expired' WHERE state='running' AND lease_deadline<=?",(now,))
            # Persist expiry/high-water even when an operation is rejected, but
            # roll back that operation's own partial changes.
            conn.execute('SAVEPOINT operation')
            try:
                yield conn, float(now)
            except Exception:
                conn.execute('ROLLBACK TO operation')
                conn.execute('RELEASE operation')
                conn.commit()
                raise
            else:
                conn.execute('RELEASE operation')

    def expire(self):
        with self._transaction(): pass

    @staticmethod
    def _pack(row):
        try:
            pack = FactPack.model_validate_json(row['pack_json'])
            if fact_pack_hash(pack) != row['fact_hash']: raise ValueError('Changed pack')
            return pack
        except ValueError as exc: raise ChronicleConflict('Invalid stored facts') from exc

    @staticmethod
    def _view(conn, row):
        usage = conn.execute('SELECT reserved,actual FROM chronicle_usage WHERE job_id=?',(row['id'],)).fetchone()
        state = row['state']
        return ChronicleView(id=row['id'], engine=row['engine'], match_id=row['match_id'], trace_hash=row['revision'],
            locale=row['locale'], fact_hash=row['fact_hash'], state=state, text=row['text'], event_refs=json.loads(row['refs']),
            calls_reserved=usage['reserved'] if usage else 0, actual_calls=usage['actual'] if usage else None,
            profile=row['profile'], prompt_version=row['prompt'], model_id=row['model'], error=row['error'],
            provenance='validated_worker_ai' if state=='ready' else 'deterministic_fallback' if state in ('unavailable','rejected') else 'pending')

    def _key(self, owner, request, pack):
        return sha256(json.dumps([owner,request.model_dump(),fact_pack_hash(pack),PROFILE,PROMPT_VERSION,MODEL],sort_keys=True).encode()).hexdigest()

    def submit(self, owner: str, request: ChronicleRequest, pack: FactPack) -> ChronicleView:
        # Revalidate caller-owned instances as well as HTTP data before freezing bytes.
        request = ChronicleRequest.model_validate_json(request.model_dump_json())
        pack = FactPack.model_validate_json(pack.model_dump_json())
        if pack.engine != request.engine or pack.trace_hash != request.trace_hash: raise ChronicleConflict('Source identity mismatch')
        key = self._key(owner,request,pack)
        with self._transaction() as (conn,now):
            row = conn.execute('SELECT * FROM chronicle_jobs WHERE cache_key=?',(key,)).fetchone()
            if row: return self._view(conn,row)
            if conn.execute("SELECT COUNT(*) FROM chronicle_jobs WHERE state='queued'").fetchone()[0] >= 4:
                raise ChronicleQueueFull('Chronicle queue is full')
            id = secrets.token_urlsafe(18)
            conn.execute('''INSERT INTO chronicle_jobs
                (id,owner,engine,match_id,revision,locale,cache_key,fact_hash,pack_json,state,created,queue_deadline,profile,prompt,model)
                VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?)''',
                (id,owner,request.engine,request.match_id,request.trace_hash,request.locale,key,fact_pack_hash(pack),
                 canonical_bytes(pack).decode(),now,now+900,PROFILE,PROMPT_VERSION,MODEL))
            return self._view(conn,conn.execute('SELECT * FROM chronicle_jobs WHERE id=?',(id,)).fetchone())

    def lookup(self, owner: str, request: ChronicleRequest):
        with self._transaction() as (conn,_):
            row = conn.execute('''SELECT * FROM chronicle_jobs WHERE owner=? AND engine=? AND match_id=? AND revision=?
                AND locale=? AND profile=? AND prompt=? AND model=? ORDER BY created DESC LIMIT 1''',
                (owner,request.engine,request.match_id,request.trace_hash,request.locale,PROFILE,PROMPT_VERSION,MODEL)).fetchone()
            return self._view(conn,row) if row else None

    def get(self, job_id: str, owner: str) -> ChronicleView:
        with self._transaction() as (conn,_):
            row = conn.execute('SELECT * FROM chronicle_jobs WHERE id=? AND owner=?',(job_id,owner)).fetchone()
            if row is None: raise KeyError(job_id)
            return self._view(conn,row)

    def internal(self, job_id):
        """Trusted service only; never serialised as a browser/worker response."""
        with self.connection() as conn:
            row = conn.execute('SELECT * FROM chronicle_jobs WHERE id=?',(job_id,)).fetchone()
            if row is None: raise KeyError(job_id)
            return row['owner'], ChronicleRequest(engine=row['engine'],match_id=row['match_id'],trace_hash=row['revision'],locale=row['locale']), self._pack(row)

    def pending(self):
        with self.connection() as conn:
            return [r[0] for r in conn.execute("SELECT id FROM chronicle_jobs WHERE state='queued' ORDER BY created,id LIMIT 4")]

    def fail(self, job_id, error, *, rejected=False):
        with self._transaction() as (conn,_):
            conn.execute("UPDATE chronicle_jobs SET state=?,error=? WHERE id=? AND state IN ('queued','running')",
                         ('rejected' if rejected else 'unavailable', error,job_id))

    def status(self):
        with self._transaction() as (conn,now): return self._status(conn,now)

    @staticmethod
    def _status(conn, now):
        row = conn.execute('SELECT * FROM chronicle_worker LIMIT 1').fetchone()
        if row is None or now-row['seen'] >= 60: return WorkerStatus(state='disconnected')
        if conn.execute("SELECT 1 FROM chronicle_jobs WHERE state='running'").fetchone(): return WorkerStatus(state='busy')
        return WorkerStatus(state='ready' if row['ready'] else 'not_ready')

    def heartbeat(self, identity: WorkerIdentity, lease: LeaseRef | None, model_ready: bool) -> WorkerStatus:
        with self._transaction() as (conn,now):
            existing = conn.execute('SELECT worker_id FROM chronicle_worker LIMIT 1').fetchone()
            if existing and existing[0] != identity.worker_id: raise ChronicleConflict('Different registered worker')
            if lease is not None:
                row = conn.execute('SELECT * FROM chronicle_jobs WHERE id=?',(lease.job_id,)).fetchone()
                self._check_lease(row,identity,lease)
                if row['state'] != 'running': raise ChronicleConflict('Job is not running')
                conn.execute('UPDATE chronicle_jobs SET lease_deadline=? WHERE id=?',(min(now+60,row['job_deadline']),row['id']))
            conn.execute('INSERT INTO chronicle_worker VALUES(?,?,?) ON CONFLICT(worker_id) DO UPDATE SET seen=excluded.seen,ready=excluded.ready',
                         (identity.worker_id,now,int(model_ready)))
            return self._status(conn,now)

    def claim(self, identity: WorkerIdentity, *, job_id=None) -> ClaimedJob | None:
        with self._transaction() as (conn,now):
            worker = conn.execute('SELECT * FROM chronicle_worker WHERE worker_id=?',(identity.worker_id,)).fetchone()
            if worker is None or not worker['ready'] or now-worker['seen'] >= 60: return None
            if conn.execute("SELECT 1 FROM chronicle_jobs WHERE state='running'").fetchone(): return None
            rows = conn.execute("SELECT * FROM chronicle_jobs WHERE state='queued' ORDER BY created,id LIMIT 4").fetchall()
            for row in rows:
                if job_id is not None and row['id'] != job_id: continue
                pack = self._pack(row)
                if (row['profile'],row['prompt'],row['model']) != (PROFILE,PROMPT_VERSION,MODEL): raise ChronicleConflict('Profile mismatch')
                args = (row['owner'],row['engine'],row['match_id'],row['revision'],row['locale'])
                reserved = conn.execute('''SELECT COALESCE(SUM(reserved),0) FROM chronicle_usage
                    WHERE owner=? AND engine=? AND match_id=? AND revision=? AND locale=?''',args).fetchone()[0]
                total, final = legacy_usage(conn,row['owner'],row['match_id'],row['revision'],row['locale']) if row['engine']=='timepitch' else (0,0)
                if reserved+final+4 > 4 or reserved+total+4 > 12:
                    conn.execute("UPDATE chronicle_jobs SET state='unavailable',error='budget_exhausted' WHERE id=?",(row['id'],))
                    continue
                token = secrets.token_urlsafe(32); generation = row['generation']+1
                conn.execute('INSERT INTO chronicle_usage VALUES(?,?,?,?,?,?,4,NULL)',(row['id'],*args))
                conn.execute("UPDATE chronicle_jobs SET state='running',worker_id=?,generation=?,lease_hash=?,lease_deadline=?,job_deadline=? WHERE id=?",
                    (identity.worker_id,generation,sha256(token.encode()).hexdigest(),now+60,now+180,row['id']))
                return ClaimedJob(lease=LeaseRef(job_id=row['id'],generation=generation,lease_token=token,fact_hash=row['fact_hash']),
                                  fact_pack=pack,locale=row['locale'],deadline_at=now+180)
            return None

    @staticmethod
    def _check_lease(row, identity, lease):
        if (row is None or row['worker_id'] != identity.worker_id or row['profile'] != identity.profile or
            row['generation'] != lease.generation or row['fact_hash'] != lease.fact_hash or
            not hmac.compare_digest(row['lease_hash'] or '',sha256(lease.lease_token.encode()).hexdigest())):
            raise ChronicleConflict('Invalid lease')

    def validate_lease(self, identity, lease):
        with self._transaction() as (conn,_):
            row = conn.execute('SELECT * FROM chronicle_jobs WHERE id=?',(lease.job_id,)).fetchone()
            self._check_lease(row,identity,lease)
            if row['state'] not in ('running','ready'): raise ChronicleConflict('Inactive lease')
            self._pack(row)

    def complete(self, identity: WorkerIdentity, result: WorkerResult, *, text: str) -> ChronicleView:
        result = WorkerResult.model_validate_json(result.model_dump_json())
        digest = sha256(canonical_bytes(result)+text.encode()).hexdigest()
        with self._transaction() as (conn,_):
            row = conn.execute('SELECT * FROM chronicle_jobs WHERE id=?',(result.lease.job_id,)).fetchone()
            self._check_lease(row,identity,result.lease)
            self._pack(row)
            if row['state'] == 'ready' and row['result_hash'] == digest: return self._view(conn,row)
            if row['state'] != 'running': raise ChronicleConflict('Immutable or inactive job')
            conn.execute("UPDATE chronicle_jobs SET state='ready',text=?,result_hash=?,refs=?,error=NULL WHERE id=?",
                (text,digest,json.dumps(sorted({ref for f in self._pack(row).facts if f.id in {id for p in result.selection.paragraphs for id in p.fact_ids} for ref in f.event_refs})),row['id']))
            conn.execute('UPDATE chronicle_usage SET actual=? WHERE job_id=?',(result.actual_calls,row['id']))
            return self._view(conn,conn.execute('SELECT * FROM chronicle_jobs WHERE id=?',(row['id'],)).fetchone())
