"""Synthetic child integration and portable adapter tests: zero football processes."""
import json
from pathlib import Path
import sys,threading,time
import pytest
from grf_action_fixtures import write_action_match, semantic
from grf_statistics_fixtures import native_event
from timepitch.grf.action_process import ActionProcess
from timepitch.grf.action_native import ActionNativeAdapter
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfExecutionError,GrfTimeout,GrfCancelled
from timepitch.grf.physical_process import PhysicalProcess
from timepitch.grf.physical_models import ActivityInput


@pytest.fixture(scope='module')
def wire_actions(tmp_path_factory):
    path=tmp_path_factory.mktemp('action-wire');return path,write_action_match(path)


class ActionWireProcess(ActionProcess):
    def __init__(self,path,mode='ok',timeout=45):
        super().__init__(Path(sys.executable),path,timeout=timeout);self.mode=mode
    def capability(self):return EngineCapability(id='grf',available=True)
    def _command(self):return [str(self.python_path),str(Path(__file__).parent/'fixtures/grf/action_wire_child.py'),str(self.native_dir),self.mode]


def test_complete_child_transports_action_fields_and_removes_result_spool(wire_actions):
    path,manifest=wire_actions;process=ActionWireProcess(path)
    try:
        result=process.run(manifest.input,threading.Event());spool=result.path
        assert result.manifest==manifest and result.count==55
        first=next(result.chunks())
        assert first.contact_roles==[2] and first.semantic_events[0].intent=='pass'
        assert result.chunks().__class__.__name__=='generator'
        result.close();assert not spool.exists()
    finally:process.close()


@pytest.mark.parametrize('mode',['omitted','duplicate','reorder','role','overflow','counts','no_manifest'])
def test_invalid_action_stream_fails_and_removes_spool(wire_actions,mode,monkeypatch):
    import timepitch.grf.physical_process as module
    original=module.PhysicalResult;paths=[]
    def tracked():
        value=original();paths.append(value.path);return value
    monkeypatch.setattr(module,'PhysicalResult',tracked)
    path,manifest=wire_actions;process=ActionWireProcess(path,mode)
    try:
        with pytest.raises(GrfExecutionError):process.run(manifest.input,threading.Event())
        assert paths and all(not p.exists() for p in paths) and not process._active
    finally:process.close()


@pytest.mark.parametrize('mode',['hang','partial'])
def test_cancel_and_timeout_remove_action_child(wire_actions,mode):
    path,m=wire_actions;cancel=threading.Event();process=ActionWireProcess(path,mode,timeout=.3 if mode=='hang' else 30)
    timer=threading.Timer(.3,cancel.set) if mode=='partial' else None
    if timer:timer.start()
    try:
        start=time.monotonic()
        with pytest.raises(GrfTimeout if mode=='hang' else GrfCancelled):process.run(m.input,cancel)
        assert time.monotonic()-start<5 and not process._active
    finally:
        if timer:timer.cancel()
        process.close()


def test_memory_guard_and_wrong_input_binary_combinations_reject(wire_actions,monkeypatch):
    path,m=wire_actions
    monkeypatch.setattr('timepitch.grf.physical_resources.private_bytes',lambda child:512*1024*1024+1)
    p=ActionWireProcess(path,'hang')
    try:
        with pytest.raises(GrfExecutionError):p.run(m.input,threading.Event())
        assert not p._active
    finally:p.close()
    def forbidden(*args,**kwargs):pytest.fail('Invalid input must not create a child')
    monkeypatch.setattr('subprocess.Popen',forbidden)
    legacy=ActivityInput(**m.input.model_dump(exclude={'settings'}))
    with pytest.raises(GrfExecutionError):ActionWireProcess(path).run(legacy,threading.Event())
    with pytest.raises(GrfExecutionError):PhysicalProcess(Path(sys.executable),path).run(m.input,threading.Event())
    wrong=ActionWireProcess(path);wrong.native_sha256='f'*64
    with pytest.raises(GrfExecutionError):wrong.run(m.input,threading.Event())


def test_incompatible_binary_is_detected_without_importing_grf(tmp_path):
    (tmp_path/'_gameplayfootball.pyd').write_bytes(b'not the pinned binary')
    capability=ActionProcess(Path(sys.executable),tmp_path).capability()
    assert not capability.available and capability.reason=='unsupported_native_binary'


class NativeDouble:
    """Exact native dictionary boundary; all game machinery stays absent."""
    def __init__(self):self.roles=[dict(raw_event_seq=0,role=2)];self.count=1;self.overflow=False
    def probe_step_physical(self,*args):raise AssertionError('No football stepping')
    def probe_physical_state(self):return dict(actual_time_ms=2300)
    def probe_drain_stats(self):
        e=native_event(actual_time_ms=2400);e.pop('sample_index');e.pop('raw_actor_xy');e.pop('raw_ball_xyz')
        e.update(actor_team=1,team=1,mirrored=False,actor_xy=[.2,.3],ball_xyz=[.4,.5,.6])
        return dict(events=[e],emitted_count=1,overflowed=False)
    def probe_drain_actions(self):
        e=semantic();e.pop('physics_ms');e.pop('sample_index');e.update(actual_time_ms=2400,actor_team=1,release_key=(1,9,1,30),touch_frame=30)
        return dict(enabled=True,roles=self.roles,events=[e],raw_event_count=self.count,semantic_event_count=1,overflowed=self.overflow)
    def probe_drain_touches(self):return []


def test_adapter_subtracts_internal_origin_and_preserves_sequence_and_single_normalization():
    from types import SimpleNamespace
    engine=NativeDouble();adapter=ActionNativeAdapter(SimpleNamespace(_env=engine),None)
    batch=adapter.drain(7)
    assert batch['events'][0]['actual_time_ms']==100
    assert batch['events'][0]['actor_xy']==[-.2,-.3]
    assert batch['events'][0]['raw_actor_xy']==[.2,.3]
    assert batch['semantic_events'][0]['physics_ms']==100 and batch['semantic_events'][0]['sample_index']==7
    assert batch['contact_roles']==[2] and batch['semantic_events'][0]['seq']==0


@pytest.mark.parametrize('change',['roles','count','overflow'])
def test_adapter_rejects_misaligned_roles_counts_and_native_overflow(change):
    from types import SimpleNamespace
    engine=NativeDouble()
    if change=='roles':engine.roles=[]
    if change=='count':engine.count=2
    if change=='overflow':engine.overflow=True
    with pytest.raises(ValueError):ActionNativeAdapter(SimpleNamespace(_env=engine),None).drain(1)
