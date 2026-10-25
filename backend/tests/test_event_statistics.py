import pytest
from statistics_fixtures import frame, action, event_fixture
from timepitch.simulation.replay import event_view
from timepitch.statistics.definitions import definitions
from timepitch.statistics.events import EventStatistics, attacking_xy, is_progressive, in_opponent_box


def calculated(events, end=20000):
    reducer = EventStatistics(frame())
    for event in events: reducer.on_event(event)
    return reducer.snapshot(end)


def test_occasions_creation_and_shot_origin_are_counted_once_and_cut_by_resolution():
    record = event_fixture()
    events = [event_view(e) for e in record.events]
    stats = calculated(events)
    home, away = stats.by_team['home'], stats.by_team['away']
    assert home['simulated_xg'].value == pytest.approx(.5)
    assert home['simulated_xga'].value == pytest.approx(.1)
    assert home['simulated_xgd'].value == pytest.approx(.4)
    assert home['simulated_xg_per_shot'].value == pytest.approx(.25)
    assert home['goals_minus_xg'].value == pytest.approx(.5)
    assert away['simulated_xg'].value == pytest.approx(.1)
    passer = stats.by_player[events[0].participants[0]]
    assert passer['xg_assisted'].value == pytest.approx(.2)
    assert passer['key_passes'].value == 1
    assert passer['xg_assisted'].event_ids == ['p1', 's1']
    assert stats.plots['shots'][0].x == 55
    assert stats.plots['shots'][0].event_id == 's1'
    assert calculated(events, 5000).by_team['home']['simulated_xg'].value == 0
    assert calculated(events+[events[1]], 20000).by_team['home']['simulated_xg'].value == pytest.approx(.5)


@pytest.mark.parametrize('start,end,expected', [((5,34),(35,34),True),((5,34),(34.999,34),False),
    ((50,34),(65,34),True),((50,34),(64.999,34),False),
    ((70,34),(80,34),True),((70,34),(79.999,34),False)])
def test_progress_requires_distance_to_goal_threshold(start,end,expected):
    assert is_progressive(start,end) is expected


@pytest.mark.parametrize('side,period,expected', [('home',1,(20,10)),('away',2,(20,10)),
    ('away',1,(85,58)),('home',2,(85,58))])
def test_attacking_coordinates_rotate_both_axes(side,period,expected):
    assert attacking_xy(20000,10000,side,period) == expected


def test_box_and_zone_entries_have_explicit_boundaries():
    assert in_opponent_box(88.5,13.84) and in_opponent_box(105,54.16)
    assert not in_opponent_box(88.499,34) and not in_opponent_box(90,54.161)
    events=[action('a',origin=(69000,34000),destination=(70000,34000)),
            action('b',origin=(70000,34000),destination=(90000,34000)),
            action('c',origin=(90000,34000),destination=(95000,34000))]
    home=calculated(events).by_team['home']
    assert home['final_third_entries'].value == 1
    assert home['box_entries'].value == 1


def test_field_tilt_and_zero_denominator_do_not_invent_percentages():
    events=[action(str(i),origin=(71000,34000),destination=(80000,34000)) for i in range(3)]
    events += [action('away',side='away',origin=(30000,34000),destination=(20000,34000))]
    stats=calculated(events)
    assert stats.by_team['home']['field_tilt_tp'].value == 75
    empty=calculated([]).by_team['home']['field_tilt_tp']
    assert empty.value is None and empty.reason == 'zero_denominator'
    assert empty.denominator == 0
    assert definitions()['field_tilt_tp'].label_key.endswith('field_tilt_tp')
    assert definitions()['simulated_xg'].parameters['variant'] == 'generative_probability_tp'


def test_interventions_do_not_double_count_the_recovery_marker():
    initial=frame()
    home=[p.key for p in initial.players if p.side=='home']
    away=[p.key for p in initial.players if p.side=='away']
    events=[action('p'+str(i),side='away',origin=(95000,34000),destination=(85000,34000)) for i in range(6)]
    events += [action('i','pass','away',origin=(80000,34000),destination=(75000,34000),
               participants=[away[5],away[6],home[5]],outcome='intercepted'),
               action('r1','recovery',participants=[home[5]],related=['i'],outcome='won_ball'),
               action('t','tackle',origin=(75000,34000),destination=(75000,34000),
               participants=[home[5],away[5]],outcome='won_ball'),
               action('r2','recovery',participants=[home[5]],related=['t'],outcome='won_ball')]
    metric=calculated(events).by_team['home']['passes_per_intervention_tp']
    assert metric.value == 3 and metric.denominator == 2


def test_recovery_episodes_keep_open_and_strict_under_five_seconds_separate():
    def recover(id, side, time):
        key=next(p.key for p in frame().players if p.side==side)
        return action(id,'recovery',side,start=time,end=time,participants=[key],outcome='won_ball')
    events=[recover('a','away',1000),recover('b','home',5750),recover('c','away',8000),
            recover('d','home',13000),recover('e','away',15000)]
    home=calculated(events).by_team['home']
    assert home['recovery_time_s'].value == pytest.approx(4.875)
    assert home['recovery_episodes_completed'].value == 2
    assert home['recovery_episodes_open'].value == 1
    assert home['counterpress_recoveries_tp'].value == 1
    partial=calculated(events,5000).by_team['home']
    assert partial['recovery_time_s'].value is None
    assert partial['recovery_episodes_open'].value == 1


@pytest.mark.parametrize('delay,distance,expected', [(5000,5000,.2),(5250,5000,0),(5000,5001,0)])
def test_assistance_time_and_carry_boundaries(delay,distance,expected):
    events=[event_view(e) for e in event_fixture().events[:2]]
    shot=events[1]
    shot.t0_ms=shot.released_ms=events[0].t1_ms+delay
    shot.t1_ms=shot.released_ms+500
    shot.origin_mm=(events[0].end_mm[0]+distance,34000)
    stats=calculated(events)
    assert stats.by_player[events[0].participants[0]]['xg_assisted'].value == expected


def test_control_rival_reset_and_long_returning_carry_break_assistance():
    original=[event_view(e) for e in event_fixture().events[:2]]
    away=next(p.key for p in frame().players if p.side=='away')
    shooter=original[1].participants[0]
    cases=[
        [action('r','recovery','away',start=2000,end=2000,participants=[away],outcome='won_ball')],
        [action('restart','restart',start=2000,end=2000,participants=[shooter],outcome='in_play')],
        [action('c1','carry',start=1000,end=2000,origin=(50000,34000),destination=(56000,34000),participants=[shooter]),
         action('c2','carry',start=2000,end=3000,origin=(56000,34000),destination=(50000,34000),participants=[shooter])],
    ]
    for middle in cases:
        stats=calculated([original[0],*middle,original[1]])
        assert stats.by_player[original[0].participants[0]]['xg_assisted'].value == 0


def test_sequence_ends_at_shot_release_rather_than_goal_line_arrival():
    passer=action('p',origin=(5000,34000),destination=(55000,34000))
    shot=action('s','shot',start=5000,end=5500,origin=(55000,34000),destination=(105000,34000),
                participants=[passer.participants[-1]],outcome='goal',simulated_xg=.2)
    home=calculated([passer,shot],5500).by_team['home']
    assert home['sequence_duration_s'].value == 5
    assert home['sequence_progress_m'].value == 50
    assert home['sequence_direct_speed_m_s'].value == 10
    assert home['passes_per_sequence'].value == 1


def test_final_whistle_preserves_open_recovery_episodes_but_restart_censors_them():
    key=next(p.key for p in frame().players if p.side=='away')
    loss=action('loss','recovery','away',start=1000,end=1000,participants=[key],outcome='won_ball')
    final=action('final','fulltime',side=None,start=20000,end=20000,participants=[],outcome='finished')
    metric=calculated([loss,final]).by_team['home']['recovery_episodes_open']
    assert metric.value == 1 and metric.event_ids == ['loss']
    reset=action('reset','restart','away',start=2000,end=2000,participants=[key],outcome='in_play')
    assert calculated([loss,reset,final]).by_team['home']['recovery_episodes_open'].value == 0


def test_pressure_link_requires_a_causal_reference_and_progress_separates_results():
    home=[p.key for p in frame().players if p.side=='home']
    pressure=action('press','pressure',start=0,end=1000,participants=home[5:6],outcome='held')
    recovery=action('recover','recovery',start=2000,end=2000,participants=home[5:6],outcome='won_ball',related=['press'])
    assert calculated([pressure,recovery]).by_team['home']['pressure_linked_recoveries'].value == 1
    recovery.related_event_ids=[]
    assert calculated([pressure,recovery]).by_team['home']['pressure_linked_recoveries'].value == 0
    attempt=action('attempt',origin=(5000,34000),destination=(40000,34000),outcome='incomplete')
    values=calculated([attempt]).by_team['home']
    assert values['progressive_passes_attempted'].value == 1
    assert values['progressive_passes_completed'].value == 0


def test_pass_after_shot_and_wrong_sequence_do_not_credit_an_assist():
    original=[event_view(e) for e in event_fixture().events[:2]]
    original[1].sequence_id=1
    assert calculated(original).by_team['home']['xg_assisted'].value == 0
    shot=original[1].model_copy(update={'sequence_id':0,'t0_ms':0,'released_ms':0,'t1_ms':500})
    assert calculated([shot,original[0]]).by_team['home']['xg_assisted'].value == 0


def test_pressure_reference_cannot_point_forward_in_the_same_tick():
    actor=next(p.key for p in frame().players if p.side=='home')
    recovery=action('r','recovery',start=2000,end=2000,participants=[actor],outcome='won_ball',related=['later'])
    pressure=action('later','pressure',start=2000,end=2000,participants=[actor],outcome='held')
    assert calculated([recovery,pressure]).by_team['home']['pressure_linked_recoveries'].value == 0


def test_sequence_ends_before_halftime_reset_and_starts_at_recovery_not_first_later_pass():
    delivery=action('p',origin=(5000,34000),destination=(55000,34000))
    interval=action('h','halftime',side=None,start=2000,end=2000,participants=[],
                    destination=(52500,34000),outcome='interval').model_copy(update={'period':2})
    assert calculated([delivery,interval],2000).by_team['home']['sequence_progress_m'].value == 50
    away=[p.key for p in frame().players if p.side=='away']
    recovery=action('r','recovery','away',start=1000,end=1000,origin=(85000,34000),destination=(85000,34000),
                    participants=away[5:6],outcome='won_ball')
    delivery=action('p','pass','away',start=4000,end=4500,origin=(85000,34000),destination=(35000,34000),participants=away[5:7],seq=1)
    shot=action('s','shot','away',start=6000,end=6500,origin=(35000,34000),destination=(0,34000),participants=away[6:7],
                outcome='goal',seq=1,simulated_xg=.2)
    values=calculated([recovery,delivery,shot],6500).by_team['away']
    assert values['sequence_duration_s'].value == 5
    assert values['sequence_progress_m'].value == 50
