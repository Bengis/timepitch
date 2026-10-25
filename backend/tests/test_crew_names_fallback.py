"""crew-fixer-2 (names as recorded), crew-verifier-5 (possessive on a full name) and crew-fallback-3 (plain prose)."""
import json
from pathlib import Path

from timepitch.chronicles.azure.models import ChronicleDraft
from timepitch.chronicles.models import FactPack
from timepitch.crew.checks import name_failures, normalize_names
from timepitch.crew.fallback import crew_fallback_text

FIXTURES = Path(__file__).parent / 'fixtures' / 'crew'


def arsenal():
    return FactPack.model_validate_json((FIXTURES / 'tp230-arsenal-mancity-43-factpack.json').read_bytes())


def draft(headline, *texts):
    texts = list(texts) + ['The match is over.'] * (2 - len(texts))
    return ChronicleDraft.model_validate({'headline': {'text': headline, 'fact_ids': ['result']},
                                          'paragraphs': [{'sentences': [{'text': t, 'fact_ids': ['result']}]} for t in texts]})


def texts(d):
    return [d.headline.text] + [s.text for p in d.paragraphs for s in p.sentences]


def test_short_names_and_capitals_become_the_recorded_names():
    fixed, fixes = normalize_names(arsenal(), draft('Henry fires Arsenal past City', "manchester city trail after Henry's double."))
    assert texts(fixed)[:2] == ['Thierry Henry fires Arsenal past Manchester City',
                                "Manchester City trail after Thierry Henry's double."]
    assert fixes == ['headline:names', 'p1s1:names']


def test_recorded_names_and_ordinary_words_are_left_alone():
    original = draft('Arsenal beat Manchester City', 'The home side scored six times.')
    fixed, fixes = normalize_names(arsenal(), original)
    assert fixed == original and fixes == []


def test_possessive_on_a_full_recorded_name_passes():
    assert name_failures(arsenal(), draft("Arsenal's day", "Thierry Henry's double."), set()) == []
    assert name_failures(arsenal(), draft("Henry's day"), set()) == [('name_not_as_recorded', 'headline')]


def test_fallback_reads_as_match_prose_with_the_score_as_headline():
    text = crew_fallback_text(arsenal(), 'en')
    blocks = text.split('\n\n')
    assert blocks[0] == 'Arsenal 6–1 Manchester City'
    assert blocks[1].startswith('The match finished Arsenal 6–1 Manchester City. 06:49: Gilberto Silva scores for Arsenal.')
    assert 'shared the most goals, 2 each' in text and 'recorded' not in text.replace('the recorded facts', '')
    assert crew_fallback_text(arsenal(), 'es').startswith('Arsenal 6–1 Manchester City\n\nEl partido terminó')


def test_a_goalless_draw_still_says_the_result():
    data = json.loads((FIXTURES / 'tp230-arsenal-mancity-43-factpack.json').read_text(encoding='utf-8'))
    data['score'] = [0, 0]
    data['facts'] = [f for f in data['facts'] if f['kind'] != 'goal' and f.get('metric_id') != 'goals']
    pack = FactPack.model_validate(data)
    assert crew_fallback_text(pack, 'en').split('\n\n')[1] == 'Arsenal and Manchester City drew 0–0.'
