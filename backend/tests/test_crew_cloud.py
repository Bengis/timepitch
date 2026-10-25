"""Cloud-native crew (TP233) with fake queue/blob clients and the scripted fake Azure endpoint; no network."""
from decimal import Decimal
import gzip
from hashlib import sha256
import json

import pytest

from crew_fixtures import LIVELY, NOW, PLAN, grant, offline, reply, tp229_pack  # noqa: F401
from timepitch.chronicles.models import fact_pack_hash
from timepitch.crew.agents import ENTRA_SCOPE, entra_token
from timepitch.crew.cloud import (BlobLedger, FetchRejected, QueuedMessage, build_request, failed_name, fetch,
                                  parse_request, report_name, revalidate, run_cloud_crew, run_job_once)
from timepitch.crew.ledger import EnvelopeRefused
from timepitch.crew.models import CrewReport, default_binding, request_hash, seal_report

BINDING = default_binding()


def now():
    return NOW


class FakeStore:
    def __init__(self):
        self.blobs = {}
        self.refused_creates = []

    def get(self, name):
        return self.blobs.get(name)

    def create(self, name, data):
        if name in self.blobs:
            self.refused_creates.append(name)
            return False
        self.blobs[name] = bytes(data)
        return True

    def exists(self, name):
        return name in self.blobs

    def names(self, prefix=''):
        return sorted(n for n in self.blobs if n.startswith(prefix))


class FakeQueue:
    """Visibility-timeout queue: a received message is hidden until deleted or 'redelivered'."""

    def __init__(self):
        self.visible, self.hidden, self.deleted, self.timeouts = [], {}, [], []
        self.counter = 0

    def put(self, body: bytes, dequeue_count=0):
        self.counter += 1
        self.visible.append([str(self.counter), body, dequeue_count])

    def receive(self, visibility_timeout):
        self.timeouts.append(visibility_timeout)
        if not self.visible:
            return None
        item = self.visible.pop(0)
        item[2] += 1
        self.hidden[item[0]] = item
        return QueuedMessage(item[0], 'pop-' + item[0], item[2], item[1])

    def delete(self, message):
        self.deleted.append(self.hidden.pop(message.id)[0])

    def redeliver(self):
        self.visible.extend(self.hidden.values())
        self.hidden.clear()


def envelope(**changes) -> bytes:
    return grant(**changes).model_dump_json().encode()


def message(locale='en', **changes) -> bytes:
    body, _ = build_request(tp229_pack(), locale, envelope(**changes), BINDING, now=now)
    return body


def rh(locale='en'):
    return request_hash(fact_pack_hash(tp229_pack()), locale, BINDING)


class Never:
    calls = 0

    def __call__(self, *args):
        self.calls += 1
        pytest.fail('The crew must not run for this message')


def crew_runner(offline, ledger_store, script):
    fake = offline(script)

    def run(request, g, g_sha):
        return offline.run(run_cloud_crew(request, g, g_sha, binding=BINDING, ledger_store=ledger_store,
                                          token=lambda: 'synthetic-entra-token', now=now))
    return run, fake


# ---- job: queue handling before any call ------------------------------------------------------------

def test_empty_queue_exits_without_work():
    queue, reports = FakeQueue(), FakeStore()
    assert run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=Never(), now=now) == {'status': 'empty'}
    assert queue.timeouts == [600] and reports.blobs == {}


def test_existing_report_deletes_message_without_spend():
    queue, reports, runner = FakeQueue(), FakeStore(), Never()
    reports.blobs[report_name(rh())] = b'{}'
    queue.put(message())
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=runner, now=now)
    assert status == {'status': 'already_reported', 'request_hash': rh()}
    assert queue.deleted == ['1'] and runner.calls == 0 and list(reports.blobs) == [report_name(rh())]


def test_poison_message_is_failed_without_calls():
    queue, reports = FakeQueue(), FakeStore()
    queue.put(message(), dequeue_count=2)  # third delivery
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=Never(), now=now)
    assert status == {'status': 'poison', 'request_hash': rh()}
    assert json.loads(reports.blobs[failed_name(rh())])['code'] == 'poison_message' and queue.deleted == ['1']


def test_second_delivery_is_still_allowed():
    queue, reports = FakeQueue(), FakeStore()
    queue.put(message(), dequeue_count=1)
    called = []

    def runner(*args):
        called.append(args)
        raise RuntimeError('synthetic crash')
    with pytest.raises(RuntimeError):
        run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=runner, now=now)
    assert len(called) == 1 and queue.deleted == [] and '1' in queue.hidden  # stays for a later delivery


@pytest.mark.parametrize('body, code', [
    (b'not json', 'request_invalid'),
    (b'{"request_version":"crew-request-1"}', 'request_invalid'),
    (b'x' * (49 * 1024), 'request_too_large'),
], ids=['not_json', 'incomplete', 'too_large'])
def test_invalid_message_is_rejected_before_any_call(body, code):
    queue, reports = FakeQueue(), FakeStore()
    queue.put(body)
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=Never(), now=now)
    key = sha256(body).hexdigest()
    assert status == {'status': 'rejected', 'code': code, 'key': key}
    assert json.loads(reports.blobs[failed_name(key)])['code'] == code and queue.deleted == ['1']


def test_tampered_fact_pack_breaks_the_request_hash():
    data = json.loads(message())
    data['fact_pack']['score'] = [0, 1]
    with pytest.raises(EnvelopeRefused) as exc:
        parse_request(json.dumps(data).encode(), BINDING)
    assert exc.value.code == 'request_hash_mismatch'


# ---- envelope enforcement --------------------------------------------------------------------------

@pytest.mark.parametrize('mutate, code', [
    (lambda d: d.update(envelope_sha256='0' * 64), 'envelope_hash_mismatch'),
    (lambda d: d.update(envelope=grant(expires_at=NOW - 1).model_dump_json(),
                        envelope_sha256=sha256(grant(expires_at=NOW - 1).model_dump_json().encode()).hexdigest()),
     'envelope_expired'),
    (lambda d: d.update(envelope=grant(purpose='evaluation').model_dump_json(),
                        envelope_sha256=sha256(grant(purpose='evaluation').model_dump_json().encode()).hexdigest()),
     'envelope_purpose'),
    (lambda d: d.update(envelope=grant(locales=['es']).model_dump_json(),
                        envelope_sha256=sha256(grant(locales=['es']).model_dump_json().encode()).hexdigest()),
     'locale_outside_envelope'),
    (lambda d: d.update(envelope=grant(binding_hash='a' * 64).model_dump_json(),
                        envelope_sha256=sha256(grant(binding_hash='a' * 64).model_dump_json().encode()).hexdigest()),
     'binding_mismatch'),
])
def test_job_enforces_the_envelope_before_any_call(mutate, code):
    data = json.loads(message())
    mutate(data)
    queue, reports = FakeQueue(), FakeStore()
    queue.put(json.dumps(data).encode())
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=Never(), now=now)
    assert status == {'status': 'rejected', 'code': code, 'request_hash': rh()}
    assert json.loads(reports.blobs[failed_name(rh())])['code'] == code and queue.deleted == ['1']


def test_enqueue_checks_the_envelope_locally():
    for changes, code in (({'purpose': 'evaluation'}, 'envelope_purpose'), ({'expires_at': NOW - 1}, 'envelope_expired'),
                          ({'locales': ['es']}, 'locale_outside_envelope')):
        with pytest.raises(EnvelopeRefused) as exc:
            build_request(tp229_pack(), 'en', envelope(**changes), BINDING, now=now)
        assert exc.value.code == code
    with pytest.raises(EnvelopeRefused) as exc:
        build_request(tp229_pack(), 'en', envelope(), BINDING, expected_sha256='0' * 64, now=now)
    assert exc.value.code == 'envelope_hash_mismatch'
    body, hashed = build_request(tp229_pack(), 'en', envelope(), BINDING, now=now)
    request = parse_request(body, BINDING)
    assert hashed == rh() and request.fact_pack == tp229_pack() and len(body) < 48 * 1024
    assert body.isascii()


# ---- full job with the fake model endpoint -------------------------------------------------------

def test_job_runs_the_crew_writes_once_and_deletes(offline):
    queue, reports, ledger = FakeQueue(), FakeStore(), FakeStore()
    runner, fake = crew_runner(offline, ledger, [reply(PLAN), reply(LIVELY)])
    queue.put(message())
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=runner, now=now)
    assert status['status'] == 'reported' and status['provenance'] == 'crew_ai_draft_checked'
    assert len(fake.requests) == 2 and queue.deleted == ['1']
    assert sorted(ledger.blobs) == [f'{rh()}/analyst/intent', f'{rh()}/analyst/receipt', f'{rh()}/report',
                                    f'{rh()}/writer/intent', f'{rh()}/writer/receipt']
    report = CrewReport.model_validate_json(reports.blobs[report_name(rh())])
    assert report.source.request_hash == rh() and str(report.total_cost) == status['total_cost']
    # Re-sent message: idempotent, no request, no ledger writes.
    queue.put(message())
    before = dict(ledger.blobs)
    assert run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=Never(), now=now)['status'] == 'already_reported'
    assert ledger.blobs == before and len(fake.requests) == 2


def test_conditional_create_keeps_the_first_report(offline):
    queue, reports, ledger = FakeQueue(), FakeStore(), FakeStore()
    runner, _ = crew_runner(offline, ledger, [reply(PLAN), reply(LIVELY)])
    queue.put(message())

    def racing(*args):
        report = runner(*args)
        reports.blobs[report_name(rh())] = b'first writer wins'
        return report
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=racing, now=now)
    assert status['status'] == 'already_reported' and reports.blobs[report_name(rh())] == b'first writer wins'
    assert reports.refused_creates == [report_name(rh())] and queue.deleted == ['1']


def test_redelivery_resumes_from_blob_ledger_without_resending(offline):
    ledger = FakeStore()
    runner, fake = crew_runner(offline, ledger, [reply(PLAN), reply(LIVELY)])
    request = parse_request(message(), BINDING)
    first = runner(request, grant(), sha256(envelope()).hexdigest())
    # The job died before writing the report: the next delivery replays both receipts for free.
    queue, reports = FakeQueue(), FakeStore()
    queue.put(message(), dequeue_count=1)
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=runner, now=now)
    again = CrewReport.model_validate_json(reports.blobs[report_name(rh())])
    assert status['status'] == 'reported' and len(fake.requests) == 2
    assert all(s.replayed for s in again.steps if s.role in ('analyst', 'writer'))
    assert again.draft == first.draft


def test_uncertain_send_is_charged_and_never_resent(offline):
    ledger = FakeStore()
    runner, fake = crew_runner(offline, ledger, [reply(PLAN), 'connect_error'])
    request = parse_request(message(), BINDING)
    report = runner(request, grant(), sha256(envelope()).hexdigest())
    assert report.provenance == 'deterministic_fallback' and len(fake.requests) == 2
    assert f'{rh()}/writer/intent' in ledger.blobs and f'{rh()}/writer/receipt' not in ledger.blobs
    g = grant()
    blob_ledger = BlobLedger(ledger, g, sha256(envelope()).hexdigest(), now=now)
    writer = blob_ledger.intent(rh(), 'writer')
    assert blob_ledger.exposure() == blob_ledger.receipt(rh(), 'analyst').cost + writer.reserved
    with pytest.raises(EnvelopeRefused) as exc:
        blob_ledger.reserve(rh(), 'writer', 1000)
    assert exc.value.code == 'step_already_sent'
    # Replaying the whole run sends nothing new.
    runner(request, g, sha256(envelope()).hexdigest())
    assert len(fake.requests) == 2


def test_blob_ledger_enforces_money_and_report_limits(offline):
    ledger = FakeStore()
    g = grant(money_limit=Decimal('0.000001'))
    runner, fake = crew_runner(offline, ledger, [])
    report = runner(parse_request(message(), BINDING), g, 'f' * 64)
    assert report.provenance == 'deterministic_fallback' and fake.requests == []
    assert report.steps[0].code == 'envelope_refused' and report.steps[0].reason == 'money_exhausted'
    one = BlobLedger(FakeStore(), grant(max_reports=1), 'f' * 64, now=now)
    one.reserve('a' * 64, 'analyst', 1000)
    with pytest.raises(EnvelopeRefused) as exc:
        one.reserve('b' * 64, 'analyst', 1000)
    assert exc.value.code == 'reports_exhausted'


# ---- fetch on the server -------------------------------------------------------------------------------

def _reported(offline):
    queue, reports, ledger = FakeQueue(), FakeStore(), FakeStore()
    runner, _ = crew_runner(offline, ledger, [reply(PLAN), reply(LIVELY)])
    queue.put(message())
    run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=runner, now=now)
    return reports


def test_fetch_revalidates_and_writes_gzip_and_index(offline, tmp_path):
    reports = _reported(offline)
    result = fetch(pack=tp229_pack(), locale='en', reports=reports, out_dir=tmp_path, binding=BINDING)
    assert result['status'] == 'fetched' and result['provenance'] == 'crew_ai_draft_checked'
    body = (tmp_path / f'{rh()}.json.gz').read_bytes()
    index = json.loads((tmp_path / 'index.json').read_bytes())
    entry = index['reports'][rh()]
    assert entry['sha256'] == sha256(body).hexdigest() and entry['bytes'] == len(body)
    assert CrewReport.model_validate_json(gzip.decompress(body)).report_sha256 == result['report_sha256']


def _tamper(raw: bytes, change, *, reseal=True) -> bytes:
    data = json.loads(raw)
    change(data)
    report = CrewReport.model_validate_json(json.dumps(data))
    return (seal_report(report) if reseal else report).model_dump_json().encode()


def _say_nine(d):
    d['draft']['paragraphs'][1]['sentences'][0]['text'] = d['draft']['paragraphs'][1]['sentences'][0]['text'].replace('7 to 5', '9 to 5')


@pytest.mark.parametrize('change, reseal, code', [
    (_say_nine, False, 'report_seal'),
    (_say_nine, True, 'draft_fails_verifier'),
    (lambda d: d['source'].update(fact_hash='0' * 64), True, 'report_source'),
    (lambda d: d.update(total_cost='0'), True, 'report_cost'),
    (lambda d: d['versions'].update(verifier='crew-verifier-0'), True, 'report_versions'),
    (lambda d: d.update(coverage_notes=['Trust me.']), True, 'coverage_notes'),
    (lambda d: d.update(draft=None, provenance='deterministic_fallback', coverage_notes=[], fallback_text='Made up.'),
     True, 'fallback_text'),
])
def test_fetch_rejects_a_tampered_report(offline, tmp_path, change, reseal, code):
    reports = _reported(offline)
    name = report_name(rh())
    reports.blobs[name] = _tamper(reports.blobs[name], change, reseal=reseal)
    with pytest.raises(FetchRejected) as exc:
        fetch(pack=tp229_pack(), locale='en', reports=reports, out_dir=tmp_path, binding=BINDING)
    assert exc.value.code == code
    assert list(tmp_path.iterdir()) == []


def test_fetch_reports_pending_and_failed(tmp_path):
    reports = FakeStore()
    assert fetch(pack=tp229_pack(), locale='en', reports=reports, out_dir=tmp_path, binding=BINDING)['status'] == 'pending'
    reports.blobs[failed_name(rh())] = json.dumps({'code': 'poison_message'}).encode()
    assert fetch(pack=tp229_pack(), locale='en', reports=reports, out_dir=tmp_path,
                 binding=BINDING) == {'status': 'failed', 'request_hash': rh(), 'code': 'poison_message'}
    reports.blobs[failed_name(rh())] = json.dumps({'code': '<script>'}).encode()
    assert fetch(pack=tp229_pack(), locale='en', reports=reports, out_dir=tmp_path, binding=BINDING)['code'] == 'unknown'


def test_revalidate_rejects_a_report_for_another_locale(offline):
    reports = _reported(offline)
    with pytest.raises(FetchRejected) as exc:
        revalidate(reports.blobs[report_name(rh())], tp229_pack(), 'es', BINDING)
    assert exc.value.code == 'report_source'


# ---- Entra auth ----------------------------------------------------------------------------------------

def test_entra_token_uses_the_cognitive_services_scope():
    class Credential:
        scopes = []

        def get_token(self, scope):
            self.scopes.append(scope)
            return type('T', (), {'token': 'eyJ.synthetic.token'})()
    credential = Credential()
    assert entra_token(credential) == 'eyJ.synthetic.token' and credential.scopes == [ENTRA_SCOPE]

    class Empty:
        def get_token(self, scope):
            return type('T', (), {'token': ''})()
    with pytest.raises(ValueError):
        entra_token(Empty())
