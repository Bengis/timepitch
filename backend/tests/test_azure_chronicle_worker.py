"""Serial worker lifecycle on synthetic grants and saved fixtures, never inference."""
import asyncio
import importlib
import importlib.util
import sqlite3
from types import SimpleNamespace
import pytest
from azure_chronicle_fixtures import ready, request, source, raw, forbid_runtime
from timepitch.chronicles.azure.settings import AzureSettings
from timepitch.chronicles.azure.service import AzureChronicleService
from timepitch.chronicles.azure.models import AzureReceipt,ChronicleDraft


def api():
    assert importlib.util.find_spec('timepitch.chronicles.azure.worker'), 'Azure worker not implemented'
    return importlib.import_module('timepitch.chronicles.azure.worker')


@pytest.fixture
def env(monkeypatch,tmp_path):
    loop=asyncio.new_event_loop();forbid_runtime(monkeypatch)
    repo,clock,b,_=ready(tmp_path/'runtime.sqlite',calls=2)
    service=AzureChronicleService(repo,lambda *_:source(),AzureSettings(mode='public',binding=b))
    provider=FakeProvider()
    try:yield SimpleNamespace(service=service,repo=repo,clock=clock,binding=b,provider=provider,run=loop.run_until_complete,root=tmp_path)
    finally:loop.run_until_complete(loop.shutdown_asyncgens());loop.close()


class FakeProvider:
    def __init__(self):self.calls=0;self.closed=False;self.crash=False
    async def generate(self,prepared,authorize):
        permit=authorize(prepared);self.calls+=1
        if self.crash:raise SystemExit('synthetic crash after reservation')
        return AzureReceipt(attempt_id=permit.attempt_id,request_hash=permit.request_hash,
            model='synthetic-model',provider_request_id='fabricated',draft=ChronicleDraft(**raw()),error=None,
            elapsed_ms=1,input_tokens=12,output_tokens=20,reasoning_tokens=4)
    async def close(self):self.closed=True


def test_once_finishes_only_one_queued_job(env):
    e=env;one=e.service.submit('alice',request());two=e.service.submit('alice',request('two'))
    outcome=e.run(api().run_once(e.service,e.provider,'worker'))
    assert outcome.state=='ready' and outcome.job_id==one.id and e.provider.calls==1
    assert e.repo.get('alice',two.id).state=='queued'
    assert e.repo.usage()['actual_input_tokens']==12
    assert not e.repo.get('alice',one.id).checked.semantic_verified


@pytest.mark.parametrize('stage',['before_reserve','after_reserve'])
def test_crash_before_and_after_send_does_not_requeue(env,monkeypatch,stage):
    e=env;w=api();job=e.service.submit('alice',request())
    if stage=='before_reserve':
        def crash(*_):raise SystemExit('synthetic crash before reservation')
        monkeypatch.setattr(w,'prepare_request',crash)
    else:e.provider.crash=True
    with pytest.raises(SystemExit):e.run(w.run_once(e.service,e.provider,'first'))
    monkeypatch.undo();other=FakeProvider()
    result=e.run(w.run_once(e.service,other,'second'))
    assert result.state in ('unavailable','uncertain') and other.calls==0
    assert e.repo.get('alice',job.id).state=='unavailable'
    assert e.repo.usage()['charged_calls']==(1 if stage=='after_reserve' else 0)


@pytest.mark.parametrize('stage',['before_completion','after_completion'])
def test_saved_receipt_completion_replays_without_generation(env,monkeypatch,stage):
    e=env;w=api();job=e.service.submit('alice',request());complete=e.service.complete
    def crash(*args):
        if stage=='after_completion':complete(*args)
        raise SystemExit('synthetic lost acknowledgement')
    monkeypatch.setattr(e.service,'complete',crash)
    with pytest.raises(SystemExit):e.run(w.run_once(e.service,e.provider,'first'))
    monkeypatch.setattr(e.service,'complete',complete);other=FakeProvider()
    result=e.run(w.run_once(e.service,other,'second'))
    assert result.state=='ready' and other.calls==0
    assert e.repo.get('alice',job.id).state=='ready'
    assert e.repo.usage()['charged_calls']==1


def test_late_receipt_cannot_replace_terminal_job(env,monkeypatch):
    e=env;job=e.service.submit('alice',request());original=e.provider.generate
    async def expire(*args):
        receipt=await original(*args);e.clock.now+=181;return receipt
    monkeypatch.setattr(e.provider,'generate',expire)
    outcome=e.run(api().run_once(e.service,e.provider,'worker'))
    assert outcome.state=='unavailable'
    assert e.repo.get('alice',job.id).checked is None
    assert e.repo.usage()['actual_input_tokens']==12


def test_worker_and_api_can_coexist(env):
    from timepitch.runtime import RuntimeLease
    e=env;e.service.submit('alice',request())
    with RuntimeLease(e.root/'runtime.lock'):
        assert e.run(api().run_once(e.service,e.provider,'worker')).state=='ready'


def test_disabled_worker_and_corrupt_ancestry_fail_closed(env):
    e=env;e.service.submit('alice',request());disabled=AzureChronicleService(e.repo,e.service.source,AzureSettings())
    assert e.run(api().run_once(disabled,e.provider,'worker')).reason=='disabled'
    e.repo.anchor_path.write_text('corrupt')
    assert e.run(api().run_once(e.service,e.provider,'worker')).reason=='configuration_unavailable'
    assert e.provider.calls==0


def test_sqlite_busy_is_terminal_without_dispatch(env,monkeypatch):
    e=env;e.service.submit('alice',request())
    def busy(*_):raise sqlite3.OperationalError('database is locked')
    monkeypatch.setattr(e.service,'claim',busy)
    assert e.run(api().run_once(e.service,e.provider,'worker')).reason=='configuration_unavailable'
    assert e.provider.calls==0


def test_stop_before_send_and_drain_after_send(env,monkeypatch):
    e=env;stop=asyncio.Event();e.service.submit('alice',request())
    original=e.provider.generate
    async def stopped(*args):
        result=await original(*args);stop.set();return result
    monkeypatch.setattr(e.provider,'generate',stopped)
    e.run(api().run_worker(e.service,e.provider,'worker',stop=stop))
    assert e.provider.calls==1 and e.provider.closed
    idle=FakeProvider();e.run(api().run_worker(e.service,idle,'next',stop=stop))
    assert idle.calls==0 and idle.closed


def test_exhausted_grant_stops_continuous_loop(env):
    e=env;one=e.service.submit('alice',request());e.service.submit('alice',request('two'))
    e.run(api().run_once(e.service,e.provider,'worker'))
    e.run(api().run_once(e.service,e.provider,'worker'))
    # Exact cached results survive off even after both synthetic calls are spent.
    e.service.settings=AzureSettings()
    assert e.service.get('alice',one.id).state=='ready'


def test_saved_service_readonly_facade_preserves_running_matches(env,monkeypatch):
    from chronicle_fixtures import canonical,grf_pair
    from timepitch.matches.repository import MatchRepository
    from timepitch.grf.repository import GrfRepository
    from timepitch.grf.codec import grf_hash
    from timepitch.simulation.replay import trace_hash
    from timepitch.chronicles.models import ChronicleRequest
    e=env;matches=MatchRepository(e.root/'runtime.sqlite');grf=GrfRepository(e.root/'grf.sqlite')
    record=canonical();gid_record,_=grf_pair()
    for sample in gid_record.samples:sample.score=(0,0) if sample.index<2 else (1,0)
    record.trace_hash=trace_hash(record);gid_record.trace_hash=grf_hash(gid_record)
    mid=matches.create(record.config,'alice').id;matches.start(mid,'alice');matches.finish(mid,'alice',record)
    gid=grf.create(gid_record.input.config,'alice').id;grf.start(gid,'alice');grf.finish(gid,'alice',gid_record)
    pending=matches.create(record.config,'alice').id;matches.start(pending,'alice')
    def deny(*_):raise AssertionError('Legacy repository constructors must not run')
    monkeypatch.setattr(MatchRepository,'__init__',deny);monkeypatch.setattr(GrfRepository,'__init__',deny)
    service=api().build_saved_service(e.root,e.service.settings)
    for engine,id,trace in [('timepitch',mid,record.trace_hash),('grf',gid,gid_record.trace_hash)]:
        req=ChronicleRequest(engine=engine,match_id=id,trace_hash=trace,locale='en')
        assert service.source('alice',req).engine==engine
        with pytest.raises(KeyError):service.source('other',req)
    assert matches.get_job(pending,'alice').state=='running'


def test_missing_outbox_does_not_leave_running_dispatch_reissuable(env):
    from azure_chronicle_fixtures import prepared
    e=env;job=e.service.submit('alice',request());claim=e.service.claim('lost')
    e.repo.authorize_send(claim.lease,prepared(claim))
    result=e.run(api().run_once(e.service,e.provider,'new'))
    assert result.state=='uncertain' and e.provider.calls==0
    assert e.repo.get('alice',job.id).state=='unavailable'


def test_usage_is_recorded_even_when_draft_rejected(env,monkeypatch):
    e=env;job=e.service.submit('alice',request());original=e.provider.generate
    async def bad(*args):
        receipt=await original(*args)
        return receipt.model_copy(update={'error':'invalid_result','draft':None})
    monkeypatch.setattr(e.provider,'generate',bad)
    result=e.run(api().run_once(e.service,e.provider,'worker'))
    assert result.state=='rejected' and e.repo.usage()['actual_input_tokens']==12
    with e.repo.connection() as conn:
        receipt=AzureReceipt.model_validate_json(conn.execute('SELECT receipt FROM azure_chronicle_attempts').fetchone()[0])
    assert receipt.output_tokens==20
    assert e.repo.get('alice',job.id).state=='rejected'


def test_stop_between_claim_and_reservation_charges_nothing(env,monkeypatch):
    e=env;w=api();stop=asyncio.Event();e.service.submit('alice',request());original=w.prepare_request
    def prepare(*args):stop.set();return original(*args)
    monkeypatch.setattr(w,'prepare_request',prepare)
    assert e.run(w.run_once(e.service,e.provider,'worker',stop=stop)).state=='unavailable'
    assert e.provider.calls==e.repo.usage()['charged_calls']==0


def test_uncertain_send_stops_loop_without_second_job(env,monkeypatch):
    e=env;w=api();e.service.submit('alice',request());two=e.service.submit('alice',request('two'));original=e.provider.generate
    async def unknown(*args):return (await original(*args)).model_copy(update={'error':'uncertain_send','draft':None})
    monkeypatch.setattr(e.provider,'generate',unknown)
    with pytest.raises(w.WorkerStopped) as caught:e.run(w.run_worker(e.service,e.provider,'worker',stop=asyncio.Event()))
    assert w.exit_code(caught.value.outcome)==3 and e.provider.calls==1 and e.provider.closed
    assert e.repo.get('alice',two.id).state=='queued'


def test_exhaustion_stops_worker_instead_of_polling(env,monkeypatch):
    e=env;w=api()
    from timepitch.chronicles.azure.repository import AzureBudgetExceeded
    def exhausted(*_):raise AzureBudgetExceeded('Synthetic exhausted grant')
    monkeypatch.setattr(e.service,'claim',exhausted)
    with pytest.raises(w.WorkerStopped) as caught:e.run(w.run_worker(e.service,e.provider,'worker',stop=asyncio.Event()))
    assert w.exit_code(caught.value.outcome)==2 and e.provider.calls==0


def test_receipt_in_sql_survives_crash_before_outbox_update(env,monkeypatch):
    e=env;w=api();e.service.submit('alice',request());save=w._save
    def crash(repo,path,state):
        if state.stage=='receipt_saved':raise SystemExit('crash after SQL receipt')
        save(repo,path,state)
    monkeypatch.setattr(w,'_save',crash)
    with pytest.raises(SystemExit):e.run(w.run_once(e.service,e.provider,'first'))
    monkeypatch.setattr(w,'_save',save);other=FakeProvider()
    assert e.run(w.run_once(e.service,other,'second')).state=='ready' and other.calls==0


def test_cli_disabled_and_bad_config_are_bounded_without_opening_runtime(monkeypatch,capsys,tmp_path):
    w=api();monkeypatch.setenv('TIMEPITCH_AZURE_CHRONICLES_MODE','off')
    monkeypatch.delenv('TIMEPITCH_AZURE_CHRONICLE_BINDING_FILE',raising=False)
    root=tmp_path/'does-not-exist'
    assert w.main(['--once','--runtime',str(root)])==2 and not root.exists()
    assert capsys.readouterr().out=='{"state":"idle","reason":"disabled"}\n'
    monkeypatch.setenv('TIMEPITCH_AZURE_CHRONICLES_MODE','secret-sentinel')
    assert w.main(['--once','--runtime',str(root)])==2
    assert 'secret-sentinel' not in capsys.readouterr().out


from test_azure_chronicle_sdk import sdk


@pytest.mark.parametrize('change,want',[('healthy','ready'),('invalid','rejected')])
def test_end_to_end_real_sdk_with_fake_http_keeps_usage(env,sdk,change,want):
    e=env;s=sdk.scenario(change);e.service.submit('alice',request())
    def verify_admission():assert e.repo.usage()['charged_calls']==1
    s.verify_admission=verify_admission
    try:
        result=sdk.run(api().run_once(e.service,s.provider,'worker'))
        assert result.state==want and len(s.requests)==1
        assert e.repo.usage()['charged_calls']==1 and e.repo.usage()['actual_input_tokens']==12
    finally:sdk.run(s.provider.close())


def test_source_changed_immediately_before_dispatch_is_not_charged(env,monkeypatch):
    e=env;job=e.service.submit('alice',request());original=e.provider.generate
    async def changed(*args):
        e.service.source=lambda *_:source().model_copy(update={'score':[9,0]})
        return await original(*args)
    monkeypatch.setattr(e.provider,'generate',changed)
    result=e.run(api().run_once(e.service,e.provider,'worker'))
    assert e.provider.calls==0 and e.repo.usage()['charged_calls']==0
    assert result.state=='unavailable' and e.repo.get('alice',job.id).checked is None


def test_sqlite_busy_saving_receipt_preserves_it_for_offline_recovery(env,monkeypatch):
    e=env;e.service.submit('alice',request());original=e.repo.record_receipt
    def busy(*_):raise sqlite3.OperationalError('synthetic receipt busy')
    monkeypatch.setattr(e.repo,'record_receipt',busy)
    result=e.run(api().run_once(e.service,e.provider,'first'))
    assert result.state=='uncertain' and e.provider.calls==1
    monkeypatch.setattr(e.repo,'record_receipt',original);other=FakeProvider()
    e.run(api().run_once(e.service,other,'second'))
    assert other.calls==0 and e.repo.usage()['actual_input_tokens']==12


def test_cli_sigterm_drains_one_attempt_and_stops_before_second(env,monkeypatch,capsys):
    import signal
    e=env;w=api();one=e.service.submit('alice',request());two=e.service.submit('alice',request('two'))
    monkeypatch.setattr(w.AzureSettings if hasattr(w,'AzureSettings') else AzureSettings,'from_env',lambda:e.service.settings)
    monkeypatch.setattr(w,'build_saved_service',lambda *_:e.service)
    monkeypatch.setattr(w,'AzureProvider',lambda *_:e.provider)
    original=e.provider.generate
    async def terminated(*args):
        receipt=await original(*args);signal.raise_signal(signal.SIGTERM)
        await asyncio.sleep(0)
        return receipt
    monkeypatch.setattr(e.provider,'generate',terminated)
    assert w.main(['--runtime',str(e.root)])==0
    assert e.provider.calls==1 and e.provider.closed
    assert e.repo.get('alice',one.id).state=='ready' and e.repo.get('alice',two.id).state=='queued'
    assert len(capsys.readouterr().out)<160
