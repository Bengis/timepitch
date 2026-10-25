"""/replays serves recorded .json.gz as opaque bytes, without Content-Encoding (TP201)."""
import gzip
import hashlib

import pytest
from fastapi.testclient import TestClient

from timepitch import config
from timepitch.app import create_app

BASE_URL = 'http://127.0.0.1'


@pytest.fixture
def replays(tmp_path, monkeypatch):
    root = tmp_path / 'replays'
    (root / 'match-1').mkdir(parents=True)
    payload = gzip.compress(b'{"frames": []}', 9, mtime=0)
    (root / 'match-1' / 'grf-cal1.json.gz').write_bytes(payload)
    (root / 'SHA256SUMS').write_text('x  match-1/grf-cal1.json.gz\n')
    monkeypatch.setattr(config, 'REPLAYS_DIR', root)
    with TestClient(create_app(dataset_path=config.DATASET, runtime_dir=tmp_path / 'rt'), base_url=BASE_URL) as client:
        yield client, payload


def test_serves_gzip_bytes_verbatim(replays):
    client, payload = replays
    response = client.get('/replays/match-1/grf-cal1.json.gz', headers={'Accept-Encoding': 'gzip'})
    assert response.status_code == 200
    assert 'content-encoding' not in response.headers
    assert response.headers['content-type'] == 'application/octet-stream'
    # httpx would inflate a Content-Encoding body; raw bytes and hash must match the stored file.
    assert hashlib.sha256(response.content).hexdigest() == hashlib.sha256(payload).hexdigest()
    assert int(response.headers['content-length']) == len(payload)


def test_head_and_only_json_gz(replays):
    client, payload = replays
    head = client.head('/replays/match-1/grf-cal1.json.gz')
    assert head.status_code == 200 and int(head.headers['content-length']) == len(payload)
    assert client.get('/replays/SHA256SUMS').status_code == 404
    assert client.get('/replays/match-1/missing.json.gz').status_code == 404
    assert client.get('/replays/../config.py').status_code == 404


def test_missing_folder_is_not_mounted(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'REPLAYS_DIR', tmp_path / 'absent')
    with TestClient(create_app(dataset_path=config.DATASET, runtime_dir=tmp_path), base_url=BASE_URL) as client:
        assert client.get('/replays/a/b.json.gz').status_code == 404
