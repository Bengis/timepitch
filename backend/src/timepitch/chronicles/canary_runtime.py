"""Owned PC startup/restore only; constructed lazily by the selected live runner."""
import os
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET
from typing import Annotated

from pydantic import Field,StrictInt
from .models import StrictModel,MODEL
from .canary_budget import CanaryRefused
from .canary_recovery import inspect_native_absence
from .worker_state import safe_path,atomic_write
from .provider import verify_private_runtime
from ..agents.provider import require_loopback


# Conservative policy headroom, not a measured model allocation requirement.
MIN_FREE_GPU_MIB=4096


def verify_pinned_runtime_manifest(executable):
    """Disk-only file/version gate; never query or prepare a service/model."""
    try:
        exe=safe_path(executable)
        if not exe.is_file():raise ValueError()
        root=ET.parse(safe_path(exe.parent/'AppxManifest.xml')).getroot()
        namespace='{http://schemas.microsoft.com/appx/manifest/foundation/windows10}'
        identities=root.findall(namespace+'Identity')
        if root.tag!=namespace+'Package' or len(identities)!=1 or identities[0].get('Version')!='0.8.119.102':
            raise ValueError()
        return identities[0].get('Version')
    except (OSError,ValueError,ET.ParseError):
        raise CanaryRefused('Pinned private runtime manifest unavailable or changed') from None


class OwnedRuntimeChanges(StrictModel):
    runtime_intent:bool=False
    runtime_started:bool=False
    model_intent:bool=False
    model_load_completed:bool=False
    inference_uncertain:bool=False
    pid:Annotated[StrictInt,Field(gt=0)]|None=None


def new_manager():
    from foundry_local import FoundryLocalManager
    return FoundryLocalManager(bootstrap=False,timeout=30)


class OwnedRuntimeController:
    def __init__(self,root,directory):
        self.root=safe_path(root);self.directory=safe_path(directory)
        self.exe=safe_path(self.root/'.local/foundry-runtime/0.8.119/foundry.exe')
        self.journal=safe_path(self.directory/'owned-runtime.json')
        self.changes=OwnedRuntimeChanges();self.process=None;self.manager=None;self.previous_path=None

    def inspect_absence(self):return inspect_native_absence(self.root)

    def _save(self,**updates):
        self.changes=OwnedRuntimeChanges.model_validate({**self.changes.model_dump(),**updates})
        atomic_write(self.journal,self.changes.model_dump_json().encode())

    def owned_changes(self):return self.changes.model_copy()

    def start_and_load(self,timeout_s=120):
        from foundry_local.models import DeviceType
        started=time.monotonic()
        absence=self.inspect_absence()
        if timeout_s!=120 or not absence.processes_absent or not absence.inventory_complete:raise CanaryRefused('Private runtime is not absent')
        verify_pinned_runtime_manifest(self.exe)
        free=subprocess.run(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],capture_output=True,timeout=5)
        if free.returncode or not free.stdout.strip().isdigit() or int(free.stdout)<MIN_FREE_GPU_MIB:raise CanaryRefused('Insufficient or unknown free GPU memory')
        self.previous_path=os.environ.get('PATH','');os.environ['PATH']=str(self.exe.parent)+os.pathsep+self.previous_path
        self._save(runtime_intent=True)
        self.process=subprocess.Popen([str(self.exe),'service','start'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        self._save(runtime_started=True,pid=self.process.pid)
        while True:
            if time.monotonic()-started>=timeout_s:raise CanaryRefused('Owned runtime setup deadline')
            try:verify_private_runtime(self.exe);break
            except (RuntimeError,OSError,ValueError,subprocess.SubprocessError):time.sleep(.2)
        self.manager=new_manager();require_loopback(self.manager.endpoint)
        info=self.manager.get_model_info('qwen2.5-1.5b',device=DeviceType.GPU)
        if f'{info.id}@{info.version}'!=MODEL or not info.supports_tool_calling:raise CanaryRefused('Exact GPU profile unavailable')
        if not any(m.id==info.id and str(m.version)==str(info.version) for m in self.manager.list_cached_models()):
            raise CanaryRefused('Cached weights unavailable; downloads forbidden')
        if self.manager.list_loaded_models():raise CanaryRefused('Another model is loaded in the private runtime')
        if time.monotonic()-started>=timeout_s:raise CanaryRefused('Owned runtime setup deadline')
        self._save(model_intent=True)
        self.manager.load_model('qwen2.5-1.5b',device=DeviceType.GPU)
        self._save(model_load_completed=True)
        if time.monotonic()-started>timeout_s:raise CanaryRefused('Owned runtime setup deadline')
        return self.owned_changes()

    def mark_inference_started(self):self._save(inference_uncertain=True)
    def mark_inference_finished(self):self._save(inference_uncertain=False)

    def restore(self,changes):
        from foundry_local.models import DeviceType
        try:
            if changes!=self.changes:raise CanaryRefused('Owned startup journal changed')
            if not changes.runtime_started:
                if changes.runtime_intent:
                    absence=self.inspect_absence()
                    if not absence.processes_absent or not absence.inventory_complete:raise CanaryRefused('Startup outcome uncertain')
                return
            if (changes.model_intent and not changes.model_load_completed) or changes.inference_uncertain:
                raise CanaryRefused('Native work is uncertain; preserve quarantine without stopping it')
            if self.process is None or self.process.pid!=changes.pid or self.process.poll() is not None:
                raise CanaryRefused('Owned runtime process cannot be established')
            verify_private_runtime(self.exe)
            if self.manager and changes.model_intent:
                loaded=self.manager.list_loaded_models()
                if any(f'{m.id}@{m.version}'!=MODEL for m in loaded):raise CanaryRefused('Another workload is present')
                if loaded:self.manager.unload_model('qwen2.5-1.5b',device=DeviceType.GPU,force=True)
            result=subprocess.run([str(self.exe),'service','stop'],capture_output=True,timeout=15)
            if result.returncode:raise CanaryRefused('Owned runtime did not stop cleanly')
            try:self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:raise CanaryRefused('Owned runtime has not exited') from None
            absence=self.inspect_absence()
            if not absence.processes_absent or not absence.inventory_complete:
                raise CanaryRefused('Native shutdown is not established')
        finally:
            if self.previous_path is not None:os.environ['PATH']=self.previous_path
