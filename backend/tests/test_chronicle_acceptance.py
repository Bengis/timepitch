import asyncio,json
from hashlib import sha256
import pytest
from chronicle_fixtures import pack
from timepitch.chronicles.models import ProviderReceipt
from timepitch.chronicles.acceptance import AcceptanceBudget,AcceptanceRefused,run_gpu_acceptance


def setup(tmp_path,monkeypatch):
    import timepitch.chronicles.acceptance as module
    directory=tmp_path/'.local/ai-worker-acceptance/pc-worker-20261019-1'; directory.mkdir(parents=True)
    sources={}
    packs={e:pack().model_copy(update={'engine':e}) for e in ('timepitch','grf')}
    for engine in packs:
        p=directory/(engine+'.json'); p.write_text('{}')
        sources[engine]={'file':p.name,'sha256':sha256(p.read_bytes()).hexdigest()}
    manifest=directory/'manifest.json'; manifest.write_text(json.dumps({'grant':'pc-worker-20261019-1','profile':'fake','sources':sources}))
    monkeypatch.setattr(module,'load_sources',lambda _: (json.loads(manifest.read_text()),packs))
    usage=directory/'usage.sqlite'; AcceptanceBudget.initialize(usage,sha256(manifest.read_bytes()).hexdigest(),grant_root=directory)
    return manifest,usage


class Provider:
    def __init__(self,fail=False): self.fail=fail
    async def readiness(self): return True
    async def generate(self,pack,locale,reserve):
        for _ in range(4): reserve(1)
        if self.fail: raise ValueError('synthetic rejection')
        goal=next(f.id for f in pack.facts if f.kind=='goal')
        second=next(f.id for f in pack.facts if f.kind in ('actor_stat','team_compare'))
        return ProviderReceipt(selection={'headline':{'fact_ids':['result'],'variant':0},
            'paragraphs':[{'fact_ids':[goal,second],'variant':0}]},actual_calls=4,evidence_reads=1,elapsed_ms=1.)
    async def close(self): pass


def test_acceptance_three_reports_no_public_slot_no_regeneration(tmp_path,monkeypatch):
    manifest,usage=setup(tmp_path,monkeypatch)
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=Provider,sampler=lambda:{'fixture':True},root=tmp_path))
    assert report.status=='passed' and len(report.slot_receipts)==4 and report.charged_calls==report.reserved_calls==16
    assert report.remaining_slots==['grf-es-public'] and not (tmp_path/'.local/inference-uncertain.json').exists()
    with pytest.raises(AcceptanceRefused): asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=Provider,root=tmp_path))


def test_rejection_stops_grant_and_quarantines_shared_inference(tmp_path,monkeypatch):
    from timepitch.runtime import RuntimeLease
    manifest,usage=setup(tmp_path,monkeypatch)
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=lambda:Provider(True),sampler=lambda:{'fixture':True},root=tmp_path))
    assert report.status=='failed' and report.charged_calls==4 and len(report.slot_receipts)==1
    with pytest.raises(RuntimeError):
        with RuntimeLease(tmp_path/'.local/inference.lock'): pass


def test_active_job_deadline_stops_unready_provider(tmp_path,monkeypatch):
    manifest,usage=setup(tmp_path,monkeypatch)
    class Stuck(Provider):
        async def readiness(self): await asyncio.Event().wait()
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=Stuck,sampler=lambda:{'fixture':True},root=tmp_path,job_timeout_s=.02))
    assert report.status=='failed' and report.charged_calls==0 and report.reserved_calls==4
    (usage.parent/'report.json').unlink()
    with pytest.raises(AcceptanceRefused): asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=Provider,root=tmp_path))


def test_generic_coverage_cannot_count_as_a_football_chronicle():
    from timepitch.chronicles.acceptance import validate_story
    from timepitch.chronicles.models import ChronicleSelection
    p=pack(); p.coverage.events_complete=False
    selection=ChronicleSelection(headline={'fact_ids':['result'],'variant':0},paragraphs=[{'fact_ids':['coverage'],'variant':0}])
    with pytest.raises(AcceptanceRefused): validate_story(p,selection,'es')


def test_resource_sampler_limits_process_lookup_to_runtime_names(monkeypatch):
    import os
    from types import SimpleNamespace
    import timepitch.chronicles.acceptance as module
    calls=[]
    def run(args,**kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0,stdout=b'100' if args[0]=='nvidia-smi' else b'0')
    monkeypatch.setattr(module,'sample_resources',module.sample_resources)
    import subprocess
    monkeypatch.setattr(subprocess,'run',run)
    sample=module.sample_resources()
    assert sample['gpu_total_used_mib']==100
    if os.name=='nt': assert 'Get-Process -Name' in calls[-1][-1]


class DiagnosticProvider(Provider):
    async def generate(self,pack,locale,reserve):
        from test_chronicle_worker import diagnostic_failure
        for _ in range(3):reserve(1)
        raise diagnostic_failure()


@pytest.mark.parametrize('fail_slot',['preflight','timepitch-en'])
def test_acceptance_preserves_provider_diagnostic_and_stable_category(fail_slot,tmp_path,monkeypatch):
    manifest,usage=setup(tmp_path,monkeypatch);created=[]
    def factory():
        p=Provider() if fail_slot=='timepitch-en' and not created else DiagnosticProvider()
        created.append(p);return p
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=factory,sampler=lambda:{'fixture':True},root=tmp_path))
    failed=report.slot_receipts[-1]
    assert report.status=='failed' and failed['slot']==fail_slot and failed['error']=='ModelOutputError'
    assert failed['diagnostic']['stage']=='analysis' and failed['diagnostic']['reason']=='json_invalid'
    assert failed['diagnostic']['http_admitted']==3 and failed['diagnostic']['response_headers_received']==3
    assert report.charged_calls==(3 if fail_slot=='preflight' else 7)
    assert report.reserved_calls==(4 if fail_slot=='preflight' else 8)
    assert (tmp_path/'.local/inference-uncertain.json').exists()
    with pytest.raises(AcceptanceRefused):
        asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=factory,root=tmp_path))


def test_acceptance_failed_report_write_cannot_mask_original_failure_or_reset_allowance(tmp_path,monkeypatch):
    import timepitch.chronicles.acceptance as module
    manifest,usage=setup(tmp_path,monkeypatch);original=module.atomic_write
    def broken(path,data):
        if path.name=='report.json': raise OSError('private-path-sentinel')
        return original(path,data)
    monkeypatch.setattr(module,'atomic_write',broken)
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=DiagnosticProvider,sampler=lambda:{'fixture':True},root=tmp_path))
    assert report.status=='failed' and 'report_persistence_failed' in report.errors
    assert report.slot_receipts[0]['diagnostic']['reason']=='json_invalid' and report.charged_calls==3
    assert AcceptanceBudget(usage,sha256(manifest.read_bytes()).hexdigest(),grant_root=usage.parent).snapshot()['preflight']['state']=='failed'
    assert (tmp_path/'.local/inference-uncertain.json').exists()


def test_provider_close_error_cannot_mask_original_diagnostic_or_leave_slot_running(tmp_path,monkeypatch):
    manifest,usage=setup(tmp_path,monkeypatch)
    class CloseError(DiagnosticProvider):
        async def close(self): raise OSError('private-path-sentinel')
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=CloseError,sampler=lambda:{'fixture':True},root=tmp_path))
    assert report.slot_receipts[0]['error']=='ModelOutputError'
    assert report.slot_receipts[0]['diagnostic']['reason']=='json_invalid' and 'provider_close_failed' in report.errors
    assert AcceptanceBudget(usage,sha256(manifest.read_bytes()).hexdigest(),grant_root=usage.parent).snapshot()['preflight']['state']=='failed'


def test_acceptance_cancellation_writes_terminal_report_without_resuming(tmp_path,monkeypatch):
    from timepitch.chronicles.diagnostics import ProviderDiagnostic
    manifest,usage=setup(tmp_path,monkeypatch)
    class Cancelled(Provider):
        async def generate(self,pack,locale,reserve):
            reserve(1)
            error=asyncio.CancelledError()
            error.diagnostic=ProviderDiagnostic(stage='evidence',reason='cancelled',http_admitted=1,response_headers_received=0,evidence_reads=0)
            raise error
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=Cancelled,sampler=lambda:{'fixture':True},root=tmp_path))
    report=json.loads((usage.parent/'report.json').read_text(encoding='utf-8'))
    assert report['status']=='failed' and report['slot_receipts'][0]['diagnostic']['reason']=='cancelled'
    assert report['charged_calls']==1 and report['reserved_calls']==4
    assert (tmp_path/'.local/inference-uncertain.json').exists()


def test_cleanup_failure_after_accepted_slot_halts_before_any_new_admission(tmp_path,monkeypatch):
    manifest,usage=setup(tmp_path,monkeypatch);created=[]
    class BadSecondClose(Provider):
        def __init__(self):super().__init__();self.closes=0
        async def close(self):
            self.closes+=1
            if self.closes==2:raise OSError('synthetic-close-failure')
    def factory():
        p=BadSecondClose();created.append(p);return p
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=factory,sampler=lambda:{'fixture':True},root=tmp_path))
    assert report.status=='failed' and len(created)==len(report.slot_receipts)==1
    assert report.slot_receipts[0]['state']=='accepted' and report.charged_calls==4
    b=AcceptanceBudget(usage,sha256(manifest.read_bytes()).hexdigest(),grant_root=usage.parent)
    assert b.snapshot()['timepitch-en']['state']=='pending'
    with pytest.raises(AcceptanceRefused):b.begin('timepitch-en')


def test_cancel_during_final_cleanup_drains_and_never_runs_the_next_slot(tmp_path,monkeypatch):
    manifest,usage=setup(tmp_path,monkeypatch)
    async def run():
        closing=asyncio.Event();created=[]
        class SlowClose(Provider):
            def __init__(self):super().__init__();self.closes=0;self.drained=False
            async def close(self):
                self.closes+=1
                if self.closes==2:
                    closing.set();await asyncio.sleep(.03);self.drained=True
        def factory():
            p=SlowClose();created.append(p);return p
        task=asyncio.create_task(run_gpu_acceptance(manifest,usage,provider_factory=factory,sampler=lambda:{'fixture':True},root=tmp_path))
        await closing.wait();task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
        assert len(created)==1 and created[0].drained
        report=json.loads((usage.parent/'report.json').read_text(encoding='utf-8'))
        assert len(report['slot_receipts'])==1 and report['charged_calls']==4
    asyncio.run(run())


def test_job_timeout_during_worker_drain_keeps_the_original_provider_snapshot(tmp_path,monkeypatch):
    from timepitch.agents.provider import LocalModelTimeout
    from timepitch.chronicles.diagnostics import ProviderDiagnostic
    manifest,usage=setup(tmp_path,monkeypatch);created=[];deadlines=[]
    original_timeout=asyncio.timeout
    def controlled_timeout(_):
        deadline=original_timeout(None);deadlines.append(deadline);return deadline
    monkeypatch.setattr(asyncio,'timeout',controlled_timeout)
    class TimedOut(Provider):
        async def generate(self,pack,locale,reserve):
            reserve(3);error=LocalModelTimeout('synthetic-timeout')
            error.diagnostic=ProviderDiagnostic(stage='analysis',reason='operation_timeout',http_admitted=3,response_headers_received=2,evidence_reads=1)
            raise error
        async def close(self):
            if not getattr(self,'closing',False):
                self.closing=True
                deadlines[-1].reschedule(asyncio.get_running_loop().time()+.01)
                await asyncio.sleep(.03)
    def factory():
        p=Provider() if not created else TimedOut();created.append(p);return p
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=factory,sampler=lambda:{'fixture':True},root=tmp_path,job_timeout_s=.05))
    failed=report.slot_receipts[-1]
    assert len(created)==2 and failed['error']=='LocalModelTimeout'
    assert failed['diagnostic']['stage']=='analysis' and failed['diagnostic']['reason']=='operation_timeout'
    assert failed['diagnostic']['http_admitted']==3 and report.charged_calls==7


def test_owned_acceptance_refusal_category_is_preserved(tmp_path,monkeypatch):
    manifest,usage=setup(tmp_path,monkeypatch)
    class NotReady(Provider):
        async def readiness(self):return False
    report=asyncio.run(run_gpu_acceptance(manifest,usage,provider_factory=NotReady,sampler=lambda:{'fixture':True},root=tmp_path))
    assert report.slot_receipts[0]['error']=='AcceptanceRefused' and report.charged_calls==0
