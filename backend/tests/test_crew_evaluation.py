"""Foundry evaluations with a mocked judge endpoint: one gated, ledgered attempt per judge metric; no network."""
from decimal import Decimal
import json

import httpx2
import pytest

from crew_fixtures import LIVELY, PLAN, Harness, grant, offline, reply, tp229_pack  # noqa: F401
from timepitch.crew import cli
from timepitch.crew.agents import SendGate, bounded_client
from timepitch.crew.evaluation import (CODE_EVALUATORS, bounded_sdk, context_of, evaluate_report, judge_evaluators,
                                       log_to_project, seal_results)
from timepitch.crew.ledger import CrewLedger
from timepitch.crew.models import default_binding
from timepitch.crew.tracing import CrewTracer
from timepitch.crew.workflow import run_crew

JUDGE_URL = 'https://timepitch-ai.openai.azure.com/openai/v1/chat/completions'


class FakeJudge:
    """Scripted chat-completions judge; records every request that reaches the transport."""

    def __init__(self, script):
        self.script, self.requests = list(script), []

    async def respond(self, request):
        assert str(request.url) == JUDGE_URL
        body = json.loads(request.content)
        self.requests.append(body)
        if not self.script:
            pytest.fail('Unexpected extra judge request')
        item = self.script.pop(0)
        if item == 'http_500':
            return httpx2.Response(500, json={'error': {'message': 'synthetic'}}, headers={'x-request-id': 'j500'})
        if item == 'timeout':
            raise httpx2.ReadTimeout('synthetic lost judge response', request=request)
        score, model = item if isinstance(item, tuple) else (item, 'gpt-4.1-mini-2025-04-14')
        n = len(self.requests)
        return httpx2.Response(200, json={'id': f'chat-{n}', 'object': 'chat.completion', 'created': 0, 'model': model,
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant',
                'content': json.dumps({'explanation': 'synthetic judge reason', 'score': score})}}],
            'usage': {'prompt_tokens': 1500, 'completion_tokens': 60, 'total_tokens': 1560}},
            headers={'x-request-id': f'judge-{n}'})


def crew_report(offline, tmp_path):
    offline([reply(PLAN), reply(LIVELY)])
    h = Harness(tmp_path, ledger_name='crew.sqlite')

    async def go():
        try:
            return await run_crew(h.runtime())
        finally:
            await h.close()
    return offline.run(go())


class Judge:
    def __init__(self, tmp_path, g=None, name='eval.sqlite'):
        from crew_fixtures import NOW
        self.grant = g or grant(purpose='evaluation', money_limit=Decimal('0.10'))
        self.ledger = CrewLedger(tmp_path / name, self.grant, 'd' * 64, now=lambda: NOW)
        self.gate = SendGate(self.ledger)
        self.client = bounded_client(default_binding(), 'synthetic-judge-key', self.gate)

    def run(self, offline, report, pack=None, tracer=None):
        async def go():
            try:
                with bounded_sdk(self.client._client):
                    return await evaluate_report(report=report, pack=pack or tp229_pack(), binding=default_binding(),
                                                 grant=self.grant, ledger=self.ledger, gate=self.gate,
                                                 tracer=tracer or CrewTracer(),
                                                 evaluators=judge_evaluators(default_binding(), 'synthetic-judge-key'))
            finally:
                await self.client.close()
        return offline.run(go())


def test_three_judge_calls_one_attempt_each_and_code_evaluators(offline, tmp_path):
    report = crew_report(offline, tmp_path)
    fake = offline(FakeJudge([5, 4, 4]))
    j = Judge(tmp_path)
    row = j.run(offline, report)
    assert len(fake.requests) == 3 == j.gate.admitted
    assert all(b['model'] == 'gpt-4.1-mini' and b['max_tokens'] <= 1024 for b in fake.requests)
    assert [s['role'] for s in row['steps']] == ['judge_groundedness', 'judge_coherence', 'judge_fluency']
    assert all(s['code'] == 'ok' and s['model'] == 'gpt-4.1-mini-2025-04-14' for s in row['steps'])
    assert row['metrics']['groundedness']['score'] == 5 and row['metrics']['fluency']['score'] == 4
    assert {k: row['metrics'][k][k] for k in ('citations_ok', 'numbers_match_facts', 'names_as_recorded')} == {
        'citations_ok': 1, 'numbers_match_facts': 1, 'names_as_recorded': 1}
    assert Decimal(row['cost']) == sum(Decimal(s['cost']) for s in row['steps']) > 0
    # The groundedness context is the cited facts' text; prompts and completions are never stored.
    grounded = fake.requests[0]['messages'][-1]['content']
    assert "At 27:14, goal by Steven N'Zonzi, credited to Blackburn Rovers." in grounded
    dumped = json.dumps(row)
    assert 'sample_input' not in dumped and 'sample_output' not in dumped and 'synthetic-judge-key' not in dumped


def test_judge_failures_are_not_retried_and_are_charged(offline, tmp_path):
    report = crew_report(offline, tmp_path)
    fake = offline(FakeJudge(['http_500', 'timeout', (4, 'gpt-4.1')]))
    j = Judge(tmp_path)
    row = j.run(offline, report)
    assert len(fake.requests) == 3  # the SDK's own retry loop is disabled: one attempt per metric
    assert [s['code'] for s in row['steps']] == ['provider_error', 'uncertain_send', 'model_mismatch']
    assert all(Decimal(s['cost']) > 0 for s in row['steps'])
    # Resume: receipts replay free, the uncertain intent is never resent.
    again = offline(FakeJudge([]))
    j2 = Judge(tmp_path)
    row2 = j2.run(offline, report)
    assert again.requests == [] and [s['code'] for s in row2['steps']] == ['provider_error', 'uncertain_send', 'model_mismatch']


def test_resume_replays_judge_receipts_at_no_cost(offline, tmp_path):
    report = crew_report(offline, tmp_path)
    offline(FakeJudge([5, 4, 4]))
    first = Judge(tmp_path).run(offline, report)
    nothing = offline(FakeJudge([]))
    j = Judge(tmp_path)
    exposure = j.ledger.exposure()
    second = j.run(offline, report)
    assert nothing.requests == [] and j.ledger.exposure() == exposure
    assert second['metrics']['groundedness'] == first['metrics']['groundedness']


def test_evaluation_envelope_limits_refuse_before_send(offline, tmp_path):
    report = crew_report(offline, tmp_path)
    fake = offline(FakeJudge([]))
    j = Judge(tmp_path, grant(purpose='evaluation', money_limit=Decimal('0.001')))
    row = j.run(offline, report)
    assert fake.requests == [] and {s['reason'] for s in row['steps']} == {'money_exhausted'}


def test_results_are_sealed_and_can_be_logged_to_a_project(offline, tmp_path):
    report = crew_report(offline, tmp_path)
    offline(FakeJudge([5, 4, 4]))
    row = Judge(tmp_path).run(offline, report)
    results = seal_results([row], default_binding(), 'd' * 64)
    assert len(results['results_sha256']) == 64 and results['versions']['azure-ai-evaluation'] == '1.18.10'
    captured = {}
    log_to_project(results, 'https://timepitch-ai.services.ai.azure.com/api/projects/proj-default',
                   evaluate=lambda **kw: captured.update(kw, rows=open(kw['data'], encoding='utf-8').read()))
    assert captured['azure_ai_project'].endswith('/proj-default') and 'timepitch' in captured['evaluators']
    assert '"groundedness": 5' in captured['rows']


def test_real_sdk_evaluate_runs_locally_on_the_sealed_tp232_rows(tmp_path):
    # The SDK's own evaluate(), no project and no model: the pass-through evaluator maps named columns.
    from pathlib import Path
    from hashlib import sha256
    sealed = Path(__file__).resolve().parents[2] / 'research' / 'engine-evaluation' / '2026-10-24-azure-chronicle-staging' / 'tp232-evaluation-results.json'
    raw = sealed.read_bytes()
    assert sha256(raw).hexdigest() == '11d5b81e71456338c223740bcdc5842730379e2b301b58aeecf59850ad78d381'
    results = json.loads(raw)
    out = log_to_project(results, None, output_path=tmp_path / 'local-eval.json')
    rows = out['rows']
    assert [r['outputs.timepitch.groundedness'] for r in rows] == [5.0, 5.0]
    assert [r['outputs.timepitch.coherence'] for r in rows] == [4.0, 5.0]
    assert [r['outputs.timepitch.names_as_recorded'] for r in rows] == [1, 1]
    assert out['metrics']['timepitch.groundedness'] == 5.0


def test_code_evaluators_flag_the_tp230c_style_draft():
    from crew_fixtures import CANARY
    from timepitch.crew.models import CrewReport, CrewSource, seal_report
    from timepitch.chronicles.azure.models import ChronicleDraft
    from timepitch.chronicles.models import fact_pack_hash
    pack = tp229_pack()
    report = seal_report(CrewReport(source=CrewSource(engine='grf', trace_hash=pack.trace_hash, fact_hash=fact_pack_hash(pack),
        dataset_version=pack.dataset_version, binding_hash='0' * 64, grant_sha256=None, request_hash='1' * 64),
        locale='en', versions={}, provenance='crew_ai_draft_checked', draft=ChronicleDraft.model_validate(CANARY),
        steps=[], total_cost=Decimal(0)))
    results = {e.name: e(report=report, pack=pack) for e in CODE_EVALUATORS}
    assert results['citations_ok']['citations_ok'] == 0 and 'uncited_entity@headline' in results['citations_ok']['citations_ok_failures']
    assert results['numbers_match_facts']['numbers_match_facts'] == 0  # "1-0" in a sentence without result
    assert results['names_as_recorded']['names_as_recorded'] == 0  # "United's"
    assert 'Final recorded score' in context_of(report, pack)


def test_cli_evaluate_refuses_a_crew_envelope(tmp_path, capsys):
    g = grant()
    env = tmp_path / 'envelope.json'
    env.write_bytes(g.model_dump_json().encode())
    args = ['evaluate', '--pair', str(tmp_path / 'r.json'), str(tmp_path / 'p.json'), '--envelope', str(env),
            '--credential', str(tmp_path / 'k'), '--ledger', str(tmp_path / 'l.sqlite'), '--out', str(tmp_path / 'o.json')]
    import timepitch.crew.ledger as ledger
    original = ledger.load_grant
    try:
        cli.load_grant = lambda *a, **k: (g, 'e' * 64)
        assert cli.main(args) == 2
    finally:
        cli.load_grant = original
    assert 'envelope_purpose' in capsys.readouterr().err
