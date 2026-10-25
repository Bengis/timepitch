"""/data and /licenses serve the built web's public files read-only (TP207)."""
import pytest
from fastapi.testclient import TestClient

from timepitch import config
from timepitch.app import create_app

BASE_URL = 'http://127.0.0.1'
CARD = b'{"players": []}'


@pytest.fixture
def dist(tmp_path, monkeypatch):
    root = tmp_path / 'dist'
    (root / 'data' / 'players').mkdir(parents=True)
    (root / 'data' / 'players' / 'arsenal-2003.json').write_bytes(CARD)
    (root / 'data' / 'players' / 'notes.txt').write_text('private')
    (root / 'licenses').mkdir()
    (root / 'licenses' / 'three.txt').write_text('MIT License')
    (root / 'licenses' / 'other.json').write_text('{}')
    (root / 'secret.json').write_text('{}')
    monkeypatch.setattr(config, 'WEB_DIST', root)
    with TestClient(create_app(dataset_path=config.DATASET, runtime_dir=tmp_path / 'rt'), base_url=BASE_URL) as client:
        yield client


def test_serves_player_card_json(dist):
    response = dist.get('/data/players/arsenal-2003.json')
    assert response.status_code == 200 and response.content == CARD
    assert response.headers['content-type'] == 'application/json'
    assert response.headers['cache-control'] == 'no-cache'
    assert 'etag' in response.headers
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert "default-src 'self'" in response.headers['content-security-policy']
    assert dist.head('/data/players/arsenal-2003.json').status_code == 200


def test_serves_licence_text(dist):
    response = dist.get('/licenses/three.txt')
    assert response.status_code == 200 and response.text == 'MIT License'
    assert response.headers['content-type'].startswith('text/plain')
    assert response.headers['x-frame-options'] == 'DENY'


@pytest.mark.parametrize('path', [
    '/data/players/notes.txt', '/licenses/other.json', '/data/players/missing.json',
    '/data/', '/data/players', '/data/players/', '/licenses/',
    '/data/../secret.json', '/data/players/..%2F..%2Fsecret.json', '/licenses/..%5C..%5Csecret.json',
])
def test_rejects_other_types_listing_and_traversal(dist, path):
    assert dist.get(path).status_code == 404


def test_post_is_not_allowed(dist):
    assert dist.post('/data/players/arsenal-2003.json', headers={'Origin': BASE_URL}).status_code == 405


def test_missing_folders_are_not_mounted(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'WEB_DIST', tmp_path / 'absent')
    with TestClient(create_app(dataset_path=config.DATASET, runtime_dir=tmp_path), base_url=BASE_URL) as client:
        assert client.get('/data/players/arsenal-2003.json').status_code == 404
        assert client.get('/licenses/three.txt').status_code == 404
