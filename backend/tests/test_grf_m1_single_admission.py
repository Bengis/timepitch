"""Synthetic admission contracts. Never load GRF or execute a match."""
from dataclasses import replace
from types import SimpleNamespace
import os
import pytest
from grf_offline_guard import offline_only
from grf_m1_fixtures import synthetic_launch, put


@pytest.fixture(autouse=True)
def guarded(offline_only):pass


@pytest.fixture
def admission(tmp_path,monkeypatch):
    from timepitch.grf import m1_admission as a,m1_resources as r,m1_verifier as v,m1_profile
    from timepitch.grf.m1_resource_models import CapturedEvidence
    campaign,payload,_=synthetic_launch(tmp_path)
    profile=m1_profile.load_worker_profile(tmp_path)
    launch=v.verify_launch(tmp_path,campaign,'M-observe-42',payload)
    now=[0.]
    monkeypatch.setattr(r,'_wall_clock',lambda:now[0])
    monkeypatch.setattr(r,'_cpu_clock',lambda:now[0]/2)
    monkeypatch.setattr(r,'_parent_peak',lambda:1024)
    budget=r.M1Budget();budget.checkpoint('capture',child_peak=2048)
    # Only reader/validators are doubled here; canonical authorization, claims,
    # manifest/input hashing, resource checks and ledger/journal remain real.
    put(launch.evidence,'manifest.json',{'synthetic':True})
    put(launch.evidence,'policy.json',{'synthetic':True})
    (launch.evidence/'contexts.zlib').write_bytes(b'synthetic-context')
    (launch.evidence/'0.zlib').write_bytes(b'synthetic-block')
    calls=dict(evidence=0,reducer=0,comparison=0)
    manifest=SimpleNamespace(worker_identity=launch.identity,trace_hash='d'*64,duration_ms=200,
        chunks=[SimpleNamespace(index=0)],input=SimpleNamespace(model_dump=lambda **kw:payload))
    class Result:
        def __init__(self,path,budget=None):self.path=path;self.manifest=manifest
        def chunks(self):yield SimpleNamespace(samples=[[0,0],[1,200]])
    context=dict(complete=True,observation='available',transactions=1)
    def evidence(result,verified):
        calls['evidence']+=1
        if context.get('bad'):raise ValueError('bad close/readback/context')
        return SimpleNamespace(context=context,identity=launch.identity,trace_hash=manifest.trace_hash)
    def measure(result,receipt,resources):
        calls['reducer']+=1
        return dict(complete=True,status='ready',trace_hash=manifest.trace_hash,**resources)
    def comparison(*args):
        calls['comparison']+=1
        return dict(equivalent=True,exact_transactions=1)
    monkeypatch.setattr(a,'RetainedM1Result',Result)
    monkeypatch.setattr(a,'validate_evidence',evidence)
    monkeypatch.setattr(a,'measure_m1_result',measure)
    monkeypatch.setattr(a,'_observation',comparison)
    capture=CapturedEvidence(launch.run_id,launch.evidence,tuple(sorted(launch.identity.items())),
        v.sha(launch.evidence/'manifest.json'),manifest.trace_hash,0,200,budget.checkpoint('admission'),id(budget))
    return SimpleNamespace(a=a,r=r,v=v,profile=profile,launch=launch,capture=capture,budget=budget,
        calls=calls,context=context,now=now,manifest=manifest)


def ledger(x):
    from timepitch.grf.m1_authorization import WorkerLedger
    return WorkerLedger(x.profile.project,x.profile)


def test_single_admission_calls_evidence_reducer_comparison_once(admission):
    x=admission;s=ledger(x);row=s.finish_capture(x.launch.run_id,x.capture,x.budget)
    assert row['complete'] is True and x.calls==dict(evidence=1,reducer=1,comparison=1)


def test_producer_row_or_complete_flag_cannot_make_ready(admission):
    x=admission;s=ledger(x)
    with s.locked(),pytest.raises(ValueError):s.finish(x.launch.run_id,{'complete':True,'equivalent':True})
    with pytest.raises((ValueError,TypeError)):s.finish_capture(x.launch.run_id,{'complete':True},x.budget)


@pytest.mark.parametrize('field,value',[('path','elsewhere'),('run_id','m1/calibration/01'),
    ('manifest_sha256','0'*64),('identity',()),('budget_id',-1),('resources',None)])
def test_bad_capture_path_or_identity_rejected(admission,field,value):
    x=admission
    with pytest.raises((ValueError,TypeError)):
        x.a.derive_measurement(x.profile,x.launch.run_id,replace(x.capture,**{field:value}),x.budget)


@pytest.mark.parametrize('change',['missing','zero','incomplete'])
def test_missing_context_or_zero_transactions_rejected(admission,change):
    x=admission
    if change=='missing':(x.launch.evidence/'contexts.zlib').unlink()
    elif change=='zero':x.context['transactions']=0
    else:x.context['complete']=False
    with pytest.raises(ValueError):ledger(x).finish_capture(x.launch.run_id,x.capture,x.budget)
    assert not (x.launch.evidence/'resource-receipt.json').exists()


@pytest.mark.parametrize('corruption',['close','readback'])
def test_bad_close_or_readback_rejected(admission,corruption):
    x=admission;x.context['bad']=corruption
    with pytest.raises(ValueError):ledger(x).finish_capture(x.launch.run_id,x.capture,x.budget)


def test_mutated_bytes_same_size_and_mtime_fail_final_binding(admission,monkeypatch):
    x=admission;original=x.a.measure_m1_result
    def mutate(*args):
        p=x.launch.evidence/'0.zlib';st=p.stat();raw=p.read_bytes();p.write_bytes(b'X'+raw[1:]);os.utime(p,ns=(st.st_atime_ns,st.st_mtime_ns))
        return original(*args)
    monkeypatch.setattr(x.a,'measure_m1_result',mutate)
    with pytest.raises(ValueError,match='changed'):ledger(x).finish_capture(x.launch.run_id,x.capture,x.budget)
    assert not (x.launch.evidence/'resource-receipt.json').exists()


def test_failed_derivation_never_writes_ready(admission,monkeypatch):
    x=admission
    def bad(*args):raise ValueError('reducer failed')
    monkeypatch.setattr(x.a,'measure_m1_result',bad);s=ledger(x)
    with pytest.raises(ValueError):s.finish_capture(x.launch.run_id,x.capture,x.budget)
    with s.locked():assert s._load()['runs'][x.launch.run_id]['state']=='failed'
    assert s.usage()['used']==42


def test_ready_reuse_checks_hashes_without_reducing_again(admission):
    x=admission;s=ledger(x);s.finish_capture(x.launch.run_id,x.capture,x.budget)
    with s.locked():assert s.reserve(x.launch.run_id,x.profile.payload('calibration/01'))['reused']
    assert x.calls==dict(evidence=1,reducer=1,comparison=1)
    (x.launch.evidence/'0.zlib').write_bytes(b'changed')
    with pytest.raises(ValueError):s.usage()


def test_two_finalizers_cannot_overwrite(admission):
    x=admission;s=ledger(x);s.finish_capture(x.launch.run_id,x.capture,x.budget)
    before=(x.launch.evidence/'measurement.json').read_bytes()
    with pytest.raises(ValueError):s.finish_capture(x.launch.run_id,x.capture,x.budget)
    assert (x.launch.evidence/'measurement.json').read_bytes()==before
    assert x.calls==dict(evidence=1,reducer=1,comparison=1)


@pytest.mark.parametrize('stage',['reduction','hash','commit'])
def test_final_hash_and_commit_boundary_can_timeout(admission,monkeypatch,stage):
    x=admission;s=ledger(x)
    if stage=='reduction':
        original=x.a.measure_m1_result
        def slow(*args):x.now[0]=601.;return original(*args)
        monkeypatch.setattr(x.a,'measure_m1_result',slow)
    elif stage=='hash':
        original=x.a.retained_hashes;calls=[0]
        def slow(*args):
            result=original(*args);calls[0]+=1
            if calls[0]>=2:x.now[0]=601.
            return result
        monkeypatch.setattr(x.a,'retained_hashes',slow)
    else:
        original=s._save
        def slow(*args):original(*args);x.now[0]=601.
        monkeypatch.setattr(s,'_save',slow)
    with pytest.raises(x.r.M1ResourceExceeded):s.finish_capture(x.launch.run_id,x.capture,x.budget)
    assert not (x.launch.evidence/'resource-receipt.json').exists()
    failure=x.v.read(x.launch.evidence/'resource-failure.json')
    assert failure['resources']['exceeded_time'] and failure['admitted'] is False
    with s.locked():assert s._load()['runs'][x.launch.run_id]['state']=='failed'


def test_budget_includes_constructor_child_and_parent(admission):
    x=admission;x.now[0]=599.;x.budget.checkpoint('capture_preflight');x.now[0]=600.01
    with pytest.raises(x.r.M1ResourceExceeded):ledger(x).finish_capture(x.launch.run_id,x.capture,x.budget)
    assert x.calls==dict(evidence=0,reducer=0,comparison=0)


def test_no_successful_resource_receipt_on_failed_gate(admission,monkeypatch):
    x=admission;monkeypatch.setattr(x.r,'_parent_peak',lambda:536870913)
    with pytest.raises(x.r.M1ResourceExceeded):ledger(x).finish_capture(x.launch.run_id,x.capture,x.budget)
    assert not (x.launch.evidence/'resource-receipt.json').exists()


def test_capture_timeout_records_last_durable_not_unseen_tail(tmp_path,monkeypatch):
    import base64,threading
    from test_grf_m1_worker import transport
    from grf_action_fixtures import action_trace
    from timepitch.grf.physical_wire import canonical
    from timepitch.grf.physical_codec import encode_chunk
    from timepitch.grf import m1_resources as r,m1_verifier as v
    from pathlib import Path
    raw=encode_chunk(action_trace()[1][0])
    line=canonical(dict(type='chunk',data=base64.b64encode(raw).decode()))+b'\n'
    line+=canonical(dict(type='failure',last_observed_ms=300))+b'\n'
    process,request,launch=transport(tmp_path,monkeypatch,line)
    now=[0.];monkeypatch.setattr(r,'_wall_clock',lambda:now[0]);monkeypatch.setattr(r,'_cpu_clock',lambda:0.)
    monkeypatch.setattr(r,'_parent_peak',lambda:1024);budget=r.M1Budget()
    original=Path.write_bytes
    def after_durable(path,raw):
        if path.name=='0.zlib' and path.parent!=launch.evidence:now[0]=601.
        return original(path,raw)
    monkeypatch.setattr(Path,'write_bytes',after_durable)
    with pytest.raises(r.M1ResourceExceeded):process._run_transport(request,threading.Event(),launch,budget)
    failure=v.read(launch.evidence/'resource-failure.json')
    assert (failure['last_durable_block'],failure['last_durable_ms'])==(0,200)
    assert not process._active and not (launch.evidence/'manifest.json').exists()


def test_budget_starts_before_process_constructor(admission,monkeypatch):
    from timepitch.grf import m1_process,m1_campaign
    x=admission;closed=[]
    class Process:
        def __init__(self,*args):x.now[0]=601.
        def capture(self,*args):pytest.fail('Expired constructor reached child')
        def close(self):closed.append(True)
    monkeypatch.setattr(m1_process,'M1Process',Process)
    with pytest.raises(x.r.M1ResourceExceeded):m1_campaign._capture_reserved(x.profile,x.launch.run_id,
        x.profile.payload('calibration/01'),x.budget)
    assert closed==[True]


def test_timeout_during_reduction_keeps_failed_diagnostics(admission,monkeypatch):
    x=admission
    def slow(*args):x.now[0]=601.;x.budget.checkpoint('admission')
    monkeypatch.setattr(x.a,'measure_m1_result',slow)
    with pytest.raises(x.r.M1ResourceExceeded):ledger(x).finish_capture(x.launch.run_id,x.capture,x.budget)
    failure=x.v.read(x.launch.evidence/'resource-failure.json')
    assert failure['resources']['stage']=='admission' and failure['last_durable_ms']==200
    assert failure['resource_scope']=='current-budget-not-recovered-historical-telemetry'


@pytest.mark.parametrize('point',['receipt','seal','readback'])
def test_no_successful_resource_receipt_after_late_timeout(admission,monkeypatch,point):
    x=admission;s=ledger(x)
    if point=='receipt':
        from timepitch.grf import m1_wire
        original=m1_wire.write_exclusive
        def slow(path,value):
            original(path,value)
            if path.name=='resource-receipt.json':x.now[0]=601.
        monkeypatch.setattr(m1_wire,'write_exclusive',slow)
    elif point=='seal':
        original=s._save
        def slow(state,event):
            original(state,event)
            if event['type']=='resource_sealed':x.now[0]=601.
        monkeypatch.setattr(s,'_save',slow)
    else:
        original=s._row
        def slow(*args):result=original(*args);x.now[0]=601.;return result
        monkeypatch.setattr(s,'_row',slow)
    with pytest.raises(x.r.M1ResourceExceeded):s.finish_capture(x.launch.run_id,x.capture,x.budget)
    assert not (x.launch.evidence/'resource-receipt.json').exists()
    assert (x.launch.evidence/'measurement.json').read_text().find('"complete":false')>=0
    with s.locked():assert s._load()['runs'][x.launch.run_id]['state']=='failed'


def test_resource_receipt_tamper_is_not_reusable(admission):
    x=admission;s=ledger(x);s.finish_capture(x.launch.run_id,x.capture,x.budget)
    path=x.launch.evidence/'resource-receipt.json';raw=path.read_bytes();path.write_bytes(raw.replace(b'2048',b'2049'))
    with pytest.raises(ValueError):s.usage()


def test_real_stream_validator_rejects_changed_readback(admission):
    """The readback gate precedes completion: require its exact rejection."""
    from grf_action_fixtures import action_trace
    from timepitch.grf.m1_models import M1Manifest
    from timepitch.grf.m1_evidence import validate_evidence
    from timepitch.grf.physical_codec import manifest_hash
    x=admission;old,chunks=action_trace()
    manifest=M1Manifest(**old.model_dump(exclude={'schema_version','engine_version','native_binary_sha256','trace_hash'}),
        native_binary_sha256=x.profile.native_sha256,worker_identity=x.launch.identity,close_receipts=[{},{}])
    first=manifest.attribute_readbacks[0]
    first.base=0. if first.base>.5 else 1.
    manifest.trace_hash=manifest_hash(manifest)
    result=SimpleNamespace(manifest=manifest,chunks=lambda:iter(chunks))
    with pytest.raises(ValueError,match='attribute/readback mismatch'):validate_evidence(result,x.launch)


def test_real_close_validator_reaches_receipt_checks(admission):
    from grf_action_fixtures import action_trace
    from grf_physical_fixtures import row
    from test_grf_m1_clock_transport import close_receipt
    from timepitch.grf.m1_models import M1Manifest
    from timepitch.grf.m1_codec import M1StreamValidator
    x=admission;old,_=action_trace()
    rows=[row(0,2820000,period=1,elapsed=2820000,in_play=1),row(1,5640000,period=2,elapsed=2820000,in_play=1)]
    manifest=M1Manifest(**old.model_dump(exclude={'schema_version','engine_version','native_binary_sha256','trace_hash'}),
        native_binary_sha256=x.profile.native_sha256,worker_identity=x.launch.identity,
        close_receipts=[close_receipt(r) for r in rows])
    validator=M1StreamValidator(manifest.input,x.launch)
    validator.expected_closes=[(dict(period=int(r[2]),physics_ms=int(r[1]),reason='bounded_open_play'),r) for r in rows]
    validator._validate_completion(manifest)  # Demonstrate that this gate is reached.
    manifest.close_receipts[0]['after']['score']=[1,0]
    with pytest.raises(ValueError,match='close|Close'):validator._validate_completion(manifest)


def test_fabricated_derived_measurement_cannot_make_ready(admission):
    from timepitch.grf.m1_resource_models import DerivedMeasurement
    x=admission;s=ledger(x)
    forged=DerivedMeasurement(dict(complete=True,equivalent=True),{},x.launch.identity,x.capture.trace_hash,0,200)
    with pytest.raises(ValueError):s.finish_capture(x.launch.run_id,forged,x.budget)
    with s.locked(),pytest.raises(ValueError):s.finish(x.launch.run_id,forged)
    assert x.calls==dict(evidence=0,reducer=0,comparison=0)
    with s.locked():assert s._load()['runs'][x.launch.run_id]['state']=='reserved'


@pytest.mark.parametrize('sample',[None,-1,True,'error'])
def test_transport_unavailable_memory_is_typed(tmp_path,monkeypatch,sample):
    import threading
    from test_grf_m1_worker import transport
    from timepitch.grf import m1_resources as r,m1_process as p,m1_verifier as v
    process,request,launch=transport(tmp_path,monkeypatch,b'')
    monkeypatch.setattr(r,'_parent_peak',lambda:1024)
    def unavailable(child):
        if sample=='error':raise OSError('sensor unavailable')
        return sample
    monkeypatch.setattr(p,'private_bytes',unavailable)
    with pytest.raises(r.M1ResourceExceeded):process._run_transport(request,threading.Event(),launch,r.M1Budget())
    failure=v.read(launch.evidence/'resource-failure.json')
    assert 'child_memory_unavailable' in failure['resources']['sensor_errors']


def test_capture_returns_reference_without_evidence_or_statistics(admission,monkeypatch):
    import threading
    from timepitch.grf import m1_process as p
    from timepitch.grf.m1_resource_models import CapturedEvidence
    x=admission;closed=[]
    process=p.M1Process(x.profile,x.profile.project/x.v.RUN_ROOT,x.launch.run_id)
    monkeypatch.setattr(p,'prepare_launch',lambda *args:x.launch)
    result=SimpleNamespace(manifest=x.manifest,count=1,close=lambda:closed.append(True))
    def capture(*args):process.peak_private_bytes=2048;return result
    monkeypatch.setattr(process,'_run_transport',capture)
    request=SimpleNamespace(model_dump=lambda **kwargs:x.profile.payload('calibration/01'))
    ref=process.capture(request,threading.Event(),x.budget)
    assert type(ref) is CapturedEvidence and closed==[True]
    assert x.calls==dict(evidence=0,reducer=0,comparison=0)
    assert not hasattr(ref,'complete') and not hasattr(ref,'equivalent')


def test_incremental_transport_validator_still_runs(tmp_path,monkeypatch):
    import base64,threading
    from test_grf_m1_worker import transport
    from grf_action_fixtures import action_trace
    from timepitch.grf.physical_wire import canonical
    from timepitch.grf.physical_codec import encode_chunk
    from timepitch.grf import m1_process as p,m1_resources as r
    raw=encode_chunk(action_trace()[1][0]);line=canonical(dict(type='chunk',data=base64.b64encode(raw).decode()))+b'\n'
    process,request,launch=transport(tmp_path,monkeypatch,line)
    original=p.M1StreamValidator;seen=[]
    class Validator(original):
        def append(self,chunk):seen.append(chunk.index);return super().append(chunk)
    monkeypatch.setattr(p,'M1StreamValidator',Validator);monkeypatch.setattr(r,'_parent_peak',lambda:1024)
    with pytest.raises(RuntimeError):process._run_transport(request,threading.Event(),launch,r.M1Budget())
    assert seen==[0] and (launch.evidence/'0.zlib').exists()


def test_campaign_constructor_timeout_retains_resource_diagnostic(admission,monkeypatch):
    from grf_m1_fixtures import write_state
    from timepitch.grf import m1_campaign as c,m1_process as p
    x=admission;root=x.launch.evidence.parent.parent
    state=x.v.read(root/'checkpoint.json');state['runs']={}
    write_state(root,state,x.v.read(root/'authorization.json'))
    class Process:
        def __init__(self,*args):x.now[0]=601.
        def close(self):pass
    monkeypatch.setattr(p,'M1Process',Process)
    with pytest.raises(x.r.M1ResourceExceeded):c.run_m1_stage(x.profile.project,'observe')
    failure=x.v.read(x.launch.evidence/'resource-failure.json')
    assert failure['last_durable_block'] is None and failure['last_durable_ms'] is None
    assert failure['trace_hash'] is None and failure['resources']['stage']=='capture_preflight'


@pytest.mark.parametrize('preparation',['artifact','mkdir','identity'])
def test_diagnostic_preparation_error_preserves_original_and_settles(admission,monkeypatch,preparation):
    from pathlib import Path
    from grf_m1_fixtures import write_state
    from timepitch.grf import m1_campaign as c,m1_process as p
    x=admission;root=x.launch.evidence.parent.parent
    state=x.v.read(root/'checkpoint.json');state['runs']={}
    write_state(root,state,x.v.read(root/'authorization.json'))
    error=x.r.M1ResourceExceeded(replace(x.budget.latest,elapsed_seconds=601.,exceeded_time=True))
    armed=[False]
    class Process:
        def __init__(self,*args):armed[0]=True;x.now[0]=601.;raise error
    monkeypatch.setattr(p,'M1Process',Process)
    if preparation=='artifact':
        original=x.v.artifact
        def broken(*args):
            if armed[0] and args[1].endswith('/evidence/M-observe-42'):
                armed[0]=False;raise OSError('diagnostic path unavailable')
            return original(*args)
        monkeypatch.setattr(x.v,'artifact',broken)
    elif preparation=='mkdir':
        original=Path.mkdir
        def broken(path,*args,**kwargs):
            if armed[0] and path==x.launch.evidence:armed[0]=False;raise OSError('diagnostic mkdir unavailable')
            return original(path,*args,**kwargs)
        monkeypatch.setattr(Path,'mkdir',broken)
    else:
        def broken(*args):armed[0]=False;raise OSError('diagnostic identity unavailable')
        monkeypatch.setattr(c,'_launch',broken)
    with pytest.raises(x.r.M1ResourceExceeded) as caught:c.run_m1_stage(x.profile.project,'observe')
    assert caught.value is error and error.diagnostic_error=='OSError'
    s=ledger(x)
    with s.locked():assert s._load()['runs'][x.launch.run_id]['state']=='failed'
    assert s.usage()['used']==42
