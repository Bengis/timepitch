"""crew-writer-6 / crew-verifier-4 / crew-analyst-2: no judgement verbs, coverage is server-owned, no possessives
on names, a pack-built capitalisation example; and the twelve real drafts replayed offline."""
from hashlib import sha256
import json
from pathlib import Path

import pytest

from crew_fixtures import LIVELY, PLAN, Harness, offline, reply, tp229_pack  # noqa: F401
from timepitch.chronicles.azure.models import ChronicleDraft
from timepitch.chronicles.models import FactPack
from timepitch.crew.agents import (ALLOWED_VERBS, JUDGEMENT_VERBS, analyst_schema, capitals_example, parse_plan,
                                   verify, writer_instructions)
from timepitch.crew.checks import coverage_failures, fix_citations, possessive_failure
from timepitch.crew.models import CrewPlan, Draft
from timepitch.crew.workflow import run_crew

FIXTURES = Path(__file__).parent / 'fixtures' / 'crew'
RESEARCH = Path(__file__).resolve().parents[2] / 'research' / 'engine-evaluation' / '2026-10-24-azure-chronicle-staging'
BLACKBURN = 'tp229-blackburn-united-factpack.json'
ARSENAL = 'tp230-arsenal-mancity-43-factpack.json'


def pack(name):
    return FactPack.model_validate_json((FIXTURES / name).read_bytes())


def without_coverage(plan):
    paragraphs = [[i for i in p if i != 'coverage'] for p in plan['paragraphs']]
    return {'angle': plan['angle'], 'paragraphs': [p for p in paragraphs if p]}


def real_runs():
    def outputs(name):
        runs = json.loads((FIXTURES / name).read_text(encoding='utf-8'))
        return [{k: v['output'] for k, v in run.items() if k != 'request_hash'} for run in runs]
    c, d = outputs('tp230c-model-outputs.json'), outputs('tp230d-model-outputs.json')
    b = [json.loads((FIXTURES / f'tp230b-{n}-receipts.json').read_text(encoding='utf-8'))
         for n in ('blackburn-united', 'arsenal-mancity-43')]
    return [('tp230b', BLACKBURN, b[0]), ('tp230b', ARSENAL, b[1]), ('tp230c', BLACKBURN, c[0]),
            ('tp230c', ARSENAL, c[1]), ('tp230d', BLACKBURN, d[0]), ('tp230d', ARSENAL, d[1])]


# ---- verbs ------------------------------------------------------------------------------------

@pytest.mark.parametrize('locale', ['en', 'es'])
def test_no_effort_or_judgement_verb_is_allowed(locale):
    assert not set(ALLOWED_VERBS[locale]) & set(JUDGEMENT_VERBS[locale])
    assert 'holds on' not in ALLOWED_VERBS['en'] and 'seals' not in ALLOWED_VERBS['en']
    for verb in JUDGEMENT_VERBS[locale]:
        assert verb not in writer_instructions(locale).split('Allowed lively verbs:')[1].split('Never use')[0]


# ---- capitalisation example from the pack ------------------------------------------------------

def test_capitals_example_uses_the_pack_names():
    assert capitals_example(pack(BLACKBURN)) == "Steven N'Zonzi strikes for Blackburn Rovers against Manchester United."
    assert capitals_example(pack(ARSENAL)) == 'Gilberto Silva strikes for Arsenal against Manchester City.'
    other = tp229_pack().model_copy(update={'home_name': 'Leeds United', 'away_name': 'Aston Villa'}, deep=True)
    assert capitals_example(other) == "Steven N'Zonzi strikes for Leeds United against Aston Villa."
    no_goals = other.model_copy(update={'facts': [f for f in other.facts if f.kind != 'goal']}, deep=True)
    assert capitals_example(no_goals) == 'Leeds United meet Aston Villa.'
    assert 'Capitalisation example (style only, not a fact to reuse): "Steven N\'Zonzi strikes' in writer_instructions(
        'en', pack(BLACKBURN))


# ---- coverage is server-owned ------------------------------------------------------------------

def test_analyst_cannot_plan_coverage():
    p = pack(ARSENAL)
    assert 'coverage' not in analyst_schema(p)['properties']['paragraphs']['items']['items']['enum']
    with pytest.raises(ValueError, match='coverage'):
        parse_plan(p, json.dumps({'angle': 'goal_fest', 'paragraphs': [['coverage'], ['leader:goals']]}))


def test_coverage_words_or_citation_are_rejected_in_prose():
    p = pack(BLACKBURN)
    def draft(text, ids):
        return ChronicleDraft.model_validate({'headline': {'text': 'Blackburn Rovers edge Manchester United 1–0',
            'fact_ids': ['result']}, 'paragraphs': [{'sentences': [{'text': text, 'fact_ids': ids}]},
            {'sentences': [{'text': "Steven N'Zonzi strikes at 27:14.", 'fact_ids': ['goal:grf:134']}]}]})
    assert coverage_failures(p, draft('Blackburn Rovers edge it in a fully covered match.', ['result'])) == [
        ('coverage_in_prose', 'p1s1')]
    assert coverage_failures(p, draft('Blackburn Rovers edge it 1–0.', ['result', 'coverage'])) == [
        ('coverage_in_prose', 'p1s1')]
    assert coverage_failures(p, draft('Blackburn Rovers edge it 1–0.', ['result'])) == []


def test_accepted_ai_draft_carries_server_coverage_line(offline, tmp_path):
    offline([reply(PLAN), reply(LIVELY)])
    h = Harness(tmp_path)

    async def go():
        try:
            return await run_crew(h.runtime())
        finally:
            await h.close()
    report = offline.run(go())
    assert report.provenance == 'crew_ai_draft_checked' and report.report_version == 'crew-report-2'
    assert report.coverage_notes == ['The chronicle uses recorded facts from a simulation.']


# ---- possessives on full names -----------------------------------------------------------------

@pytest.mark.parametrize('text,bad', [("Arsenal's lead grows.", True), ('Manchester United’s shots.', True),
                                      ("Steven N'Zonzi's strike.", True), ('Goals for Arsenal.', False)])
def test_possessive_on_a_full_recorded_name(text, bad):
    names = pack(ARSENAL) if 'Arsenal' in text else pack(BLACKBURN)
    assert possessive_failure(names, text) is bad


# ---- the published draft stays as published; the twelve real drafts ---------------------------

def test_published_tp230d_blackburn_report_is_untouched_but_would_now_be_rejected():
    raw = (RESEARCH / 'tp230d-crew-report-blackburn-united-en.json').read_bytes()
    assert sha256(raw).hexdigest() == '2e17dec0188bfecc7de1b45bbed6f58b2e22f36b027429faf642f78e1133b313'
    report = json.loads(raw)
    assert report['provenance'] == 'crew_ai_draft_checked' and report['report_version'] == 'crew-report-1'
    p, run = pack(BLACKBURN), real_runs()[4][2]
    plan = CrewPlan.model_validate(without_coverage(run['analyst']))
    verdict = verify(p, plan, Draft(attempt=2, draft=ChronicleDraft.model_validate(report['draft'])), 'en')
    assert verdict.decision == 'fallback'
    assert {f.code for f in verdict.failures} == {'coverage_in_prose', 'unplanned_fact'}  # "fully covered match"


def outcome(name, run, step):
    p = pack(name)
    plan = CrewPlan.model_validate(without_coverage(run['analyst']))
    attempt = 1 if step == 'writer' else 2
    draft = Draft(attempt=attempt, draft=ChronicleDraft.model_validate(run[step]))
    verdict = verify(p, plan, draft, 'en')
    if verdict.decision == 'fix':
        fixed, _ = fix_citations(p, plan, draft.draft, [(f.code, f.location) for f in verdict.failures])
        return 'fixer+' + verify(p, plan, Draft(attempt=attempt, draft=fixed, fixed=True), 'en').decision
    return verdict.decision


def test_twelve_real_drafts_under_verifier_four():
    table = {(tag, name, step): outcome(name, run, step)
             for tag, name, run in real_runs() for step in ('writer', 'writer_revision')}
    assert sum(v.endswith('accept') for v in table.values()) == 0
    assert table[('tp230d', BLACKBURN, 'writer_revision')] == 'fallback'  # the one draft published live
    assert table[('tp230c', BLACKBURN, 'writer')] == 'fixer+revise'
