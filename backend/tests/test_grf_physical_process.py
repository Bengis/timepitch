import threading
import sys
import time
from pathlib import Path
import pytest
from timepitch.grf.physical_process import PhysicalProcess
from timepitch.grf.process import GrfCancelled
from grf_fixtures import request_fixture,DATASET
from timepitch.catalog.repository import CatalogRepository
from timepitch.grf.input import make_physical_input
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfExecutionError,GrfTimeout
from grf_physical_fixtures import write_match


@pytest.fixture(scope='module')
def wire_match(tmp_path_factory):
    path=tmp_path_factory.mktemp('wire');return path,write_match(path)


class WireProcess(PhysicalProcess):
    def __init__(self,path,mode='ok',timeout=30):
        super().__init__(Path(sys.executable),path,timeout=timeout);self.mode=mode
    def capability(self):return EngineCapability(id='grf',available=True)
    def _command(self):return [str(self.python_path),str(Path(__file__).parent/'fixtures/grf/physical_wire_child.py'),str(self.native_dir),self.mode]


def test_pre_cancelled_native_job_never_spawns(tmp_path):
    process=PhysicalProcess(tmp_path/'missing.exe',tmp_path)
    cancel=threading.Event();cancel.set()
    with pytest.raises(GrfCancelled):process.run(make_physical_input(request_fixture().config,CatalogRepository(DATASET)),cancel)


def test_streaming_process_validates_complete_match_without_retaining_all_chunks(wire_match):
    path,manifest=wire_match;process=WireProcess(path)
    result=process.run(manifest.input,threading.Event())
    try:
        assert result.manifest==manifest and result.count==55
        assert next(result.chunks()).index==0
        assert result.chunks().__class__.__name__=='generator'
    finally:result.close();process.close()


@pytest.mark.parametrize('mode',['hash','duplicate','reorder','no_manifest'])
def test_protocol_corruption_never_returns_a_result(wire_match,mode):
    path,manifest=wire_match;process=WireProcess(path,mode)
    try:
        with pytest.raises(GrfExecutionError):process.run(manifest.input,threading.Event())
    finally:process.close()


@pytest.mark.parametrize('mode',['hang','partial'])
def test_timeout_and_midstream_cancellation_stop_child_and_remove_spool(wire_match,mode):
    path,manifest=wire_match;cancel=threading.Event();process=WireProcess(path,mode,timeout=.3 if mode=='hang' else 10)
    timer=threading.Timer(.3,cancel.set) if mode=='partial' else None
    if timer:timer.start()
    try:
        start=time.monotonic()
        with pytest.raises(GrfTimeout if mode=='hang' else GrfCancelled):process.run(manifest.input,cancel)
        assert time.monotonic()-start<5 and not process._active
    finally:
        if timer:timer.cancel()
        process.close()


def test_private_memory_guard_terminates_oversized_worker(wire_match,monkeypatch):
    monkeypatch.setattr('timepitch.grf.physical_resources.private_bytes',lambda child:512*1024*1024+1)
    path,manifest=wire_match;process=WireProcess(path,'hang')
    try:
        with pytest.raises(GrfExecutionError):process.run(manifest.input,threading.Event())
        assert not process._active
    finally:process.close()
