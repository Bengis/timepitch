from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from ..catalog.models import Role

Confidence = Literal['low', 'medium']
RATINGS_VERSION = 'ratings-1'
ENGINE_VERSION = 'engine-1'
RULES_VERSION = 'rules-1'


class RolePrior(BaseModel):
    role: Role
    attribute_values: dict[str, float]
    prior_minutes: int = Field(default=450, gt=0)
    rates_per90: dict[str, float] = Field(default_factory=dict)


class LeagueBaseline(BaseModel):
    season_start: int
    goals_per_team_game: float
    neutral_goals_per_team_game: float
    role_priors: dict[str, RolePrior] = Field(default_factory=dict)


class PlayerProfile(BaseModel):
    player_key: str
    role: Role
    attributes: dict[str, float]
    provenance: dict[str, str]
    confidence: Confidence


class TeamProfile(BaseModel):
    team_key: str
    attack_rate: float
    concession_rate: float
    players: list[PlayerProfile]
    confidence: Confidence
    quality_flags: list[str]
    ratings_version: str = RATINGS_VERSION


class TraceViolation(BaseModel):
    event_id: str
    code: str


Side = Literal['home', 'away']
Tactic = Literal['balanced', 'press', 'counter']
EventType = Literal['kickoff', 'pass', 'carry', 'pressure', 'tackle', 'recovery', 'shot', 'save', 'goal', 'restart', 'halftime', 'fulltime']


class MatchConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    home_key: str = Field(max_length=80)
    away_key: str = Field(max_length=80)
    home_players: list[str] = Field(min_length=11, max_length=11)
    away_players: list[str] = Field(min_length=11, max_length=11)
    home_formation: Literal['4-4-2', '4-3-3', '3-5-2', '4-5-1'] = '4-4-2'
    away_formation: Literal['4-4-2', '4-3-3', '3-5-2', '4-5-1'] = '4-4-2'
    home_tactic: Tactic = 'balanced'
    away_tactic: Tactic = 'balanced'
    seed: int = Field(default=42, ge=0, le=4294967295, strict=True)


class Point(BaseModel):
    x: float = Field(ge=0, le=105, allow_inf_nan=False)
    y: float = Field(ge=0, le=68, allow_inf_nan=False)


class PlayerFrame(Point):
    key: str = Field(max_length=160)
    name: str = Field(max_length=120)
    role: Role
    side: Side


class Score(BaseModel):
    home: int = Field(default=0, ge=0)
    away: int = Field(default=0, ge=0)


class RenderFrame(BaseModel):
    players: list[PlayerFrame] = Field(min_length=22, max_length=22)
    ball: Point
    carrier: str | None
    possession: Side
    clock_ms: int = Field(ge=0, le=5400000)
    period: Literal[1, 2]
    score: Score


class MatchEvent(BaseModel):
    id: str
    t0_ms: int = Field(ge=0, le=5400000)
    t1_ms: int = Field(ge=0, le=5400000)
    type: EventType
    side: Side | None
    participants: list[str]
    outcome: str
    evidence: dict[str, str | int | float | bool]
    frame_after: RenderFrame


class SideMetrics(BaseModel):
    goals: int = 0
    shots: int = 0
    shots_on_target: int = 0
    saves: int = 0
    passes: int = 0
    completed_passes: int = 0
    pressures: int = 0
    tackles: int = 0
    possession_ms: int = 0


class MatchMetrics(BaseModel):
    home: SideMetrics = Field(default_factory=SideMetrics)
    away: SideMetrics = Field(default_factory=SideMetrics)


class MatchRecord(BaseModel):
    config: MatchConfig
    seed: int
    dataset_version: str
    engine_version: str = ENGINE_VERSION
    rules_version: str = RULES_VERSION
    ratings_version: str = RATINGS_VERSION
    home_name: str
    away_name: str
    initial_frame: RenderFrame
    events: list[MatchEvent] = Field(max_length=4000)
    metrics: MatchMetrics
    trace_hash: str = ''
