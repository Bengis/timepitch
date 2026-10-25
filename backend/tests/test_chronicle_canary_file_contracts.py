"""Real repository/files at the offline boundary; never runtime or admissions."""
import hashlib
import inspect
import os
from pathlib import Path
import socket
import subprocess

import pytest


@pytest.fixture(autouse=True)
def no_live_operations(monkeypatch):
    import foundry_local
    import timepitch.chronicles.canary_runtime as runtime
    import timepitch.chronicles.canary_budget as budget
    import timepitch.chronicles.canary_recovery as recovery
    from timepitch.config import ROOT
    before=(ROOT/'.local/ai-worker-continuations').exists()
    forbidden=[]
    def deny(*args,**kwargs):
        forbidden.append(True)
        raise AssertionError('Offline file contracts forbid native/network/admission operations')
    monkeypatch.setattr(subprocess,'Popen',deny)
    monkeypatch.setattr(subprocess,'run',deny)
    monkeypatch.setattr(socket.socket,'connect',deny)
    monkeypatch.setattr(socket,'getaddrinfo',deny)
    monkeypatch.setattr(foundry_local.FoundryLocalManager,'__init__',deny)
    monkeypatch.setattr(runtime,'new_manager',deny)
    monkeypatch.setattr(budget.CanaryBudget,'create_once',deny)
    monkeypatch.setattr(recovery,'issue_canary_permit',deny)
    yield
    assert not forbidden
    assert (ROOT/'.local/ai-worker-continuations').exists()==before


def test_actual_repository_binding_covers_the_real_worker_router():
    # A fabricated root used to create every declared path, hiding a missing module.
    from timepitch.config import ROOT
    from timepitch.api.chronicles import chronicles_router
    from timepitch.chronicles.canary_budget import canary_implementation_binding
    binding=canary_implementation_binding(ROOT)
    router=Path(inspect.getfile(chronicles_router)).resolve()
    relative=router.relative_to(ROOT).as_posix()
    assert relative=='backend/src/timepitch/api/chronicles.py'
    assert binding[relative]==hashlib.sha256(router.read_bytes()).hexdigest()
    assert binding and all((ROOT/name).is_file() for name in binding)


@pytest.mark.skipif(os.environ.get('TIMEPITCH_REAL_FILE_CONTRACTS')!='1',reason='Opt-in: cached private runtime files must exist; no preparation allowed')
def test_real_pinned_manifest_passes_startup_file_gate_without_native_start(tmp_path,monkeypatch):
    from timepitch.config import ROOT
    import timepitch.chronicles.canary_runtime as runtime
    from canary_fixtures import FakeNative
    controller=runtime.OwnedRuntimeController(ROOT,tmp_path)
    assert controller.exe.is_file()  # Opt-in must fail, never skip missing real files.
    manifest=controller.exe.parent/'AppxManifest.xml';before=manifest.read_bytes()
    native=FakeNative();monkeypatch.setattr(controller,'inspect_absence',native.inspect_absence)
    class ReachedGpuQuery(RuntimeError):pass
    def boundary(args,**kwargs):
        assert args==['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits']
        raise ReachedGpuQuery('Stop before the first native command')
    monkeypatch.setattr(runtime.subprocess,'run',boundary)
    with pytest.raises(ReachedGpuQuery):controller.start_and_load()
    assert controller.owned_changes().runtime_intent is False
    assert manifest.read_bytes()==before and not (tmp_path/'owned-runtime.json').exists()


@pytest.mark.parametrize('manifest',[
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Version="0.8.119.0"/></Package>',
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Version="0.8.119.103"/></Package>',
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Version="0.9.119.102"/></Package>',
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><!-- Version="0.8.119.102" --></Package>',
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Version="0.8.119.102"/><Identity Version="0.8.119.102"/></Package>',
    '<Package><Identity Version="0.8.119.102"/></Package>',
    '<Package malformed',
])
def test_unpinned_missing_or_malformed_identity_is_refused(tmp_path,manifest):
    from timepitch.chronicles.canary_runtime import verify_pinned_runtime_manifest
    from timepitch.chronicles.canary_budget import CanaryRefused
    exe=tmp_path/'foundry.exe';exe.write_bytes(b'synthetic')
    (tmp_path/'AppxManifest.xml').write_text(manifest,encoding='utf-8')
    with pytest.raises(CanaryRefused):verify_pinned_runtime_manifest(exe)


def test_exact_namespaced_package_identity_is_validated_as_xml(tmp_path):
    from timepitch.chronicles.canary_runtime import verify_pinned_runtime_manifest
    exe=tmp_path/'foundry.exe';exe.write_bytes(b'synthetic')
    (tmp_path/'AppxManifest.xml').write_text("<p:Package xmlns:p='http://schemas.microsoft.com/appx/manifest/foundation/windows10'><p:Identity Version='0.8.119.102'/></p:Package>",encoding='utf-8')
    assert verify_pinned_runtime_manifest(exe)=='0.8.119.102'


@pytest.mark.parametrize('missing',['exe','manifest'])
def test_missing_runtime_file_is_refused_without_preparing_it(tmp_path,missing):
    from timepitch.chronicles.canary_runtime import verify_pinned_runtime_manifest
    from timepitch.chronicles.canary_budget import CanaryRefused
    exe=tmp_path/'foundry.exe'
    if missing=='manifest':exe.write_bytes(b'synthetic')
    else:(tmp_path/'AppxManifest.xml').write_text('<Package/>',encoding='utf-8')
    with pytest.raises(CanaryRefused):verify_pinned_runtime_manifest(exe)
