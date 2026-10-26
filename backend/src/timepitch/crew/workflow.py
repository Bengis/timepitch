"""Agent Framework workflow: Analyst -> Writer -> Verifier -> switch(accept | revise | fallback).

At most three LLM calls per report (analyst, writer, one writer revision). Everything that
fails, refuses or is uncertain goes to the deterministic fallback; nothing is retried.
"""
from dataclasses import dataclass, field
from decimal import Decimal
import importlib.metadata
from typing import Any, Callable, Never

from agent_framework import Case, Default, Executor, WorkflowBuilder, WorkflowContext, handler

from ..chronicles.models import FactPack, Locale, fact_pack_hash
from ..chronicles.azure.validation import validate_draft
from .fallback import crew_fallback_text
from .checks import fix_citations, normalize_names
from .agents import (CrewAgents, SendGate, analyst_instructions, analyst_payload, analyst_schema,
                     parse_draft, parse_plan, planned_pack, verify, writer_instructions, writer_payload, writer_schema)
from .gated import gated_call
from .ledger import CrewLedger
from .tracing import CrewTracer
from .models import (CrewBinding, CrewGrant, CrewPlan, CrewReport, CrewSource, CrewStart, CrewState,
                     CrewStep, Draft, Verdict, crew_versions, digest, request_hash, seal_report)

STATE_KEY = 'crew_state'


def library_versions() -> dict[str, str]:
    names = ('agent-framework-core', 'agent-framework-openai', 'openai')
    return {name: importlib.metadata.version(name) for name in names}


@dataclass
class CrewRuntime:
    pack: FactPack
    locale: Locale
    binding: CrewBinding
    grant: CrewGrant
    grant_sha256: str | None
    ledger: CrewLedger
    gate: SendGate
    agents: CrewAgents | None
    tracer: CrewTracer = field(default_factory=CrewTracer)
    audience: str = 'fan'
    request_hash: str = field(init=False)

    def __post_init__(self):
        if self.locale not in self.grant.locales:
            raise ValueError('Locale outside envelope')
        self.request_hash = request_hash(fact_pack_hash(self.pack), self.locale, self.binding, self.audience)

    angle: str | None = None

    def add_step(self, state: CrewState, step: CrewStep) -> None:
        """Append a step to the shared state and emit its span (codes, tokens, cost; never text)."""
        state.steps.append(step)
        if state.plan is not None:
            self.angle = state.plan.angle
        with self.tracer.span('crew.step', **{
                'crew.request_hash': self.request_hash, 'crew.role': step.role, 'crew.code': step.code,
                'crew.reason': step.reason, 'crew.location': step.location, 'crew.fixes': step.fixes or None,
                'crew.model': step.model, 'crew.provider_request_id': step.request_id,
                'crew.tokens.input': step.input_tokens, 'crew.tokens.output': step.output_tokens,
                'crew.reserved_usd': step.reserved, 'crew.cost_usd': step.cost, 'crew.replayed': step.replayed}):
            pass

    async def llm_step(self, step: str, instructions: str, payload: dict, schema_name: str, schema: dict,
                       parse: Callable[[str], Any]) -> tuple[Any, CrewStep]:
        """One gated send, or a free replay of its receipt. Never resends an uncertain intent."""
        send = None if self.agents is None else (
            lambda: self.agents.run(step, instructions, payload, schema_name, schema))
        return await gated_call(ledger=self.ledger, gate=self.gate, binding=self.binding, tariff=self.grant.tariff,
                                tracer=self.tracer, request_hash=self.request_hash, step=step, send=send, parse=parse)


def _state(ctx) -> CrewState:
    return CrewState.model_validate(ctx.get_state(STATE_KEY))


def _save(ctx, state: CrewState):
    ctx.set_state(STATE_KEY, state.model_dump(mode='python'))


class AnalystExecutor(Executor):
    def __init__(self, runtime: CrewRuntime):
        super().__init__(id='analyst')
        self.rt = runtime

    @handler
    async def start(self, message: CrewStart, ctx: WorkflowContext[CrewPlan | Verdict]) -> None:
        state = CrewState(request_hash=message.request_hash)
        rt = self.rt
        plan, step = await rt.llm_step('analyst', analyst_instructions(), analyst_payload(rt.pack), 'crew_plan',
                                       analyst_schema(rt.pack), lambda text: parse_plan(rt.pack, text))
        rt.add_step(state, step)
        if plan is None:
            verdict = Verdict(decision='fallback', code=step.code, location='plan')
            state.verdicts.append(verdict)
            _save(ctx, state)
            await ctx.send_message(verdict)
            return
        state.plan = plan
        _save(ctx, state)
        await ctx.send_message(plan)


class WriterExecutor(Executor):
    def __init__(self, runtime: CrewRuntime):
        super().__init__(id='writer')
        self.rt = runtime

    async def _write(self, ctx, step: str, attempt: int, revision) -> None:
        state = _state(ctx)
        rt = self.rt
        draft, record = await rt.llm_step(step, writer_instructions(rt.locale, planned_pack(rt.pack, state.plan), rt.audience), writer_payload(rt.pack, state.plan, revision),
                                          'chronicle_prose', writer_schema(), lambda text: parse_draft(text, attempt))
        names = []
        if draft is not None:
            fixed, names = normalize_names(rt.pack, draft.draft)
            draft = draft.model_copy(update={'draft': fixed})
        if draft is not None and attempt == 2 and state.drafts and draft.draft == state.drafts[-1].draft:
            record = record.model_copy(update={'code': 'revision_noop'})
            draft = None
        rt.add_step(state, record)
        if draft is not None and names:
            rt.add_step(state, CrewStep(role='fixer', code='fixed', reason='names', fixes=names))
        if draft is None:
            verdict = Verdict(decision='fallback', code=record.code, location='draft', attempt=attempt)
            state.verdicts.append(verdict)
            _save(ctx, state)
            await ctx.send_message(verdict)
            return
        state.drafts.append(draft)
        _save(ctx, state)
        await ctx.send_message(draft)

    @handler
    async def first(self, plan: CrewPlan, ctx: WorkflowContext[Draft | Verdict]) -> None:
        await self._write(ctx, 'writer', 1, None)

    @handler
    async def revise(self, verdict: Verdict, ctx: WorkflowContext[Draft | Verdict]) -> None:
        state = _state(ctx)
        if verdict.decision != 'revise' or any(d.attempt == 2 for d in state.drafts):
            # Bounded loop: a second revision is impossible by construction.
            fallback = Verdict(decision='fallback', code='revision_exhausted', location='draft', attempt=2)
            state.verdicts.append(fallback)
            _save(ctx, state)
            await ctx.send_message(fallback)
            return
        await self._write(ctx, 'writer_revision', 2, (state.drafts[-1], verdict))


class VerifierExecutor(Executor):
    def __init__(self, runtime: CrewRuntime):
        super().__init__(id='verifier')
        self.rt = runtime

    @handler
    async def check(self, draft: Draft, ctx: WorkflowContext[Verdict]) -> None:
        state = _state(ctx)
        verdict = verify(self.rt.pack, state.plan, draft, self.rt.locale)
        state.verdicts.append(verdict)
        self.rt.add_step(state, CrewStep(role='verifier', code='accepted' if verdict.decision == 'accept' else 'rejected',
                                    reason=verdict.code, location=verdict.location))
        _save(ctx, state)
        await ctx.send_message(verdict)


class FixerExecutor(Executor):
    """Deterministic: adds only fact ids that literally support a failing claim, then re-verifies."""
    def __init__(self, runtime: CrewRuntime):
        super().__init__(id='fixer')
        self.rt = runtime

    @handler
    async def fix(self, verdict: Verdict, ctx: WorkflowContext[Draft]) -> None:
        state = _state(ctx)
        current = state.drafts[-1]
        fixed, fixes = fix_citations(self.rt.pack, state.plan, current.draft, [(f.code, f.location) for f in verdict.failures])
        draft = Draft(attempt=current.attempt, draft=fixed, fixed=True)
        state.drafts.append(draft)
        self.rt.add_step(state, CrewStep(role='fixer', code='fixed', reason=verdict.code, location=verdict.location, fixes=fixes))
        _save(ctx, state)
        await ctx.send_message(draft)


class PublisherExecutor(Executor):
    def __init__(self, runtime: CrewRuntime):
        super().__init__(id='publisher')
        self.rt = runtime

    @handler
    async def publish(self, verdict: Verdict, ctx: WorkflowContext[Never, CrewReport]) -> None:
        state = _state(ctx)
        rt = self.rt
        accepted = verdict.decision == 'accept' and state.drafts and state.drafts[-1].attempt == verdict.attempt
        provenance = 'crew_ai_draft_checked' if accepted else 'deterministic_fallback'
        fallback_text = None if accepted else crew_fallback_text(rt.pack, rt.locale)
        state.outcome = provenance
        rt.add_step(state, CrewStep(role='publisher', code=provenance, reason=verdict.code))
        _save(ctx, state)
        report = seal_report(CrewReport(
            source=CrewSource(engine=rt.pack.engine, trace_hash=rt.pack.trace_hash, fact_hash=fact_pack_hash(rt.pack),
                              dataset_version=rt.pack.dataset_version, binding_hash=digest(rt.binding),
                              grant_sha256=rt.grant_sha256, request_hash=rt.request_hash),
            locale=rt.locale, audience=rt.audience, versions={**crew_versions(), **library_versions()}, provenance=provenance,
            draft=state.drafts[-1].draft if accepted else None, fallback_text=fallback_text, steps=state.steps,
            coverage_notes=validate_draft(rt.pack, state.drafts[-1].draft, rt.locale).coverage_notes if accepted else [],
            total_cost=sum((s.cost for s in state.steps), Decimal(0))))
        rt.ledger.record_report(rt.request_hash, report.report_sha256, provenance)
        await ctx.yield_output(report)


def build_workflow(runtime: CrewRuntime):
    analyst, writer = AnalystExecutor(runtime), WriterExecutor(runtime)
    verifier, publisher = VerifierExecutor(runtime), PublisherExecutor(runtime)
    fixer = FixerExecutor(runtime)
    return (WorkflowBuilder(start_executor=analyst, name='timepitch-crew-1', max_iterations=16)
            .add_switch_case_edge_group(analyst, [Case(condition=lambda m: isinstance(m, CrewPlan), target=writer),
                                                  Default(target=publisher)])
            .add_switch_case_edge_group(writer, [Case(condition=lambda m: isinstance(m, Draft), target=verifier),
                                                 Default(target=publisher)])
            .add_switch_case_edge_group(verifier, [Case(condition=lambda v: v.decision == 'revise', target=writer),
                                                   Case(condition=lambda v: v.decision == 'fix', target=fixer),
                                                   Default(target=publisher)])
            .add_edge(fixer, verifier)
            .build())


async def run_crew(runtime: CrewRuntime) -> CrewReport:
    workflow = build_workflow(runtime)
    versions = {f'crew.version.{k}': v for k, v in {**crew_versions(), **library_versions()}.items()}
    with runtime.tracer.span('crew.run', **{'crew.request_hash': runtime.request_hash, 'crew.locale': runtime.locale,
                                           'crew.fact_hash': fact_pack_hash(runtime.pack), **versions}) as span:
        result = await workflow.run(CrewStart(request_hash=runtime.request_hash))
        outputs = [o for o in result.get_outputs() if isinstance(o, CrewReport)]
        if len(outputs) != 1:
            raise RuntimeError('Crew workflow did not publish exactly one report')
        report = outputs[0]
        span.set_attributes({'crew.angle': runtime.angle, 'crew.outcome': report.provenance,
                             'crew.report_sha256': report.report_sha256, 'crew.total_cost_usd': report.total_cost,
                             'crew.steps': len(report.steps)})
    runtime.tracer.flush()
    return report
