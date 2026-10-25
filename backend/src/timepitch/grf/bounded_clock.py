"""Pure research clock; emitting a close request does not mutate native play."""
from dataclasses import dataclass, replace

from .physical_clock import (ClockObservation, ClockState, _advance_clock, _complete_period,
                             REGULAR_MS, MAX_LOSS_MS, SAFE_WAIT_MS)

POLICY = 'm1-bounded-whistle-1'
HALF_LIMIT_MS = REGULAR_MS+MAX_LOSS_MS+SAFE_WAIT_MS
MATCH_LIMIT_MS = 2*HALF_LIMIT_MS


@dataclass(frozen=True)
class BoundedObservation(ClockObservation):
    relocation_id: int = 0


@dataclass(frozen=True)
class BoundedClockState(ClockState):
    initialized: bool = False
    penalty_protected: bool = False
    relocation_id: int = 0
    target_ms: int|None = None
    deadline_ms: int|None = None


@dataclass(frozen=True)
class CloseRequest:
    period: int
    physics_ms: int
    reason: str


@dataclass(frozen=True)
class ClockDecision:
    state: BoundedClockState
    close: CloseRequest|None = None


class ClockLimitError(ValueError):
    """A protected episode cannot be converted into a complete match."""


def advance_bounded_clock(state:BoundedClockState, observation:BoundedObservation)->ClockDecision:
    if not isinstance(state,BoundedClockState) or not isinstance(observation,BoundedObservation):
        raise ValueError('Bounded clock state/observation required')
    o=observation
    for name in ('physics_ms','effective_ms','period','restart_id','restart_start_ms','relocation_id'):
        if type(getattr(o,name)) is not int or getattr(o,name)<0: raise ValueError('Invalid bounded clock integer')
    for name in ('in_play','restart_active','pending_penalty','discontinuity'):
        if type(getattr(o,name)) is not bool: raise ValueError('Invalid bounded clock flag')
    if o.pending_penalty != (o.restart_active and o.restart_cause=='penalty'):
        raise ValueError('Inconsistent native pending penalty')
    if o.physics_ms>MATCH_LIMIT_MS or o.physics_ms%100: raise ValueError('Physical clock cap/grid')
    if not state.initialized:
        if (o.physics_ms,o.effective_ms,o.period,o.relocation_id)!=(0,0,1,0):
            raise ValueError('Initial bounded observation must start at zero')
    elif o.physics_ms-state.physics_ms != (0 if o.period!=state.period else 100):
        raise ValueError('Fixed-step clock sequence gap')
    if o.relocation_id<state.relocation_id or (o.relocation_id!=state.relocation_id and not o.discontinuity):
        raise ValueError('Invalid relocation chronology')
    new=_advance_clock(state,o,enforce_safe_limit=False)
    if o.period!=state.period:
        return ClockDecision(replace(new,initialized=True,penalty_protected=False,
                                     relocation_id=o.relocation_id,target_ms=None,deadline_ms=None))
    target=REGULAR_MS+(new.announced_minimum_ms or 0)
    deadline=min(target+SAFE_WAIT_MS,HALF_LIMIT_MS)
    sample_deadline=100*((deadline+99)//100)
    if new.period_elapsed_ms>sample_deadline: raise ClockLimitError('Missed whistle deadline; no backdated close')
    protected=state.penalty_protected or o.pending_penalty or (o.restart_active and o.restart_cause=='penalty')
    if not o.in_play and not o.pending_penalty and not (o.restart_active and o.restart_cause=='penalty'):
        protected=False
    new=replace(new,initialized=True,penalty_protected=protected,relocation_id=o.relocation_id,
                target_ms=target,deadline_ms=deadline)
    if new.period_complete:
        return ClockDecision(new,CloseRequest(o.period,o.physics_ms,'natural_stoppage'))
    if new.period_elapsed_ms==sample_deadline:
        blocked=protected or o.pending_penalty or (o.restart_active and o.restart_cause in ('goal','penalty'))
        if blocked or not o.in_play: raise ClockLimitError('protected_restart_limit')
        return ClockDecision(_complete_period(new),CloseRequest(o.period,o.physics_ms,'bounded_open_play'))
    return ClockDecision(new)
