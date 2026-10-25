"""Exercise the real pure C++ coordinator, never a football process."""
from dataclasses import replace
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
HEADER = ROOT / 'research/engine-evaluation/2026-10-18-grf-defensive-coordination/native/coordination_policy.hpp'


@pytest.fixture(scope='module')
def policy(tmp_path_factory):
    if not HEADER.is_file():
        return None  # Let each behavior fail on the missing implementation.
    from timepitch.grf.coordination_shadow import compile_policy
    build = tmp_path_factory.mktemp('coordination-policy')
    return compile_policy(ROOT,build).executable


def scenario(n=3, threats=3):
    assert importlib.util.find_spec('timepitch.grf.coordination_models'), 'Missing mirrored wire models'
    from timepitch.grf.coordination_models import CoordinationInput, Player, Point
    players = tuple(Player(i, 0, position=Point(-20+i*5, 0), formation=Point(0, 30)) for i in range(n))
    players += tuple(Player(100+i, 1, position=Point(20+i*5, 0)) for i in range(threats))
    return CoordinationInput(1000, 1, 0, -1, players, tuple(100+i for i in range(threats)),
                             tuple(tuple(.5 for _ in range(threats)) for _ in range(n)), Point(0, 0))


def player_at(inp, id, **changes):
    return replace(inp, players=tuple(replace(p, **changes) if p.id == id else p for p in inp.players))


def run(policy, inp, state=None, *, override=None, raw=False):
    assert policy is not None, 'Missing pure coordination policy'
    from timepitch.grf.coordination_models import CoordinationState, encode_request
    wire = encode_request(inp, state or CoordinationState(), override=override)
    result = subprocess.run([str(policy)], input=wire.encode(), capture_output=True, timeout=5,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    return result.stdout if raw else json.loads(result.stdout)


def previous(inp, marks=((0, 100, 0),), **changes):
    from timepitch.grf.coordination_models import CoordinationState, Mark
    return CoordinationState(time_ms=0, assignment_ms=0, period=1, team=0, dynamic_side=-1,
                             marks=tuple(Mark(*m) for m in marks), **changes)


def pairs(result):
    return [(m['owner'], m['target']) for m in result['marks']]


def test_global_assignment_beats_greedy_fixture(policy):
    inp=replace(scenario(), quality=((.90,.89,0),(.88,.10,0),(0,0,1)))
    r=run(policy,inp)
    assert r['valid'] and pairs(r)==[(0,101),(1,100),(2,102)]
    assert r['objective']==pytest.approx(2.77)


def test_lexicographic_ties_ignore_input_row_order_and_repeat(policy):
    inp=scenario();a=run(policy,inp)
    assert pairs(a)==[(0,100),(1,101),(2,102)]
    assert run(policy,inp)==a
    assert run(policy,inp,raw=True)==run(policy,inp,raw=True)
    shuffled=replace(inp,players=(inp.players[2],inp.players[0],inp.players[1],*inp.players[3:]))
    assert run(policy,shuffled)==a


@pytest.mark.parametrize('time,want',[(799,[(0,100),(1,101)]),(800,[(0,101),(1,100)])])
def test_hold_799_and_release_800ms(policy,time,want):
    inp=replace(scenario(2,2),time_ms=time,quality=((.1,.9),(.9,.1)))
    r=run(policy,inp,previous(inp,((0,100,0),(1,101,0))))
    assert r['valid'] and pairs(r)==want
    assert [m['committed_ms'] for m in r['marks']]==([0,0] if time==799 else [800,800])


@pytest.mark.parametrize('quality,want',[(.59,0),(.60,0),(.61,1)])
def test_switch_penalty_point10(policy,quality,want):
    inp=replace(scenario(2,1),quality=((.5,),(quality,)))
    assert pairs(run(policy,inp,previous(inp)))==[(want,100)]


@pytest.mark.parametrize('old,new,want',[(.876,15.576,0),(2,6.001,0),(2,6,1),(2.001,6.001,1)])
def test_close_point876_to_distant15point576_and_guard_boundaries_2_and6m(policy,old,new,want):
    from timepitch.grf.coordination_models import Point
    inp=replace(scenario(2,1),quality=((.1,),(.9,)))
    inp=player_at(inp,100,position=Point(0,0))
    inp=player_at(inp,0,position=Point(-old,0));inp=player_at(inp,1,position=Point(-new,0))
    r=run(policy,inp,previous(inp));assert pairs(r)==[(want,100)]
    assert ('handover_guard' in r['reasons'])==(want==0)


@pytest.mark.parametrize('loss',['owner_inactive','target_inactive','rank_exit','play_ended','possession_ended'])
def test_inactive_target_and_rank_exit_release_immediately(policy,loss):
    inp=replace(scenario(2,2),time_ms=100,assignment_tick=False)
    if loss=='owner_inactive':inp=player_at(inp,0,active=False)
    elif loss=='target_inactive':inp=player_at(inp,100,active=False)
    elif loss=='rank_exit':inp=replace(inp,threat_ids=(101,),quality=((.5,),(.5,)))
    elif loss=='play_ended':inp=replace(inp,play_eligible=False)
    else:inp=replace(inp,defending=False)
    assert pairs(run(policy,inp,previous(inp)))==[]


@pytest.mark.parametrize('formation,want',[(12,True),(18,True),(18.001,False)])
def test_cover_projection_strip_and_six_metre_leash(policy,formation,want):
    from timepitch.grf.coordination_models import Point
    inp=player_at(scenario(4),3,formation=Point(-1,formation),position=Point(-1,12))
    r=run(policy,inp)
    assert (r['cover'] is not None)==want
    if want:assert r['cover']==dict(id=3,target=[-1,12])
    else:assert 'cover_unavailable' in r['reasons']


def test_previous_cover_preserved_and_valid_marker_not_stolen(policy):
    from timepitch.grf.coordination_models import Point
    inp=scenario(5)
    for id in (0,3,4):inp=player_at(inp,id,formation=Point(-2,0),position=Point(-2,0))
    state=previous(inp,cover_id=4,cover_target=Point(-2,0))
    r=run(policy,inp,state)
    assert r['cover']['id']==4 and (0,100) in pairs(r)


def test_infeasible_cover_dropped_before_relaxing_marks(policy):
    from timepitch.grf.coordination_models import Point
    inp=player_at(scenario(),0,formation=Point(-1,0))
    r=run(policy,inp)
    assert len(r['marks'])==3 and r['cover'] is None
    assert 'cover_dropped_for_marks' in r['reasons']


def test_mirrored_goal_side_target_and_decisions(policy):
    from timepitch.grf.coordination_models import Point
    inp=player_at(scenario(4),3,formation=Point(3,15),position=Point(0,12))
    inp=replace(inp,ball_100ms=Point(0,0))
    a=run(policy,inp)
    mirrored=replace(inp,dynamic_side=1,players=tuple(replace(p,position=Point(-p.position.x,-p.position.y),
        formation=Point(-p.formation.x,-p.formation.y) if p.formation is not None else None) for p in inp.players))
    b=run(policy,mirrored)
    assert pairs(a)==pairs(b) and a['objective']==b['objective']
    assert a['cover']==dict(id=3,target=[0,12])
    assert b['cover']==dict(id=3,target=[0,-12])


def test_hunt_excludes_markers_cover_keeper_and_native_ineligible(policy):
    from timepitch.grf.coordination_models import Point
    inp=scenario(9)
    inp=player_at(inp,3,formation=Point(-1,0))
    inp=player_at(inp,4,keeper=True);inp=player_at(inp,5,hunt_eligible=False)
    inp=player_at(inp,6,position=Point(1,0));inp=player_at(inp,7,position=Point(2,0))
    r=run(policy,inp,previous(inp,((0,100,0),(1,101,0),(2,102,0))))
    assert r['cover']['id']==3 and r['hunts']==[6,7]
    assert len({*r['hunts'],r['cover']['id'],*(m['owner'] for m in r['marks'])})==6


@pytest.mark.parametrize('kind',['manual','ball_contest'])
def test_override_releases_immediately_without_replacement_until_tick(policy,kind):
    from timepitch.grf.coordination_models import Point
    inp=scenario(5);state=previous(inp,cover_id=3,cover_target=Point(-1,0),hunts=(4,))
    r=run(policy,inp,state,override=(3,100,kind))
    assert r['state']['cover_id']==-1 and r['state']['marks']==[dict(owner=0,target=100,committed_ms=0)]
    assert r['state']['assignment_ms']==0 and r['state']['degraded_since_ms']==100
    assert state.cover_id==3
    inp=player_at(replace(inp,time_ms=200,assignment_tick=False),3,**{kind:True})
    from timepitch.grf.coordination_models import CoordinationState
    mid=run(policy,inp,CoordinationState.from_dict(r['state']))
    assert mid['cover'] is None and pairs(mid)==[(0,100)]
    final=run(policy,replace(inp,time_ms=400,assignment_tick=True),CoordinationState.from_dict(mid['state']))
    assert 3 not in [m['owner'] for m in final['marks']]+final['hunts']


def test_fewer_outfield_players_keep_feasible_marks_with_explicit_degradation(policy):
    r=run(policy,scenario(2,3))
    assert r['valid'] and len(r['marks'])==2 and r['cover'] is None
    assert 'marks_degraded' in r['reasons'] and 'cover_unavailable' in r['reasons']


def test_opposing_keeper_is_not_silently_removed_from_native_threats(policy):
    inp=player_at(scenario(1,1),100,keeper=True)
    assert pairs(run(policy,inp))==[(0,100)]


@pytest.mark.parametrize('failure',['nan','inf','range','shape','duplicate_player','duplicate_threat','missing_threat','same_team','side','clock','state_duplicate','formation'])
def test_invalid_inputs_are_rejected_without_plausible_assignments(policy,failure):
    from timepitch.grf.coordination_models import Point
    inp=scenario();state=None
    if failure in ('nan','inf','range'):inp=replace(inp,quality=((float(failure) if failure!='range' else 1.1,.5,.5),(.5,.5,.5),(.5,.5,.5)))
    elif failure=='shape':inp=replace(inp,quality=((.5,),))
    elif failure=='duplicate_player':inp=replace(inp,players=inp.players+(inp.players[0],))
    elif failure=='duplicate_threat':inp=replace(inp,threat_ids=(100,100,102))
    elif failure=='missing_threat':inp=replace(inp,threat_ids=(100,101,999))
    elif failure=='same_team':inp=replace(inp,threat_ids=(100,101,0))
    elif failure=='side':inp=replace(inp,dynamic_side=0)
    elif failure=='clock':state=replace(previous(inp),time_ms=1001)
    elif failure=='state_duplicate':state=previous(inp,((0,100,0),(0,101,0)))
    else:inp=player_at(inp,0,formation=Point(float('nan'),0))
    r=run(policy,inp,state)
    assert not r['valid'] and r['marks']==[] and r['cover'] is None and r['hunts']==[]


def test_halftime_resets_holds_without_resetting_physics_time(policy):
    inp=replace(scenario(2,2),time_ms=100,period=2,dynamic_side=1,quality=((.1,.9),(.9,.1)))
    r=run(policy,inp,previous(inp,((0,100,0),(1,101,0))))
    assert pairs(r)==[(0,101),(1,100)] and 'period_reset' in r['reasons']


def test_python_wire_rejects_fractional_integer():
    assert importlib.util.find_spec('timepitch.grf.coordination_models'), 'Missing mirrored wire models'
    from timepitch.grf.coordination_models import encode_request, CoordinationState
    with pytest.raises(ValueError,match='integer'):encode_request(replace(scenario(),time_ms=1000.5),CoordinationState())


def test_early_tick_cannot_replace_an_overridden_mark(policy):
    from timepitch.grf.coordination_models import CoordinationState
    inp=replace(scenario(4,1),time_ms=1200)
    state=replace(previous(inp),time_ms=1000,assignment_ms=1000)
    released=run(policy,inp,state,override=(0,1100,'manual'))
    new_state=CoordinationState.from_dict(released['state'])
    early=run(policy,inp,new_state)
    assert early['valid'] and early['marks']==[] and early['state']['assignment_ms']==1000
    due=run(policy,replace(inp,time_ms=1400),new_state)
    assert len(due['marks'])==1


def test_missing_native_formation_is_invalid_instead_of_zero_target(policy):
    r=run(policy,player_at(scenario(4),3,formation=None))
    assert not r['valid'] and r['cover'] is None and r['marks']==[]


@pytest.mark.parametrize('role',['marker','hunter'])
def test_override_releases_all_responsibility_kinds_without_reassigning(policy,role):
    inp=scenario(5);state=previous(inp,hunts=(4,))
    r=run(policy,inp,state,override=(0 if role=='marker' else 4,100,'ball_contest'))
    assert r['valid']
    assert r['state']['marks']==([] if role=='marker' else [dict(owner=0,target=100,committed_ms=0)])
    assert r['state']['hunts']==([4] if role=='marker' else [])
    assert r['state']['degraded_since_ms']==100


def test_override_without_initialized_team_state_is_rejected(policy):
    r=run(policy,scenario(),override=(0,100,'manual'))
    assert not r['valid'] and not r['state']['valid']


def test_invalid_state_returns_noncommittable_finite_result(policy):
    from timepitch.grf.coordination_models import Point
    inp=scenario()
    state=previous(inp,cover_id=3,cover_target=Point(float('nan'),0))
    r=run(policy,inp,state)
    assert not r['valid'] and not r['state']['valid']
    assert r['state']['marks']==[] and r['state']['cover_target']==[0,0]


def test_quality_rows_and_columns_follow_native_identity_not_sorted_ids(policy):
    inp=replace(scenario(),quality=((.90,.89,0),(.88,.10,0),(0,0,1)))
    reordered=replace(inp,players=(inp.players[2],inp.players[0],inp.players[1],*inp.players[3:]),
        threat_ids=(102,100,101),quality=((1,0,0),(0,.90,.89),(0,.88,.10)))
    r=run(policy,reordered)
    assert pairs(r)==[(0,101),(1,100),(2,102)] and r['objective']==pytest.approx(2.77)


def test_decision_wire_mirrors_real_output_and_immutable_next_state(policy):
    import timepitch.grf.coordination_models as models
    assert hasattr(models,'CoordinationDecision'), 'Missing immutable decision mirror'
    result=run(policy,scenario())
    decision=models.CoordinationDecision.from_dict(result)
    assert decision.valid and decision.version=='k1-coordination-1'
    assert [(m.owner,m.target) for m in decision.marks]==[(0,100),(1,101),(2,102)]
    assert decision.next_state.marks==decision.marks
    assert decision.cover is None and decision.hunts==()
    assert decision.next_state.time_ms==1000
    from dataclasses import FrozenInstanceError
    with pytest.raises(FrozenInstanceError):decision.next_state.time_ms=2000
