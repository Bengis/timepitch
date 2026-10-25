"""Pinned action worker using the existing bounded transport and spool lifecycle."""
from pathlib import Path
from .action_models import ActionInput, ACTION_NATIVE_SHA256
from .action_codec import ActionStreamValidator
from .physical_process import PhysicalProcess
from .process import GrfExecutionError


class ActionProcess(PhysicalProcess):
    native_sha256=ACTION_NATIVE_SHA256

    def _command(self):
        return [str(self.python_path),'-X','utf8','-u',str(Path(__file__).with_name('action_runner.py')),str(self.native_dir)]

    def _stream_validator(self,request):
        if not isinstance(request,ActionInput):raise GrfExecutionError('Action worker requires action input')
        try:return ActionStreamValidator(request,self.native_sha256)
        except ValueError as error:raise GrfExecutionError('Invalid action input') from error
