import importlib

from historical_analysis_support import event, game, point


def timeline(match, events):
    return importlib.import_module('timepitch.historical.participation').build_participation(match, events)


def test_substitution_red_card_and_unused_bench_preserve_identity_and_minutes():
    match, events = game([event(30,'Substitution',ms=600_000, player=101,
                               substitution={'replacement':{'id':111}}),
                          event(31,'Bad Behaviour',ms=1_000_000,team=1,player=201,
                                bad_behaviour={'card':{'name':'Red Card'}})])
    value = timeline(match,events)
    assert len(value.active_players(1, 0)) == 22
    keys = {p.key for p in value.active_players(1, 600_000)}
    assert 'statsbomb:101' not in keys and 'statsbomb:111' in keys
    assert len(value.active_players(2, 0)) == 21
    assert value.played_ms('statsbomb:101',point(1,900_000)) == 600_000
    assert value.played_ms('statsbomb:111',point(1,900_000)) == 300_000
    assert value.played_ms('statsbomb:112',point(2,3_038_204)) == 0
    assert value.played_ms('statsbomb:201',point(2,3_038_204)) == 1_000_000


def test_player_off_and_on_are_not_a_substitution_or_a_permanent_dismissal():
    match, events = game([event(30,'Player Off',ms=100_000,player=101),
                          event(31,'Player On',ms=120_000,player=101)])
    value=timeline(match,events)
    assert len(value.active_players(1,110_000))==21
    assert len(value.active_players(1,120_000))==22
    assert value.played_ms('statsbomb:101',point(1,150_000))==130_000


def test_tactical_shift_cannot_resurrect_dismissed_player():
    match, events=game([event(30,'Foul Committed',ms=100_000,player=101,
                             foul_committed={'card':{'name':'Second Yellow'}}),
                        event(31,'Tactical Shift',ms=110_000,tactics={'formation':442,
                              'lineup':[{'player':{'id':100+i}} for i in range(11)]})])
    value=timeline(match,events)
    assert 'statsbomb:101' not in {p.key for p in value.active_players(2,0)}
    assert any('inactive_tactical_player' in issue for issue in value.issues)


def test_unknown_substitution_is_partial_and_does_not_add_an_unknown_player():
    match, events=game([event(30,'Substitution',ms=100_000,player=101,
                             substitution={'replacement':{'id':9999}})])
    value=timeline(match,events)
    assert any('invalid_substitution' in issue for issue in value.issues)
    assert 'statsbomb:9999' not in {p.key for p in value.active_players(1,100_000)}
    assert 'statsbomb:101' not in {p.key for p in value.active_players(1,100_000)}
    assert value.played_ms('statsbomb:101',point(2,0))==100_000


def test_later_dismissal_does_not_change_previous_minutes_or_leak_future_cards():
    match, events=game([event(30,'Bad Behaviour',ms=800_000,player=101,
                             bad_behaviour={'card':{'name':'Red Card'}})])
    value=timeline(match,events)
    assert value.played_ms('statsbomb:101',point(1,700_000))==700_000
    assert len(value.active_players(1,700_000))==22
    assert value.played_ms('statsbomb:101',point(2,0))==800_000


def test_lineup_positions_cannot_supply_unobserved_substitution_time():
    def edit(lineups):
        lineups[0]['lineup'][-1]['positions']=[{'from':'60:00','from_period':2,
                                              'start_reason':'Substitution - On (Tactical)'}]
    match,events=game(lineup_edit=edit)
    value=timeline(match,events)
    assert any('unresolved_lineup_entry' in issue for issue in value.issues)
    assert value.played_ms('statsbomb:112',point(2,3_038_204)) is None


def test_reversed_provider_position_interval_is_reported_without_replacing_event_intervals():
    def edit(lineups):
        lineups[0]['lineup'][1]['positions']=[{'from':'45:12','from_period':2,'to':'47:40','to_period':1,
                                              'start_reason':'Tactical Shift','end_reason':'Tactical Shift'}]
    match,events=game(lineup_edit=edit)
    value=timeline(match,events)
    assert any('lineup_interval_conflict' in i for i in value.issues)
    assert value.played_ms('statsbomb:101',point(2,3_038_204))==5_838_204
