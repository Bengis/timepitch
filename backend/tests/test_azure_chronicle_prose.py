"""Pure prose-contract checks: hand-built facts, no match/model/database execution."""
import importlib
import importlib.util
import gzip
from hashlib import sha256
from pathlib import Path
import socket
import sqlite3
import subprocess

import pytest
from pydantic import ValidationError

from timepitch.chronicles.models import ChronicleFact, Coverage, EventDescriptor, FactPack, canonical_bytes


@pytest.fixture(autouse=True)
def offline_only(monkeypatch):
    def deny(*args, **kwargs):
        raise AssertionError('Prose tests forbid network, databases, subprocesses and simulation')
    monkeypatch.setattr(socket.socket, 'connect', deny)
    monkeypatch.setattr(socket.socket, 'connect_ex', deny)
    monkeypatch.setattr(socket, 'create_connection', deny)
    monkeypatch.setattr(socket, 'getaddrinfo', deny)
    monkeypatch.setattr(sqlite3, 'connect', deny)
    monkeypatch.setattr(subprocess, 'Popen', deny)
    from timepitch.simulation import engine
    for name in ('simulate_match', 'simulate_metrics', 'simulate_statistics'):
        monkeypatch.setattr(engine, name, deny)


def api():
    assert importlib.util.find_spec('timepitch.chronicles.azure') is not None, 'Azure prose contract is not implemented'
    return (importlib.import_module('timepitch.chronicles.azure.models'),
            importlib.import_module('timepitch.chronicles.azure.validation'))


def source():
    return FactPack(engine='grf', trace_hash='a'*64, dataset_version='synthetic-test-only',
        home_name='Arsenal 2003/04', away_name='Manchester City 2017/18', score=[1, 0],
        full_time_ms=5401400, coverage=Coverage(events_complete=True, native_clock=True),
        facts=[ChronicleFact(id='result', kind='result'), ChronicleFact(id='coverage', kind='coverage'),
            ChronicleFact(id='goal:e1', kind='goal', side='home', player_ids=['p1'],
                player_names=['Thierry Henry'], value=1., unit='count', time_ms=252000, event_refs=['e1']),
            ChronicleFact(id='comparison:shots', kind='team_compare', metric_id='shots', side='home',
                value=6., comparison_value=4., unit='count'),
            ChronicleFact(id='comparison:possession', kind='team_compare', metric_id='team_possession_pct',
                side='home', value=51.24, comparison_value=48.76, unit='percent', availability='derived'),
            ChronicleFact(id='leader:recoveries', kind='actor_stat', metric_id='recoveries',
                player_ids=['p2'], player_names=['Patrick Vieira'], value=3., unit='count')],
        events=[EventDescriptor(id='e1', type='goal', time_ms=252000, side='home')])


def raw(locale='en'):
    en = locale == 'en'
    return {'headline': {'text': ('Arsenal 2003/04 finished 1–0 against Manchester City 2017/18.' if en else
                'Arsenal 2003/04 terminó 1–0 ante Manchester City 2017/18.'), 'fact_ids': ['result']},
        'paragraphs': [
            {'sentences': [{'text': ('Thierry Henry scored for Arsenal 2003/04 at 04:12.' if en else
                'Thierry Henry marcó para Arsenal 2003/04 a los 04:12.'), 'fact_ids': ['goal:e1']}]},
            {'sentences': [{'text': ('Arsenal 2003/04 recorded 6 shots and Manchester City 2017/18 had 4.' if en else
                'Arsenal 2003/04 registró 6 tiros y Manchester City 2017/18 tuvo 4.'), 'fact_ids': ['comparison:shots']}]}]}


@pytest.mark.parametrize('locale', ['en', 'es'])
def test_en_es_limits_and_refs(locale):
    m, v = api()
    pack = source()
    before = canonical_bytes(pack)
    draft = m.ChronicleDraft.model_validate(raw(locale))
    checked = v.validate_draft(pack, draft, locale)
    assert checked.draft == draft and checked.draft is not draft
    assert checked.header.score == [1, 0] and checked.header.home_name == pack.home_name
    assert checked.evidence[1].event_refs == ['e1']
    assert checked.evidence[1].facts[0].player_ids == ['p1']
    assert checked.locale == locale and checked.provenance == 'azure_ai_draft_checked'
    assert checked.semantic_verified is False
    assert canonical_bytes(pack) == before
    checked.evidence[1].facts[0].player_names[0] = 'changed copy'
    assert pack.facts[2].player_names == ['Thierry Henry']


def test_own_goal_actor_is_not_beneficiary():
    m, v = api()
    pack = source()
    pack.facts[2].own_goal = True
    data = raw()
    data['paragraphs'][0]['sentences'][0]['text'] = 'An own goal by Thierry Henry benefited Arsenal 2003/04 at 04:12.'
    checked = v.validate_draft(pack, m.ChronicleDraft.model_validate(data), 'en')
    fact = checked.evidence[1].facts[0]
    assert fact.own_goal and fact.side == 'home' and fact.player_ids == ['p1']
    with pytest.raises(v.DraftRejected, match='own_goal'):
        v.validate_draft(pack, m.ChronicleDraft.model_validate(raw()), 'en')


@pytest.mark.parametrize('locale,home,away', [('en', '51.2', '48.8'), ('es', '51,2', '48,8')])
def test_digit_names_seasons_and_decimal_commas(locale, home, away):
    m, v = api()
    pack = source()
    pack.facts[2].player_names = ['Player 9']
    data = raw(locale)
    data['paragraphs'][0]['sentences'][0]['text'] = ('Player 9 scored at 04:12.' if locale == 'en' else 'Player 9 marcó a los 04:12.')
    data['paragraphs'][1]['sentences'][0] = {'text': (
        f'Arsenal 2003/04 recorded {home}% possession and Manchester City 2017/18 {away}%.' if locale == 'en' else
        f'Arsenal 2003/04 registró {home}% de posesión y Manchester City 2017/18 {away}%.'),
        'fact_ids': ['comparison:possession']}
    assert v.validate_draft(pack, m.ChronicleDraft.model_validate(data), locale).header.score == [1, 0]


@pytest.mark.parametrize('text,refs,reason', [
    ('Arsenal 2003/04 recorded 99 shots.', ['comparison:shots'], 'number'),
    ('Lionel Messi scored at 04:12.', ['goal:e1'], 'entity'),
    ('Patrick Vieira scored at 04:12.', ['goal:e1'], 'entity'),
    ('Thierry Henry scored at 05:12.', ['goal:e1'], 'clock'),
    ('Arsenal 2003/04 recorded 6% possession.', ['comparison:shots'], 'metric'),
    ('Arsenal 2003/04 recorded 6 recoveries.', ['comparison:shots'], 'metric'),
    ('Arsenal 2003/04 recorded 6 xG.', ['comparison:shots'], 'metric'),
    ('Arsenal 2003/04 dominated with superior pressing.', ['result'], 'interpretation'),
    ('<script>private-sentinel</script>', ['result'], 'text'),
    ('See https://example.com/private-sentinel', ['result'], 'text'),
    ('[Watch](javascript:private-sentinel)', ['result'], 'text'),
    ('Recorded\nprivate-sentinel', ['result'], 'text'),
    ('Recorded\u202eprivate-sentinel', ['result'], 'text'),
])
def test_unknown_number_entity_and_unsafe_text_rejected(text, refs, reason):
    m, v = api()
    data = raw()
    data['paragraphs'][0]['sentences'][0] = {'text': text, 'fact_ids': refs}
    with pytest.raises(v.DraftRejected) as rejected:
        v.validate_draft(source(), m.ChronicleDraft.model_validate(data), 'en')
    assert reason in rejected.value.code
    assert 'private-sentinel' not in str(rejected.value)


@pytest.mark.parametrize('locale', ['en', 'es'])
def test_partial_coverage_cannot_disappear(locale):
    m, v = api()
    pack = source()
    pack.coverage = Coverage(events_complete=False, native_clock=False, omitted_events=2, notes=['source caveat'])
    pack.full_time_ms = None
    checked = v.validate_draft(pack, m.ChronicleDraft.model_validate(raw(locale)), locale)
    assert checked.coverage.events_complete is False and checked.coverage.omitted_events == 2
    assert checked.coverage.notes == ['source caveat']
    joined = ' '.join(checked.coverage_notes).lower()
    assert 'source caveat' in joined
    assert ('incompleta' if locale == 'es' else 'incomplete') in joined
    assert ('reloj' if locale == 'es' else 'clock') in joined
    assert ('algunos' if locale == 'es' else 'selected') in joined


def test_references_are_not_semantic_proof():
    m, v = api()
    data = raw()
    # Valid values/identities but reversed team relation: explicitly not an entailment proof.
    data['paragraphs'][1]['sentences'][0]['text'] = 'Manchester City 2017/18 recorded 6 shots and Arsenal 2003/04 had 4.'
    checked = v.validate_draft(source(), m.ChronicleDraft.model_validate(data), 'en')
    assert checked.semantic_verified is False
    assert checked.validator_version == m.VALIDATOR_VERSION
    assert checked.evidence[2].facts[0].value == 6.
    assert checked.draft.paragraphs[1].sentences[0].text == data['paragraphs'][1]['sentences'][0]['text']


@pytest.mark.parametrize('change', ['empty_refs', 'duplicate_refs', 'too_many_refs', 'missing_text', 'extra_field',
    'one_paragraph', 'four_paragraphs', 'empty_sentences', 'three_sentences', 'long_sentence', 'long_headline', 'bool_text'])
def test_strict_structure_and_bounds(change):
    m, _ = api()
    data = raw()
    first = data['paragraphs'][0]['sentences'][0]
    if change == 'empty_refs': first['fact_ids'] = []
    if change == 'duplicate_refs': first['fact_ids'] = ['result', 'result']
    if change == 'too_many_refs': first['fact_ids'] = ['a', 'b', 'c', 'd', 'e']
    if change == 'missing_text': first.pop('text')
    if change == 'extra_field': first['url'] = 'private-sentinel'
    if change == 'one_paragraph': data['paragraphs'] = data['paragraphs'][:1]
    if change == 'four_paragraphs': data['paragraphs'] *= 2
    if change == 'empty_sentences': data['paragraphs'][0]['sentences'] = []
    if change == 'three_sentences': data['paragraphs'][0]['sentences'] *= 3
    if change == 'long_sentence': first['text'] = 'x'*361
    if change == 'long_headline': data['headline']['text'] = 'x'*161
    if change == 'bool_text': first['text'] = True
    with pytest.raises(ValidationError):
        m.ChronicleDraft.model_validate(data)


@pytest.mark.parametrize('change', ['unknown_ref', 'missing_result', 'reversed_score', 'bad_event', 'unavailable',
    'missing_actor', 'mutated_draft', 'mutated_nan', 'wrong_locale'])
def test_boundary_revalidation_and_fact_associations(change):
    m, v = api()
    pack, data, locale = source(), raw(), 'en'
    if change == 'unknown_ref': data['paragraphs'][0]['sentences'][0]['fact_ids'] = ['invented']
    if change == 'missing_result': data['headline']['fact_ids'] = ['comparison:shots']
    if change == 'reversed_score': data['headline']['text'] = data['headline']['text'].replace('1–0', '0–1')
    if change == 'bad_event': pack.events[0].side = 'away'
    if change == 'unavailable': pack.facts[3].availability = 'unavailable'
    if change == 'missing_actor': pack.facts[2].player_ids, pack.facts[2].player_names = [], []
    if change == 'mutated_nan': pack.facts[3].value = float('nan')
    if change == 'wrong_locale': locale = 'fr'
    draft = m.ChronicleDraft.model_validate(data)
    if change == 'mutated_draft': draft.paragraphs[0].sentences[0].text = 'x'*361
    with pytest.raises(v.DraftRejected):
        v.validate_draft(pack, draft, locale)


def test_prompt_versions_and_complete_json_schema():
    m, v = api()
    schema = m.ChronicleDraft.model_json_schema()
    assert schema['additionalProperties'] is False
    assert set(schema['required']) == {'headline', 'paragraphs'}
    assert m.PROFILE == 'azure-chronicle-1' and m.SCHEMA_VERSION == 'chronicle-prose-1'
    assert m.PROMPT_VERSION != 'chronicle-1'
    for locale in ('en', 'es'):
        prompt = v.prose_instructions(locale)
        assert 'fact_ids' in prompt and '160' in prompt and '360' in prompt
        assert ('English' if locale == 'en' else 'Spanish') in prompt


def test_honest_unknown_actor_and_engine_coverage():
    m, v = api()
    for engine in ('timepitch', 'grf'):
        pack, data = source(), raw()
        pack.engine = engine
        pack.facts[2].player_ids, pack.facts[2].player_names = [], []
        data['paragraphs'][0]['sentences'][0]['text'] = 'An unresolved scorer is recorded at 04:12 for Arsenal 2003/04.'
        checked = v.validate_draft(pack, m.ChronicleDraft.model_validate(data), 'en')
        assert checked.evidence[1].facts[0].player_ids == []
        assert checked.header.score == [1, 0]


@pytest.mark.parametrize('change', ['stat_event', 'comparison_side', 'unavailable_goal'])
def test_source_metadata_cannot_smuggle_unresolved_evidence(change):
    m, v = api()
    pack = source()
    if change == 'stat_event': pack.facts[3].event_refs = ['not-recorded']
    if change == 'comparison_side': pack.facts[3].side = 'away'
    if change == 'unavailable_goal': pack.facts[2].availability = 'unavailable'
    with pytest.raises(v.DraftRejected):
        v.validate_draft(pack, m.ChronicleDraft.model_validate(raw()), 'en')


@pytest.mark.parametrize('text', ['Arsenal 2003/04 recorded a distance of 6 metres.',
    'Arsenal 2003/04 used tactical pressure.', 'Arsenal 2003/04 registró una distancia de 6 metros.'])
def test_unobserved_effort_and_tactics_are_not_inferred(text):
    m, v = api()
    data = raw()
    data['paragraphs'][1]['sentences'][0]['text'] = text
    with pytest.raises(v.DraftRejected):
        v.validate_draft(source(), m.ChronicleDraft.model_validate(data), 'en')


def test_exact_schema_boundaries_are_accepted():
    m, _ = api()
    data = raw()
    data['headline']['text'] = 'x'*160
    data['headline']['fact_ids'] = ['result', 'coverage', 'goal:e1', 'comparison:shots']
    data['paragraphs'] = [{'sentences': [{'text': 'x'*360, 'fact_ids': ['result']},
                                       {'text': 'y'*360, 'fact_ids': ['coverage']}]} for _ in range(3)]
    draft = m.ChronicleDraft.model_validate(data)
    assert len(draft.paragraphs) == 3 and len(draft.headline.fact_ids) == 4
    assert len(draft.paragraphs[2].sentences[1].text) == 360
    schema = m.ChronicleDraft.model_json_schema()
    assert schema['$defs']['ProseSentence']['additionalProperties'] is False


def test_percentage_wrong_unit_and_unavailable_leader_rejected():
    m, v = api()
    pack, data = source(), raw()
    part = data['paragraphs'][1]['sentences'][0]
    part.update(text='Arsenal 2003/04 recorded 51.2 shots.', fact_ids=['comparison:possession'])
    with pytest.raises(v.DraftRejected):
        v.validate_draft(pack, m.ChronicleDraft.model_validate(data), 'en')
    part.update(text='Patrick Vieira recorded 3 recoveries.', fact_ids=['leader:recoveries'])
    assert v.validate_draft(pack, m.ChronicleDraft.model_validate(data), 'en').evidence[2].facts[0].value == 3.
    pack.facts[-1].availability = 'unavailable'
    with pytest.raises(v.DraftRejected):
        v.validate_draft(pack, m.ChronicleDraft.model_validate(data), 'en')


def test_saved_grf_artifact_and_legacy_fixtures_remain_immutable():
    from timepitch.chronicles.facts import from_grf, from_timepitch
    from timepitch.grf.codec import parse_grf
    from timepitch.grf.statistics import build_grf_statistics
    from timepitch.simulation.models import MatchRecord, RenderFrame, PlayerFrame, Point, Score, MatchEvent, MatchMetrics
    m, v = api()
    root = Path(__file__).resolve().parents[2]
    artifact = root/'research/engine-evaluation/2026-10-19-grf-server-match/match-replay.json.gz'
    old_receipt = root/'research/engine-evaluation/2026-10-19-qwen-canary/phase3-live-result.json'
    before = sha256(artifact.read_bytes()).hexdigest()
    receipt_before = sha256(old_receipt.read_bytes()).hexdigest()
    assert before == 'c13ed421b66dc24218e303acef622070529486244ca49e83eea56898b3d3bc80'
    record = parse_grf(gzip.decompress(artifact.read_bytes()))
    record_before = canonical_bytes(record)
    # Existing canonical() fixture reads the catalogue DB; keep this test DB-free.
    players = [PlayerFrame(key=p.id, name=p.name, role=p.role, side=p.side, x=30, y=34) for p in record.input.players]
    frame = RenderFrame(players=players, ball=Point(x=30, y=34), carrier=None, possession='home',
                        clock_ms=0, period=1, score=Score())
    legacy = MatchRecord(config=record.input.config, seed=42, dataset_version=record.input.dataset_version,
        home_name=record.input.home_name, away_name=record.input.away_name, initial_frame=frame, trace_hash='b'*64,
        events=[MatchEvent(id='goal-one', t0_ms=1000, t1_ms=1000, type='goal', side='home',
            participants=[next(p.key for p in players if p.side == 'home')], outcome='scored', evidence={}, frame_after=frame),
            MatchEvent(id='end', t0_ms=5400000, t1_ms=5400000, type='fulltime', side=None, participants=[],
                outcome='end', evidence={}, frame_after=frame.model_copy(update={'score': Score(home=1)}))],
        metrics=MatchMetrics())
    packs = [from_grf(record, build_grf_statistics(record)), from_timepitch(legacy)]
    for pack in packs:
        for locale in ('en', 'es'):
            score = f'{pack.score[0]}–{pack.score[1]}'
            data = {'headline': {'text': f'{pack.home_name} {score} {pack.away_name}', 'fact_ids': ['result']},
                'paragraphs': [{'sentences': [{'text': (f'The recorded score is {score}.' if locale == 'en' else
                    f'El resultado registrado es {score}.'), 'fact_ids': ['result']}]},
                    {'sentences': [{'text': ('This chronicle uses recorded simulation facts.' if locale == 'en' else
                        'La crónica usa hechos registrados de la simulación.'), 'fact_ids': ['coverage']}]}]}
            checked = v.validate_draft(pack, m.ChronicleDraft.model_validate(data), locale)
            assert checked.header.score == pack.score and checked.semantic_verified is False
    assert canonical_bytes(record) == record_before
    assert sha256(artifact.read_bytes()).hexdigest() == before
    assert sha256(old_receipt.read_bytes()).hexdigest() == receipt_before


@pytest.mark.parametrize('locale,text', [('en', 'Victory came with the recorded 1–0 result.'),
    ('es', 'Hubo 6 tiros de Arsenal 2003/04 y 4 de Manchester City 2017/18.')])
def test_normal_sentence_initial_capital_is_not_automatically_a_player(locale, text):
    m, v = api()
    data = raw(locale)
    part = data['paragraphs'][1]['sentences'][0]
    part.update(text=text, fact_ids=['result'] if locale == 'en' else ['comparison:shots'])
    assert v.validate_draft(source(), m.ChronicleDraft.model_validate(data), locale).semantic_verified is False
