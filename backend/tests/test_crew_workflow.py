"""Crew workflow through Agent Framework with a scripted fake Azure endpoint; no network."""
import json

import pytest

from crew_fixtures import CANARY, CANARY_HARD, FIXED, LIVELY, PLAN, Harness, intents, offline, receipts, reply, tp229_pack  # noqa: F401
from timepitch.chronicles.azure.models import VALIDATOR_VERSION, ChronicleDraft
from timepitch.chronicles.azure.validation import DraftRejected, locate_rejection, validate_draft
from timepitch.crew.fallback import crew_fallback_text
from timepitch.crew.agents import LIVELY_STYLE, PROPER_NOUN_RULE, analyst_schema
from timepitch.crew.models import verify_report
from timepitch.crew.workflow import run_crew


def run(offline, harness, **kw):
    async def go():
        try:
            return await run_crew(harness.runtime(**kw))
        finally:
            await harness.close()
    return offline.run(go())


def codes(report):
    return [(s.role, s.code) for s in report.steps]


def user_payload(body):
    return json.loads(body['input'][0]['content'][0]['text'])


def test_locate_rejection_finds_tp229_headline():
    pack = tp229_pack()
    canary = ChronicleDraft.model_validate(CANARY)
    with pytest.raises(DraftRejected) as exc:
        validate_draft(pack, canary, 'en')
    assert exc.value.code == 'uncited_entity'
    assert locate_rejection(pack, canary, 'en') == ('uncited_entity', 'headline')
    assert locate_rejection(pack, ChronicleDraft.model_validate(FIXED), 'en') is None
    bad_p2 = json.loads(json.dumps(FIXED))
    bad_p2['paragraphs'][1]['sentences'][0]['text'] = 'Blackburn Rovers recorded 9 shots and Manchester United had 5.'
    assert locate_rejection(pack, ChronicleDraft.model_validate(bad_p2), 'en') == ('unsupported_number', 'p2s1')
    assert VALIDATOR_VERSION == 'azure-prose-checks-1'


def test_lively_but_fully_cited_draft_passes_the_validator():
    checked = validate_draft(tp229_pack(), ChronicleDraft.model_validate(LIVELY), 'en')
    assert checked.semantic_verified is False and len(checked.evidence) == 4


def test_lively_draft_is_accepted_by_the_crew_first_time(offline, tmp_path):
    fake = offline([reply(PLAN), reply(LIVELY)])
    report = run(offline, Harness(tmp_path))
    assert report.provenance == 'crew_ai_draft_checked' and report.draft == ChronicleDraft.model_validate(LIVELY)
    assert len(fake.requests) == 2


def test_analyst_schema_is_fact_id_enums_without_numbers():
    pack = tp229_pack()
    schema = analyst_schema(pack)
    assert {'narrow_win', 'dominant_display', 'against_the_run_of_play', 'goal_fest', 'stalemate'} <= set(
        schema['properties']['angle']['enum'])
    # crew-analyst-2: coverage is server-owned and never planned into prose.
    assert schema['properties']['paragraphs']['items']['items']['enum'] == [f.id for f in pack.facts if f.kind != 'coverage']
    assert 'number' not in json.dumps(schema) and 'integer' not in json.dumps(schema)


def test_tp229_headline_rejection_is_revised_then_accepted(offline, tmp_path):
    fake = offline([reply(PLAN), reply(CANARY_HARD), reply(FIXED, request_id='req-fixed')])
    h = Harness(tmp_path)
    report = run(offline, h)
    # The Fixer cites the goal for the headline name and result for the 1-0 in p1s1; the uncited statistic needs the Writer.
    # crew-fixer-2 first writes the names of p2s1 as recorded, with no model call.
    assert codes(report) == [('analyst', 'ok'), ('writer', 'ok'), ('fixer', 'fixed'), ('verifier', 'rejected'), ('fixer', 'fixed'),
                             ('verifier', 'rejected'), ('writer_revision', 'ok'), ('verifier', 'accepted'),
                             ('publisher', 'crew_ai_draft_checked')]
    assert report.steps[2].reason == 'names' and report.steps[2].fixes == ['p2s1:names']
    assert report.steps[4].fixes == ['headline+goal:grf:134', 'p1s1+result']
    rejected = report.steps[5]
    # After the Fixer cites the goal, the headline still names a statistic it does not cite: only the Writer can fix it.
    assert (rejected.reason, rejected.location) == ('unsupported_metric', 'headline')
    assert report.provenance == 'crew_ai_draft_checked' and report.semantic_verified is False
    assert report.draft == ChronicleDraft.model_validate(FIXED) and report.fallback_text is None
    assert verify_report(report)
    assert report.steps[6].request_id == 'req-fixed' and report.steps[6].model == 'gpt-4.1-mini'
    assert report.versions['agent-framework-core'] == '1.22.0' and report.versions['agent-framework-openai'] == '1.17.0'
    assert report.versions['writer_prompt'] == 'crew-writer-7'
    # Three real requests, all bounded, unstored and gated.
    assert len(fake.requests) == 3 == h.gate.admitted == h.gate.attempted == len(intents(h.ledger))
    assert all(b['max_output_tokens'] == 1024 and b['store'] is False and b['model'] == 'gpt-4.1-mini' for b in fake.requests)
    writer, revision = fake.requests[1], fake.requests[2]
    assert PROPER_NOUN_RULE in writer['instructions'] and LIVELY_STYLE in writer['instructions']
    planned = {f['id'] for f in user_payload(writer)['fact_pack']['facts']}
    assert planned == {'result', 'goal:grf:134', 'leader:goals', 'comparison:team_possession_pct', 'comparison:shots',
                       'comparison:pass_received', 'comparison:recoveries'}
    first = user_payload(revision)['revision_request']['failures'][0]
    assert (first['failed_check'], first['location'], first['sentence']) == ('unsupported_metric', 'headline', CANARY_HARD['headline']['text'])
    assert first['fix_options'] and first['rule']
    assert report.total_cost == sum(s.cost for s in report.steps) > 0


def test_second_rejection_goes_to_deterministic_fallback(offline, tmp_path):
    fake = offline([reply(PLAN), reply(CANARY_HARD), reply(CANARY_HARD)])
    h = Harness(tmp_path)
    report = run(offline, h)
    assert codes(report) == [('analyst', 'ok'), ('writer', 'ok'), ('fixer', 'fixed'), ('verifier', 'rejected'), ('fixer', 'fixed'),
                             ('verifier', 'rejected'), ('writer_revision', 'ok'), ('fixer', 'fixed'), ('verifier', 'rejected'),
                             ('fixer', 'fixed'), ('verifier', 'rejected'), ('publisher', 'deterministic_fallback')]
    assert report.provenance == 'deterministic_fallback' and report.draft is None
    assert report.fallback_text == crew_fallback_text(tp229_pack(), 'en')
    assert len(fake.requests) == 3  # never a fourth call
    assert verify_report(report)


@pytest.mark.parametrize('model', ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14'])
def test_exactly_two_model_strings_are_accepted(offline, tmp_path, model):
    fake = offline([reply(PLAN, model=model), reply(FIXED, model=model)])
    report = run(offline, Harness(tmp_path))
    assert report.provenance == 'crew_ai_draft_checked' and len(fake.requests) == 2
    assert report.steps[0].model == model


@pytest.mark.parametrize('model', ['gpt-4.1-mini-2025-04-15', 'GPT-4.1-mini', 'gpt-4.1-mini-2025'])
def test_near_miss_model_strings_still_fail(offline, tmp_path, model):
    offline([reply(PLAN, model=model)])
    report = run(offline, Harness(tmp_path))
    assert codes(report) == [('analyst', 'model_mismatch'), ('publisher', 'deterministic_fallback')]


def test_wrong_model_fails_the_step_and_falls_back(offline, tmp_path):
    fake = offline([reply(PLAN, model='gpt-4.1')])
    h = Harness(tmp_path)
    report = run(offline, h)
    assert codes(report) == [('analyst', 'model_mismatch'), ('publisher', 'deterministic_fallback')]
    assert len(fake.requests) == 1
    assert receipts(h.ledger) == [('analyst', 'model_mismatch')]
    assert report.steps[0].cost > 0  # the send happened and is charged


def test_provider_error_is_charged_at_reservation_and_not_retried(offline, tmp_path):
    fake = offline([reply(PLAN), 'http_500'])
    h = Harness(tmp_path)
    report = run(offline, h)
    assert codes(report) == [('analyst', 'ok'), ('writer', 'provider_error'), ('publisher', 'deterministic_fallback')]
    assert len(fake.requests) == 2
    assert report.steps[1].cost == report.steps[1].reserved > 0


def test_httpx_gate_counts_every_real_request(offline, tmp_path):
    fake = offline([reply(PLAN), reply(FIXED)])
    h = Harness(tmp_path)

    async def go():
        try:
            report = await run_crew(h.runtime())
            # A request outside any armed step is counted and refused before the transport.
            with pytest.raises(Exception):
                await h.client.responses.create(model='gpt-4.1-mini', input='unarmed')
            return report
        finally:
            await h.close()
    report = offline.run(go())
    assert report.provenance == 'crew_ai_draft_checked'
    assert len(fake.requests) == 2 == h.gate.admitted
    assert h.gate.attempted == 3
    assert [r[0] for r in intents(h.ledger)] == ['analyst', 'writer']
