"""crew-verifier-3 names, the deterministic Fixer, guided revisions and revision_noop, replaying real drafts offline."""
import json
from pathlib import Path

import pytest

from crew_fixtures import Harness, offline, reply  # noqa: F401
from timepitch.chronicles.azure.models import ChronicleDraft
from timepitch.chronicles.azure.validation import locate_all_rejections
from timepitch.chronicles.models import FactPack
from timepitch.crew.agents import all_failures, verify, writer_instructions
from timepitch.crew.checks import fix_citations, name_failure, sentences
from timepitch.crew.models import CrewPlan, Draft, crew_versions
from timepitch.crew.workflow import run_crew

FIXTURES = Path(__file__).parent / 'fixtures' / 'crew'
MODEL = 'gpt-4.1-mini-2025-04-14'


def pack(name):
    return FactPack.model_validate_json((FIXTURES / name).read_bytes())


BLACKBURN = 'tp229-blackburn-united-factpack.json'
ARSENAL = 'tp230-arsenal-mancity-43-factpack.json'


def without_coverage(plan):
    paragraphs = [[i for i in p if i != 'coverage'] for p in plan['paragraphs']]
    return {'angle': plan['angle'], 'paragraphs': [p for p in paragraphs if p]}


def outputs(name):
    runs = json.loads((FIXTURES / name).read_text(encoding='utf-8'))
    # Plans from before crew-analyst-2 are replayed without coverage, as the live schema now requires.
    return [{**{k: v['output'] for k, v in run.items() if k != 'request_hash'},
             'analyst': without_coverage(run['analyst']['output'])} for run in runs]


def tp230c():
    return outputs('tp230c-model-outputs.json')


def tp230d():
    return outputs('tp230d-model-outputs.json')


def tp230b(name):
    run = json.loads((FIXTURES / f'tp230b-{name}-receipts.json').read_text(encoding='utf-8'))
    return {**run, 'analyst': without_coverage(run['analyst'])}


def real_drafts():
    c = tp230c()
    return [('tp230b', BLACKBURN, tp230b('blackburn-united')), ('tp230b', ARSENAL, tp230b('arsenal-mancity-43')),
            ('tp230c', BLACKBURN, c[0]), ('tp230c', ARSENAL, c[1])]


def gundogan():
    return next(f.player_names[0] for f in pack(ARSENAL).facts if f.id == 'goal:grf:9254')


def compliant_blackburn():
    """tp230c Blackburn after a compliant revision: recorded capitals, no shortened names; p1s1 keeps its 1–0."""
    return {'headline': {'text': "Steven N'Zonzi fires Blackburn Rovers to 1–0 win over Manchester United",
                         'fact_ids': ['goal:grf:134', 'result']},
        'paragraphs': [
            {'sentences': [{'text': "Steven N'Zonzi scores the only goal at 27:14 to give Blackburn Rovers a 1–0 victory "
                                    'against Manchester United.', 'fact_ids': ['goal:grf:134']}]},
            {'sentences': [{'text': "Steven N'Zonzi leads with one goal, while Paul Scholes, David Dunn, and Mauro Formica "
                                    'top pass receptions with six each.', 'fact_ids': ['leader:goals', 'leader:pass_received']},
                           {'text': 'David Dunn and Gael Givet share the highest recoveries at five each.',
                            'fact_ids': ['leader:recoveries']}]},
            {'sentences': [{'text': 'Blackburn Rovers take seven shots compared to the five of Manchester United and receive '
                                    '31 passes versus 27 for their opponents.',
                            'fact_ids': ['comparison:shots', 'comparison:pass_received']},
                           {'text': 'They also make 23 recoveries and hold 51.2% possession during the match.',
                            'fact_ids': ['comparison:recoveries', 'comparison:team_possession_pct']}]}]}


def compliant_arsenal():
    """tp230c Arsenal after a compliant revision: coverage sentence without statistic words, recorded names."""
    return {'headline': {'text': 'Arsenal fires six goals past Manchester City in a 6–1 win', 'fact_ids': ['result']},
        'paragraphs': [
            {'sentences': [{'text': f'Gilberto Silva opens the scoring for Arsenal at 06:49 before {gundogan()} pulls one '
                                    'back for Manchester City at 15:25.', 'fact_ids': ['goal:grf:4095', 'goal:grf:9254']},
                           {'text': 'Arsenal answers quickly as Lauren fires in a goal at 23:23, followed by Thierry Henry '
                                    'finishing at 26:09 to extend the lead.', 'fact_ids': ['goal:grf:14036', 'goal:grf:15691']}]},
            {'sentences': [{'text': 'Thierry Henry doubles his tally with a goal at 51:14, Robert Pires adds another at 75:16, '
                                    'and Gilberto Silva finishes the scoring at 83:58.',
                            'fact_ids': ['goal:grf:33003', 'goal:grf:47428', 'goal:grf:52641']},
                           {'text': 'Thierry Henry and Gilberto Silva lead the scoring for Arsenal with two goals each in '
                                    'this 6–1 victory over Manchester City.', 'fact_ids': ['leader:goals', 'result']}]}]}


# ---- names as recorded ------------------------------------------------------------------------

@pytest.mark.parametrize('text,bad', [
    ("Steven N'Zonzi strikes for Blackburn Rovers.", False),
    ("steven n'zonzi strikes for blackburn rovers.", True),
    ("N'Zonzi strikes for Blackburn Rovers.", True),
    ("n'zonzi strikes for Blackburn Rovers.", True),
    ("Blackburn's goal came from Steven N'Zonzi.", True),
    ('They take seven shots to the five of Manchester United.', False)])
def test_names_must_be_written_as_recorded(text, bad):
    assert name_failure(pack(BLACKBURN), text) is bad


def test_versions_and_writer_three_rules():
    versions = crew_versions()
    assert (versions['writer_prompt'], versions['verifier'], versions['fixer'], versions['analyst_prompt']) == (
        'crew-writer-7', 'crew-verifier-5', 'crew-fixer-3', 'crew-analyst-3')
    assert versions['validator'] == 'azure-prose-checks-1'
    text = writer_instructions('en')
    assert 'recorded capitals' in text and 'Never write a whole sentence in lowercase' in text


# ---- Fixer ------------------------------------------------------------------------------------

def test_fixer_only_adds_literal_citations():
    p, run = pack(BLACKBURN), tp230c()[0]
    plan, draft = CrewPlan.model_validate(run['analyst']), ChronicleDraft.model_validate(run['writer'])
    failures = all_failures(p, plan, draft, 'en')
    fixed, fixes = fix_citations(p, plan, draft, failures)
    assert fixes == ['p1s1+result']
    assert [s.text for _, s in sentences(fixed)] == [s.text for _, s in sentences(draft)]  # wording untouched
    assert dict(sentences(fixed))['p1s1'].fact_ids == ['goal:grf:134', 'result']
    assert ('unsupported_score', 'p1s1') not in locate_all_rejections(p, fixed, 'en')


def test_fixer_refuses_claims_without_literal_support():
    p, run = pack(ARSENAL), tp230b('arsenal-mancity-43')
    plan, draft = CrewPlan.model_validate(run['analyst']), ChronicleDraft.model_validate(run['writer'])
    fixed, fixes = fix_citations(p, plan, draft, all_failures(p, plan, draft, 'en'))
    # "3-1 lead before halftime" is a running score and "6:49" is not a recorded mm:ss clock: no citation can support them.
    assert fixes == ['p3s1+result']
    left = all_failures(p, plan, fixed, 'en')
    assert ('unsupported_score', 'p2s2') in left and ('unsupported_clock', 'p2s1') in left


def test_name_in_several_facts_cites_the_first():
    p = pack(BLACKBURN)
    plan = CrewPlan(angle='narrow_win', paragraphs=[['goal:grf:134', 'leader:goals'], ['comparison:shots']])
    draft = ChronicleDraft.model_validate({
        'headline': {'text': "Steven N'Zonzi strikes as Blackburn Rovers edge Manchester United 1–0", 'fact_ids': ['result']},
        'paragraphs': [{'sentences': [{'text': "Steven N'Zonzi scored for Blackburn Rovers at 27:14.", 'fact_ids': ['goal:grf:134']}]},
                       {'sentences': [{'text': 'Blackburn Rovers recorded 7 shots and Manchester United had 5.',
                                       'fact_ids': ['comparison:shots']}]}]})
    # crew-fixer-3: two planned facts name him (goal and goals leader); either one supports the name, so the first is
    # cited. The Verifier still checks the sentence again afterwards.
    assert fix_citations(p, plan, draft, all_failures(p, plan, draft, 'en'))[1] == ['headline+goal:grf:134']


# ---- expected acceptance of the eight real drafts ----------------------------------------------

def outcome(pack_name, run, step):
    p, plan = pack(pack_name), CrewPlan.model_validate(run['analyst'])
    attempt = 1 if step == 'writer' else 2
    draft = Draft(attempt=attempt, draft=ChronicleDraft.model_validate(run[step]))
    verdict = verify(p, plan, draft, 'en')
    if verdict.decision == 'fix':
        fixed, _ = fix_citations(p, plan, draft.draft, [(f.code, f.location) for f in verdict.failures])
        verdict = verify(p, plan, Draft(attempt=attempt, draft=fixed, fixed=True), 'en')
        return 'fixer+' + verdict.decision
    return verdict.decision


def test_expected_acceptance_of_the_real_drafts():
    table = {(tag, name, step): outcome(name, run, step)
             for tag, name, run in real_drafts() for step in ('writer', 'writer_revision')}
    # No real draft passes as written or through the Fixer alone; every first draft goes to a guided revision.
    assert table == {
        ('tp230b', BLACKBURN, 'writer'): 'revise', ('tp230b', BLACKBURN, 'writer_revision'): 'fallback',
        ('tp230b', ARSENAL, 'writer'): 'fixer+revise', ('tp230b', ARSENAL, 'writer_revision'): 'fixer+fallback',
        ('tp230c', BLACKBURN, 'writer'): 'fixer+revise', ('tp230c', BLACKBURN, 'writer_revision'): 'fixer+fallback',
        ('tp230c', ARSENAL, 'writer'): 'revise', ('tp230c', ARSENAL, 'writer_revision'): 'fallback'}


def test_tp230c_blackburn_would_pass_the_validator_after_the_fixer():
    # Under azure-prose-checks-1 alone (crew-verifier-2), the Fixer would have accepted tp230c Blackburn;
    # crew-verifier-3 rejects it only for the lowercase names.
    p, run = pack(BLACKBURN), tp230c()[0]
    plan, draft = CrewPlan.model_validate(run['analyst']), ChronicleDraft.model_validate(run['writer'])
    fixed, _ = fix_citations(p, plan, draft, all_failures(p, plan, draft, 'en'))
    assert locate_all_rejections(p, fixed, 'en') == []
    assert {c for c, _ in all_failures(p, plan, fixed, 'en')} == {'name_not_as_recorded'}


@pytest.mark.parametrize('make,name', [(compliant_blackburn, BLACKBURN), (compliant_arsenal, ARSENAL)])
def test_compliant_revisions_pass(make, name):
    run = tp230c()[0 if name == BLACKBURN else 1]
    p, plan = pack(name), CrewPlan.model_validate(run['analyst'])
    assert outcome(name, {**run, 'writer_revision': make()}, 'writer_revision') in ('accept', 'fixer+accept')


# ---- workflow replays with the fake client ----------------------------------------------------

def replay(offline, tmp_path, pack_name, script):
    fake = offline([reply(item, model=MODEL) for item in script])
    h = Harness(tmp_path)

    async def go():
        try:
            return await run_crew(h.runtime(pack=pack(pack_name)))
        finally:
            await h.close()
    return offline.run(go()), fake


def codes(report):
    return [(s.role, s.code) for s in report.steps]


def test_replay_tp230c_blackburn_fixer_then_guided_revision_accepts(offline, tmp_path):
    run = tp230c()[0]
    report, fake = replay(offline, tmp_path, BLACKBURN, [run['analyst'], run['writer'], compliant_blackburn()])
    # crew-fixer-2 restores the capitals of every full name; the lowercase short "n'zonzi" still needs the Writer.
    assert codes(report) == [('analyst', 'ok'), ('writer', 'ok'), ('fixer', 'fixed'), ('verifier', 'rejected'), ('fixer', 'fixed'),
                             ('verifier', 'rejected'), ('writer_revision', 'ok'), ('verifier', 'rejected'),
                             ('fixer', 'fixed'), ('verifier', 'accepted'), ('publisher', 'crew_ai_draft_checked')]
    assert report.steps[2].fixes == ['headline:names', 'p1s1:names', 'p2s1:names', 'p2s2:names', 'p3s1:names']
    assert report.steps[4].fixes == ['p1s1+result'] and report.steps[8].fixes == ['p1s1+result']
    request = json.loads(fake.requests[2]['input'][0]['content'][0]['text'])['revision_request']
    assert [(f['failed_check'], f['location']) for f in request['failures']] == [('name_not_as_recorded', 'p2s1')]
    short = request['failures'][0]
    assert short['sentence'].startswith("n'zonzi leads with one goal, while Paul Scholes")
    assert 'recorded capitals' in ' '.join(short['fix_options'])
    assert report.draft.paragraphs[0].sentences[0].fact_ids == ['goal:grf:134', 'result']
    assert report.draft.paragraphs[0].sentences[0].text == compliant_blackburn()['paragraphs'][0]['sentences'][0]['text']
    assert len(fake.requests) == 3


def test_replay_tp230c_arsenal_identical_revision_is_revision_noop(offline, tmp_path):
    run = tp230c()[1]
    assert run['writer'] == run['writer_revision']
    report, fake = replay(offline, tmp_path, ARSENAL, [run['analyst'], run['writer'], run['writer_revision']])
    assert codes(report) == [('analyst', 'ok'), ('writer', 'ok'), ('fixer', 'fixed'), ('verifier', 'rejected'),
                             ('writer_revision', 'revision_noop'), ('publisher', 'deterministic_fallback')]
    assert report.steps[4].cost > 0 and report.steps[-1].reason == 'revision_noop'
    request = json.loads(fake.requests[2]['input'][0]['content'][0]['text'])['revision_request']
    coverage = next(f for f in request['failures'] if f['location'] == 'p1s1')
    assert coverage['rule'].startswith('The coverage sentence must not mention')
    assert coverage['sentence'] == run['writer']['paragraphs'][0]['sentences'][0]['text']


def test_replay_tp230c_arsenal_compliant_revision_accepts(offline, tmp_path):
    run = tp230c()[1]
    report, fake = replay(offline, tmp_path, ARSENAL, [run['analyst'], run['writer'], compliant_arsenal()])
    assert report.provenance == 'crew_ai_draft_checked' and len(fake.requests) == 3
    assert codes(report)[-3:] == [('writer_revision', 'ok'), ('verifier', 'accepted'), ('publisher', 'crew_ai_draft_checked')]


def test_fixer_alone_can_converge_without_a_revision(offline, tmp_path):
    run = tp230c()[0]
    report, fake = replay(offline, tmp_path, BLACKBURN, [run['analyst'], compliant_blackburn()])
    assert codes(report) == [('analyst', 'ok'), ('writer', 'ok'), ('verifier', 'rejected'), ('fixer', 'fixed'),
                             ('verifier', 'accepted'), ('publisher', 'crew_ai_draft_checked')]
    assert len(fake.requests) == 2  # no Writer revision call
