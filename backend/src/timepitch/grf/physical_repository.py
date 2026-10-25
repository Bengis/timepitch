"""Owner-scoped incremental storage; partial jobs never become replays."""
import json
import secrets
import time
from .repository import GrfRepository
from .models import GrfJob,GrfSummary
from .physical_codec import encode_chunk,decode_chunk,validate_manifest,canonical
from .physical_models import PhysicalManifest
from .physical_wire import MAX_TOTAL_COMPRESSED


class PhysicalRepository(GrfRepository):
    def __init__(self,path):
        self.path=path;path.parent.mkdir(parents=True,exist_ok=True)
        with self.connection() as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA foreign_keys=ON')
            conn.execute('''CREATE TABLE IF NOT EXISTS physical_matches (
                id TEXT PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL,config TEXT NOT NULL,
                summary TEXT,manifest TEXT,error TEXT,created_ns INTEGER NOT NULL)''')
            conn.execute('CREATE INDEX IF NOT EXISTS physical_owner_recent ON physical_matches(owner,created_ns DESC)')
            conn.execute('''CREATE TABLE IF NOT EXISTS physical_chunks (
                match_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,record BLOB NOT NULL,
                PRIMARY KEY(match_id,chunk_index))''')
            conn.execute("UPDATE physical_matches SET state='failed',error='interrupted' WHERE state IN ('queued','running')")
            conn.execute("DELETE FROM physical_chunks WHERE match_id IN (SELECT id FROM physical_matches WHERE state='failed')")

    def create(self,config,owner):
        id='physical-'+secrets.token_urlsafe(18)
        with self.connection() as conn:
            conn.execute('INSERT INTO physical_matches(id,owner,state,config,created_ns) VALUES(?,?,?,?,?)',
                (id,owner,'queued',config.model_dump_json(),time.time_ns()))
        return GrfJob(id=id,state='queued',config=config)

    def get_job(self,id,owner):
        with self.connection() as conn:
            row=conn.execute('SELECT * FROM physical_matches WHERE id=? AND owner=?',(id,owner)).fetchone()
        if row is None:raise KeyError(id)
        return self._job(row)

    def list_jobs(self,owner):
        with self.connection() as conn:
            rows=conn.execute('SELECT * FROM physical_matches WHERE owner=? ORDER BY created_ns DESC',(owner,)).fetchall()
        return [self._job(row) for row in rows]

    def start(self,id,owner):
        with self.connection() as conn:
            return conn.execute("UPDATE physical_matches SET state='running' WHERE id=? AND owner=? AND state='queued'",(id,owner)).rowcount==1

    def append_chunk(self,id,owner,chunk):
        raw=encode_chunk(chunk)
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row=conn.execute("SELECT state FROM physical_matches WHERE id=? AND owner=?",(id,owner)).fetchone()
            if row is None:raise KeyError(id)
            if row['state']!='running':raise ValueError('Physical job is not running')
            total=conn.execute('SELECT COUNT(*),COALESCE(SUM(length(record)),0) FROM physical_chunks WHERE match_id=?',(id,)).fetchone()
            if chunk.index!=total[0] or total[1]+len(raw)>MAX_TOTAL_COMPRESSED:raise ValueError('Physical block sequence/budget')
            conn.execute('INSERT INTO physical_chunks VALUES(?,?,?)',(id,chunk.index,raw))

    @staticmethod
    def _chunks(conn,id):
        cursor=conn.execute('SELECT record FROM physical_chunks WHERE match_id=? ORDER BY chunk_index',(id,))
        for row in cursor:yield decode_chunk(row[0])

    def finish(self,id,owner,manifest):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row=conn.execute('SELECT * FROM physical_matches WHERE id=? AND owner=?',(id,owner)).fetchone()
            if row is None:raise KeyError(id)
            if row['state']!='running' or json.loads(row['config'])!=manifest.input.config.model_dump(mode='json'):
                raise ValueError('Physical job/config mismatch')
            validate_manifest(manifest,self._chunks(conn,id))
            summary=GrfSummary(home_name=manifest.input.home_name,away_name=manifest.input.away_name,
                score=manifest.score,duration_ms=manifest.duration_ms,trace_hash=manifest.trace_hash)
            conn.execute("UPDATE physical_matches SET state='ready',manifest=?,summary=?,error=NULL WHERE id=? AND owner=?",
                (manifest.model_dump_json(),summary.model_dump_json(),id,owner))
            self.prune(conn,owner)

    def fail(self,id,owner,code):
        with self.connection() as conn:
            changed=conn.execute("UPDATE physical_matches SET state='failed',error=? WHERE id=? AND owner=? AND state IN ('queued','running')",
                (code,id,owner)).rowcount
            if changed:conn.execute('DELETE FROM physical_chunks WHERE match_id=?',(id,))
            self.prune(conn,owner)

    def prune(self,conn,owner):
        old=conn.execute('''SELECT id FROM physical_matches WHERE owner=? AND state IN ('ready','failed')
            ORDER BY created_ns DESC LIMIT -1 OFFSET 30''',(owner,)).fetchall()
        for row in old:
            conn.execute('DELETE FROM physical_chunks WHERE match_id=?',(row[0],))
            conn.execute('DELETE FROM physical_matches WHERE id=? AND owner=?',(row[0],owner))

    def get_record(self,id,owner):
        with self.connection() as conn:
            row=conn.execute("SELECT manifest FROM physical_matches WHERE id=? AND owner=? AND state='ready'",(id,owner)).fetchone()
        if row is None:raise KeyError(id)
        from .physical_codec import parse_manifest
        return parse_manifest(row[0])

    def get_chunk(self,id,owner,index):
        with self.connection() as conn:
            row=conn.execute('''SELECT c.record FROM physical_chunks c JOIN physical_matches m ON m.id=c.match_id
                WHERE m.id=? AND m.owner=? AND m.state='ready' AND c.chunk_index=?''',(id,owner,index)).fetchone()
        if row is None:raise KeyError(id)
        return decode_chunk(row[0])

    def iter_physical_chunks(self,match_id,owner):
        self.get_record(match_id,owner)
        with self.connection() as conn:
            yield from self._chunks(conn,match_id)

    def export(self,id,owner):
        manifest=self.get_record(id,owner)
        def lines():
            yield canonical({'type':'manifest','manifest':manifest.model_dump(mode='json')})+b'\n'
            for chunk in self.iter_physical_chunks(id,owner):
                yield canonical({'type':'chunk','chunk':chunk.model_dump(mode='json')})+b'\n'
        return lines()


class GrfRepositoryFacade:
    """History and ids share one service; databases and contracts stay separate."""
    def __init__(self,legacy,physical):self.legacy=legacy;self.physical=physical
    # Existing maintenance/import callers retain explicit legacy storage access.
    # Physical creation always goes through the service's physical repository.
    def connection(self):return self.legacy.connection()
    def create(self,config,owner):return self.legacy.create(config,owner)
    def start(self,id,owner):return self.repository_for(id).start(id,owner)
    def finish(self,id,owner,record):return self.repository_for(id).finish(id,owner,record)
    def fail(self,id,owner,code):return self.repository_for(id).fail(id,owner,code)
    def repository_for(self,id):return self.physical if id.startswith('physical-') else self.legacy
    def get_job(self,id,owner):return self.repository_for(id).get_job(id,owner)
    def get_record(self,id,owner):return self.repository_for(id).get_record(id,owner)
    def list_jobs(self,owner):
        jobs=[];created={}
        for repository,table in ((self.legacy,'grf_matches'),(self.physical,'physical_matches')):
            jobs.extend(repository.list_jobs(owner))
            with repository.connection() as conn:
                created.update((row[0],row[1]) for row in conn.execute(f'SELECT id,created_ns FROM {table} WHERE owner=?',(owner,)))
        return sorted(jobs,key=lambda job:created[job.id],reverse=True)
