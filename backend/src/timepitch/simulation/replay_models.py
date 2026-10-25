"""Version-two wire contract. Positions are integer millimetres, identities static."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictInt
from .models import MatchConfig, MatchMetrics, RenderFrame, Side, EventType

Clock = Annotated[StrictInt, Field(ge=0, le=5400000)]
Index = Annotated[StrictInt, Field(ge=0, le=25600)]
XY = tuple[Annotated[StrictInt, Field(ge=0, le=105000)], Annotated[StrictInt, Field(ge=0, le=68000)]]
SampleWire = tuple[
    Clock, Annotated[StrictInt, Field(ge=1, le=2)], Annotated[StrictInt, Field(ge=0, le=4000)],
    Annotated[StrictInt, Field(ge=0, le=4000)], Annotated[StrictInt, Field(ge=0, le=1)],
    Annotated[StrictInt, Field(ge=-1, le=21)], Annotated[StrictInt, Field(ge=0, le=2)],
    Annotated[StrictInt, Field(ge=0, le=4)], Annotated[StrictInt, Field(ge=0, le=105000)],
    Annotated[StrictInt, Field(ge=0, le=68000)],
    Annotated[list[Annotated[StrictInt, Field(ge=0, le=105000)]], Field(min_length=44, max_length=44)],
]


class MotionSample(RootModel[SampleWire]):
    @property
    def clock_ms(self): return self.root[0]
    @property
    def period(self): return self.root[1]
    @property
    def home_goals(self): return self.root[2]
    @property
    def away_goals(self): return self.root[3]
    @property
    def possession_index(self): return self.root[4]
    @property
    def carrier_index(self): return self.root[5]
    @property
    def ball_mode(self): return self.root[6]
    @property
    def reset_code(self): return self.root[7]
    @property
    def ball_x_mm(self): return self.root[8]
    @property
    def ball_y_mm(self): return self.root[9]
    @property
    def player_xy_mm(self): return self.root[10]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ResolvedEvent(StrictModel):
    id: str = Field(max_length=80)
    t0_ms: Clock
    t1_ms: Clock
    type: EventType
    side: Side | None = None
    participants: list[str] = Field(max_length=4)
    outcome: str = Field(max_length=80)
    evidence: dict[str, str | int | float | bool]
    period: Annotated[StrictInt, Field(ge=1, le=2)]
    sample_index: Index
    origin_sample_index: Index
    origin_mm: XY
    end_mm: XY
    possession_id: Annotated[StrictInt, Field(ge=0)]
    sequence_id: Annotated[StrictInt, Field(ge=0)]
    related_event_ids: list[str] = Field(default_factory=list, max_length=4)
    released_ms: Clock


class EventView(StrictModel):
    id: str
    t0_ms: int
    t1_ms: int
    type: EventType
    side: Side | None
    participants: list[str]
    outcome: str
    evidence: dict[str, str | int | float | bool]
    period: int
    origin_mm: XY | None = None
    end_mm: XY | None = None
    possession_id: int | None = None
    sequence_id: int | None = None
    related_event_ids: list[str] = Field(default_factory=list)
    released_ms: int | None = None
    sample_index: int | None = None
    origin_sample_index: int | None = None
    context_available: bool = False


class MetricDefinition(StrictModel):
    id: str
    version: str
    unit: str
    label_key: str
    parameters: dict[str, str | float | int | bool] = Field(default_factory=dict)


class MetricValue(StrictModel):
    value: float | None = Field(default=None, allow_inf_nan=False)
    unit: str
    origin: Literal['simulated', 'historical', 'estimated']
    status: Literal['available', 'partial', 'unavailable']
    reason: str | None = None
    source: str
    definition_version: str
    denominator: float | None = Field(default=None, allow_inf_nan=False)
    covered_minutes: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    event_ids: list[str] = Field(default_factory=list)
    sample_ranges: list[tuple[Index, Index]] = Field(default_factory=list)


class PlotPoint(StrictModel):
    kind: Literal['shot', 'xg', 'action', 'occupancy', 'effort', 'pass_edge']
    time_ms: Clock
    side: Side
    player_key: str | None = None
    related_player_key: str | None = None
    event_id: str | None = None
    x: float | None = Field(default=None, allow_inf_nan=False)
    y: float | None = Field(default=None, allow_inf_nan=False)
    value: float = Field(allow_inf_nan=False)


class StatisticsBundle(StrictModel):
    version: Literal['metrics-1'] = 'metrics-1'
    end_ms: Clock
    definitions: dict[str, MetricDefinition]
    by_team: dict[str, dict[str, MetricValue]]
    by_player: dict[str, dict[str, MetricValue]]
    plots: dict[str, list[PlotPoint]] = Field(default_factory=dict)


class MatchRecordV2(StrictModel):
    format_version: Literal[2]
    config: MatchConfig
    seed: Annotated[StrictInt, Field(ge=0, le=4294967295)]
    dataset_version: str
    engine_version: Literal['engine-2'] = 'engine-2'
    rules_version: Literal['rules-2'] = 'rules-2'
    ratings_version: Literal['ratings-1'] = 'ratings-1'
    metrics_version: Literal['basic-2', 'metrics-1'] = 'basic-2'
    home_name: str
    away_name: str
    initial_frame: RenderFrame
    motion: list[MotionSample] = Field(min_length=1, max_length=25601)
    events: list[ResolvedEvent] = Field(max_length=4000)
    metrics: MatchMetrics
    statistics: StatisticsBundle | None = None
    trace_hash: str = ''
