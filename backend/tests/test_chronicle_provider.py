import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from chronicle_fixtures import pack
from test_chronicle_repository import result
from test_chronicle_worker_client import claim
from timepitch.chronicles.provider import FoundryChronicleProvider
from timepitch.chronicles.models import MODEL
from timepitch.agents.provider import LocalModelTimeout, ModelOutputError


class FakeTransport:
    endpoint='http://127.0.0.1:54321/v1'
    def __init__(self):
        self.http=httpx.AsyncClient(transport=httpx.MockTransport(lambda _:httpx.Response(200,json={})))
        self.client=SimpleNamespace(client=SimpleNamespace(_client=self.http,close=self.http.aclose),function_invocation_configuration={})
        self.calls=0; self.active=0; self.peak=0
    async def send(self):
        await self.http.post(self.endpoint+'/chat/completions',json={}); self.calls+=1


class ScriptedAgents:
    def __init__(self,transport,change=None,delay=0): self.transport=transport; self.change=change; self.delay=delay; self.options=[]; self.payloads=[]
    def __call__(self,*,client,name,instructions,default_options,tools=None):
        self.options.append((name,instructions,default_options,tools)); parent=self
        class FakeAgent:
            async def run(self,payload,options=None):
                if options: parent.payloads.append((name,json.loads(payload)))
                t=parent.transport; t.active+=1; t.peak=max(t.peak,t.active)
                try:
                    await asyncio.sleep(parent.delay)
                    await t.send()
                    if tools:
                        if parent.change!='missing_tool': tools[0]()
                        if parent.change=='double_tool': tools[0]()
                        await t.send()
                        if parent.change=='extra_http': await t.send()
                        return SimpleNamespace(text='tool acknowledgement')
                    if name=='TimePitchChronicleAnalyst':
                        value={'fact_ids':['result','goal:grf:0']}  # Replaced with a real source ID below.
                        facts=json.loads(payload)['facts']; goal=next(f['id'] for f in facts['facts'] if f['kind']=='goal')
                        value={'fact_ids':['result',goal]}
                    else: value=result(claim()).selection.model_dump()
                    if parent.change=='extra': value['invented']='unsafe'
                    if parent.change=='unknown': value={'fact_ids':['result','invented']} if name.endswith('Analyst') else value
                    if parent.change=='variant' and name.endswith('Narrator'): value['headline']['variant']=2
                    return SimpleNamespace(text=json.dumps(value))
                finally: t.active-=1
        return FakeAgent()


def provider(change=None,delay=0):
    transport=FakeTransport(); agents=ScriptedAgents(transport,change,delay)
    p=FoundryChronicleProvider(transport_factory=lambda:transport,agent_factory=agents,
        inspect_model=lambda t:MODEL)
    return p,transport,agents


def test_lazy_ready_tool_and_exact_http_count_and_options():
    async def run():
        p,t,agents=provider(); assert p.transport is None
        assert await p.readiness(); calls=[]
        receipt=await p.generate(pack(),'en',calls.append)
        assert receipt.actual_calls==t.calls==4 and receipt.evidence_reads==1 and calls==[1]*4
        assert all(o[2]['max_tokens']==512 for o in agents.options)
        assert all('example' in o[1].lower() or o[3] for o in agents.options)
        config=t.client.function_invocation_configuration
        assert config['max_iterations']==config['max_function_calls']==1 and not config['allow_concurrent_invocation']
        await p.close()
    asyncio.run(run())


@pytest.mark.parametrize('change',['missing_tool','double_tool','extra','unknown','variant'])
def test_bad_tool_or_structured_data_never_accepted(change):
    async def run():
        p,t,_=provider(change)
        try:
            with pytest.raises((ValueError,ModelOutputError)): await p.generate(pack(),'es',lambda _:None)
            assert t.calls<=4
        finally: await p.close()
    asyncio.run(run())


def test_fifth_http_denied_before_transport_and_external_budget_failure():
    async def run():
        p,t,_=provider(); await p.readiness()
        def denied(_): raise ValueError('Acceptance exhausted')
        with pytest.raises(ValueError): await p.generate(pack(),'en',denied)
        assert t.calls==0
        await p.close()
        p,t,_=provider('extra_http')
        with pytest.raises(ModelOutputError): await p.generate(pack(),'en',lambda _:None)
        assert t.calls==4  # Fifth reaches the hook but never the fake HTTP transport.
        await p.close()
    asyncio.run(run())


def test_model_missing_or_wrong_revision_is_not_ready_and_does_not_load():
    async def run():
        p,t,_=provider(); p.inspect_model=lambda _:None
        assert not await p.readiness() and t.calls==0
        p.inspect_model=lambda _:'other@1'
        assert not await p.readiness() and t.calls==0
        await p.close()
    asyncio.run(run())


def test_timeout_and_cancellation_hold_gate_until_real_completion():
    async def run():
        p,t,_=provider(delay=.025); p.timeout_s=.005
        with pytest.raises(LocalModelTimeout): await p.generate(pack(),'en',lambda _:None)
        assert p.transport and p.executor._pending
        await p.close()
        assert not p.executor._pending and t.peak==1
        p,t,_=provider(delay=.02)
        task=asyncio.create_task(p.generate(pack(),'en',lambda _:None))
        while not t.active: await asyncio.sleep(.001)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert p.executor._pending
        await p.close()
        assert t.peak==1 and not p.executor._pending
    asyncio.run(run())


def test_real_loaded_profile_checks_device_tools_and_exact_version_without_loading():
    from timepitch.chronicles.provider import loaded_profile
    from foundry_local.models import DeviceType
    info=SimpleNamespace(id=MODEL.split('@')[0],version='4',supports_tool_calling=True,device_type=DeviceType.GPU)
    manager=SimpleNamespace(get_model_info=lambda *a,**k:info,list_loaded_models=lambda:[info])
    transport=SimpleNamespace(client=SimpleNamespace(manager=manager))
    assert loaded_profile(transport)==MODEL
    info.supports_tool_calling=False
    assert loaded_profile(transport) is None


def test_timeout_admission_closes_before_late_http_but_drains_task():
    async def run():
        p,t,_=provider(delay=.025); p.timeout_s=.005
        with pytest.raises(LocalModelTimeout): await p.generate(pack(),'en',lambda _:None)
        assert t.calls==0
        await p.close()
        assert t.calls==0  # Delayed first/second HTTP must not be admitted after timeout.
    asyncio.run(run())


def test_production_runtime_rejects_missing_or_global_binary_before_service(monkeypatch,tmp_path):
    from timepitch.chronicles.provider import verify_private_runtime
    exe=tmp_path/'0.8.119/foundry.exe'
    with pytest.raises(RuntimeError): verify_private_runtime(exe)
    exe.parent.mkdir(); exe.write_bytes(b'synthetic')
    import shutil
    monkeypatch.setattr(shutil,'which',lambda _:str(tmp_path/'global/foundry.exe'))
    with pytest.raises(RuntimeError): verify_private_runtime(exe)


def test_private_runtime_version_listener_ownership_and_loopback_are_required(monkeypatch,tmp_path):
    import timepitch.chronicles.provider as module
    exe=tmp_path/'0.8.119/foundry.exe'; exe.parent.mkdir(); exe.write_bytes(b'synthetic-fixture')
    manifest=exe.parent/'AppxManifest.xml'; manifest.write_text('<Package><Identity Version="0.8.119.0"/></Package>')
    monkeypatch.setattr(module.shutil,'which',lambda _:str(exe))
    ownership=[0]; service=[b'Foundry service running at http://127.0.0.1:4567']
    def subprocess_call(args,**kwargs):
        if str(args[0])==str(exe): return SimpleNamespace(returncode=0,stdout=service[0])
        assert kwargs['env']['TIMEPITCH_FOUNDRY_DIR']==str(exe.parent)
        assert 'DirectorySeparatorChar' in args[-1]
        return SimpleNamespace(returncode=ownership[0])
    monkeypatch.setattr(module.subprocess,'run',subprocess_call)
    assert module.verify_private_runtime(exe)=='http://127.0.0.1:4567'
    ownership[0]=2
    with pytest.raises(RuntimeError): module.verify_private_runtime(exe)
    ownership[0]=0; service[0]=b'http://192.0.2.1:4567'
    with pytest.raises(ValueError): module.verify_private_runtime(exe)
    manifest.write_text('<Package><Identity Version="9.9.9.0"/></Package>')
    with pytest.raises(RuntimeError): module.verify_private_runtime(exe)


def test_analyst_example_uses_substantive_facts_for_a_multisentence_report():
    async def run():
        p,t,agents=provider()
        try:
            await p.generate(pack(),'en',lambda _:None)
            example=next(body['example']['fact_ids'] for name,body in agents.payloads if name=='TimePitchChronicleAnalyst')
            assert len(example)>=3 and 'coverage' not in example
        finally: await p.close()
    asyncio.run(run())
