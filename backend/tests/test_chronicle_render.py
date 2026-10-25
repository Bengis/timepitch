import pytest
from chronicle_fixtures import grf_pair
from timepitch.chronicles.facts import from_grf
from timepitch.chronicles.models import ChronicleSelection
from timepitch.chronicles.render import render_chronicle, validate_selection


def selection(pack, variant=0):
    goal = next(f.id for f in pack.facts if f.kind == 'goal')
    return ChronicleSelection(headline={'fact_ids':['result'], 'variant':variant}, paragraphs=[{'fact_ids':['result',goal], 'variant':variant}])


def test_headline_paragraphs_and_variants_use_authoritative_names_and_score():
    pack = from_grf(*grf_pair())
    english = render_chronicle(pack, selection(pack), 'en')
    spanish = render_chronicle(pack, selection(pack), 'es')
    assert pack.home_name in english and pack.away_name in spanish and '1–0' in english
    assert '\n\n' in english and english != spanish
    assert render_chronicle(pack, selection(pack, 1), 'en') != english


@pytest.mark.parametrize('change', ['unknown', 'duplicates', 'headline', 'variant', 'text', 'too_many', 'wrong_family'])
def test_renderer_rejects_unapproved_selection(change):
    pack = from_grf(*grf_pair())
    data = selection(pack).model_dump()
    if change == 'unknown': data['paragraphs'][0]['fact_ids'] = ['invented']
    if change == 'duplicates': data['paragraphs'][0]['fact_ids'] = ['result', 'result']
    if change == 'headline': data['headline']['fact_ids'] = [data['paragraphs'][0]['fact_ids'][1]]
    if change == 'variant': data['headline']['variant'] = 2
    if change == 'text': data['text'] = '<script>wrong score</script>'
    if change == 'too_many': data['paragraphs'] *= 4
    if change == 'wrong_family': data['paragraphs'][0]['fact_ids'] = ['result']
    with pytest.raises(ValueError): validate_selection(pack, ChronicleSelection.model_validate(data))


def test_no_unknown_actor_is_replaced_with_a_famous_player():
    record, summary = grf_pair(); summary.goals[0].actor_id = None
    pack = from_grf(record, summary)
    text = render_chronicle(pack, selection(pack), 'es')
    assert 'sin resolver' in text and record.input.players[9].name not in text
