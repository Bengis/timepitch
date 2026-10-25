"""Bounded prose, separate from the local worker's sentence-selection contract."""
from typing import Annotated, Literal
from decimal import Decimal
from hashlib import sha256
import json
from urllib.parse import urlsplit

from pydantic import ConfigDict, Field, model_validator

from ..models import ChronicleFact, ChronicleRequest, Coverage, Digest, Engine, FactPack, Identifier, Locale, Name, StrictModel, canonical_bytes

PROFILE = 'azure-chronicle-1'
SCHEMA_VERSION = 'chronicle-prose-1'
PROMPT_VERSION = 'azure-chronicle-prompt-1'
VALIDATOR_VERSION = 'azure-prose-checks-1'


class ProseModel(StrictModel):
    model_config = ConfigDict(hide_input_in_errors=True)


class ProseSentence(ProseModel):
    text: Annotated[str, Field(min_length=1, max_length=360)]
    fact_ids: list[Identifier] = Field(min_length=1, max_length=4)

    @model_validator(mode='after')
    def unique_facts(self):
        if len(set(self.fact_ids)) != len(self.fact_ids):
            raise ValueError('Duplicate fact references')
        return self


class ProseParagraph(ProseModel):
    sentences: list[ProseSentence] = Field(min_length=1, max_length=2)


class ChronicleDraft(ProseModel):
    headline: ProseSentence
    paragraphs: list[ProseParagraph] = Field(min_length=2, max_length=3)

    @model_validator(mode='after')
    def text_budget(self):
        texts = [self.headline.text, *(s.text for p in self.paragraphs for s in p.sentences)]
        if len(self.headline.text) > 160 or sum(map(len, texts)) > 4000:
            raise ValueError('Draft text exceeds contract')
        return self


class AuthoritativeHeader(ProseModel):
    home_name: Name
    away_name: Name
    score: list[Annotated[int, Field(ge=0, le=4000)]] = Field(min_length=2, max_length=2)
    dataset_version: str
    scope: Literal['final'] = 'final'
    simulated: Literal[True] = True


class SentenceEvidence(ProseModel):
    fact_ids: list[Identifier] = Field(min_length=1, max_length=4)
    event_refs: list[Identifier] = Field(max_length=8)
    facts: list[ChronicleFact] = Field(min_length=1, max_length=4)


class CheckedDraft(ProseModel):
    draft: ChronicleDraft
    header: AuthoritativeHeader
    coverage: Coverage
    coverage_notes: list[str]
    evidence: list[SentenceEvidence] = Field(min_length=3, max_length=7)
    locale: Locale
    fact_hash: Digest
    validator_version: Literal['azure-prose-checks-1'] = VALIDATOR_VERSION
    provenance: Literal['azure_ai_draft_checked'] = 'azure_ai_draft_checked'
    semantic_verified: Literal[False] = False


Count = Annotated[int, Field(ge=0, le=100_000_000)]
Positive = Annotated[int, Field(ge=1, le=100_000_000)]
Money = Annotated[Decimal, Field(ge=0, max_digits=30, decimal_places=12)]
ErrorCode = Literal['queue_expired','job_timeout','clock_regressed','budget_exhausted','source_unavailable',
    'stale_revision','invalid_result','uncertain_send','provider_error','model_mismatch','usage_bound_exceeded']


def model_digest(model: ProseModel) -> str:
    return sha256(canonical_bytes(model)).hexdigest()


class FrozenModel(ProseModel):
    model_config = ConfigDict(frozen=True)


class AzureBinding(FrozenModel):
    id: Identifier
    version: Identifier
    endpoint: Annotated[str, Field(max_length=300)]
    deployment: Identifier
    expected_model: Identifier
    region: Identifier
    input_token_ceiling: Positive
    input_bound_proof: Digest
    profile: Literal['azure-chronicle-1'] = PROFILE
    prompt_version: Literal['azure-chronicle-prompt-1'] = PROMPT_VERSION
    schema_version: Literal['chronicle-prose-1'] = SCHEMA_VERSION
    validator_version: Literal['azure-prose-checks-1'] = VALIDATOR_VERSION
    max_output_tokens: Literal[2048] = 2048

    @model_validator(mode='after')
    def fixed_endpoint(self):
        url = urlsplit(self.endpoint)
        if (url.scheme != 'https' or not url.hostname or url.username or url.password or url.port not in (None,443)
                or url.query or url.fragment or not url.path.endswith('/openai/v1/')
                or not url.hostname.endswith('.openai.azure.com')):
            raise ValueError('A fixed Azure HTTPS inference endpoint is required')
        return self


def binding_hash(binding: AzureBinding) -> str:
    return model_digest(binding)


class Tariff(FrozenModel):
    currency: Annotated[str, Field(pattern=r'^[A-Z]{3}$')]
    version: Identifier
    input_per_million: Money
    output_per_million: Money
    quantum: Annotated[Decimal, Field(gt=0, le=1, max_digits=13, decimal_places=12)]


class AzureGrant(FrozenModel):
    id: Annotated[str, Field(pattern=r'^[a-zA-Z0-9_-]{1,100}$')]
    state_id: Digest
    parent_digest: Digest
    binding_hash: Digest
    expires_at: Annotated[float, Field(gt=0)]
    call_limit: Positive
    input_limit: Positive
    output_limit: Positive
    money_limit: Money
    per_owner_calls: Positive
    tariff: Tariff
    mode: Literal['acceptance','public']
    owner: Identifier | None = None
    engine: Engine | None = None
    match_id: Identifier | None = None
    trace_hash: Digest | None = None
    locale: Locale | None = None

    @model_validator(mode='after')
    def private_acceptance_scope(self):
        if self.mode == 'acceptance' and any(v is None for v in (self.owner,self.engine,self.match_id,self.trace_hash,self.locale)):
            raise ValueError('Acceptance requires a fixed owner and saved source')
        return self


class PreparedAzureRequest(ProseModel):
    body: dict
    request_hash: Digest
    binding_hash: Digest
    fact_hash: Digest
    input_upper_tokens: Positive

    @model_validator(mode='after')
    def bounded_identity(self):
        raw = json.dumps(self.body,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
        if len(raw)>131072 or sha256(raw).hexdigest()!=self.request_hash:
            raise ValueError('Invalid prepared request identity')
        return self


class AzureLease(ProseModel):
    job_id: Identifier
    generation: Positive
    token: Annotated[str, Field(min_length=32,max_length=128)]
    fact_hash: Digest


class SendPermit(ProseModel):
    attempt_id: Identifier
    request_hash: Digest


class AzureClaim(ProseModel):
    owner: Identifier
    request: ChronicleRequest
    fact_pack: FactPack
    binding: AzureBinding
    lease: AzureLease


class AzureReceipt(ProseModel):
    attempt_id: Identifier
    request_hash: Digest
    model: Identifier | None
    provider_request_id: Identifier | None
    draft: ChronicleDraft | None
    error: ErrorCode | None
    elapsed_ms: Count
    input_tokens: Count | None
    output_tokens: Count | None
    reasoning_tokens: Count | None


class AzureJobView(ProseModel):
    id: Identifier
    engine: Engine
    match_id: Identifier
    trace_hash: Digest
    locale: Locale
    fact_hash: Digest
    state: Literal['queued','running','ready','unavailable','rejected','stale']
    error: ErrorCode | None
    checked: CheckedDraft | None
    profile: Literal['azure-chronicle-1'] = PROFILE


class AzureStatus(ProseModel):
    mode: Literal['off','acceptance','public']
    worker: Literal['off','ready','busy','unknown']
    generation_allowed: bool
    supported_engines: list[Engine]
    reason: str | None
    profile: Literal['azure-chronicle-1'] = PROFILE


class WorkerOutcome(ProseModel):
    state: Literal['idle','ready','rejected','unavailable','uncertain']
    job_id: Identifier | None = None
    reason: str | None = Field(default=None,max_length=80)


class AzureTerminalReceipt(ProseModel):
    parent_digest: Digest
    grant_digest: Digest
    binding_hash: Digest
    source_hash: Digest
    request_hash: Digest
    attempt_id: Identifier
    outcome: Literal['ready','rejected','unavailable','uncertain']
    charged_dispatches: Literal[0,1]
    reserved_input_tokens: Count
    reserved_output_tokens: Count
    currency: Annotated[str, Field(pattern=r'^[A-Z]{3}$')]
    reserved_money: Money
    actual_input_tokens: Count | None
    actual_output_tokens: Count | None
    actual_reasoning_tokens: Count | None
    actual_money: Money | None
    elapsed_ms: Count
    validation: Literal['not_checked','passed','failed']
    human_review: Literal['pending','passed','failed']

    @model_validator(mode='after')
    def liability_cannot_disappear(self):
        if self.charged_dispatches == 0 and any(v for v in (self.reserved_input_tokens,self.reserved_output_tokens,
                self.reserved_money,self.actual_input_tokens,self.actual_output_tokens,self.actual_reasoning_tokens,self.actual_money)):
            raise ValueError('Uncharged terminal receipt cannot contain dispatch liability')
        return self


class AncestorSummary(AzureTerminalReceipt):
    receipt_digest: Digest
