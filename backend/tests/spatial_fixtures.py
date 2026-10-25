"""Reusable, seeded tactical scenes, deliberately separate from live match data."""
from pathlib import Path
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config, select_lineup, _prepare
from timepitch.simulation.spatial import initial_world
from timepitch.simulation.tactics import targets_for
from timepitch.simulation.motion import step_world

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


def scene(formation='4-4-2', tactic='balanced'):
    catalog = CatalogRepository(DATASET)
    config = make_config(catalog, 'arsenal:2003', 'mancity:2017', 42)
    config = config.model_copy(update={side+'_'+name: value for side in ('home', 'away')
        for name, value in [('formation', formation), ('tactic', tactic),
                            ('players', select_lineup(catalog.get_team(getattr(config, side+'_key')), formation))]})
    state, teams = _prepare(config, catalog)
    return initial_world(config, teams, state.profiles)


def settled_midblock(formation, tactic, ball):
    world = scene(formation, tactic)
    world.ball.carrier = None
    world.ball.position = ball
    world.ball.mode = 'restart'
    for _ in range(80):
        step_world(world, targets_for(world))
    return world


def team_extents(world, side):
    people = [p.position for p in world.players if p.side == side and p.role != 'GK']
    return max(p.x for p in people)-min(p.x for p in people), max(p.y for p in people)-min(p.y for p in people)


def team_centroid_y(world, side):
    people = [p for p in world.players if p.side == side and p.role != 'GK']
    return sum(p.position.y for p in people)/len(people)
