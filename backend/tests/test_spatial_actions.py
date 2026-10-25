from math import ceil
import random
import pytest
from spatial_fixtures import scene
from timepitch.simulation.spatial import Vec2
from timepitch.simulation.actions import accessible_players, claim_control, begin_pass, resolve_flight, begin_shot
from timepitch.simulation.motion import step_world
from timepitch.simulation.tactics import targets_for


def controlled_scene():
    world = scene()
    for p in world.players: p.position, p.velocity, p.target = Vec2(10, 5), Vec2(), Vec2(10, 5)
    actor, receiver, rival = world.players[5], world.players[6], world.players[17]
    actor.position = Vec2(50, 34)
    receiver.position, receiver.velocity = Vec2(60, 34), Vec2(1, 0)
    rival.position = Vec2(90, 34)
    world.ball.position, world.ball.carrier, world.ball.mode = actor.position, actor.index, 'controlled'
    return world, actor, receiver, rival


def test_pass_flies_to_moving_receiver_without_moving_any_body_to_justify_it():
    world, actor, receiver, rival = controlled_scene()
    before = [p.position for p in world.players]
    begin_pass(world, receiver.index, 'e0001', 0)
    assert world.ball.flight.target.x > 60
    assert [p.position for p in world.players] == before
    assert world.ball.carrier is None
    while world.clock < world.ball.flight.arrival_ms:
        step_world(world, targets_for(world))
    before = [p.position for p in world.players]
    result = resolve_flight(world, random.Random(42))
    assert result.winner == receiver.index
    assert [p.position for p in world.players] == before
    assert world.ball.position == receiver.position


def test_only_players_with_spatial_access_can_recover_the_ball():
    world, actor, receiver, rival = controlled_scene()
    world.ball.carrier = None
    world.ball.position = Vec2(59.8, 34)
    assert [p.index for p in accessible_players(world)] == [receiver.index]
    with pytest.raises(ValueError): claim_control(world, rival.index)
    before = [p.position for p in world.players]
    claim_control(world, receiver.index)
    assert [p.position for p in world.players] == before
    assert world.ball.position == receiver.position


@pytest.mark.parametrize('boundary', [2700000, 5400000])
def test_shot_resolving_on_a_boundary_does_not_teleport_keeper(boundary):
    world, actor, receiver, rival = controlled_scene()
    actor.position = Vec2(100, 34)
    world.ball.position = actor.position
    world.clock = boundary-250
    keeper = next(p for p in world.players if p.side == 'away' and p.role == 'GK')
    keeper.position = Vec2(103, 34)
    assert begin_shot(world, random.Random(31), 'e0001', 0, boundary)
    while world.clock < boundary: step_world(world, targets_for(world))
    before = [p.position for p in world.players]
    result = resolve_flight(world, random.Random(2))
    assert result.kind == 'shot'
    assert result.outcome == 'goal'
    assert [p.position for p in world.players] == before
    if result.outcome == 'saved':
        assert result.winner == keeper.index
        assert world.ball.position.distance(keeper.position) <= 1.8


def test_save_requires_keeper_access_at_resolution():
    world, actor, receiver, rival = controlled_scene()
    actor.position = Vec2(90, 34)
    world.ball.position = actor.position
    actor.attributes = {**actor.attributes, 'shooting': .5}
    for profile in world.profiles.values():
        profile.attack_rate = profile.concession_rate = 1
    keeper = next(p for p in world.players if p.side == 'away' and p.role == 'GK')
    keeper.attributes = {**keeper.attributes, 'keeping': 1.}
    keeper.position, keeper.target = Vec2(103, 34), Vec2(103, 34)
    assert begin_shot(world, random.Random(3), 'e0001', 0, 2700000)
    while world.clock < world.ball.flight.arrival_ms: step_world(world, {})
    before = [p.position for p in world.players]
    result = resolve_flight(world, random.Random(3))
    assert result.outcome == 'saved' and result.winner == keeper.index
    assert before == [p.position for p in world.players]


def test_ball_control_does_not_imply_an_endless_automatic_dribble():
    world, actor, receiver, rival = controlled_scene()
    actor.target, actor.responsibility = actor.position, 'hold'
    assert targets_for(world)[actor.index].position == actor.position
    actor.target, actor.responsibility = Vec2(58, 34), 'carry'
    for _ in range(60):
        assert targets_for(world)[actor.index].position == Vec2(58, 34)
        step_world(world, targets_for(world))
    assert actor.position.x == pytest.approx(58, abs=.01)
    assert world.ball.position == actor.position


def test_pass_duration_uses_the_recorded_millimetres_not_the_unrounded_metres():
    # 11.2498 m in floats (3 ticks) but 11.2502 m once both ends are stored in mm (4 ticks).
    world, actor, receiver, rival = controlled_scene()
    actor.position = world.ball.position = Vec2(50.0004, 34.0004)
    receiver.position, receiver.velocity = Vec2(42.0004, 41.9097), Vec2()
    begin_pass(world, receiver.index, 'e0001', 0)
    origin = (round(actor.position.x*1000), round(actor.position.y*1000))
    target = (round(world.ball.flight.target.x*1000), round(world.ball.flight.target.y*1000))
    distance = ((target[0]-origin[0])**2+(target[1]-origin[1])**2)**.5
    assert world.ball.flight.arrival_ms-world.clock == max(250, ceil(distance/(15*250))*250) == 1000
