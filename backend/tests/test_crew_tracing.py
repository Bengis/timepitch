"""Crew tracing with an in-memory span exporter: identifiers and codes only, no text, never blocking the crew."""
from decimal import Decimal
import json

import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from crew_fixtures import CANARY, FIXED, LIVELY, PLAN, Harness, grant, offline, reply  # noqa: F401
from timepitch.crew.tracing import CrewTracer, read_connection, setup_tracing
from timepitch.crew.workflow import run_crew


def traced_run(offline, tmp_path, script, tracer):
    offline(script)
    h = Harness(tmp_path)

    async def go():
        try:
            runtime = h.runtime()
            runtime.tracer = tracer
            return await run_crew(runtime)
        finally:
            await h.close()
    return offline.run(go())


def test_no_connection_means_no_op(offline, tmp_path, monkeypatch):
    monkeypatch.delenv('TIMEPITCH_CREW_TRACE_CONNECTION', raising=False)
    tracer = setup_tracing(None)
    assert tracer.enabled is False
    report = traced_run(offline, tmp_path, [reply(PLAN), reply(LIVELY)], tracer)
    assert report.provenance == 'crew_ai_draft_checked'


def test_run_and_step_spans_carry_codes_not_text(offline, tmp_path):
    exporter = InMemorySpanExporter()
    tracer = setup_tracing(exporter=exporter, simple=True)
    assert tracer.enabled
    report = traced_run(offline, tmp_path, [reply(PLAN), reply(CANARY), reply(FIXED, request_id='req-fixed')], tracer)
    spans = [s for s in exporter.get_finished_spans() if s.name.startswith('crew.')]
    run = [s for s in spans if s.name == 'crew.run']
    assert len(run) == 1
    attrs = run[0].attributes
    assert attrs['crew.request_hash'] == report.source.request_hash and attrs['crew.outcome'] == 'crew_ai_draft_checked'
    assert attrs['crew.angle'] == 'narrow_win' and attrs['crew.version.writer_prompt'] == 'crew-writer-6'
    assert attrs['crew.version.agent-framework-core'] == '1.22.0'
    steps = [s.attributes for s in spans if s.name == 'crew.step']
    assert [(a['crew.role'], a['crew.code']) for a in steps] == [(s.role, s.code) for s in report.steps]
    names = next(a for a in steps if a['crew.role'] == 'fixer')
    assert names['crew.reason'] == 'names'  # crew-fixer-2 writes names as recorded first
    fixer = next(a for a in steps if a['crew.role'] == 'fixer' and a['crew.reason'] != 'names')
    assert list(fixer['crew.fixes']) == ['p1s1+result']
    revision = next(a for a in steps if a['crew.role'] == 'writer_revision')
    assert revision['crew.provider_request_id'] == 'req-fixed' and revision['crew.tokens.input'] == 900
    assert revision['crew.model'] == 'gpt-4.1-mini' and revision['crew.cost_usd'] > 0
    verifier = next(a for a in steps if a['crew.role'] == 'verifier')
    assert verifier['crew.reason'] == 'uncited_entity'
    # Every exported span (Agent Framework's own GenAI spans included) is free of prose, prompts and the key.
    texts = [CANARY['headline']['text'], FIXED['paragraphs'][0]['sentences'][0]['text'], 'synthetic-key',
             'Every proper noun must cite', 'fact_pack']
    for span in exporter.get_finished_spans():
        dumped = json.dumps({k: str(v) for k, v in (span.attributes or {}).items()}) + ''.join(
            json.dumps({k: str(v) for k, v in (e.attributes or {}).items()}) for e in span.events)
        assert not any(t in dumped for t in texts), span.name


def test_export_failure_never_stops_the_crew(offline, tmp_path):
    class Broken:
        def export(self, spans):
            raise RuntimeError('collector down')

        def shutdown(self):
            raise RuntimeError('collector down')

        def force_flush(self, timeout_millis=0):
            raise RuntimeError('collector down')
    tracer = setup_tracing(exporter=Broken(), simple=True)
    report = traced_run(offline, tmp_path, [reply(PLAN), reply(LIVELY)], tracer)
    assert report.provenance == 'crew_ai_draft_checked'
    tracer.shutdown()


def test_bad_connection_file_falls_back_to_no_op(tmp_path):
    bad = tmp_path / 'conn'
    bad.write_text('not a connection string')
    with pytest.raises(ValueError):
        read_connection(bad)
    assert setup_tracing(bad).enabled is False
    assert setup_tracing(tmp_path / 'missing').enabled is False


def test_connection_file_tolerates_bom_and_crlf(tmp_path):
    value = 'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.invalid/'
    for raw in (value.encode(), b'\xef\xbb\xbf' + value.encode() + b'\r\n', b'  ' + value.encode() + b'\n\n'):
        path = tmp_path / 'conn'
        path.write_bytes(raw)
        assert read_connection(path) == value
    for raw in (value.encode() + b'\nsecond line', 'InstrumentationKey=ñ'.encode()):
        path.write_bytes(raw)
        with pytest.raises(ValueError):
            read_connection(path)


def test_noop_tracer_accepts_every_call():
    tracer = CrewTracer()
    with tracer.span('crew.run', **{'crew.cost_usd': Decimal('0.1')}) as span:
        span.set_attributes({'crew.outcome': 'x'})
    tracer.flush()
    tracer.shutdown()
