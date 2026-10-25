"""Immutable snapshots/wire for the pure C++ K1 policy; no Python solver."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    x: float = 0
    y: float = 0


@dataclass(frozen=True)
class Player:
    id: int
    team: int
    active: bool = True
    keeper: bool = False
    position: Point = Point()
    formation: Point | None = None
    hunt_eligible: bool = True
    manual: bool = False
    ball_contest: bool = False


@dataclass(frozen=True)
class Mark:
    owner: int
    target: int
    committed_ms: int


@dataclass(frozen=True)
class CoordinationState:
    time_ms: int = -1
    assignment_ms: int = -1
    period: int = 0
    team: int = -1
    dynamic_side: int = 0
    marks: tuple[Mark, ...] = ()
    cover_id: int = -1
    cover_target: Point = Point()
    hunts: tuple[int, ...] = ()
    degraded_since_ms: int = -1
    valid: bool = True
    last_override_player: int = -1
    last_override_ms: int = -1
    last_override_kind: str = 'none'

    @classmethod
    def from_dict(cls, value):
        value = dict(value)
        value['marks'] = tuple(Mark(**m) for m in value['marks'])
        value['cover_target'] = Point(*value['cover_target'])
        value['hunts'] = tuple(value['hunts'])
        return cls(**value)


@dataclass(frozen=True)
class CoordinationInput:
    time_ms: int
    period: int
    team: int
    dynamic_side: int
    players: tuple[Player, ...]
    threat_ids: tuple[int, ...]
    quality: tuple[tuple[float, ...], ...]
    ball_100ms: Point
    assignment_tick: bool = True
    play_eligible: bool = True
    defending: bool = True


@dataclass(frozen=True)
class Cover:
    id: int
    target: Point


@dataclass(frozen=True)
class CoordinationDecision:
    valid: bool
    version: str
    objective: float
    marks: tuple[Mark, ...]
    cover: Cover | None
    hunts: tuple[int, ...]
    reasons: tuple[str, ...]
    next_state: CoordinationState

    @classmethod
    def from_dict(cls, value):
        cover=value['cover']
        return cls(value['valid'],value['version'],value['objective'],
            tuple(Mark(**m) for m in value['marks']),
            None if cover is None else Cover(cover['id'],Point(*cover['target'])),
            tuple(value['hunts']),tuple(value['reasons']),CoordinationState.from_dict(value['state']))


def encode_request(inputs: CoordinationInput, state: CoordinationState, *, override=None) -> str:
    """K1V1 whitespace fixture wire; integers stay integers, Q stays native input.

    Quality rows follow own-team players in snapshot order; columns follow the
    unmodified ranked native threat list. Positions use metres, own-goal side
    is +/-1, and ball_100ms is a supplied prediction, never a future observation.
    This transport is for the standalone pure executable, not a native sidecar.
    """
    def integer(value):
        if type(value) is not int or not -(2**63) <= value < 2**63:
            raise ValueError('Expected bounded integer wire field')
        return str(value)

    def flag(value):
        if type(value) is not bool:
            raise ValueError('Expected boolean wire field')
        return str(int(value))

    def point(value):
        return [str(float(value.x)), str(float(value.y))]

    if len(inputs.players)>22 or len(inputs.threat_ids)>3 or len(inputs.quality)>22 or any(len(r)>3 for r in inputs.quality):
        raise ValueError('Snapshot exceeds fixed wire bounds')
    if len(state.marks)>3 or len(state.hunts)>2:
        raise ValueError('State exceeds fixed wire bounds')
    fields=['K1V1', 'override' if override is not None else 'coordinate']
    fields += [integer(v) for v in (inputs.time_ms, inputs.period, inputs.team, inputs.dynamic_side)]
    fields += [flag(v) for v in (inputs.assignment_tick, inputs.play_eligible, inputs.defending)]
    fields += point(inputs.ball_100ms)+[integer(len(inputs.players))]
    for p in inputs.players:
        fields += [integer(p.id),integer(p.team)]+[flag(v) for v in (p.active,p.keeper,p.hunt_eligible,p.manual,p.ball_contest)]
        fields += point(p.position)+[flag(p.formation is not None)]+point(p.formation or Point())
    fields += [integer(len(inputs.threat_ids))]+[integer(v) for v in inputs.threat_ids]+[integer(len(inputs.quality))]
    for row in inputs.quality:
        fields += [integer(len(row))]+[str(float(v)) for v in row]
    fields += [integer(v) for v in (state.time_ms,state.assignment_ms,state.period,state.team,state.dynamic_side)]
    fields += [flag(state.valid),integer(state.cover_id)]+point(state.cover_target)
    fields += [integer(state.degraded_since_ms),integer(state.last_override_player),integer(state.last_override_ms),state.last_override_kind]
    fields += [integer(len(state.marks))]
    for mark in state.marks:fields += [integer(v) for v in (mark.owner,mark.target,mark.committed_ms)]
    fields += [integer(len(state.hunts))]+[integer(v) for v in state.hunts]
    if override is not None:
        player,time,kind=override
        if kind not in ('manual','ball_contest'):raise ValueError('Invalid override kind')
        fields += [integer(player),integer(time),kind]
    return ' '.join(fields)+'\n'
