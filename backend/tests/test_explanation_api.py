from pathlib import Path
import time
import pytest
from fastapi.testclient import TestClient
from timepitch.app import create_app
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'
BASE = 'http://127.0.0.1:8078'


def test_explanation_routes_are_owned_revision_checked_and_honest_when_model_absent(tmp_path, monkeypatch):
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL', raising=False)
    app = create_app(dataset_path=DATASET, runtime_dir=tmp_path)
    with TestClient(app, base_url=BASE, headers={'Origin': BASE}) as client:
        config = make_config(CatalogRepository(DATASET), 'arsenal:2003', 'mancity:2017')
        match_id = client.post('/api/matches', json=config.model_dump()).json()['id']
        deadline=time.monotonic()+40
        while time.monotonic()<deadline:
            state = client.get('/api/matches/' + match_id).json()
            if state['state'] == 'ready': break
            assert state['state']!='failed'
            time.sleep(.05)
        else:pytest.fail('Match did not finish within the local test budget')
        revision = state['summary']['trace_hash']
        windows = client.get(f'/api/matches/{match_id}/windows')
        assert windows.status_code == 200 and len(windows.json()) == 3
        request = dict(window_id='fulltime', revision=revision, locale='es', mode='analyst')
        created = client.post(f'/api/matches/{match_id}/explanations', json=request)
        assert created.status_code == 202
        path = f'/api/matches/{match_id}/explanations/' + created.json()['id']
        for _ in range(100):
            result = client.get(path).json()
            if result['state'] != 'pending': break
            time.sleep(.01)
        assert result['state'] == 'unavailable' and result['provenance'] == 'deterministic_fallback'
        assert result['calls_reserved'] == 0 and 'hechos registrados' in result['text']
        assert client.post(f'/api/matches/{match_id}/explanations', json={**request, 'revision': 'old'}).status_code == 422
        stranger = TestClient(app, base_url=BASE, headers={'Origin': BASE})
        try:
            assert stranger.get(f'/api/matches/{match_id}/windows').status_code == 404
            assert stranger.get(path).status_code == 404
            assert stranger.post(f'/api/matches/{match_id}/explanations', json=request).status_code == 404
        finally: stranger.close()
        assert client.get('/api/matches/' + match_id).json()['summary']['trace_hash'] == revision
