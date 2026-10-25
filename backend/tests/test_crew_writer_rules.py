"""crew-writer-2/3 rules, all-failure revision feedback and the real tp230b drafts replayed offline."""
import json
from pathlib import Path
import re

import pytest

from crew_fixtures import Harness, offline, reply  # noqa: F401
from timepitch.chronicles.azure import validation
from timepitch.chronicles.azure.models import ChronicleDraft
from timepitch.chronicles.azure.validation import locate_all_rejections, locate_rejection, validate_draft
from timepitch.chronicles.models import ChroniclePart, ChronicleSelection, FactPack
from timepitch.chronicles.render import render_chronicle
from timepitch.crew.agents import ALLOWED_VERBS, AVOIDED_TERMS, writer_instructions
from timepitch.crew.models import WRITER_PROMPT_VERSION
from timepitch.crew.workflow import run_crew

FIXTURES = Path(__file__).parent / 'fixtures' / 'crew'


def pack(name) -> FactPack:
    return FactPack.model_validate_json((FIXTURES / name).read_bytes())


def blackburn():
    return pack('tp229-blackburn-united-factpack.json')


def arsenal():
    return pack('tp230-arsenal-mancity-43-factpack.json')


def receipts(name):
    return json.loads((FIXTURES / f'{name}-receipts.json').read_text(encoding='utf-8'))


def names(p, fact_id):
    return next(f.player_names for f in p.facts if f.id == fact_id)


def lively_blackburn():
    return {'headline': {'text': "Steven N'Zonzi strikes as Blackburn Rovers edge Manchester United 1–0",
                         'fact_ids': ['result', 'goal:grf:134']},
        'paragraphs': [
            {'sentences': [{'text': "One strike at 27:14 from Steven N'Zonzi, and that is the only goal of the match.",
                            'fact_ids': ['goal:grf:134']}]},
            {'sentences': [{'text': 'Blackburn Rovers fire 7 shots to the 5 of Manchester United and win the recoveries '
                                    'count 23 to 21.', 'fact_ids': ['comparison:shots', 'comparison:recoveries']},
                           {'text': 'Possession splits almost evenly: 51.2% for Blackburn Rovers, 48.8% for Manchester United.',
                            'fact_ids': ['comparison:team_possession_pct']}]},
            {'sentences': [{'text': 'David Dunn and Gael Givet lead the recoveries with 5 each.',
                            'fact_ids': ['leader:recoveries']}]}]}


def lively_arsenal():
    p = arsenal()
    gundogan = names(p, 'goal:grf:9254')[0]
    return {'headline': {'text': 'Arsenal strike six times to beat Manchester City 6–1', 'fact_ids': ['result']},
        'paragraphs': [
            {'sentences': [{'text': 'Gilberto Silva opens the scoring for Arsenal at 06:49.', 'fact_ids': ['goal:grf:4095']},
                           {'text': f'{gundogan} levels for Manchester City at 15:25.', 'fact_ids': ['goal:grf:9254']}]},
            {'sentences': [{'text': 'Lauren restores the lead at 23:23, and Thierry Henry fires another at 26:09.',
                            'fact_ids': ['goal:grf:14036', 'goal:grf:15691']},
                           {'text': 'Thierry Henry strikes again at 51:14, Robert Pires adds one at 75:16 and Gilberto Silva '
                                    'adds the sixth at 83:58.', 'fact_ids': ['goal:grf:33003', 'goal:grf:47428', 'goal:grf:52641']}]},
            {'sentences': [{'text': 'Thierry Henry and Gilberto Silva share the top of the chart with 2 goals each.',
                            'fact_ids': ['leader:goals']}]}]}


def without_coverage(plan):
    """Real plans from before crew-analyst-2 replayed without the coverage fact (the live schema now forbids it)."""
    paragraphs = [[i for i in p if i != 'coverage'] for p in plan['paragraphs']]
    return {'angle': plan['angle'], 'paragraphs': [p for p in paragraphs if p]}


def _validator_flags(word):
    return [name for name, pattern in [('interpretation', validation._INTERPRETATION),
                                       ('forbidden_metric', validation._FORBIDDEN_METRIC), *validation._METRICS.items()]
            if pattern.search(word)]


@pytest.mark.parametrize('locale', ['en', 'es'])
def test_allowed_verbs_pass_every_validator_pattern(locale):
    for verb in ALLOWED_VERBS[locale]:
        assert verb == verb.lower() and _validator_flags(verb) == [], verb


@pytest.mark.parametrize('locale', ['en', 'es'])
def test_avoided_terms_come_from_the_validator(locale):
    for term in AVOIDED_TERMS[locale]:
        assert validation._INTERPRETATION.search(term) or validation._FORBIDDEN_METRIC.search(term), term


@pytest.mark.parametrize('locale', ['en', 'es'])
def test_writer_two_states_the_checker_rules(locale):
    text = writer_instructions(locale)
    assert WRITER_PROMPT_VERSION == 'crew-writer-4'
    for needle in ('possessive', 'sentence case', 'en dash', 'mm:ss', 'Every proper noun must cite a fact that names it.',
                   ALLOWED_VERBS[locale][0], AVOIDED_TERMS[locale][0]):
        assert needle in text, needle


@pytest.mark.parametrize('make,source', [(lively_blackburn, blackburn), (lively_arsenal, arsenal)])
def test_lively_drafts_with_allowed_vocabulary_pass(make, source):
    checked = validate_draft(source(), ChronicleDraft.model_validate(make()), 'en')
    assert checked.semantic_verified is False


def test_all_failures_of_the_real_tp230b_drafts_are_located():
    b, a = receipts('tp230b-blackburn-united'), receipts('tp230b-arsenal-mancity-43')
    assert locate_all_rejections(blackburn(), ChronicleDraft.model_validate(b['writer']), 'en') == [
        ('unknown_entity', 'p2s2'), ('unknown_entity', 'p3s1')]
    assert locate_all_rejections(blackburn(), ChronicleDraft.model_validate(b['writer_revision']), 'en') == [
        ('unknown_entity', 'p3s1')]
    assert locate_all_rejections(arsenal(), ChronicleDraft.model_validate(a['writer']), 'en') == [
        ('unknown_entity', 'headline'), ('unsupported_metric', 'p1s1'), ('unsupported_clock', 'p2s1'),
        ('unsupported_score', 'p2s2'), ('unsupported_score', 'p3s1')]
    # The first failure is still the one locate_rejection/validate_draft report.
    first = locate_all_rejections(arsenal(), ChronicleDraft.model_validate(a['writer_revision']), 'en')[0]
    assert first == locate_rejection(arsenal(), ChronicleDraft.model_validate(a['writer_revision']), 'en') == (
        'unsupported_interpretation', 'headline')
    assert locate_all_rejections(arsenal(), ChronicleDraft.model_validate(lively_arsenal()), 'en') == []


@pytest.mark.parametrize('name,source,lively,expected', [
    # crew-verifier-4 adds the possessive on a full name ("Steven N'Zonzi's decisive goal").
    ('tp230b-blackburn-united', blackburn, lively_blackburn,
     [('possessive_name', 'headline'), ('unknown_entity', 'p2s2'), ('name_not_as_recorded', 'p2s2'),
      ('unknown_entity', 'p3s1'), ('name_not_as_recorded', 'p3s1')]),
    # Plan replayed without coverage (crew-analyst-2); after the Fixer cites result for the final 6-1 in p3s1.
    ('tp230b-arsenal-mancity-43', arsenal, lively_arsenal,
     [('unknown_entity', 'headline'), ('unsupported_metric', 'p1s1'), ('coverage_in_prose', 'p1s1'),
      ('unsupported_clock', 'p2s1'), ('unsupported_score', 'p2s2'), ('name_not_as_recorded', 'p3s2'),
      ('possessive_name', 'p3s2')])])
def test_real_drafts_replayed_revision_carries_every_failure(offline, tmp_path, name, source, lively, expected):
    real = receipts(name)
    model = 'gpt-4.1-mini-2025-04-14'
    plan = without_coverage(real['analyst'])
    fake = offline([reply(plan, model=model), reply(real['writer'], model=model), reply(lively(), model=model)])
    h = Harness(tmp_path)

    async def go():
        try:
            return await run_crew(h.runtime(pack=source()))
        finally:
            await h.close()
    report = offline.run(go())
    roles = [(s.role, s.code) for s in report.steps]
    assert roles[:3] == [('analyst', 'ok'), ('writer', 'ok'), ('verifier', 'rejected')]
    assert roles[-3:] == [('writer_revision', 'ok'), ('verifier', 'accepted'), ('publisher', 'crew_ai_draft_checked')]
    request = json.loads(fake.requests[2]['input'][0]['content'][0]['text'])['revision_request']
    assert [(f['failed_check'], f['location']) for f in request['failures']] == expected
    assert 'every listed sentence' in request['instruction']
    assert report.draft == ChronicleDraft.model_validate(lively())
    assert all(re.search(r'\bpossessive\b', b['instructions']) for b in fake.requests[1:])


def test_fallback_coverage_note_has_its_space():
    p = arsenal()
    selection = ChronicleSelection(headline=ChroniclePart(fact_ids=['result'], variant=0),
                                   paragraphs=[ChroniclePart(fact_ids=['leader:goals'], variant=0)])
    for locale in ('en', 'es'):
        text = render_chronicle(p, selection, locale)
        assert not re.search(r'\.[A-ZÁÉÍÓÚ]', text), text
    assert 'simulation. Event coverage is incomplete' in render_chronicle(p, selection, 'en')
