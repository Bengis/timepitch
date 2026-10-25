"""Research seams with synthetic snapshots; no football environment is created."""
import copy
import importlib
import importlib.util
import json
import subprocess
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
import pytest
from grf_action_fixtures import action_trace
from test_grf_action_capture import make_capture
from timepitch.grf.action_codec import ActionStreamValidator
from timepitch.grf.action_models import ACTION_NATIVE_SHA256
from timepitch.grf.physical_codec import validate_manifest

N='d82ed1bdd4f9a768d08a8c8efc3e0f069b3a16669d465f60fe6eb751cb765f5b'


def test_research_pin_is_explicit_and_does_not_change_public_admission():
    m,blocks=action_trace()
    for sha in (N,'f'*64):
        with pytest.raises(ValueError):ActionStreamValidator(m.input,sha)
    with pytest.raises(ValueError):ActionStreamValidator(m.input,N,_research_native_sha256='f'*64)
    with pytest.raises(ValueError):ActionStreamValidator(m.input,'bogus',_research_native_sha256='bogus')
    research=ActionStreamValidator(m.input,N,_research_native_sha256=N)
    old=ActionStreamValidator(m.input,ACTION_NATIVE_SHA256)
    for block in blocks:research.append(block);old.append(block)
    assert research.refs==old.refs and research.sample_count==old.sample_count==3
    probe=m.model_copy(update={'native_binary_sha256':N})
    with pytest.raises(ValueError):validate_manifest(probe,iter(blocks))


def test_sample_hook_is_passive_once_per_row_including_same_time_halftime(monkeypatch):
    baseline=make_capture(monkeypatch)
    expected=[baseline.encode(b) for b in baseline]
    capture=make_capture(monkeypatch);seen=[];drains=[];steps=[]
    original_drain=capture.adapter.drain;original_step=capture.adapter.step
    def drain(i):drains.append(i);return original_drain(i)
    def step():steps.append(1);return original_step()
    capture.adapter.drain=drain;capture.adapter.step=step
    # The constructor hook is also exercised separately with a prefix below.
    from timepitch.grf.action_runner import ActionCapture
    hooked=ActionCapture(capture.core,capture.payload,None,sample_observer=lambda row:seen.append(tuple(row[:3])))
    hooked.adapter=capture.adapter
    actual=[hooked.encode(b) for b in hooked]
    assert actual==expected
    assert len(seen)==54002 and len(drains)==54002 and len(steps)==54000
    assert seen[27000:27002]==[(27000,2700000,1),(27001,2700000,2)]
    assert drains==list(range(54002))


def api():
    name='timepitch.grf.defensive_probe'
    assert importlib.util.find_spec(name),'Missing isolated research worker'
    return importlib.import_module(name)


def pair():
    from timepitch.grf.physical_codec import manifest_hash
    m,blocks=action_trace(splits=(2,));p=m.model_copy(deep=True);p.native_binary_sha256=N;p.trace_hash=manifest_hash(p)
    return (SimpleNamespace(manifest=m,chunks=lambda:iter(blocks)),
        SimpleNamespace(manifest=p,chunks=lambda:iter(copy.deepcopy(blocks))))


def test_comparator_binds_both_sources_and_compares_all_action_evidence():
    control,probe=pair();result=api().compare_defensive_capture(control,probe)
    assert result['samples']==3 and result['blocks']==2 and result['semantic_events']==1
    assert result['control_trace_hash']==control.manifest.trace_hash
    assert result['probe_trace_hash']==probe.manifest.trace_hash


@pytest.mark.parametrize('change',['middle','last','raw','role','semantic','activity','readback','ledger','counts','period','input','trace','chunk_ref','missing'])
def test_equal_score_cannot_hide_changed_trajectory_or_action(change):
    from timepitch.grf.physical_codec import manifest_hash
    from timepitch.grf.action_codec import make_action_chunk_ref
    control,probe=pair();blocks=list(probe.chunks());probe.chunks=lambda:iter(blocks)
    if change=='middle':blocks[0].samples[1][-3]+=1
    if change=='last':blocks[-1].samples[-1][1]+=100
    if change=='raw':blocks[0].events[0].player=8
    if change=='role':blocks[0].contact_roles[0]=4
    if change=='semantic':blocks[0].semantic_events[0].intent='shot'
    if change=='activity':blocks[0].activity[1][0]=1
    if change=='readback':probe.manifest.attribute_readbacks[20].effective+=.01
    if change=='counts':probe.manifest.raw_event_count+=1
    if change=='period':probe.manifest.periods[0].effective_ms+=100
    if change=='ledger':
        from timepitch.grf.physical_models import PhysicalRestart
        probe.manifest.ledger.append(PhysicalRestart(id=1,cause='kickoff',start=0,end=100,eligible_loss_ms=0,period=1))
    if change=='input':probe.manifest.input.config.seed+=1
    if change=='missing':blocks.pop()
    if change=='chunk_ref':probe.manifest.chunks[0].sha256='e'*64
    elif change not in ('trace',):probe.manifest.chunks=[make_action_chunk_ref(b) for b in blocks]
    probe.manifest.trace_hash=manifest_hash(probe.manifest)
    if change=='trace':probe.manifest.trace_hash='f'*64
    with pytest.raises(ValueError):api().compare_defensive_capture(control,probe)


def setup_probe(tmp_path,monkeypatch,*,reserved=True):
    import test_grf_defensive_probe_budget as fixtures
    from test_grf_defensive_probe_budget import fixture,build
    original_setup=fixtures.setup_campaign
    def setup(path):
        parent,root,campaign=original_setup(path)
        campaign['python']='.local/grf-spike/python/python.exe'
        return parent,root,campaign
    monkeypatch.setattr(fixtures,'setup_campaign',setup)
    m,b,original,root,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,root,approved=True)
    pin=build(tmp_path)
    if reserved:m.reserve_defensive_probe(root,input_hash=d['control']['input_hash'],native_sha256=pin)
    return m,root,d,pin


def test_factory_requires_frozen_build_and_consumed_reservation_before_child(tmp_path,monkeypatch):
    m,root,d,pin=setup_probe(tmp_path,monkeypatch,reserved=False);module=api()
    descriptor=tmp_path/m.DESCRIPTOR
    with pytest.raises(ValueError):module.DefensiveProbeProcess(descriptor,root)
    m.reserve_defensive_probe(root,input_hash=d['control']['input_hash'],native_sha256=pin)
    process=module.DefensiveProbeProcess(descriptor,root)
    try:
        assert process.native_sha256==pin and process.timeout==600
        command=process._command()
        assert command[-2:]==[str(descriptor.resolve()),str((root/'evidence/D-defense-42/defense.jsonl').resolve())]
        assert Path(command[4]).name=='defensive_probe_runner.py'
        with pytest.raises((ValueError,FileExistsError)):process._command()
    finally:process.close()
    (tmp_path/'.local/grf-defense-native/Release/python310.dll').write_bytes(b'altered')
    with pytest.raises(ValueError):module.DefensiveProbeProcess(descriptor,root)


def test_cli_without_opt_in_or_with_another_descriptor_creates_no_child(tmp_path,monkeypatch):
    module=api();m,root,d,pin=setup_probe(tmp_path,monkeypatch,reserved=False)
    monkeypatch.delenv('TIMEPITCH_TEST_GRF_DEFENSE_PROBE',raising=False)
    with pytest.raises(ValueError):module.run_defensive_probe(tmp_path/m.DESCRIPTOR,root)
    assert m.cumulative_usage(root.with_name('continuation'))['used']==28
    monkeypatch.setenv('TIMEPITCH_TEST_GRF_DEFENSE_PROBE','1')
    with pytest.raises(ValueError):module.run_defensive_probe(tmp_path/'untrusted.json',root)
    assert m.cumulative_usage(root.with_name('continuation'))['used']==28


def test_constructor_failure_consumes_fake_attempt_and_never_retries(tmp_path,monkeypatch):
    module=api();m,root,d,pin=setup_probe(tmp_path,monkeypatch,reserved=False);created=[]
    monkeypatch.setenv('TIMEPITCH_TEST_GRF_DEFENSE_PROBE','1')
    monkeypatch.setattr(module,'_harness_freeze',lambda project:'e'*64)
    def fail(*args):created.append(1);raise RuntimeError('Synthetic capability failure before any child')
    monkeypatch.setattr(module,'DefensiveProbeProcess',fail)
    with pytest.raises(RuntimeError):module.run_defensive_probe(tmp_path/m.DESCRIPTOR,root)
    state=json.loads((root/'checkpoint.json').read_bytes())
    assert state['run']['state']=='failed' and len(created)==1
    assert (root/'evidence/D-defense-42/failure.json').is_file()
    assert m.cumulative_usage(root.with_name('continuation'))['used']==29
    with pytest.raises(ValueError):module.run_defensive_probe(tmp_path/m.DESCRIPTOR,root)
    assert len(created)==1


def test_research_sample_adapter_never_steps_or_drains_and_rejects_clock_overflow(tmp_path):
    from grf_defense_fixtures import records
    from timepitch.grf.defensive_probe_runner import observe_sample
    from timepitch.grf.defensive_probe_wire import DefenseSidecarWriter
    from test_grf_defensive_probe_wire import IDENTITY,WINDOWS
    calls=[];snapshot=dict(enabled=True,overflowed=False,physics_ms=100,records=records())
    engine=SimpleNamespace(probe_defense_snapshot=lambda:(calls.append(1) or snapshot))
    w=DefenseSidecarWriter(tmp_path/'d',IDENTITY,WINDOWS)
    observe_sample(engine,w,WINDOWS,(0,0,1));assert not calls
    observe_sample(engine,w,WINDOWS,(1,100,1));assert calls==[1]
    for field,value in (('enabled',False),('overflowed',True),('physics_ms',99)):
        before=snapshot[field];snapshot[field]=value
        with pytest.raises(ValueError):observe_sample(engine,w,WINDOWS,(2,200,1))
        snapshot[field]=before
    w.close()


@pytest.fixture(scope='module')
def complete_probe_wire(tmp_path_factory):
    from grf_action_fixtures import write_action_match
    from timepitch.grf.physical_codec import manifest_hash
    path=tmp_path_factory.mktemp('research-wire');m=write_action_match(path)
    m.native_binary_sha256=N;m.trace_hash=manifest_hash(m)
    (path/'manifest.json').write_bytes(m.model_dump_json().encode())
    return path,m


def test_research_pin_admits_complete_synthetic_child_without_forging_native_identity(complete_probe_wire,tmp_path):
    from timepitch.grf.action_process import ActionProcess
    from timepitch.grf.models import EngineCapability
    module=api();path,m=complete_probe_wire
    class SyntheticProbe(module.DefensiveProbeProcess):
        def __init__(self):
            ActionProcess.__init__(self,Path(sys.executable),path,timeout=60)
            self.native_sha256=N;self.identity={'native_sha256':N};self.frozen_input=m.input.model_dump(mode='json')
            self.evidence=tmp_path;self.last_received_physics_ms=None
            self.observed=self.evidence;self.cancel_after_first=False
        def capability(self):return EngineCapability(id='grf',available=True)
        def _command(self):
            return [str(self.python_path),str(Path(__file__).parent/'fixtures/grf/action_wire_child.py'),str(path),'ok']
    process=SyntheticProbe();result=None
    try:
        result=process.run(m.input,threading.Event())
        assert result.manifest==m and result.manifest.native_binary_sha256==N and result.count==55
        assert (tmp_path/'54.zlib').is_file() and (tmp_path/'manifest.json').is_file()
        assert process.last_received_physics_ms==5400000 and not process._active
        with pytest.raises(ValueError):validate_manifest(m,result.chunks())
    finally:
        if result:result.close()
        process.close()


def test_portable_worker_imports_and_roundtrips_in_python310_without_football(tmp_path):
    project=Path(__file__).resolve().parents[2];python=project/'.local/grf-spike/python/python.exe'
    if not python.is_file():pytest.skip('Portable runtime unavailable; no football execution')
    runner=project/'backend/src/timepitch/grf/defensive_probe_runner.py'
    code='''
import runpy,sys
from pathlib import Path
from types import SimpleNamespace
runpy.run_path(sys.argv[1],run_name='import_only')
sys.path.insert(0,sys.argv[2])
from grf_defense_fixtures import records
import defensive_probe_wire as wire
identity=dict(input_hash='a'*64,native_sha256='b'*64,descriptor_sha256='c'*64,build_manifest_sha256='d'*64)
windows=[dict(event_seq=1,event_ms=200,start_ms=90,end_ms=200)]
path=Path(sys.argv[3])/'portable.jsonl';w=wire.DefenseSidecarWriter(path,identity,windows)
w.append(100,1,records());w.append(200,2,records(200));w.finish('e'*64)
m=SimpleNamespace(input=SimpleNamespace(input_hash='a'*64),native_binary_sha256='b'*64,trace_hash='e'*64,
    duration_ms=5400000,periods=[SimpleNamespace(duration_ms=2700000)]*2)
assert wire.validate_defense_sidecar(path,manifest=m,descriptor=dict(identity=identity,windows=windows))['records']==44
assert next(wire.iter_defense_frames(path))['records']==records()
assert not any(k=='gfootball' or k.startswith('gfootball.') or k=='pydantic' for k in sys.modules)
print(sys.version_info[:2])
'''
    completed=subprocess.run([str(python),'-I','-X','utf8','-c',code,str(runner),str(Path(__file__).parent),str(tmp_path)],
        capture_output=True,text=True,timeout=20)
    assert completed.returncode==0,completed.stderr
    assert '(3, 10)' in completed.stdout
