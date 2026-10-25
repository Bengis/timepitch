"""Hand-authored trajectory components; no admission or native simulation."""
import importlib
import importlib.util
from types import SimpleNamespace
import pytest
from grf_action_fixtures import action_trace,semantic
from grf_physical_fixtures import row
from grf_statistics_fixtures import native_event


def api():
    name='timepitch.grf.defensive_diagnostics'
    assert importlib.util.find_spec(name) is not None,'Missing defensive trajectory analysis'
    return importlib.import_module(name)


def fixture(*,origin='open_play_shot',restart_kind='none',barrier=None,splits=()):
    rows=[row(i,i*100,elapsed=i*100,in_play=1,home_9_x_m=40,away_0_x_m=54,
              away_1_x_m=36,ball_x_m=40) for i in range(102)]
    if barrier is not None:
        rows[barrier][7]=1
        for r in rows[barrier:]:r[19]=1
    m,blocks=action_trace(rows=rows,splits=splits,
        events=[native_event(sample_index=100,actual_time_ms=10000,actor_xy=(40/54.4,0),kind='shot')],
        semantics=[semantic(physics_ms=10000,sample_index=100,intent='shot',origin=origin,restart_kind=restart_kind)])
    player=m.input.players[9]
    diagnostic=dict(trace_hash=m.trace_hash,input_hash=m.input.input_hash,
        shots=[dict(raw_event_seq=0,semantic_seq=0,sample_index=100,physics_ms=10000,
            player_id=player.id,actor_team=0,slot=9,period=1,origin=origin,
            context=dict(frame_sample_index=100,available=True,attack_direction=1))],
        goals=dict(events=[dict(raw_seq=1,linked_release_raw_seq=0)]))
    summary=SimpleNamespace(trace_hash=m.trace_hash,input_hash=m.input.input_hash,passes=[])
    return m,blocks,summary,diagnostic


def test_penalty_space_is_excluded_from_open_play_defensive_failures():
    m,b,s,d=fixture(origin='set_piece_shot',restart_kind='penalty')
    result=api().diagnose_defense(m,iter(b),s,d)
    assert result['groups']['penalty']==dict(shots=1,goals=1)
    assert result['groups']['open_play']==dict(shots=0,goals=0)
    assert result['shots'][0]['phase_class']=='penalty'


def test_unidentified_set_piece_is_not_silently_called_open_play():
    m,b,s,d=fixture(origin='set_piece_shot',restart_kind='free_kick')
    result=api().diagnose_defense(m,iter(b),s,d)
    assert result['groups']['other_set_piece_or_unknown']==dict(shots=1,goals=1)


def test_ten_second_window_does_not_bridge_relocation():
    m,b,s,d=fixture(barrier=85)
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    assert shot['history_ms']==1500
    assert all(v['offset_ms']>=-1500 for v in shot['snapshots'])


def test_window_output_is_invariant_to_block_partition():
    results=[]
    for splits in ((),(1,50,100),(10,70,99)):
        m,b,s,d=fixture(splits=splits)
        result=api().diagnose_defense(m,iter(b),s,d);result.pop('trace_hash');results.append(result)
    assert results[0]==results[1]==results[2]


def test_tracks_fixed_and_changing_nearest_defender_separately():
    m,b,s,d=fixture()
    b[0].samples[90][21+12*6]=50  # Same final defender was far away one second earlier.
    b[0].samples[90][21+13*6]=39  # Another player was close at that time.
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    old=next(v for v in shot['snapshots'] if v['offset_ms']==-1000)
    assert old['nearest_outfield_distance_m']==pytest.approx(1)
    assert old['fixed_final_defender_distance_m']==pytest.approx(10)
    assert old['nearest_outfield_id']!=shot['final_nearest_outfield_id']
    assert shot['minimum_nearest_outfield_last_2s_m']==pytest.approx(1)
    assert shot['minimum_last_2s_sample_index']==90


def test_first_touch_receipt_has_zero_delay_and_is_evidence_not_a_guessed_possession():
    m,b,s,d=fixture()
    s.passes=[SimpleNamespace(outcome='received',receiver_id=d['shots'][0]['player_id'],period=1,
        received_physics_ms=10000,raw_event_seq=5,semantic_seq=7,evidence=[])]
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    assert shot['last_confirmed_receipt']['receipt_to_shot_ms']==0
    assert shot['decision_trace_available'] is False


def test_native_guard_rejects_straight_advance_and_allows_lateral_or_retreat():
    f=api().project_movement_guard
    assert f(1,(52,0),(46.8,0)) is False
    assert f(1,(52,0),(51,2)) is True
    assert f(1,(52,0),(53,0)) is True
    assert f(-1,(-52,0),(-46.8,0)) is False


def test_hunt_radius_bounds_cover_unknown_average_speed_and_dynamic_role():
    low,high=api().hunt_radius_bounds(.8,.6)
    assert low==pytest.approx(2.88) and high==pytest.approx(12.96)
    assert api().hunt_radius_bounds(.4,.6)[1]<high


def test_snapshot_does_not_claim_marking_assignments_or_an_executed_branch():
    m,b,s,d=fixture();result=api().diagnose_defense(m,iter(b),s,d)
    assert result['native_decision_trace_available'] is False
    assert result['candidate_ready'] is False
    assert result['shots'][0]['snapshots'][-1]['guard_projection']['actual_branch']=='unknown'


def test_summary_identity_mismatch_rejected_before_reading_chunks():
    m,b,s,d=fixture();s.trace_hash='wrong'
    with pytest.raises(ValueError):api().diagnose_defense(m,iter(b),s,d)


def test_actor_inactivity_cuts_history_instead_of_bridging_missing_motion():
    m,b,s,d=fixture();b[0].samples[85][21+9*6+4]=0
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    assert shot['history_ms']==1400


def test_penalty_joins_by_physical_ledger_not_unrelated_stats_incident_id():
    from timepitch.grf.physical_models import PhysicalEvent,PhysicalRestart
    m,b,s,d=fixture(origin='set_piece_shot',restart_kind='penalty')
    m.ledger=[PhysicalRestart(id=7,cause='penalty',start=9500,end=10000,eligible_loss_ms=500,period=1)]
    b[0].semantic_events[0].restart_id=7;b[0].semantic_events[0].raw_event_seq=3
    b[0].events[0].seq=3;d['shots'][0]['raw_event_seq']=3;d['goals']['events'][0]['linked_release_raw_seq']=3
    events=[native_event(seq=0,type='decision',kind='foul',stage='accepted',sample_index=95,actual_time_ms=9490,
                incident_id=900,actor_team=1,player=1,victim_team=0,victim_player=9,function=13),
            native_event(seq=1,type='decision',kind='foul',stage='sanctioned',sample_index=95,actual_time_ms=9500,
                incident_id=900,actor_team=1,player=1,victim_team=0,victim_player=9,function=13),
            native_event(seq=2,type='decision',kind='penalty',stage='prepared',sample_index=99,actual_time_ms=9900,
                incident_id=901,actor_team=0,player=9)]
    b[0].events[:0]=[PhysicalEvent(**v) for v in events];b[0].contact_roles[:0]=[0,0,0]
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    assert shot['penalty_prepared_raw_seq']==2
    assert shot['penalty_foul']['sanctioned_raw_seq']==1
    assert shot['penalty_foul']['accepted_raw_seq']==0
    assert shot['penalty_foul']['native_function_at_acceptance']==13


def test_departed_defender_still_counts_in_earlier_coverage():
    m,b,s,d=fixture()
    b[0].samples[90][21+13*6]=39
    for r in b[0].samples[91:]:r[21+13*6+4]=0
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    assert shot['minimum_nearest_outfield_last_2s_m']==pytest.approx(1)
    assert shot['minimum_last_2s_sample_index']==90


def test_old_receipt_is_not_linked_across_reset():
    m,b,s,d=fixture(barrier=99)
    s.passes=[SimpleNamespace(outcome='received',receiver_id=d['shots'][0]['player_id'],period=1,
        received_physics_ms=9800,raw_event_seq=5,semantic_seq=7,evidence=[])]
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    assert shot['last_confirmed_receipt'] is None


def test_old_keeper_contact_is_not_linked_across_reset():
    from timepitch.grf.physical_models import PhysicalEvent
    m,b,s,d=fixture(barrier=99)
    b[0].events.insert(0,PhysicalEvent(**native_event(seq=9,type='touch',sample_index=98,
        actual_time_ms=9800,actor_team=1,player=0)))
    b[0].contact_roles.insert(0,3)
    shot=api().diagnose_defense(m,iter(b),s,d)['shots'][0]
    assert shot['previous_opponent_keeper_contact'] is None
