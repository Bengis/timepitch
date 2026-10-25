"""Optional OpenTelemetry tracing for the crew, exported to Application Insights.

Off unless a private connection-string file is given (flag or TIMEPITCH_CREW_TRACE_CONNECTION).
Spans carry identifiers, verdict codes, tokens, cost, model and request ids only: never prompt or
completion text and never the connection string. Agent Framework's own GenAI instrumentation is
used with sensitive data off. Any setup or export failure leaves the crew running untraced.
"""
from contextlib import contextmanager
from decimal import Decimal
import logging
import os
from pathlib import Path
import stat

log = logging.getLogger(__name__)
ENV = 'TIMEPITCH_CREW_TRACE_CONNECTION'
SERVICE = 'timepitch-crew'
# Attribute keys that may carry model input/output; dropped before export as a second guard.
_SENSITIVE = ('messages', 'instructions', 'tool.definitions', 'content', 'connection', 'text', 'sample_')


class _NoopSpan:
    def set_attribute(self, *_):
        pass

    def set_attributes(self, *_):
        pass

    def record_exception(self, *_):
        pass


class CrewTracer:
    """Thin wrapper: a real OTel tracer when configured, otherwise a no-op with the same calls."""

    def __init__(self, tracer=None, provider=None):
        self._tracer, self._provider = tracer, provider

    @property
    def enabled(self) -> bool:
        return self._tracer is not None

    @contextmanager
    def span(self, name: str, **attributes):
        if self._tracer is None:
            yield _NoopSpan()
            return
        try:
            cm = self._tracer.start_as_current_span(name, attributes=clean(attributes))
            span = cm.__enter__()
        except Exception:  # tracing must never stop the crew
            log.warning('Tracing span could not start')
            yield _NoopSpan()
            return
        try:
            yield _SafeSpan(span)
        finally:
            try:
                cm.__exit__(None, None, None)
            except Exception:
                log.warning('Tracing span could not end')

    def flush(self, timeout_ms: int = 10000):
        if self._provider is not None:
            try:
                self._provider.force_flush(timeout_ms)
            except Exception:
                log.warning('Tracing flush failed; the crew result is unaffected')

    def shutdown(self):
        if self._provider is not None:
            try:
                self._provider.shutdown()
            except Exception:
                log.warning('Tracing shutdown failed; the crew result is unaffected')


class _SafeSpan:
    def __init__(self, span):
        self._span = span

    def set_attributes(self, attributes: dict):
        try:
            self._span.set_attributes(clean(attributes))
        except Exception:
            log.warning('Tracing attributes dropped')

    def set_attribute(self, key, value):
        self.set_attributes({key: value})


def clean(attributes: dict) -> dict:
    """OTel-safe scalar attributes; drops None and anything that looks like model text."""
    out = {}
    for key, value in attributes.items():
        if value is None or any(word in key.lower() for word in _SENSITIVE):
            continue
        if isinstance(value, Decimal):
            value = float(value)
        if isinstance(value, (list, tuple)):
            value = [str(v) for v in value]
        elif not isinstance(value, (str, bool, int, float)):
            value = str(value)
        out[key] = value
    return out


class RedactingExporter:
    """Wraps an exporter and strips sensitive-looking attributes from every span (AF spans included)."""

    def __init__(self, inner):
        self.inner = inner

    def export(self, spans):
        from opentelemetry.sdk.trace import ReadableSpan
        safe = []
        for span in spans:
            attrs = {k: v for k, v in (span.attributes or {}).items()
                     if not any(word in k.lower() for word in _SENSITIVE)}
            safe.append(ReadableSpan(name=span.name, context=span.context, parent=span.parent, resource=span.resource,
                                     attributes=attrs, events=(), links=span.links, kind=span.kind, status=span.status,
                                     start_time=span.start_time, end_time=span.end_time,
                                     instrumentation_scope=span.instrumentation_scope))
        try:
            return self.inner.export(safe)
        except Exception:
            log.warning('Trace export failed; the crew result is unaffected')
            from opentelemetry.sdk.trace.export import SpanExportResult
            return SpanExportResult.FAILURE

    def shutdown(self):
        try:
            self.inner.shutdown()
        except Exception:
            pass

    def force_flush(self, timeout_millis: int = 30000):
        try:
            return self.inner.force_flush(timeout_millis)
        except Exception:
            return False


def read_connection(path: Path) -> str:
    path = Path(path)
    if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):
        raise ValueError('Trace connection must be a private file')
    if os.name != 'nt' and path.stat().st_mode & 0o077:
        raise ValueError('Trace connection permissions are not private')
    raw = path.read_bytes()[:4097]
    if len(raw) > 4096:
        raise ValueError('Trace connection exceeds bound')
    # Tolerate a UTF-8 byte-order mark and surrounding whitespace/CRLF (e.g. a file written by a PowerShell pipe).
    value = raw.decode('utf-8-sig').strip()
    if (not value.isascii() or 'InstrumentationKey=' not in value
            or any(c in value for c in '\r\n')):
        raise ValueError('Trace connection unavailable')
    return value


def setup_tracing(connection_file: Path | None = None, *, exporter=None, simple: bool = False) -> CrewTracer:
    """Real tracer with a test exporter or an App Insights file; otherwise a no-op. Never raises."""
    connection_file = connection_file or (Path(os.environ[ENV]) if os.environ.get(ENV) else None)
    if exporter is None and connection_file is None:
        return CrewTracer()
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor
        if exporter is None:
            from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
            exporter = AzureMonitorTraceExporter(connection_string=read_connection(connection_file))
            simple = False
        provider = TracerProvider(resource=Resource.create({'service.name': SERVICE}))
        processor = SimpleSpanProcessor if simple else BatchSpanProcessor
        provider.add_span_processor(processor(RedactingExporter(exporter)))
        _agent_framework_spans(provider)
        return CrewTracer(provider.get_tracer('timepitch.crew'), provider)
    except Exception:
        log.warning('Tracing unavailable; the crew runs untraced')
        return CrewTracer()


def _agent_framework_spans(provider):
    """Route Agent Framework's built-in GenAI spans to the same provider, with sensitive data off."""
    try:
        from opentelemetry import trace
        from agent_framework.observability import enable_instrumentation
        enable_instrumentation(enable_sensitive_data=False, enable_message_events=False)
        if isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider):
            trace.set_tracer_provider(provider)
    except Exception:
        log.warning('Agent Framework instrumentation unavailable')
