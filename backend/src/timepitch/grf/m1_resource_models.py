"""Private capture references; neither type is an admission capability."""
from dataclasses import dataclass
from pathlib import Path
from .m1_resources import ResourceSnapshot


@dataclass(frozen=True)
class CapturedEvidence:
    run_id:str
    path:Path
    identity:tuple[tuple[str,str],...]
    manifest_sha256:str
    trace_hash:str
    last_durable_block:int
    last_durable_ms:int
    resources:ResourceSnapshot
    budget_id:int


@dataclass(frozen=True)
class DerivedMeasurement:
    row:dict
    retained_files:dict[str,str]
    identity:dict
    trace_hash:str
    last_durable_block:int
    last_durable_ms:int
