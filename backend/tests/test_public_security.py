"""Public HTTPS policy without opening a network port or running matches."""
import shutil

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from timepitch.security import install_security, owner_session

ORIGIN = 'https://timepitch.diloclaro.app'


def client_for(monkeypatch, tmp_path, origin=ORIGIN, base=ORIGIN):
    monkeypatch.setenv('TIMEPITCH_PUBLIC_ORIGIN', origin)
    app = FastAPI()
    app.state.session_key = b'x'*32
    @app.get('/api/session')
    def session(owner=Depends(owner_session)):
        return {'owner': owner}
    @app.post('/api/matches')
    def create():
        return {'accepted': True}
    install_security(app, runtime_dir=tmp_path)
    return TestClient(app, base_url=base, client=('203.0.113.7', 1234))


def test_public_https_host_cookie_headers_and_origin(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path) as client:
        response = client.get('/api/session')
        assert response.status_code == 200
        cookie = response.headers['set-cookie'].lower()
        assert 'secure' in cookie and 'httponly' in cookie and 'samesite=strict' in cookie
        assert 'domain=' not in cookie
        assert response.headers['cache-control'] == 'no-store'
        assert 'max-age=' in response.headers['strict-transport-security']
        assert client.post('/api/matches', headers={'Origin': ORIGIN}).status_code == 200
        for origin in ('http://timepitch.diloclaro.app', 'http://localhost:5173', 'https://foreign.example'):
            assert client.post('/api/matches', headers={'Origin': origin}).status_code == 403
        assert client.post('/api/matches').status_code == 403
        assert client.get('/api/session', headers={'Host': 'foreign.example'}).status_code == 400


def test_public_http_redirect_and_local_health_still_work(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path, base=ORIGIN.replace('https:', 'http:')) as client:
        response = client.get('/api/session?test=1', follow_redirects=False)
        assert response.status_code == 308
        assert response.headers['location'] == ORIGIN+'/api/session?test=1'
        assert 'set-cookie' not in response.headers
        assert client.get('http://127.0.0.1/api/session').status_code == 200


@pytest.mark.parametrize('origin', ['http://timepitch.diloclaro.app', 'https://*.diloclaro.app',
    'https://example.com/path', 'https://user:secret@example.com', 'https://example.com?x=1'])
def test_bad_public_configuration_fails_before_serving(monkeypatch, tmp_path, origin):
    with pytest.raises(ValueError):
        client_for(monkeypatch, tmp_path, origin=origin)


def test_public_write_limits_expire_and_reads_remain_available(monkeypatch, tmp_path):
    import timepitch.security as security
    now = [10.]
    monkeypatch.setattr(security, 'monotonic', lambda: now[0])
    with client_for(monkeypatch, tmp_path) as client:
        for _ in range(6):
            assert client.post('/api/matches', headers={'Origin': ORIGIN}).status_code == 200
        response = client.post('/api/matches', headers={'Origin': ORIGIN})
        assert response.status_code == 429 and int(response.headers['retry-after']) > 0
        assert response.headers['cache-control'] == 'no-store'
        assert client.get('/api/session').status_code == 200
        now[0] += 61
        assert client.post('/api/matches', headers={'Origin': ORIGIN}).status_code == 200


def test_storage_exhaustion_rejects_writes_before_endpoint(monkeypatch, tmp_path):
    import timepitch.security as security
    monkeypatch.setattr(security.shutil, 'disk_usage', lambda _: shutil._ntuple_diskusage(100, 99, 1))
    with client_for(monkeypatch, tmp_path) as client:
        assert client.post('/api/matches', headers={'Origin': ORIGIN}).status_code == 503
        assert client.get('/api/session').status_code == 200


def test_public_global_limit_cannot_be_reset_with_new_clients(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path) as first:
        for index in range(6):
            with TestClient(first.app, base_url=ORIGIN, client=(f'203.0.113.{index+10}',1234)) as client:
                for _ in range(5):
                    assert client.post('/api/matches', headers={'Origin': ORIGIN}).status_code == 200
        assert first.post('/api/matches', headers={'Origin': ORIGIN}).status_code == 429


def test_runtime_budget_blocks_writes_without_deleting_history(monkeypatch, tmp_path):
    import timepitch.security as security
    monkeypatch.setattr(security, 'MAX_PUBLIC_RUNTIME_BYTES', 8)
    database=tmp_path/'grf.sqlite';database.write_bytes(b'preserved')
    with client_for(monkeypatch, tmp_path) as client:
        assert client.post('/api/matches', headers={'Origin': ORIGIN}).status_code == 503
        assert database.read_bytes()==b'preserved'


def test_only_loopback_proxy_can_assert_https(monkeypatch, tmp_path):
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
    with client_for(monkeypatch, tmp_path) as original:
        app=ProxyHeadersMiddleware(original.app,trusted_hosts=['127.0.0.1'])
        for ip,expected in [('203.0.113.90',308),('127.0.0.1',200)]:
            with TestClient(app,base_url=ORIGIN.replace('https:','http:'),client=(ip,1234)) as client:
                response=client.get('/api/session',headers={'X-Forwarded-Proto':'https'},follow_redirects=False)
                assert response.status_code==expected
                if expected==200:assert 'secure' in response.headers['set-cookie'].lower()


def test_local_mode_accepts_vite_dev_origin_through_proxy(monkeypatch, tmp_path):
    # TP216: Vite (launch timepitch-web-dev, port 5178) proxies /api with changeOrigin,
    # so the API sees Host 127.0.0.1:8078 but the browser Origin of the Vite page.
    monkeypatch.delenv('TIMEPITCH_PUBLIC_ORIGIN', raising=False)
    app = FastAPI()
    @app.post('/api/matches')
    def create():
        return {'accepted': True}
    install_security(app)
    with TestClient(app, base_url='http://127.0.0.1:8078') as client:
        for origin in ('http://localhost:5178', 'http://127.0.0.1:5178', 'http://localhost:5173', 'http://127.0.0.1:8078'):
            assert client.post('/api/matches', headers={'Origin': origin}).status_code == 200
        for origin in ('http://localhost:5179', 'https://foreign.example'):
            assert client.post('/api/matches', headers={'Origin': origin}).status_code == 403
        assert client.post('/api/matches').status_code == 403
