"""HTTP/security tests use an in-process broker and hand-built fact pack."""
from hashlib import sha256
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from chronicle_fixtures import pack
from test_chronicle_repository import result
from timepitch.security import install_security, owner_session
from timepitch.chronicles.auth import ChronicleSettings
from timepitch.chronicles.repository import ChronicleRepository
from timepitch.chronicles.service import ChronicleService
from timepitch.api.chronicles import chronicles_router
from timepitch.chronicles.models import ClaimedJob

ORIGIN='https://timepitch.diloclaro.app'
TOKEN='synthetic-test-credential-never-used-in-production'
AUTH={'Authorization':'Bearer '+TOKEN}
READY={'worker_id':'test-worker','model_ready':True}
BODY={'engine':'grf','match_id':'one','trace_hash':'a'*64,'locale':'en'}


def client_for(monkeypatch,tmp_path,mode='public',owner_file=None):
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN',ORIGIN)
    settings=ChronicleSettings(mode=mode,worker_id='test-worker',token_sha256=sha256(TOKEN.encode()).hexdigest(),acceptance_owner_file=owner_file)
    app=FastAPI(); app.state.session_key=b'x'*32
    app.state.chronicles_settings=settings
    sources={}
    def source(owner,req):
        if owner not in sources or req.match_id!='one': raise KeyError(req.match_id)
        value=sources[owner]
        if req.trace_hash!=value.trace_hash or req.engine!=value.engine: raise ValueError('Changed replay')
        return value
    app.state.chronicles=ChronicleService(ChronicleRepository(tmp_path/'runtime.sqlite'),source)
    @app.get('/api/session')
    def session(owner=Depends(owner_session)):
        sources.setdefault(owner,pack()); return {'owner':owner}
    @app.post('/api/matches')
    def matches(): return {'accepted':True}
    app.include_router(chronicles_router())
    install_security(app,runtime_dir=tmp_path,worker_auth=settings)
    client=TestClient(app,base_url=ORIGIN)
    client.get('/api/session')
    return client,sources


def test_browser_identity_and_authentic_worker_completion(monkeypatch,tmp_path):
    with client_for(monkeypatch,tmp_path)[0] as client:
        assert client.get('/api/chronicles',params=BODY).status_code==204
        created=client.post('/api/chronicles',json=BODY,headers={'Origin':ORIGIN})
        assert created.status_code==202
        id=created.json()['id']
        assert client.post('/api/chronicles',json=BODY,headers={'Origin':ORIGIN}).json()['id']==id
        response=client.post('/api/ai-worker/claim',json=READY,headers=AUTH)
        assert response.status_code==200
        claim=ClaimedJob.model_validate_json(response.content)
        assert 'owner' not in response.json() and 'set-cookie' not in response.headers
        ready=client.post('/api/ai-worker/result',json=result(claim).model_dump(),headers=AUTH)
        assert ready.status_code==200 and ready.json()['state']=='ready'
        assert client.post('/api/ai-worker/result',json=result(claim).model_dump(),headers=AUTH).json()==ready.json()
        assert client.get('/api/chronicles/'+id).json()==ready.json()
        with TestClient(client.app,base_url=ORIGIN) as other:
            assert other.get('/api/chronicles/'+id).status_code==404
        status=client.get('/api/chronicle-worker-status')
        assert set(status.json())=={'state','profile'}
        assert status.headers['x-frame-options']=='DENY' and 'max-age=' in status.headers['strict-transport-security']


def test_worker_token_does_not_disable_browser_origin_or_cookie_ownership(monkeypatch,tmp_path):
    with client_for(monkeypatch,tmp_path)[0] as client:
        for auth in ({},{'Authorization':'Bearer wrong'}):
            assert client.post('/api/ai-worker/claim',json=READY,headers=auth).status_code==401
        for path in ('/api/matches','/api/chronicles'):
            assert client.post(path,json=BODY,headers=AUTH).status_code==403
        for body in ({**READY,'worker_id':'impostor'},{**READY,'profile':'foreign'},{**READY,'protocol_version':'future'}):
            response=client.post('/api/ai-worker/claim',json=body,headers=AUTH)
            assert response.status_code==409 and TOKEN not in response.text
        assert client.post('/api/ai-worker/heartbeat',json=READY,headers=AUTH).status_code==200
        assert client.post('/api/ai-worker/claim',json={**READY,'model_ready':False},headers=AUTH).status_code==204


def test_worker_caps_and_sanitised_errors(monkeypatch,tmp_path):
    with client_for(monkeypatch,tmp_path)[0] as client:
        assert client.post('/api/ai-worker/result',content=b'x'*16385,headers=AUTH).status_code==413
        assert client.post('/api/ai-worker/claim',content=b'x'*4097,headers=AUTH).status_code==413
        bad=client.post('/api/ai-worker/result',json={'lease_token':TOKEN},headers=AUTH)
        assert bad.status_code==422 and TOKEN not in bad.text
        assert client.post('/api/ai-worker/result',content=b'x'*16385).status_code==401


def test_separate_worker_budget_leaves_visitor_allowance(monkeypatch,tmp_path):
    with client_for(monkeypatch,tmp_path)[0] as client:
        for _ in range(30): assert client.post('/api/ai-worker/heartbeat',json=READY,headers=AUTH).status_code==200
        response=client.post('/api/ai-worker/heartbeat',json=READY,headers=AUTH)
        assert response.status_code==429 and int(response.headers['retry-after'])>0
        for _ in range(6): assert client.post('/api/matches',headers={'Origin':ORIGIN}).status_code==200
        assert client.post('/api/matches',headers={'Origin':ORIGIN}).status_code==429


def test_off_and_acceptance_gate(monkeypatch,tmp_path):
    with client_for(monkeypatch,tmp_path,mode='off')[0] as client:
        assert client.post('/api/chronicles',json=BODY,headers={'Origin':ORIGIN}).status_code==503
        assert client.post('/api/ai-worker/heartbeat',json=READY,headers=AUTH).status_code==401
    owner_file=tmp_path/'private-owner'; owner_file.write_text('a'*32)
    with client_for(monkeypatch,tmp_path,mode='acceptance',owner_file=owner_file)[0] as client:
        assert client.post('/api/chronicles',json=BODY,headers={'Origin':ORIGIN}).status_code==404
        owner_file.write_text(client.get('/api/session').json()['owner'])
        assert client.post('/api/chronicles',json=BODY,headers={'Origin':ORIGIN}).status_code==202


def test_real_application_off_uses_saved_canonical_source_without_engines(monkeypatch,tmp_path):
    from pathlib import Path
    from chronicle_fixtures import canonical
    from timepitch.app import create_app
    import timepitch.app as app_module
    def forbidden(*args,**kwargs): pytest.fail('No model or match may run')
    monkeypatch.setattr(app_module,'LocalAgentRunner',forbidden)
    monkeypatch.setenv('TIMEPITCH_CHRONICLES_MODE','off')
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.delenv('TIMEPITCH_PUBLIC_ORIGIN',raising=False)
    dataset=Path(__file__).resolve().parents[2]/'research/data-audit/2026-10-16/derived/coverage.sqlite'
    app=create_app(dataset_path=dataset,runtime_dir=tmp_path)
    with TestClient(app,base_url='http://127.0.0.1:8078') as client:
        assert client.get('/api/chronicle-worker-status').json()['state']=='disconnected'
        record=canonical(); repo=app.state.matches.repository
        job=repo.create(record.config,'test-owner'); repo.start(job.id,'test-owner'); repo.finish(job.id,'test-owner',record)
        from timepitch.chronicles.models import ChronicleRequest
        request=ChronicleRequest(engine='timepitch',match_id=job.id,trace_hash=record.trace_hash,locale='en')
        source=app.state.chronicles.source('test-owner',request)
        assert source.engine=='timepitch' and source.score==[1,0]
        assert client.get('/api/catalog/teams').status_code==200


def test_long_poll_is_bounded_single_waiter_without_a_database_lock(monkeypatch,tmp_path):
    import asyncio
    import httpx
    import time
    client,_=client_for(monkeypatch,tmp_path)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app),base_url=ORIGIN) as http:
            started=time.monotonic()
            waiter=asyncio.create_task(http.post('/api/ai-worker/claim',json=READY,headers=AUTH))
            await asyncio.sleep(.15)
            assert not waiter.done()
            duplicate=await http.post('/api/ai-worker/claim',json=READY,headers=AUTH)
            assert duplicate.status_code==429
            heartbeat=await http.post('/api/ai-worker/heartbeat',json=READY,headers=AUTH)
            assert heartbeat.status_code==200  # Independent transaction succeeds during the wait.
            assert (await waiter).status_code==204
            assert 14.9<=time.monotonic()-started<18
    asyncio.run(run())
    client.close()


def test_wrong_result_hash_and_call_count_are_denied(monkeypatch,tmp_path):
    with client_for(monkeypatch,tmp_path)[0] as client:
        client.post('/api/chronicles',json=BODY,headers={'Origin':ORIGIN})
        claim=ClaimedJob.model_validate_json(client.post('/api/ai-worker/claim',json=READY,headers=AUTH).content)
        bad=result(claim).model_dump(); bad['actual_calls']=5
        assert client.post('/api/ai-worker/result',json=bad,headers=AUTH).status_code==422
        bad=result(claim).model_dump(); bad['lease']['fact_hash']='c'*64
        assert client.post('/api/ai-worker/result',json=bad,headers=AUTH).status_code==409
        assert client.get('/api/chronicles/'+claim.lease.job_id).json()['state']=='running'


@pytest.mark.parametrize('values',[{'mode':'invalid'},{'mode':'public','token_sha256':'wrong'},
    {'mode':'acceptance','token_sha256':'a'*64},{'worker_id':''}])
def test_bad_feature_configuration_fails_closed(values):
    with pytest.raises(ValueError): ChronicleSettings(**values)
