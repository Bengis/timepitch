import importlib

import pytest

from historical_analysis_support import event, game, point


def clock(events):
    return importlib.import_module('timepitch.historical.clock').build_clock(events)


def test_second_half_clock_preserves_95_38_without_forcing_90_minutes():
    _, events = game()
    value = clock(events)
    assert value.to_playback_ms(2, 3_038_204) == 5_838_204
    assert value.from_playback_ms(5_838_204) == point(2, 3_038_204)
    assert value.from_playback_ms(2_800_000) == point(2, 0)
    assert value.display_label(point(2, 3_038_204)) == '95:38'
    assert value.periods[0].end_event_ids == [str(__import__('uuid').UUID(int=812)), str(__import__('uuid').UUID(int=813))]


def test_conflicting_or_missing_half_boundaries_do_not_claim_continuity():
    _, events = game([event(40, 'Half End', ms=2_799_000)])
    value = clock(events)
    assert 'conflicting_half_end:1' in value.issues
    with pytest.raises(ValueError):
        value.to_playback_ms(2, 100)
    missing = clock([e for e in events if e.type != 'Half End'])
    assert missing.periods[0].duration_ms is None
    with pytest.raises(ValueError):
        missing.from_playback_ms(20)


def test_clock_rejects_absent_period_and_out_of_range_instead_of_clamping():
    _, events = game()
    value = clock(events)
    for period, ms in ((3, 0), (1, -1), (1, 2_800_001)):
        with pytest.raises(ValueError):
            value.to_playback_ms(period, ms)
    with pytest.raises(ValueError):
        value.from_playback_ms(5_838_205)


@pytest.mark.parametrize('team,period,want', [(33,1,(10.5,17)), (1,1,(94.5,51)),
                                             (33,2,(94.5,51)), (1,2,(10.5,17))])
def test_canonical_projection_uses_actor_team_and_half_not_possession(team, period, want):
    module = importlib.import_module('timepitch.historical.clock')
    match, events = game([event(40, 'Pass', period=period, team=team,
                                location=[12,20], pass_ignored=True, possession_team={'id':1 if team==33 else 33},
                                **{'pass':{'end_location':[24,40]}})])
    projected = module.orient_event(match, next(e for e in events if e.source_index==40))
    assert (projected.canonical_location.x, projected.canonical_location.y) == want
    assert projected.location.x == 10.5  # provider-frame field is unchanged
    original = module.unproject_point(match, projected.team_key, period, projected.canonical_location)
    assert original == [12,20]
    assert projected.canonical_end_location.x == (21 if want[0]==10.5 else 84)


def test_missing_or_invalid_coordinates_do_not_become_pitch_corners():
    module = importlib.import_module('timepitch.historical.clock')
    match, events = game([event(40, 'Shot', location=[121,40], shot={})])
    assert module.orient_event(match, next(e for e in events if e.source_index==40)).canonical_location is None


def test_event_after_whistle_is_retained_without_extending_recorded_half_or_crossing_it():
    _,events=game([event(40,'Ball Receipt*',ms=2_800_600)])
    value=clock(events)
    assert value.periods[0].duration_ms==2_800_000
    assert 'event_after_half_end:1' in value.issues
    assert value.to_playback_ms(1,2_000_000)==2_000_000
    with pytest.raises(ValueError):
        value.to_playback_ms(2,0)


def test_missing_end_has_bounded_observations_not_a_fabricated_final_whistle():
    _,events=game([event(40,'Pass',ms=100_000,**{'pass':{}})])
    value=clock([e for e in events if e.type!='Half End'])
    assert value.periods[0].duration_ms is None
    with pytest.raises(ValueError):
        value.validate_point(point(1,100_001))
