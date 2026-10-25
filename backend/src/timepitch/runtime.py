"""OS-backed leases: a second server must not recover another server's live work."""
import os
from pathlib import Path


class RuntimeLease:
    def __init__(self, path: Path, *, canary_recovery=None):
        self.path,self.stream,self.canary_recovery,self._lock_held=path,None,canary_recovery,False

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.path.open('a+b')
        try:
            if stream.seek(0, os.SEEK_END) == 0: stream.write(b'0'); stream.flush()
            stream.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stream=stream;self._lock_held=True
            if self.canary_recovery is not None and self.path.name!='inference.lock':
                from .chronicles.worker_state import RecoveryRequired
                raise RecoveryRequired('Recovery is restricted to the common inference lease')
            if self.path.name=='inference.lock':
                # Check after acquiring the OS lock so a crash between precheck
                # and acquisition cannot admit API/probe work over a lost request.
                from .chronicles.worker_state import assert_inference_recovered
                assert_inference_recovered(self.path,canary_recovery=self.canary_recovery,_lease=self)
        except OSError as error:
            self.stream=None;self._lock_held=False
            stream.close()
            raise RuntimeError('TimePitch runtime or local AI is already in use by another instance') from error
        except BaseException:
            self.stream=None;self._lock_held=False
            stream.close()
            raise
        self.stream = stream
        return self

    def __exit__(self, *_):
        if self.stream is not None:
            try:
                self.stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
            finally: self.stream.close(); self.stream = None;self._lock_held=False
