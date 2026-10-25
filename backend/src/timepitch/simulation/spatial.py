"""Persistent spatial state in metres; renderer and action resolution only observe it."""
from dataclasses import dataclass, field
from math import hypot
from .models import MatchConfig, PlayerFrame, Point, RenderFrame, Score


@dataclass(frozen=True, slots=True)
class Vec2:
    x: float = 0.
    y: float = 0.

    def distance(self, other): return hypot(self.x-other.x, self.y-other.y)
    def length(self): return hypot(self.x, self.y)


@dataclass(slots=True)
class PlayerTarget:
    position: Vec2
    responsibility: str


@dataclass(slots=True)
class MovingPlayer:
    index: int
    key: str
    name: str
    side: str
    role: str
    pace: float
    attributes: dict
    position: Vec2 = field(default_factory=Vec2)
    velocity: Vec2 = field(default_factory=Vec2)
    target: Vec2 = field(default_factory=Vec2)
    responsibility: str = 'shape'

    @property
    def max_speed(self): return min(7+3*self.pace, 10.5)


@dataclass(slots=True)
class BallFlight:
    kind: str
    actor: int
    receiver: int | None
    target: Vec2
    speed: float
    action_id: str
    origin: Vec2
    released_ms: int
    origin_sample_index: int
    arrival_ms: int
    outcome: str = ''
    simulated_xg: float = 0.


@dataclass(slots=True)
class BallBody:
    position: Vec2 = field(default_factory=lambda: Vec2(52.5, 34))
    velocity: Vec2 = field(default_factory=Vec2)
    mode: str = 'controlled'
    carrier: int | None = None
    flight: BallFlight | None = None


@dataclass(slots=True)
class SpatialWorld:
    config: MatchConfig
    profiles: dict
    players: list[MovingPlayer]
    ball: BallBody = field(default_factory=BallBody)
    clock: int = 0
    period: int = 1
    possession: str = 'home'
    home_goals: int = 0
    away_goals: int = 0

    def direction(self, side):
        return 1 if (side == 'home') == (self.period == 1) else -1

    def snapshot(self):
        return RenderFrame(players=[PlayerFrame(key=p.key, name=p.name, role=p.role, side=p.side,
            x=round(p.position.x, 3), y=round(p.position.y, 3)) for p in self.players],
            ball=Point(x=round(self.ball.position.x, 3), y=round(self.ball.position.y, 3)),
            carrier=self.players[self.ball.carrier].key if self.ball.carrier is not None else None,
            possession=self.possession, clock_ms=self.clock, period=self.period,
            score=Score(home=self.home_goals, away=self.away_goals))


def initial_world(config, teams, profiles) -> SpatialWorld:
    players = []
    for side in ('home', 'away'):
        people = {p.key: p for p in teams[side].players}
        for profile in profiles[side].players:
            players.append(MovingPlayer(len(players), side+':'+profile.player_key,
                people[profile.player_key].name, side, profile.role, profile.attributes['pace'], profile.attributes))
    world = SpatialWorld(config, profiles, players)
    arrange_restart(world, 'home', centered=True)
    return world


def arrange_restart(world, side, centered):
    """Only called by causal kickoff/interval/restart events, never by live movement."""
    from .tactics import targets_for
    world.possession = side
    world.ball.flight = None
    world.ball.position = Vec2(52.5, 34)
    world.ball.carrier = None
    world.ball.mode = 'restart'
    targets = targets_for(world)
    for player in world.players:
        player.position = targets[player.index].position
        player.velocity = Vec2()
        player.target = player.position
    candidates = [p for p in world.players if p.side == side and p.role == ('MID' if centered else 'GK')]
    carrier = min(candidates, key=lambda p: (p.position.distance(Vec2(52.5, 34)), p.index))
    if centered:
        # Kickoff formation stays in each half. This is an explicit reset, not a run.
        for player in world.players:
            x = player.position.x
            x = min(x, 51.5) if world.direction(player.side) == 1 else max(x, 53.5)
            player.position = Vec2(x, player.position.y)
        carrier.position = Vec2(52.5, 34)
    world.ball.carrier = carrier.index
    world.ball.position = carrier.position
    world.ball.velocity = Vec2()
    carrier.target, carrier.responsibility = carrier.position, 'hold'
