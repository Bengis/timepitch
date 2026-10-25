"""Explicitly experimental statistics from validated native action evidence."""
from typing import Annotated,Literal
from pydantic import Field
from .models import StrictModel
from .physical_models import PhysicalStatisticsSummary
from .action_models import Actor,Slot,Animation

Availability=Literal['observed_complete','observed_partial','unavailable']
Count=Annotated[int,Field(ge=0,strict=True)]
Time=Annotated[int,Field(ge=0,le=7440000,strict=True)]
Ratio=Annotated[float,Field(ge=0,le=1)]


class TeamActionCounts(StrictModel):
    side:Literal['home','away']
    period:Literal[1,2]
    passes:Count=0
    shots:Count=0
    clearances:Count=0
    unknown_releases:Count=0
    availability:Availability='observed_complete'


class PlayerActionCounts(TeamActionCounts):
    player_id:str


class ActionRelease(StrictModel):
    semantic_seq:Count
    raw_event_seq:Count
    release_key:tuple[Actor,Slot,Animation,Count]
    player_id:str
    side:Literal['home','away']
    period:Literal[1,2]
    physics_ms:Time
    intent:Literal['pass','shot','clearance','unknown']
    origin:Literal['unknown','open_play_pass','open_play_shot','emergency_clearance','set_piece_pass','set_piece_shot','retainer_distribution']


class ActionPassEvidence(StrictModel):
    release_semantic_seq:Count
    release_raw_event_seq:Count
    arrival_semantic_seq:Count|None
    arrival_raw_event_seq:Count|None
    released_physics_ms:Time
    arrival_physics_ms:Time|None
    received_physics_ms:Time|None
    resolved_physics_ms:Time


class ActionPass(ActionRelease):
    released_physics_ms:Time
    receiver_id:str|None
    outcome:Literal['received','intercepted','interrupted','same_actor','unresolved']
    received_physics_ms:Time|None
    resolved_physics_ms:Time
    evidence:list[ActionPassEvidence]


class ActionPassEdge(StrictModel):
    side:Literal['home','away']
    period:Literal[1,2]
    source_id:str
    target_id:str
    count:Count
    evidence:list[ActionPassEvidence]


class RetentionEpisode(StrictModel):
    player_id:str
    side:Literal['home','away']
    period:Literal[1,2]
    start_physics_ms:Time
    end_physics_ms:Time|None=None
    observed_ms:Count=0
    closed_by:Literal['released','lost','reset']|None=None
    availability:Availability='observed_partial'
    start_semantic_seq:Count
    end_semantic_seq:Count|None=None


class ActionClassificationCoverage(StrictModel):
    contacts:Count
    unknown_contacts:Count
    releases:Count
    classified_releases:Count
    unknown_releases:Count
    contact_ratio:Ratio|None
    release_ratio:Ratio|None
    availability:Availability
    reasons:list[str]


class ActionStatisticsSummary(PhysicalStatisticsSummary):
    schema_version:Literal['grf-physical-statistics-2']='grf-physical-statistics-2'
    statistics_version:Literal['grf-physical-statistics-2']='grf-physical-statistics-2'
    team_actions:list[TeamActionCounts]
    player_actions:list[PlayerActionCounts]
    releases:list[ActionRelease]
    passes:list[ActionPass]
    retentions:list[RetentionEpisode]
    classification:ActionClassificationCoverage
    pass_edges:list[ActionPassEdge]
    pass_receipt_policy:Literal['semantic-release-control-within-10s-1']='semantic-release-control-within-10s-1'
