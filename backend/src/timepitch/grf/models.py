"""Strict, explicitly experimental GRF protocol."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field
from ..simulation.models import MatchConfig, Side
from ..catalog.models import Role

NATIVE_SHA256 = 'dea0ace2ee26f4c8696191e09202f965ac10555d52de9d0d65ba8bc37b386b5e'
MATCH_NATIVE_SHA256 = '060e27cea299414d14a77f32e3eae8920bf5fd94c8d510b23f375c1b78c2862f'
STATS_NATIVE_SHA256 = '49bc1410d040de4797cd6fba322964d0e679561149826008487fc68f9e4f8b18'
Attribute = Literal['physical_velocity', 'technical_shot', 'technical_shortpass']
Unit = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
X = Annotated[float, Field(ge=-1.5, le=1.5, allow_inf_nan=False)]
Y = Annotated[float, Field(ge=-.8, le=.8, allow_inf_nan=False)]
Z = Annotated[float, Field(ge=-1, le=25, allow_inf_nan=False)]
XY = tuple[X, Y]
Eleven = Annotated[list[XY], Field(min_length=11, max_length=11)]
Slot = Annotated[int, Field(ge=0, le=10, strict=True)]
Digest = Annotated[str, Field(pattern=r'^[a-f0-9]{64}$')]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class GrfSettings(StrictModel):
    game_duration: Literal[3000] = 3000
    physics_steps_per_frame: Literal[10] = 10
    offsides: Literal[True] = True
    left_team_difficulty: Literal[.6] = .6
    right_team_difficulty: Literal[.6] = .6
    reverse_team_processing: Literal[False] = False
    actions: tuple[Literal[19], Literal[19]] = (19, 19)


class GrfPlayer(StrictModel):
    id: str = Field(max_length=180)
    side: Side
    slot: Slot
    source_key: str = Field(max_length=160)
    name: str = Field(max_length=120)
    role: Role
    native_role: Literal['GK', 'CB', 'CM', 'CF']
    attributes: dict[Attribute, Unit]
    provenance: dict[Attribute, str]


class GrfInput(StrictModel):
    config: MatchConfig
    dataset_version: str = Field(max_length=100)
    ratings_version: Literal['ratings-1'] = 'ratings-1'
    home_name: str = Field(max_length=120)
    away_name: str = Field(max_length=120)
    players: list[GrfPlayer] = Field(min_length=22, max_length=22)
    settings: GrfSettings = Field(default_factory=GrfSettings)
    input_hash: str = ''


class GrfSample(StrictModel):
    index: int = Field(ge=0, le=3101, strict=True)
    engine_step: int = Field(ge=-1, le=3000, strict=True)
    score: tuple[Annotated[int, Field(ge=0, le=100, strict=True)], Annotated[int, Field(ge=0, le=100, strict=True)]]
    owner_team: Literal[-1, 0, 1]
    owner_slot: int = Field(ge=-1, le=10, strict=True)
    game_mode: int = Field(ge=0, le=6, strict=True)
    home_xy: Eleven
    away_xy: Eleven
    ball_xyz: tuple[X, Y, Z]


class GrfReadback(StrictModel):
    side: Side
    slot: Slot
    attribute: Attribute
    base: Unit
    effective: Unit


class GrfReplay(StrictModel):
    schema_version: Literal['grf-experimental-1'] = 'grf-experimental-1'
    engine_version: Literal['grf-2.10.2-probe'] = 'grf-2.10.2-probe'
    input: GrfInput
    native_binary_sha256: Digest
    attribute_readbacks: list[GrfReadback] = Field(min_length=66, max_length=66)
    observation_interval_ms: Literal[100] = 100
    duration_ms: int = Field(ge=100, le=310100, strict=True)
    steps_left: Literal[0] = 0
    samples: list[GrfSample] = Field(min_length=2, max_length=3102)
    trace_hash: str = ''


class GrfMatchSettings(GrfSettings):
    # A safety ceiling, never the successful full-time condition.
    game_duration: Literal[4200] = 4200
    second_half: Literal[1500] = 1500
    finish_policy: Literal['stoppage-or-neutral-after-90'] = 'stoppage-or-neutral-after-90'


class GrfMatchInput(GrfInput):
    settings: GrfMatchSettings = Field(default_factory=GrfMatchSettings)


class GrfMatchSample(GrfSample):
    index: int = Field(ge=0, le=4301, strict=True)
    engine_step: int = Field(ge=-1, le=4200, strict=True)
    match_time_ms: int = Field(ge=0, lt=5760000, strict=True)
    actual_time_ms: int = Field(ge=0, le=5000000, strict=True)
    phase: Literal[1, 2]
    in_play: bool
    set_piece: bool


class GrfFullMatchReplay(GrfReplay):
    schema_version: Literal['grf-experimental-2'] = 'grf-experimental-2'
    engine_version: Literal['grf-2.10.2-full-match-1'] = 'grf-2.10.2-full-match-1'
    input: GrfMatchInput
    duration_ms: int = Field(ge=100, le=430100, strict=True)
    steps_left: int = Field(ge=0, le=4200, strict=True)
    samples: list[GrfMatchSample] = Field(min_length=2, max_length=4302)
    halftime_sample_index: int = Field(ge=1, le=4300, strict=True)
    completion_reason: Literal['full_time'] = 'full_time'


from .telemetry_models import GrfTelemetry,Direction


class GrfStatisticsInput(GrfMatchInput):
    telemetry_version: Literal['grf-native-events-1'] = 'grf-native-events-1'


class GrfStatisticsSample(GrfMatchSample):
    home_active: list[bool] = Field(min_length=11,max_length=11)
    away_active: list[bool] = Field(min_length=11,max_length=11)
    attack_direction: Direction


class GrfStatisticsReplay(GrfFullMatchReplay):
    schema_version: Literal['grf-experimental-3'] = 'grf-experimental-3'
    engine_version: Literal['grf-2.10.2-stats-1'] = 'grf-2.10.2-stats-1'
    input: GrfStatisticsInput
    samples: list[GrfStatisticsSample] = Field(min_length=2,max_length=4302)
    telemetry: GrfTelemetry


GrfRecord = Annotated[GrfReplay | GrfFullMatchReplay | GrfStatisticsReplay, Field(discriminator='schema_version')]


class GrfSummary(StrictModel):
    home_name: str
    away_name: str
    score: tuple[int, int]
    duration_ms: int
    trace_hash: str


class GrfJob(StrictModel):
    id: str
    state: Literal['queued', 'running', 'ready', 'failed']
    config: MatchConfig
    error: str | None = None
    summary: GrfSummary | None = None


class EngineCapability(StrictModel):
    id: Literal['timepitch', 'grf', 'touchlines']
    available: bool
    reason: Literal['missing_runtime', 'missing_assets', 'unsupported_native_binary'] | None = None
    clock_policy:Literal['compressed','physical-periods-1']|None=None


GrfCapability = EngineCapability
