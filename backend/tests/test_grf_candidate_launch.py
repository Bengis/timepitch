"""Pre-import worker identity and failed Popen, with nonloadable native doubles."""
import copy
from pathlib import Path
import threading
import pytest
from grf_candidate_fixtures import bind,reserve
from test_grf_candidate_profiles import api
from timepitch.grf import physical_campaign_budget as budget
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfUnavailable,GrfExecutionError


def test_failed_popen_keeps_exclusive_witness_and_cannot_retry(tmp_path,monkeypatch):
    _,root,_,profile=bind(tmp_path,monkeypatch);reserve(root,profile);m=api('candidate_process')
    runner=m.CandidateProcess(profile,root=root,run_id='c4/calibration/01');calls=[]
    monkeypatch.setattr(runner,'capability',lambda:EngineCapability(id='grf',available=True))
    def fail(*a,**k):calls.append(1);raise OSError('Synthetic launch failure')
    monkeypatch.setattr('subprocess.Popen',fail);request=m.request_for_run(profile,'c4/calibration/01')
    try:
        with pytest.raises(GrfExecutionError):runner.run(request,threading.Event())
        assert (runner.evidence/'launch.json').is_file() and not runner._active
        with pytest.raises((ValueError,FileExistsError)):runner.run(request,threading.Event())
        assert len(calls)==1
    finally:runner.close()


def test_portable_worker_checks_binding_payload_native_and_witness_before_import(tmp_path,monkeypatch):
    _,root,_,profile=bind(tmp_path,monkeypatch);reserve(root,profile);process=api('candidate_process')
    runner=process.CandidateProcess(profile,root=root,run_id='c4/calibration/01')
    monkeypatch.setattr(runner,'capability',lambda:EngineCapability(id='grf',available=False,reason='missing_assets'))
    request=process.request_for_run(profile,'c4/calibration/01')
    try:
        with pytest.raises(GrfUnavailable):runner.run(request,threading.Event())
    finally:runner.close()
    worker=api('candidate_runner');monkeypatch.setattr(worker,'__file__',str(tmp_path/'backend/src/timepitch/grf/candidate_runner.py'))
    payload=request.model_dump(mode='json')
    identity,spec,path=worker.worker_identity(profile.native_dir,root,'c4/calibration/01',payload)
    assert identity==runner.identity and spec==profile.spec() and path==runner.policy_path
    changed=copy.deepcopy(payload);changed['config']['seed']+=1
    for native,where,data in [(profile.native_dir,root,changed),(tmp_path/'another-native',root,payload),
                              (profile.native_dir,root.with_name('other'),payload)]:
        with pytest.raises(ValueError):worker.worker_identity(native,where,'c4/calibration/01',data)
    dependency=profile.native_dir/next(iter(profile.dependencies));dependency.write_bytes(b'changed')
    with pytest.raises(ValueError):worker.worker_identity(profile.native_dir,root,'c4/calibration/01',payload)
