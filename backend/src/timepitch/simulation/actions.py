"""Action probabilities respond to position, statistical profiles and tactics."""
from dataclasses import dataclass, field


@dataclass
class Action:
    id: str
    t0_ms: int
    t1_ms: int
    type: str
    side: str | None
    participants: list[str]
    outcome: str
    evidence: dict = field(default_factory=dict)


def other(side):
    return 'away' if side == 'home' else 'home'


def advance_pass(ball_x, receiver_x, direction):
    progress = (receiver_x - ball_x) * direction
    return ball_x + direction * min(18, max(-10, progress))


def choose_action(state, rng):
    side = state.possession
    opponent = other(side)
    progress = state.ball_x if state.direction(side) == 1 else 105 - state.ball_x
    attack = state.profiles[side].attack_rate
    pressing = getattr(state.config, opponent + '_tactic') == 'press'
    counter = getattr(state.config, side + '_tactic') == 'counter'
    shot = (1.1 if progress > 73 else .08 if progress > 52 else .003) * attack
    return rng.choices(['pass', 'carry', 'pressure', 'tackle', 'shot'],
        weights=[8 if not counter else 5, 6 if not counter else 9, 9 if pressing else 1.3, 1.2, shot])[0]


def resolve_shot(state, shooter, rng):
    side = state.possession
    rival = other(side)
    distance = (105 - state.ball_x) if state.direction(side) == 1 else state.ball_x
    keeper = next(p for p in state.lineup(rival) if p.role == 'GK')
    quality = state.profiles[side].attack_rate * state.profiles[rival].concession_rate
    probability = min(.45, max(.015, (.045 + .16 * shooter.attributes['shooting']) * quality ** .5 * max(.2, 1 - distance / 65)))
    draw = rng.random()
    outcome = 'goal' if draw < probability else 'saved' if draw < probability + .40 * keeper.attributes['keeping'] else 'off_target'
    return outcome, round(probability, 5), keeper


# Spatial engine-2 actions. The old helpers above remain for legacy documentation/tests.
from math import ceil, hypot
from .spatial import Vec2, BallFlight

CONTROL_RADIUS = 1.8


def flight_duration(origin, target, speed):
    # Same millimetre ends the trace records and the validator re-measures; metre floats can
    # land on the other side of a 250 ms tick.
    distance = hypot(round(target.x*1000)-round(origin.x*1000), round(target.y*1000)-round(origin.y*1000))
    return max(250, ceil(distance/(speed*250))*250)


@dataclass
class FlightResult:
    kind: str
    actor: int
    receiver: int | None
    winner: int | None
    outcome: str
    simulated_xg: float


def accessible_players(world, radius=CONTROL_RADIUS, side=None):
    return sorted((p for p in world.players if (side is None or p.side == side)
                   and p.position.distance(world.ball.position) <= radius),
                  key=lambda p: (p.position.distance(world.ball.position), p.index))


def claim_control(world, index):
    player = world.players[index]
    if player.position.distance(world.ball.position) > CONTROL_RADIUS:
        raise ValueError('Player cannot access the ball')
    world.possession = player.side
    world.ball.carrier = index
    world.ball.position, world.ball.velocity = player.position, player.velocity
    world.ball.mode, world.ball.flight = 'controlled', None
    player.target, player.responsibility = player.position, 'hold'


def begin_pass(world, receiver_index, action_id, sample_index):
    actor = world.players[world.ball.carrier]
    receiver = world.players[receiver_index]
    if receiver.side != actor.side or receiver.index == actor.index: raise ValueError('Invalid receiver')
    distance = actor.position.distance(receiver.position)
    lead = min(1.2, distance/15)
    target = Vec2(max(1., min(104., receiver.position.x+receiver.velocity.x*lead)),
                  max(1., min(67., receiver.position.y+receiver.velocity.y*lead)))
    duration = flight_duration(actor.position, target, 15)
    world.ball.flight = BallFlight('pass', actor.index, receiver.index, target, 15., action_id,
        actor.position, world.clock, sample_index, world.clock+duration)
    world.ball.carrier, world.ball.mode = None, 'flight'


def begin_shot(world, rng, action_id, sample_index, boundary):
    actor = world.players[world.ball.carrier]
    rival = other(actor.side)
    keeper = next(p for p in world.players if p.side == rival and p.role == 'GK')
    distance = actor.position.distance(Vec2(105 if world.direction(actor.side) == 1 else 0, 34))
    quality = world.profiles[actor.side].attack_rate*world.profiles[rival].concession_rate
    probability = round(min(.5, max(.008, (.04+.19*actor.attributes['shooting'])*quality**.5
        *max(.12, 1-distance/55))), 5)
    draw = rng.random()
    outcome = 'goal' if draw < probability else 'saved' if draw < probability+.35*keeper.attributes['keeping'] else 'off_target'
    goal_x = 105. if world.direction(actor.side) == 1 else 0.
    if outcome == 'saved': target = keeper.position
    else: target = Vec2(goal_x, rng.uniform(31, 37) if outcome == 'goal' else rng.choice([23., 45.]))
    duration = flight_duration(actor.position, target, 26)
    if world.clock+duration > boundary: return False
    world.ball.flight = BallFlight('shot', actor.index, None, target, 26., action_id,
        actor.position, world.clock, sample_index, world.clock+duration, outcome, probability)
    world.ball.carrier, world.ball.mode = None, 'flight'
    return True


def resolve_flight(world, rng):
    flight = world.ball.flight
    if not flight or world.clock < flight.arrival_ms: raise ValueError('Flight has not arrived')
    actor = world.players[flight.actor]
    eligible = accessible_players(world)
    winner = None
    outcome = flight.outcome
    if flight.kind == 'pass':
        opponents = [p for p in eligible if p.side != actor.side]
        teammates = [p for p in eligible if p.side == actor.side and p.index != actor.index]
        if opponents and (not teammates or rng.random() > .72+.18*actor.attributes['passing']):
            winner = opponents[0].index
        elif teammates:
            winner = min(teammates, key=lambda p: (p.index != flight.receiver, p.position.distance(world.ball.position), p.index)).index
        outcome = 'complete' if winner is not None and world.players[winner].side == actor.side else 'intercepted' if winner is not None else 'incomplete'
    elif outcome == 'saved':
        keepers = [p for p in eligible if p.side != actor.side and p.role == 'GK']
        if keepers: winner = keepers[0].index
        else: outcome = 'off_target'
    result = FlightResult(flight.kind, flight.actor, flight.receiver, winner, outcome, flight.simulated_xg)
    world.ball.flight = None
    if winner is not None: claim_control(world, winner)
    return result
