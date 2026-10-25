import math
import pytest
from spatial_fixtures import scene
from timepitch.simulation.spatial import Vec2, PlayerTarget
from timepitch.simulation.motion import step_world, capture_sample
from timepitch.simulation.tactics import targets_for


def test_long_run_turn_braking_and_pitch_edges_are_physically_continuous():
    world = scene()
    world.ball.carrier = None
    player = world.players[5]
    previous_sample = capture_sample(world)
    previous_speed = 0
    for target in [Vec2(100, 64), Vec2(1, 1), Vec2(104, 67), Vec2(52, 34)]:
        for _ in range(160):
            before = player.velocity
            step_world(world, {player.index: PlayerTarget(target, 'test')})
            speed = math.hypot(player.velocity.x, player.velocity.y)
            assert speed <= min(7+3*player.pace, 10.5)+.00001
            delta = math.hypot(player.velocity.x-before.x, player.velocity.y-before.y)/.25
            assert delta <= (5 if speed < math.hypot(before.x, before.y) else 4)+.00001
            assert 0 <= player.position.x <= 105 and 0 <= player.position.y <= 68
            sample = capture_sample(world)
            dx = sample.player_xy_mm[2*player.index]-previous_sample.player_xy_mm[2*player.index]
            dy = sample.player_xy_mm[2*player.index+1]-previous_sample.player_xy_mm[2*player.index+1]
            measured = math.hypot(dx, dy)/250
            assert abs(measured-speed) < .01
            assert -5.05 <= (measured-previous_speed)/.25 <= 4.05
            previous_sample, previous_speed = sample, measured


def test_possession_tactic_and_keeper_targets_never_reposition_bodies():
    world = scene()
    for _ in range(10): step_world(world, targets_for(world))
    before = [(p.position, p.velocity) for p in world.players]
    world.possession = 'away'
    world.config = world.config.model_copy(update={'away_tactic': 'press'})
    world.ball.position = Vec2(89, 8)
    targets = targets_for(world)
    assert before == [(p.position, p.velocity) for p in world.players]
    keeper = next(p for p in world.players if p.role == 'GK' and p.side == 'away')
    assert targets[keeper.index].position != world.ball.position
    step_world(world, targets)
    for player, (pos, _) in zip(world.players, before):
        assert math.hypot(player.position.x-pos.x, player.position.y-pos.y) <= 10.5*.25


def test_sample_is_canonical_without_mutating_world():
    world = scene()
    before = [(p.position, p.velocity) for p in world.players]
    sample = capture_sample(world)
    assert len(sample.player_xy_mm) == 44
    assert all(type(n) is int for n in sample.player_xy_mm)
    assert before == [(p.position, p.velocity) for p in world.players]
    with pytest.raises(ValueError): step_world(world, {}, 300)


def test_accelerating_along_touchline_preserves_braking_room_for_lateral_momentum():
    world = scene()
    world.ball.carrier = None
    player = world.players[1]
    player.position, player.velocity = Vec2(5.1745, 2.9153), Vec2(.7984, -3.6788)
    for i in range(30):
        before = player.velocity
        step_world(world, {1: PlayerTarget(Vec2(11.15+i*1.1, 1), 'support')})
        assert 0 <= player.position.y <= 68
        change = math.hypot(player.velocity.x-before.x, player.velocity.y-before.y)
        assert change <= (5 if player.velocity.length() < before.length() else 4)*.25+.00001
