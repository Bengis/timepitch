from pathlib import Path
import threading
import time
import pytest
from fastapi.testclient import TestClient
from timepitch.app import create_app
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config
from timepitch.simulation.engine import compute_trace_hash
from timepitch.simulation.replay import parse_replay
import timepitch.matches.service as service_module

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'
BASE_URL = 'http://127.0.0.1:8078'


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(dataset_path=DATASET, runtime_dir=tmp_path), base_url=BASE_URL,
                    headers={'Origin': BASE_URL}) as app:
        yield app


def config_json():
    return make_config(CatalogRepository(DATASET), 'arsenal:2003', 'mancity:2017', seed=42).model_dump()


def finished(client, match_id):
    deadline = time.monotonic()+40
    while time.monotonic() < deadline:
        response = client.get('/api/matches/' + match_id)
        assert response.status_code == 200
        if response.json()['state'] in ('ready', 'failed'):
            assert response.json()['state'] == 'ready'
            return response.json()
        time.sleep(.05)
    pytest.fail('Local simulation did not finish within the test budget')


def test_create_and_retrieve_owned_match_and_replay(client):
    created = client.post('/api/matches', json=config_json())
    assert created.status_code == 202
    match_id = created.json()['id']
    ready = finished(client, match_id)
    replay = client.get(f'/api/matches/{match_id}/replay')
    assert replay.status_code == 200
    assert replay.json()['trace_hash'] == ready['summary']['trace_hash']
    assert replay.json()['metrics'] == ready['summary']['metrics']
    assert 'attachment' in replay.headers['content-disposition']
    assert any(job['id'] == match_id for job in client.get('/api/matches').json())


def test_another_session_and_a_forged_cookie_cannot_read_match(client):
    match_id = client.post('/api/matches', json=config_json()).json()['id']
    finished(client, match_id)
    intruder = TestClient(client.app, base_url=BASE_URL)
    assert intruder.get('/api/matches').json() == []
    assert intruder.get(f'/api/matches/{match_id}').status_code == 404
    assert intruder.get(f'/api/matches/{match_id}/replay').status_code == 404
    cookie = client.cookies.get('timepitch_session')
    forged = cookie.split('.')[0] + '.' + '0' * 64
    assert intruder.get(f'/api/matches/{match_id}', headers={'Cookie': 'timepitch_session=' + forged}).status_code == 404
    intruder.close()


def test_import_preserves_trace_and_rejects_tampering_and_wrong_versions(client):
    match_id = client.post('/api/matches', json=config_json()).json()['id']
    finished(client, match_id)
    record = client.get(f'/api/matches/{match_id}/replay').json()
    imported = client.post('/api/replays/import', json=record)
    assert imported.status_code == 201
    assert imported.json()['id'] != match_id
    replay = client.get('/api/matches/' + imported.json()['id'] + '/replay').json()
    assert replay['trace_hash'] == record['trace_hash']
    record['metrics']['home']['goals'] += 1
    assert client.post('/api/replays/import', json=record).status_code == 422
    record['dataset_version'] = 'other-dataset'
    assert client.post('/api/replays/import', json=record).status_code == 422


def test_size_and_origin_limits_apply_before_processing(client):
    before = len(client.get('/api/matches').json())
    assert client.post('/api/matches', content=b'x' * 32769, headers={'Content-Type': 'application/json'}).status_code == 413
    assert client.post('/api/matches', content=iter([b'x' * 16384] * 3), headers={'Content-Type': 'application/json'}).status_code == 413
    assert client.post('/api/replays/import', content=b'x' * (16 * 1024 * 1024 + 1), headers={'Content-Type': 'application/json'}).status_code == 413
    assert client.post('/api/matches', json=config_json(), headers={'Origin': 'https://attacker.example'}).status_code == 403
    assert len(client.get('/api/matches').json()) == before


def test_unsupported_versions_are_rejected_even_with_a_valid_hash(client):
    match_id = client.post('/api/matches', json=config_json()).json()['id']
    finished(client, match_id)
    original = parse_replay(client.get(f'/api/matches/{match_id}/replay').json())
    for field in ('dataset_version', 'engine_version', 'rules_version', 'ratings_version'):
        altered = original.model_copy(update={field: 'unsupported'})
        altered.trace_hash = compute_trace_hash(altered)
        assert client.post('/api/replays/import', json=altered.model_dump(mode='json')).status_code == 422


def test_invalid_eleven_is_rejected_instead_of_queued(client):
    config = config_json()
    config['home_players'] = [config['home_players'][0]] * 11
    assert client.post('/api/matches', json=config).status_code == 422
    assert client.get('/api/matches').json() == []


def test_version_dispatch_never_accepts_v2_as_legacy_or_unsupported_format(client):
    from test_replay_versions import small_v2, legacy_record
    from timepitch.simulation.replay import encode_replay
    import json
    legacy = json.loads(encode_replay(legacy_record()))
    assert client.post('/api/replays/import', json=legacy).status_code == 201
    legacy['format_version'] = 3
    assert client.post('/api/replays/import', json=legacy).status_code == 422
    assert client.post('/api/replays/import', content=encode_replay(small_v2()),
                       headers={'Content-Type': 'application/json'}).status_code == 422


def test_schema_declares_both_versions_without_opening_runtime(tmp_path):
    app = create_app(dataset_path=DATASET, runtime_dir=tmp_path)
    assert not list(tmp_path.iterdir())
    schema = app.openapi()
    assert 'MatchRecordV2' in schema['components']['schemas']
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize('duplicate', ['version', 'nested'])
def test_import_rejects_duplicate_json_keys_before_creating_a_job(client, duplicate):
    from test_replay_versions import legacy_record
    from timepitch.simulation.replay import encode_replay
    raw = encode_replay(legacy_record())
    if duplicate == 'version':
        raw = b'{"format_version":3,"format_version":1,' + raw[1:]
    else:
        raw = raw.replace(b'"seed":42', b'"seed":999,"seed":42', 1)
    before = client.get('/api/matches').json()
    response = client.post('/api/replays/import', content=raw,
                           headers={'Content-Type': 'application/json'})
    assert response.status_code == 422
    assert client.get('/api/matches').json() == before


def test_only_one_active_and_four_queued_jobs_are_admitted(client, monkeypatch):
    gate = threading.Event()
    real_engine = service_module.simulate_match
    def held_engine(*args):
        assert gate.wait(10)
        return real_engine(*args)
    monkeypatch.setattr(service_module, 'simulate_match', held_engine)
    config = config_json()
    try:
        assert [client.post('/api/matches', json=config).status_code for _ in range(5)] == [202] * 5
        assert client.post('/api/matches', json=config).status_code == 429
    finally:
        gate.set()
