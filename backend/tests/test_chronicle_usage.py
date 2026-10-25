"""Reservation races use the production SQLite accounting, never inference."""
from concurrent.futures import ThreadPoolExecutor
import pytest
from chronicle_fixtures import canonical, pack
from test_chronicle_repository import WORKER
from timepitch.matches.repository import MatchRepository
from timepitch.agents.models import ExplanationJob, MatchWindow
from timepitch.agents.service import ExplanationService, ExplanationBudgetExceeded
from timepitch.chronicles.models import ChronicleRequest
from timepitch.chronicles.repository import ChronicleRepository


def setup(tmp_path):
    matches=MatchRepository(tmp_path/'runtime.sqlite')
    service=ExplanationService(matches,lambda:pytest.fail('No model may start'),'test-model')
    chronicles=ChronicleRepository(matches.path); chronicles.heartbeat(WORKER,None,True)
    return service,chronicles


def legacy(service,id='legacy',window='fulltime',mode='fan',calls=0):
    record=canonical()
    job=ExplanationJob(id=id,match_id='one',window=MatchWindow(id=window,end_ms=5400000,event_ids=['end'],
        metrics=record.metrics,score=record.events[-1].frame_after.score,revision='a'*64),locale='en',mode=mode,
        state='pending',provenance='deterministic_fallback',model='old-model',calls_reserved=calls)
    with service.repo.connection() as conn:
        conn.execute('INSERT INTO explanations VALUES(?,?,?,?,?,?,?,?)',
            (id,id,'one','alice','a'*64,'en',mode,job.model_dump_json()))
    return job


def new(repo):
    return repo.submit('alice',ChronicleRequest(engine='timepitch',match_id='one',trace_hash='a'*64,locale='en'),
        pack().model_copy(update={'engine':'timepitch'}))


def test_new_first_blocks_legacy_final_but_not_other_windows(tmp_path):
    service,repo=setup(tmp_path); job=legacy(service); new(repo); assert repo.claim(WORKER)
    before=job.model_dump_json()
    with pytest.raises(ExplanationBudgetExceeded): service._reserve(job,'alice',1)
    assert job.model_dump_json()==before
    moment=legacy(service,'moment','moment'); halftime=legacy(service,'half','halftime')
    service._reserve(moment,'alice',4); service._reserve(halftime,'alice',4)
    with pytest.raises(ExplanationBudgetExceeded): service._reserve(halftime,'alice',1)


def test_legacy_first_new_and_mode_switch_share_allowance(tmp_path):
    service,repo=setup(tmp_path); a=legacy(service,calls=2); b=legacy(service,'second',mode='analyst',calls=1)
    service._reserve(b,'alice',1)
    with pytest.raises(ExplanationBudgetExceeded): service._reserve(a,'alice',1)
    job=new(repo); assert repo.claim(WORKER) is None
    assert repo.get(job.id,'alice').error=='budget_exhausted'


def test_shared_budget_atomic_between_legacy_and_new_connections(tmp_path):
    service,repo=setup(tmp_path); job=legacy(service); created=new(repo)
    def old():
        try: service._reserve(job,'alice',4); return True
        except ExplanationBudgetExceeded: return False
    def distributed(): return repo.claim(WORKER) is not None
    with ThreadPoolExecutor(2) as pool:
        a=pool.submit(old); b=pool.submit(distributed)
        assert int(a.result())+int(b.result())==1
    with service.repo.connection() as conn:
        import json
        old_calls=json.loads(conn.execute('SELECT body FROM explanations').fetchone()[0])['calls_reserved']
    assert old_calls+repo.get(created.id,'alice').calls_reserved==4


def test_legacy_database_without_broker_tables_still_reserves(tmp_path):
    matches=MatchRepository(tmp_path/'old.sqlite')
    service=ExplanationService(matches,lambda:pytest.fail('No inference'),'test-model')
    job=legacy(service); service._reserve(job,'alice',4)
    assert job.calls_reserved==4


def test_provider_calls_external_allowance_before_each_fake_http(tmp_path):
    import asyncio
    import httpx
    from test_chronicle_provider import provider
    async def run():
        model,transport,_=provider(); journal=tmp_path/'synthetic-calls.txt'
        async def observed(request):
            assert len(journal.read_text().splitlines())==transport.calls+1
            return httpx.Response(200,json={})
        await transport.http.aclose()
        transport.http=httpx.AsyncClient(transport=httpx.MockTransport(observed))
        transport.client.client._client=transport.http; transport.client.client.close=transport.http.aclose
        def reserve(count):
            assert count==1
            with journal.open('a') as stream: stream.write('reserved-before-send\n')
        try:
            receipt=await model.generate(pack(),'en',reserve)
            assert receipt.actual_calls==len(journal.read_text().splitlines())==4
        finally: await model.close()
    asyncio.run(run())
