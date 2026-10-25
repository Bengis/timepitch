import asyncio
import json
import subprocess

import pytest

from canary_fixtures import make_authorization,ancestor_bytes,FakeRuntime
from timepitch.chronicles.models import ProviderReceipt
from timepitch.chronicles.diagnostics import ChronicleProviderError,ProviderDiagnostic


class FakeProvider:
    def __init__(self,change=None):self.calls=0;self.closed=False;self.change=change;self.active=False
    async def readiness(self):return self.change!='readiness'
    async def generate(self,pack,locale,reserve):
        self.calls+=1;self.active=True
        try:
            count=3 if self.change=='diagnostic' else 4
            for _ in range(count):reserve(1)
            if self.change=='diagnostic':raise ChronicleProviderError(ProviderDiagnostic(stage='analysis',reason='json_invalid',http_admitted=3,evidence_reads=1))
            if self.change=='fifth':reserve(1)
            if self.change=='slow':await asyncio.sleep(.05)
            ids=[f.id for f in pack.facts if f.kind in ('goal','actor_stat','team_compare')][:2]
            if self.change=='generic':ids=['coverage']
            if self.change=='one':ids=ids[:1]
            return ProviderReceipt(selection={'headline':{'fact_ids':['result'],'variant':0},'paragraphs':[{'fact_ids':ids,'variant':0}]},actual_calls=count,evidence_reads=1,elapsed_ms=1.)
        finally:self.active=False
    async def close(self):
        self.closed=True
        if self.change=='close':raise RuntimeError('synthetic-close-error')


def test_check_only_is_read_only_and_does_not_claim_model_readiness(tmp_path,monkeypatch):
    from timepitch.chronicles.canary import check_canary_inputs
    from timepitch.chronicles.canary_budget import canary_directory
    a,_=make_authorization(tmp_path);before=ancestor_bytes(tmp_path)
    def forbidden(*a,**k):raise AssertionError('check-only must not start anything')
    monkeypatch.setattr(subprocess,'Popen',forbidden);monkeypatch.setattr(subprocess,'run',forbidden)
    report=check_canary_inputs(a,root=tmp_path)
    assert report.ready and report.model_ready is False
    assert not (canary_directory(tmp_path)/'usage.sqlite').exists() and ancestor_bytes(tmp_path)==before


def test_one_fake_job_validated_and_stops_with_inherited_budget(tmp_path):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,p=make_authorization(tmp_path);provider=FakeProvider();runtime=FakeRuntime();before=ancestor_bytes(tmp_path)
        result=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:provider,runtime_controller=runtime,sampler=lambda:{'fixture':True})
        assert result.status=='succeeded' and result.broker_state=='ready' and result.text
        assert result.usage.cumulative_charged==7 and result.usage.cumulative_reserved==8
        assert provider.calls==1 and provider.closed and runtime.restored
        assert ancestor_bytes(tmp_path)==before and result.cleanup_complete
        with pytest.raises(Exception):await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:provider,runtime_controller=runtime,sampler=lambda:{})
        assert provider.calls==1
    asyncio.run(run())


@pytest.mark.parametrize('change',['diagnostic','fifth','generic','one','readiness','close'])
def test_failure_never_regenerates_refunds_or_turns_ready(tmp_path,change):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,_=make_authorization(tmp_path);p=FakeProvider(change);r=FakeRuntime()
        result=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=r,sampler=lambda:{'fixture':True},job_timeout_s=1.)
        assert result.status=='failed' and result.usage.new_reserved==4 and result.cleanup_complete== (change!='close')
        assert p.calls<=1 and r.restored and p.closed
        if change in ('generic','one'):
            assert result.broker_state!='ready' and (result.diagnostic.stage,result.diagnostic.reason)==('story_validation','selection_invalid')
        if change=='diagnostic':assert result.diagnostic.reason=='json_invalid' and result.usage.new_charged==3
        if change=='fifth':assert result.usage.new_charged==4
    asyncio.run(run())


def test_partial_startup_failure_keeps_ownership_and_reservation(tmp_path):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,_=make_authorization(tmp_path);r=FakeRuntime(True);p=FakeProvider()
        result=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=r,sampler=lambda:{})
        assert result.status=='failed' and result.usage.new_charged==0 and result.usage.new_reserved==4
        assert r.started and r.restored and p.calls==0 and result.cleanup_complete
    asyncio.run(run())


def test_timeout_and_cancel_drain_without_new_admission(tmp_path):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,_=make_authorization(tmp_path);p=FakeProvider('slow');r=FakeRuntime()
        report=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=r,sampler=lambda:{},job_timeout_s=.015)
        assert report.status=='failed' and p.closed and not p.active and r.restored
        assert report.usage.new_charged<=4 and report.usage.new_reserved==4
    asyncio.run(run())


def test_report_write_failure_cannot_reopen_or_refund(tmp_path,monkeypatch):
    import timepitch.chronicles.canary as module
    original=module.atomic_write
    def broken(path,data):
        if path.name=='report.json':raise OSError('sentinel-private-path')
        return original(path,data)
    monkeypatch.setattr(module,'atomic_write',broken)
    async def run():
        a,_=make_authorization(tmp_path)
        report=await module.run_qwen_canary(a,root=tmp_path,provider_factory=FakeProvider,runtime_controller=FakeRuntime(),sampler=lambda:{})
        assert report.status=='failed' and 'report_persistence_failed' in report.errors
        assert report.usage.new_reserved==4 and report.usage.cumulative_charged==7
    asyncio.run(run())


def test_real_root_without_phase3_authorization_cannot_create_admission():
    from timepitch.chronicles.canary import main
    from timepitch.chronicles.canary_budget import canary_directory
    from timepitch.config import ROOT
    before=canary_directory(ROOT).exists()
    assert main(['--run'])==1 and canary_directory(ROOT).exists()==before


def test_real_sdk_mocktransport_runs_one_full_two_observation_canary(tmp_path,sdk):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,pack=make_authorization(tmp_path);s=sdk.scenario()
        s.source=pack;s.goal=next(f.id for f in pack.facts if f.kind=='goal')
        from timepitch.chronicles.models import fact_pack_hash
        s.hash=fact_pack_hash(pack)
        ids=[f.id for f in pack.facts if f.kind in ('goal','actor_stat','team_compare')][:2];s.ids=['result',*ids]
        original=s.respond
        async def full_story(request):
            response=await original(request)
            if len(s.requests)==4:
                data=json.loads(response.content)
                data['choices'][0]['message']['content']=json.dumps({'headline':{'fact_ids':['result'],'variant':0},'paragraphs':[{'fact_ids':ids,'variant':0}]})
                return type(response)(200,json=data)
            return response
        s.respond=full_story
        result=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:s.provider,runtime_controller=FakeRuntime(),sampler=lambda:{})
        assert result.status=='succeeded' and result.usage.new_charged==result.usage.new_response_headers==4
        assert result.usage.cumulative_charged==7 and result.broker_state=='ready'
        assert len(s.requests)==4 and s.provider.transport.client.client.max_retries==0
        assert all(body['max_completion_tokens']==512 for body in s.requests)
    sdk.run(run())


from test_chronicle_sdk_contract import sdk


@pytest.mark.parametrize('failure_stage',['catalog','load','inference'])
def test_owned_runtime_partial_load_is_journaled_and_only_its_changes_restored(tmp_path,monkeypatch,failure_stage):
    import timepitch.chronicles.canary_runtime as module
    from types import SimpleNamespace
    from timepitch.chronicles.models import MODEL
    directory=tmp_path/'private';directory.mkdir()
    exe=tmp_path/'.local/foundry-runtime/0.8.119/foundry.exe';exe.parent.mkdir(parents=True);exe.write_bytes(b'synthetic')
    (exe.parent/'AppxManifest.xml').write_text('<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Version="0.8.119.102"/></Package>',encoding='utf-8')
    native=FakeRuntime();monkeypatch.setattr(module,'inspect_native_absence',lambda _:native.inspect_absence())
    calls=[]
    monkeypatch.setattr(module,'verify_private_runtime',lambda *_:'http://127.0.0.1:54321')
    monkeypatch.setattr(module.subprocess,'Popen',lambda *a,**k:SimpleNamespace(pid=345,poll=lambda:None,wait=lambda timeout:0))
    def command(args,**kwargs):
        calls.append(args);return SimpleNamespace(returncode=0,stdout=b'8192')
    monkeypatch.setattr(module.subprocess,'run',command)
    info=SimpleNamespace(id=MODEL.split('@')[0],version='4',supports_tool_calling=True)
    class Manager:
        endpoint='http://127.0.0.1:54321/v1'
        def get_model_info(self,*a,**k):return info
        def list_cached_models(self):
            if failure_stage=='catalog':raise RuntimeError('synthetic-catalog-failure')
            return [info]
        def list_loaded_models(self):return []
        def load_model(self,*a,**k):
            if failure_stage=='load':raise RuntimeError('synthetic-partial-load')
    monkeypatch.setattr(module,'new_manager',lambda:Manager())
    controller=module.OwnedRuntimeController(tmp_path,directory)
    if failure_stage=='inference':
        controller.start_and_load();controller.mark_inference_started()
    else:
        with pytest.raises(RuntimeError):controller.start_and_load()
    changes=controller.owned_changes()
    assert changes.pid==345 and changes.runtime_started and changes.model_intent==(failure_stage!='catalog')
    if failure_stage in ('load','inference'):
        from timepitch.chronicles.canary_budget import CanaryRefused
        with pytest.raises(CanaryRefused):controller.restore(changes)
        assert not any(args[-2:]==['service','stop'] for args in calls)
    else:
        controller.restore(changes)
        assert any(args[-2:]==['service','stop'] for args in calls)


@pytest.mark.parametrize('stage',['setup','generation'])
def test_cancel_waits_for_owned_work_and_persists_terminal_usage(tmp_path,stage):
    import threading
    from timepitch.chronicles.canary import run_qwen_canary
    from timepitch.chronicles.canary_budget import canary_directory
    async def run():
        entered=threading.Event();release=threading.Event()
        class SlowRuntime(FakeRuntime):
            def start_and_load(self,timeout_s=120):
                entered.set()
                if stage=='setup':assert release.wait(5)
                return super().start_and_load(timeout_s)
        a,_=make_authorization(tmp_path);p=FakeProvider('slow');r=SlowRuntime()
        task=asyncio.create_task(run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=r,sampler=lambda:{}))
        async with asyncio.timeout(5):
            while not (entered.is_set() if stage=='setup' else p.active):await asyncio.sleep(.001)
        task.cancel()
        if stage=='setup':
            await asyncio.sleep(.01);assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):await task
        assert r.restored and not p.active
        raw=json.loads((canary_directory(tmp_path)/'report.json').read_text(encoding='utf-8'))
        assert raw['usage']['state']=='failed' and raw['usage']['new_reserved']==4
        assert raw['usage']['cumulative_reserved']==8
    asyncio.run(run())


def test_resource_sample_failure_stops_before_model_requests(tmp_path):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,_=make_authorization(tmp_path);p=FakeProvider();r=FakeRuntime()
        def broken():raise OSError('sentinel-resource-error')
        report=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=r,sampler=broken)
        assert report.status=='failed' and report.usage.new_charged==0 and report.usage.new_reserved==4
        assert p.calls==0 and r.restored and 'resource_sample_failed' in report.errors
    asyncio.run(run())


def test_lost_ack_keeps_original_receipt_without_second_generation(tmp_path,monkeypatch):
    from timepitch.chronicles.canary import run_qwen_canary
    from timepitch.chronicles.http_client import BrokerClient,BrokerError
    from timepitch.chronicles.canary_budget import canary_directory
    original=BrokerClient.complete;acks=[]
    async def lost(self,result):
        acks.append(result);await original(self,result);raise BrokerError('synthetic-ack-lost')
    monkeypatch.setattr(BrokerClient,'complete',lost)
    async def run():
        a,_=make_authorization(tmp_path);p=FakeProvider()
        report=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=FakeRuntime(),sampler=lambda:{})
        assert report.status=='failed' and report.broker_state=='ready' and p.calls==len(acks)==1
        assert report.usage.cumulative_charged==7
        saved=json.loads((canary_directory(tmp_path)/'active.json').read_text(encoding='utf-8'))
        assert saved['stage']=='result_saved' and saved['ack_attempts']==1
    asyncio.run(run())


def test_occupied_runtime_aborts_without_new_reservation_or_provider(tmp_path):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,_=make_authorization(tmp_path);r=FakeRuntime();r.present=True;p=FakeProvider()
        report=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=r,sampler=lambda:{})
        assert report.status=='aborted' and report.usage.state=='aborted'
        assert report.usage.cumulative_charged==3 and report.usage.cumulative_reserved==4
        assert not r.started and p.calls==0 and not p.closed
    asyncio.run(run())


def test_source_changed_during_generation_keeps_failed_report_without_invented_usage(tmp_path):
    from timepitch.chronicles.canary import run_qwen_canary
    async def run():
        a,_=make_authorization(tmp_path)
        class Changed(FakeProvider):
            async def generate(self,pack,locale,reserve):
                self.calls+=1;reserve(1)
                source=tmp_path/'.local/ai-worker-acceptance/pc-worker-20261019-1/timepitch-source.json'
                source.write_bytes(b'changed-synthetic-source');reserve(1)
        p=Changed()
        report=await run_qwen_canary(a,root=tmp_path,provider_factory=lambda:p,runtime_controller=FakeRuntime(),sampler=lambda:{})
        assert report.status=='failed' and report.usage is None
        assert 'usage_unavailable' in report.errors and 'broker_view_unavailable' in report.errors
        assert p.calls==1 and p.closed and report.diagnostic is not None
    asyncio.run(run())


@pytest.mark.parametrize('readiness_call',[1,2,3])
def test_cancelled_readiness_drains_its_thread_before_restore_and_unlock(tmp_path,sdk,readiness_call):
    import threading
    from timepitch.chronicles.canary import run_qwen_canary
    from timepitch.runtime import RuntimeLease
    async def run():
        a,_=make_authorization(tmp_path);s=sdk.scenario();r=FakeRuntime()
        entered=threading.Event();release=threading.Event();checks=0
        factory=s.provider.transport_factory;inspect=s.provider.inspect_model
        def blocked_factory():
            if readiness_call==1:entered.set();assert release.wait(5)
            return factory()
        def blocked_inspect(transport):
            nonlocal checks
            checks+=1
            if readiness_call>1 and checks==readiness_call:entered.set();assert release.wait(5)
            return inspect(transport)
        s.provider.transport_factory=blocked_factory;s.provider.inspect_model=blocked_inspect
        task=asyncio.create_task(run_qwen_canary(a,root=tmp_path,provider_factory=lambda:s.provider,runtime_controller=r,sampler=lambda:{}))
        try:
            async with asyncio.timeout(5):
                while not entered.is_set():await asyncio.sleep(.001)
            task.cancel();await asyncio.sleep(.02)
            assert not task.done() and not r.restored
            with pytest.raises(RuntimeError):
                with RuntimeLease(tmp_path/'.local/inference.lock'):pass
        finally:
            release.set()
            with pytest.raises(asyncio.CancelledError):await task
        assert r.restored and s.http.is_closed and not s.requests
    sdk.run(run())


def test_real_sdk_late_header_and_body_drain_preserve_first_failure(tmp_path,sdk):
    import httpx
    from timepitch.chronicles.canary import run_qwen_canary
    from timepitch.chronicles.canary_budget import CanaryBudget
    async def run():
        a,_=make_authorization(tmp_path);s=sdk.scenario('timeout');s.provider.timeout_s=.5
        original=s.respond;body_read=[]
        class Body(httpx.AsyncByteStream):
            def __init__(self,raw):self.raw=raw
            async def __aiter__(self):body_read.append(True);yield self.raw
        async def delayed(request):
            response=await original(request)
            return httpx.Response(200,stream=Body(response.content))
        s.respond=delayed
        task=asyncio.create_task(run_qwen_canary(a,root=tmp_path,provider_factory=lambda:s.provider,runtime_controller=FakeRuntime(),sampler=lambda:{},job_timeout_s=3.))
        try:
            await asyncio.wait_for(s.entered.wait(),5)
            b=CanaryBudget(a,root=tmp_path)
            async with asyncio.timeout(5):
                while b.snapshot().state!='failed':await asyncio.sleep(.005)
            assert not task.done()
        finally:s.release.set()
        report=await task
        assert report.status=='failed' and report.usage.new_charged==report.usage.new_response_headers==1
        assert body_read and s.http.is_closed and not s.provider.executor._pending
        assert len(s.requests)==1 and report.diagnostic.reason=='operation_timeout'
    sdk.run(run())


@pytest.mark.parametrize('native_state',['present','unknown'])
def test_stop_ack_does_not_prove_native_children_have_exited(tmp_path,monkeypatch,native_state):
    from types import SimpleNamespace
    import timepitch.chronicles.canary_runtime as module
    from timepitch.chronicles.canary_budget import CanaryRefused
    d=tmp_path/'private';d.mkdir();r=module.OwnedRuntimeController(tmp_path,d);n=FakeRuntime()
    r._save(runtime_intent=True,runtime_started=True,pid=123)
    r.process=SimpleNamespace(pid=123,poll=lambda:None,wait=lambda timeout:0)
    if native_state=='present':n.present=True
    else:n.complete=False
    monkeypatch.setattr(r,'inspect_absence',n.inspect_absence)
    monkeypatch.setattr(module,'verify_private_runtime',lambda *_:None)
    monkeypatch.setattr(module.subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=0))
    with pytest.raises(CanaryRefused):r.restore(r.owned_changes())


@pytest.mark.parametrize('free_mib',[b'1',b'4095',b'unknown',b''])
def test_insufficient_or_unknown_vram_refuses_before_startup(tmp_path,monkeypatch,free_mib):
    from types import SimpleNamespace
    import timepitch.chronicles.canary_runtime as module
    from timepitch.chronicles.canary_budget import CanaryRefused
    d=tmp_path/'private';d.mkdir();r=module.OwnedRuntimeController(tmp_path,d);n=FakeRuntime()
    r.exe.parent.mkdir(parents=True);r.exe.write_bytes(b'synthetic')
    (r.exe.parent/'AppxManifest.xml').write_text('<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Version="0.8.119.102"/></Package>',encoding='utf-8')
    monkeypatch.setattr(r,'inspect_absence',n.inspect_absence)
    monkeypatch.setattr(module.subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=0,stdout=free_mib))
    starts=[]
    def start(*a,**k):starts.append(True);raise RuntimeError('should never start')
    monkeypatch.setattr(module.subprocess,'Popen',start)
    with pytest.raises(CanaryRefused):r.start_and_load()
    assert not starts and not r.owned_changes().runtime_intent
