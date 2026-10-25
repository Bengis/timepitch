"""Versioned post-match response; unavailable values are never implicit zeros."""
from typing import Literal
from pydantic import Field
from .models import StrictModel,GrfPlayer


class GrfMetricDefinition(StrictModel):
    unit:Literal['count','percent','m']
    description:str


class GrfMetric(StrictModel):
    value:float|None
    availability:Literal['measured','derived','unavailable']
    definition_id:str
    numerator:float|None=None
    denominator:float|None=None
    covered_ms:int=Field(default=0,ge=0)
    reason:str|None=None
    event_refs:list[int]=Field(default_factory=list)
    sample_ranges:list[tuple[int,int]]=Field(default_factory=list)


class GrfGoal(StrictModel):
    seq:int
    side:Literal['home','away']
    actor_id:str|None
    own_goal:bool
    assist_id:str|None=None
    shot_seq:int|None=None
    match_time_ms:int
    playback_ms:int
    phase:Literal[1,2]


class GrfShot(StrictModel):
    seq:int
    side:Literal['home','away']
    actor_id:str
    x:float
    y:float
    match_time_ms:int
    playback_ms:int
    phase:Literal[1,2]
    set_piece:bool
    outcome:Literal['goal','unresolved']='unresolved'


class GrfPass(StrictModel):
    seq:int
    side:Literal['home','away']
    actor_id:str
    receiver_id:str|None=None
    kind:str
    outcome:Literal['received','intercepted','interrupted','same_actor','unresolved']='unresolved'
    match_time_ms:int
    playback_ms:int
    phase:Literal[1,2]
    x:float
    y:float
    end_x:float|None=None
    end_y:float|None=None
    event_refs:list[int]=Field(default_factory=list)


class GrfPassEdge(StrictModel):
    side:Literal['home','away']
    phase:Literal[1,2]
    source_id:str
    target_id:str
    count:int


class GrfPositionMean(StrictModel):
    side:Literal['home','away']
    player_id:str
    phase:Literal[1,2]
    x:float
    y:float
    covered_ms:int


class GrfOccupancy(StrictModel):
    side:Literal['home','away']
    player_id:str
    phase:Literal[1,2]
    col:int=Field(ge=0,lt=12)
    row:int=Field(ge=0,lt=8)
    duration_ms:int=Field(ge=0)


class GrfTeamShape(StrictModel):
    side:Literal['home','away']
    phase:Literal[1,2]
    length_m:float
    width_m:float
    covered_ms:int


class GrfCoverage(StrictModel):
    events_complete:bool
    native_clock_available:bool
    activity_verified:bool
    eligible_ms:int=0
    excluded_ms:int=0
    outside_player_ms:int=0
    free_ball_pct:float|None=None
    warnings:list[str]=Field(default_factory=list)


class GrfEventStatistics(StrictModel):
    by_team:dict[str,dict[str,GrfMetric]]
    by_player:dict[str,dict[str,GrfMetric]]
    goals:list[GrfGoal]
    shots:list[GrfShot]
    passes:list[GrfPass]
    pass_edges:list[GrfPassEdge]


class GrfShapeStatistics(StrictModel):
    by_team:dict[str,dict[str,GrfMetric]]
    positions:list[GrfPositionMean]
    occupancy:list[GrfOccupancy]
    team_shape:list[GrfTeamShape]
    coverage:GrfCoverage


class GrfStatisticsSummary(StrictModel):
    statistics_version:Literal['grf-statistics-1']='grf-statistics-1'
    trace_hash:str
    replay_version:str
    home_name:str
    away_name:str
    score:tuple[int,int]
    full_time_ms:int|None
    halftime_ms:int|None
    players:list[GrfPlayer]
    definitions:dict[str,GrfMetricDefinition]
    by_team:dict[str,dict[str,GrfMetric]]
    by_player:dict[str,dict[str,GrfMetric]]
    goals:list[GrfGoal]
    shots:list[GrfShot]
    passes:list[GrfPass]
    pass_edges:list[GrfPassEdge]
    positions:list[GrfPositionMean]
    occupancy:list[GrfOccupancy]
    team_shape:list[GrfTeamShape]
    coverage:GrfCoverage
