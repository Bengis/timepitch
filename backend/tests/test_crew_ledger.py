"""Crew envelope and write-ahead ledger: uncertain sends, free replay, exhaustion; no network."""
from decimal import Decimal
import json

import pytest

from crew_fixtures import CANARY, CANARY_HARD, FIXED, NOW, PLAN, Harness, grant, intents, offline, receipts, reply, tp229_pack  # noqa: F401
from timepitch.chronicles.azure.budget import maximum_liability
from timepitch.crew import cli
from timepitch.crew.ledger import (CONTEXT_CEILING_TOKENS, CrewLedger, EnvelopeRefused, call_reservation,
                                   input_upper_crew_bytes_1, load_grant)
from timepitch.crew.models import CrewBinding, default_binding, default_tariff
from timepitch.crew.workflow import run_crew


def run(offline, h, **kw):
    async def go():
        try:
            return await run_crew(h.runtime(**kw))
        finally:
            await h.close()
    return offline.run(go())


def codes(report):
    return [(s.role, s.code) for s in report.steps]


def test_input_bound_is_versioned_and_swappable():
    assert input_upper_crew_bytes_1(1000) == 3024
    assert input_upper_crew_bytes_1(24576) == 2 * 24576 + 1024
    with pytest.raises(EnvelopeRefused, match='request_too_large'):
        input_upper_crew_bytes_1(24577)
    upper, reserved = call_reservation(grant(), 10000)
    assert upper == 21024 and reserved == maximum_liability(default_tariff(), 21024, 1024) == Decimal('0.010048')
    upper, reserved = call_reservation(grant(input_bound='context-ceiling-1047576'), 10000)
    assert upper == CONTEXT_CEILING_TOKENS == 1_047_576 and reserved == Decimal('0.420669')
    with pytest.raises(EnvelopeRefused, match='request_too_large'):
        call_reservation(grant(input_bound='context-ceiling-1047576'), 24577)


def test_uncertain_send_is_charged_at_reservation_and_never_resent(offline, tmp_path):
    first = offline([reply(PLAN), 'connect_error'])
    h = Harness(tmp_path)
    report = run(offline, h)
    assert codes(report) == [('analyst', 'ok'), ('writer', 'uncertain_send'), ('publisher', 'deterministic_fallback')]
    writer = report.steps[1]
    assert writer.cost == writer.reserved > 0
    assert len(first.requests) == 2
    assert [r[0] for r in intents(h.ledger)] == ['analyst', 'writer']
    assert receipts(h.ledger) == [('analyst', None)]
    analyst_cost = report.steps[0].cost
    assert h.ledger.exposure() == analyst_cost + writer.reserved
    # Resume: the analyst replays free; the receipt-less writer intent is never resent.
    second = offline([])
    resumed = Harness(tmp_path)
    again = run(offline, resumed)
    assert codes(again) == [('analyst', 'replayed'), ('writer', 'uncertain_send'), ('publisher', 'deterministic_fallback')]
    assert second.requests == [] and resumed.gate.attempted == 0
    assert resumed.ledger.exposure() == analyst_cost + writer.reserved
    assert again.fallback_text == report.fallback_text


def test_resume_replays_receipts_at_no_cost(offline, tmp_path):
    # A previous process recorded the analyst's receipt and stopped.
    seed = Harness(tmp_path)
    rh = seed.runtime().request_hash
    seed.ledger.reserve(rh, 'analyst', 2000)
    seed.ledger.record_receipt(rh, 'analyst', model='gpt-4.1-mini', request_id='req-old', input_tokens=800,
                               output_tokens=60, cost=Decimal('0.000416'), output=json.dumps(PLAN), error=None)
    seed.ledger.close()
    fake = offline([reply(CANARY_HARD), reply(FIXED)])
    h = Harness(tmp_path)
    before = h.ledger.exposure()
    report = run(offline, h)
    assert codes(report)[:2] == [('analyst', 'replayed'), ('writer', 'ok')]
    assert report.steps[0].replayed and report.steps[0].request_id == 'req-old'
    assert report.provenance == 'crew_ai_draft_checked'
    assert len(fake.requests) == 2 and h.gate.admitted == 2  # writer + revision only
    assert h.ledger.exposure() - before == sum(s.cost for s in report.steps if s.role in ('writer', 'writer_revision'))
    # A full rerun of the finished report replays everything: zero requests, zero new exposure.
    nothing = offline([])
    final = Harness(tmp_path)
    exposure = final.ledger.exposure()
    rerun = run(offline, final)
    assert all(s.replayed for s in rerun.steps if s.role in ('analyst', 'writer', 'writer_revision'))
    assert rerun.draft == report.draft and nothing.requests == [] and final.ledger.exposure() == exposure


def test_envelope_reports_exhausted(offline, tmp_path):
    fake = offline([reply(PLAN), reply(FIXED)])
    h = Harness(tmp_path, grant(max_reports=1))
    assert run(offline, h).provenance == 'crew_ai_draft_checked'
    other = Harness(tmp_path, grant(max_reports=1))
    report = run(offline, other, locale='es')
    assert codes(report) == [('analyst', 'envelope_refused'), ('publisher', 'deterministic_fallback')]
    assert report.steps[0].reason == 'reports_exhausted' and report.steps[0].cost == 0
    assert len(fake.requests) == 2 and other.gate.attempted == 1 and other.gate.admitted == 0


def test_envelope_money_and_expiry_refuse_before_send(offline, tmp_path):
    fake = offline([])
    poor = Harness(tmp_path, grant(money_limit=Decimal('0.001')), ledger_name='poor.sqlite')
    report = run(offline, poor)
    assert report.steps[0].reason == 'money_exhausted' and report.provenance == 'deterministic_fallback'
    late = Harness(tmp_path, grant(), now=NOW + 7200, ledger_name='late.sqlite')
    report = run(offline, late)
    assert report.steps[0].reason == 'envelope_expired'
    assert fake.requests == [] and intents(poor.ledger) == [] and intents(late.ledger) == []


def test_calls_per_report_and_steps_are_never_reserved_twice(tmp_path):
    h = Harness(tmp_path)
    rh = 'a' * 64
    for step in ('analyst', 'writer', 'writer_revision'):
        h.ledger.reserve(rh, step, 1000)
    with pytest.raises(EnvelopeRefused, match='step_already_sent'):
        h.ledger.reserve(rh, 'writer', 1000)
    with pytest.raises(EnvelopeRefused, match='calls_exhausted'):
        h.ledger.reserve(rh, 'extra', 1000)


def test_private_envelope_file_is_checked(tmp_path):
    g = grant()
    path = tmp_path / 'envelope.json'
    path.write_bytes(g.model_dump_json().encode())
    path.chmod(0o600)
    loaded, digest = load_grant(path, default_binding(), now=lambda: NOW)
    assert loaded == g and len(digest) == 64
    assert load_grant(path, default_binding(), expected_sha256=digest, now=lambda: NOW)[1] == digest
    with pytest.raises(EnvelopeRefused, match='envelope_hash_mismatch'):
        load_grant(path, default_binding(), expected_sha256='0' * 64, now=lambda: NOW)
    with pytest.raises(EnvelopeRefused, match='envelope_expired'):
        load_grant(path, default_binding(), now=lambda: NOW + 7200)
    other = CrewBinding(id='x', version='1', endpoint='https://other.openai.azure.com/openai/v1/',
                        deployment='gpt-4.1-mini', expected_model='gpt-4.1-mini')
    with pytest.raises(EnvelopeRefused, match='binding_mismatch'):
        load_grant(path, other, now=lambda: NOW)
    CrewLedger(tmp_path / 'l.sqlite', g, digest).close()
    with pytest.raises(EnvelopeRefused, match='ledger_belongs_to_other_envelope'):
        CrewLedger(tmp_path / 'l.sqlite', g, 'f' * 64)


def test_cli_refuses_without_valid_envelope(tmp_path, monkeypatch, capsys):
    def forbidden(*args, **kwargs):
        raise AssertionError('No client may be built without a valid envelope')
    import timepitch.crew.agents as agents
    monkeypatch.setattr(agents, 'bounded_client', forbidden)
    source = tmp_path / 'pack.json'
    source.write_bytes(tp229_pack().model_dump_json().encode())
    assert cli.main(['run', '--local', str(source), 'en']) == 2
    bad = tmp_path / 'bad.json'
    bad.write_text('{"id": "x"}')
    bad.chmod(0o600)  # private, so the refusal is about the content
    args = ['run', '--local', str(source), 'en', '--envelope', str(bad), '--credential', str(tmp_path / 'key'),
            '--ledger', str(tmp_path / 'l.sqlite'), '--out', str(tmp_path / 'r.json')]
    assert cli.main(args) == 2
    assert 'envelope_invalid' in capsys.readouterr().err
    assert not (tmp_path / 'l.sqlite').exists() and not (tmp_path / 'r.json').exists()
