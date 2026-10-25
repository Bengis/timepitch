import json

import pytest

from canary_fixtures import make_authorization,FakeNative


def ready(root):
    from timepitch.chronicles.canary_budget import CanaryBudget
    from timepitch.chronicles.canary_recovery import issue_canary_permit
    a,_=make_authorization(root);b=CanaryBudget.create_once(a,root=root);native=FakeNative()
    return b,native,issue_canary_permit(b,inspector=native.inspect_absence)


def test_scoped_recovery_keeps_old_marker_and_default_consumers_blocked(tmp_path):
    from timepitch.runtime import RuntimeLease
    from timepitch.chronicles.worker_state import RecoveryRequired
    from timepitch.chronicles.canary_recovery import assert_active_canary
    b,n,p=ready(tmp_path);lock=tmp_path/'.local/inference.lock';marker=tmp_path/'.local/inference-uncertain.json';before=marker.read_bytes()
    with pytest.raises(RecoveryRequired):
        with RuntimeLease(lock):pass
    with RuntimeLease(lock,canary_recovery=p):
        assert n.calls==2  # Fresh second inspection after taking the OS lock.
        b.begin();assert_active_canary(p,b)
        with pytest.raises(RuntimeError):
            with RuntimeLease(lock):pass
        b.reserve_http(1);b.finish('succeeded')
    assert marker.read_bytes()==before
    with pytest.raises(RecoveryRequired):
        with RuntimeLease(lock):pass
    with pytest.raises(RecoveryRequired):
        with RuntimeLease(lock,canary_recovery=p):pass


@pytest.mark.parametrize('change',['present','unknown','boot','stale','forged','nonce','code','outbox'])
def test_changed_proof_or_uncertain_state_denies_before_begin(tmp_path,change,monkeypatch):
    from timepitch.runtime import RuntimeLease
    from timepitch.chronicles.worker_state import RecoveryRequired
    from timepitch.chronicles.canary_budget import BINDING_FILES
    from timepitch.chronicles.canary_recovery import now_ns
    import timepitch.chronicles.canary_recovery as module
    b,n,p=ready(tmp_path)
    if change=='present':n.present=True
    elif change=='unknown':n.complete=False
    elif change=='boot':n.boot='d'*64
    elif change=='stale':
        stamp=now_ns();monkeypatch.setattr(module,'now_ns',lambda:stamp+31_000_000_000)
    elif change=='forged':p=p.model_copy()
    elif change=='nonce':b.begin()
    elif change=='code':(tmp_path/BINDING_FILES[0]).write_bytes(b'changed')
    elif change=='outbox':
        folder=tmp_path/'.local/ai-worker';folder.mkdir();(folder/'active.json').write_bytes(b'unknown-state')
    with pytest.raises(RecoveryRequired):
        with RuntimeLease(tmp_path/'.local/inference.lock',canary_recovery=p):pass
    if change!='code':assert b.snapshot().new_charged==0


def test_permit_without_os_lease_wrong_path_and_second_issuance_are_denied(tmp_path):
    from timepitch.runtime import RuntimeLease
    from timepitch.chronicles.worker_state import RecoveryRequired
    from timepitch.chronicles.canary_recovery import validate_canary_recovery,issue_canary_permit
    b,n,p=ready(tmp_path)
    with pytest.raises(RecoveryRequired):validate_canary_recovery(p,root=tmp_path)
    with pytest.raises(RecoveryRequired):issue_canary_permit(b,inspector=n.inspect_absence)
    with pytest.raises(RecoveryRequired):
        with RuntimeLease(tmp_path/'.local/other.lock',canary_recovery=p):pass


def test_runtime_appearing_during_acquisition_is_rechecked_under_lock(tmp_path,monkeypatch):
    from timepitch.runtime import RuntimeLease
    from timepitch.chronicles.worker_state import RecoveryRequired
    import timepitch.chronicles.worker_state as state
    b,n,p=ready(tmp_path);original=state.assert_inference_recovered
    def changed(path,**kwargs):
        n.present=True;return original(path,**kwargs)
    monkeypatch.setattr(state,'assert_inference_recovered',changed)
    with pytest.raises(RecoveryRequired):
        with RuntimeLease(tmp_path/'.local/inference.lock',canary_recovery=p):pass
    assert b.snapshot().state=='fresh' and n.calls==2
