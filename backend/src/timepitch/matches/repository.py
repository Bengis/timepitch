from contextlib import contextmanager
import json
from pathlib import Path
import secrets
import sqlite3
import time
import zlib
from .models import MatchJob, MatchSummary
from ..simulation.replay import parse_replay, encode_replay, MAX_REPLAY_BYTES


class MatchRepository:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('''CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL,config TEXT NOT NULL,
                summary TEXT,record BLOB,error TEXT,created_ns INTEGER NOT NULL)''')
            conn.execute('CREATE INDEX IF NOT EXISTS owner_recent ON matches(owner,created_ns DESC)')
            conn.execute("UPDATE matches SET state='failed',error='interrupted' WHERE state IN ('queued','running')")

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _job(self, row):
        return MatchJob(id=row['id'], state=row['state'], config=json.loads(row['config']), error=row['error'],
                        summary=json.loads(row['summary']) if row['summary'] else None)

    def create(self, config, owner):
        match_id = secrets.token_urlsafe(18)
        with self.connection() as conn:
            conn.execute('INSERT INTO matches(id,owner,state,config,created_ns) VALUES(?,?,?,?,?)',
                         (match_id, owner, 'queued', config.model_dump_json(), time.time_ns()))
        return MatchJob(id=match_id, state='queued', config=config)

    def get_job(self, match_id, owner):
        with self.connection() as conn:
            row = conn.execute('SELECT id,state,config,summary,error FROM matches WHERE id=? AND owner=?', (match_id, owner)).fetchone()
        if row is None:
            raise KeyError(match_id)
        return self._job(row)

    def list_jobs(self, owner):
        with self.connection() as conn:
            rows = conn.execute('SELECT id,state,config,summary,error FROM matches WHERE owner=? ORDER BY created_ns DESC LIMIT 30', (owner,)).fetchall()
        return [self._job(row) for row in rows]

    def start(self, match_id, owner):
        with self.connection() as conn:
            return conn.execute("UPDATE matches SET state='running' WHERE id=? AND owner=? AND state='queued'", (match_id, owner)).rowcount == 1

    def _prune(self, conn, owner):
        conn.execute('''DELETE FROM matches WHERE owner=? AND state IN ('ready','failed') AND id NOT IN
            (SELECT id FROM matches WHERE owner=? ORDER BY created_ns DESC LIMIT 30)''', (owner, owner))

    def finish(self, match_id, owner, record):
        raw = encode_replay(record)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError('Replay exceeds storage budget')
        summary = MatchSummary(home_name=record.home_name, away_name=record.away_name,
                               trace_hash=record.trace_hash, metrics=record.metrics).model_dump_json()
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT state,summary FROM matches WHERE id=? AND owner=?', (match_id, owner)).fetchone()
            if row is None: raise KeyError(match_id)
            if row['state'] == 'ready':
                if json.loads(row['summary'])['trace_hash'] != record.trace_hash:
                    raise ValueError('Cannot replace a finished match')
                return
            if row['state'] != 'running': raise ValueError('Match is not running')
            conn.execute("UPDATE matches SET state='ready',summary=?,record=?,error=NULL WHERE id=? AND owner=?",
                         (summary, zlib.compress(raw), match_id, owner))
            self._prune(conn, owner)

    def fail(self, match_id, owner, code):
        with self.connection() as conn:
            conn.execute("UPDATE matches SET state='failed',error=? WHERE id=? AND owner=? AND state IN ('queued','running')", (code, match_id, owner))
            self._prune(conn, owner)

    def get_record(self, match_id, owner):
        with self.connection() as conn:
            row = conn.execute("SELECT record FROM matches WHERE id=? AND owner=? AND state='ready'", (match_id, owner)).fetchone()
        if row is None: raise KeyError(match_id)
        decoder = zlib.decompressobj()
        raw = decoder.decompress(row['record'], MAX_REPLAY_BYTES + 1)
        if len(raw) > MAX_REPLAY_BYTES or not decoder.eof or decoder.unused_data:
            raise ValueError('Invalid or oversized stored replay')
        return parse_replay(raw)
