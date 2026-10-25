"""Private durable outbox. An interrupted generation requires operator recovery."""
from hashlib import sha256
import json
import os
from pathlib import Path
import stat
import tempfile
from typing import Annotated, Literal, get_args
from pydantic import ConfigDict, Field, StrictInt, ValidationError, model_validator
from .models import StrictModel, ClaimedJob, WorkerResult, LeaseRef, canonical_bytes, fact_pack_hash
from .diagnostics import ProviderDiagnostic, safe_diagnostic
from ..agents.provider import ModelOutputError, LocalModelTimeout


class RecoveryRequired(RuntimeError): pass


ErrorCategory=Literal['ModelOutputError','LocalModelTimeout','CancelledError','RecoveryRequired','BrokerError',
    'ValidationError','TimeoutError','OSError','RuntimeError','ValueError','TypeError','HTTPError',
    'ChatClientException','APIConnectionError','APITimeoutError','AcceptanceRefused','UnknownError']


def error_category(error):
    tag=vars(error).get('chronicle_error_category')
    if type(tag) is str and tag in get_args(ErrorCategory): return tag
    import asyncio
    from httpx import HTTPError
    for cls,name in ((ModelOutputError,'ModelOutputError'),(LocalModelTimeout,'LocalModelTimeout'),
            (asyncio.CancelledError,'CancelledError'),(RecoveryRequired,'RecoveryRequired'),
            (ValidationError,'ValidationError'),(TimeoutError,'TimeoutError'),(OSError,'OSError')):
        if isinstance(error,cls): return name
    name=type(error).__name__
    if name in ('BrokerError','ChatClientException','APIConnectionError','APITimeoutError','AcceptanceRefused'): return name
    if isinstance(error,HTTPError): return 'HTTPError'
    for cls,name in ((RuntimeError,'RuntimeError'),(ValueError,'ValueError'),(TypeError,'TypeError')):
        if isinstance(error,cls): return name
    return 'UnknownError'


def attach_failure(target,source=None,*,stage='unknown'):
    """Carry only revalidated metadata, including a known timeout's cancelled operation."""
    import asyncio
    source=target if source is None else source
    diagnostic=safe_diagnostic(source,stage=stage)
    category=error_category(source)
    if (diagnostic.reason=='unclassified_failure' and type(source) is TimeoutError
            and isinstance(source.__cause__,asyncio.CancelledError)):
        diagnostic=safe_diagnostic(source.__cause__,stage=stage)
        inherited=vars(source.__cause__).get('chronicle_error_category')
        if inherited in get_args(ErrorCategory) and inherited not in ('CancelledError','UnknownError'):
            category=inherited
    target.diagnostic=diagnostic
    target.chronicle_error_category=category
    if vars(source).get('diagnostic_persistence_error')=='diagnostic_persistence_failed':
        target.diagnostic_persistence_error='diagnostic_persistence_failed'
    return target


async def drain_cleanup(operation,*,failure=None):
    """Run one close to completion before propagating caller cancellation."""
    import asyncio
    task=asyncio.ensure_future(operation)
    cancelled=None
    while True:
        try:
            await asyncio.shield(task)
            break
        except asyncio.CancelledError as error:
            if cancelled is None:
                cancelled=attach_failure(error,failure) if failure is not None else attach_failure(error)
            if task.done(): break
        except Exception:
            if cancelled is None: raise
            break
    if cancelled is not None:
        if task.done() and not task.cancelled(): task.exception()
        raise cancelled


class FailureRecord(StrictModel):
    model_config=ConfigDict(extra='forbid',frozen=True)
    version:Literal['chronicle-diagnostic-1']='chronicle-diagnostic-1'
    lease_binding:Annotated[str,Field(pattern=r'^[a-f0-9]{64}$')]
    fact_hash:Annotated[str,Field(pattern=r'^[a-f0-9]{64}$')]
    error_category:ErrorCategory
    diagnostic:ProviderDiagnostic


def assert_inference_recovered(lock_path,*,canary_recovery=None,_lease=None):
    """Also fences legacy API/probes after a worker crash or uncertain send."""
    uncertain=safe_path(Path(lock_path).parent/'inference-uncertain.json')
    if canary_recovery is not None:
        from .canary_recovery import validate_canary_recovery
        validate_canary_recovery(canary_recovery,root=Path(lock_path).parent.parent,lease=_lease)
    elif uncertain.exists(): raise RecoveryRequired('Acceptance inference is uncertain; establish native quiescence first')
    directory=safe_path(Path(lock_path).parent/'ai-worker')
    guard=safe_path(directory/'active.guard.json'); active=safe_path(directory/'active.json')
    if not guard.exists() and not active.exists(): return
    try:
        if not guard.exists() or guard.stat().st_size>2048: raise ValueError()
        binding=json.loads(guard.read_bytes())['binding']
        saved=WorkerOutbox(active,binding=binding).load()
        if saved and saved.stage=='generation_started': raise ValueError()
    except (OSError,ValueError,KeyError,TypeError,RecoveryRequired):
        raise RecoveryRequired('Uncertain TimePitch inference requires recovery before any consumer can start') from None


def safe_path(path):
    path=Path(os.path.abspath(path))
    for part in (path,*path.parents):
        try: info=part.lstat()
        except FileNotFoundError: continue
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
            raise RecoveryRequired('Private worker path contains a link')
    return path


def atomic_write(path, data):
    safe_path(path); path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix='.worker-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        safe_path(path); os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)


class OutboxState(StrictModel):
    claim: ClaimedJob
    stage: Literal['claimed','generation_started','result_saved']
    result: WorkerResult | None = None
    lease_deadline_at: Annotated[float,Field(ge=0)]
    ack_attempts: Annotated[StrictInt,Field(ge=0,le=3)] = 0

    @model_validator(mode='after')
    def binding(self):
        if fact_pack_hash(self.claim.fact_pack)!=self.claim.lease.fact_hash: raise ValueError('Fact binding mismatch')
        if (self.stage=='result_saved')!=(self.result is not None): raise ValueError('Receipt does not match stage')
        if self.result and self.result.lease!=self.claim.lease: raise ValueError('Result belongs to another lease')
        if self.lease_deadline_at>self.claim.deadline_at: raise ValueError('Lease exceeds job deadline')
        return self


class WorkerOutbox:
    def __init__(self, path: Path, *, binding: str):
        self.path=safe_path(path); self.guard=safe_path(self.path.with_suffix('.guard.json')); self.binding=binding

    def diagnostic_path(self,lease:LeaseRef):
        fingerprint=sha256(self.binding.encode()+b'\0'+canonical_bytes(lease)).hexdigest()
        return safe_path(self.path.with_name(self.path.stem+'.'+fingerprint+'.diagnostic.json'))

    def read_diagnostic(self,lease:LeaseRef):
        path=self.diagnostic_path(lease)
        if not path.exists(): return None
        if path.stat().st_size>8192: raise RecoveryRequired('Invalid private diagnostic')
        try:
            value=FailureRecord.model_validate_json(path.read_bytes())
            expected=sha256(self.binding.encode()+b'\0'+canonical_bytes(lease)).hexdigest()
            if value.lease_binding!=expected or value.fact_hash!=lease.fact_hash: raise ValueError()
            return value
        except (OSError,ValueError): raise RecoveryRequired('Invalid private diagnostic') from None

    def save_diagnostic(self,lease:LeaseRef,diagnostic:ProviderDiagnostic,category:ErrorCategory):
        saved=self.read_diagnostic(lease)
        if saved is not None: return saved  # First failure for this lease is immutable.
        state=self.load()
        if state is None or state.claim.lease!=lease: raise RecoveryRequired('Diagnostic lease is not active')
        fingerprint=sha256(self.binding.encode()+b'\0'+canonical_bytes(lease)).hexdigest()
        value=FailureRecord(lease_binding=fingerprint,fact_hash=lease.fact_hash,error_category=category,
            diagnostic=ProviderDiagnostic.model_validate(diagnostic.model_dump()))
        raw=value.model_dump_json().encode()
        if len(raw)>8192: raise RecoveryRequired('Private diagnostic exceeds limit')
        atomic_write(self.diagnostic_path(lease),raw)
        return value

    def load(self):
        safe_path(self.path); safe_path(self.guard)
        try:
            if not self.guard.exists():
                if self.path.exists(): raise ValueError('Missing journal')
                return None
            if self.guard.stat().st_size>2048: raise ValueError('Oversized journal')
            guard=json.loads(self.guard.read_bytes())
            if guard['binding']!=self.binding: raise ValueError('Worker configuration changed')
            if guard['state']=='idle' and not self.path.exists(): return None
            if guard['state']!='active' or not self.path.exists() or self.path.stat().st_size>65536:
                raise ValueError('Missing or oversized active receipt')
            raw=self.path.read_bytes()
            if sha256(raw).hexdigest()!=guard['sha256']: raise ValueError('Changed outbox')
            return OutboxState.model_validate_json(raw)
        except (OSError,ValueError,KeyError,TypeError): raise RecoveryRequired('Private worker journal needs recovery') from None

    def save(self, state):
        state=OutboxState.model_validate_json(state.model_dump_json())
        previous=self.load()
        if previous:
            order=['claimed','generation_started','result_saved']
            if (previous.claim!=state.claim or order.index(state.stage)<order.index(previous.stage) or
                state.ack_attempts<previous.ack_attempts or previous.result and previous.result!=state.result):
                raise RecoveryRequired('Outbox cannot replace or rewind work')
        raw=canonical_bytes(state)
        guard=json.dumps({'binding':self.binding,'state':'active','sha256':sha256(raw).hexdigest()}).encode()
        # A crash between these atomic writes fails closed rather than losing started work.
        atomic_write(self.guard,guard); atomic_write(self.path,raw)

    def clear(self, lease: LeaseRef):
        saved=self.load()
        if saved is None or saved.claim.lease!=lease or saved.stage!='result_saved':
            raise RecoveryRequired('Only a completed original receipt can be cleared')
        safe_path(self.path); self.path.unlink()
        atomic_write(self.guard,json.dumps({'binding':self.binding,'state':'idle'}).encode())
