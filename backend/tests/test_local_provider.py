"""Local inference must validate output, respect timeout and never overlap on GPU."""
import asyncio
import json
import pytest

from timepitch.agents.provider import LocalModelProvider, LocalModelTimeout, ModelOutputError

SCHEMA = {'type': 'object', 'properties': {'event_id': {'type': 'string'}},
          'required': ['event_id'], 'additionalProperties': False}
MESSAGES = [{'role': 'user', 'content': 'Return the recorded event id.'}]


class RecordedTransport:
    endpoint = 'http://127.0.0.1:54321/v1'

    def __init__(self, text='{"event_id":"e1"}', delay=0):
        self.text, self.delay = text, delay
        self.active = self.peak = self.calls = 0
        self.finished = 0

    async def complete(self, messages, schema):
        self.calls += 1
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            await asyncio.sleep(self.delay)
            return self.text
        finally:
            self.active -= 1
            self.finished += 1


def test_validated_json_is_returned_without_a_cloud_call():
    async def run():
        transport = RecordedTransport()
        result = await LocalModelProvider(transport).generate(MESSAGES, SCHEMA)
        assert result == {'event_id': 'e1'}
        assert transport.calls == transport.finished == 1
    asyncio.run(run())


@pytest.mark.parametrize('text', ['not JSON', '{"event_id":2}', '{"event_id":"e1","invented":true}', '[]'])
def test_invalid_or_unexpected_output_is_rejected(text):
    async def run():
        with pytest.raises(ModelOutputError):
            await LocalModelProvider(RecordedTransport(text)).generate(MESSAGES, SCHEMA)
    asyncio.run(run())


def test_concurrent_requests_are_serialized():
    async def run():
        transport = RecordedTransport(delay=0.02)
        provider = LocalModelProvider(transport)
        results = await asyncio.gather(*(provider.generate(MESSAGES, SCHEMA) for _ in range(3)))
        assert len(results) == 3
        assert transport.peak == 1
        assert transport.finished == 3
    asyncio.run(run())


def test_timeout_returns_but_does_not_release_gpu_until_actual_completion():
    async def run():
        transport = RecordedTransport(delay=0.05)
        provider = LocalModelProvider(transport)
        with pytest.raises(LocalModelTimeout):
            await provider.generate(MESSAGES, SCHEMA, timeout_s=0.005)
        assert transport.active == 1
        result = await provider.generate(MESSAGES, SCHEMA, timeout_s=0.3)
        assert result == {'event_id': 'e1'}
        assert transport.peak == 1
        assert transport.finished == 2
    asyncio.run(run())


@pytest.mark.parametrize('endpoint', ['https://api.openai.com/v1', 'http://192.0.2.10:8000/v1',
                                     'http://localhost.evil.example/v1', 'http://user:pass@127.0.0.1:8000/v1'])
def test_nonlocal_or_credentialed_endpoint_is_rejected_before_generation(endpoint):
    transport = RecordedTransport()
    transport.endpoint = endpoint
    with pytest.raises(ValueError, match='loopback'):
        LocalModelProvider(transport)
    assert transport.calls == 0
