from typing import Literal,Annotated
from pydantic import BaseModel, ConfigDict, Field,StrictInt,model_validator
from ..simulation.models import MatchMetrics, Score

MetricCategory=Literal['chance_quality_edge','territory_edge','distance_leader']
Category = Literal['overview', 'goal', 'shot', 'pressure', 'possession_edge','chance_quality_edge','territory_edge','distance_leader']
Locale = Literal['en', 'es']
Mode = Literal['fan', 'analyst']
PROMPT_VERSION = 'grounded-2'
SampleIndex=Annotated[StrictInt,Field(ge=0,le=25600)]
SampleRange=tuple[SampleIndex,SampleIndex]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class MetricFact(StrictModel):
    id:str=Field(max_length=200)
    category:MetricCategory
    metric_id:str=Field(max_length=80)
    side:Literal['home','away']
    player_key:str|None=None
    player_name:str|None=Field(default=None,max_length=200)
    team_name:str=Field(max_length=200)
    value:float=Field(allow_inf_nan=False)
    unit:str=Field(max_length=40)
    comparison_value:float|None=Field(default=None,allow_inf_nan=False)
    event_ids:list[str]=Field(default_factory=list,max_length=4)
    sample_ranges:list[SampleRange]=Field(default_factory=list,max_length=4)


class WindowStatistics(StrictModel):
    version:Literal['metrics-1']='metrics-1'
    end_ms:int=Field(ge=0,le=5400000)
    facts:list[MetricFact]=Field(default_factory=list,max_length=4)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({fact.id for fact in self.facts})!=len(self.facts):raise ValueError('Duplicate metric observation')
        return self


class MatchWindow(StrictModel):
    id: Literal['moment', 'halftime', 'fulltime']
    end_ms: int
    event_ids: list[str]=Field(min_length=1,max_length=4)
    metrics: MatchMetrics
    score: Score
    revision: str
    statistics:WindowStatistics|None=None


class GroundedAnalysis(StrictModel):
    window_id: str
    revision: str
    category: Category
    side: Literal['home', 'away'] | None
    event_ids: list[str] = Field(max_length=4)
    player_keys: list[str] = Field(max_length=3)
    score: Score
    metric_id:str|None=None
    metric_player_key:str|None=None
    sample_ranges:list[SampleRange]=Field(default_factory=list,max_length=4)

    @model_validator(mode='after')
    def legacy_events_required(self):
        if self.category!='distance_leader' and not self.event_ids:raise ValueError('This category needs event evidence')
        return self


class GroundedExplanation(GroundedAnalysis):
    locale: Locale
    mode: Mode
    side: Literal['home', 'away'] | None = None
    variant: Literal[0, 1]


class ValidationResult(BaseModel):
    accepted: bool
    errors: list[str]


class ExplanationRequest(StrictModel):
    window_id: Literal['moment', 'halftime', 'fulltime']
    revision: str = Field(max_length=64)
    locale: Locale
    mode: Mode
    retry: bool = False


class ExplanationJob(StrictModel):
    id: str
    match_id: str
    window: MatchWindow
    locale: Locale
    mode: Mode
    state: Literal['pending', 'ready', 'unavailable', 'rejected']
    provenance: Literal['local_ai', 'deterministic_fallback']
    explanation: GroundedExplanation | None = None
    text: str = ''
    error: str | None = None
    model: str
    # Old stored jobs that omitted this field must never be relabelled by an upgrade.
    prompt_version: str = 'grounded-1'
    calls_reserved: int = 0
    attempts: int = 1
    latency_ms: float | None = None
