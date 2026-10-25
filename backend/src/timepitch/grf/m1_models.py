"""Research envelope; intentionally absent from public replay parsing."""
from typing import Literal
from pydantic import Field,model_validator
from .action_models import ActionManifest
from .shot_context_wire import _identity


class M1Manifest(ActionManifest):
    schema_version:Literal['m1-actions-1']='m1-actions-1'
    engine_version:Literal['grf-2.10.2-m1-bounded-1']='grf-2.10.2-m1-bounded-1'
    clock_policy:Literal['m1-bounded-whistle-1']='m1-bounded-whistle-1'
    worker_identity:dict
    close_receipts:list[dict]=Field(min_length=2,max_length=2)

    @model_validator(mode='after')
    def identity(self):
        _identity(self.worker_identity)
        if (self.worker_identity['input_hash']!=self.input.input_hash or
            self.worker_identity['native_sha256']!=self.native_binary_sha256):raise ValueError('M1 manifest identity')
        return self
