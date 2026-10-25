"""Small diagnostic components, not claims of complete native admission."""
import importlib
import importlib.util
from types import SimpleNamespace
import pytest
from grf_action_fixtures import action_trace,held_24_then_one_hand_release,semantic
from grf_physical_fixtures import row
from grf_statistics_fixtures import native_event
from test_grf_action_statistics import prefix_result


def diagnose(manifest,blocks):
    name='timepitch.grf.action_diagnostics'
    assert importlib.util.find_spec(name) is not None,'Missing offline action diagnostics'
    reduced=prefix_result(manifest,blocks)
    summary=SimpleNamespace(**reduced,players=[],score=manifest.score,trace_hash=manifest.trace_hash,
                            input_hash=manifest.input.input_hash)
    return importlib.import_module(name).diagnose_actions(manifest,iter(blocks),summary)


def test_retained_contacts_are_not_new_passes():
    manifest,blocks=held_24_then_one_hand_release(complete=False)
    result=diagnose(manifest,blocks)
    assert result['raw_contacts']==26 and result['releases']['by_intent']=={'pass':1}
    assert result['retention']['episodes']==1 and result['retention']['closed']==1
    assert result['passes']['outcomes']=={'received':1}


def test_clearance_animation_is_not_an_offensive_shot():
    manifest,blocks=action_trace(events=[native_event(kind='shot',sample_index=1,actual_time_ms=100)],
        semantics=[semantic(intent='clearance',origin='emergency_clearance')])
    result=diagnose(manifest,blocks)
    assert result['raw_touch_kinds']=={'shot':1}
    assert result['releases']['by_intent']=={'clearance':1} and result['shots']==[]
    assert len(result['clearances'])==1


def test_unclassified_goal_remains_a_goal_without_fabricated_shot():
    manifest,blocks=action_trace(events=[native_event(type='goal',kind='goal',sample_index=1,
        actual_time_ms=100,score=(1,0))],semantics=[],roles=[0])
    result=diagnose(manifest,blocks)
    assert result['goals']['count']==1 and result['goals']['own_goals']==0
    assert result['goals']['events'][0]['linked_release_raw_seq'] is None
    assert result['shots']==[]


@pytest.mark.parametrize('barrier',['discontinuity','relocation','inactive'])
def test_spatial_context_never_bridges_reset_or_inactivity(barrier):
    rows=[row(0,0,in_play=1),row(1,100,elapsed=100,in_play=1)]
    if barrier=='discontinuity':rows[1][7]=1
    if barrier=='relocation':rows[1][19]=1
    if barrier=='inactive':rows[0][21+9*6+4]=0
    manifest,blocks=action_trace(rows=rows,semantics=[semantic(intent='shot',origin='open_play_shot')])
    result=diagnose(manifest,blocks)
    assert result['shots'][0]['context']['available'] is False


def test_spatial_context_does_not_bridge_halftime_without_physics_advance():
    from timepitch.grf.action_diagnostics import _context
    from timepitch.grf.physical_models import PhysicalEvent
    manifest,_=action_trace()
    people={(0 if p.side=='home' else 1,p.slot):p for p in manifest.input.players}
    before=row(27000,2700000,period=1,elapsed=2700000,in_play=1)
    after=row(27001,2700000,period=2,elapsed=0,in_play=1)
    raw=PhysicalEvent(**native_event(phase=2,sample_index=27001,actual_time_ms=2700000))
    assert _context(raw,before,after,people)['available'] is False


def test_partition_does_not_change_diagnostic_or_sample_links():
    outputs=[]
    for splits in ((),(1,5),(2,4,8)):
        manifest,blocks=held_24_then_one_hand_release(complete=False,splits=splits)
        result=diagnose(manifest,blocks)
        result.pop('trace_hash')  # The physical partition intentionally changes this identity.
        outputs.append(result)
    assert outputs[0]==outputs[1]==outputs[2]


def test_shot_geometry_uses_native_metres_and_attack_direction():
    rows=[row(0,0,in_play=1,home_9_x_m=40,away_0_x_m=54,away_0_y_m=1),
          row(1,100,elapsed=100,in_play=1,home_9_x_m=40,away_0_x_m=54,away_0_y_m=1)]
    raw=native_event(sample_index=1,actual_time_ms=80,actor_xy=(40/54.4,0),ball_xyz=(40/54.4,0,0))
    manifest,blocks=action_trace(rows=rows,events=[raw],semantics=[semantic(physics_ms=80,intent='shot',origin='open_play_shot')])
    context=diagnose(manifest,blocks)['shots'][0]['context']
    assert context['available'] and context['frame_sample_index']==0 and context['frame_age_ms']==80
    assert context['goal_distance_m']==pytest.approx(15)
    assert context['keeper_forward_m']==pytest.approx(1)
    assert context['keeper_lateral_m']==pytest.approx(1)


def test_input_or_summary_identity_mismatch_is_rejected():
    name='timepitch.grf.action_diagnostics'
    assert importlib.util.find_spec(name) is not None,'Missing offline action diagnostics'
    manifest,blocks=action_trace()
    summary=SimpleNamespace(trace_hash='changed',input_hash=manifest.input.input_hash,score=manifest.score)
    with pytest.raises(ValueError):importlib.import_module(name).diagnose_actions(manifest,iter(blocks),summary)


def test_goal_links_final_team_touch_even_if_animation_changed_during_flight():
    events=[native_event(kind='shot',sample_index=1,actual_time_ms=100,action_id=1),
            native_event(seq=1,type='goal',kind='goal',sample_index=2,actual_time_ms=200,action_id=999,score=(1,0))]
    manifest,blocks=action_trace(events=events,semantics=[semantic(intent='shot',origin='open_play_shot')],roles=[2,0])
    goal=diagnose(manifest,blocks)['goals']['events'][0]
    assert goal['linked_release_raw_seq']==0 and goal['linked_release_intent']=='shot'
    assert goal['animation_changed_after_contact'] is True


def test_intervening_nonrelease_team_touch_does_not_invent_shot_link():
    events=[native_event(kind='shot',sample_index=1,actual_time_ms=100),
            native_event(seq=1,kind='other',sample_index=2,actual_time_ms=180),
            native_event(seq=2,type='goal',kind='goal',sample_index=2,actual_time_ms=200,score=(1,0))]
    manifest,blocks=action_trace(events=events,semantics=[semantic(intent='shot',origin='open_play_shot')],roles=[2,6,0])
    assert diagnose(manifest,blocks)['goals']['events'][0]['linked_release_raw_seq'] is None


def test_precontact_frame_remains_valid_when_goal_stops_play_before_next_sample():
    rows=[row(0,0,in_play=1),row(1,100,elapsed=100,in_play=0)]
    manifest,blocks=action_trace(rows=rows,events=[native_event(sample_index=1,actual_time_ms=80)],
        semantics=[semantic(physics_ms=80,intent='shot',origin='open_play_shot')])
    context=diagnose(manifest,blocks)['shots'][0]['context']
    assert context['available'] and context['frame_sample_index']==0 and context['frame_age_ms']==80


def test_defender_activity_uses_same_precontact_frame_as_geometry():
    rows=[row(0,0,in_play=1,home_9_x_m=40,away_1_x_m=38),
          row(1,100,elapsed=100,in_play=1,home_9_x_m=40,away_1_x_m=38)]
    manifest,blocks=action_trace(rows=rows,events=[native_event(sample_index=1,actual_time_ms=80,
        actor_xy=(40/54.4,0))],semantics=[semantic(physics_ms=80,intent='shot',origin='open_play_shot')])
    blocks[0].activity[0][12]=2;blocks[0].activity[1][12]=3
    assert diagnose(manifest,blocks)['shots'][0]['context']['nearest_outfield_opponent_activity']=='walk'


def test_observations_do_not_claim_a_causal_candidate_or_delete_unknown_goals():
    manifest,blocks=action_trace(events=[native_event(type='goal',kind='goal',sample_index=1,actual_time_ms=100)],
        semantics=[],roles=[0])
    result=diagnose(manifest,blocks)
    assert result['candidate_ready'] is False
    assert result['hypotheses'] and all(h['status']!='causally_validated' for h in result['hypotheses'])
    assert result['hypotheses'][0]['evidence'][0]['raw_seq']==0
