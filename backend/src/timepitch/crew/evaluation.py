"""Foundry evaluations of CrewReports (crew-eval-1).

Judge metrics come from the Azure AI Evaluation SDK (Groundedness against the cited facts' text,
Coherence and Fluency for the prose) with the gpt-4.1-mini deployment as judge. Each judge call is
one ledgered, gated request under an 'evaluation' envelope: the SDK's own retry loop is disabled
and its OpenAI client is given the crew's bounded, gated HTTP client. Deterministic checks are
wrapped as custom code evaluators. Results go to a local, content-addressed JSON file; optionally
they can be logged to the Foundry project with an Entra identity (no extra judge calls).
"""
from contextlib import contextmanager
from decimal import Decimal
from functools import partialmethod
from hashlib import sha256
import importlib.metadata
import json

from ..chronicles.azure.validation import locate_all_rejections
from ..chronicles.models import FactPack, fact_pack_hash
from .agents import AgentResult, fallback_selection
from .checks import name_failure, sentences
from .gated import gated_call
from .models import EVALUATION_VERSION, CrewBinding, CrewReport, digest, verify_report

JUDGES = ('groundedness', 'coherence', 'fluency')
QUERY = ('Write a short, lively match report of this saved football simulation using only the recorded facts, '
         'with full recorded names and no invented facts.')
_CITATION = {'uncited_entity', 'unknown_entity', 'unknown_fact_reference', 'result_reference_required', 'unsupported_metric'}
_NUMBERS = {'unsupported_number', 'unsupported_score', 'unsupported_clock', 'unsupported_number_format'}
_KEEP = ('score', 'result', 'threshold', 'reason')


# ---- inputs -----------------------------------------------------------------------------------

def prose_of(report: CrewReport) -> str:
    if report.draft is not None:
        d = report.draft
        return '\n\n'.join([d.headline.text, *(' '.join(s.text for s in p.sentences) for p in d.paragraphs)])
    return report.fallback_text


def cited_ids(report: CrewReport, pack: FactPack) -> list[str]:
    if report.draft is not None:
        ids = [i for _, s in sentences(report.draft) for i in s.fact_ids]
    else:
        selection = fallback_selection(pack)
        ids = [*selection.headline.fact_ids, *(i for p in selection.paragraphs for i in p.fact_ids)]
    return list(dict.fromkeys(ids))


def _clock(ms):
    return f'{ms // 60000:02d}:{ms // 1000 % 60:02d}'


def fact_text(pack: FactPack, fact) -> str:
    team = {'home': pack.home_name, 'away': pack.away_name}
    if fact.kind == 'result':
        return f'Final recorded score of the simulation: {pack.home_name} {pack.score[0]}–{pack.score[1]} {pack.away_name}.'
    if fact.kind == 'coverage':
        return 'Coverage: events complete.' if pack.coverage.events_complete else 'Coverage: event coverage is incomplete.'
    if fact.kind == 'goal':
        who = ', '.join(fact.player_names) or 'an unresolved scorer'
        kind = 'own goal by' if fact.own_goal else 'goal by'
        return f'At {_clock(fact.time_ms or 0)}, {kind} {who}, credited to {team.get(fact.side, "an unresolved team")}.'
    if fact.kind == 'actor_stat':
        return f'Recorded leader in {fact.metric_id}: {", ".join(fact.player_names)} with {fact.value:g}.'
    if fact.kind == 'team_compare':
        unit = '%' if fact.unit == 'percent' else ''
        return (f'{fact.metric_id} ({fact.availability}): {pack.home_name} {fact.value:g}{unit}, '
                f'{pack.away_name} {fact.comparison_value:g}{unit}.')
    return f'{fact.id}.'


def context_of(report: CrewReport, pack: FactPack) -> str:
    facts = {f.id: f for f in pack.facts}
    return '\n'.join(fact_text(pack, facts[i]) for i in cited_ids(report, pack) if i in facts)


# ---- deterministic checks as custom code evaluators -------------------------------------------

class _CodeEvaluator:
    """Callable(report, pack) -> {name: 1|0|None, name_failures: [...]}, the SDK's code-evaluator shape."""
    name = ''
    codes: set = set()

    def __call__(self, *, report: CrewReport, pack: FactPack) -> dict:
        if report.draft is None:
            return {self.name: None, f'{self.name}_result': 'not_applicable'}
        failures = self.failures(report, pack)
        return {self.name: 0 if failures else 1, f'{self.name}_result': 'fail' if failures else 'pass',
                f'{self.name}_failures': failures}

    def failures(self, report, pack):
        return [f'{c}@{w}' for c, w in locate_all_rejections(pack, report.draft, report.locale) if c in self.codes]


class CitationsOk(_CodeEvaluator):
    name, codes = 'citations_ok', _CITATION


class NumbersMatchFacts(_CodeEvaluator):
    name, codes = 'numbers_match_facts', _NUMBERS


class NamesAsRecorded(_CodeEvaluator):
    name = 'names_as_recorded'

    def failures(self, report, pack):
        out = []
        for where, s in sentences(report.draft):
            if name_failure(pack, s.text):
                out.append(f'name_not_as_recorded@{where}')
        return out


CODE_EVALUATORS = (CitationsOk(), NumbersMatchFacts(), NamesAsRecorded())


# ---- judge (Azure AI Evaluation SDK) ----------------------------------------------------------

def evaluation_hash(report: CrewReport, binding: CrewBinding) -> str:
    raw = json.dumps({'report': report.report_sha256, 'version': EVALUATION_VERSION, 'deployment': binding.deployment,
                      'expected_model': binding.expected_model, 'judges': list(JUDGES)}, sort_keys=True).encode()
    return sha256(raw).hexdigest()


@contextmanager
def bounded_sdk(http_client):
    """Inside the block the SDK's prompty runtime uses our gated client and makes exactly one attempt."""
    import azure.ai.evaluation._legacy.prompty._prompty as prompty
    original_client, original_send = prompty.AsyncOpenAI, prompty.AsyncPrompty._send_with_retries

    def client(**kwargs):
        kwargs['http_client'] = http_client
        kwargs['max_retries'] = 0
        return original_client(**kwargs)
    prompty.AsyncOpenAI = client
    prompty.AsyncPrompty._send_with_retries = partialmethod(original_send, max_retries=0, max_entity_retries=0)
    try:
        yield
    finally:
        prompty.AsyncOpenAI, prompty.AsyncPrompty._send_with_retries = original_client, original_send


def judge_evaluators(binding: CrewBinding, key: str) -> dict:
    from azure.ai.evaluation import CoherenceEvaluator, FluencyEvaluator, GroundednessEvaluator, OpenAIModelConfiguration
    config = OpenAIModelConfiguration(type='openai', base_url=binding.endpoint, api_key=key, model=binding.deployment)
    return {'groundedness': GroundednessEvaluator(config), 'coherence': CoherenceEvaluator(config),
            'fluency': FluencyEvaluator(config)}


def _judge_kwargs(metric: str, report: CrewReport, pack: FactPack) -> dict:
    if metric == 'groundedness':
        return {'response': prose_of(report), 'context': context_of(report, pack)}
    if metric == 'coherence':
        return {'query': QUERY, 'response': prose_of(report)}
    return {'response': prose_of(report)}


def _sanitize(metric: str, raw: dict) -> tuple[str, AgentResult]:
    """Keep score/result/threshold/reason; drop the SDK's sample_input/sample_output (prompt and completion)."""
    props = raw.get(f'{metric}_properties') or {}
    kept = {k: raw.get(f'{metric}_{k}') for k in _KEEP}
    kept['score'] = raw.get(metric, kept['score'])
    text = json.dumps(kept, sort_keys=True, ensure_ascii=False, default=str)
    return text, AgentResult(text=text, model=props.get('model'),
                             input_tokens=props.get('prompt_tokens'), output_tokens=props.get('completion_tokens'))


async def evaluate_report(*, report: CrewReport, pack: FactPack, binding: CrewBinding, grant, ledger, gate, tracer,
                          evaluators: dict | None) -> dict:
    if not verify_report(report):
        raise ValueError('Report hash does not verify')
    if report.source.fact_hash != fact_pack_hash(pack):
        raise ValueError('Fact pack is not the report source')
    rh = evaluation_hash(report, binding)
    metrics, steps = {}, []
    with tracer.span('crew.evaluate', **{'crew.report_sha256': report.report_sha256, 'crew.evaluation_hash': rh,
                                         'crew.provenance': report.provenance}) as span:
        for metric in JUDGES:
            evaluator = None if evaluators is None else evaluators[metric]

            async def send(metric=metric, evaluator=evaluator):
                raw = await evaluator._to_async()(**_judge_kwargs(metric, report, pack))
                return _sanitize(metric, raw)[1]
            value, step = await gated_call(ledger=ledger, gate=gate, binding=binding, tariff=grant.tariff, tracer=tracer,
                                           request_hash=rh, step=f'judge_{metric}',
                                           send=None if evaluator is None else send, parse=json.loads)
            metrics[metric] = value if value is not None else {'score': None, 'result': step.code}
            steps.append(step)
            with tracer.span('crew.step', **{'crew.role': step.role, 'crew.code': step.code, 'crew.model': step.model,
                                             'crew.provider_request_id': step.request_id,
                                             'crew.tokens.input': step.input_tokens, 'crew.tokens.output': step.output_tokens,
                                             'crew.cost_usd': step.cost, 'crew.replayed': step.replayed,
                                             f'crew.eval.{metric}.score': metrics[metric].get('score')}):
                pass
        for code_evaluator in CODE_EVALUATORS:
            metrics[code_evaluator.name] = code_evaluator(report=report, pack=pack)
        span.set_attributes({f'crew.eval.{k}': (v.get('score') if 'score' in v else v.get(k))
                             for k, v in metrics.items()})
    return {'report_sha256': report.report_sha256, 'provenance': report.provenance, 'evaluation_hash': rh,
            'locale': report.locale, 'metrics': metrics, 'steps': [s.model_dump(mode='json') for s in steps],
            'cost': str(sum((s.cost for s in steps), Decimal(0)))}


def seal_results(rows: list[dict], binding: CrewBinding, grant_sha256: str | None) -> dict:
    versions = {'evaluation': EVALUATION_VERSION}
    for name in ('azure-ai-evaluation', 'agent-framework-core', 'openai'):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = 'not-installed'
    body = {'versions': versions, 'judge': {'deployment': binding.deployment, 'binding_hash': digest(binding),
            'accepted_models': sorted(binding.accepted_models)}, 'grant_sha256': grant_sha256, 'rows': rows,
            'total_cost': str(sum((Decimal(r['cost']) for r in rows), Decimal(0)))}
    body['results_sha256'] = sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return body


UPLOAD_METRICS = (*JUDGES, 'citations_ok', 'numbers_match_facts', 'names_as_recorded')


def precomputed(*, groundedness=None, coherence=None, fluency=None, citations_ok=None, numbers_match_facts=None,
                names_as_recorded=None) -> dict:
    """Pass-through code evaluator: returns scores already computed and sealed (no model call).

    The SDK maps data columns to *named* parameters, so every metric is an explicit keyword.
    """
    values = dict(groundedness=groundedness, coherence=coherence, fluency=fluency, citations_ok=citations_ok,
                  numbers_match_facts=numbers_match_facts, names_as_recorded=names_as_recorded)
    return {k: v for k, v in values.items() if v is not None}


def upload_rows(results: dict) -> list[dict]:
    rows = []
    for r in results['rows']:
        row = {'report_sha256': r['report_sha256'], 'provenance': r['provenance']}
        for metric in UPLOAD_METRICS:
            value = r['metrics'].get(metric, {})
            row[metric] = value.get('score') if metric in JUDGES else value.get(metric)
        rows.append(row)
    return rows


def log_to_project(results: dict, project_endpoint: str | None, *, evaluate=None, credential=None,
                   output_path=None) -> dict:
    """Run the SDK's evaluate() over the sealed rows with the pass-through evaluator and, when a project
    endpoint is given, log it as a Foundry evaluation run (needs an Entra identity; no judge calls)."""
    if evaluate is None:
        from azure.ai.evaluation import evaluate
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / 'rows.jsonl'
        data.write_text('\n'.join(json.dumps(row) for row in upload_rows(results)), encoding='utf-8')
        kwargs = {'data': str(data), 'evaluators': {'timepitch': precomputed},
                  'evaluator_config': {'timepitch': {'column_mapping': {m: '${data.' + m + '}' for m in UPLOAD_METRICS}}},
                  'evaluation_name': 'timepitch-crew-' + results['results_sha256'][:12]}
        if project_endpoint:
            kwargs['azure_ai_project'] = project_endpoint
        if credential is not None:
            kwargs['credential'] = credential
        if output_path is not None:
            kwargs['output_path'] = str(output_path)
        return evaluate(**kwargs)
