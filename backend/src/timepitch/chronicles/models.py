"""Versioned wire data. A worker selects facts; it cannot supply accepted prose."""
import json
from hashlib import sha256
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_serializer, model_validator

PROTOCOL = 'timepitch-ai-worker-1'
FACT_VERSION = 'chronicle-facts-1'
PROMPT_VERSION = 'chronicle-1'
PROFILE = 'foundry-qwen2.5-1.5b-gpu4'
MODEL = 'qwen2.5-1.5b-instruct-generic-gpu:4@4'
Engine = Literal['timepitch', 'grf', 'touchlines']  # TP253: TouchLines, para la crónica en vivo
Locale = Literal['en', 'es']
Side = Literal['home', 'away']
Digest = Annotated[str, Field(pattern=r'^[a-f0-9]{64}$')]
Identifier = Annotated[str, Field(min_length=1, max_length=200)]
Name = Annotated[str, Field(min_length=1, max_length=120)]
Variant = Annotated[StrictInt, Field(ge=0, le=1)]
Count = Annotated[StrictInt, Field(ge=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


def canonical_bytes(model: BaseModel) -> bytes:
    return json.dumps(model.model_dump(mode='json'), ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


class Coverage(StrictModel):
    events_complete: bool
    native_clock: bool
    notes: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=8)
    omitted_events: Count = 0


class ChronicleFact(StrictModel):
    id: Identifier
    kind: Literal['result', 'goal', 'actor_stat', 'team_compare', 'coverage']
    side: Side | None = None
    player_ids: list[Identifier] = Field(default_factory=list, max_length=3)
    player_names: list[Name] = Field(default_factory=list, max_length=3)
    metric_id: Annotated[str, Field(max_length=80)] | None = None
    value: float | None = None
    comparison_value: float | None = None
    unit: Literal['count', 'percent', 'none'] = 'none'
    availability: Literal['measured', 'derived', 'unavailable'] = 'measured'
    event_refs: list[Identifier] = Field(default_factory=list, max_length=8)
    own_goal: bool = False
    time_ms: Count | None = None

    @model_validator(mode='after')
    def identities(self):
        if len(self.player_ids) != len(self.player_names) or len(set(self.player_ids)) != len(self.player_ids):
            raise ValueError('Invalid fact participants')
        return self


class EventDescriptor(StrictModel):
    id: Identifier
    type: Literal['goal']
    time_ms: Count
    side: Side | None = None


class FactPack(StrictModel):
    engine: Engine
    trace_hash: Digest
    dataset_version: Annotated[str, Field(min_length=1, max_length=200)]
    fact_version: Literal['chronicle-facts-1'] = FACT_VERSION
    home_name: Name
    away_name: Name
    score: list[Annotated[StrictInt, Field(ge=0, le=4000)]] = Field(min_length=2, max_length=2)
    full_time_ms: Count | None
    coverage: Coverage
    facts: list[ChronicleFact] = Field(min_length=1, max_length=16)
    events: list[EventDescriptor] = Field(default_factory=list, max_length=8)
    # TP262: a half-time pack holds the first half only (score, goals and comparisons at the break).
    period: Literal['full_time', 'half_time'] = 'full_time'

    @model_serializer(mode='wrap')
    def _full_time_unchanged(self, handler):
        # A full-time pack serialises exactly as before TP262, so its hash and the reports sealed with it stay valid.
        data = handler(self)
        if data.get('period') == 'full_time':
            data.pop('period')
        return data

    @model_validator(mode='after')
    def bounded(self):
        ids = [fact.id for fact in self.facts]
        if len(set(ids)) != len(ids) or ids[0] != 'result' or self.facts[0].kind != 'result':
            raise ValueError('Unique facts and authoritative result required')
        if len(set(e.id for e in self.events)) != len(self.events) or len(canonical_bytes(self)) > 32768:
            raise ValueError('Fact pack exceeds contract')
        return self


def fact_pack_hash(pack: FactPack) -> str:
    return sha256(canonical_bytes(pack)).hexdigest()


class ChroniclePart(StrictModel):
    fact_ids: list[Identifier] = Field(min_length=1, max_length=4)
    variant: Variant


class ChronicleAnalysis(StrictModel):
    fact_ids: list[Identifier] = Field(min_length=1, max_length=4)


class ChronicleSelection(StrictModel):
    headline: ChroniclePart
    paragraphs: list[ChroniclePart] = Field(min_length=1, max_length=3)


class ChronicleRequest(StrictModel):
    engine: Engine
    match_id: Annotated[str, Field(min_length=1, max_length=120)]
    trace_hash: Digest
    locale: Locale


class LeaseRef(StrictModel):
    job_id: Identifier
    generation: Annotated[StrictInt, Field(ge=1)]
    lease_token: Annotated[str, Field(min_length=32, max_length=128)]
    fact_hash: Digest


class WorkerClaim(StrictModel):
    worker_id: Identifier
    profile: Literal['foundry-qwen2.5-1.5b-gpu4'] = PROFILE
    protocol_version: Literal['timepitch-ai-worker-1'] = PROTOCOL
    model_ready: bool


class WorkerIdentity(StrictModel):
    worker_id: Identifier
    profile: Literal['foundry-qwen2.5-1.5b-gpu4'] = PROFILE


class WorkerHeartbeat(WorkerClaim):
    lease: LeaseRef | None = None


class ClaimedJob(StrictModel):
    lease: LeaseRef
    fact_pack: FactPack
    locale: Locale
    prompt_version: Literal['chronicle-1'] = PROMPT_VERSION
    profile: Literal['foundry-qwen2.5-1.5b-gpu4'] = PROFILE
    protocol_version: Literal['timepitch-ai-worker-1'] = PROTOCOL
    deadline_at: float
    calls_reserved: Literal[4] = 4


class WorkerResult(StrictModel):
    lease: LeaseRef
    selection: ChronicleSelection
    actual_calls: Annotated[StrictInt, Field(ge=1, le=4)]
    evidence_reads: Literal[1]
    model_id: Literal['qwen2.5-1.5b-instruct-generic-gpu:4@4'] = MODEL
    prompt_version: Literal['chronicle-1'] = PROMPT_VERSION
    profile: Literal['foundry-qwen2.5-1.5b-gpu4'] = PROFILE
    protocol_version: Literal['timepitch-ai-worker-1'] = PROTOCOL

    @model_validator(mode='after')
    def bounded(self):
        if len(canonical_bytes(self)) > 16384:
            raise ValueError('Worker output too large')
        return self


class ProviderReceipt(StrictModel):
    selection: ChronicleSelection
    actual_calls: Annotated[StrictInt, Field(ge=1, le=4)]
    evidence_reads: Literal[1]
    model_id: Literal['qwen2.5-1.5b-instruct-generic-gpu:4@4'] = MODEL
    elapsed_ms: Annotated[float, Field(ge=0)]


class WorkerStatus(StrictModel):
    state: Literal['disconnected', 'not_ready', 'ready', 'busy']
    profile: Literal['foundry-qwen2.5-1.5b-gpu4'] = PROFILE


class ChronicleView(ChronicleRequest):
    id: Identifier
    fact_hash: Digest
    state: Literal['queued', 'running', 'ready', 'unavailable', 'rejected']
    text: str = Field(default='', max_length=8000)
    event_refs: list[Identifier] = Field(default_factory=list, max_length=32)
    prompt_version: str = PROMPT_VERSION
    profile: str = PROFILE
    model_id: str = MODEL
    calls_reserved: Count = 0
    actual_calls: Annotated[StrictInt, Field(ge=0, le=4)] | None = None
    error: Literal['queue_expired', 'lease_expired', 'job_timeout', 'clock_regressed', 'budget_exhausted', 'source_unavailable', 'stale_revision', 'invalid_result'] | None = None
    provenance: Literal['pending', 'validated_worker_ai', 'deterministic_fallback'] = 'pending'
