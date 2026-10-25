import json
import pytest
from test_chronicle_worker_client import claim
from test_chronicle_repository import result
from timepitch.chronicles.worker_state import WorkerOutbox, OutboxState, RecoveryRequired


def box(tmp_path,binding='test-binding'): return WorkerOutbox(tmp_path/'active.json',binding=binding)


def state(stage='claimed'):
    c=claim()
    return OutboxState(claim=c,stage=stage,result=result(c) if stage=='result_saved' else None,lease_deadline_at=1900.)


def test_atomic_roundtrip_and_matching_clear(tmp_path):
    out=box(tmp_path); assert out.load() is None
    saved=state('result_saved'); out.save(saved); assert out.load()==saved
    bad=saved.claim.lease.model_copy(update={'generation':2})
    with pytest.raises(RecoveryRequired): out.clear(bad)
    assert out.load()==saved
    out.clear(saved.claim.lease); assert out.load() is None


@pytest.mark.parametrize('change',['partial','token','hash','binding','missing_payload'])
def test_corruption_and_configuration_change_fail_closed(tmp_path,change):
    out=box(tmp_path); out.save(state())
    if change=='binding':
        with pytest.raises(RecoveryRequired): box(tmp_path,'different-credential').load()
        return
    data=json.loads(out.path.read_text())
    if change=='token': data['claim']['lease']['lease_token']='y'*40
    if change=='hash': data['claim']['lease']['fact_hash']='c'*64
    if change=='partial': out.path.write_text('{')
    elif change=='missing_payload': out.path.unlink()
    else: out.path.write_text(json.dumps(data))
    with pytest.raises(RecoveryRequired): out.load()


def test_result_bound_to_original_claim_and_stage(tmp_path):
    saved=state('result_saved'); saved.result=saved.result.model_copy(deep=True); saved.result.lease.generation=2
    with pytest.raises(ValueError): box(tmp_path).save(saved)
    with pytest.raises(ValueError): OutboxState(claim=claim(),stage='result_saved',lease_deadline_at=1900.)


def test_reparse_path_refused_without_touching_target(tmp_path):
    target=tmp_path/'real'; target.mkdir(); link=tmp_path/'link'
    try: link.symlink_to(target,target_is_directory=True)
    except OSError: pytest.skip('Directory symlinks unavailable')
    with pytest.raises(RecoveryRequired): WorkerOutbox(link/'active.json',binding='x')
    assert list(target.iterdir())==[]


def test_cannot_clear_uncertain_generation(tmp_path):
    out=box(tmp_path); saved=state('generation_started'); out.save(saved)
    with pytest.raises(RecoveryRequired): out.clear(saved.claim.lease)


def test_uncertain_worker_blocks_all_shared_inference_consumers_after_crash(tmp_path):
    from timepitch.runtime import RuntimeLease
    out=WorkerOutbox(tmp_path/'ai-worker/active.json',binding='offline')
    with RuntimeLease(tmp_path/'inference.lock'):
        out.save(state('generation_started'))  # Simulated post-send transport loss.
    with pytest.raises(RuntimeError):
        with RuntimeLease(tmp_path/'inference.lock'): pass
    assert out.load().stage=='generation_started'


def test_legacy_standalone_probe_obeys_the_same_quarantine(tmp_path,monkeypatch):
    import asyncio
    import timepitch.agents.probe as probe
    out=WorkerOutbox(tmp_path/'.local/ai-worker/active.json',binding='offline'); out.save(state('generation_started'))
    monkeypatch.setattr(probe,'ROOT',tmp_path)
    def forbidden(*args,**kwargs): pytest.fail('Probe must be denied before constructing a transport')
    monkeypatch.setattr(probe,'FoundryTransport',forbidden)
    with pytest.raises(RuntimeError): asyncio.run(probe.probe_local_model())
