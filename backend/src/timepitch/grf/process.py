"""Bounded native subprocess; never load Python 3.10 GRF into the API process."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from .models import EngineCapability, GrfReplay, GrfMatchInput, GrfFullMatchReplay,GrfStatisticsInput,GrfStatisticsReplay, STATS_NATIVE_SHA256 as NATIVE_SHA256
from .codec import MAX_BYTES, grf_hash, parse_grf, encode_grf
from . import runtime_layout
from .performance import StageTimings, PROFILE_ENV, read_worker_profile, write_private_profile


class GrfExecutionError(RuntimeError): code='native_failed'
class GrfUnavailable(GrfExecutionError): code='native_unavailable'
class GrfTimeout(GrfExecutionError): code='native_timeout'
class GrfCancelled(GrfExecutionError): code='interrupted'


class GrfProcess:
    def __init__(self,python_path: Path,native_dir: Path,*,timeout=120,stdout_limit=MAX_BYTES,stderr_limit=65536):
        self.python_path=python_path.resolve();self.native_dir=native_dir.resolve()
        self.timeout=timeout;self.stdout_limit=stdout_limit;self.stderr_limit=stderr_limit
        self._lock=threading.Lock();self._active=set();self._closed=False

    def capability(self):
        reason=None
        try:
            if not self.python_path.is_file():reason='missing_runtime'
            else:
                binary=runtime_layout.native_binary(self.native_dir)
                expected=getattr(self,'native_sha256',NATIVE_SHA256 if runtime_layout.PLATFORM=='win32' else runtime_layout.LINUX_STATS_SHA256)
                if not binary.is_file():reason='missing_assets'
                elif hashlib.sha256(binary.read_bytes()).hexdigest()!=expected:reason='unsupported_native_binary'
                else:
                    packages=runtime_layout.package_directory(self.python_path)
                    assets=packages/'gfootball_engine'
                    # Exact data-file inventory from the pinned GRF wheel. A directory
                    # alone does not prove that a partial installation can run.
                    manifest=json.loads(Path(__file__).with_name('assets.json').read_text(encoding='utf-8'))
                    required=[packages/'gfootball/env/football_env_core.py',
                              assets/'fonts/AlegreyaSansSC-ExtraBold.ttf']
                    required.extend(assets/'data'/name for name in manifest)
                    required.extend(runtime_layout.required_libraries(self.native_dir))
                    if not all(path.is_file() and path.stat().st_size>0 for path in required):reason='missing_assets'
        except OSError:reason='missing_assets'
        return EngineCapability(id='grf',available=reason is None,reason=reason)

    def _command(self):
        return [str(self.python_path),'-X','utf8','-u',str(Path(__file__).with_name('native_runner.py')),str(self.native_dir)]

    @staticmethod
    def _stop(child):
        if child.poll() is None:
            try:child.terminate()
            except OSError:pass
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:child.kill()
            except OSError:pass
            child.wait(timeout=5)

    def close(self):
        with self._lock:
            self._closed=True;children=list(self._active)
        for child in children:self._stop(child)

    def run(self,request,cancelled: threading.Event,*,profile_path: Path | None = None):
        # Trusted per-invocation opt-in only: no API/client or inherited env switch.
        profile=StageTimings(profile_path is not None)
        stderr=bytearray();status='native_failed';trace_hash=None
        try:
            record=self._run(request,cancelled,profile,stderr)
            status='passed';trace_hash=record.trace_hash
            return record
        except GrfExecutionError as error:
            status=error.code
            raise
        finally:
            if profile.enabled:
                worker_status,worker=read_worker_profile(stderr,request.input_hash)
                write_private_profile(profile_path,dict(schema='grf-process-profile-1',
                    input_hash=request.input_hash,trace_hash=trace_hash,status=status,
                    parent=profile.report(),worker_status=worker_status,worker=worker))

    def _run(self,request,cancelled,profile,stderr):
        with self._lock:
            if self._closed or cancelled.is_set():raise GrfCancelled()
        if not profile.call('capability',self.capability).available:raise GrfUnavailable()
        raw=profile.call('request_encode',lambda:request.model_dump_json().encode('utf-8'))
        env=os.environ.copy()
        env.pop(PROFILE_ENV,None)
        if profile.enabled:env[PROFILE_ENV]='1'
        for key in ('PYTHONPATH','PYTHONHOME','GFOOTBALL_DATA_DIR','GFOOTBALL_FONT'):env.pop(key,None)
        if runtime_layout.PLATFORM=='linux':
            # Linked conda libraries belong only to this child, never the API.
            env['LD_LIBRARY_PATH']=str(self.python_path.parent.parent/'lib')
            env['PYTHONNOUSERSITE']='1'
            env['OPENBLAS_NUM_THREADS']=env['OMP_NUM_THREADS']='1'
            env.pop('DISPLAY',None)
        with self._lock:
            if self._closed or cancelled.is_set():raise GrfCancelled()
            start=profile.start()
            try:
                child=subprocess.Popen(self._command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                    shell=False,env=env,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            except OSError as error:raise GrfExecutionError() from error
            finally:profile.stop('spawn',start)
            self._active.add(child)
        stdout=bytearray();overflow=threading.Event();io_error=threading.Event()
        def read_pipe(pipe,limit,target):
            count=0
            try:
                while chunk:=pipe.read(8192):
                    count+=len(chunk)
                    if count>limit:overflow.set();return
                    if target is not None:target.extend(chunk)
            except OSError:io_error.set()
        def write_input():
            try:child.stdin.write(raw);child.stdin.close()
            except (OSError,ValueError):pass
        threads=[threading.Thread(target=read_pipe,args=(child.stdout,self.stdout_limit,stdout),daemon=True),
                 threading.Thread(target=read_pipe,args=(child.stderr,self.stderr_limit,stderr if profile.enabled else None),daemon=True),
                 threading.Thread(target=write_input,daemon=True)]
        for thread in threads:thread.start()
        start=time.monotonic()
        wait_start=profile.start()
        wait_stopped=False
        try:
            while child.poll() is None:
                if self._closed or cancelled.is_set():raise GrfCancelled()
                if overflow.is_set() or io_error.is_set():raise GrfExecutionError()
                if time.monotonic()-start>self.timeout:raise GrfTimeout()
                time.sleep(.01)
            if self._closed or cancelled.is_set():raise GrfCancelled()
            for thread in threads:thread.join(timeout=2)
            if child.returncode or overflow.is_set() or io_error.is_set() or any(t.is_alive() for t in threads):
                raise GrfExecutionError()
            profile.stop('child_wait',wait_start);wait_stopped=True
            try:
                result=profile.call('decode',json.loads,stdout)
                if result.pop('input_hash')!=request.input_hash:raise ValueError('Input mismatch')
                model=GrfStatisticsReplay if isinstance(request,GrfStatisticsInput) else GrfFullMatchReplay if isinstance(request,GrfMatchInput) else GrfReplay
                record=profile.call('construct',model,input=request,**result)
                record.trace_hash=profile.call('hash',grf_hash,record)
                raw_record=profile.call('encode',encode_grf,record)
                return profile.call('strict_parse',parse_grf,raw_record,request)
            except (ValueError,KeyError,TypeError,RecursionError) as error:raise GrfExecutionError() from error
        finally:
            if not wait_stopped:profile.stop('child_wait',wait_start)
            cleanup_start=profile.start()
            self._stop(child)
            for thread in threads:thread.join(timeout=2)
            for pipe in (child.stdin,child.stdout,child.stderr):
                try:pipe.close()
                except OSError:pass
            with self._lock:self._active.discard(child)
            profile.stop('cleanup',cleanup_start)
