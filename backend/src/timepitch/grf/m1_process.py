"""Private bounded M1 transport. Shares process cleanup and replay spool primitives.

The protocol has a typed failure and a separate research manifest, so it does
not add a selector or parser extension to the public PhysicalProcess.
"""
import base64
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
from .physical_process import PhysicalResult
from .process import GrfProcess,GrfExecutionError,GrfCancelled,GrfTimeout
from .physical_resources import private_bytes
from .physical_wire import MAX_STDOUT,MAX_COMPRESSED,MAX_MANIFEST,canonical
from .physical_codec import decode_chunk
from .m1_models import M1Manifest
from .m1_codec import M1StreamValidator
from .m1_wire import write_exclusive
from .m1_verifier import verify_profile,prepare_launch,artifact
from .shot_context_wire import _json


class M1Process(GrfProcess):
    def __init__(self,profile,root,run_id):
        d,h=verify_profile(profile.project)
        if profile.identity!=h:raise ValueError('Changed successor profile')
        self.profile=profile;self.root=Path(root).absolute();self.run_id=run_id;self.native_sha256=d['native_sha256']
        super().__init__(artifact(profile.project,d['python_path']),artifact(profile.project,d['native_dir']),timeout=600,stdout_limit=MAX_STDOUT)

    def _command(self):
        return [str(self.python_path),'-X','utf8','-B','-u',str(Path(__file__).with_name('m1_runner.py')),str(self.root),self.run_id]

    def _spawn(self):
        env=os.environ.copy()
        for key in ('PYTHONPATH','PYTHONHOME','GFOOTBALL_DATA_DIR','GFOOTBALL_FONT'):env.pop(key,None)
        return subprocess.Popen(self._command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            shell=False,env=env,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)

    def run(self,request,cancelled):
        raise ValueError('M1 returns capture references only; use fixed campaign authority')

    def capture(self,request,cancelled,budget):
        from .m1_resource_models import CapturedEvidence
        from .m1_verifier import sha
        budget.checkpoint('capture_preflight')
        launch=prepare_launch(self.profile.project,self.root,self.run_id,request.model_dump(mode='json'))
        if launch.profile_identity!=self.profile.identity:raise ValueError('Frozen parent identity changed')
        result=None
        try:
            result=self._run_transport(request,cancelled,launch,budget)
            snapshot=budget.checkpoint('admission',child_peak=self.peak_private_bytes)
            return CapturedEvidence(self.run_id,launch.evidence,tuple(sorted(launch.identity.items())),
                sha(launch.evidence/'manifest.json'),result.manifest.trace_hash,result.count-1,
                result.manifest.duration_ms,snapshot,id(budget))
        except BaseException as error:
            from .m1_resources import M1ResourceExceeded,record_resource_failure
            if isinstance(error,M1ResourceExceeded) and not (launch.evidence/'resource-failure.json').exists():
                record_resource_failure(launch.evidence/'resource-failure.json',error,identity=launch.identity,
                    trace_hash=result.manifest.trace_hash if result and result.manifest else None,
                    last_durable_block=result.count-1 if result and result.count else None,
                    last_durable_ms=result.manifest.duration_ms if result and result.manifest else None)
            raise
        finally:
            if result is not None:result.close()

    def _run_transport(self,request,cancelled,launch,budget=None):
        if budget:budget.checkpoint('capture')
        validator=M1StreamValidator(request,launch)
        with self._lock:
            if self._closed or cancelled.is_set():raise GrfCancelled()
            child=self._spawn();self._active.add(child)
        try:result=PhysicalResult()
        except BaseException:
            self._stop(child)
            with self._lock:self._active.discard(child)
            for pipe in (child.stdin,child.stdout,child.stderr):pipe.close()
            raise
        result.evidence=launch.evidence
        lines=queue.Queue(maxsize=2);stop=threading.Event();io_error=threading.Event()
        line_limit=max(MAX_MANIFEST+1024,4*((MAX_COMPRESSED+2)//3)+1024)
        stderr=bytearray();child_failure=None;last_retained=None
        def output():
            try:
                total=0
                while not stop.is_set():
                    line=child.stdout.readline(line_limit+1)
                    if not line:break
                    total+=len(line)
                    if total>MAX_STDOUT or len(line)>line_limit or not line.endswith(b'\n'):raise ValueError('M1 output budget')
                    while not stop.is_set():
                        try:lines.put(line,timeout=.05);break
                        except queue.Full:pass
            except (ValueError,OSError):io_error.set()
            finally:
                while not stop.is_set():
                    try:lines.put(None,timeout=.05);break
                    except queue.Full:pass
        def diagnostic():
            try:
                while not stop.is_set():
                    raw=child.stderr.read(4096)
                    if not raw:break
                    if len(stderr)+len(raw)>65536:io_error.set();break
                    stderr.extend(raw)
            except OSError:io_error.set()
        def input_worker():
            try:child.stdin.write(canonical(request.model_dump(mode='json')));child.stdin.close()
            except (OSError,ValueError):io_error.set()
        threads=[threading.Thread(target=f,daemon=True) for f in (output,diagnostic,input_worker)]
        started=time.monotonic();last_memory=0;self.peak_private_bytes=0
        for t in threads:t.start()
        def check():
            nonlocal last_memory
            if self._closed or cancelled.is_set():raise GrfCancelled()
            if budget:budget.checkpoint('capture',child_peak=self.peak_private_bytes)
            elif time.monotonic()-started>self.timeout:raise GrfTimeout()
            if io_error.is_set():raise GrfExecutionError('M1 output/I/O budget')
            if time.monotonic()-last_memory>=.1:
                try:observed=private_bytes(child)
                except OSError:
                    if budget:budget.checkpoint('capture',child_peak=None)
                    raise
                if budget and (type(observed) is not int or observed<0 or (observed==0 and child.poll() is None)):
                    budget.checkpoint('capture',child_peak=None)
                self.peak_private_bytes=max(self.peak_private_bytes,observed);last_memory=time.monotonic()
                if budget:budget.checkpoint('capture',child_peak=self.peak_private_bytes)
                elif self.peak_private_bytes>512*1024*1024:raise GrfExecutionError('M1 memory budget')
        try:
            while True:
                check()
                try:line=lines.get(timeout=.02)
                except queue.Empty:continue
                if line is None:break
                if result.manifest is not None or child_failure is not None:raise ValueError('Output after terminal envelope')
                message=_json(line)
                if type(message) is not dict:raise ValueError('M1 protocol object')
                if message.get('type')=='chunk' and set(message)=={'type','data'}:
                    raw=base64.b64decode(message['data'],validate=True);chunk=decode_chunk(raw);validator.append(chunk)
                    # Durable prefix precedes temporary-spool cleanup on every exit.
                    target=launch.evidence/f'{result.count}.zlib'
                    with target.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
                    result.count+=1;last_retained=int(chunk.samples[-1][1])
                    (result.path/f'{result.count-1}.zlib').write_bytes(raw)
                elif message.get('type')=='manifest' and set(message)=={'type','manifest'} and len(line)<=MAX_MANIFEST:
                    result.manifest=M1Manifest.model_validate(message['manifest'])
                elif message.get('type')=='failure' and len(line)<=8192:
                    child_failure=message
                else:raise ValueError('Invalid M1 envelope')
            while child.poll() is None:check();time.sleep(.01)
            for t in threads:t.join(timeout=2)
            check()
            if child.returncode or child_failure is not None or result.manifest is None or any(t.is_alive() for t in threads):
                raise GrfExecutionError('M1 child did not produce a validated complete result')
            validator.finish(result.manifest);check()
            write_exclusive(launch.evidence/'manifest.json',result.manifest.model_dump(mode='json'))
            self.seconds=time.monotonic()-started
            return result
        except BaseException as error:
            from .m1_resources import M1ResourceExceeded,record_resource_failure
            if isinstance(error,M1ResourceExceeded):
                record_resource_failure(launch.evidence/'resource-failure.json',error,identity=launch.identity,
                    trace_hash=result.manifest.trace_hash if result.manifest else None,
                    last_durable_block=result.count-1 if result.count else None,last_durable_ms=last_retained)
            # A killed process may have observed a tail that never reached stdout.
            try:
                write_exclusive(launch.evidence/'transport-failure.json',dict(schema_version='m1-transport-failure-1',identity=launch.identity,
                    error_type=type(error).__name__,validated_chunks=result.count,last_durable_ms=last_retained,
                    last_observed_ms=child_failure.get('last_observed_ms') if child_failure else None,
                    unflushed_tail='reported-prefix' if child_failure else 'unknown-after-termination',child_failure=child_failure))
            except Exception:pass
            finally:result.close()
            raise
        finally:
            stop.set();self._stop(child)
            for t in threads:t.join(timeout=2)
            for pipe in (child.stdin,child.stdout,child.stderr):
                try:pipe.close()
                except OSError:pass
            self.diagnostic_stderr=stderr
            with self._lock:self._active.discard(child)
