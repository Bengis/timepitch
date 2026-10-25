"""Portable physical-periods-1 clock. Native waits are explicit model assumptions."""
from dataclasses import dataclass, replace

REGULAR_MS=2700000
MAX_LOSS_MS=900000
SAFE_WAIT_MS=120000
RESTART_WAIT_MS={'none':0,'normal':0,'kickoff':0,'goal':30000,'corner':15000,
                 'goal_kick':20000,'throw_in':12000,'free_kick':20000,'penalty':45000}


@dataclass(frozen=True)
class ClockObservation:
    physics_ms:int
    period:int=1
    effective_ms:int=0
    in_play:bool=True
    restart_id:int=0
    restart_cause:str='none'
    restart_active:bool=False
    restart_start_ms:int=0
    pending_penalty:bool=False
    discontinuity:bool=False


@dataclass(frozen=True)
class RestartInterval:
    id:int
    cause:str
    start:int
    end:int
    eligible_loss_ms:int
    period:int


@dataclass(frozen=True)
class ClockState:
    physics_ms:int=0
    period:int=1
    period_elapsed_ms:int=0
    effective_ms:int=0
    allowance_ms:int=0
    announced_minimum_ms:int|None=None
    pending_penalty:bool=False
    finished:bool=False
    period_complete:bool=False
    ledger:tuple[RestartInterval,...]=()
    periods:tuple[dict,...]=()
    active_restart:int=0
    period_effective_start:int=0


def advance_clock(state:ClockState, observation:ClockObservation)->ClockState:
    return _advance_clock(state,observation,enforce_safe_limit=True)


def _complete_period(state:ClockState)->ClockState:
    period={'period':state.period,'duration_ms':state.period_elapsed_ms,'allowance_ms':state.allowance_ms,
            'announced_minimum_ms':state.announced_minimum_ms,
            'effective_ms':state.effective_ms-state.period_effective_start}
    return replace(state,period_complete=True,finished=state.period==2,periods=state.periods+(period,))


def _advance_clock(state:ClockState, observation:ClockObservation, *, enforce_safe_limit:bool)->ClockState:
    """Shared loss/transition arithmetic; legacy public behavior stays unchanged."""
    o=observation
    delta=o.physics_ms-state.physics_ms
    if (type(o.physics_ms) is not int or type(o.effective_ms) is not int or delta<0 or
        o.effective_ms<state.effective_ms or o.effective_ms-state.effective_ms>delta or
        o.period not in (1,2) or o.restart_cause not in RESTART_WAIT_MS or
        o.restart_start_ms<0 or o.restart_start_ms>o.physics_ms):
        raise ValueError('Invalid physical clock observation')
    if state.finished:raise ValueError('Match already finished')
    if o.period!=state.period:
        if not (state.period==1 and o.period==2 and state.period_complete and delta==0 and
                o.discontinuity and not o.in_play):
            raise ValueError('Invalid period transition')
        return replace(state,period=2,period_elapsed_ms=0,allowance_ms=0,announced_minimum_ms=None,
                       active_restart=0,period_complete=False,pending_penalty=False,
                       period_effective_start=o.effective_ms)
    if state.period_complete:raise ValueError('Period transition required')
    ledger=list(state.ledger)
    if state.active_restart:
        last=ledger[-1]
        end=min(o.physics_ms,o.restart_start_ms) if o.restart_active and o.restart_id!=state.active_restart else o.physics_ms
        if end<last.end:raise ValueError('Overlapping restart identity')
        duration=end-last.start
        loss=duration if last.cause in ('goal','penalty') else max(0,duration-RESTART_WAIT_MS[last.cause])
        ledger[-1]=replace(last,end=end,eligible_loss_ms=loss)
    active=0
    if o.restart_active:
        if o.restart_id<=0:raise ValueError('Missing restart identity')
        if o.restart_id==state.active_restart:
            if ledger[-1].cause!=o.restart_cause or ledger[-1].start!=o.restart_start_ms:
                raise ValueError('Restart identity changed')
        else:
            if any(r.id==o.restart_id for r in ledger):raise ValueError('Restart identity repeated')
            if ledger and o.restart_start_ms<ledger[-1].end:raise ValueError('Overlapping restarts')
            duration=o.physics_ms-o.restart_start_ms
            loss=duration if o.restart_cause in ('goal','penalty') else max(0,duration-RESTART_WAIT_MS[o.restart_cause])
            ledger.append(RestartInterval(o.restart_id,o.restart_cause,o.restart_start_ms,o.physics_ms,loss,o.period))
        active=o.restart_id
    loss=sum(r.eligible_loss_ms for r in ledger if r.period==state.period)
    if loss>MAX_LOSS_MS:raise ValueError('Period loss exceeds safety bound')
    elapsed=state.period_elapsed_ms+delta
    minimum=state.announced_minimum_ms
    if minimum is None and elapsed>=REGULAR_MS:
        minimum=((loss+59999)//60000)*60000
    elif minimum is not None:
        minimum+=loss-state.allowance_ms
    target=REGULAR_MS+(minimum or 0)
    if enforce_safe_limit and elapsed>min(target+SAFE_WAIT_MS,REGULAR_MS+MAX_LOSS_MS+SAFE_WAIT_MS):
        raise ValueError('No safe whistle before limit')
    wait_complete=not active or o.restart_cause not in ('goal','penalty') or o.physics_ms-ledger[-1].start>=RESTART_WAIT_MS[o.restart_cause]
    complete=minimum is not None and elapsed>=target and not o.in_play and not o.pending_penalty and wait_complete
    next_state=replace(state,physics_ms=o.physics_ms,period_elapsed_ms=elapsed,effective_ms=o.effective_ms,
        allowance_ms=loss,announced_minimum_ms=minimum,pending_penalty=o.pending_penalty,
        period_complete=False,finished=False,ledger=tuple(ledger),active_restart=active)
    return _complete_period(next_state) if complete else next_state
