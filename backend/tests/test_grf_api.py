import time
import pytest
from fastapi.testclient import TestClient
from timepitch.app import create_app
from timepitch.grf.models import EngineCapability
from timepitch.grf.codec import parse_grf
from grf_fixtures import request_fixture,DATASET
from test_grf_service import ControlledRunner

BASE='http://127.0.0.1:8078'


def test_grf_routes_are_owned_bounded_and_separate_from_canonical_replays(tmp_path,monkeypatch):
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setattr('timepitch.app.GrfProcess',lambda *args:ControlledRunner())
    app=create_app(DATASET,tmp_path)
    with TestClient(app,base_url=BASE,headers={'Origin':BASE}) as client:
        payload=request_fixture().config.model_dump(mode='json')
        assert client.get('/api/engines').json()[1]['available']
        created=client.post('/api/grf/matches',json=payload)
        assert created.status_code==202
        id=created.json()['id'];deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            state=client.get(f'/api/grf/matches/{id}').json()
            if state['state']=='ready':break
            time.sleep(.01)
        assert state['state']=='ready'
        response=client.get(f'/api/grf/matches/{id}/replay')
        record=parse_grf(response.content)
        assert record.input.config.seed==42 and 'grf-' in response.headers['content-disposition']
        assert client.get('/api/grf/matches').json()[0]['id']==id
        assert client.post('/api/replays/import',content=response.content,headers={'Content-Type':'application/json'}).status_code==422
        assert client.get(f'/api/matches/{id}/statistics?end_ms=0').status_code==404
        assert client.post('/api/grf/matches',json={**payload,'command':'arbitrary'}).status_code==422
        assert client.post('/api/grf/matches',content=b'x'*32769).status_code==413
        client.headers.pop('Origin')
        assert client.post('/api/grf/matches',json=payload).status_code==403
        stranger=TestClient(app,base_url=BASE)
        try:
            assert stranger.get(f'/api/grf/matches/{id}').status_code==404
            assert stranger.get(f'/api/grf/matches/{id}/replay').status_code==404
            assert stranger.get('/api/grf/matches').json()==[]
        finally:stranger.close()


def test_grf_missing_environment_does_not_break_timepitch(tmp_path,monkeypatch):
    class Missing(ControlledRunner):
        def capability(self):return EngineCapability(id='grf',available=False,reason='missing_runtime')
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setattr('timepitch.app.GrfProcess',lambda *args:Missing())
    with TestClient(create_app(DATASET,tmp_path),base_url=BASE,headers={'Origin':BASE}) as client:
        config=request_fixture().config.model_dump(mode='json')
        assert client.get('/api/engines').json()[1]['reason']=='missing_runtime'
        assert client.post('/api/grf/matches',json=config).status_code==503
        assert client.post('/api/grf/matches',json={**config,'home_players':['forged']*11}).status_code==422
        assert client.get('/api/matches').status_code==200
