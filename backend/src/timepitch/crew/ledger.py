"""Crew envelope and write-ahead ledger.

Before every send an intent (step, request_hash, reserved liability) is committed; after it a
receipt (model, request id, tokens, actual cost, output). On resume, receipts replay at no
cost and an intent without a receipt is an uncertain send: it stays charged at its
reservation and is never resent.
"""
from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256
import os
from pathlib import Path
import sqlite3
import stat
import time

from ..chronicles.azure.budget import maximum_liability
from .models import CALLS_PER_REPORT, MAX_OUTPUT_TOKENS, CrewBinding, CrewGrant, InputBound, digest

MAX_REQUEST_BYTES = 24576
CONTEXT_CEILING_TOKENS = 1_047_576
MAX_ENVELOPE_BYTES = 16384


class EnvelopeRefused(RuntimeError):
    """Application-owned reason codes only."""
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def input_upper_crew_bytes_1(request_bytes: int) -> int:
    """Version crew-input-bytes-1 (NOT yet approved).

    Byte-bound argument: a BPE token covers at least one byte of the encoded request, so the
    request's input tokens cannot exceed its byte length; the factor 2 and the +1024 cover
    message framing the service adds. Requests above 24 KiB are refused, never estimated.
    """
    if type(request_bytes) is not int or request_bytes <= 0:
        raise EnvelopeRefused('invalid_request_size')
    if request_bytes > MAX_REQUEST_BYTES:
        raise EnvelopeRefused('request_too_large')
    return 2 * request_bytes + 1024


def input_upper_context_ceiling(request_bytes: int) -> int:
    """Version context-ceiling-1047576: the deployment's full input context, no proof needed."""
    if type(request_bytes) is not int or request_bytes <= 0:
        raise EnvelopeRefused('invalid_request_size')
    if request_bytes > MAX_REQUEST_BYTES:
        raise EnvelopeRefused('request_too_large')
    return CONTEXT_CEILING_TOKENS


INPUT_BOUNDS = {'crew-input-bytes-1': input_upper_crew_bytes_1,
                'context-ceiling-1047576': input_upper_context_ceiling}


def input_upper(bound: InputBound, request_bytes: int) -> int:
    return INPUT_BOUNDS[bound](request_bytes)


def call_reservation(grant: CrewGrant, request_bytes: int) -> tuple[int, Decimal]:
    upper = input_upper(grant.input_bound, request_bytes)
    return upper, maximum_liability(grant.tariff, upper, MAX_OUTPUT_TOKENS)


def _private_file(path: Path, limit: int) -> bytes:
    if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):
        raise EnvelopeRefused('envelope_not_private_file')
    if os.name != 'nt' and path.stat().st_mode & 0o077:
        raise EnvelopeRefused('envelope_permissions')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise EnvelopeRefused('envelope_too_large')
    return raw


def load_grant(path: Path, binding: CrewBinding, *, expected_sha256: str | None = None,
               now=time.time) -> tuple[CrewGrant, str]:
    """Load and check a private envelope file; returns the grant and its file sha256."""
    return parse_grant(_private_file(Path(path), MAX_ENVELOPE_BYTES), binding, expected_sha256=expected_sha256, now=now)


def parse_grant(raw: bytes, binding: CrewBinding, *, expected_sha256: str | None = None,
                now=time.time) -> tuple[CrewGrant, str]:
    """Check envelope bytes (from a private file or a queued CrewRequest); returns the grant and its sha256."""
    if len(raw) > MAX_ENVELOPE_BYTES:
        raise EnvelopeRefused('envelope_too_large')
    file_hash = sha256(raw).hexdigest()
    if expected_sha256 is not None and file_hash != expected_sha256:
        raise EnvelopeRefused('envelope_hash_mismatch')
    try:
        grant = CrewGrant.model_validate_json(raw)
    except ValueError:
        raise EnvelopeRefused('envelope_invalid') from None
    if grant.binding_hash != digest(binding):
        raise EnvelopeRefused('binding_mismatch')
    if grant.expires_at <= now():
        raise EnvelopeRefused('envelope_expired')
    return grant, file_hash


@dataclass(frozen=True)
class Receipt:
    step: str
    model: str | None
    request_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    reserved: Decimal
    cost: Decimal
    output: str | None
    error: str | None


@dataclass(frozen=True)
class Intent:
    step: str
    request_bytes: int
    input_upper: int
    reserved: Decimal


_SCHEMA = '''
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intents(request_hash TEXT NOT NULL, step TEXT NOT NULL, request_bytes INTEGER NOT NULL,
    input_upper INTEGER NOT NULL, reserved TEXT NOT NULL, created_at REAL NOT NULL, PRIMARY KEY(request_hash, step));
CREATE TABLE IF NOT EXISTS receipts(request_hash TEXT NOT NULL, step TEXT NOT NULL, model TEXT, request_id TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cost TEXT NOT NULL, output TEXT, error TEXT, created_at REAL NOT NULL,
    PRIMARY KEY(request_hash, step), FOREIGN KEY(request_hash, step) REFERENCES intents(request_hash, step));
CREATE TABLE IF NOT EXISTS reports(request_hash TEXT PRIMARY KEY, report_sha256 TEXT NOT NULL, provenance TEXT NOT NULL,
    created_at REAL NOT NULL);
'''


class CrewLedger:
    """One ledger per envelope; refuses to mix envelopes."""

    def __init__(self, path: Path, grant: CrewGrant, grant_sha256: str, *, now=time.time):
        self.grant, self.grant_sha256, self.now = grant, grant_sha256, now
        self.db = sqlite3.connect(str(path), isolation_level=None)
        self.db.executescript(_SCHEMA)
        self.db.execute('PRAGMA foreign_keys=ON')
        row = self.db.execute("SELECT value FROM meta WHERE key='grant_sha256'").fetchone()
        if row is None:
            self.db.execute("INSERT INTO meta VALUES('grant_sha256', ?)", (grant_sha256,))
        elif row[0] != grant_sha256:
            self.db.close()
            raise EnvelopeRefused('ledger_belongs_to_other_envelope')

    def close(self):
        self.db.close()

    def intent(self, request_hash: str, step: str) -> Intent | None:
        row = self.db.execute('SELECT step, request_bytes, input_upper, reserved FROM intents WHERE request_hash=? AND step=?',
                              (request_hash, step)).fetchone()
        return Intent(row[0], row[1], row[2], Decimal(row[3])) if row else None

    def receipt(self, request_hash: str, step: str) -> Receipt | None:
        row = self.db.execute('''SELECT r.step, r.model, r.request_id, r.input_tokens, r.output_tokens, i.reserved, r.cost,
            r.output, r.error FROM receipts r JOIN intents i USING(request_hash, step) WHERE request_hash=? AND step=?''',
                              (request_hash, step)).fetchone()
        if row is None:
            return None
        return Receipt(row[0], row[1], row[2], row[3], row[4], Decimal(row[5]), Decimal(row[6]), row[7], row[8])

    def exposure(self) -> Decimal:
        """Actual cost for receipted sends plus the full reservation of every uncertain send."""
        total = Decimal(0)
        for reserved, cost in self.db.execute('SELECT i.reserved, r.cost FROM intents i LEFT JOIN receipts r USING(request_hash, step)'):
            total += Decimal(cost) if cost is not None else Decimal(reserved)
        return total

    def reports_started(self) -> int:
        return self.db.execute('SELECT COUNT(DISTINCT request_hash) FROM intents').fetchone()[0]

    def reserve(self, request_hash: str, step: str, request_bytes: int) -> Intent:
        """Commit an intent before the send, or refuse. Never reserves the same step twice."""
        upper, reserved = call_reservation(self.grant, request_bytes)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            if self.grant.expires_at <= self.now():
                raise EnvelopeRefused('envelope_expired')
            if self.intent(request_hash, step) is not None:
                raise EnvelopeRefused('step_already_sent')
            calls = self.db.execute('SELECT COUNT(*) FROM intents WHERE request_hash=?', (request_hash,)).fetchone()[0]
            if calls == 0 and self.reports_started() >= self.grant.max_reports:
                raise EnvelopeRefused('reports_exhausted')
            if calls >= min(CALLS_PER_REPORT, self.grant.calls_per_report):
                raise EnvelopeRefused('calls_exhausted')
            if self.exposure() + reserved > self.grant.money_limit:
                raise EnvelopeRefused('money_exhausted')
            self.db.execute('INSERT INTO intents VALUES(?,?,?,?,?,?)',
                            (request_hash, step, request_bytes, upper, str(reserved), self.now()))
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise
        return Intent(step, request_bytes, upper, reserved)

    def record_receipt(self, request_hash: str, step: str, *, model, request_id, input_tokens, output_tokens,
                       cost: Decimal, output: str | None, error: str | None) -> Receipt:
        intent = self.intent(request_hash, step)
        if intent is None:
            raise EnvelopeRefused('receipt_without_intent')
        self.db.execute('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?,?)',
                        (request_hash, step, model, request_id, input_tokens, output_tokens, str(cost), output, error, self.now()))
        return self.receipt(request_hash, step)

    def record_report(self, request_hash: str, report_sha256: str, provenance: str):
        self.db.execute('INSERT OR REPLACE INTO reports VALUES(?,?,?,?)', (request_hash, report_sha256, provenance, self.now()))
