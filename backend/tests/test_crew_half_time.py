"""TP262: crónica IA al descanso. Hechos de la primera parte, mismo hash para los paquetes del final, instrucciones y
texto de reserva del descanso, y la crónica del descanso y la del final cuentan como un solo partido."""
import json

import pytest

from crew_fixtures import grant, tp229_pack
from test_live_crew import gz, service, tl_goal, touchlines_events, touchlines_recording
from timepitch.chronicles.models import FactPack, canonical_bytes
from timepitch.chronicles.recorded_facts import from_recorded
from timepitch.crew.agents import HALF_TIME, writer_instructions
from timepitch.crew.fallback import crew_fallback_text
from timepitch.crew.live import CLIENT_DAILY, LiveCrewBusy


def halftime(ms, sample):
    return {'t_ms': ms, 'sample_index': sample, 'match_ms': ms, 'kind': 'halftime', 'side': None, 'period': 2}


def with_period(event, period):
    return {**event, 'period': period}


def test_touchlines_half_time_pack_holds_the_first_half_only():
    events = [with_period(tl_goal(239, 23900, 'home', 'home:p9'), 1), halftime(2700000, 27000),
              with_period(tl_goal(47320, 4732000, 'away', 'away:p9'), 2)]
    full = from_recorded(gz(touchlines_recording()), gz(touchlines_events(events)), 'touchlines')
    half = from_recorded(gz(touchlines_recording()), gz(touchlines_events(events)), 'touchlines', 'half_time')
    assert full.period == 'full_time' and full.score == [1, 1]
    assert half.period == 'half_time' and half.score == [1, 0] and half.full_time_ms == 2700000
    assert [f.player_names for f in half.facts if f.kind == 'goal'] == [['Home Player J']]


def test_a_recording_without_periods_has_no_half_time_report():
    events = [tl_goal(239, 23900, 'home', 'home:p9')]
    with pytest.raises(ValueError):
        from_recorded(gz(touchlines_recording((1, 0))), gz(touchlines_events(events)), 'touchlines', 'half_time')


def test_full_time_packs_serialise_as_before_and_half_time_ones_say_so():
    pack = tp229_pack()
    assert 'period' not in json.loads(canonical_bytes(pack))
    half = pack.model_copy(update={'period': 'half_time'})
    assert json.loads(canonical_bytes(half))['period'] == 'half_time'
    assert FactPack.model_validate_json(canonical_bytes(half)).period == 'half_time'
    assert FactPack.model_validate_json(canonical_bytes(pack)).period == 'full_time'


def test_half_time_writer_instructions_and_fallback():
    pack = tp229_pack()
    half = pack.model_copy(update={'period': 'half_time'})
    assert HALF_TIME in writer_instructions('en', half) and HALF_TIME not in writer_instructions('en', pack)
    h, a = half.score
    assert f'At half-time: {half.home_name} {h}–{a} {half.away_name}.' in crew_fallback_text(half, 'en')
    assert 'Al descanso:' in crew_fallback_text(half, 'es') and 'finished' in crew_fallback_text(pack, 'en')


def test_half_time_and_full_time_reports_of_one_match_count_once(tmp_path):
    packs = {}

    def source(engine, match_id, owner, period='full_time'):
        key = (match_id, period)
        base = tp229_pack().model_copy(update={'trace_hash': f'{len(packs) + 1:064x}', 'period': period})
        return packs.setdefault(key, base)
    crew, _ = service(tmp_path, g=grant(max_reports=40, locales=['en', 'es']), source=source)
    half = crew.request('grf', 'm0', 'owner-0', 'en', '203.0.113.7', period='half_time')['request_hash']
    full = crew.request('grf', 'm0', 'owner-0', 'en', '203.0.113.7')['request_hash']  # same match: not one_in_flight
    assert half != full
    assert json.loads(crew._queue.sent[0])['fact_pack']['period'] == 'half_time'
    for i in range(1, CLIENT_DAILY):
        crew.request('grf', f'm{i}', f'owner-{i}', 'en', '203.0.113.7')
    with pytest.raises(LiveCrewBusy, match='daily_limit'):
        crew.request('grf', 'm-extra', 'owner-extra', 'en', '203.0.113.7')
    assert crew.status('grf', 'm0', 'owner-0', 'en', period='half_time')['request_hash'] == half


def test_grf_half_time_pack_uses_the_first_half_goals_and_the_break_clock():
    from chronicle_fixtures import grf_pair
    from timepitch.chronicles.facts import from_grf
    record, summary = grf_pair()
    half = from_grf(record, summary, 'half_time')
    assert half.period == 'half_time' and half.full_time_ms == summary.halftime_ms
    assert half.score == [sum(1 for g in summary.goals if g.phase == 1 and g.side == s) for s in ('home', 'away')]
    assert from_grf(record, summary).period == 'full_time'


def test_a_team_is_never_given_the_other_teams_figure():
    """crew-verifier-6 (TP263): the half-time draft that gave one side's passes to the other is refused."""
    from timepitch.chronicles.models import ChronicleFact
    from timepitch.crew.checks import team_number_failure
    pack = tp229_pack().model_copy(update={'home_name': 'North London Reds', 'away_name': 'Mancunian Sky', 'score': [0, 0]})
    passes = ChronicleFact(id='comparison:pass_received', kind='team_compare', side='home', metric_id='pass_received',
                           value=13., comparison_value=10., unit='count', availability='derived')
    shots = ChronicleFact(id='comparison:shots', kind='team_compare', side='home', metric_id='shots',
                          value=3., comparison_value=0., unit='count', availability='derived')
    possession = ChronicleFact(id='comparison:team_possession_pct', kind='team_compare', side='home',
                               metric_id='team_possession_pct', value=51.17, comparison_value=48.83, unit='percent', availability='derived')
    result = next(f for f in pack.facts if f.kind == 'result')
    bad = "North London Reds had 3 shots while Mancunian Sky managed none, but Mancunian Sky received 13 passes compared to North London Reds' 0."
    assert team_number_failure(pack, bad, [shots, passes, result])
    good = ['North London Reds had 3 shots while Mancunian Sky managed none.',
            'North London Reds received 13 passes, Mancunian Sky 10.',
            "North London Reds had more of the ball with 51.17% compared to Mancunian Sky's 48.83%.",
            'North London Reds tuvo más el balón (51,17 % frente a 48,83 %).',
            'North London Reds had more shots than Mancunian Sky, 3 to 0.']
    for text in good:
        assert not team_number_failure(pack, text, [shots, passes, possession, result]), text
    assert not team_number_failure(pack, bad, [result])  # no comparison cited: the validator's rules apply as before
