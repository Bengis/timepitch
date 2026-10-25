"""Opaque one-use recovery, validated only after the common OS lease is held."""
from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from typing import Annotated, Callable
import weakref

from pydantic import ConfigDict, Field, StrictInt
from .models import StrictModel,Digest,canonical_bytes
from .canary_budget import CanaryBudget,CanaryRefused,authorization_digest
from .worker_state import safe_path


def now_ns():return time.monotonic_ns()


class NativeAbsenceEvidence(StrictModel):
    model_config=ConfigDict(extra='forbid',strict=True,frozen=True)
    boot_id:Digest
    observed_ns:Annotated[StrictInt,Field(ge=0)]
    processes_absent:bool
    inventory_complete:bool
    snapshot_digest:Digest


def inspect_native_absence(root):
    """Read-only Windows inventory. No service/model commands or manager construction."""
    if os.name!='nt':raise CanaryRefused('The pinned PC runtime requires Windows ownership checks')
    private=safe_path(Path(root)/'.local/foundry-runtime/0.8.119')
    script="""
$ErrorActionPreference='Stop'
$boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
$complete=$true; $absent=$true
$prefix=$env:TIMEPITCH_CANARY_PRIVATE+[IO.Path]::DirectorySeparatorChar
$items=@(Get-CimInstance Win32_Process -Filter "Name='foundry.exe' OR Name='Inference.Service.Agent.exe' OR Name='RestartAgent.exe'")
foreach($item in $items) {
 if(-not $item.ExecutablePath) { $complete=$false; continue }
 if($item.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { $absent=$false }
 elseif($item.Name -ne 'foundry.exe') { $complete=$false }
}
@{boot=$boot; absent=$absent; complete=$complete} | ConvertTo-Json -Compress
"""
    env={key:value for key,value in os.environ.items() if key.lower()!='psmodulepath'}
    try:
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],
            env={**env,'TIMEPITCH_CANARY_PRIVATE':str(private)},capture_output=True,timeout=10)
        if result.returncode or len(result.stdout)>2048:raise ValueError()
        value=json.loads(result.stdout)
        if set(value)!={'boot','absent','complete'} or type(value['boot']) is not str or not 1<=len(value['boot'])<=100:raise ValueError()
        return NativeAbsenceEvidence(boot_id=sha256(value['boot'].encode()).hexdigest(),observed_ns=now_ns(),
            processes_absent=value['absent'],inventory_complete=value['complete'],
            snapshot_digest=sha256(json.dumps(value,sort_keys=True).encode()).hexdigest())
    except (OSError,ValueError,subprocess.SubprocessError):raise CanaryRefused('Native ownership cannot be established') from None


class CanaryRecoveryPermit(StrictModel):
    model_config=ConfigDict(extra='forbid',strict=True,frozen=True)
    capability:Digest=Field(exclude=True,repr=False)
    authorization:Digest
    quarantine:Digest
    implementation:Digest
    continuation_nonce:Digest
    boot_id:Digest
    issued_ns:Annotated[StrictInt,Field(ge=0)]
    snapshot_digest:Digest


@dataclass
class _PermitEntry:
    permit:CanaryRecoveryPermit
    budget:CanaryBudget
    inspector:Callable
    lease:object=None


_permits={}


def _fresh(evidence):
    e=NativeAbsenceEvidence.model_validate_json(evidence.model_dump_json())
    if not e.processes_absent or not e.inventory_complete or not 0<=now_ns()-e.observed_ns<=30_000_000_000:
        raise CanaryRefused('Current native quiescence is not established')
    return e


def issue_canary_permit(budget,*,inspector=None):
    if budget.snapshot().state!='fresh':raise CanaryRefused('Canary is not fresh')
    inspect=inspector or (lambda:inspect_native_absence(budget.root))
    from ..config import ROOT
    if budget.root==ROOT and inspector is not None:raise CanaryRefused('Production recovery requires native ownership inspection')
    e=_fresh(inspect());a=budget.authorization
    p=CanaryRecoveryPermit(capability=secrets.token_hex(32),authorization=authorization_digest(a),
        quarantine=a.predecessor_hashes['quarantine'],implementation=sha256(json.dumps(a.implementation,sort_keys=True).encode()).hexdigest(),
        continuation_nonce=budget.nonce(),boot_id=e.boot_id,issued_ns=now_ns(),snapshot_digest=e.snapshot_digest)
    budget.claim_recovery(sha256(p.capability.encode()).hexdigest())
    _permits[p.capability]=_PermitEntry(p,budget,inspect)
    return p


def _entry(permit):
    if type(permit) is not CanaryRecoveryPermit:raise CanaryRefused('Invalid scoped recovery')
    entry=_permits.get(permit.capability)
    if entry is None or entry.permit is not permit:raise CanaryRefused('Unknown or copied recovery permit')
    return entry


def validate_canary_recovery(permit,*,root,lease=None):
    from ..runtime import RuntimeLease
    e=_entry(permit);b=e.budget;expected=safe_path(Path(root)/'.local/inference.lock')
    if (type(lease) is not RuntimeLease or not lease._lock_held or lease.stream is None
            or lease.canary_recovery is not permit or safe_path(lease.path)!=expected or safe_path(root)!=b.root
            or e.lease is not None):raise CanaryRefused('Recovery requires its original common OS lease')
    if not 0<=now_ns()-permit.issued_ns<=30_000_000_000:raise CanaryRefused('Recovery is stale')
    if b.snapshot().state!='fresh' or b.nonce()!=permit.continuation_nonce:raise CanaryRefused('Recovery state changed')
    current=_fresh(e.inspector())
    if current.boot_id!=permit.boot_id or current.snapshot_digest!=permit.snapshot_digest:raise CanaryRefused('Native snapshot changed')
    b.consume_recovery(sha256(permit.capability.encode()).hexdigest())
    e.lease=weakref.ref(lease)


def assert_active_canary(permit,budget):
    e=_entry(permit);lease=e.lease() if e.lease else None
    if (lease is None or not lease._lock_held or lease.stream is None or e.budget.path!=budget.path
            or budget.nonce()!=permit.continuation_nonce or budget.snapshot().state!='running'):
        raise CanaryRefused('Canary is not the active scoped admission')
