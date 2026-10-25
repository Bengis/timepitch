"""Installed Responses SDK through fabricated HTTP only; no real credential or grant."""
import asyncio
import json
import logging
import platform
from pathlib import Path
from types import SimpleNamespace
import httpx2
import pytest
from openai import AsyncOpenAI
from azure_chronicle_fixtures import binding, source, raw, forbid_runtime
from test_azure_chronicle_provider import api
from timepitch.chronicles.azure.models import SendPermit
from timepitch.chronicles.azure.settings import AzureSettings

MARKER='credential-payload-private-sentinel'


@pytest.fixture
def sdk(monkeypatch,tmp_path):
    loop=asyncio.new_event_loop();forbid_runtime(monkeypatch)
    import socket
    monkeypatch.setattr(socket.socket,'connect',lambda *_:pytest.fail('Network forbidden'))
    for name,value in [('system','Windows'),('machine','AMD64'),('platform','Windows-synthetic')]:
        monkeypatch.setattr(platform,name,lambda value=value:value)
    credential=tmp_path/'credential';credential.write_text(MARKER);credential.chmod(0o600)
    active=[]
    async def respond(_,request):return await active[0].respond(request)
    monkeypatch.setattr(httpx2.AsyncHTTPTransport,'handle_async_request',respond)
    def scenario(change='healthy',locale='en'):
        s=Scenario(change,locale)
        active[:]=[s]
        def factory(**kwargs):
            s.kwargs=kwargs
            return AsyncOpenAI(**kwargs)
        s.provider=api().AzureProvider(AzureSettings(mode='public',binding=binding(),credential_file=credential),client_factory=factory)
        s.prepared=api().prepare_request(source(),locale,binding())
        return s
    try:yield SimpleNamespace(scenario=scenario,run=loop.run_until_complete)
    finally:loop.run_until_complete(loop.shutdown_asyncgens());loop.close()


class Scenario:
    def __init__(self,change,locale):
        self.change,self.locale=change,locale;self.requests=[];self.permits=[]
        self.entered=asyncio.Event();self.release=asyncio.Event()
    def authorize(self,prepared):
        assert not self.requests
        self.permits.append(prepared)
        return SendPermit(attempt_id='fabricated-attempt',request_hash=prepared.request_hash)
    async def generate(self):return await self.provider.generate(self.prepared,self.authorize)
    async def respond(self,request):
        if hasattr(self,'verify_admission'):self.verify_admission()
        else:assert len(self.permits)==1
        assert str(request.url)=='https://synthetic.openai.azure.com/openai/v1/responses'
        self.requests.append(json.loads(request.content))
        if self.change in ('timeout','cancel'):
            self.entered.set();await self.release.wait()
        if self.change=='connect_error':raise httpx2.ConnectError(MARKER,request=request)
        if self.change in ('429','500','redirect'):
            code=302 if self.change=='redirect' else int(self.change)
            return httpx2.Response(code,json={'error':{'message':MARKER}},headers={'location':'https://other.invalid/'})
        value={'id':'response-safe','object':'response','model':binding().expected_model,'status':'completed',
            'output':[{'type':'message','role':'assistant','status':'completed','id':'message-1',
                'content':[{'type':'output_text','text':json.dumps(raw(self.locale)),'annotations':[]}]}],
            'usage':{'input_tokens':12,'output_tokens':20,'output_tokens_details':{'reasoning_tokens':4}}}
        if self.change=='refusal':value['output'][0]['content']=[{'type':'refusal','refusal':MARKER}]
        if self.change=='truncated':value['status']='incomplete';value['incomplete_details']={'reason':'max_output_tokens'}
        if self.change=='wrong_model':value['model']='other-model'
        if self.change=='invalid':value['output'][0]['content'][0]['text']=MARKER
        if self.change=='missing_usage':value.pop('usage')
        if self.change=='tool':value['output'].append({'type':'function_call','name':'bad','arguments':'{}'})
        if self.change=='oversize':return httpx2.Response(200,content=b'x'*262145)
        if self.change=='non_object':return httpx2.Response(200,json=[])
        if self.change=='encoded':return httpx2.Response(200,content=b'not-gzip',headers={'content-encoding':'gzip'})
        if self.change=='unsafe_id':value['id']='bad\n'+MARKER
        if self.change=='oversize_valid':value['padding']='x'*262144
        return httpx2.Response(200,json=value,headers={'x-request-id':'safe-request-id'})


@pytest.mark.parametrize('locale',['en','es'])
def test_sdk_wire_has_schema_store_false_and_no_tools(sdk,locale):
    async def run():
        s=sdk.scenario(locale=locale)
        assert not s.requests
        try:
            receipt=await s.generate()
            assert receipt.error is None and receipt.draft.model_dump()==raw(locale)
            assert len(s.requests)==len(s.permits)==1
            assert s.requests[0]==s.prepared.body
            assert s.kwargs['max_retries']==0 and s.kwargs['timeout']==60
            assert not s.kwargs['http_client'].follow_redirects and not s.kwargs['http_client'].trust_env
            assert (receipt.input_tokens,receipt.output_tokens,receipt.reasoning_tokens)==(12,20,4)
            assert receipt.provider_request_id=='safe-request-id'
        finally:await s.provider.close()
    sdk.run(run())


@pytest.mark.parametrize('change',['429','500','redirect','connect_error','timeout','cancel'])
def test_exactly_one_send_on_429_timeout_or_500(sdk,change):
    async def run():
        s=sdk.scenario(change)
        if change=='timeout':s.provider.deadline_s=.02
        try:
            task=asyncio.create_task(s.generate())
            if change=='cancel':await s.entered.wait();task.cancel()
            receipt=await task
            assert receipt.error in ('provider_error','uncertain_send')
            assert len(s.requests)==len(s.permits)==1
            assert receipt.input_tokens is receipt.output_tokens is None
        finally:s.release.set();await s.provider.close()
    sdk.run(run())


@pytest.mark.parametrize('change',['refusal','truncated','wrong_model','invalid','tool','oversize','encoded','non_object'])
def test_completion_refusal_truncation_model_mismatch(sdk,change):
    async def run():
        s=sdk.scenario(change)
        try:
            receipt=await s.generate()
            assert receipt.error and receipt.draft is None
            assert len(s.requests)==1
            if change not in ('oversize','encoded','non_object'):
                assert (receipt.input_tokens,receipt.output_tokens,receipt.reasoning_tokens)==(12,20,4)
        finally:await s.provider.close()
    sdk.run(run())


def test_missing_usage_stays_unknown(sdk):
    async def run():
        s=sdk.scenario('missing_usage')
        try:
            receipt=await s.generate()
            assert receipt.input_tokens is receipt.output_tokens is receipt.reasoning_tokens is None
        finally:await s.provider.close()
    sdk.run(run())


def test_credential_and_payload_never_enter_logs(sdk,caplog):
    caplog.set_level(logging.DEBUG)
    async def run():
        s=sdk.scenario('invalid')
        try:
            receipt=await s.generate()
            assert receipt.error=='invalid_result'
            assert MARKER not in receipt.model_dump_json()
        finally:await s.provider.close()
    sdk.run(run())
    assert MARKER not in caplog.text and 'home_name' not in caplog.text


def test_tampered_body_and_denied_admission_cannot_send(sdk):
    async def run():
        s=sdk.scenario();s.prepared.body['tools']=[{'type':'web_search'}]
        try:
            with pytest.raises(ValueError):await s.generate()
            assert not s.requests and not s.permits
            s.prepared=api().prepare_request(source(),'en',binding())
            def deny(_):raise ValueError('No grant')
            with pytest.raises(ValueError):await s.provider.generate(s.prepared,deny)
            assert not s.requests
        finally:await s.provider.close()
    sdk.run(run())


def test_valid_json_above_raw_transport_bound_cannot_be_accepted(sdk):
    async def run():
        s=sdk.scenario('oversize_valid')
        try:
            receipt=await s.generate()
            assert receipt.error and receipt.draft is None and receipt.input_tokens is None
        finally:await s.provider.close()
    sdk.run(run())
