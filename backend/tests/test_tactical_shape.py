import pytest
from spatial_fixtures import settled_midblock, team_extents, team_centroid_y
from timepitch.simulation.spatial import Vec2
from timepitch.simulation.tactics import targets_for
from timepitch.simulation.motion import step_world


@pytest.mark.parametrize('formation', ['4-4-2', '4-3-3', '3-5-2', '4-5-1'])
@pytest.mark.parametrize('tactic', ['balanced', 'press', 'counter'])
def test_midblock_has_connected_lines_and_shifts_with_ball(formation, tactic):
    center = settled_midblock(formation, tactic, Vec2(52.5, 34))
    length, width = team_extents(center, 'away')
    assert 24 <= length <= 32
    assert 32 <= width <= 44
    left = settled_midblock(formation, tactic, Vec2(52.5, 8))
    right = settled_midblock(formation, tactic, Vec2(52.5, 60))
    assert team_centroid_y(left, 'away')+8 < team_centroid_y(right, 'away')
    defensive = targets_for(center)
    center.possession = 'away'
    attacking = targets_for(center)
    outfield = [p.index for p in center.players if p.side == 'away' and p.role != 'GK']
    def width_of(targets):
        return max(targets[i].position.y for i in outfield)-min(targets[i].position.y for i in outfield)
    assert width_of(attacking) > width_of(defensive)


def test_settled_shape_has_no_lateral_drift_and_mirrors_both_halves():
    world = settled_midblock('4-4-2', 'balanced', Vec2(52.5, 34))
    y = team_centroid_y(world, 'away')
    for _ in range(80): step_world(world, targets_for(world))
    assert abs(team_centroid_y(world, 'away')-y) < .01
    first = targets_for(world)
    world.period = 2
    second = targets_for(world)
    for index in first:
        assert first[index].position.x+second[index].position.x == pytest.approx(105)
        assert first[index].position.y == second[index].position.y


def test_keeper_in_possession_retains_goal_support_objective():
    world = settled_midblock('4-4-2', 'balanced', Vec2(7, 34))
    keeper = world.players[0]
    world.ball.carrier, world.ball.mode = keeper.index, 'controlled'
    world.ball.position = keeper.position
    objective = targets_for(world)[keeper.index]
    assert objective.responsibility == 'goal_cover'
    assert objective.position.x <= 15


@pytest.mark.parametrize('formation', ['4-4-2', '3-5-2'])
def test_two_strikers_stay_central_while_midfield_provides_attacking_width(formation):
    world = settled_midblock(formation, 'balanced', Vec2(52.5, 34))
    objectives = targets_for(world)
    def width(role):
        ys = [objectives[p.index].position.y for p in world.players if p.side == 'home' and p.role == role]
        return max(ys)-min(ys)
    assert width('FWD') <= 24
    assert width('MID') >= 44


def test_three_midfielders_are_narrower_than_three_forwards_in_attack():
    world = settled_midblock('4-3-3', 'balanced', Vec2(52.5, 34))
    targets = targets_for(world)
    ys = {role: [targets[p.index].position.y for p in world.players if p.side == 'home' and p.role == role] for role in ('MID', 'FWD')}
    assert max(ys['MID'])-min(ys['MID']) <= 34
    assert max(ys['FWD'])-min(ys['FWD']) >= 44
