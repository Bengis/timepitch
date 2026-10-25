"""Read bounded physical blocks incrementally from the isolated native worker."""
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
from .process import GrfProcess,GrfCancelled,GrfUnavailable,GrfExecutionError,GrfTimeout
from .physical_models import PHYSICAL_NATIVE_SHA256
from .physical_codec import decode_chunk,validate_manifest
from .physical_wire import MAX_STDOUT,MAX_MANIFEST,MAX_COMPRESSED,MAX_TOTAL_COMPRESSED,MAX_TOTAL_EXPANDED


class PhysicalResult:
    def __init__(self):
        self._temporary=tempfile.TemporaryDirectory(prefix='timepitch-physical-')
        self.path=Path(self._temporary.name);self.manifest=None;self.count=0
    def chunks(self):
        for index in range(self.count):yield decode_chunk((self.path/f'{index}.zlib').read_bytes())
    def close(self):self._temporary.cleanup()


class PhysicalProcess(GrfProcess):
    native_sha256=PHYSICAL_NATIVE_SHA256

    def __init__(self,python_path,native_dir,*,timeout=600):
        super().__init__(python_path,native_dir,timeout=timeout,stdout_limit=MAX_STDOUT)

    def _command(self):
        return [str(self.python_path),'-X','utf8','-u',str(Path(__file__).with_name('physical_runner.py')),str(self.native_dir)]

    def _stream_validator(self,request):
        from .action_models import ActionInput
        if isinstance(request,ActionInput):raise GrfExecutionError('Action input requires its pinned worker')
        return None

    def run(self,request,cancelled):
        with self._lock:
            if self._closed or cancelled.is_set():raise GrfCancelled()
            stream_validator=self._stream_validator(request)
            if not self.capability().available:raise GrfUnavailable()
            env=os.environ.copy()
            for key in ('PYTHONPATH','PYTHONHOME','GFOOTBALL_DATA_DIR','GFOOTBALL_FONT'):env.pop(key,None)
            try:child=subprocess.Popen(self._command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                shell=False,env=env,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            except OSError as error:raise GrfExecutionError() from error
            self._active.add(child)
        result=PhysicalResult();lines=queue.Queue(maxsize=2);stop=threading.Event();io_error=threading.Event()
        self.diagnostic_stderr=bytearray()
        line_limit=max(MAX_MANIFEST+1024,4*((MAX_COMPRESSED+2)//3)+1024)
        def stdout():
            try:
                total=0
                while not stop.is_set():
                    line=child.stdout.readline(line_limit+1)
                    if not line:break
                    total+=len(line)
                    if total>MAX_STDOUT or len(line)>line_limit or not line.endswith(b'\n'):raise ValueError('Output budget')
                    while not stop.is_set():
                        try:lines.put(line,timeout=.05);break
                        except queue.Full:pass
            except (OSError,ValueError):io_error.set()
            finally:
                while not stop.is_set():
                    try:lines.put(None,timeout=.05);break
                    except queue.Full:pass
        def stderr():
            try:
                count=0
                while raw:=child.stderr.read(4096):
                    count+=len(raw)
                    if count>65536:io_error.set();break
                    self.diagnostic_stderr.extend(raw)
            except OSError:io_error.set()
        def stdin():
            try:child.stdin.write(request.model_dump_json().encode());child.stdin.close()
            except (OSError,ValueError):io_error.set()
        threads=[threading.Thread(target=f,daemon=True) for f in (stdout,stderr,stdin)]
        for thread in threads:thread.start()
        start=time.monotonic();compressed=expanded=0;last_memory_check=0;self.peak_private_bytes=0
        def check():
            nonlocal last_memory_check
            if self._closed or cancelled.is_set():raise GrfCancelled()
            if io_error.is_set():raise GrfExecutionError()
            if time.monotonic()-start>self.timeout:raise GrfTimeout()
            if time.monotonic()-last_memory_check>=.1:
                from .physical_resources import private_bytes
                self.peak_private_bytes=max(self.peak_private_bytes,private_bytes(child));last_memory_check=time.monotonic()
                if self.peak_private_bytes>512*1024*1024:raise GrfExecutionError('Physical worker exceeds memory budget')
        try:
            while True:
                check()
                try:line=lines.get(timeout=.02)
                except queue.Empty:continue
                if line is None:break
                if result.manifest is not None:raise ValueError('Output after final manifest')
                message=json.loads(line)
                if message.get('type')=='chunk' and set(message)=={'type','data'}:
                    raw=base64.b64decode(message['data'],validate=True);chunk=decode_chunk(raw)
                    if chunk.index!=result.count:raise ValueError('Block out of order')
                    from .physical_codec import make_chunk_ref
                    ref=make_chunk_ref(chunk,raw);compressed+=len(raw);expanded+=ref.expanded_bytes
                    if compressed>MAX_TOTAL_COMPRESSED or expanded>MAX_TOTAL_EXPANDED:raise ValueError('Stream budget')
                    if stream_validator is not None:stream_validator.append(chunk)
                    (result.path/f'{result.count}.zlib').write_bytes(raw);result.count+=1
                elif message.get('type')=='manifest' and set(message)=={'type','manifest'} and len(line)<=MAX_MANIFEST:
                    from .physical_codec import parse_manifest
                    result.manifest=parse_manifest(message['manifest'])
                else:raise ValueError('Invalid physical protocol')
            while child.poll() is None:check();time.sleep(.01)
            check()
            for thread in threads:thread.join(timeout=2)
            if child.returncode or io_error.is_set() or any(t.is_alive() for t in threads) or result.manifest is None:
                raise GrfExecutionError()
            def checked_chunks():
                for chunk in result.chunks():check();yield chunk
            if stream_validator is not None:stream_validator.finish(result.manifest)
            else:validate_manifest(result.manifest,checked_chunks(),request)
            check()
            return result
        except (ValueError,KeyError,TypeError,RecursionError,OSError) as error:
            result.close();raise GrfExecutionError() from error
        except BaseException:
            result.close();raise
        finally:
            stop.set();self._stop(child)
            for thread in threads:thread.join(timeout=2)
            for pipe in (child.stdin,child.stdout,child.stderr):
                try:pipe.close()
                except OSError:pass
            with self._lock:self._active.discard(child)


class ActivityProcess(PhysicalProcess):
    from .physical_models import ACTIVITY_NATIVE_SHA256 as native_sha256
