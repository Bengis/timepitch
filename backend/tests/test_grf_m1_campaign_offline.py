"""Shared accounting with synthetic outcomes only; production heldout is sealed."""
import copy
import json
import subprocess
import sys
from pathlib import Path
import pytest
from grf_offline_guard import offline_only
from grf_m1_fixtures import synthetic_launch,write_state,put
from test_grf_continuity_campaign import row

_STDLIB_CHILD=subprocess.Popen


@pytest.fixture(autouse=True)
def synthetic_outcomes_only(offline_only,tmp_path,monkeypatch):
    guarded=Path.open
    # This fixture owns only its tmp_path. Real heldout outcomes stay denied.
    import io
    def open_owned(path,*args,**kwargs):
        if path.absolute().is_relative_to(tmp_path):return io.open(path,*args,**kwargs)
        return guarded(path,*args,**kwargs)
    monkeypatch.setattr(Path,'open',open_owned)


@pytest.fixture
def store(tmp_path,monkeypatch):
    from timepitch.grf import m1_authorization as a,m1_profile as m,m1_verifier as v
    campaign,_,_=synthetic_launch(tmp_path);state=v.read(campaign/'checkpoint.json');state['runs']={}
    write_state(campaign,state,v.read(campaign/'authorization.json'))
    class AccountingLedger(a.WorkerLedger):
        # Explicit shared-journal test double, never installed in production.
        # New authority, resource gates and reuse seals are tested independently
        # in test_grf_m1_single_admission; these fixtures model old synthetic rows.
        def finish(self,id,row,*,failed=False):
            from timepitch.grf.campaign_ledger import CampaignLedger
            if not failed:
                a._retained_files(self.project,id,row)
                if a._validation_private_bytes()>512*1024*1024:raise ValueError('Fixture resource overflow')
            return CampaignLedger.finish(self,id,row,failed=failed)
        def finish_capture(self,id,capture,budget):
            with self.locked():return self.finish(id,capture)
        def _row(self,id,entry):
            from timepitch.grf.campaign_ledger import CampaignLedger
            row=CampaignLedger._row(self,id,entry)
            if entry['state']=='ready':a._retained_files(self.project,id,row)
            return row
    value=AccountingLedger(tmp_path,m.load_worker_profile(tmp_path))
    # The parser and resource sampler are controlled in accounting fixtures.
    # The production wrapper has no parser/executor parameter and the Phase3
    # suite exercises the actual full-stream admission independently.
    # Other offline tests intentionally allocate large synthetic traces in this
    # same pytest process. Their lifetime peak is not this fixture's workload.
    # The explicit overflow test below overrides this value and proves denial.
    monkeypatch.setattr(a,'_validation_private_bytes',lambda:1024*1024,raising=False)
    return value


def finish_fake(store,run_id,*,complete=True):
    """A test-only retained artifact. No public entry accepts this executor."""
    from timepitch.grf.physical_wire import digest
    from timepitch.grf.m1_verifier import sha
    payload=store.profile.payload('calibration/01' if run_id=='M-observe-42' else '/'.join(run_id.split('/')[1:]))
    store.reserve(run_id,payload)
    value=row(run_id);value.update(complete=complete,profile_identity=store.profile.identity)
    if not complete:return store.finish(run_id,value,failed=True)
    path=put(store.root,'evidence/'+run_id+'/synthetic-result.json',dict(synthetic=True,run_id=run_id))
    value['retained_files']={path.relative_to(store.project).as_posix():sha(path)}
    return store.finish(run_id,value)


def test_shared_class_and_one_global_lock_preserve_original_wrapper(store):
    from timepitch.grf.campaign_ledger import CampaignLedger
    from timepitch.grf.continuity_budget import ContinuityLedger,global_lock
    assert isinstance(store,CampaignLedger) and issubclass(ContinuityLedger,CampaignLedger)
    assert store.usage()['used']==41
    with global_lock(store.project):
        with store.locked():r=finish_fake(store,'M-observe-42');store.accept_observation(r)
    assert store.usage()['used']==42 and store.usage()['candidates']==6


def test_fixed_synthetic_schedule_then_sealed_twentyfour(store):
    from timepitch.grf.continuity_campaign import evaluate_continuity_gates
    from timepitch.grf.physical_wire import digest
    with store.locked():
        store.accept_observation(finish_fake(store,'M-observe-42'))
        rows=[finish_fake(store,f'm1/calibration/{i:02}') for i in range(1,9)]
        gates=evaluate_continuity_gates(rows,expected=8)
        assert all(gates.values())
        store.record_calibration(dict(rows=rows,gates=gates,qualified=True))
        store.seal_selection();store.verify_selection(store._load())
        for i in range(1,25):finish_fake(store,f'm1/heldout/{i:02}')
        assert store.reserve('m1/heldout/24',store.profile.payload('heldout/24'))['reused'] is True
    assert store.usage()['used']==74 and store.usage()['candidates']==6


def test_failure_consumes_slot_and_forbids_retry_or_other_ids(store):
    with store.locked():
        finish_fake(store,'M-observe-42',complete=False)
        for id in ('M-observe-42','m1/calibration/01','k1/calibration/04','m1/R-selected','m1/W-local'):
            with pytest.raises(ValueError):store.reserve(id,store.profile.payload('calibration/01'))
    assert store.usage()['used']==42 and store.usage()['candidates']==6


def test_native_equivalence_claim_without_retained_result_is_not_accepted(store):
    with store.locked():
        payload=store.profile.payload('calibration/01');store.reserve('M-observe-42',payload)
        with pytest.raises(ValueError):store.finish('M-observe-42',row('M-observe-42'))
    assert store.usage()['used']==42


@pytest.mark.parametrize('lost',['registration.json','initialized.json','events.jsonl','checkpoint.json'])
def test_deleted_checkpoint_or_witness_does_not_reset_or_recreate(store,lost):
    path=store.root/lost;path.unlink()
    with pytest.raises(ValueError):store.usage()
    assert not path.exists()


def test_ready_result_mutation_is_not_reusable(store):
    with store.locked():
        result=finish_fake(store,'M-observe-42');store.accept_observation(result)
    path=next(iter(result['retained_files']));(store.project/path).write_bytes(b'changed')
    with pytest.raises(ValueError):store.usage()


def test_missing_diagnostic_or_guard_cannot_open_extra_runs(store):
    from timepitch.grf.continuity_campaign import evaluate_continuity_gates
    with store.locked():
        store.accept_observation(finish_fake(store,'M-observe-42'))
        values=[finish_fake(store,f'm1/calibration/{i:02}') for i in range(1,9)]
        # Immutable original gates cannot be compensated by new guard counters.
        altered=copy.deepcopy(values)
        for value in altered:value['guard_events']=0
        assert not evaluate_continuity_gates(altered,expected=8)['guard_exercised']
        with pytest.raises(ValueError):store.reserve('m1/calibration/09',store.profile.payload('calibration/01'))


def test_parent_reduction_memory_is_part_of_ready_resource_gate(store,monkeypatch):
    from timepitch.grf import m1_authorization as a
    monkeypatch.setattr(a,'_validation_private_bytes',lambda:512*1024*1024+1,raising=False)
    with store.locked(),pytest.raises(ValueError):finish_fake(store,'M-observe-42')
    assert store.usage()['used']==42 and store._authorization_verifier is a.validate_worker_authorization


def test_fixed_entry_releases_shared_lock_for_claiming_stdlib_child(store,monkeypatch):
    from timepitch.grf import m1_campaign as c,m1_verifier as v
    from timepitch.grf.continuity_budget import _held
    monkeypatch.setattr(c,'WorkerLedger',lambda project,profile:store)
    (store.root/'evidence/M-observe-42/launch.json').unlink()
    child_code="""
import builtins,sys
original=builtins.__import__
def guarded(name,*args,**kwargs):
    if name.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball'):raise AssertionError('native forbidden')
    return original(name,*args,**kwargs)
builtins.__import__=guarded
sys.path.insert(0,sys.argv[1])
from pathlib import Path
from timepitch.grf import m1_verifier as v
root=Path(sys.argv[2]);payload=v.read(root/v.FREEZE)['payloads']['calibration/01']
launch=v.verify_launch(root,root/v.RUN_ROOT,'M-observe-42',payload)
v.recheck_launch(launch,payload)
print('claimed and rechecked without native')
"""
    def measure(profile,id,payload,budget):
        v.prepare_launch(store.project,store.root,id,payload)
        child=_STDLIB_CHILD([sys.executable,'-I','-c',child_code,str(v.PROJECT/'backend/src'),str(store.project)],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:out,err=child.communicate(timeout=12)
        finally:
            if child.poll() is None:child.kill();child.wait()
        assert child.returncode==0,err
        assert 'claimed and rechecked without native' in out
        assert not getattr(_held,'counts',{}).get(str(store.project),0)
        # A competing entry cannot claim or retry this already reserved ID.
        with pytest.raises(ValueError):c.run_m1_stage(store.project,'observe')
        value=row(id);path=put(store.root,'evidence/'+id+'/synthetic-result.json',{'synthetic':True})
        return dict(value,retained_files={path.relative_to(store.project).as_posix():v.sha(path)})
    monkeypatch.setattr(c,'_capture_reserved',measure)
    result=c.run_m1_stage(store.project,'observe')
    assert result['equivalent'] is True and store.usage()['used']==42
    assert c.run_m1_stage(store.project,'observe')['equivalent'] is True
    assert store.usage()['used']==42


@pytest.mark.parametrize('lost',['selection/freeze.json','selection-registration.json','selection-initialized.json',
    'bad_approval','bad_report','missing_calibration'])
@pytest.mark.parametrize('gap',['before_claim','before_recheck'])
def test_child_rechecks_all_selection_witnesses(store,lost,gap):
    from timepitch.grf import m1_verifier as v
    from timepitch.grf.continuity_campaign import evaluate_continuity_gates
    from timepitch.grf.physical_wire import digest
    with store.locked():
        store.accept_observation(finish_fake(store,'M-observe-42'))
        rows=[finish_fake(store,f'm1/calibration/{i:02}') for i in range(1,9)]
        gates=evaluate_continuity_gates(rows,expected=8)
        store.record_calibration(dict(rows=rows,gates=gates,qualified=True));store.seal_selection()
        selection=store._load()['selection']
        put(store.root,'phase6-approval.json',dict(profile_identity=store.profile.identity,
            selection_sha256=digest(selection),execute_phase=6,explicit_native=True))
        store.reserve('m1/heldout/01',store.profile.payload('heldout/01'))
    evidence=store.root/'evidence/m1/heldout/01';evidence.mkdir(parents=True)
    payload=store.profile.payload('heldout/01');v.prepare_launch(store.project,store.root,'m1/heldout/01',payload)
    if gap=='before_recheck':launch=v.verify_launch(store.project,store.root,'m1/heldout/01',payload)
    if lost=='bad_approval':
        approval=v.read(store.root/'phase6-approval.json');approval['execute_phase']=6.0;put(store.root,'phase6-approval.json',approval)
    elif lost=='bad_report':
        state=v.read(store.root/'checkpoint.json');state['calibration_report']['qualified']=False
        write_state(store.root,state,v.read(store.root/'authorization.json'))
    elif lost=='missing_calibration':(store.root/'evidence/m1/calibration/08/measurement.json').unlink()
    else:(store.root/lost).unlink()
    with pytest.raises(ValueError):
        if gap=='before_claim':v.verify_launch(store.project,store.root,'m1/heldout/01',payload)
        else:v.recheck_launch(launch,payload)
    if lost not in ('bad_approval','bad_report','missing_calibration'):assert not (store.root/lost).exists()


@pytest.mark.parametrize('failure',['incomplete','raised'])
def test_fixed_entry_stops_first_failure_without_retry(store,monkeypatch,failure):
    from timepitch.grf import m1_campaign as c
    monkeypatch.setattr(c,'WorkerLedger',lambda project,profile:store)
    calls=[]
    def measure(profile,id,payload,budget):
        calls.append(id)
        if failure=='raised':raise ValueError('synthetic child failure')
        return {'complete':False}
    monkeypatch.setattr(c,'_capture_reserved',measure)
    with pytest.raises(ValueError):c.run_m1_stage(store.project,'observe')
    with pytest.raises(ValueError):c.run_m1_stage(store.project,'observe')
    assert calls==['M-observe-42'] and store.usage()['used']==42
    with store.locked():assert store._load()['terminal_failure']=={'id':'M-observe-42','state':'failed'}
