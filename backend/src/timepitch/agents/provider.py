"""Serialize local generation and reject outputs outside the requested schema."""
import asyncio
import ipaddress
import json
from typing import Protocol
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, ValidationError


class LocalModelTimeout(TimeoutError):
    """Generation missed its budget; no cloud fallback is attempted."""


class ModelOutputError(ValueError):
    """The model did not return an acceptable structured result."""


def require_loopback(endpoint: str) -> None:
    url = urlsplit(endpoint)
    try:
        local = url.hostname == 'localhost' or ipaddress.ip_address(url.hostname or '').is_loopback
    except ValueError:
        local = False
    if not local or url.scheme != 'http' or url.username or url.password or url.query or url.fragment:
        raise ValueError('Inference endpoint must be credential-free HTTP loopback')


class LocalTransport(Protocol):
    endpoint: str

    async def complete(self, messages: list[dict], schema: dict) -> str: ...


class LocalModelProvider:
    def __init__(self, transport: LocalTransport):
        require_loopback(transport.endpoint)
        self.transport = transport
        self._gate = asyncio.Lock()
        self._pending: set[asyncio.Task] = set()

    async def generate(self, messages: list[dict], schema: dict, timeout_s: float = 30) -> dict:
        Draft202012Validator.check_schema(schema)
        async def operation():
            text = await self.transport.complete(messages, schema)
            return parse_output(text, schema)
        return await self.run_exclusive(operation, timeout_s)

    async def run_exclusive(self, operation, timeout_s: float = 30):
        if not 0 < timeout_s <= 30:
            raise ValueError('Timeout must be positive and at most 30 seconds')
        started = False

        async def run():
            nonlocal started
            async with self._gate:
                started = True
                require_loopback(self.transport.endpoint)
                return await operation()

        task = asyncio.create_task(run())
        self._pending.add(task)

        def completed(done: asyncio.Task):
            self._pending.discard(done)
            if not done.cancelled():
                done.exception()  # Consume errors even when its caller already timed out.

        task.add_done_callback(completed)
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout_s)
        except (TimeoutError, asyncio.CancelledError) as error:
            if not started:
                task.cancel()  # Queued requests must not run after their caller times out.
            # An active request retains the gate until actual completion, even if native
            # inference cannot be interrupted immediately. No second GPU call can overlap.
            if isinstance(error, asyncio.CancelledError):
                raise
            raise LocalModelTimeout('Local generation timed out; match playback may continue') from error


def parse_output(text: str, schema: dict) -> dict:
    try:
        result = json.loads(text)
        if not isinstance(result, dict): raise ModelOutputError('Model output must be a JSON object')
        Draft202012Validator(schema).validate(result)
    except (json.JSONDecodeError, ValidationError) as error:
        raise ModelOutputError('Model output does not match the requested schema') from error
    return result


class FoundryTransport:
    """Official Agent Framework client; prepared runtime/model required before construction."""
    def __init__(self, model: str, device: str = 'GPU'):
        from agent_framework.foundry import FoundryLocalClient
        from foundry_local.models import DeviceType
        from foundry_local.service import get_service_uri
        service_uri = get_service_uri()
        if service_uri is None:
            raise RuntimeError('Foundry Local service is not running; prepare it explicitly first')
        require_loopback(service_uri)
        self.client = FoundryLocalClient(model=model, device=DeviceType(device), bootstrap=False,
                                        prepare_model=False, timeout=30)
        self.endpoint = self.client.manager.endpoint
        require_loopback(self.endpoint)
        self.client.client.api_key = 'local-only'  # Never forward an unrelated cloud key from the process environment.
        self.client.client.max_retries = 0

    async def complete(self, messages: list[dict], schema: dict) -> str:
        from agent_framework import Message
        guidance = 'Return only JSON matching this schema exactly. Preserve every property name; do not rename fields. Schema: ' + json.dumps(schema)
        system = '\n'.join([message['content'] for message in messages if message['role'] == 'system'] + [guidance])
        prepared = [Message(role='system', contents=[system])]
        prepared.extend(Message(role=message['role'], contents=[message['content']]) for message in messages if message['role'] != 'system')
        response = await self.client.get_response(
            prepared,
            options={'max_tokens': 512, 'temperature': 0,
                     'response_format': {'type': 'json_schema', 'json_schema': {'name': 'local_result', 'schema': schema, 'strict': True}}},
        )
        return response.text
