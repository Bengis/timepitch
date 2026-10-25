import sys,threading,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
from grf_fixtures import request_fixture
from timepitch.grf.models import EngineCapability
from timepitch.grf.process import GrfProcess,GrfTimeout,GrfExecutionError,GrfCancelled
from timepitch.grf import runtime_layout

FIXTURE=Path(__file__).parent/'fixtures/grf/process_fixture.py'


class BoundaryProcess(GrfProcess):
    """Real child process exercising I/O, not a native acceptance substitute."""
    def __init__(self,mode,**kw):super().__init__(Path(sys.executable),FIXTURE.parent,**kw);self.mode=mode
    def capability(self):return EngineCapability(id='grf',available=True)
    def _command(self):return [sys.executable,'-u',str(FIXTURE),self.mode]


def test_missing_runtime_and_changed_native_binary_are_unavailable(tmp_path):
    assert GrfProcess(tmp_path/'absent.exe',tmp_path).capability().reason=='missing_runtime'
    runtime_layout.native_binary(tmp_path).write_bytes(b'wrong')
    assert GrfProcess(Path(sys.executable),tmp_path).capability().reason=='unsupported_native_binary'


@pytest.mark.parametrize('mode',['stdout','stderr','invalid','exit'])
def test_invalid_or_excessive_child_output_is_rejected_and_reaped(mode):
    runner=BoundaryProcess(mode,timeout=3,stdout_limit=1024,stderr_limit=1024)
    try:
        with pytest.raises(GrfExecutionError):runner.run(request_fixture(),threading.Event())
        assert not runner._active
    finally:runner.close()


def test_timeout_works_even_when_child_never_reads_stdin():
    runner=BoundaryProcess('sleep',timeout=.2)
    start=time.monotonic()
    try:
        with pytest.raises(GrfTimeout):runner.run(request_fixture(),threading.Event())
        assert time.monotonic()-start<6
        assert not runner._active
    finally:runner.close()


def test_close_cancels_active_child_and_prevents_later_launch():
    runner=BoundaryProcess('sleep');pool=ThreadPoolExecutor(1)
    future=pool.submit(runner.run,request_fixture(),threading.Event())
    deadline=time.monotonic()+5
    while not runner._active and time.monotonic()<deadline:time.sleep(.01)
    child=next(iter(runner._active))
    runner.close()
    with pytest.raises(GrfCancelled):future.result(timeout=6)
    assert child.poll() is not None
    with pytest.raises(GrfCancelled):runner.run(request_fixture(),threading.Event())
    pool.shutdown()


@pytest.mark.parametrize('missing', ['data/media/objects/players/player.object', 'data/media/animations/base.anim.util', 'SDL2_gfx.dll'])
def test_partial_native_installation_is_unavailable(tmp_path, monkeypatch, missing):
    import hashlib,json
    import timepitch.grf.process as process_module
    monkeypatch.setattr(runtime_layout,'PLATFORM','win32')
    python=tmp_path/'python/python.exe';python.parent.mkdir();python.write_bytes(b'python')
    native=tmp_path/'native';native.mkdir();binary=native/'_gameplayfootball.pyd';binary.write_bytes(b'native')
    monkeypatch.setattr(process_module,'NATIVE_SHA256',hashlib.sha256(binary.read_bytes()).hexdigest())
    packages=python.parent/'Lib/site-packages';assets=packages/'gfootball_engine'
    names=json.loads(Path(process_module.__file__).with_name('assets.json').read_text())
    files=[packages/'gfootball/env/football_env_core.py',assets/'fonts/AlegreyaSansSC-ExtraBold.ttf']
    files += [assets/'data'/name for name in names]
    dlls=('SDL2.dll','SDL2_gfx.dll','SDL2_image.dll','SDL2_ttf.dll','boost_python310-vc141-mt-x64-1_78.dll',
          'boost_filesystem-vc141-mt-x64-1_78.dll','boost_thread-vc141-mt-x64-1_78.dll',
          'brotlicommon.dll','brotlidec.dll','bz2.dll','freetype.dll','libpng16.dll','python310.dll','zlib1.dll')
    files += [native/name for name in dlls]
    for path in files:path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'present')
    runner=GrfProcess(python,native)
    assert runner.capability().available
    target=(assets/missing) if missing.startswith('data/') else (native/missing)
    assert target.is_file();target.unlink()
    assert runner.capability().reason=='missing_assets'
