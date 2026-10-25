"""Two specialized Agent Framework agents over one serialized local client."""
import json
import asyncio
from contextvars import ContextVar
from .models import GroundedAnalysis, GroundedExplanation
from .provider import FoundryTransport, LocalModelProvider, ModelOutputError, parse_output, require_loopback
from .narration import SENTENCES


class LocalAgentRunner:
    def __init__(self, model='qwen2.5-1.5b', device='GPU'):
        self.transport = FoundryTransport(model, device)
        self.provider = LocalModelProvider(self.transport)
        # One tool iteration + final answer = at most two actual model roundtrips.
        self.transport.client.function_invocation_configuration.update(
            max_iterations=1, max_function_calls=1, max_duration_seconds=30,
            allow_concurrent_invocation=False, terminate_on_unknown_calls=True)
        from foundry_local.models import DeviceType
        info = self.transport.client.manager.get_model_info(model, device=DeviceType(device))
        self.model_id = f'{info.id}@{info.version}'
        self.tool_calls = 0
        self._budget = ContextVar('timepitch_inference_budget', default=None)
        # Count every actual HTTP roundtrip, including framework tool loops.
        # This is the pinned OpenAI client's underlying httpx client.
        async def before_request(request):
            require_loopback(str(request.url))
            reserve = self._budget.get()
            if reserve is None: raise RuntimeError('Inference has no authorized budget')
            reserve(1)
        self.transport.client.client._client.event_hooks.setdefault('request', []).append(before_request)

    async def _exclusive(self, operation, reserve):
        async def bounded():
            token = self._budget.set(reserve)
            try: return await operation()
            finally: self._budget.reset(token)
        return await self.provider.run_exclusive(bounded)

    async def _structured(self, name, instructions, payload, schema, reserve):
        from agent_framework import Agent
        guidance = 'Return a DATA OBJECT like the example, never the schema itself. Preserve field names. Allowed JSON shape: ' + json.dumps(schema)
        agent = Agent(client=self.transport.client, name=name, instructions=instructions + '\n' + guidance,
                      default_options={'max_tokens': 512, 'temperature': 0})
        async def operation():
            response = await agent.run(json.dumps(payload, ensure_ascii=False), options={
                'tool_choice': 'none', 'response_format': {'type': 'json_schema', 'json_schema': {'name': 'grounded_result', 'schema': schema, 'strict': True}}})
            return parse_output(response.text, schema)
        return await self._exclusive(operation, reserve)

    async def analyze(self, window, tools, reserve):
        from agent_framework import Agent
        facts = None
        def read_match_window() -> str:
            """Read the recorded events, score and cumulative metrics for this authorized match window."""
            nonlocal facts
            facts = tools.read_window(); self.tool_calls += 1
            return json.dumps(facts, ensure_ascii=False)
        agent = Agent(client=self.transport.client, name='TimePitchAnalyst',
            instructions='Call read_match_window exactly once. Read only its recorded evidence. Do not invent events or statistics.',
            tools=[read_match_window], default_options={'max_tokens': 512, 'temperature': 0})
        await self._exclusive(lambda: agent.run('Use read_match_window to inspect the current recorded match window.'), reserve)
        if facts is None: raise ModelOutputError('Analyst did not use its evidence tool')
        # Keep the model's wire output small. Context identifiers and all numbers
        # come from the authorized immutable window, never model transcription.
        options=tools.observations()
        preferred=getattr(self,'preferred_category',None)
        if preferred:
            options={id:observation for id,observation in options.items() if observation.category==preferred}
            if not options:raise ModelOutputError('Requested acceptance category has no evidence')
        schema={'type':'object','additionalProperties':False,'required':['observation_id'],
                'properties':{'observation_id':{'type':'string','enum':list(options)}}}
        example={'observation_id':next((id for id in options if id.startswith('metric:')),next(iter(options)))}
        payload = {'facts': facts, 'example': example}
        result = await self._structured('TimePitchAnalyst',
            'Select exactly one supplied observation_id. Prefer a metric observation when available. '
            'The server supplies every category, player, value and evidence reference. Simulated xG does not establish a goal. '
            'Return only observation_id, with no prose or additional fields.',payload,schema,reserve)
        return options[result['observation_id']].model_dump()

    async def narrate(self, analysis, locale, mode, reserve):
        example = {'locale': locale, 'mode': mode, 'variant': 0}
        schema = {'type': 'object', 'additionalProperties': False, 'required': ['locale', 'mode', 'variant'], 'properties': {
            'locale': {'type': 'string', 'enum': [locale]}, 'mode': {'type': 'string', 'enum': [mode]}, 'variant': {'type': 'integer', 'minimum': 0, 'maximum': 1}}}
        result = await self._structured('TimePitchNarrator',
            'Adapt the accepted analysis to the requested language and audience by choosing variant 0 or 1 from the supplied sentences. '
            'Return exactly the three user fields locale, mode, variant. Change only variant. No markdown fences or extra fields. '
            'Accepted analytical category: ' + analysis.category + '. Sentences: ' + json.dumps(SENTENCES[locale][mode][analysis.category], ensure_ascii=False),
            example, schema, reserve)
        return GroundedExplanation(**analysis.model_dump(), **result).model_dump()

    async def close(self):
        # A caller timeout does not mean native inference stopped. Drain it before
        # closing the shared HTTP client; no second application-owned call starts.
        await asyncio.gather(*list(self.provider._pending), return_exceptions=True)
        await self.transport.client.client.close()
