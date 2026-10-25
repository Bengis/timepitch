"""Separate physical contract; legacy replay limits retain their meaning."""
from typing import Annotated,Literal
from pydantic import Field,model_validator
from .models import StrictModel,GrfInput,GrfReadback,Digest
from .telemetry_models import GrfNativeEvent
from .physical_wire import COLUMNS,MAX_SAMPLES,MAX_EVENTS

# Filled from the reproducible isolated build, never the active compressed runtime.
PHYSICAL_NATIVE_SHA256='d9e54e58de655b26635314fdb46a07813128e3f5356cfea7e99a4644ad269033'
ACTIVITY_NATIVE_SHA256='ea7b78bf118005fe97d3f7e71a3f5b2ea28ca766fceef03b0aee86eb17edb0ea'


class PhysicalSettings(StrictModel):
    clock_policy:Literal['physical-periods-1']='physical-periods-1'
    motion_policy:Literal['activity-1']='activity-1'
    # Phase 3 must calibrate activity before this mode can be promoted.
    activity_calibrated:Literal[False]=False
    physics_steps_per_frame:Literal[10]=10
    offsides:Literal[True]=True
    left_team_difficulty:Literal[.6]=.6
    right_team_difficulty:Literal[.6]=.6
    max_samples:Literal[75001]=75001
    max_events:Literal[100000]=100000
    max_period_ms:Literal[3720000]=3720000
    max_chunk_samples:Literal[1000]=1000
    max_compressed_bytes:Literal[33554432]=33554432
    max_expanded_bytes:Literal[268435456]=268435456
    timeout_seconds:Literal[600]=600


class PhysicalInput(GrfInput):
    settings:PhysicalSettings=Field(default_factory=PhysicalSettings)


class ActivitySettings(PhysicalSettings):
    motion_policy:Literal['off-ball-activity-1']='off-ball-activity-1'
    rest_radius_m:float=Field(default=2.,ge=0,le=4,allow_inf_nan=False)
    walk_speed_m_s:float=Field(default=2.2,ge=.5,le=3,allow_inf_nan=False)
    far_ball_m:float=Field(default=15.,ge=10,le=30,allow_inf_nan=False)
    entry_delay_ms:int=Field(default=1000,ge=0,le=3000,strict=True)


class ActivityInput(PhysicalInput):
    settings:ActivitySettings=Field(default_factory=ActivitySettings)


class PhysicalEvent(GrfNativeEvent):
    seq:int=Field(ge=0,lt=MAX_EVENTS,strict=True)
    sample_index:int=Field(ge=1,lt=MAX_SAMPLES,strict=True)
    incident_id:int=Field(ge=0,le=MAX_EVENTS,strict=True)
    actual_time_ms:int=Field(ge=0,le=7440000,strict=True)
    match_time_ms:int=Field(ge=0,le=7440000,strict=True)


class PhysicalChunk(StrictModel):
    schema_version:Literal['grf-physical-chunk-1']='grf-physical-chunk-1'
    index:int=Field(ge=0,le=75,strict=True)
    columns:tuple[str,...]=COLUMNS
    samples:list[list[float]]=Field(min_length=1,max_length=1000)
    events:list[PhysicalEvent]=Field(default_factory=list,max_length=MAX_EVENTS)

    @model_validator(mode='after')
    def rows(self):
        from .physical_codec import validate_rows
        if self.columns!=COLUMNS:raise ValueError('Unknown physical columns')
        validate_rows(self.samples)
        return self


class ChunkRef(StrictModel):
    index:int=Field(ge=0,le=75,strict=True)
    samples:int=Field(ge=1,le=1000,strict=True)
    events:int=Field(ge=0,le=MAX_EVENTS,strict=True)
    physics_start:int=Field(ge=0,le=7440000,strict=True)
    physics_end:int=Field(ge=0,le=7440000,strict=True)
    compressed_bytes:int=Field(ge=1,le=1048576,strict=True)
    expanded_bytes:int=Field(ge=1,le=4194304,strict=True)
    sha256:Digest


class ActivityChunk(PhysicalChunk):
    schema_version:Literal['grf-activity-chunk-1']='grf-activity-chunk-1'
    activity:list[Annotated[list[Annotated[int,Field(ge=0,le=3,strict=True)]],Field(min_length=22,max_length=22)]]=Field(min_length=1,max_length=1000)

    @model_validator(mode='after')
    def aligned_activity(self):
        if len(self.activity)!=len(self.samples):raise ValueError('Activity/sample length mismatch')
        return self


class PhysicalPeriod(StrictModel):
    period:Literal[1,2]
    duration_ms:int=Field(ge=2700000,le=3720000,strict=True)
    allowance_ms:int=Field(ge=0,le=900000,strict=True)
    # Initial minute rounding is retained when further eligible loss is added.
    announced_minimum_ms:int=Field(ge=0,lt=960000,strict=True)
    effective_ms:int=Field(ge=0,le=3720000,strict=True)


class PhysicalRestart(StrictModel):
    id:int=Field(gt=0,strict=True)
    cause:str
    start:int=Field(ge=0,strict=True)
    end:int=Field(ge=0,strict=True)
    eligible_loss_ms:int=Field(ge=0,strict=True)
    period:Literal[1,2]


class PhysicalManifest(StrictModel):
    schema_version:Literal['grf-physical-1']='grf-physical-1'
    engine_version:Literal['grf-2.10.2-physical-periods-1']='grf-2.10.2-physical-periods-1'
    coordinate_units:Literal['native_metres']='native_metres'
    input:PhysicalInput
    native_binary_sha256:Digest
    attribute_readbacks:list[GrfReadback]=Field(min_length=66,max_length=66)
    duration_ms:int=Field(ge=5400000,le=7440000,strict=True)
    score:tuple[int,int]
    periods:list[PhysicalPeriod]=Field(min_length=2,max_length=2)
    ledger:list[PhysicalRestart]
    chunks:list[ChunkRef]=Field(min_length=1,max_length=76)
    completion_reason:Literal['full_time']='full_time'
    trace_hash:str=''


class ActivityManifest(PhysicalManifest):
    schema_version:Literal['grf-activity-1']='grf-activity-1'
    engine_version:Literal['grf-2.10.2-activity-1']='grf-2.10.2-activity-1'
    input:ActivityInput


class PhysicalEffort(StrictModel):
    distance_m:float|None
    observed_ms:int=Field(ge=0)
    active_ms:int=Field(ge=0)
    coverage:float|None=Field(ge=0,le=1)
    distance_kind:Literal['observed_complete','observed_partial','unavailable']
    stationary_ms:int=Field(ge=0)
    walking_ms:int=Field(ge=0)
    running_ms:int=Field(ge=0)
    high_speed_ms:int=Field(ge=0)
    maximum_speed_m_s:float|None
    maximum_speed_exposure_ms:Literal[300]=300
    reasons:list[str]


class PhysicalPeriodEffort(PhysicalEffort):
    period:Literal[1,2]


class PhysicalPlayerEffort(PhysicalEffort):
    id:str
    side:Literal['home','away']
    slot:int=Field(ge=0,le=10)
    name:str
    role:str
    periods:list[PhysicalPeriodEffort]


class PhysicalActionCount(StrictModel):
    side:Literal['home','away']
    period:Literal[1,2]
    pass_contacts:int=0
    shot_contacts:int=0
    other_contacts:int=0


class PhysicalPassEvidence(StrictModel):
    event_seq:int
    released_physics_ms:int
    received_physics_ms:int


class PhysicalPassEdge(StrictModel):
    side:Literal['home','away']
    period:Literal[1,2]
    source_id:str
    target_id:str
    count:int
    evidence:list[PhysicalPassEvidence]


class PhysicalStatisticsSummary(StrictModel):
    schema_version:Literal['grf-physical-statistics-1']='grf-physical-statistics-1'
    statistics_version:Literal['grf-physical-statistics-1']='grf-physical-statistics-1'
    trace_hash:Digest
    input_hash:Digest
    experimental:Literal[True]=True
    coordinate_units:Literal['native_metres']='native_metres'
    clock_policy:Literal['physical-periods-1']='physical-periods-1'
    score:tuple[int,int]
    duration_ms:int
    effective_ms:int
    periods:list[PhysicalPeriod]
    ledger:list[PhysicalRestart]
    players:list[PhysicalPlayerEffort]
    actions:list[PhysicalActionCount]
    pass_edges:list[PhysicalPassEdge]
    pass_receipt_policy:Literal['direct-control-within-10s-1']='direct-control-within-10s-1'
    # Engineering bands, not a provider's model or a validated sprint metric.
    speed_thresholds_m_s:tuple[float,float,float]=(.5,2.,5.5)
