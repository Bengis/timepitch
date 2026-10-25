"""Independent clock examples: loss, safe whistles and period conservation."""
from dataclasses import replace
import pytest
from timepitch.grf.physical_clock import ClockState, ClockObservation, advance_clock


def obs(ms, **kwargs):
    return ClockObservation(physics_ms=ms, **kwargs)


def test_three_clocks_and_allowance_rounding_do_not_double_count_incident():
    state=advance_clock(ClockState(),obs(0))
    state=advance_clock(state,obs(1000,restart_id=1,restart_cause='penalty',restart_active=True,
                                  restart_start_ms=1000,pending_penalty=True,in_play=False))
    state=advance_clock(state,obs(66000,restart_id=1,restart_cause='penalty',restart_start_ms=1000))
    assert state.allowance_ms==65000 and len(state.ledger)==1
    state=advance_clock(state,obs(2700000,effective_ms=2400000))
    assert state.period_elapsed_ms==2700000 and state.effective_ms==2400000
    assert state.announced_minimum_ms==120000 and not state.period_complete
    state=advance_clock(state,obs(2730000,effective_ms=2430000))
    assert state.announced_minimum_ms==120000 and state.allowance_ms==65000


def test_loss_after_announcement_extends_target_and_goal_wait_must_complete():
    state=advance_clock(ClockState(),obs(2700000))
    state=advance_clock(state,obs(2700100,in_play=False,restart_active=True,restart_id=2,
                                  restart_cause='goal',restart_start_ms=2700100))
    assert not state.period_complete
    state=advance_clock(state,obs(2730100,in_play=False,restart_active=True,restart_id=2,
                                  restart_cause='goal',restart_start_ms=2700100))
    assert state.allowance_ms==30000 and state.announced_minimum_ms==30000
    assert state.period_complete


def test_pending_penalty_continues_until_taken_and_next_stoppage():
    state=advance_clock(ClockState(),obs(2700000,pending_penalty=True,in_play=False,
        restart_active=True,restart_id=1,restart_cause='penalty',restart_start_ms=2700000))
    state=advance_clock(state,obs(2745000,pending_penalty=True,in_play=False,
        restart_active=True,restart_id=1,restart_cause='penalty',restart_start_ms=2700000))
    assert not state.period_complete
    state=advance_clock(state,obs(2745100,effective_ms=100))
    assert not state.period_complete
    state=advance_clock(state,obs(2745200,effective_ms=200,in_play=False,restart_active=True,
        restart_id=2,restart_cause='goal_kick',restart_start_ms=2745200))
    assert state.period_complete


def test_ordinary_restarts_only_add_excess_delay_and_halftime_has_zero_exposure():
    state=advance_clock(ClockState(),obs(0,in_play=False,restart_active=True,restart_id=1,
        restart_cause='corner',restart_start_ms=0))
    state=advance_clock(state,obs(15000,in_play=False,restart_active=True,restart_id=1,
        restart_cause='corner',restart_start_ms=0))
    assert state.allowance_ms==0
    state=advance_clock(state,obs(17000,in_play=False,restart_active=True,restart_id=1,
        restart_cause='corner',restart_start_ms=0))
    assert state.allowance_ms==2000
    state=advance_clock(state,obs(17100))
    state=advance_clock(state,obs(2760000,in_play=False))
    assert state.period_complete
    state=advance_clock(state,obs(2760000,period=2,in_play=False,discontinuity=True))
    assert state.period_elapsed_ms==0 and state.effective_ms==0 and len(state.periods)==1
    state=advance_clock(state,obs(5460000,period=2,in_play=False))
    assert state.finished and len(state.periods)==2


@pytest.mark.parametrize('observation',[
    obs(2820100), # no safe stoppage within two minutes of a zero-allowance target
    obs(1000000,in_play=False,restart_id=1,restart_active=True,restart_cause='goal',restart_start_ms=0),
])
def test_time_safety_limits_fail_instead_of_publishing_full_time(observation):
    with pytest.raises(ValueError):advance_clock(ClockState(),observation)


def test_rejects_regressing_clocks_and_unannounced_period_transition():
    state=advance_clock(ClockState(),obs(100))
    with pytest.raises(ValueError):advance_clock(state,obs(0))
    with pytest.raises(ValueError):advance_clock(state,obs(200,period=2))
    with pytest.raises(ValueError):advance_clock(state,obs(200,effective_ms=300))


def test_incident_change_inside_sample_does_not_overlap_loss():
    state=advance_clock(ClockState(),obs(0,in_play=False,restart_active=True,restart_id=1,
        restart_cause='penalty',restart_start_ms=0,pending_penalty=True))
    state=advance_clock(state,obs(45000,in_play=False,restart_active=True,restart_id=2,
        restart_cause='goal',restart_start_ms=44950))
    assert state.allowance_ms==45000
    assert state.ledger[0].end==state.ledger[1].start==44950


def test_maximum_loss_preserves_initial_rounding_and_is_admitted_by_period_contract():
    from timepitch.grf.physical_models import PhysicalPeriod
    state=advance_clock(ClockState(),obs(0,in_play=False,restart_active=True,restart_id=1,restart_cause='goal'))
    state=advance_clock(state,obs(30000))
    state=advance_clock(state,obs(2700000))
    assert state.announced_minimum_ms==60000
    state=advance_clock(state,obs(2700000,in_play=False,restart_active=True,restart_id=2,
        restart_cause='goal',restart_start_ms=2700000))
    state=advance_clock(state,obs(3570000))
    state=advance_clock(state,obs(3630000,in_play=False))
    period=PhysicalPeriod.model_validate(state.periods[0])
    assert period.announced_minimum_ms==930000 and period.allowance_ms==900000


def test_absolute_62_minute_bound_still_applies_with_rounding_margin():
    state=ClockState(physics_ms=3720000,period_elapsed_ms=3720000,allowance_ms=900000,
        announced_minimum_ms=930000)
    # No fresh loss; the relative safe wait would allow another 30 s, but the
    # approved absolute period/transport bound must reject the very next tick.
    from timepitch.grf.physical_clock import RestartInterval
    state=replace(state,ledger=(RestartInterval(1,'goal',0,900000,900000,1),))
    with pytest.raises(ValueError):advance_clock(state,obs(3720100))
