"""Synthetic full traces verify HTTP integration; no native environment is started."""
import json
import shutil
import threading
import time
import pytest
from fastapi.testclient import TestClient
from timepitch.app import create_app
from timepitch.grf.models import EngineCapability
from timepitch.grf.physical_process import PhysicalResult
from grf_fixtures import DATASET
from grf_action_fixtures import write_action_match


@pytest.mark.parametrize('mode,policy',[('compressed','actions-1'),('physical','typo')])
def test_invalid_action_selection_fails_before_jobs(tmp_path,monkeypatch,mode,policy):
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setenv('TIMEPITCH_GRF_MODE',mode)
    monkeypatch.setenv('TIMEPITCH_GRF_PHYSICAL_TELEMETRY',policy)
    with pytest.raises(ValueError,match='telemetry'):
        with TestClient(create_app(DATASET,tmp_path)):pass


def test_action_job_preserves_evidence_and_statistics_without_publishing_a_prefix(tmp_path,monkeypatch):
    directory=tmp_path/'fixture';manifest=write_action_match(directory)
    entered=threading.Event();release=threading.Event()
    class ControlledActions:
        def capability(self):return EngineCapability(id='grf',available=True)
        def close(self):release.set()
        def run(self,request,cancelled):
            assert request==manifest.input
            entered.set()
            if not release.wait(30):raise RuntimeError('Fixture release timeout')
            result=PhysicalResult();result.manifest=manifest;result.count=len(manifest.chunks)
            for ref in manifest.chunks:shutil.copyfile(directory/f'{ref.index}.zlib',result.path/f'{ref.index}.zlib')
            return result
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setenv('TIMEPITCH_GRF_MODE','physical')
    monkeypatch.setenv('TIMEPITCH_GRF_PHYSICAL_TELEMETRY','actions-1')
    monkeypatch.setattr('timepitch.app.ActionProcess',lambda *args:ControlledActions())
    app=create_app(DATASET,tmp_path/'runtime');base='http://127.0.0.1:8078'
    with TestClient(app,base_url=base,headers={'Origin':base}) as client:
        try:
            response=client.post('/api/grf/matches',json=manifest.input.config.model_dump(mode='json'))
            assert response.status_code==202,response.text
            id=response.json()['id'];url=f'/api/grf/matches/{id}'
            assert entered.wait(5)
            assert client.get(url).json()['state']=='running'
            assert client.get(url+'/replay').status_code==404
            release.set();deadline=time.monotonic()+45
            while time.monotonic()<deadline:
                job=client.get(url).json()
                if job['state'] in ('ready','failed'):break
                time.sleep(.02)
            assert job['state']=='ready',job
            replay=client.get(url+'/replay').json()
            assert replay['schema_version']=='grf-actions-1'
            assert replay['semantic_event_count']==manifest.semantic_event_count
            block=client.get(url+'/replay/chunks/0').json()
            assert block['schema_version']=='grf-actions-chunk-1' and block['contact_roles']==[2]
            assert block['semantic_events'][0]['origin']=='open_play_pass'
            exported=[json.loads(line) for line in client.get(url+'/export').text.splitlines()]
            assert exported[0]['manifest']==manifest.model_dump(mode='json')
            assert exported[1]['chunk']['semantic_events']==block['semantic_events']
            stats=client.get(url+'/statistics');assert stats.status_code==200,stats.text
            summary=stats.json()
            assert summary['statistics_version']=='grf-physical-statistics-2'
            assert summary['team_actions'][0]['passes']==1 and len(summary['player_actions'])==44
            assert summary['releases'][0]['raw_event_seq']==0
            stranger=TestClient(app,base_url=base)
            try:
                for suffix in ('','/replay','/replay/chunks/0','/export','/statistics'):
                    assert stranger.get(url+suffix).status_code==404
                assert stranger.get('/api/grf/matches').json()==[]
            finally:stranger.close()
        finally:release.set()


def test_wrong_action_binary_is_unavailable_without_falling_back(tmp_path,monkeypatch):
    from timepitch import config
    from grf_fixtures import request_fixture
    native=tmp_path/'native';native.mkdir();(native/'_gameplayfootball.pyd').write_bytes(b'wrong')
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL',raising=False)
    monkeypatch.setenv('TIMEPITCH_GRF_MODE','physical')
    monkeypatch.setenv('TIMEPITCH_GRF_PHYSICAL_TELEMETRY','actions-1')
    monkeypatch.setattr(config,'GRF_ACTION_NATIVE_DIR',native,raising=False)
    with TestClient(create_app(DATASET,tmp_path/'runtime'),base_url='http://127.0.0.1:8078',headers={'Origin':'http://127.0.0.1:8078'}) as client:
        capability=client.get('/api/engines').json()[1]
        assert capability['available'] is False and capability['reason']=='unsupported_native_binary'
        assert client.post('/api/grf/matches',json=request_fixture().config.model_dump(mode='json')).status_code==503
        assert client.get('/api/grf/matches').json()==[]
