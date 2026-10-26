"""Crew wire data: typed workflow messages, envelope, ledger rows and the final report.

The crew is a separate pipeline. It reuses the chronicle FactPack, ChronicleDraft and
validator, but owns none of the chronicle accounting tables or the Azure binding.
"""
from decimal import Decimal
from hashlib import sha256
import json
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import ConfigDict, Field, model_validator

from ..chronicles.azure.models import VALIDATOR_VERSION, ChronicleDraft, Money, Tariff
from ..chronicles.models import FACT_VERSION, Digest, Identifier, Locale, StrictModel, canonical_bytes

CREW_VERSION = 'crew-1'
ANALYST_PROMPT_VERSION = 'crew-analyst-4'  # TP262: half-time packs (first half only)
WRITER_PROMPT_VERSION = 'crew-writer-8'  # TP262: half-time report rule (TP260: audience and comparisons)
VERIFIER_VERSION = 'crew-verifier-6'  # TP263: a team's number is that team's
FIXER_VERSION = 'crew-fixer-3'
EVALUATION_VERSION = 'crew-eval-1'
FALLBACK_VERSION = 'crew-fallback-4'  # TP262: half-time result sentence
REPORT_VERSION = 'crew-report-2'
MAX_OUTPUT_TOKENS = 1024
CALLS_PER_REPORT = 3

Angle = Literal['result', 'scorers', 'team_comparison', 'individual_leaders', 'narrow_win', 'dominant_display',
                'against_the_run_of_play', 'goal_fest', 'stalemate']
Role = Literal['analyst', 'writer', 'writer_revision', 'verifier', 'fixer', 'publisher',
               'judge_groundedness', 'judge_coherence', 'judge_fluency']
LlmStep = Literal['analyst', 'writer', 'writer_revision']
InputBound = Literal['crew-input-bytes-1', 'context-ceiling-1047576']
StepCode = Literal['ok', 'replayed', 'accepted', 'rejected', 'uncertain_send', 'model_mismatch',
                   'provider_error', 'invalid_result', 'usage_bound_exceeded', 'envelope_refused',
                   'deterministic_fallback', 'crew_ai_draft_checked', 'fixed', 'revision_noop']
Count = Annotated[int, Field(ge=0, le=100_000_000)]


def digest(model: StrictModel) -> str:
    return sha256(canonical_bytes(model)).hexdigest()


class CrewModel(StrictModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False, hide_input_in_errors=True)


class FrozenCrewModel(CrewModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False, hide_input_in_errors=True, frozen=True)


class CrewBinding(FrozenCrewModel):
    """Fixed endpoint/deployment for the crew; independent of AzureBinding by design."""
    id: Identifier
    version: Identifier
    endpoint: Annotated[str, Field(max_length=300)]
    deployment: Identifier
    expected_model: Identifier
    # Exact extra strings the same deployment may report (24-oct): never a pattern.
    model_aliases: list[Identifier] = Field(default_factory=list, max_length=4)
    max_output_tokens: Literal[1024] = MAX_OUTPUT_TOKENS

    @property
    def accepted_models(self) -> frozenset[str]:
        return frozenset([self.expected_model, *self.model_aliases])

    @model_validator(mode='after')
    def fixed_endpoint(self):
        url = urlsplit(self.endpoint)
        if (url.scheme != 'https' or not url.hostname or url.username or url.password or url.port not in (None, 443)
                or url.query or url.fragment or not url.path.endswith('/openai/v1/')
                or not url.hostname.endswith('.openai.azure.com')):
            raise ValueError('A fixed Azure HTTPS inference endpoint is required')
        return self


def default_binding() -> CrewBinding:
    return CrewBinding(id='timepitch-crew', version='2', endpoint='https://timepitch-ai.openai.azure.com/openai/v1/',
                       deployment='gpt-4.1-mini', expected_model='gpt-4.1-mini',
                       model_aliases=['gpt-4.1-mini-2025-04-14'])


def default_tariff() -> Tariff:
    # gpt-4.1-mini Global Standard: USD 0.0004 / 1K input, 0.0016 / 1K output.
    return Tariff(currency='USD', version='azure-global-standard-gpt-4.1-mini-2026-10',
                  input_per_million=Decimal('0.40'), output_per_million=Decimal('1.60'), quantum=Decimal('0.000001'))


def crew_versions() -> dict[str, str]:
    """Crew-owned versions that change request bytes; they enter request_hash."""
    return {'crew': CREW_VERSION, 'analyst_prompt': ANALYST_PROMPT_VERSION, 'writer_prompt': WRITER_PROMPT_VERSION,
            'verifier': VERIFIER_VERSION, 'fixer': FIXER_VERSION, 'validator': VALIDATOR_VERSION, 'fact_version': FACT_VERSION,
            'fallback': FALLBACK_VERSION, 'max_output_tokens': str(MAX_OUTPUT_TOKENS)}


Audience = Literal['fan', 'analyst']  # TP260: who the report is written for


def request_hash(fact_hash: str, locale: str, binding: CrewBinding, audience: str = 'fan') -> str:
    raw = json.dumps({'fact_hash': fact_hash, 'locale': locale, 'audience': audience, 'versions': crew_versions(),
                      'deployment': binding.deployment, 'expected_model': binding.expected_model},
                     sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    return sha256(raw).hexdigest()


class CrewGrant(FrozenCrewModel):
    """Private envelope. Nothing beyond it is sent; its sha256 identifies the ledger."""
    id: Annotated[str, Field(pattern=r'^[a-zA-Z0-9_-]{1,100}$')]
    binding_hash: Digest
    tariff: Tariff
    max_reports: Annotated[int, Field(ge=1, le=1000)]
    calls_per_report: Literal[3] = CALLS_PER_REPORT
    money_limit: Money
    expires_at: Annotated[float, Field(gt=0)]
    input_bound: InputBound
    # 'evaluation' envelopes pay for the Foundry judge (3 judge calls per evaluated report).
    purpose: Literal['crew', 'evaluation'] = 'crew'
    locales: list[Locale] = Field(default_factory=lambda: ['en', 'es'], min_length=1, max_length=2)


# ---- typed workflow messages -------------------------------------------------------------

class CrewStart(CrewModel):
    request_hash: Digest


class CrewPlan(CrewModel):
    angle: Angle
    paragraphs: list[list[Identifier]] = Field(min_length=2, max_length=3)

    @model_validator(mode='after')
    def bounded(self):
        ids = [i for p in self.paragraphs for i in p]
        if any(not 1 <= len(p) <= 4 for p in self.paragraphs) or len(set(ids)) != len(ids):
            raise ValueError('Invalid plan shape')
        return self


class Draft(CrewModel):
    attempt: Literal[1, 2]
    draft: ChronicleDraft
    fixed: bool = False  # True once the deterministic Fixer has added citations to this attempt


Location = Annotated[str, Field(pattern=r'^(?:draft|headline|plan|p[1-3]s[1-2]|none)$')]


class Failure(CrewModel):
    code: Identifier
    location: Location


class Verdict(CrewModel):
    """App-owned strings only: never echoes model prose. code/location repeat the first failure."""
    decision: Literal['accept', 'fix', 'revise', 'fallback']
    code: Identifier
    location: Location = 'none'
    attempt: Literal[0, 1, 2] = 0
    failures: list[Failure] = Field(default_factory=list, max_length=16)


# ---- trace, state and report -------------------------------------------------------------

class CrewStep(CrewModel):
    role: Role
    code: StepCode
    reason: Identifier | None = None
    location: str | None = None
    model: Identifier | None = None
    request_id: Identifier | None = None
    input_tokens: Count | None = None
    output_tokens: Count | None = None
    reserved: Money = Decimal(0)
    cost: Money = Decimal(0)
    replayed: bool = False
    fixes: list[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=16)


class CrewState(CrewModel):
    request_hash: Digest
    plan: CrewPlan | None = None
    drafts: list[Draft] = Field(default_factory=list, max_length=4)
    verdicts: list[Verdict] = Field(default_factory=list, max_length=6)
    steps: list[CrewStep] = Field(default_factory=list, max_length=12)
    outcome: Literal['pending', 'crew_ai_draft_checked', 'deterministic_fallback'] = 'pending'


class CrewSource(CrewModel):
    engine: str
    trace_hash: Digest
    fact_hash: Digest
    dataset_version: str
    binding_hash: Digest
    grant_sha256: Digest | None
    request_hash: Digest


class CrewReport(CrewModel):
    report_version: Literal['crew-report-2'] = REPORT_VERSION
    source: CrewSource
    locale: Locale
    audience: Audience = 'fan'
    versions: dict[str, str]
    provenance: Literal['crew_ai_draft_checked', 'deterministic_fallback']
    semantic_verified: Literal[False] = False
    draft: ChronicleDraft | None = None
    fallback_text: str | None = Field(default=None, max_length=8000)
    # Server-owned coverage lines (validator coverage notes) shown with an accepted AI draft; never model prose.
    coverage_notes: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=12)
    steps: list[CrewStep]
    total_cost: Money
    report_sha256: Digest | None = None

    @model_validator(mode='after')
    def one_body(self):
        if (self.draft is None) == (self.fallback_text is None):
            raise ValueError('Exactly one of draft or fallback text')
        if (self.provenance == 'crew_ai_draft_checked') != (self.draft is not None):
            raise ValueError('Provenance does not match body')
        return self


def seal_report(report: CrewReport) -> CrewReport:
    body = report.model_copy(update={'report_sha256': None})
    return report.model_copy(update={'report_sha256': digest(body)})


def verify_report(report: CrewReport) -> bool:
    return report.report_sha256 == digest(report.model_copy(update={'report_sha256': None}))
