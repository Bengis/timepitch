"""Pinned SDK serialization/tool loop with fabricated HTTP, never a model or grant."""
import asyncio
import json
import platform
import socket
import subprocess
from types import SimpleNamespace

import httpx
import pytest
from agent_framework.exceptions import ChatClientException

from chronicle_fixtures import pack
from timepitch.agents.provider import FoundryTransport, LocalModelTimeout, ModelOutputError
from timepitch.chronicles.diagnostics import safe_diagnostic
from timepitch.chronicles.models import MODEL, fact_pack_hash
from timepitch.chronicles.provider import FoundryChronicleProvider
from timepitch.chronicles.render import render_chronicle


ENDPOINT='http://127.0.0.1:54321/v1'
SENTINELS=('credential-sentinel','player-sentinel','private-path-sentinel')


@pytest.fixture
def sdk(monkeypatch):
    # Windows creates its internal loop wakeup socket before network denial.
    loop=asyncio.new_event_loop()
    import agent_framework_foundry_local._foundry_local_client as adapter
    import foundry_local
    import foundry_local.service as service
    import timepitch.chronicles.acceptance as acceptance
    from foundry_local.models import DeviceType
    from openai import AsyncOpenAI
    blocked=[];active=[]
    def deny(*args,**kwargs):
        blocked.append(True)
        raise AssertionError('SDK contract tests forbid network, preparation and real allowances')
    for name in ('connect','connect_ex'):
        monkeypatch.setattr(socket.socket,name,deny)
    for name in ('create_connection','getaddrinfo'):
        monkeypatch.setattr(socket,name,deny)
    monkeypatch.setattr(subprocess,'Popen',deny)
    monkeypatch.setattr(subprocess,'run',deny)
    # OpenAI's user-agent introspection otherwise invokes `ver` on Windows.
    monkeypatch.setattr(platform,'system',lambda:'Windows')
    monkeypatch.setattr(platform,'machine',lambda:'AMD64')
    monkeypatch.setattr(platform,'platform',lambda:'Windows-synthetic')
    monkeypatch.setattr(foundry_local.FoundryLocalManager,'__init__',deny)
    monkeypatch.setattr(service,'start_service',deny)
    monkeypatch.setattr(service,'assert_foundry_installed',deny)
    monkeypatch.setattr(service,'get_service_uri',lambda:ENDPOINT.removesuffix('/v1'))
    monkeypatch.setattr(acceptance.AcceptanceBudget,'__init__',deny)
    monkeypatch.setattr(acceptance.AcceptanceBudget,'initialize',deny)

    class Manager:
        endpoint=ENDPOINT
        api_key='fabricated-local-only'
        def __init__(self,*,bootstrap,timeout):
            assert bootstrap is False and timeout==30
            self.info=SimpleNamespace(id=MODEL.split('@')[0],version='4',
                supports_tool_calling=True,device_type=DeviceType.GPU)
        def get_model_info(self,model,*,device):
            assert model=='qwen2.5-1.5b' and device==DeviceType.GPU
            return self.info
        def list_loaded_models(self):return [self.info]
        download_model=load_model=start_service=deny

    def openai_client(**kwargs):
        assert kwargs=={'base_url':ENDPOINT,'api_key':'fabricated-local-only'}
        http=httpx.AsyncClient(transport=httpx.MockTransport(active[0].respond),trust_env=False)
        active[0].http=http
        # Preserve SDK defaults: FoundryTransport must disable retries itself.
        return AsyncOpenAI(**kwargs,http_client=http)

    monkeypatch.setattr(adapter,'FoundryLocalManager',Manager)
    monkeypatch.setattr(adapter,'AsyncOpenAI',openai_client)

    def scenario(change='healthy',locale='en'):
        value=Scenario(change,locale)
        active[:]=[value]
        value.provider=FoundryChronicleProvider(transport_factory=lambda:FoundryTransport('qwen2.5-1.5b','GPU'))
        return value
    try:
        yield SimpleNamespace(scenario=scenario,run=loop.run_until_complete)
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.run_until_complete(loop.shutdown_default_executor())
        loop.close()
        assert not blocked,'A forbidden operation was attempted, even if the SDK caught its exception'


class Scenario:
    def __init__(self,change,locale):
        self.change=change;self.locale=locale;self.requests=[];self.charges=[]
        self.source=pack();self.hash=fact_pack_hash(self.source)
        self.goal=next(f.id for f in self.source.facts if f.kind=='goal')
        self.ids=['result',self.goal]
        self.entered=asyncio.Event();self.release=asyncio.Event()

    def reserve(self,count):
        assert count==1 and len(self.charges)<4
        self.charges.append(count)

    async def generate(self):
        return await self.provider.generate(self.source,self.locale,self.reserve)

    async def respond(self,request):
        assert request.method=='POST' and str(request.url)==ENDPOINT+'/chat/completions'
        body=json.loads(request.content)
        self.requests.append(body)
        ordinal=len(self.requests)
        assert ordinal<=4
        if self.change in ('timeout','cancel') and ordinal==1:
            self.entered.set();await self.release.wait()
        if self.change=='connect_error':
            raise httpx.ConnectError(' '.join(SENTINELS),request=request)
        if self.change=='body_error':
            class BrokenBody(httpx.AsyncByteStream):
                async def __aiter__(self):
                    raise httpx.ReadError(' '.join(SENTINELS),request=request)
                    yield b''
            return httpx.Response(200,stream=BrokenBody())
        if ordinal==1 and self.change!='missing_tool':
            calls=[{'id':'evidence-1','type':'function',
                'function':{'name':'read_chronicle_facts','arguments':'{}'}}]
            if self.change=='repeated_tool':
                calls.append({**calls[0],'id':'evidence-2'})
            message={'role':'assistant','content':None,'tool_calls':calls};finish='tool_calls'
        else:
            text='Evidence received.'
            if ordinal==3:
                value={'fact_ids':self.ids}
                if self.change=='schema_echo':value=body['response_format']['json_schema']['schema']
                if self.change=='missing_result':value={'fact_ids':[self.goal]}
                if self.change=='duplicate_ids':value={'fact_ids':['result','result']}
                if self.change=='insufficient':value={'fact_ids':['result']}
                text=json.dumps(value)
                if self.change=='invalid_json':text='{'+','.join(SENTINELS)
                if self.change=='non_object':text='[]'
            if ordinal==4:
                value={'headline':{'fact_ids':['result'],'variant':0},
                    'paragraphs':[{'fact_ids':[self.goal],'variant':0}]}
                if self.change=='narrator_schema':value['private-path-sentinel']='credential-sentinel'
                if self.change=='narrator_variant':value['headline']['variant']=2
                if self.change=='narrator_float':value['headline']['variant']=0.0
                if self.change=='selection':value['paragraphs'][0]['fact_ids']=['result']
                text=json.dumps(value)
                if self.change=='narrator_json':text=' '.join(SENTINELS)
            message={'role':'assistant','content':text};finish='stop'
        return httpx.Response(200,json={'id':'fabricated-chat-'+str(ordinal),'object':'chat.completion',
            'created':1,'model':MODEL.split('@')[0],
            'choices':[{'index':0,'message':message,'finish_reason':finish}],
            'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}})

    def assert_requests(self,count):
        assert len(self.requests)==len(self.charges)==count
        assert self.http.trust_env is False
        assert self.provider.transport.client.client.max_retries==0
        for ordinal,body in enumerate(self.requests,1):
            assert body['model']==MODEL.split('@')[0]
            assert body['max_completion_tokens']==512 and 'max_tokens' not in body and body['temperature']==0
            if ordinal<=2:
                assert body['tools'][0]['function']['name']=='read_chronicle_facts'
                assert body['tools'][0]['function']['parameters']['properties']=={}
                if ordinal==2:assert body['tool_choice']=='none'
            else:
                # Pinned SDK drops tool_choice when there are no tool definitions.
                assert 'tool_choice' not in body and not body.get('tools')
                form=body['response_format']
                assert form['type']=='json_schema' and form['json_schema']['strict'] is True
                assert form['json_schema']['name']==('chronicle_analysis' if ordinal==3 else 'chronicle_selection')
                schema=form['json_schema']['schema']
                assert schema['type']=='object' and schema['additionalProperties'] is False
                if ordinal==3:
                    assert set(schema['properties']['fact_ids']['items']['enum'])=={f.id for f in self.source.facts}
                else:
                    assert set(schema['required'])=={'headline','paragraphs'}
                    assert schema['properties']['headline']['properties']['variant']=={'type':'integer','minimum':0,'maximum':1}
        if count>=2:
            tool_messages=[m for m in self.requests[1]['messages'] if m['role']=='tool']
            assert tool_messages and tool_messages[0]['tool_call_id']=='evidence-1'
            # The SDK may encode a string-returning tool as a JSON string.
            value=json.loads(tool_messages[0]['content'])
            if isinstance(value,str):value=json.loads(value)
            assert value==self.source.model_dump(mode='json')
        assert fact_pack_hash(self.source)==self.hash


@pytest.mark.parametrize('locale',['en','es'])
def test_real_sdk_four_requests_and_one_evidence_read_produce_only_grounded_text(sdk,locale):
    async def run():
        s=sdk.scenario(locale=locale)
        try:
            receipt=await s.generate()
            assert receipt.actual_calls==4 and receipt.evidence_reads==1
            text=render_chronicle(s.source,receipt.selection,locale)
            assert text
            s.assert_requests(4)
            config=s.provider.transport.client.function_invocation_configuration
            assert config['max_iterations']==config['max_function_calls']==1
            assert config['max_duration_seconds']==30 and config['allow_concurrent_invocation'] is False
        finally:await s.provider.close()
    sdk.run(run())


@pytest.mark.parametrize('change,reason',[
    ('invalid_json','json_invalid'),('schema_echo','schema_invalid'),
    ('missing_result','analysis_result_missing'),('duplicate_ids','analysis_duplicate_facts'),
    ('insufficient','analysis_insufficient_observations'),('non_object','json_object_required'),
])
def test_real_sdk_analyst_rejections_keep_distinct_safe_stage_and_three_requests(sdk,change,reason):
    async def run():
        s=sdk.scenario(change)
        try:
            with pytest.raises(ModelOutputError) as caught:await s.generate()
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.response_headers_received,d.evidence_reads)==('analysis',reason,3,3,1)
            assert d.response_chars>0
            assert d.finish_reason=='stop'  # The actual SDK carries this observed response metadata.
            if change=='invalid_json':assert (d.json_line,d.json_column)==(1,2)
            if change=='schema_echo':assert d.schema_rule=='additionalProperties'
            assert all(marker not in d.model_dump_json() for marker in SENTINELS)
            s.assert_requests(3)
        finally:await s.provider.close()
    sdk.run(run())


@pytest.mark.parametrize('change,reason,stage',[
    ('narrator_json','json_invalid','narration'),('narrator_schema','schema_invalid','narration'),
    ('narrator_variant','schema_invalid','narration'),('narrator_float','schema_invalid','narration'),
    ('selection','selection_invalid','selection_validation'),
])
def test_real_sdk_narrator_rejection_is_not_relabelled_analysis(sdk,change,reason,stage):
    async def run():
        s=sdk.scenario(change,'es')
        try:
            with pytest.raises(ValueError) as caught:await s.generate()
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.response_headers_received,d.evidence_reads)==(stage,reason,4,4,1)
            assert all(marker not in d.model_dump_json() for marker in SENTINELS)
            s.assert_requests(4)
        finally:await s.provider.close()
    sdk.run(run())


def test_real_sdk_missing_tool_fails_after_one_request_without_narration(sdk):
    async def run():
        s=sdk.scenario('missing_tool')
        try:
            with pytest.raises(ModelOutputError) as caught:await s.generate()
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.response_headers_received,d.evidence_reads)==('evidence','evidence_missing',1,1,0)
            s.assert_requests(1)
        finally:await s.provider.close()
    sdk.run(run())


def test_real_sdk_repeated_tool_cannot_be_swallowed_into_ready(sdk):
    async def run():
        s=sdk.scenario('repeated_tool')
        try:
            with pytest.raises((ModelOutputError,ChatClientException)) as caught:await s.generate()
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.evidence_reads)==('evidence','evidence_repeated',1,1)
            s.assert_requests(1)
        finally:await s.provider.close()
    sdk.run(run())


@pytest.mark.parametrize('change,headers',[('connect_error',0),('body_error',1)])
def test_real_sdk_transport_wrapper_distinguishes_headers_from_completed_body(sdk,change,headers):
    async def run():
        s=sdk.scenario(change)
        try:
            with pytest.raises(Exception) as caught:await s.generate()
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.response_headers_received)==('evidence','transport_failure',1,headers)
            assert d.response_chars is None and d.evidence_reads==0
            assert all(marker not in d.model_dump_json() for marker in SENTINELS)
            s.assert_requests(1)
        finally:await s.provider.close()
    sdk.run(run())


@pytest.mark.parametrize('change',['timeout','cancel'])
def test_real_sdk_late_tool_response_cannot_send_again_or_replace_first_failure(sdk,change):
    async def run():
        s=sdk.scenario(change)
        try:
            assert await s.provider.readiness()
            if change=='timeout':s.provider.timeout_s=.1
            task=asyncio.create_task(s.generate())
            await asyncio.wait_for(s.entered.wait(),5)
            if change=='cancel':task.cancel()
            with pytest.raises(asyncio.CancelledError if change=='cancel' else LocalModelTimeout) as caught:await task
            d=safe_diagnostic(caught.value)
            assert (d.stage,d.reason,d.http_admitted,d.response_headers_received,d.evidence_reads)==('evidence','cancelled' if change=='cancel' else 'operation_timeout',1,0,0)
            before=d.model_dump_json();s.release.set()
            await s.provider.close()
            assert safe_diagnostic(caught.value).model_dump_json()==before
            assert not s.provider.executor._pending
            s.assert_requests(1)
        finally:
            s.release.set();await s.provider.close()
    sdk.run(run())
