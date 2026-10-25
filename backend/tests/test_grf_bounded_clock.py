"""Pure boundary examples; no native engine, subprocess or synthetic outcomes."""
from dataclasses import replace
import importlib
import importlib.util

import pytest
from grf_offline_guard import offline_only

from timepitch.grf.physical_clock import ClockObservation, RestartInterval


def api():
    name = 'timepitch.grf.bounded_clock'
    assert importlib.util.find_spec(name), 'Missing bounded physical clock'
    return importlib.import_module(name)


def late(ms=2819900, **kwargs):
    m = api()
    values = dict(physics_ms=ms,period_elapsed_ms=ms,announced_minimum_ms=0,
                  initialized=True,target_ms=2700000,deadline_ms=2820000)
    values.update(kwargs)
    return m.BoundedClockState(**values)


def step(state, ms, **kwargs):
    return api().advance_bounded_clock(state, api().BoundedObservation(ms, **kwargs))


def test_open_play_at_exact_deadline_requests_close_without_rewriting_observation():
    m = api(); state = late(2819800)
    before = step(state,2819900)
    assert before.close is None and not before.state.period_complete
    obs = m.BoundedObservation(2820000, in_play=True)
    result = m.advance_bounded_clock(before.state, obs)
    assert obs.in_play is True
    assert result.close == m.CloseRequest(1,2820000,'bounded_open_play')
    assert result.state.period_complete and not result.state.finished
    assert result.state.physics_ms == 2820000 and result.state.effective_ms == 0
    assert result.state.periods[0]['duration_ms'] == 2820000


@pytest.mark.parametrize('ms', [2700000,2820000])
def test_natural_close_wins_at_target_or_deadline(ms):
    result = step(late(ms-100),ms,in_play=False)
    assert result.close.reason == 'natural_stoppage'
    assert result.state.period_complete


@pytest.mark.parametrize('cause', ['corner','throw_in','free_kick','goal_kick','kickoff'])
def test_ordinary_pending_restart_does_not_require_taking_it(cause):
    result=step(late(2699900),2700000,in_play=False,restart_id=1,restart_active=True,
                restart_cause=cause,restart_start_ms=2700000)
    assert result.close.reason == 'natural_stoppage'


def test_penalty_flag_clearing_is_not_proof_of_completion():
    state=late(2699900)
    state=step(state,2700000,in_play=False,restart_id=1,restart_active=True,
               restart_cause='penalty',restart_start_ms=2700000,pending_penalty=True).state
    state=replace(state,physics_ms=2744900,period_elapsed_ms=2744900,allowance_ms=44900,
        announced_minimum_ms=44900,target_ms=2744900,deadline_ms=2864900,
        ledger=(RestartInterval(1,'penalty',2700000,2744900,44900,1),))
    state=step(state,2745000,in_play=False,restart_id=1,restart_active=True,
               restart_cause='penalty',restart_start_ms=2700000,pending_penalty=True).state
    assert state.penalty_protected and not state.period_complete
    state=step(state,2745100,in_play=True).state
    assert state.penalty_protected
    result=step(state,2745200,in_play=False,restart_id=2,restart_active=True,
                restart_cause='goal_kick',restart_start_ms=2745200)
    assert result.close.reason == 'natural_stoppage'


def test_unresolved_kick_cannot_be_cut_by_bounded_whistle():
    state=late(penalty_protected=True)
    with pytest.raises(api().ClockLimitError,match='protected_restart_limit'):
        step(state,2820000)


def test_penalty_protection_can_clear_at_a_later_stoppage_before_target():
    state=late(1000,announced_minimum_ms=None,target_ms=None,deadline_ms=None,penalty_protected=True)
    state=step(state,1100,in_play=False).state
    assert not state.penalty_protected


def test_active_penalty_without_pending_flag_is_not_a_lawful_close():
    state=late(2699900)
    with pytest.raises(ValueError,match='penalty'):
        step(state,2700000,in_play=False,restart_active=True,restart_id=1,
             restart_cause='penalty',restart_start_ms=2700000,pending_penalty=False)


def test_goal_wait_and_new_loss_preserve_original_allowance_arithmetic():
    state=step(late(2699900),2700000,in_play=True).state
    state=step(state,2700100,in_play=False,restart_id=1,restart_active=True,
               restart_cause='goal',restart_start_ms=2700100).state
    assert not state.period_complete
    state=replace(state,physics_ms=2730000,period_elapsed_ms=2730000,
        allowance_ms=29900,announced_minimum_ms=29900,target_ms=2729900,deadline_ms=2849900,
        ledger=(RestartInterval(1,'goal',2700100,2730000,29900,1),))
    result=step(state,2730100,in_play=False,restart_id=1,restart_active=True,
                restart_cause='goal',restart_start_ms=2700100)
    assert result.state.allowance_ms == 30000
    assert result.state.announced_minimum_ms == 30000
    assert result.close.reason == 'natural_stoppage'


def test_first_announcement_rounds_loss_and_later_loss_only_adds_delta():
    state=late(2699900,allowance_ms=65000,announced_minimum_ms=None,target_ms=None,deadline_ms=None,
        ledger=(RestartInterval(1,'penalty',0,65000,65000,1),))
    state=step(state,2700000).state
    assert state.announced_minimum_ms == 120000 and state.target_ms == 2820000
    result=step(state,2700100,in_play=False,restart_id=2,restart_cause='goal',restart_active=True,restart_start_ms=2700000)
    assert result.state.announced_minimum_ms == 120100


def test_loss_over_cap_is_not_clamped():
    state=late(2699900,allowance_ms=900001,
        ledger=(RestartInterval(1,'penalty',0,900001,900001,1),))
    with pytest.raises(ValueError,match='loss'):step(state,2700000)


def test_absolute_cap_with_rounding_margin_and_protection():
    args=dict(allowance_ms=900000,announced_minimum_ms=930000,target_ms=3630000,deadline_ms=3720000,
              ledger=(RestartInterval(1,'goal',0,900000,900000,1),))
    result=step(late(3719900,**args),3720000)
    assert result.close.reason == 'bounded_open_play'
    with pytest.raises(api().ClockLimitError,match='protected_restart_limit'):
        step(late(3719900,penalty_protected=True,**args),3720000)
    with pytest.raises(ValueError): step(late(3720000,**args),3720100)


def test_non_grid_deadline_closes_at_first_reaching_sample_not_as_a_skipped_tick():
    state=late(3153300,announced_minimum_ms=333310,allowance_ms=333310,
        target_ms=3033310,deadline_ms=3153310,
        ledger=(RestartInterval(1,'goal',0,333310,333310,1),))
    result=step(state,3153400)
    assert result.close.reason=='bounded_open_play'
    assert result.close.physics_ms==3153400 and result.state.deadline_ms==3153310


def test_zero_duration_halftime_and_second_period_finish():
    first=step(late(),2820000).state
    second=step(first,2820000,period=2,in_play=False,discontinuity=True,relocation_id=1).state
    assert second.period_elapsed_ms == 0 and second.period_effective_start == 0
    assert len(second.periods) == 1 and not second.penalty_protected
    second=replace(second,physics_ms=5519900,period_elapsed_ms=2699900,
                   target_ms=2700000,deadline_ms=2820000,announced_minimum_ms=0)
    final=step(second,5520000,period=2,in_play=False,relocation_id=1)
    assert final.state.finished and len(final.state.periods) == 2
    with pytest.raises(ValueError):step(final.state,5520100,period=2,relocation_id=1)


@pytest.mark.parametrize('ms,kw', [(2820100,{}),(2819900,{}),(2820000,{'effective_ms':float('nan')}),
    (2820000,{'effective_ms':101}),(2820000,{'period':2}),(2820000,{'in_play':1}),
    (2820000,{'restart_active':True,'restart_id':0}),(2820000,{'restart_id':-1}),
    (2820000,{'relocation_id':-1}),(2820000,{'physics_ms':True})])
def test_invalid_observations_never_manufacture_full_time(ms,kw):
    kwargs=dict(physics_ms=ms,**kw) if 'physics_ms' not in kw else kw
    with pytest.raises((ValueError,TypeError)):
        api().advance_bounded_clock(late(),api().BoundedObservation(**kwargs))


def test_initial_observation_must_start_at_zero_and_cannot_skip_steps():
    m=api()
    with pytest.raises(ValueError):step(m.BoundedClockState(),100)
    state=step(m.BoundedClockState(),0).state
    with pytest.raises(ValueError):step(state,200)
    assert step(state,100).close is None
