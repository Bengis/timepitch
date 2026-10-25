"""Fidelity boundaries use the real shared C++ assignment solver."""
from copy import deepcopy
from dataclasses import replace
import importlib
import importlib.util
import json

import pytest
from test_grf_coordination_policy import policy, scenario, previous, player_at
from timepitch.grf.coordination_models import CoordinationState,Point


def api():
    assert importlib.util.find_spec('timepitch.grf.coordination_shadow'), 'Missing fidelity-labelled shadow'
    return importlib.import_module('timepitch.grf.coordination_shadow')


def snapshot(kind='retained_frame',inp=None,state=None):
    m=api();inp=inp or scenario()
    identity=m.SampleIdentity('c4/01','a'*64,'b'*64,10,inp.time_ms,inp.period,0,1)
    return m.seal_snapshot(m.ShadowSnapshot(kind,identity,identity,inp.players,Point(0,0),inp.team,inp.dynamic_side,
        native_input=inp if kind in ('synthetic_fixture','native_transaction') else None,
        native_state=state if kind in ('synthetic_fixture','native_transaction') else None,
        state_origin=('synthetic_fixture' if kind=='synthetic_fixture' else 'native_assignment_transaction')
            if state is not None and kind in ('synthetic_fixture','native_transaction') else 'unavailable'))


def evaluate(policy,s):return api().evaluate_shadow(s,api().CppPolicy(policy))


def test_c4_missing_Q_and_formation_is_not_exact_replay(policy):
    r=evaluate(policy,snapshot()).as_dict()
    assert r['decision_fidelity']=='geometric_projection'
    for field in ('native_quality','native_formations','native_ownership','commitments','native_threat_ranking'):
        assert r['input_coverage'][field]=='unavailable'
    assert r['responsibilities']['native_marks'] is None and r['responsibilities']['cover'] is None
    assert r['metrics']['constrained_quality'] is None


def test_nearest_ids_not_used_as_previous_marks(policy):
    m=api();s=snapshot();s=m.seal_snapshot(replace(s,cached_targets=({'geometrically_nearest_opponent':100},)))
    r=evaluate(policy,s).as_dict()
    assert r['responsibilities']['native_marks'] is None
    assert r['responsibilities']['projected_continuity']=='cold_start_without_native_history'
    assert r['responsibilities']['cover'] is None


def test_sparse_probe_cache_not_atomic_state(policy):
    s=snapshot('probe_cache')
    r=evaluate(policy,s).as_dict()
    assert r['decision_fidelity']=='unavailable'
    assert r['responsibilities']['native_marks'] is None
    assert 'cache_is_not_atomic_state' in r['reasons']


def test_shadow_does_not_predict_goals_or_change_replay(policy):
    s=snapshot();before=deepcopy(s);r=evaluate(policy,s).as_dict()
    assert s==before
    for forbidden in ('predicted_goals','predicted_distance','calibrated','qualified','counterfactual_score'):
        assert forbidden not in json.dumps(r)


@pytest.mark.parametrize('field,value',[('source_sha256','c'*64),('trace_hash','c'*64),('sample_index',11),('physics_ms',1100),('period',2),('relocation_id',1)])
def test_source_and_sample_identity_bound(policy,field,value):
    s=snapshot();s=replace(s,identity=replace(s.identity,**{field:value}))
    with pytest.raises(ValueError,match='identity'):evaluate(policy,s)


def test_changed_sample_payload_cannot_reuse_binding(policy):
    s=snapshot();s=replace(s,ball_position=Point(3,0))
    with pytest.raises(ValueError,match='payload'):evaluate(policy,s)


@pytest.mark.parametrize('kind,fidelity',[('synthetic_fixture','synthetic_exact'),('native_transaction','native_snapshot_exact')])
def test_complete_snapshot_uses_same_native_Q_for_global_and_greedy(policy,kind,fidelity):
    inp=replace(scenario(),quality=((.90,.89,0),(.88,.10,0),(0,0,1)))
    r=evaluate(policy,snapshot(kind,inp,CoordinationState())).as_dict()
    assert r['decision_fidelity']==fidelity
    assert r['metrics']['unconstrained_quality']==pytest.approx(2.77)
    assert r['metrics']['greedy_quality']==pytest.approx(2.0)
    assert r['metrics']['constrained_quality']==pytest.approx(2.77)
    assert r['responsibilities']['projected_marks'] is None


def test_constraints_may_trade_quality_for_commitment(policy):
    inp=replace(scenario(2,2),time_ms=799,quality=((.1,.9),(.9,.1)))
    r=evaluate(policy,snapshot('synthetic_fixture',inp,previous(inp,((0,100,0),(1,101,0))))).as_dict()
    assert r['metrics']['unconstrained_quality']==pytest.approx(1.8)
    assert r['metrics']['constrained_quality']==pytest.approx(.2)


def test_geometric_projection_uses_no_fake_native_formation(policy):
    inp=scenario(3,2)
    inp=player_at(inp,100,position=Point(-40,0));inp=player_at(inp,101,position=Point(-30,0))
    r=evaluate(policy,snapshot(inp=inp)).as_dict()
    assert len(r['responsibilities']['projected_marks'])==2
    assert r['responsibilities']['proposed_formation_targets'] is None
    assert r['metrics']['projected_quality'] is not None
    assert r['metrics']['unconstrained_quality'] is None


def test_missing_native_state_cannot_claim_exact_continuity(policy):
    r=evaluate(policy,snapshot('native_transaction',scenario(),None)).as_dict()
    assert r['decision_fidelity']=='geometric_projection'
    assert r['input_coverage']['native_ownership']=='unavailable'


def test_missing_geometry_is_unavailable_not_zero_coverage(policy):
    m=api();s=m.seal_snapshot(replace(snapshot(),players=()))
    r=evaluate(policy,s).as_dict()
    assert r['decision_fidelity']=='unavailable'
    assert r['metrics']['actual_central_presence'] is None


def test_invalid_native_snapshot_is_rejected_without_fallback_claim(policy):
    inp=replace(scenario(),quality=((float('nan'),.5,.5),(.5,.5,.5),(.5,.5,.5)))
    with pytest.raises(ValueError):snapshot('native_transaction',inp,CoordinationState())


def test_phase2_full_outputs_are_unchanged_after_solver_extraction(policy):
    from test_grf_coordination_policy import run,ROOT
    old=json.loads((ROOT/'research/engine-evaluation/2026-10-18-grf-defensive-coordination/phase2-pure-validation.json').read_text())
    inp=replace(scenario(),quality=((.90,.89,0),(.88,.10,0),(0,0,1)))
    assert run(policy,inp)==old['examples']['global_assignment']
    guard=replace(scenario(2,1),quality=((.1,),(.9,)))
    for id,x in ((100,0),(0,-.876),(1,-15.576)):guard=player_at(guard,id,position=Point(x,0))
    assert run(policy,guard,previous(guard))==old['examples']['close_to_distant_guard']
    cover=player_at(scenario(4),3,formation=Point(3,15),position=Point(0,12))
    assert run(policy,cover)==old['examples']['cover_projection']


def test_between_ticks_has_no_fabricated_new_objective(policy):
    inp=replace(scenario(),time_ms=200,assignment_tick=False)
    r=evaluate(policy,snapshot('synthetic_fixture',inp,previous(inp))).as_dict()
    assert r['metrics']['constrained_objective'] is None


def test_native_cover_target_and_observed_role_presence_are_separate(policy):
    inp=player_at(scenario(4),3,formation=Point(-1,0),position=Point(10,15))
    state=previous(inp,cover_id=3,cover_target=Point(-1,0))
    r=evaluate(policy,snapshot('native_transaction',inp,state)).as_dict()
    assert r['responsibilities']['cover']['status']=='proposed_target_not_observed_coverage'
    assert r['metrics']['actual_cover_role_presence'] is False


@pytest.mark.parametrize('ineligible',['keeper','manual','ball_contest'])
def test_ineligible_cover_role_is_not_counted_from_position_alone(policy,ineligible):
    inp=player_at(scenario(4),3,formation=Point(-1,0),position=Point(-1,0),**{ineligible:True})
    state=previous(inp,cover_id=3,cover_target=Point(-1,0))
    r=evaluate(policy,snapshot('native_transaction',inp,state)).as_dict()
    assert r['metrics']['actual_cover_role_presence'] is False


def test_isolated_native_shadow_state_is_not_observed_gameplay_ownership(policy):
    m=api();s=snapshot('native_transaction',scenario(),previous(scenario()))
    s=m.seal_snapshot(replace(s,state_origin='isolated_native_shadow'))
    r=evaluate(policy,s).as_dict()
    assert r['decision_fidelity']=='native_snapshot_exact'
    assert r['input_coverage']['native_ownership']=='unavailable'
    assert r['responsibilities']['native_marks'] is None
    assert r['responsibilities']['observed_prior_marks'] is None
    assert r['responsibilities']['supplied_policy_prior_marks']==[dict(owner=0,target=100,committed_ms=0)]


def test_unknown_policy_state_origin_cannot_claim_exact_native_snapshot(policy):
    m=api();s=snapshot('native_transaction',scenario(),CoordinationState())
    s=m.seal_snapshot(replace(s,state_origin='unavailable'))
    r=evaluate(policy,s).as_dict()
    assert r['decision_fidelity']=='geometric_projection'


@pytest.mark.parametrize('flag',['defending','play_eligible'])
def test_cover_presence_requires_current_defensive_play_eligibility(policy,flag):
    inp=player_at(scenario(4),3,formation=Point(-1,0),position=Point(-1,0))
    inp=replace(inp,**{flag:False})
    state=previous(inp,cover_id=3,cover_target=Point(-1,0))
    r=evaluate(policy,snapshot('native_transaction',inp,state)).as_dict()
    assert r['metrics']['actual_cover_role_presence'] is False


def test_prior_half_state_is_not_current_observed_ownership(policy):
    inp=player_at(scenario(4),3,formation=Point(-1,0),position=Point(-1,0))
    state=previous(inp,cover_id=3,cover_target=Point(-1,0))
    r=evaluate(policy,snapshot('native_transaction',replace(inp,period=2,dynamic_side=1),state)).as_dict()
    assert r['decision_fidelity']=='native_snapshot_exact'
    assert r['responsibilities']['native_marks'] is None
    assert r['input_coverage']['native_ownership']=='unavailable'
    assert r['metrics']['actual_cover_role_presence'] is None


def test_retained_probe_identity_uses_replay_half_and_relocation(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from grf_physical_fixtures import row
    m=api()
    manifest={'trace_hash':'b'*64,'input':{'players':[dict(side=side,slot=slot,role='GK' if slot==0 else 'DEF')
        for side in ('home','away') for slot in range(11)]}}
    raw=row(10,1000,in_play=1)
    shots=[dict(origin='open_play_shot',actor_team=0,period=1,raw_event_seq=i,
        context=dict(available=True,frame_sample_index=10,attack_direction=1)) for i in range(524)]
    baseline=SimpleNamespace(id='T-actions',manifest=manifest,chunks=lambda:iter([SimpleNamespace(samples=[row(200,20000,period=2,relocation_id=7)])]))
    fixture=SimpleNamespace(id='c4/01',manifest=manifest,actions={'shots':shots},chunks=lambda:iter([SimpleNamespace(samples=[raw])]))
    inputs=SimpleNamespace(fixtures=[baseline,fixture],probe_frames=[dict(sample_index=200,physics_ms=20000,records=[])],provenance={})
    monkeypatch.setattr(m,'load_evidence_inputs',lambda project:inputs)
    for relative in (m.CONTINUATION+'/evidence/c4/calibration/01/manifest.json','.local/grf-physical-work/defensive-probe/evidence/D-defense-42/defense.jsonl'):
        path=tmp_path/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('{}')
    snapshots,_=m.retained_snapshots(tmp_path)
    assert len(snapshots)==525
    assert snapshots[-1].identity.period==2 and snapshots[-1].identity.relocation_id==7
