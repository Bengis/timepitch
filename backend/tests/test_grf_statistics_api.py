import time
from fastapi.testclient import TestClient
from timepitch.app import create_app
from grf_fixtures import DATASET,request_fixture,replay_fixture,full_replay
from test_grf_service import ControlledRunner

BASE='http://127.0.0.1:8078'


def create_ready(client):
    job=client.post('/api/grf/matches',json=request_fixture().config.model_dump(mode='json')).json()
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        result=client.get('/api/grf/matches/'+job['id']).json()
        if result['state']=='ready':return job['id']
        time.sleep(.01)
    raise AssertionError('Controlled job did not finish')


def test_owned_statistics_are_reduced_without_rerunning_match(tmp_path,monkeypatch):
    class Counting(ControlledRunner):
        calls=0
        def run(self,*args):self.calls+=1;return super().run(*args)
    runner=Counting()
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setattr('timepitch.app.GrfProcess',lambda *args:runner)
    app=create_app(DATASET,tmp_path)
    with TestClient(app,base_url=BASE,headers={'Origin':BASE}) as client:
        id=create_ready(client);url=f'/api/grf/matches/{id}/statistics'
        response=client.get(url);assert response.status_code==200
        replay=client.get(f'/api/grf/matches/{id}/replay').json()
        assert response.json()['trace_hash']==replay['trace_hash']
        from timepitch.grf.codec import parse_grf
        from timepitch.grf.statistics import build_grf_statistics
        from timepitch.grf.statistics_models import GrfStatisticsSummary
        downloaded=client.get(f'/api/grf/matches/{id}/replay').content
        assert GrfStatisticsSummary.model_validate(response.json())==build_grf_statistics(parse_grf(downloaded))
        assert response.json()['statistics_version']=='grf-statistics-1'
        assert response.json()['by_team']['home']['shots']['value']==0
        assert response.headers['x-content-type-options']=='nosniff'
        assert client.get(url).json()==response.json() and runner.calls==1
        stranger=TestClient(app,base_url=BASE)
        try:
            assert stranger.get(url).status_code==404
            assert stranger.get(url+'?owner=forged').status_code==404
        finally:stranger.close()
        assert client.get('/api/grf/matches/not-present/statistics').status_code==404


def test_old_statistics_declare_missing_events_and_do_not_rewrite_download(tmp_path,monkeypatch):
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setattr('timepitch.app.GrfProcess',lambda *args:ControlledRunner())
    app=create_app(DATASET,tmp_path)
    with TestClient(app,base_url=BASE,headers={'Origin':BASE}) as client:
        id=create_ready(client);repo=app.state.grf.repository
        with repo.connection() as conn:owner=conn.execute('SELECT owner FROM grf_matches WHERE id=?',(id,)).fetchone()[0]
        for record in (replay_fixture(),full_replay()):
            job=repo.create(record.input.config,owner);repo.start(job.id,owner);repo.finish(job.id,owner,record)
            url=f'/api/grf/matches/{job.id}'
            before=client.get(url+'/replay').content
            response=client.get(url+'/statistics');assert response.status_code==200
            assert response.json()['by_team']['home']['shots']['value'] is None
            assert response.json()['coverage']['events_complete'] is False
            assert client.get(url+'/replay').content==before


def test_pending_and_failed_jobs_have_no_statistics(tmp_path,monkeypatch):
    runner=ControlledRunner(block=True,fail=True)
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setattr('timepitch.app.GrfProcess',lambda *args:runner)
    with TestClient(create_app(DATASET,tmp_path),base_url=BASE,headers={'Origin':BASE}) as client:
        id=client.post('/api/grf/matches',json=request_fixture().config.model_dump(mode='json')).json()['id']
        url=f'/api/grf/matches/{id}'
        assert client.get(url+'/statistics').status_code==404
        runner.release.set();deadline=time.monotonic()+5
        while time.monotonic()<deadline and client.get(url).json()['state']!='failed':time.sleep(.01)
        assert client.get(url).json()['state']=='failed'
        assert client.get(url+'/statistics').status_code==404
