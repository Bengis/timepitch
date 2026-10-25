import importlib
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from azure_chronicle_fixtures import api, binding, ready, source, prepared, receipt, forbid_runtime
from timepitch.security import install_security, owner_session

ORIGIN='https://timepitch.diloclaro.app'
BODY={'engine':'grf','match_id':'one','trace_hash':'a'*64,'locale':'en'}


@pytest.fixture(autouse=True)
def offline_only(monkeypatch):forbid_runtime(monkeypatch)


def integration():
    m,_=api()
    assert importlib.util.find_spec('timepitch.chronicles.azure.service') is not None, 'Azure service is not implemented'
    return m,importlib.import_module('timepitch.chronicles.azure.service'),importlib.import_module('timepitch.api.azure_chronicles')


def client_for(tmp_path,monkeypatch,*,mode='public',grant=True):
    m,s,a=integration()
    from timepitch.chronicles.azure.settings import AzureSettings
    from timepitch.chronicles.azure.repository import AzureRepository
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN',ORIGIN)
    if grant:repo,_,b,_=ready(tmp_path/'runtime.sqlite',calls=2)
    else:repo,b=AzureRepository(tmp_path/'runtime.sqlite',clock=lambda:1000.),binding()
    owner_file=tmp_path/'acceptance-owner';owner_file.write_text('',encoding='utf-8')
    settings=AzureSettings(mode,b,owner_file if mode=='acceptance' else None)
    sources={}
    def resolve(owner,req):
        if owner not in sources or req.match_id not in ('one','two'):raise KeyError('missing')
        pack=sources[owner]
        if req.trace_hash!=pack.trace_hash or req.engine!=pack.engine:raise s.AzureStaleSource('Changed source')
        return pack
    app=FastAPI();app.state.session_key=b'x'*32
    app.state.azure_chronicles=s.AzureChronicleService(repo,resolve,settings)
    app.state.azure_chronicles_settings=settings
    app.state.azure_chronicles_config_error=False
    @app.get('/api/session')
    def session(owner=Depends(owner_session)):
        sources.setdefault(owner,source());return {'owner':owner}
    app.include_router(a.azure_chronicles_router())
    # Register the existing dynamic namespace too: v2 must win over its job_id route.
    from timepitch.api.chronicles import chronicles_router
    app.include_router(chronicles_router())
    install_security(app,runtime_dir=tmp_path)
    client=TestClient(app,base_url=ORIGIN)
    owner=client.get('/api/session').json()['owner']
    return client,app,sources,owner,owner_file


def post(client,body=None,headers=None):
    return client.post('/api/chronicles/v2',json=BODY if body is None else body,
        headers={'Origin':ORIGIN} if headers is None else headers)


def test_ownership_and_unsupported_source(tmp_path,monkeypatch):
    client,app,_,_,_=client_for(tmp_path,monkeypatch)
    job=post(client).json()
    assert client.get('/api/chronicles/v2/'+job['id']).status_code==200
    with TestClient(app,base_url=ORIGIN) as other:
        foreign=other.get('/api/chronicles/v2/'+job['id'])
        missing=other.get('/api/chronicles/v2/not-a-job')
        assert foreign.status_code==missing.status_code==404 and foreign.json()==missing.json()
    assert post(client,{**BODY,'engine':'historical'}).status_code==422


def test_get_lookup_and_status_do_not_admit(tmp_path,monkeypatch):
    client,app,_,_,_=client_for(tmp_path,monkeypatch)
    assert client.get('/api/chronicles/v2',params=BODY).status_code==204
    status=client.get('/api/chronicles/v2/status')
    assert status.status_code==200 and status.json()['worker']=='unknown'
    assert app.state.azure_chronicles.repository.usage()['charged_calls']==0
    job=post(client).json()
    assert post(client).json()['id']==job['id']
    assert client.get('/api/chronicles/v2',params=BODY).json()['id']==job['id']
    assert app.state.azure_chronicles.repository.usage()['charged_calls']==0


def test_off_and_exhausted_keep_cached_reads(tmp_path,monkeypatch):
    from timepitch.chronicles.azure.settings import AzureSettings
    client,app,_,_,_=client_for(tmp_path,monkeypatch)
    job=post(client).json();service=app.state.azure_chronicles
    claim=service.claim('synthetic-worker');permit=service.repository.authorize_send(claim.lease,prepared(claim))
    done=service.complete(claim.lease,receipt(claim,permit))
    assert done.state=='ready'
    app.state.azure_chronicles_settings=service.settings=AzureSettings()
    assert post(client).status_code==503
    assert client.get('/api/chronicles/v2/'+job['id']).json()['state']=='ready'
    assert client.get('/api/chronicles/v2/status').json()['worker']=='off'


def test_zero_budget_and_private_acceptance_deny_before_queue(tmp_path,monkeypatch):
    client,app,_,_,_=client_for(tmp_path,monkeypatch,grant=False)
    assert post(client).status_code==429
    assert app.state.azure_chronicles.repository.usage()['charged_calls']==0
    client.close()
    private,app,_,owner,path=client_for(tmp_path/'private',monkeypatch,mode='acceptance')
    assert post(private).status_code==404
    path.write_text(owner,encoding='utf-8')
    assert post(private).status_code==202


def test_new_route_keeps_origin_body_and_header_guards(tmp_path,monkeypatch):
    client,_,_,_,_=client_for(tmp_path,monkeypatch)
    assert post(client,headers={'Origin':'https://foreign.invalid'}).status_code==403
    assert post(client,headers={}).status_code==403
    oversized=client.post('/api/chronicles/v2',content=b'x'*32769,headers={'Origin':ORIGIN,'Content-Type':'application/json'})
    assert oversized.status_code==413
    options=client.options('/api/chronicles/v2',headers={'Origin':ORIGIN,'Access-Control-Request-Method':'POST'})
    assert options.status_code==200 and options.headers['access-control-allow-origin']==ORIGIN
    result=client.get('/api/chronicles/v2/status')
    for name in ('content-security-policy','strict-transport-security','x-content-type-options','x-frame-options','referrer-policy'):
        assert name in result.headers


@pytest.mark.parametrize('field,value',[('endpoint','https://foreign.invalid'),('model','other'),('grant',{}),('retry',True),('budget',10)])
def test_v2_cannot_supply_provider_grant_or_endpoint(tmp_path,monkeypatch,field,value):
    client,app,_,_,_=client_for(tmp_path,monkeypatch)
    assert post(client,{**BODY,field:value}).status_code==422
    assert app.state.azure_chronicles.repository.usage()['charged_calls']==0


def test_fulltime_and_fact_revision_required(tmp_path,monkeypatch):
    client,app,sources,owner,_=client_for(tmp_path,monkeypatch)
    job=post(client).json()
    sources[owner].coverage.notes.append('changed evidence with same trace')
    assert client.get('/api/chronicles/v2/'+job['id']).status_code==409
    assert client.get('/api/chronicles/v2',params=BODY).status_code==409
    assert app.state.azure_chronicles.repository.usage()['charged_calls']==0


def test_default_app_off_and_router_order(tmp_path,monkeypatch):
    integration()
    monkeypatch.setenv('TIMEPITCH_AZURE_CHRONICLES_MODE','off')
    monkeypatch.delenv('TIMEPITCH_AZURE_CHRONICLE_BINDING_FILE',raising=False)
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL','')
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN','')
    from timepitch.app import create_app
    app=create_app(runtime_dir=tmp_path/'isolated-runtime')
    with TestClient(app,base_url='http://127.0.0.1') as client:
        assert client.get('/api/chronicles/v2/status').json()['mode']=='off'
        response=client.get('/api/chronicles/v2',params=BODY)
        assert response.status_code==404 and response.json()['detail']=='Chronicle or source not found'
    assert not hasattr(app.state,'azure_worker')


def test_exhausted_grant_still_serves_ready_cached_results(tmp_path,monkeypatch):
    client,app,_,_,_=client_for(tmp_path,monkeypatch)
    service=app.state.azure_chronicles
    ids=[]
    for match in ('one','two'):
        job=post(client,{**BODY,'match_id':match}).json();ids.append(job['id'])
        claim=service.claim('worker');permit=service.repository.authorize_send(claim.lease,prepared(claim))
        service.complete(claim.lease,receipt(claim,permit))
    assert service.repository.usage()['charged_calls']==2
    assert post(client,{**BODY,'locale':'es'}).status_code==429
    assert client.get('/api/chronicles/v2/'+ids[0]).json()['state']=='ready'
    assert post(client).json()['id']==ids[0]


def test_invalid_azure_configuration_does_not_disable_the_app(tmp_path,monkeypatch):
    integration()
    bad=tmp_path/'bad-binding.json';bad.write_text('not-json',encoding='utf-8')
    monkeypatch.setenv('TIMEPITCH_AZURE_CHRONICLES_MODE','public')
    monkeypatch.setenv('TIMEPITCH_AZURE_CHRONICLE_BINDING_FILE',str(bad))
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL','')
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN','')
    from timepitch.app import create_app
    with TestClient(create_app(runtime_dir=tmp_path/'isolated'),base_url='http://127.0.0.1') as client:
        assert client.get('/api/catalog/teams').status_code==200
        assert client.get('/api/chronicles/v2/status').json()['reason']=='configuration_unavailable'


def test_missing_azure_anchor_does_not_disable_other_routes(tmp_path,monkeypatch):
    integration()
    monkeypatch.setenv('TIMEPITCH_AZURE_CHRONICLES_MODE','off')
    monkeypatch.delenv('TIMEPITCH_AZURE_CHRONICLE_BINDING_FILE',raising=False)
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL','')
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN','')
    from timepitch.app import create_app
    runtime=tmp_path/'isolated'
    with TestClient(create_app(runtime_dir=runtime),base_url='http://127.0.0.1') as client:
        assert client.get('/api/chronicles/v2/status').json()['reason']=='disabled'
    (runtime/'runtime.sqlite.azure-private/budget.anchor').unlink()
    with TestClient(create_app(runtime_dir=runtime),base_url='http://127.0.0.1') as client:
        assert client.get('/api/catalog/teams').status_code==200
        assert client.get('/api/chronicles/v2/status').json()['reason']=='configuration_unavailable'


def test_openapi_exposes_only_browser_job_contracts(tmp_path,monkeypatch):
    client,app,_,_,_=client_for(tmp_path,monkeypatch)
    schema=app.openapi()
    assert set(schema['paths']['/api/chronicles/v2'])>={'get','post'}
    assert set(schema['paths']['/api/chronicles/v2/status'])>={'get'}
    components=schema['components']['schemas']
    assert 'AzureJobView' in components and 'AzureStatus' in components
    assert not {'AzureGrant','AzureBinding','AzureLease','AzureReceipt','Tariff','AzureTerminalReceipt'}&set(components)


@pytest.mark.parametrize('invalid_owner',['álîce','not-an-owner'])
def test_invalid_private_owner_file_denies_without_crashing(tmp_path,monkeypatch,invalid_owner):
    client,_,_,_,path=client_for(tmp_path,monkeypatch,mode='acceptance')
    path.write_text(invalid_owner,encoding='utf-8')
    assert post(client).status_code==404
    assert client.get('/api/chronicles/v2/status').json()['generation_allowed'] is False
