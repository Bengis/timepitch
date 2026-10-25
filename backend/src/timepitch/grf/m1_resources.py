"""Pure bounded resource accounting; no process creation, admission or native import."""
from dataclasses import asdict,dataclass
import math
import os
from pathlib import Path
import re
import time
from types import SimpleNamespace

from .physical_resources import private_bytes
from .physical_wire import canonical
from .shot_context_wire import _identity

LIMIT_SECONDS=600
LIMIT_PRIVATE_BYTES=536870912
MAX_FAILURE_BYTES=16384
STAGES=('capture_preflight','capture','admission','finalize','cleanup')


def _wall_clock():return time.monotonic()
def _cpu_clock():return time.process_time()
def _parent_peak():
    return private_bytes(SimpleNamespace(pid=os.getpid(),_handle=-1,poll=lambda:None))


def _finite(value):
    if type(value) not in (int,float):return False
    try:return math.isfinite(value) and value>=0
    except OverflowError:return False


def _memory(value):
    return type(value) is int and 0<value<2**64


@dataclass(frozen=True)
class ResourceSnapshot:
    stage:str
    elapsed_seconds:float|None
    cpu_seconds:float|None
    parent_peak_private_bytes:int|None
    child_peak_private_bytes:int|None
    stage_wall_seconds:tuple[tuple[str,float],...]
    stage_cpu_seconds:tuple[tuple[str,float],...]
    exceeded_time:bool
    exceeded_memory:bool
    sensor_status:str
    sensor_errors:tuple[str,...]
    memory_scope:str
    limit_seconds:int=LIMIT_SECONDS
    limit_private_bytes:int=LIMIT_PRIVATE_BYTES

    @property
    def peak_private_bytes(self):
        known=[n for n in (self.parent_peak_private_bytes,self.child_peak_private_bytes) if n is not None]
        return max(known) if known else None


class M1ResourceExceeded(ValueError):
    """Includes unavailable sensors as fail-closed resource failures."""
    def __init__(self,snapshot:ResourceSnapshot):
        self.snapshot=snapshot
        self.diagnostic_error=None
        axes=[name for name,yes in (('time',snapshot.exceeded_time),('memory',snapshot.exceeded_memory)) if yes]
        reason=','.join(axes or snapshot.sensor_errors)
        super().__init__(f'M1 resource failure at {snapshot.stage}: {reason}')


class M1Budget:
    """One deadline. Checkpoint labels mark the next/current stage of work.

    The interval since the last checkpoint belongs to its previous stage.
    Failure is latched; cleanup cannot restart a failed budget. A zero child
    argument means no new observation, not a measurement of zero memory.
    """
    def __init__(self):
        self._stage=STAGES[0]
        self._wall_totals=dict.fromkeys(STAGES,0.)
        self._cpu_totals=dict.fromkeys(STAGES,0.)
        self._parent=None;self._child=None;self._failure=None
        self.latest=None
        self._scope=('max-per-process; parent-Windows-lifetime-peak; child-observed-peak' if os.name=='nt'
                     else 'max-per-process; parent-observed-RSS-peak; child-observed-peak')
        self._start=self._sample(_wall_clock)
        self._cpu_start=self._sample(_cpu_clock)
        self._last=self._start;self._cpu_last=self._cpu_start
        errors=[]
        if not _finite(self._start):errors.append('clock_invalid')
        if not _finite(self._cpu_start):errors.append('cpu_invalid')
        if errors:self._raise(self._snapshot(None,None,None,errors))

    @staticmethod
    def _sample(fn):
        try:return fn()
        except Exception:return None

    def _snapshot(self,elapsed,cpu,parent,errors):
        peaks=[x for x in (parent,self._child) if x is not None]
        return ResourceSnapshot(self._stage,elapsed,cpu,parent,self._child,
            tuple(self._wall_totals.items()),tuple(self._cpu_totals.items()),
            elapsed is not None and elapsed>LIMIT_SECONDS,
            any(x>LIMIT_PRIVATE_BYTES for x in peaks),'ok' if not errors else errors[0],tuple(errors),self._scope)

    def _raise(self,snapshot):
        self._failure=M1ResourceExceeded(snapshot)
        raise self._failure

    def checkpoint(self,stage:str,*,child_peak:int=0)->ResourceSnapshot:
        if self._failure is not None:raise self._failure
        if type(stage) is not str or stage not in STAGES:raise ValueError('Known M1 resource stage required')
        now=self._sample(_wall_clock);cpu_now=self._sample(_cpu_clock);errors=[]
        elapsed=cpu=None
        if not _finite(now) or now<self._last:errors.append('clock_invalid')
        else:
            self._wall_totals[self._stage]+=now-self._last
            self._last=now;elapsed=now-self._start
        if not _finite(cpu_now) or cpu_now<self._cpu_last:errors.append('cpu_invalid')
        else:
            self._cpu_totals[self._stage]+=cpu_now-self._cpu_last
            self._cpu_last=cpu_now;cpu=cpu_now-self._cpu_start
        parent=self._sample(_parent_peak)
        if not _memory(parent):parent=None;errors.append('memory_unavailable')
        else:self._parent=parent=max(self._parent or parent,parent)
        if type(child_peak) is not int or child_peak<0 or child_peak>=2**64:
            errors.append('child_memory_unavailable')
        elif child_peak:self._child=max(self._child or child_peak,child_peak)
        self._stage=stage
        snapshot=self._snapshot(elapsed,cpu,parent,errors)
        self.latest=snapshot
        if errors or snapshot.exceeded_time or snapshot.exceeded_memory:self._raise(snapshot)
        return snapshot


def record_resource_failure(path:Path,error:M1ResourceExceeded,*,identity:dict,
                            trace_hash:str|None,last_durable_block:int|None,last_durable_ms:int|None)->bool:
    """Exclusive bounded diagnostic. Never replace the exception or an old file.

    Caller retains/re-raises error. False records the diagnostic error type
    on it; partial writes remain evidence and are never retried or removed.
    The caller supplies a canonical evidence path and its actual durable
    watermark, not an unobserved child tail. No directories are created.
    """
    try:
        if not isinstance(error,M1ResourceExceeded):raise TypeError('Typed resource failure required')
        snapshot=error.snapshot
        if ((snapshot.limit_seconds,snapshot.limit_private_bytes)!=(LIMIT_SECONDS,LIMIT_PRIVATE_BYTES) or
            not (snapshot.exceeded_time or snapshot.exceeded_memory or snapshot.sensor_errors)):
            raise ValueError('Actual failure under the fixed resource policy required')
        p=Path(path).absolute()
        if p.name!='resource-failure.json' or p!=p.resolve():raise ValueError('Canonical resource failure path required')
        _identity(identity)
        if trace_hash is not None and (type(trace_hash) is not str or not re.fullmatch('[0-9a-f]{64}',trace_hash)):
            raise ValueError('Trace hash or unavailable required')
        if (last_durable_block is None)!=(last_durable_ms is None):raise ValueError('Paired durable watermark required')
        if last_durable_block is not None:
            if type(last_durable_block) is not int or not 0<=last_durable_block<=75 or type(last_durable_ms) is not int or not 0<=last_durable_ms<=7440000:
                raise ValueError('Invalid durable watermark')
        raw=canonical(dict(schema_version='m1-resource-failure-1',identity=identity,trace_hash=trace_hash,
            resources=asdict(error.snapshot),last_durable_block=last_durable_block,last_durable_ms=last_durable_ms,
            admitted=False,resource_scope='current-budget-not-recovered-historical-telemetry'))
        if len(raw)>MAX_FAILURE_BYTES:raise ValueError('Resource diagnostic budget')
        with p.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        return True
    except Exception as diagnostic_error:
        if isinstance(error,M1ResourceExceeded):error.diagnostic_error=type(diagnostic_error).__name__
        return False
