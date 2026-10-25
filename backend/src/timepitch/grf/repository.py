"""Owned GRF storage, isolated from canonical matches and explanation budgets."""
from contextlib import contextmanager
import json
from pathlib import Path
import secrets
import sqlite3
import time
import zlib
from .models import GrfJob, GrfSummary
from .codec import encode_grf, parse_grf, MAX_BYTES


class GrfRepository:
    def __init__(self, path: Path):
        self.path=path
        path.parent.mkdir(parents=True,exist_ok=True)
        with self.connection() as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('''CREATE TABLE IF NOT EXISTS grf_matches (
                id TEXT PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL,config TEXT NOT NULL,
                summary TEXT,record BLOB,error TEXT,created_ns INTEGER NOT NULL)''')
            conn.execute('CREATE INDEX IF NOT EXISTS grf_owner_recent ON grf_matches(owner,created_ns DESC)')
            conn.execute("UPDATE grf_matches SET state='failed',error='interrupted' WHERE state IN ('queued','running')")
            for row in conn.execute('SELECT DISTINCT owner FROM grf_matches').fetchall():
                self._prune(conn,row['owner'])

    @contextmanager
    def connection(self):
        conn=sqlite3.connect(self.path,timeout=10);conn.row_factory=sqlite3.Row
        try:
            with conn:yield conn
        finally:conn.close()

    @staticmethod
    def _job(row):
        return GrfJob(id=row['id'],state=row['state'],config=json.loads(row['config']),error=row['error'],
                      summary=json.loads(row['summary']) if row['summary'] else None)

    def create(self, config, owner):
        id=secrets.token_urlsafe(18)
        with self.connection() as conn:
            conn.execute('INSERT INTO grf_matches(id,owner,state,config,created_ns) VALUES(?,?,?,?,?)',
                         (id,owner,'queued',config.model_dump_json(),time.time_ns()))
        return GrfJob(id=id,state='queued',config=config)

    def get_job(self,id,owner):
        with self.connection() as conn:
            row=conn.execute('SELECT id,state,config,summary,error FROM grf_matches WHERE id=? AND owner=?',(id,owner)).fetchone()
        if row is None:raise KeyError(id)
        return self._job(row)

    def list_jobs(self,owner):
        with self.connection() as conn:
            rows=conn.execute('SELECT id,state,config,summary,error FROM grf_matches WHERE owner=? ORDER BY created_ns DESC',(owner,)).fetchall()
        return [self._job(row) for row in rows]

    def start(self,id,owner):
        with self.connection() as conn:
            return conn.execute("UPDATE grf_matches SET state='running' WHERE id=? AND owner=? AND state='queued'",(id,owner)).rowcount==1

    @staticmethod
    def _prune(conn,owner):
        conn.execute('''DELETE FROM grf_matches WHERE owner=? AND state IN ('ready','failed') AND id NOT IN
            (SELECT id FROM grf_matches WHERE owner=? AND state IN ('ready','failed') ORDER BY created_ns DESC LIMIT 30)''',(owner,owner))

    def finish(self,id,owner,record):
        raw=encode_grf(record);parse_grf(raw)
        summary=GrfSummary(home_name=record.input.home_name,away_name=record.input.away_name,
            score=record.samples[-1].score,duration_ms=record.duration_ms,trace_hash=record.trace_hash)
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row=conn.execute('SELECT * FROM grf_matches WHERE id=? AND owner=?',(id,owner)).fetchone()
            if row is None:raise KeyError(id)
            if json.loads(row['config'])!=record.input.config.model_dump(mode='json'):raise ValueError('Wrong job configuration')
            if row['state']=='ready':
                if json.loads(row['summary'])['trace_hash']!=record.trace_hash:raise ValueError('Finished result is immutable')
                return
            if row['state']!='running':raise ValueError('GRF job is not running')
            conn.execute("UPDATE grf_matches SET state='ready',summary=?,record=?,error=NULL WHERE id=? AND owner=?",(summary.model_dump_json(),zlib.compress(raw,level=1),id,owner))
            self._prune(conn,owner)

    def fail(self,id,owner,code):
        with self.connection() as conn:
            conn.execute("UPDATE grf_matches SET state='failed',error=? WHERE id=? AND owner=? AND state IN ('queued','running')",(code,id,owner))
            self._prune(conn,owner)

    def get_record(self,id,owner):
        with self.connection() as conn:
            row=conn.execute("SELECT record FROM grf_matches WHERE id=? AND owner=? AND state='ready'",(id,owner)).fetchone()
        if row is None:raise KeyError(id)
        decoder=zlib.decompressobj()
        try:raw=decoder.decompress(row['record'],MAX_BYTES+1)
        except zlib.error as error:raise ValueError('Invalid compressed GRF replay') from error
        if len(raw)>MAX_BYTES or not decoder.eof or decoder.unused_data:raise ValueError('Oversized or invalid compressed GRF replay')
        return parse_grf(raw)
