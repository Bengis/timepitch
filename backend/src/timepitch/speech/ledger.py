"""Durable, single-use Speech admission; uncertain sends are never refunded."""
import sqlite3
from pathlib import Path


class SpeechRefused(ValueError):
    pass


class SpeechGrantRegistry:
    """One canonical registry outside the caller-selected output directory."""
    def __init__(self, path: Path, *, existing_only=False):
        try:
            self.db = sqlite3.connect(path.resolve().as_uri() + '?mode=rw', uri=True) if existing_only else sqlite3.connect(path)
        except sqlite3.Error:
            raise SpeechRefused('recovery_registry_missing') from None
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS grants (grant_id TEXT UNIQUE, binding TEXT UNIQUE, output TEXT)')
        self.db.commit()

    def claim(self, grant_id: str, binding: str, output: str):
        try:
            with self.db:
                self.db.execute('INSERT INTO grants VALUES (?,?,?)', (grant_id, binding, output))
        except sqlite3.IntegrityError:
            raise SpeechRefused('already_used') from None

    def claim_recovery(self, grant_id: str, binding: str, output: str, parent_binding: str):
        try:
            self.db.execute('BEGIN IMMEDIATE')
            if not self.db.execute('SELECT 1 FROM grants WHERE binding=?', (parent_binding,)).fetchone():
                raise SpeechRefused('recovery_parent_missing')
            self.db.execute('CREATE TABLE IF NOT EXISTS recoveries (parent_binding TEXT PRIMARY KEY, child_binding TEXT UNIQUE NOT NULL, child_grant TEXT UNIQUE NOT NULL)')
            self.db.execute('INSERT INTO grants VALUES (?,?,?)', (grant_id, binding, output))
            self.db.execute('INSERT INTO recoveries VALUES (?,?,?)', (parent_binding, binding, grant_id))
            self.db.commit()
        except (sqlite3.IntegrityError, SpeechRefused):
            self.db.rollback()
            raise SpeechRefused('recovery_already_used_or_invalid') from None


class SpeechLedger:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS run (id INTEGER PRIMARY KEY CHECK(id=1), grant_id TEXT, binding TEXT, status TEXT);
            CREATE TABLE IF NOT EXISTS attempts (item INTEGER PRIMARY KEY, hash TEXT, bytes INTEGER,
                sent INTEGER DEFAULT 0, state TEXT, receipt TEXT);
        ''')

    def claim(self, grant_id: str, binding: str):
        try:
            with self.db:
                self.db.execute('INSERT INTO run VALUES (1,?,?,?)', (grant_id, binding, 'claimed'))
        except sqlite3.IntegrityError:
            raise SpeechRefused('already_used') from None

    def reserve(self, item: int, digest: str, size: int):
        self._reserve(item, digest, size, {'requests': 0, 'reservations': 0, 'ssml_utf8_bytes': 0})

    def _reserve(self, item: int, digest: str, size: int, prior: dict):
        try:
            self.db.execute('BEGIN IMMEDIATE')
            if not self.db.execute('SELECT 1 FROM run').fetchone():
                raise SpeechRefused('unclaimed')
            count, total = self.db.execute('SELECT count(*),coalesce(sum(bytes),0) FROM attempts').fetchone()
            if count + prior['requests'] >= 4 or count + prior['reservations'] >= 4 or size <= 0 or total + prior['ssml_utf8_bytes'] + size > 4000 or not 0 <= item < 4:
                raise SpeechRefused('limit')
            self.db.execute('INSERT INTO attempts(item,hash,bytes,state) VALUES (?,?,?,?)', (item, digest, size, 'reserved'))
            self.db.commit()
        except (sqlite3.IntegrityError, SpeechRefused):
            self.db.rollback()
            raise SpeechRefused('reservation_refused') from None

    def mark_sent(self, item: int):
        with self.db:
            row = self.db.execute("UPDATE attempts SET sent=1,state='sent_uncertain' WHERE item=? AND sent=0", (item,))
            if row.rowcount != 1:
                raise SpeechRefused('already_sent')

    def receipt(self, item: int, state: str, receipt: str):
        with self.db:
            self.db.execute('UPDATE attempts SET state=?,receipt=? WHERE item=?', (state, receipt, item))

    def finish(self, status: str):
        with self.db:
            self.db.execute('UPDATE run SET status=?', (status,))

    def summary(self):
        count, sent, size = self.db.execute('SELECT count(*),coalesce(sum(sent),0),coalesce(sum(bytes),0) FROM attempts').fetchone()
        return {'reservations': count, 'sent': sent, 'reserved_ssml_bytes': size}

    def cumulative_summary(self):
        usage = self.summary()
        return {'requests': max(usage['reservations'], usage['sent']), 'reservations': usage['reservations'],
                'ssml_utf8_bytes': usage['reserved_ssml_bytes'], 'synthesis_sent': usage['sent'], 'speech_cost_ceiling_eur': 0}
