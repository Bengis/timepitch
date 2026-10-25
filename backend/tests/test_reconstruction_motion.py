import importlib
import math

from historical_analysis_support import event, game
from timepitch.historical.participation import build_participation
from test_reconstruction_anchors import extract


def motion(match,events,period=1):
    module=importlib.import_module('timepitch.reconstruction.motion')
    profile=importlib.import_module('timepitch.reconstruction.models').MotionProfile()
    return module.reconstruct_period(match,period,extract(match,events),build_participation(match,events),profile)


def test_exact_subtick_anchor_survives_with_600_and_700_ticks():
    match,events=game([event(30,'Pass',ms=622,player=101,location=[12,20],**{'pass':{}})],ends=(2_000,2_000))
    result=motion(match,events)
    frames={f.period_ms:f for f in result.frames}
    assert {600,622,700} <= frames.keys()
    assert frames[622].ball==(10.5,17)
    assert any(x==10.5 and y==17 for _,x,y in frames[622].players)
    assert result.provenance=='synthetic_motion'


def test_long_ball_gap_is_unavailable_and_does_not_invent_actions():
    match,events=game([event(30,'Pass',ms=100,player=101,location=[12,20],**{'pass':{}}),
                       event(31,'Pass',ms=6_100,player=102,location=[24,20],**{'pass':{}})],ends=(8_000,2_000))
    result=motion(match,events)
    frame=next(f for f in result.frames if f.period_ms==3_000)
    assert frame.ball is None and frame.ball_reason=='ball_gap_over_5s'
    assert any(c.reason=='ball_gap_over_5s' for c in result.cuts)
    assert result.ball_unavailable_ms>=6_000


def test_impossible_player_velocity_or_acceleration_causes_explicit_cut():
    # 20m in1s violates speed; 2m in1s violates the 4m/s² rest-to-rest bound.
    for distance in (20,2):
        match,events=game([event(30,'Pressure',ms=1_000,player=101,location=[60,40]),
                           event(31,'Pressure',ms=2_000,player=101,location=[60+distance*120/105,40])],ends=(4_000,2_000))
        result=motion(match,events)
        assert any(c.entity_key=='statsbomb:101' and c.reason=='player_motion_limit' for c in result.cuts)
        assert any(a.entity_key=='statsbomb:101' and a.period_ms==2_000 and a.status=='conflict' for a in result.anchors)


def test_smooth_player_path_respects_speed_and_acceleration_between_cuts():
    match,events=game([event(30,'Pressure',ms=1_000,player=101,location=[60,40]),
                       event(31,'Pressure',ms=11_000,player=101,location=[72,40])],ends=(12_000,2_000))
    result=motion(match,events)
    # roster index1 is player101 in the synthetic lineup.
    samples=[(f.period_ms,next((x,y) for idx,x,y in f.players if idx==1)) for f in result.frames if 1_000<=f.period_ms<=11_000]
    velocities=[]
    for (ta,(xa,ya)),(tb,(xb,yb)) in zip(samples,samples[1:]):
        dt=(tb-ta)/1000
        velocities.append(((xa-xb)/dt,(ya-yb)/dt))
    assert max(math.hypot(*v) for v in velocities)<=9
    assert max(math.hypot(b[0]-a[0],b[1]-a[1])/.1 for a,b in zip(velocities,velocities[1:]))<=4.001


def test_dismissal_and_period_restart_are_not_hidden_by_resetting_eleven_players():
    match,events=game([event(30,'Bad Behaviour',ms=1_000,player=101,bad_behaviour={'card':{'name':'Red Card'}})],ends=(2_000,2_000))
    first,second=motion(match,events),motion(match,events,2)
    assert len(first.frames[0].players)==22
    assert len(next(f for f in first.frames if f.period_ms==1_000).players)==21
    assert len(second.frames[0].players)==21
    assert any(c.reason=='period_start' and c.from_ms==0 for c in second.cuts)


def test_simultaneous_incompatible_ball_points_are_conflicts_not_a_fake_average():
    match,events=game([event(30,'Pass',ms=1_000,player=101,location=[12,20],**{'pass':{}}),
                       event(31,'Pass',ms=1_000,player=102,location=[100,40],**{'pass':{}})],ends=(2_000,2_000))
    result=motion(match,events)
    assert next(f for f in result.frames if f.period_ms==1_000).ball is None
    assert all(a.status=='conflict' for a in result.anchors if a.entity_key=='ball')
