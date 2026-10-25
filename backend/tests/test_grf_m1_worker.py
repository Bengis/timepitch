"""All positive launches use synthetic project roots; never import native GRF."""
import copy
import sys
import subprocess
from pathlib import Path
import pytest
from grf_offline_guard import offline_only
from grf_m1_fixtures import synthetic_launch,put

# The autouse guard denies every arbitrary child. Only the fixed stdlib fixture
# below is permitted through this saved constructor; it also guards imports.
_FAKE_CHILD_POPEN=subprocess.Popen


def test_real_worker_has_no_native_permission_and_creates_nothing():
    from timepitch.grf.m1_verifier import verify_launch,RUN_ROOT,PROJECT,FREEZE,read
    root=PROJECT/RUN_ROOT
    # TP065 consumed this ID. Changed sources must deny a launch while preserving
    # its existing terminal files, rather than expecting a pre-approval empty root.
    import hashlib
    before={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob('*') if p.is_file() and 'heldout' not in p.parts}
    payload=read(PROJECT/FREEZE)['payloads']['calibration/01'] if (PROJECT/FREEZE).exists() else {}
    with pytest.raises(ValueError,match='freeze|grant|authorization|Frozen'):verify_launch(PROJECT,root,'M-observe-42',payload)
    after={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob('*') if p.is_file() and 'heldout' not in p.parts}
    assert before==after


@pytest.mark.parametrize('run_id',['K-observe-42','k1/calibration/01','m1/R-selected','../escape','m1/heldout/25'])
def test_retired_and_unselected_ids_fail_without_writing(tmp_path,run_id):
    from timepitch.grf.m1_verifier import verify_launch,RUN_ROOT
    with pytest.raises(ValueError):verify_launch(tmp_path,tmp_path/RUN_ROOT,run_id,{})
    assert list(tmp_path.iterdir())==[]


def test_verifier_is_stdlib_only_and_python310_syntax():
    import ast
    from timepitch.grf import m1_verifier,m1_wire
    for module in (m1_verifier,m1_wire):
        ast.parse(Path(module.__file__).read_text(encoding='utf-8'),feature_version=(3,10))
    assert not any(k.split('.')[0] in ('gfootball','gfootball_engine','_gameplayfootball') for k in sys.modules)


def test_exclusive_claim_and_import_gap_recheck(tmp_path):
    from timepitch.grf.m1_verifier import verify_launch,recheck_launch
    campaign,payload,d=synthetic_launch(tmp_path)
    launch=verify_launch(tmp_path,campaign,'M-observe-42',payload)
    assert launch.mode=='observe' and (launch.evidence/'worker-claimed.json').exists()
    with pytest.raises(FileExistsError):verify_launch(tmp_path,campaign,'M-observe-42',payload)
    (tmp_path/'backend/src/timepitch/runner.py').write_bytes(b'mutated after claim')
    with pytest.raises(ValueError):recheck_launch(launch,payload)
    assert (launch.evidence/'worker-claimed.json').exists()


@pytest.mark.parametrize('name',['backend/src/timepitch/runner.py','.local/runtime/python.exe',
    '.local/native/_gameplayfootball.pyd','.local/history/checkpoint.json'])
def test_mutated_closures_deny_before_claim(tmp_path,name):
    from timepitch.grf.m1_verifier import verify_launch
    campaign,payload,_=synthetic_launch(tmp_path);(tmp_path/name).write_bytes(b'mutated')
    with pytest.raises(ValueError):verify_launch(tmp_path,campaign,'M-observe-42',payload)
    assert not (campaign/'evidence/M-observe-42/worker-claimed.json').exists()


@pytest.mark.parametrize('name',['launch.json','../../authorization.json','../../authorization-witness.json'])
def test_missing_witnesses_never_recreate(tmp_path,name):
    from timepitch.grf.m1_verifier import verify_launch
    campaign,payload,_=synthetic_launch(tmp_path);path=campaign/'evidence/M-observe-42'/name
    # Use canonical paths here: nested relative names are test navigation only.
    path.resolve().unlink()
    with pytest.raises(ValueError):verify_launch(tmp_path,campaign,'M-observe-42',payload)
    assert not (campaign/'evidence/M-observe-42/worker-claimed.json').exists()


def test_payload_mode_and_new_source_membership_are_bound(tmp_path):
    from timepitch.grf.m1_verifier import verify_launch
    campaign,payload,_=synthetic_launch(tmp_path)
    bad=copy.deepcopy(payload);bad['config']['seed']+=1
    with pytest.raises(ValueError):verify_launch(tmp_path,campaign,'M-observe-42',bad)
    (tmp_path/'backend/src/timepitch/new.py').write_bytes(b'# added module')
    with pytest.raises(ValueError):verify_launch(tmp_path,campaign,'M-observe-42',payload)


def test_path_escape_and_unsealed_heldout_denied(tmp_path):
    from timepitch.grf.m1_verifier import verify_launch,artifact
    for name in ('../escape','C:/escape','a/../../escape','a\\b','a/./b'):
        with pytest.raises(ValueError):artifact(tmp_path,name)
    campaign,payload,_=synthetic_launch(tmp_path,'m1/heldout/01')
    with pytest.raises(ValueError,match='selection'):verify_launch(tmp_path,campaign,'m1/heldout/01',payload)


def test_source_race_and_wrong_mode_do_not_claim(tmp_path,monkeypatch):
    from timepitch.grf import m1_verifier as v
    campaign,payload,_=synthetic_launch(tmp_path)
    launch=v.read(campaign/'evidence/M-observe-42/launch.json');launch['identity']['mode']='apply'
    put(campaign,'evidence/M-observe-42/launch.json',launch)
    with pytest.raises(ValueError):v.verify_launch(tmp_path,campaign,'M-observe-42',payload)
    launch['identity']['mode']='observe';put(campaign,'evidence/M-observe-42/launch.json',launch)
    original=v._authorized;calls=0
    def race(*args):
        nonlocal calls
        calls+=1
        if calls==2:(tmp_path/'backend/src/timepitch/runner.py').write_bytes(b'changed in gap')
        return original(*args)
    monkeypatch.setattr(v,'_authorized',race)
    with pytest.raises(ValueError):v.verify_launch(tmp_path,campaign,'M-observe-42',payload)
    assert not (campaign/'evidence/M-observe-42/worker-claimed.json').exists()


class FakeChild:
    def __init__(self,raw,returncode=0):
        import io
        self.stdin=io.BytesIO();self.stdout=io.BytesIO(raw);self.stderr=io.BytesIO();self.returncode=returncode
    def poll(self):return self.returncode
    def wait(self,timeout=None):return self.returncode
    def terminate(self):self.returncode=-15
    def kill(self):self.returncode=-9


def transport(tmp_path,monkeypatch,raw):
    from timepitch.grf import m1_process as p
    from timepitch.grf import m1_verifier as v
    from types import SimpleNamespace
    campaign,payload,d=synthetic_launch(tmp_path);launch=v.verify_launch(tmp_path,campaign,'M-observe-42',payload)
    process=p.M1Process(SimpleNamespace(project=tmp_path,identity=launch.profile_identity),campaign,launch.run_id)
    monkeypatch.setattr(process,'_spawn',lambda:FakeChild(raw))
    monkeypatch.setattr(p,'private_bytes',lambda child:1024)
    from timepitch.grf.action_models import ActionInput
    return process,ActionInput.model_validate(payload),launch


@pytest.mark.parametrize('suffix',[b'',b'{"type":"manifest","manifest":{}}\n',b'{"type":"bad"}\n',
    b'{"type":"failure","last_observed_ms":300,"error_type":"ClockLimitError"}\n'])
def test_transport_preserves_valid_prefix_before_failure_cleanup(tmp_path,monkeypatch,suffix):
    import base64,threading
    from grf_action_fixtures import action_trace
    from timepitch.grf.physical_wire import canonical
    from timepitch.grf.physical_codec import encode_chunk
    raw=encode_chunk(action_trace()[1][0]);line=canonical(dict(type='chunk',data=base64.b64encode(raw).decode()))+b'\n'
    process,request,launch=transport(tmp_path,monkeypatch,line+suffix)
    with pytest.raises((RuntimeError,ValueError)):process._run_transport(request,threading.Event(),launch)
    assert (launch.evidence/'0.zlib').read_bytes()==raw
    from timepitch.grf.m1_verifier import read
    receipt=read(launch.evidence/'transport-failure.json')
    assert receipt['validated_chunks']==1 and receipt['last_durable_ms']==200
    assert receipt['last_observed_ms']==(300 if b'failure' in suffix else None)
    assert not process._active


@pytest.mark.parametrize('failure',['timeout','memory','cancel','oversize','trailing'])
def test_transport_caps_and_cancellation(tmp_path,monkeypatch,failure):
    import threading
    from timepitch.grf import m1_process as p
    raw=b'x'*(1500000)+b'\n' if failure=='oversize' else (b'{}' if failure=='trailing' else b'')
    process,request,launch=transport(tmp_path,monkeypatch,raw);cancel=threading.Event()
    if failure=='timeout':process.timeout=-1
    elif failure=='memory':monkeypatch.setattr(p,'private_bytes',lambda child:512*1024*1024+1)
    elif failure=='cancel':
        def spawn():cancel.set();return FakeChild(b'')
        monkeypatch.setattr(process,'_spawn',spawn)
    with pytest.raises((RuntimeError,ValueError)):process._run_transport(request,cancel,launch)
    assert (launch.evidence/'transport-failure.json').exists() and not process._active


def test_public_process_requires_grant_before_spawning(tmp_path,monkeypatch):
    import threading
    from timepitch.grf import m1_verifier as v,m1_process as p
    from types import SimpleNamespace
    from timepitch.grf.action_models import ActionInput
    campaign,payload,_=synthetic_launch(tmp_path);_,identity=v.verify_profile(tmp_path)
    process=p.M1Process(SimpleNamespace(project=tmp_path,identity=identity),campaign,'M-observe-42')
    (campaign/'authorization.json').unlink()
    monkeypatch.setattr(process,'_spawn',lambda:pytest.fail('Must deny before child'))
    with pytest.raises(ValueError):process.run(ActionInput.model_validate(payload),threading.Event())


def test_parent_launch_is_exclusive_and_creates_no_reservation(tmp_path):
    from timepitch.grf import m1_verifier as v
    campaign,payload,_=synthetic_launch(tmp_path);path=campaign/'evidence/M-observe-42/launch.json';path.unlink()
    before=(campaign/'checkpoint.json').read_bytes();v.prepare_launch(tmp_path,campaign,'M-observe-42',payload)
    with pytest.raises(FileExistsError):v.prepare_launch(tmp_path,campaign,'M-observe-42',payload)
    assert (campaign/'checkpoint.json').read_bytes()==before


def test_capture_startup_failure_has_typed_envelope(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from timepitch.grf import m1_capture,m1_runner
    from timepitch.grf import m1_verifier as v
    campaign,payload,_=synthetic_launch(tmp_path);launch=v.verify_launch(tmp_path,campaign,'M-observe-42',payload)
    def bad_capture(*args):raise ValueError('Wrong readbacks')
    monkeypatch.setattr(m1_capture,'M1Capture',bad_capture);messages=[]
    with pytest.raises(ValueError):m1_runner.capture_worker(SimpleNamespace(_env=SimpleNamespace()),payload,launch,messages.append)
    assert messages[0]['type']=='failure' and messages[0]['last_emitted_ms'] is None
    assert v.read(launch.evidence/'child-failure.json')['clock'] is None


def test_malformed_parent_input_is_rejected_before_spawn(tmp_path,monkeypatch):
    import threading
    process,request,launch=transport(tmp_path,monkeypatch,b'')
    monkeypatch.setattr(process,'_spawn',lambda:pytest.fail('Invalid input spawned a child'))
    request=request.model_copy(update={'input_hash':'f'*64})
    with pytest.raises(ValueError):process._run_transport(request,threading.Event(),launch)


def test_successor_cannot_reset_parent_budget(tmp_path):
    from timepitch.grf import m1_verifier as v
    from timepitch.grf.physical_wire import digest
    campaign,payload,d=synthetic_launch(tmp_path);d['parent']['used']=0
    descriptor=put(tmp_path,v.FREEZE,d)
    put(tmp_path,v.WITNESS,dict(schema_version='m1-worker-freeze-witness-1',profile_identity=digest(d),descriptor_sha256=v.sha(descriptor)))
    with pytest.raises(ValueError,match='parent'):v.verify_profile(tmp_path)


@pytest.mark.parametrize('mode',['failure','hang'])
def test_fixed_python_fake_child_pipe_and_termination(tmp_path,monkeypatch,mode):
    import threading
    process,request,launch=transport(tmp_path,monkeypatch,b'')
    fixture=Path(__file__).parent/'fixtures/grf/m1_wire_child.py'
    def spawn():
        return _FAKE_CHILD_POPEN([sys.executable,'-B','-u',str(fixture),mode],stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,shell=False,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
    monkeypatch.setattr(process,'_spawn',spawn)
    process.timeout=2 if mode=='hang' else 15
    with pytest.raises(RuntimeError):process._run_transport(request,threading.Event(),launch)
    from timepitch.grf.m1_verifier import read
    failure=read(launch.evidence/'transport-failure.json')
    assert failure['validated_chunks']==1 and failure['last_durable_ms']==200
    assert failure['last_observed_ms']==(300 if mode=='failure' else None)
    assert not process._active


def test_durable_prefix_is_counted_when_temporary_spool_write_fails(tmp_path,monkeypatch):
    import base64,threading
    from grf_action_fixtures import action_trace
    from timepitch.grf.physical_wire import canonical
    from timepitch.grf.physical_codec import encode_chunk
    raw=encode_chunk(action_trace()[1][0]);line=canonical(dict(type='chunk',data=base64.b64encode(raw).decode()))+b'\n'
    process,request,launch=transport(tmp_path,monkeypatch,line)
    original=Path.write_bytes;spools=[]
    def disk_failure(path,data):
        if path.name=='0.zlib' and not path.is_relative_to(tmp_path):
            spools.append(path.parent);raise OSError('Fake temporary disk failure')
        return original(path,data)
    monkeypatch.setattr(Path,'write_bytes',disk_failure)
    with pytest.raises(OSError):process._run_transport(request,threading.Event(),launch)
    from timepitch.grf.m1_verifier import read
    failure=read(launch.evidence/'transport-failure.json')
    assert failure['last_durable_ms']==200 and failure['validated_chunks']==1
    assert (launch.evidence/'0.zlib').read_bytes()==raw and all(not p.exists() for p in spools)
