import asyncio
import json
import pytest
from test_chronicle_worker_client import claim
from test_chronicle_worker_state import box,state
from test_chronicle_repository import result
from timepitch.chronicles.models import ProviderReceipt, WorkerStatus
from timepitch.chronicles.http_client import BrokerError
from timepitch.chronicles.worker_state import RecoveryRequired
from timepitch.chronicles.worker import run_worker


class Client:
    def __init__(self,stop,fail=0): self.stop=stop; self.fail=fail; self.claims=0; self.sent=0; self.beats=0; self.closed=False
    async def claim(self,model_ready): self.claims+=1; return claim()
    async def heartbeat(self,lease,model_ready): self.beats+=1; return WorkerStatus(state='busy' if lease else 'ready')
    async def complete(self,receipt):
        self.sent+=1
        if self.sent<=self.fail: raise BrokerError('offline')
        self.stop.set()
    async def close(self): self.closed=True


class Provider:
    def __init__(self,stop=None,delay=0): self.calls=0; self.stop=stop; self.delay=delay; self.closed=False; self.active=False
    async def readiness(self): return True
    async def generate(self,pack,locale,reserve):
        self.calls+=1; self.active=True
        if self.stop: self.stop.set()
        await asyncio.sleep(self.delay); reserve(4); self.active=False
        return ProviderReceipt(selection=result(claim()).selection,actual_calls=4,evidence_reads=1,elapsed_ms=1.)
    async def close(self): assert not self.active; self.closed=True


def test_normal_worker_retries_ack_only_and_persists_receipt(tmp_path):
    async def run():
        stop=asyncio.Event(); client=Client(stop,fail=2); provider=Provider(); out=box(tmp_path)
        delays=[]
        async def wait(seconds): delays.append(seconds)
        await run_worker(client,provider,out,stop,clock=lambda:1800.,sleep=wait)
        assert client.claims==provider.calls==1 and client.sent==3
        assert out.load() is None and client.closed and provider.closed and delays==[1,2]
    asyncio.run(run())


def test_uncertain_startup_makes_zero_claims_and_inferences(tmp_path):
    async def run():
        out=box(tmp_path); out.save(state('generation_started'))
        stop=asyncio.Event(); client=Client(stop); provider=Provider()
        with pytest.raises(RecoveryRequired): await run_worker(client,provider,out,stop,clock=lambda:1800.)
        assert client.claims==provider.calls==0
    asyncio.run(run())


def test_saved_receipt_resumes_original_lease_without_generation(tmp_path):
    async def run():
        out=box(tmp_path); out.save(state('result_saved'))
        stop=asyncio.Event(); client=Client(stop); provider=Provider()
        await run_worker(client,provider,out,stop,clock=lambda:1800.)
        assert client.claims==provider.calls==0 and client.sent==1 and out.load() is None
    asyncio.run(run())


def test_stop_during_generation_drains_and_never_claims_again(tmp_path):
    async def run():
        stop=asyncio.Event(); client=Client(stop); provider=Provider(stop,delay=.025); out=box(tmp_path)
        await run_worker(client,provider,out,stop,clock=lambda:1800.,heartbeat_seconds=.005)
        assert provider.calls==client.claims==1 and client.sent==0 and client.beats>=1
        assert out.load().stage=='result_saved' and provider.closed
    asyncio.run(run())


def test_ack_attempts_persist_across_restart_and_never_exceed_three(tmp_path):
    async def run():
        out=box(tmp_path); saved=state('result_saved'); saved.ack_attempts=2; out.save(saved)
        stop=asyncio.Event(); client=Client(stop,fail=10); provider=Provider()
        with pytest.raises(RecoveryRequired): await run_worker(client,provider,out,stop,clock=lambda:1800.)
        assert client.sent==1 and provider.calls==client.claims==0 and out.load().ack_attempts==3
    asyncio.run(run())


def test_expired_receipt_cannot_be_sent_or_regenerated(tmp_path):
    async def run():
        out=box(tmp_path); out.save(state('result_saved')); stop=asyncio.Event(); client=Client(stop); provider=Provider()
        with pytest.raises(RecoveryRequired): await run_worker(client,provider,out,stop,clock=lambda:2001.)
        assert client.sent==client.claims==provider.calls==0
    asyncio.run(run())


def test_not_ready_does_not_claim_and_scheduler_backoff_is_bounded(tmp_path):
    async def run():
        stop=asyncio.Event(); client=Client(stop); provider=Provider()
        async def unavailable(): return False
        provider.readiness=unavailable
        delays=[]
        async def wait(seconds): delays.append(seconds); stop.set()
        await run_worker(client,provider,box(tmp_path),stop,clock=lambda:1800.,sleep=wait)
        assert client.claims==provider.calls==0 and client.beats==1
        stop=asyncio.Event(); client=Client(stop); provider=Provider(); delays=[]
        async def offline(model_ready): raise BrokerError('offline')
        client.claim=offline
        async def wait(seconds):
            delays.append(seconds)
            if len(delays)==6: stop.set()
        await run_worker(client,provider,box(tmp_path),stop,clock=lambda:1800.,sleep=wait)
        assert delays==[1,2,4,8,15,15] and provider.calls==0
    asyncio.run(run())


def test_generation_heartbeat_loss_does_not_start_another_job(tmp_path):
    async def run():
        stop=asyncio.Event(); client=Client(stop); provider=Provider(delay=.025)
        normal=client.heartbeat
        async def broken(lease,model_ready):
            if provider.active: raise BrokerError('stale',permanent=True)
            return await normal(lease,model_ready)
        client.heartbeat=broken
        with pytest.raises(RecoveryRequired):
            await run_worker(client,provider,box(tmp_path),stop,clock=lambda:1800.,heartbeat_seconds=.005)
        assert provider.calls==client.claims==1 and client.sent==0 and provider.closed
    asyncio.run(run())


def test_config_check_only_never_constructs_provider_or_opens_network(tmp_path,monkeypatch):
    import json
    import timepitch.chronicles.worker as worker
    import timepitch.chronicles.provider as model
    from test_chronicle_worker_client import ORIGIN,TOKEN
    directory=tmp_path/'.local/ai-worker'; directory.mkdir(parents=True)
    config=directory/'config.json'; config.write_text(json.dumps({'origin':ORIGIN,'worker_id':'test-worker','token':TOKEN}))
    monkeypatch.setattr(worker,'check_private_acl',lambda _:None)
    def forbidden(*args,**kwargs): pytest.fail('No provider or HTTP client may be created')
    monkeypatch.setattr(model,'FoundryChronicleProvider',forbidden)
    import timepitch.chronicles.http_client as broker
    monkeypatch.setattr(broker,'BrokerClient',forbidden)
    value,binding=worker.read_config(config,tmp_path)
    assert TOKEN not in repr(value) and TOKEN not in binding
    message=asyncio.run(worker.worker_main(config,check_only=True,root=tmp_path))
    assert 'No model checked or started' in message
    from timepitch.runtime import RuntimeLease
    with RuntimeLease(tmp_path/'.local/inference.lock'):
        with pytest.raises(RuntimeError): asyncio.run(worker.worker_main(config,check_only=True,root=tmp_path))


def test_private_acl_rejection_blocks_configuration(tmp_path,monkeypatch):
    import json
    import timepitch.chronicles.worker as worker
    from test_chronicle_worker_client import ORIGIN,TOKEN
    config=tmp_path/'.local/config.json'; config.parent.mkdir(); config.write_text(json.dumps({'origin':ORIGIN,'worker_id':'test-worker','token':TOKEN}))
    def denied(_): raise RecoveryRequired('Permissions are not private')
    monkeypatch.setattr(worker,'check_private_acl',denied)
    with pytest.raises(RecoveryRequired): worker.read_config(config,tmp_path)


def test_stop_during_claim_does_not_start_generation(tmp_path):
    async def run():
        stop=asyncio.Event(); client=Client(stop); provider=Provider(); out=box(tmp_path)
        original=client.claim
        async def stop_then_claim(ready):
            value=await original(ready); stop.set(); return value
        client.claim=stop_then_claim
        await run_worker(client,provider,out,stop,clock=lambda:1800.)
        assert provider.calls==0 and client.claims==1 and out.load().stage=='claimed'
    asyncio.run(run())


def test_outbox_failure_during_generation_drains_before_shutdown(tmp_path):
    async def run():
        stop=asyncio.Event(); client=Client(stop); provider=Provider(delay=.025); out=box(tmp_path)
        save=out.save
        def broken(value):
            if provider.active: raise OSError('Synthetic disk failure')
            return save(value)
        out.save=broken
        with pytest.raises(RecoveryRequired):
            await run_worker(client,provider,out,stop,clock=lambda:1800.,heartbeat_seconds=.005)
        assert provider.closed and not provider.active and client.claims==1
    asyncio.run(run())


def test_real_windows_acl_allows_private_directory_and_rejects_broad_read(tmp_path):
    import os
    import subprocess
    from timepitch.chronicles.worker import check_private_acl
    if os.name!='nt': pytest.skip('Windows ACL check')
    script="""
$ErrorActionPreference='Stop'
$path=$env:TIMEPITCH_TEST_PRIVATE_DIR
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
if($env:TIMEPITCH_TEST_BROAD -eq '1') {
 $users=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
 $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($users,'ReadAndExecute','Allow'))
}
[System.IO.Directory]::CreateDirectory($path,$acl) | Out-Null
"""
    for broad in ('0','1'):
        directory=tmp_path/('private-'+broad)
        completed=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],
            env={**{key:value for key,value in os.environ.items() if key.lower()!='psmodulepath'},
                 'TIMEPITCH_TEST_PRIVATE_DIR':str(directory),'TIMEPITCH_TEST_BROAD':broad},capture_output=True,timeout=15)
        assert completed.returncode==0,'Synthetic private ACL setup failed'
        if broad=='0': check_private_acl(directory)
        else:
            with pytest.raises(RecoveryRequired): check_private_acl(directory)


def diagnostic_failure():
    from timepitch.chronicles.diagnostics import ChronicleProviderError,ProviderDiagnostic
    return ChronicleProviderError(ProviderDiagnostic(stage='analysis',reason='json_invalid',
        http_admitted=3,response_headers_received=3,evidence_reads=1,elapsed_ms=5.0,json_line=1,json_column=2))


class DiagnosticProvider(Provider):
    async def generate(self,pack,locale,reserve):
        self.calls+=1;reserve(3)
        raise diagnostic_failure()


def test_worker_persists_bound_safe_diagnostic_without_retry_or_lease_secret(tmp_path):
    async def run():
        stop=asyncio.Event();client=Client(stop);provider=DiagnosticProvider();out=box(tmp_path)
        with pytest.raises(RecoveryRequired) as caught:
            await run_worker(client,provider,out,stop,clock=lambda:1800.)
        saved=out.read_diagnostic(claim().lease)
        assert saved.error_category=='ModelOutputError' and saved.diagnostic.reason=='json_invalid'
        assert saved.diagnostic.http_admitted==saved.diagnostic.response_headers_received==3
        assert saved.fact_hash==claim().lease.fact_hash
        raw=out.diagnostic_path(claim().lease).read_bytes()
        assert len(raw)<=8192 and claim().lease.lease_token.encode() not in raw
        assert client.claims==provider.calls==1 and client.sent==0
        assert out.load().stage=='generation_started'
        assert caught.value.diagnostic==saved.diagnostic
        original=raw
        other=DiagnosticProvider();next_client=Client(stop)
        with pytest.raises(RecoveryRequired): await run_worker(next_client,other,out,stop,clock=lambda:1800.)
        assert next_client.claims==other.calls==0
        assert out.diagnostic_path(claim().lease).read_bytes()==original
        assert out.read_diagnostic(claim().lease.model_copy(update={'generation':2})) is None
    asyncio.run(run())


def test_worker_legacy_error_has_unknown_metadata_and_never_persists_messages(tmp_path):
    async def run():
        p=Provider();client=Client(asyncio.Event());out=box(tmp_path)
        async def broken(*args): raise ValueError('credential-sentinel player-sentinel path-sentinel')
        p.generate=broken
        with pytest.raises(RecoveryRequired): await run_worker(client,p,out,client.stop,clock=lambda:1800.)
        saved=out.read_diagnostic(claim().lease)
        assert saved.diagnostic.stage=='unknown' and saved.diagnostic.reason=='unclassified_failure'
        assert saved.diagnostic.http_admitted is None and saved.diagnostic.response_headers_received is None
        assert 'sentinel' not in out.diagnostic_path(claim().lease).read_text(encoding='utf-8')
    asyncio.run(run())


def test_worker_diagnostic_write_failure_preserves_original_failure_and_uncertain_journal(tmp_path,monkeypatch):
    from timepitch.chronicles.diagnostics import safe_diagnostic
    import timepitch.chronicles.worker_state as module
    original=module.atomic_write
    def broken(path,data):
        if path.name.endswith('.diagnostic.json'): raise OSError('private-path-sentinel')
        return original(path,data)
    monkeypatch.setattr(module,'atomic_write',broken)
    async def run():
        p=DiagnosticProvider();client=Client(asyncio.Event());out=box(tmp_path)
        with pytest.raises(RecoveryRequired) as caught: await run_worker(client,p,out,client.stop,clock=lambda:1800.)
        assert safe_diagnostic(caught.value).reason=='json_invalid'
        assert caught.value.diagnostic_persistence_error=='diagnostic_persistence_failed'
        assert out.load().stage=='generation_started' and client.sent==0 and p.calls==1
        assert not out.diagnostic_path(claim().lease).exists()
    asyncio.run(run())


def test_cancelled_worker_preserves_cancellation_and_first_snapshot_while_draining(tmp_path):
    from timepitch.chronicles.diagnostics import ProviderDiagnostic
    async def run():
        p=Provider();client=Client(asyncio.Event());out=box(tmp_path)
        async def generate(pack,locale,reserve):
            p.calls+=1;p.active=True
            try:
                reserve(1);await asyncio.sleep(.04)
                return ProviderReceipt(selection=result(claim()).selection,actual_calls=1,evidence_reads=1,elapsed_ms=1.)
            except asyncio.CancelledError as error:
                error.diagnostic=ProviderDiagnostic(stage='evidence',reason='cancelled',http_admitted=1,response_headers_received=0,evidence_reads=0)
                raise
            finally: p.active=False
        p.generate=generate
        task=asyncio.create_task(run_worker(client,p,out,client.stop,clock=lambda:1800.,heartbeat_seconds=.005))
        while not p.active: await asyncio.sleep(.001)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        saved=out.read_diagnostic(claim().lease)
        assert saved.diagnostic.reason=='cancelled' and saved.diagnostic.http_admitted==1
        assert out.load().stage=='generation_started' and p.closed and client.sent==0 and p.calls==1
    asyncio.run(run())


def test_rejected_ack_preserves_receipt_and_diagnostic_then_only_resumes_delivery(tmp_path):
    async def run():
        stop=asyncio.Event();client=Client(stop);p=Provider();out=box(tmp_path)
        async def denied(value):
            client.sent+=1;raise BrokerError('credential-sentinel',permanent=True)
        client.complete=denied
        with pytest.raises(RecoveryRequired): await run_worker(client,p,out,stop,clock=lambda:1800.)
        saved=out.read_diagnostic(claim().lease)
        assert saved.diagnostic.stage=='broker_delivery' and saved.error_category=='BrokerError'
        assert out.load().stage=='result_saved' and out.load().ack_attempts==1 and p.calls==1
        raw=out.diagnostic_path(claim().lease).read_bytes()
        resumed=Provider();next_client=Client(stop)
        await run_worker(next_client,resumed,out,stop,clock=lambda:1800.)
        assert resumed.calls==next_client.claims==0 and next_client.sent==1 and out.load() is None
        assert out.diagnostic_path(claim().lease).read_bytes()==raw
    asyncio.run(run())


def test_cancellation_during_failed_generation_cleanup_drains_and_carries_first_failure(tmp_path):
    from timepitch.agents.provider import LocalModelTimeout
    from timepitch.chronicles.diagnostics import ProviderDiagnostic,safe_diagnostic
    async def run():
        closing=asyncio.Event();p=Provider();out=box(tmp_path);client=Client(asyncio.Event())
        async def failed(*args):
            p.calls+=1;error=LocalModelTimeout('synthetic-timeout')
            error.diagnostic=ProviderDiagnostic(stage='analysis',reason='operation_timeout',http_admitted=3,response_headers_received=2,evidence_reads=1)
            raise error
        async def close():
            closing.set();await asyncio.sleep(.03);p.closed=True
        p.generate=failed;p.close=close
        task=asyncio.create_task(run_worker(client,p,out,client.stop,clock=lambda:1800.))
        await closing.wait();task.cancel()
        with pytest.raises(asyncio.CancelledError) as caught:await task
        assert p.closed and p.calls==1 and client.sent==0
        assert safe_diagnostic(caught.value).reason=='operation_timeout'
        assert caught.value.chronicle_error_category=='LocalModelTimeout'
        assert out.read_diagnostic(claim().lease).diagnostic.reason=='operation_timeout'
    asyncio.run(run())
