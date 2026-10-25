"""Fixed scheduling through an injected executor and synthetic ledger only."""
import importlib
import importlib.util

import pytest
from test_grf_continuity_profile import frozen
from test_grf_continuity_budget import permitted


def api():
    name = 'timepitch.grf.continuity_campaign'
    assert importlib.util.find_spec(name), 'Missing offline continuity scheduler'
    return importlib.import_module(name)


def row(run_id):
    from test_grf_action_gates import rows
    split = 'heldout' if '/heldout/' in run_id else 'calibration'
    value = rows(1, candidate='m1', split=split)[0]
    value.update(complete=True, marking_valid=True, guard_events=1, illegal_ownership=0,
                 equivalent=True, exact_transactions=1, run_id=run_id)
    value['fixture_id'] = f'{int(run_id)+1:02}' if run_id.isdigit() else '01' if run_id == 'M-observe-42' else run_id.rsplit('/', 1)[1]
    return value


def test_default_entry_cannot_launch_or_reserve(frozen):
    m = api()
    with pytest.raises(ValueError): m.run_continuity_stage(frozen.project, 'observe')
    assert not (frozen.project/m.RUN_ROOT).exists()


def test_fixed_schedule_is_nine_then_twentyfour_with_no_extra_runs(permitted):
    m = api(); calls = []
    def executor(run_id, payload): calls.append(run_id); return row(run_id)
    s = m.ContinuityLedger(permitted.project, permitted)
    m.execute_stage(s, permitted, 'observe', executor=executor)
    result = m.execute_stage(s, permitted, 'calibration', executor=executor)
    assert result['qualified'] and calls == ['M-observe-42']+[f'm1/calibration/{i:02}' for i in range(1, 9)]
    m.execute_stage(s, permitted, 'heldout', executor=executor)
    assert calls[9:] == [f'm1/heldout/{i:02}' for i in range(1, 25)]
    assert s.usage()['used'] == 74
    m.execute_stage(s, permitted, 'heldout', executor=executor)
    assert len(calls) == 33


def test_first_technical_failure_stops_and_blocks_retry_or_heldout(permitted):
    m = api(); s = m.ContinuityLedger(permitted.project, permitted); calls = []
    m.execute_stage(s, permitted, 'observe', executor=lambda id, payload: row(id))
    def fail(id, payload): calls.append(id); raise RuntimeError('synthetic failure')
    with pytest.raises(RuntimeError): m.execute_stage(s, permitted, 'calibration', executor=fail)
    for stage in ('calibration', 'heldout'):
        with pytest.raises(ValueError): m.execute_stage(s, permitted, stage, executor=fail)
    assert calls == ['m1/calibration/01'] and s.usage()['used'] == 43


def test_failed_calibration_cannot_open_heldout(permitted):
    m = api(); s = m.ContinuityLedger(permitted.project, permitted); calls = []
    m.execute_stage(s, permitted, 'observe', executor=lambda id, payload: row(id))
    def bad(id, payload): r = row(id); r['goals'] = 15; return r
    assert not m.execute_stage(s, permitted, 'calibration', executor=bad)['qualified']
    with pytest.raises(ValueError): m.execute_stage(s, permitted, 'heldout', executor=lambda id, p: calls.append(id))
    assert calls == [] and s.usage()['used'] == 50


def test_guard_improvement_never_compensates_for_failed_absolute_gate():
    m = api(); values = [row(str(i)) for i in range(8)]
    assert all(m.evaluate_continuity_gates(values, expected=8).values())
    values[0]['player_coverage'][0] = .5
    assert not all(m.evaluate_continuity_gates(values, expected=8).values())
    values = [row(str(i)) for i in range(8)]
    for r in values: r['guard_events'] = 0
    assert not m.evaluate_continuity_gates(values, expected=8)['guard_exercised']


def test_unapproved_clock_precedes_any_executor_call(permitted):
    m = api(); calls = []
    (permitted.project/m.RUN_ROOT/'clock.json').unlink()
    with pytest.raises(ValueError): m.run_continuity_stage(permitted.project, 'observe', executor=lambda *a: calls.append(a))
    assert calls == []


def test_observation_rejection_and_incomplete_result_stop_the_study(permitted):
    m = api(); s = m.ContinuityLedger(permitted.project, permitted)
    def bad(id, payload): r = row(id); r['equivalent'] = False; return r
    with pytest.raises(ValueError): m.execute_stage(s, permitted, 'observe', executor=bad)
    for stage in ('observe', 'calibration', 'heldout'):
        with pytest.raises(ValueError): m.execute_stage(s, permitted, stage, executor=lambda *a: pytest.fail('launched'))
    assert s.usage()['used'] == 42


def test_incomplete_result_is_consumed_before_stopping(permitted):
    m = api(); s = m.ContinuityLedger(permitted.project, permitted)
    with pytest.raises(ValueError): m.execute_stage(s, permitted, 'observe', executor=lambda *a: {'complete': False})
    assert s.usage()['used'] == 42
    with pytest.raises(ValueError): m.execute_stage(s, permitted, 'observe', executor=lambda *a: pytest.fail('retried'))


def test_loss_of_selection_witness_blocks_heldout_reuse_and_calibration(permitted):
    m = api(); s = m.ContinuityLedger(permitted.project, permitted)
    for stage in ('observe', 'calibration', 'heldout'): m.execute_stage(s, permitted, stage, executor=lambda id, p: row(id))
    (s.root/'selection-initialized.json').unlink()
    for stage in ('calibration', 'heldout'):
        with pytest.raises(ValueError): m.execute_stage(s, permitted, stage, executor=lambda *a: pytest.fail('reopened'))


def test_import_and_default_command_path_have_no_native_capability(frozen, monkeypatch):
    import builtins
    imported = builtins.__import__
    def guarded(name, *args, **kwargs):
        assert not any(x in name for x in ('gfootball', '_gameplayfootball', 'coordination_process', 'coordination_runner', 'action_native', 'action_validation'))
        return imported(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', guarded)
    m = api()
    with pytest.raises(ValueError): m.run_continuity_stage(frozen.project, 'observe')


def test_valid_grant_alone_cannot_admit_an_arbitrary_executor(permitted):
    m = api(); calls = []
    def executor(id, payload): calls.append(id); return row(id)
    with pytest.raises(ValueError): m.run_continuity_stage(permitted.project, 'observe', executor=executor)
    assert calls == []
    assert m.ContinuityLedger(permitted.project, permitted).usage()['used'] == 41
