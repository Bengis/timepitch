"""Allowlisted local failure metadata. Never serialize arbitrary exception content."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, model_validator

from ..agents.provider import ModelOutputError

Stage = Literal['evidence','analysis','narration','selection_validation','story_validation',
                'broker_delivery','readiness','unknown']
Reason = Literal['json_invalid','json_object_required','schema_invalid','analysis_result_missing',
                 'analysis_duplicate_facts','analysis_insufficient_observations','evidence_missing',
                 'evidence_repeated','selection_invalid','operation_timeout','operation_admission_closed',
                 'http_allowance_exhausted','transport_failure','provider_not_ready','cancelled','unclassified_failure']
SchemaRule = Literal['type','enum','required','additionalProperties','minItems','maxItems','minimum','maximum']
SchemaKey = Literal['properties','items','fact_ids','headline','paragraphs','variant','type','enum',
                    'required','additionalProperties','minItems','maxItems','minimum','maximum']
SchemaToken = SchemaKey | Annotated[StrictInt,Field(ge=0,le=32)]
Count = Annotated[StrictInt,Field(ge=0,le=4)]


class ProviderDiagnostic(BaseModel):
    model_config = ConfigDict(extra='forbid',strict=True,frozen=True,allow_inf_nan=False)

    stage: Stage = 'unknown'
    reason: Reason = 'unclassified_failure'
    http_admitted: Count | None = None
    response_headers_received: Count | None = None
    evidence_reads: Annotated[StrictInt,Field(ge=0,le=1)] | None = None
    elapsed_ms: Annotated[float,Field(ge=0,le=86400000)] | None = None
    response_chars: Annotated[StrictInt,Field(ge=0,le=2147483647)] | None = None
    finish_reason: Literal['stop','length','tool_calls','content_filter'] | None = None
    json_line: Annotated[StrictInt,Field(ge=1,le=2147483647)] | None = None
    json_column: Annotated[StrictInt,Field(ge=1,le=2147483647)] | None = None
    schema_rule: SchemaRule | None = None
    schema_path: Annotated[tuple[SchemaToken,...],Field(max_length=32)] | None = None

    @model_validator(mode='after')
    def consistent_counts(self):
        if (self.http_admitted is not None and self.response_headers_received is not None
                and self.response_headers_received>self.http_admitted):
            raise ValueError('Response count exceeds admissions')
        return self


class ChronicleProviderError(ModelOutputError):
    def __init__(self,diagnostic:ProviderDiagnostic):
        self.diagnostic=ProviderDiagnostic.model_validate(diagnostic.model_dump())
        super().__init__('Chronicle provider rejected the result')


def safe_diagnostic(error:BaseException,*,stage:Stage='unknown')->ProviderDiagnostic:
    """Only validated typed snapshots cross this boundary; unknown content is ignored."""
    candidate=vars(error).get('diagnostic')
    if type(candidate) is ProviderDiagnostic:
        try: return ProviderDiagnostic.model_validate(candidate.model_dump())
        except ValidationError: pass
    try: return ProviderDiagnostic(stage=stage)
    except ValidationError: return ProviderDiagnostic()
