"""Cloud-native crew (TP233): Storage Queue -> Container Apps Job -> blob report -> local fetch.

The server-side ``enqueue`` builds the FactPack locally, checks the private envelope and queues one
CrewRequest (FactPack + envelope bytes + request hash). A KEDA ``azure-queue`` rule starts a
Container Apps Job (one replica). The job takes one message with a 10-minute visibility timeout:

* unparseable or hash-inconsistent message -> ``failed/<sha256 of message>.json``, deleted, no calls;
* ``reports/<request_hash>.json`` already there -> message deleted, no spend;
* dequeue count above 2 -> ``failed/<request_hash>.json``, deleted, no calls (poison message);
* envelope refused (hash, binding, expiry, purpose, locale) -> ``failed/<request_hash>.json``, no calls;
* otherwise the crew runs with its write-ahead ledger in ``ledger/<request_hash>/<step>/{intent,receipt}``
  blobs (every record write-once, If-None-Match:*), the report is written once with If-None-Match:*
  and only then is the message deleted. A crash leaves the message; its next delivery replays the
  receipts at no cost and never resends an uncertain send.

``fetch`` downloads with a read-only SAS and trusts nothing from the cloud: it rebuilds the FactPack
locally, re-checks seal, hashes, versions, cost sum and the deterministic verifier (or re-renders
the fallback) before writing the served ``.json.gz`` and its index entry.

The model is reached with an Entra token (managed identity in the job), never an API key. SAS
tokens are read from private files and never printed.
"""
import argparse
import asyncio
from dataclasses import dataclass
from decimal import Decimal
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Annotated, Callable, Literal

from pydantic import Field

from ..chronicles.models import Digest, FactPack, Locale, canonical_bytes, fact_pack_hash
from .ledger import MAX_ENVELOPE_BYTES, EnvelopeRefused, Intent, Receipt, call_reservation, parse_grant
from .models import (CALLS_PER_REPORT, CrewBinding, CrewGrant, CrewModel, CrewReport, crew_versions, default_binding,
                     digest, request_hash, verify_report)

REQUEST_VERSION = 'crew-request-1'
INDEX_VERSION = 'crew-reports-index-1'
ACCOUNT = 'timepitchcrew'
ACCOUNT_ENV = 'TIMEPITCH_CREW_STORAGE_ACCOUNT'
QUEUE = 'crew-requests'
REPORTS = 'reports'
LEDGER = 'ledger'
VISIBILITY_TIMEOUT = 600
MAX_DEQUEUE = 2
MAX_MESSAGE_BYTES = 48 * 1024  # Storage Queue limit is 64 KiB per message
MAX_REPORT_BYTES = 256 * 1024
LLM_ROLES = ('analyst', 'writer', 'writer_revision')
_CODE = re.compile(r'^[a-z0-9_]{1,64}$')


class CrewRequest(CrewModel):
    """One queued report request. The envelope travels as its exact bytes so its sha256 still binds the ledger."""
    request_version: Literal['crew-request-1'] = REQUEST_VERSION
    request_hash: Digest
    locale: Locale
    envelope: Annotated[str, Field(min_length=2, max_length=MAX_ENVELOPE_BYTES)]
    envelope_sha256: Digest
    fact_pack: FactPack


def report_name(rh: str) -> str:
    return f'{rh}.json'


def failed_name(key: str) -> str:
    return f'failed/{key}.json'


def check_crew_grant(grant: CrewGrant, locale: str) -> None:
    if grant.purpose != 'crew':
        raise EnvelopeRefused('envelope_purpose')
    if locale not in grant.locales:
        raise EnvelopeRefused('locale_outside_envelope')


def build_request(pack: FactPack, locale: str, envelope_raw: bytes, binding: CrewBinding, *,
                  expected_sha256: str | None = None, now=time.time) -> tuple[bytes, str]:
    """Server side: check the envelope locally and return (message bytes, request_hash)."""
    grant, grant_sha256 = parse_grant(envelope_raw, binding, expected_sha256=expected_sha256, now=now)
    check_crew_grant(grant, locale)
    rh = request_hash(fact_pack_hash(pack), locale, binding)
    try:
        envelope = envelope_raw.decode('utf-8')
    except UnicodeDecodeError:
        raise EnvelopeRefused('envelope_invalid') from None
    body = json.dumps({'request_version': REQUEST_VERSION, 'request_hash': rh, 'locale': locale,
                       'envelope': envelope, 'envelope_sha256': grant_sha256,
                       'fact_pack': json.loads(canonical_bytes(pack))},
                      sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    if len(body) > MAX_MESSAGE_BYTES:
        raise EnvelopeRefused('request_too_large')
    parse_request(body, binding)  # the job must accept exactly what is sent
    return body, rh


def parse_request(raw: bytes, binding: CrewBinding) -> CrewRequest:
    """Structure and hash only (no envelope yet): enough to name the report and the failure marker."""
    if len(raw) > MAX_MESSAGE_BYTES:
        raise EnvelopeRefused('request_too_large')
    try:
        request = CrewRequest.model_validate_json(raw)
    except ValueError:
        raise EnvelopeRefused('request_invalid') from None
    if request.request_hash != request_hash(fact_pack_hash(request.fact_pack), request.locale, binding):
        raise EnvelopeRefused('request_hash_mismatch')
    return request


def check_envelope(request: CrewRequest, binding: CrewBinding, *, now=time.time) -> tuple[CrewGrant, str]:
    grant, grant_sha256 = parse_grant(request.envelope.encode('utf-8'), binding,
                                      expected_sha256=request.envelope_sha256, now=now)
    check_crew_grant(grant, request.locale)
    return grant, grant_sha256


# ---- storage adapters (fakes in tests implement the same four/three methods) -----------------

class AzureBlobStore:
    """Container adapter: get / create-once (If-None-Match:*) / exists / names."""

    def __init__(self, container):
        self.container = container

    def get(self, name: str) -> bytes | None:
        from azure.core.exceptions import ResourceNotFoundError
        try:
            return self.container.download_blob(name).readall()
        except ResourceNotFoundError:
            return None

    def create(self, name: str, data: bytes) -> bool:
        """Write once. overwrite=False sends If-None-Match:*; False when the blob already exists."""
        from azure.core.exceptions import ResourceExistsError
        from azure.storage.blob import ContentSettings
        try:
            self.container.upload_blob(name, data, overwrite=False,
                                       content_settings=ContentSettings(content_type='application/json'))
            return True
        except ResourceExistsError:
            return False

    def exists(self, name: str) -> bool:
        return self.container.get_blob_client(name).exists()

    def names(self, prefix: str = '') -> list[str]:
        return [b.name for b in self.container.list_blobs(name_starts_with=prefix or None)]


@dataclass(frozen=True)
class QueuedMessage:
    id: str
    pop_receipt: str
    dequeue_count: int
    content: bytes


class AzureQueue:
    def __init__(self, queue):
        self.queue = queue

    def receive(self, visibility_timeout: int) -> QueuedMessage | None:
        message = self.queue.receive_message(visibility_timeout=visibility_timeout)
        if message is None:
            return None
        content = message.content
        return QueuedMessage(message.id, message.pop_receipt, int(message.dequeue_count or 0),
                             content.encode('utf-8') if isinstance(content, str) else bytes(content))

    def delete(self, message: QueuedMessage) -> None:
        self.queue.delete_message(message.id, message.pop_receipt)

    def send(self, body: bytes) -> None:
        self.queue.send_message(body.decode('ascii'))


# ---- write-ahead ledger in blobs ---------------------------------------------------------------

class BlobLedger:
    """Same contract as CrewLedger, persisted as write-once blobs so a later delivery can resume.

    ``<rh>/<step>/intent`` is created (If-None-Match:*) before the send, ``<rh>/<step>/receipt`` after it.
    Records of other envelopes for the same request still count: their receipts replay and their
    uncertain sends are never resent. Exposure and the report count are per envelope.
    """

    def __init__(self, store, grant: CrewGrant, grant_sha256: str, *, now=time.time):
        self.store, self.grant, self.grant_sha256, self.now = store, grant, grant_sha256, now

    def close(self):
        pass

    def _json(self, name: str) -> dict | None:
        raw = self.store.get(name)
        return None if raw is None else json.loads(raw)

    def intent(self, rh: str, step: str) -> Intent | None:
        d = self._json(f'{rh}/{step}/intent')
        return None if d is None else Intent(d['step'], d['request_bytes'], d['input_upper'], Decimal(d['reserved']))

    def receipt(self, rh: str, step: str) -> Receipt | None:
        intent = self.intent(rh, step)
        d = None if intent is None else self._json(f'{rh}/{step}/receipt')
        if d is None:
            return None
        return Receipt(step, d['model'], d['request_id'], d['input_tokens'], d['output_tokens'], intent.reserved,
                       Decimal(d['cost']), d['output'], d['error'])

    def _intents(self, prefix: str = ''):
        for name in self.store.names(prefix):
            if name.endswith('/intent'):
                rh, step, _ = name.split('/')
                yield rh, step, self._json(name)

    def exposure(self) -> Decimal:
        total = Decimal(0)
        for rh, step, d in self._intents():
            if d['grant_sha256'] != self.grant_sha256:
                continue
            receipt = self._json(f'{rh}/{step}/receipt')
            total += Decimal(receipt['cost']) if receipt is not None else Decimal(d['reserved'])
        return total

    def reports_started(self) -> int:
        return len({rh for rh, _, d in self._intents() if d['grant_sha256'] == self.grant_sha256})

    def reserve(self, rh: str, step: str, request_bytes: int) -> Intent:
        upper, reserved = call_reservation(self.grant, request_bytes)
        if self.grant.expires_at <= self.now():
            raise EnvelopeRefused('envelope_expired')
        if self.intent(rh, step) is not None:
            raise EnvelopeRefused('step_already_sent')
        calls = sum(1 for _ in self._intents(rh + '/'))
        if calls == 0 and self.reports_started() >= self.grant.max_reports:
            raise EnvelopeRefused('reports_exhausted')
        if calls >= min(CALLS_PER_REPORT, self.grant.calls_per_report):
            raise EnvelopeRefused('calls_exhausted')
        if self.exposure() + reserved > self.grant.money_limit:
            raise EnvelopeRefused('money_exhausted')
        record = {'step': step, 'request_bytes': request_bytes, 'input_upper': upper, 'reserved': str(reserved),
                  'grant_sha256': self.grant_sha256, 'created_at': self.now()}
        if not self.store.create(f'{rh}/{step}/intent', json.dumps(record, sort_keys=True).encode()):
            raise EnvelopeRefused('step_already_sent')
        return Intent(step, request_bytes, upper, reserved)

    def record_receipt(self, rh: str, step: str, *, model, request_id, input_tokens, output_tokens,
                       cost: Decimal, output: str | None, error: str | None) -> Receipt:
        if self.intent(rh, step) is None:
            raise EnvelopeRefused('receipt_without_intent')
        record = {'model': model, 'request_id': request_id, 'input_tokens': input_tokens, 'output_tokens': output_tokens,
                  'cost': str(cost), 'output': output, 'error': error, 'created_at': self.now()}
        if not self.store.create(f'{rh}/{step}/receipt', json.dumps(record, sort_keys=True).encode()):
            raise EnvelopeRefused('receipt_exists')
        return self.receipt(rh, step)

    def record_report(self, rh: str, report_sha256: str, provenance: str):
        self.store.create(f'{rh}/report', json.dumps({'report_sha256': report_sha256, 'provenance': provenance,
                                                      'grant_sha256': self.grant_sha256, 'created_at': self.now()},
                                                     sort_keys=True).encode())


# ---- the job -------------------------------------------------------------------------------------

def _mark_failed(reports, key: str, code: str, dequeue_count: int, now) -> None:
    reports.create(failed_name(key), json.dumps({'code': code, 'dequeue_count': dequeue_count, 'at': now()},
                                                sort_keys=True).encode())


def run_job_once(*, queue, reports, binding: CrewBinding, crew_runner: Callable, now=time.time) -> dict:
    """Process at most one message. Returns an app-owned status; raises only on an unexpected failure
    (the message then stays and its next delivery resumes from the ledger)."""
    message = queue.receive(VISIBILITY_TIMEOUT)
    if message is None:
        return {'status': 'empty'}
    try:
        request = parse_request(message.content, binding)
    except EnvelopeRefused as exc:
        key = sha256(message.content).hexdigest()
        _mark_failed(reports, key, exc.code, message.dequeue_count, now)
        queue.delete(message)
        return {'status': 'rejected', 'code': exc.code, 'key': key}
    rh = request.request_hash
    if reports.exists(report_name(rh)):
        queue.delete(message)
        return {'status': 'already_reported', 'request_hash': rh}
    if message.dequeue_count > MAX_DEQUEUE:
        _mark_failed(reports, rh, 'poison_message', message.dequeue_count, now)
        queue.delete(message)
        return {'status': 'poison', 'request_hash': rh}
    try:
        grant, grant_sha256 = check_envelope(request, binding, now=now)
    except EnvelopeRefused as exc:
        _mark_failed(reports, rh, exc.code, message.dequeue_count, now)
        queue.delete(message)
        return {'status': 'rejected', 'code': exc.code, 'request_hash': rh}
    report = crew_runner(request, grant, grant_sha256)
    if report.source.request_hash != rh or not verify_report(report):
        raise RuntimeError('Crew report does not match its request')
    created = reports.create(report_name(rh), report.model_dump_json(indent=1).encode())
    queue.delete(message)
    return {'status': 'reported' if created else 'already_reported', 'request_hash': rh,
            'provenance': report.provenance, 'total_cost': str(report.total_cost)}


async def run_cloud_crew(request: CrewRequest, grant: CrewGrant, grant_sha256: str, *, binding: CrewBinding,
                         ledger_store, token: Callable[[], str], now=time.time, tracer=None) -> CrewReport:
    """The unchanged crew workflow over the blob ledger and an Entra bearer token."""
    from .agents import CrewAgents, SendGate, bounded_client, chat_client
    from .tracing import setup_tracing
    from .workflow import CrewRuntime, run_crew
    ledger = BlobLedger(ledger_store, grant, grant_sha256, now=now)
    gate = SendGate(ledger)
    tracer = tracer or setup_tracing()
    client = None
    try:
        client = bounded_client(binding, token(), gate)
        runtime = CrewRuntime(pack=request.fact_pack, locale=request.locale, binding=binding, grant=grant,
                              grant_sha256=grant_sha256, ledger=ledger, gate=gate,
                              agents=CrewAgents(chat_client(binding, client)), tracer=tracer)
        return await run_crew(runtime)
    finally:
        if client is not None:
            await client.close()
        tracer.shutdown()


def azure_clients(account: str, credential):
    from azure.storage.blob import ContainerClient
    from azure.storage.queue import QueueClient
    blob_url = f'https://{account}.blob.core.windows.net'
    return (AzureQueue(QueueClient(f'https://{account}.queue.core.windows.net', QUEUE, credential=credential)),
            AzureBlobStore(ContainerClient(blob_url, REPORTS, credential=credential)),
            AzureBlobStore(ContainerClient(blob_url, LEDGER, credential=credential)))


def job_main(account: str) -> int:
    # Import the whole crew first: a broken image fails here, before any message is touched.
    from . import workflow  # noqa: F401
    from azure.identity import DefaultAzureCredential
    from .agents import entra_token
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    queue, reports, ledger_store = azure_clients(account, credential)
    binding = default_binding()

    def runner(request, grant, grant_sha256):
        return asyncio.run(run_cloud_crew(request, grant, grant_sha256, binding=binding, ledger_store=ledger_store,
                                          token=lambda: entra_token(credential)))
    try:
        status = run_job_once(queue=queue, reports=reports, binding=binding, crew_runner=runner)
    except Exception as exc:
        print(json.dumps({'status': 'stopped', 'error': type(exc).__name__}), flush=True)
        return 1
    print(json.dumps(status), flush=True)
    return 0


# ---- fetch on the server: never trust the cloud ----------------------------------------------------

class FetchRejected(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def revalidate(raw: bytes, pack: FactPack, locale: str, binding: CrewBinding) -> CrewReport:
    from ..chronicles.azure.validation import locate_all_rejections, validate_draft
    from ..chronicles.render import render_chronicle
    from .agents import fallback_selection
    from .checks import coverage_failures, name_failures
    if len(raw) > MAX_REPORT_BYTES:
        raise FetchRejected('report_too_large')
    try:
        report = CrewReport.model_validate_json(raw)
    except ValueError:
        raise FetchRejected('report_invalid') from None
    if not verify_report(report):
        raise FetchRejected('report_seal')
    src, fact_hash = report.source, fact_pack_hash(pack)
    expected = {'request_hash': request_hash(fact_hash, locale, binding), 'fact_hash': fact_hash,
                'trace_hash': pack.trace_hash, 'engine': pack.engine, 'dataset_version': pack.dataset_version,
                'binding_hash': digest(binding)}
    if any(getattr(src, k) != v for k, v in expected.items()) or report.locale != locale:
        raise FetchRejected('report_source')
    if any(report.versions.get(k) != v for k, v in crew_versions().items()):
        raise FetchRejected('report_versions')
    if report.total_cost != sum((s.cost for s in report.steps), Decimal(0)):
        raise FetchRejected('report_cost')
    if sum(1 for s in report.steps if s.role in LLM_ROLES) > CALLS_PER_REPORT:
        raise FetchRejected('report_calls')
    if report.draft is not None:
        failures = (locate_all_rejections(pack, report.draft, locale) + name_failures(pack, report.draft, set())
                    + coverage_failures(pack, report.draft))
        if failures:
            raise FetchRejected('draft_fails_verifier')
        if report.coverage_notes != validate_draft(pack, report.draft, locale).coverage_notes:
            raise FetchRejected('coverage_notes')
    elif report.fallback_text != render_chronicle(pack, fallback_selection(pack), locale) or report.coverage_notes:
        raise FetchRejected('fallback_text')
    return report


def fetch(*, pack: FactPack, locale: str, reports, out_dir: Path, binding: CrewBinding) -> dict:
    rh = request_hash(fact_pack_hash(pack), locale, binding)
    raw = reports.get(report_name(rh))
    if raw is None:
        failed = reports.get(failed_name(rh))
        if failed is None:
            return {'status': 'pending', 'request_hash': rh}
        try:
            code = json.loads(failed).get('code')
        except (ValueError, AttributeError):
            code = None
        return {'status': 'failed', 'request_hash': rh,
                'code': code if isinstance(code, str) and _CODE.match(code) else 'unknown'}
    report = revalidate(raw, pack, locale, binding)
    body = gzip.compress(report.model_dump_json(indent=1).encode(), compresslevel=9, mtime=0)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f'{rh}.json.gz'
    _replace(out_dir / name, body)
    index_path = out_dir / 'index.json'
    index = json.loads(index_path.read_bytes()) if index_path.exists() else {'version': INDEX_VERSION, 'reports': {}}
    if index.get('version') != INDEX_VERSION:
        raise FetchRejected('index_version')
    index['reports'][rh] = {'file': name, 'sha256': sha256(body).hexdigest(), 'bytes': len(body), 'locale': locale,
                            'fact_hash': report.source.fact_hash, 'trace_hash': report.source.trace_hash,
                            'home': pack.home_name, 'away': pack.away_name, 'score': list(pack.score),
                            'provenance': report.provenance, 'report_sha256': report.report_sha256,
                            'total_cost': str(report.total_cost)}
    _replace(index_path, json.dumps(index, indent=1, sort_keys=True, ensure_ascii=False).encode())
    return {'status': 'fetched', 'request_hash': rh, 'provenance': report.provenance, 'file': name,
            'report_sha256': report.report_sha256}


def _replace(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, path)


# ---- CLI ---------------------------------------------------------------------------------------------

def _sas(path) -> str:
    from .agents import read_credential
    return read_credential(Path(path)).lstrip('?')


def add_cloud_commands(sub) -> None:
    enq = sub.add_parser('enqueue', help='Queue one crew request for the cloud job (server side; no model call here)')
    enq.add_argument('--local', required=True, metavar='SOURCE', help='TimePitch replay or frozen FactPack JSON')
    enq.add_argument('locale', choices=['en', 'es'])
    enq.add_argument('--envelope', required=True, help='Private CrewGrant JSON file (purpose crew)')
    enq.add_argument('--envelope-sha256')
    enq.add_argument('--queue-sas', required=True, help='Private file with an add-only SAS for the queue')
    enq.add_argument('--account', default=ACCOUNT)
    job = sub.add_parser('job', help='Container Apps Job entrypoint: process at most one queued request')
    job.add_argument('--account', default=os.environ.get(ACCOUNT_ENV, ACCOUNT))
    fet = sub.add_parser('fetch', help='Download and re-validate a cloud report, then write .json.gz + index')
    fet.add_argument('--local', required=True, metavar='SOURCE')
    fet.add_argument('locale', choices=['en', 'es'])
    fet.add_argument('--reports-sas', required=True, help='Private file with a read/list SAS for reports')
    fet.add_argument('--out-dir', required=True)
    fet.add_argument('--account', default=ACCOUNT)


def run_cloud_command(args) -> int:
    from .cli import load_source
    from .ledger import _private_file
    binding = default_binding()
    if args.command == 'job':
        return job_main(args.account)
    try:
        pack = load_source(Path(args.local))
        if args.command == 'enqueue':
            from azure.storage.queue import QueueClient
            raw = _private_file(Path(args.envelope), MAX_ENVELOPE_BYTES)
            body, rh = build_request(pack, args.locale, raw, binding, expected_sha256=args.envelope_sha256)
            AzureQueue(QueueClient(f'https://{args.account}.queue.core.windows.net', QUEUE,
                                   credential=_sas(args.queue_sas))).send(body)
            print(json.dumps({'status': 'queued', 'request_hash': rh, 'bytes': len(body)}))
            return 0
        from azure.storage.blob import ContainerClient
        reports = AzureBlobStore(ContainerClient(f'https://{args.account}.blob.core.windows.net', REPORTS,
                                                 credential=_sas(args.reports_sas)))
        result = fetch(pack=pack, locale=args.locale, reports=reports, out_dir=Path(args.out_dir), binding=binding)
        print(json.dumps(result))
        return 0 if result['status'] in ('fetched', 'pending') else 3
    except EnvelopeRefused as exc:
        print('Refused by envelope: ' + exc.code, file=sys.stderr)
        return 2
    except FetchRejected as exc:
        print('Cloud report rejected locally: ' + exc.code, file=sys.stderr)
        return 3
