"""Explicit native acceptance; synthetic reducer tests are separate."""
import os
from pathlib import Path
import pytest
from grf_native_helpers import ROOT,run_native_case

pytestmark=pytest.mark.skipif(os.getenv('TIMEPITCH_TEST_GRF')!='1',reason='Explicit native acceptance required')


@pytest.fixture
def native_dir():
    return Path(os.environ.get('TIMEPITCH_STATS_NATIVE_DIR',ROOT/'.local/grf-stats-native/Release'))


def test_pass_and_shot_are_actual_contacts(native_dir):
    passed=run_native_case('pass',native_dir)
    assert any(e['type']=='touch' and e['kind']=='short_pass' for e in passed['events'])
    shot=run_native_case('shot',native_dir)
    assert shot['actor_shot_contacts']>=1
    assert run_native_case('shot_without_ball',native_dir)['actor_shot_contacts']==0


@pytest.mark.parametrize('case,own',[('goal',False),('own_goal',True)])
def test_goals_and_own_goals_use_native_adjudication(native_dir,case,own):
    result=run_native_case(case,native_dir)
    goals=[e for e in result['events'] if e['type']=='goal']
    assert len(goals)==sum(result['score'])>=1
    assert any(e['own_goal']==own for e in goals)
    for e in goals:
        assert e['player']==-1 or e['actor_team']==(1-e['team'] if e['own_goal'] else e['team'])


@pytest.mark.parametrize('case,kind',[('corner','corner'),('offside','offside'),('penalty','penalty')])
def test_native_decisions_are_once_per_incident(native_dir,case,kind):
    events=run_native_case(case,native_dir)['events']
    matching=[e for e in events if e['type']=='decision' and e['kind']==kind]
    assert len(matching)>=1
    assert len({(e['incident_id'],e['stage']) for e in matching})==len(matching)


def test_action_identity_survives_repeated_contacts(native_dir):
    events=run_native_case('pass',native_dir)['events']
    touches=[e for e in events if e['type']=='touch']
    assert touches and all(e['action_id']>=0 for e in touches)
    assert len({(e['team'],e['player'],e['action_id']) for e in touches})>1


def test_native_order_geometry_and_overflow(native_dir):
    result=run_native_case('three_contacts',native_dir,capacity=2)
    assert result['overflowed'] is True and result['emitted_count']>2
    assert len(result['events'])==2
    assert [e['seq'] for e in result['events']]==[0,1]
    for event in result['events']:
        assert all(k in event for k in ('match_time_ms','actual_time_ms','phase','actor_xy','ball_xyz','mirrored','ball_mirrored'))


def test_native_foul_preserves_infractor_and_victim(native_dir):
    events=run_native_case('foul',native_dir)['events']
    fouls=[e for e in events if e['type']=='decision' and e['kind']=='foul']
    assert {e['stage'] for e in fouls}=={'accepted','sanctioned'}
    assert len({e['incident_id'] for e in fouls})==1
    assert all(e['actor_team']==0 and e['victim_team']==1 and e['victim_player']>=0 for e in fouls)


def test_native_attack_direction_and_contact_frame(native_dir):
    result=run_native_case('pass',native_dir)
    touches=[e for e in result['events'] if e['type']=='touch']
    assert touches and all(e['attack_direction']==[1,-1] for e in touches)
    for e in touches:
        actor_sign=(-1 if e['actor_team']==1 else 1)*(-1 if e['mirrored'] else 1)
        ball_sign=-1 if e['ball_mirrored'] else 1
        assert sum((actor_sign*a-ball_sign*b)**2 for a,b in zip(e['actor_xy'],e['ball_xyz'])) < .08**2


def test_native_halves_and_disabled_telemetry(native_dir):
    events=run_native_case('halves',native_dir)['events']
    assert {e['phase'] for e in events}=={1,2}
    assert run_native_case('disabled',native_dir)['events']==[]


def test_repeated_contacts_have_one_animation_identity(native_dir):
    from collections import Counter
    events=run_native_case('match',native_dir)['events']
    counts=Counter((e['team'],e['player'],e['action_id']) for e in events if e['type']=='touch')
    assert any(n>1 for n in counts.values())


def test_native_referee_advantage_on_a_controlled_standing_trip(native_dir):
    # Calls the real arbiter's standing-collision input with real nearby players.
    # This is native-arbiter acceptance, not a claim of a naturally occurring trip.
    events=run_native_case('advantage',native_dir)['events']
    fouls=[e for e in events if e['type']=='decision' and e['kind']=='foul']
    assert any(e['stage']=='accepted' for e in fouls)
    assert any(e['stage']=='advantage_played' for e in fouls)
