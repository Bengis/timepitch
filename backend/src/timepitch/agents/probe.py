"""Explicit, synthetic-evidence probe of the prepared local model. No silent downloads."""
import asyncio
from importlib.metadata import version
import json
from pathlib import Path
from time import perf_counter

from pydantic import BaseModel, ConfigDict

from .provider import FoundryTransport, LocalModelProvider
from ..config import ROOT
from ..runtime import RuntimeLease


class ProbeEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    event_id: str
    home_goals: int
    away_goals: int


class ModelProbeResult(BaseModel):
    state: str = 'failed'
    model_alias: str = 'qwen2.5-1.5b'
    model_id: str | None = None
    model_version: str | None = None
    device: str = 'GPU'
    structured_json: bool = False
    tool_calling: bool = False
    tool_calls: int = 0
    latency_ms: dict[str, float] = {}
    package_versions: dict[str, str] = {}
    error_type: str | None = None


async def probe_local_model(model: str = 'qwen2.5-1.5b', device: str = 'GPU') -> ModelProbeResult:
    with RuntimeLease(ROOT/'.local/inference.lock'):
        return await _probe_local_model(model,device)


async def _probe_local_model(model: str, device: str) -> ModelProbeResult:
    result = ModelProbeResult(model_alias=model, device=device,
        package_versions={name: version(name) for name in ('agent-framework-core', 'agent-framework-foundry-local', 'foundry-local-sdk', 'httpx')})
    try:
        transport = FoundryTransport(model, device)
        from foundry_local.models import DeviceType
        model_info = transport.client.manager.get_model_info(model, device=DeviceType(device))
        result.model_id, result.model_version = model_info.id, model_info.version
        provider = LocalModelProvider(transport)
        expected = {'event_id': 'probe-shot-1', 'home_goals': 1, 'away_goals': 0}
        started = perf_counter()
        structured = await provider.generate([
            {'role': 'system', 'content': 'Return only the requested JSON object, with no commentary.'},
            {'role': 'user', 'content': 'Use exactly this synthetic recorded fact: ' + json.dumps(expected)},
        ], ProbeEvidence.model_json_schema())
        result.latency_ms['structured'] = round((perf_counter() - started) * 1000, 1)
        result.structured_json = structured == expected

        if model_info.supports_tool_calling:
            from agent_framework import Agent

            def get_probe_event() -> str:
                """Read the one synthetic event that this capability probe may access."""
                result.tool_calls += 1
                return json.dumps(expected)

            agent = Agent(client=transport.client, name='TimePitchCapabilityProbe',
                instructions='Call get_probe_event to read the recorded event. Use only its result. Return the requested JSON; never guess the event id or score.',
                tools=[get_probe_event], default_options={'max_tokens': 512, 'temperature': 0})
            started = perf_counter()
            response = await asyncio.wait_for(agent.run('Read the probe event using the available tool, then report the event id and score.'), timeout=30)
            result.latency_ms['tool_workflow'] = round((perf_counter() - started) * 1000, 1)
            result.tool_calling = result.tool_calls == 1 and expected['event_id'] in response.text
        result.state = 'ready' if result.structured_json and result.tool_calling else 'capability_incomplete'
    except Exception as error:
        result.error_type = type(error).__name__  # No raw URLs, configuration or secrets in saved diagnostics.
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default='qwen2.5-1.5b')
    parser.add_argument('--device', choices=['CPU', 'GPU'], default='GPU')
    args = parser.parse_args()
    result = asyncio.run(probe_local_model(args.model, args.device))
    destination = ROOT / '.local/model-probe.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(result.model_dump_json(indent=2), encoding='utf-8')
    print(result.model_dump_json(indent=2))
    raise SystemExit(0 if result.state == 'ready' else 1)


if __name__ == '__main__':
    main()
