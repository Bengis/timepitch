from fastapi.testclient import TestClient
import pytest

from historical_support import PILOT, write_source
from test_historical_import import build


def client(tmp_path, monkeypatch, *, enabled=True, public=False):
    from timepitch.app import create_app
    source = write_source(tmp_path/'source')
    build(source, tmp_path/'dataset')
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_DATASET', str(tmp_path/'dataset'))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED', '1' if enabled else '0')
    monkeypatch.setenv('TIMEPITCH_TWO_MODES_UI', '1')
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL', '')
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN', 'https://timepitch.diloclaro.app' if public else '')
    return TestClient(create_app(runtime_dir=tmp_path/'runtime'),
                      base_url='https://timepitch.diloclaro.app' if public else 'http://127.0.0.1')


def test_api_disabled_does_not_disable_simulation(tmp_path, monkeypatch):
    with client(tmp_path, monkeypatch, enabled=False) as app:
        capabilities = app.get('/api/historical/capabilities')
        assert capabilities.status_code == 200
        assert capabilities.json()['reconstruction_enabled'] is False
        assert app.get('/api/historical/seasons').status_code == 503
        assert app.get('/api/catalog/teams').status_code == 200
        assert app.get('/api/matches').status_code == 200


def test_historical_api_reads_sanitized_facts_without_generation(tmp_path, monkeypatch):
    import subprocess
    monkeypatch.setattr(subprocess, 'Popen', lambda *a, **k: pytest.fail('No generation in GET'))
    with client(tmp_path, monkeypatch) as app:
        capabilities = app.get('/api/historical/capabilities').json()
        assert capabilities['dataset_state'] == 'ready'
        assert capabilities['reconstruction_enabled'] is True
        response = app.get(f'/api/historical/matches/{PILOT}')
        assert response.status_code == 200
        assert response.json()['key'] == f'statsbomb:{PILOT}'
        assert 'birthday' not in response.text
        assert response.headers['x-content-type-options'] == 'nosniff'
        assert app.get('/api/historical/matches', params={'season_id':27}).json()['total'] == 1
        assert app.get(f'/api/historical/matches/{PILOT}/events', params={'period':1,'from_ms':0,'to_ms':1000}).json()['total'] == 3
        assert app.post('/api/historical/matches', headers={'Origin':'http://127.0.0.1'}).status_code == 405


@pytest.mark.parametrize('suffix', ['matches?season_id=27&limit=51', 'matches?season_id=27&offset=-1',
                                   f'matches/{PILOT}/events?period=1&from_ms=0&to_ms=60001',
                                   f'matches/{PILOT}/events?period=1&from_ms=1000&to_ms=500'])
def test_invalid_ranges_are_rejected(tmp_path, monkeypatch, suffix):
    with client(tmp_path, monkeypatch) as app:
        assert app.get('/api/historical/'+suffix).status_code == 422
        assert app.get('/api/historical/matches/99999').status_code == 404


def test_public_data_serving_is_blocked_pending_permission(tmp_path, monkeypatch):
    with client(tmp_path, monkeypatch, public=True) as app:
        assert app.get('/api/historical/capabilities').json()['reconstruction_enabled'] is False
        assert app.get('/api/historical/seasons').status_code == 503


def test_explicit_operator_permission_admits_public_history_without_weakening_security(tmp_path, monkeypatch):
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_PUBLICATION_APPROVED', '1')
    with client(tmp_path, monkeypatch, public=True) as app:
        capabilities = app.get('/api/historical/capabilities').json()
        assert capabilities['reconstruction_enabled'] is True
        assert capabilities['publication_status'] == 'operator_confirmed_permission'
        assert app.get(f'/api/historical/matches/{PILOT}/events?period=1&from_ms=0&to_ms=1000').status_code == 200
        assert app.get('/api/historical/capabilities').headers['cache-control'] == 'no-store'
        assert app.post('/api/matches', headers={'Origin': 'https://foreign.invalid'}, json={}).status_code == 403
    with client(tmp_path / 'disabled', monkeypatch, public=True, enabled=False) as app:
        assert app.get('/api/historical/seasons').status_code == 503


@pytest.mark.parametrize('value', ['', '0', 'true', 'yes'])
def test_public_history_permission_requires_exact_explicit_opt_in(tmp_path, monkeypatch, value):
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_PUBLICATION_APPROVED', value)
    with client(tmp_path, monkeypatch, public=True) as app:
        assert app.get('/api/historical/capabilities').json()['publication_status'] == 'blocked_pending_permission'
        assert app.get('/api/historical/seasons').status_code == 503


def test_invalid_dataset_does_not_prevent_existing_catalog(tmp_path, monkeypatch):
    from timepitch.app import create_app
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_DATASET', str(tmp_path/'absent'))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED', '1')
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL', '')
    monkeypatch.delenv('TIMEPITCH_PUBLIC_ORIGIN', raising=False)
    with TestClient(create_app(runtime_dir=tmp_path/'runtime'), base_url='http://127.0.0.1') as app:
        assert app.get('/api/historical/capabilities').status_code == 200
        assert app.get('/api/historical/capabilities').json()['dataset_state'] == 'invalid'
        assert app.get('/api/historical/seasons').status_code == 503
        assert app.get('/api/catalog/teams').status_code == 200


def test_sqlite_format_error_is_isolated_from_simulation(tmp_path, monkeypatch):
    import sqlite3
    import timepitch.app as module
    def bad_repository(path):
        raise sqlite3.DatabaseError('Synthetic malformed database')
    monkeypatch.setattr(module, 'HistoricalRepository', bad_repository)
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_DATASET', str(tmp_path/'broken'))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED', '1')
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL', '')
    monkeypatch.delenv('TIMEPITCH_PUBLIC_ORIGIN', raising=False)
    with TestClient(module.create_app(runtime_dir=tmp_path/'runtime'), base_url='http://127.0.0.1') as app:
        assert app.get('/api/historical/capabilities').json()['dataset_state'] == 'invalid'
        assert app.get('/api/catalog/teams').status_code == 200


def test_historical_schema_preserves_existing_replay_names(monkeypatch):
    from timepitch.app import create_app
    monkeypatch.delenv('TIMEPITCH_HISTORICAL_DATASET', raising=False)
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED', '0')
    schemas = create_app().openapi()['components']['schemas']
    for name in ('MatchRecord', 'MatchRecordV2', 'MatchEvent', 'RenderFrame', 'Point'):
        assert name in schemas


def test_statistics_api_is_cutoff_bound_and_exposes_clock_without_generation(tmp_path,monkeypatch):
    from historical_analysis_support import event
    from historical_support import records
    from timepitch.app import create_app
    _, rows=records()
    rows=rows[:2]+[event(10,'Half Start'),event(11,'Half End',ms=2_800_000),
                   event(12,'Half Start',period=2),event(13,'Half End',period=2,ms=3_038_204),
                   event(14,'Shot',ms=1_000,player=100,shot={'outcome':{'name':'Goal'},'statsbomb_xg':.2})]
    source=write_source(tmp_path/'source',events=rows)
    build(source,tmp_path/'dataset')
    monkeypatch.setenv('TIMEPITCH_HISTORICAL_DATASET',str(tmp_path/'dataset'))
    monkeypatch.setenv('TIMEPITCH_RECONSTRUCTION_ENABLED','1')
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN','')
    monkeypatch.setenv('TIMEPITCH_LOCAL_MODEL','')
    import subprocess
    monkeypatch.setattr(subprocess,'Popen',lambda *a,**k: pytest.fail('No generation in statistics GET'))
    with TestClient(create_app(runtime_dir=tmp_path/'runtime'),base_url='http://127.0.0.1') as app:
        detail=app.get(f'/api/historical/matches/{PILOT}').json()
        assert detail['clock']['periods'][0]['duration_ms']==2_800_000
        base=f'/api/historical/matches/{PILOT}/statistics'
        before=app.get(base,params={'period':1,'at_ms':500})
        assert before.status_code==200
        assert before.json()['score']=={'home':0,'away':0}
        after=app.get(base,params={'period':2,'at_ms':3_038_204})
        assert after.status_code==200
        assert after.json()['score']=={'home':1,'away':0}
        assert after.json()['reconciliation']=='mismatch'
        assert after.json()['display_clock']=='95:38'
        assert after.json()['dataset_version']==app.get('/api/historical/capabilities').json()['dataset_version']
        assert app.get(base,params={'period':2,'at_ms':3_038_205}).status_code==422
        assert app.get(base,params={'period':3,'at_ms':0}).status_code==422
        assert app.get(base.replace(str(PILOT),'99999'),params={'period':1,'at_ms':0}).status_code==404


def test_statistics_stays_disabled_in_public_and_disabled_deployments(tmp_path,monkeypatch):
    with client(tmp_path,monkeypatch,public=True) as app:
        assert app.get(f'/api/historical/matches/{PILOT}/statistics?period=1&at_ms=0').status_code==503
