"""Versioned passive action evidence; older physical contracts stay unchanged."""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from .models import StrictModel, GrfInput
from .physical_models import ActivitySettings, ActivityChunk, PhysicalManifest, ChunkRef
from .physical_wire import MAX_EVENTS, MAX_PHYSICS_MS, MAX_SAMPLES

LEGACY_ACTION_NATIVE_SHA256='d05389be819e4603ff765e8b01058a5542bee85971e1243a219aac7f2d71e22f'
ACTION_NATIVE_SHA256='58c6c3ff43ae37ecad3519cc77d3ebcbc7039bc8ff02e0c3ba56b7463e4d6633'
SUPPORTED_ACTION_NATIVE_SHA256S=frozenset((LEGACY_ACTION_NATIVE_SHA256,ACTION_NATIVE_SHA256))
Counter=Annotated[int,Field(ge=0,le=MAX_EVENTS,strict=True)]
Actor=Annotated[int,Field(ge=0,le=1,strict=True)]
Slot=Annotated[int,Field(ge=0,le=10,strict=True)]
Animation=Annotated[int,Field(ge=0,le=1000000,strict=True)]


class ActionSettings(ActivitySettings):
    telemetry_policy:Literal['action-contact-1']='action-contact-1'


class ActionInput(GrfInput):
    settings:ActionSettings=Field(default_factory=ActionSettings)


class ActionSemanticEvent(StrictModel):
    seq:int=Field(ge=0,lt=MAX_EVENTS,strict=True)
    physics_ms:int=Field(ge=0,le=MAX_PHYSICS_MS,strict=True)
    phase:Literal[1,2]
    sample_index:int=Field(ge=0,lt=MAX_SAMPLES,strict=True)
    actor_team:Actor
    slot:Slot
    animation_id:Animation|None
    kind:Literal['retention_start','retention_end','release','control','deflection','accidental','unknown_contact']
    intent:Literal['pass','shot','clearance','control','unknown']
    origin:Literal['unknown','open_play_pass','open_play_shot','emergency_clearance','set_piece_pass','set_piece_shot','retainer_distribution']
    raw_event_seq:Annotated[int,Field(ge=0,lt=MAX_EVENTS,strict=True)]|None
    release_key:tuple[Actor,Slot,Animation,Annotated[int,Field(ge=0,strict=True)]]|None
    restart_id:Counter
    restart_kind:Literal['none','normal','kickoff','goal','corner','goal_kick','throw_in','free_kick','penalty']
    retention_end_reason:Literal['released','lost','reset']|None


class ActionChunk(ActivityChunk):
    schema_version:Literal['grf-actions-chunk-1']='grf-actions-chunk-1'
    semantic_events:list[ActionSemanticEvent]=Field(default_factory=list,max_length=MAX_EVENTS)
    contact_roles:list[Annotated[int,Field(ge=0,le=6,strict=True)]]=Field(max_length=MAX_EVENTS)

    @model_validator(mode='after')
    def aligned_roles(self):
        if len(self.contact_roles)!=len(self.events):raise ValueError('Contact role/event length mismatch')
        if len(self.events)+len(self.semantic_events)>MAX_EVENTS:raise ValueError('Combined event budget')
        return self


class ActionChunkRef(ChunkRef):
    semantic_events:Counter


class ActionManifest(PhysicalManifest):
    schema_version:Literal['grf-actions-1']='grf-actions-1'
    engine_version:Literal['grf-2.10.2-actions-1']='grf-2.10.2-actions-1'
    input:ActionInput
    chunks:list[ActionChunkRef]=Field(min_length=1,max_length=76)
    raw_event_count:Counter
    semantic_event_count:Counter
    overflowed:Literal[False]=False

    @model_validator(mode='after')
    def combined_budget(self):
        if self.raw_event_count+self.semantic_event_count>MAX_EVENTS:raise ValueError('Combined event budget')
        return self
