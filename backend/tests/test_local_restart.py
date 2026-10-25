"""Exercise real separate server processes, SQLite and the signed browser cookie."""
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import build_opener, HTTPCookieProcessor, Request
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config

ROOT = Path(__file__).resolve().parents[2]


def test_restart_preserves_the_owned_replay_and_session(tmp_path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    env = {**os.environ, 'TIMEPITCH_RUNTIME_DIR': str(tmp_path)}
    env.pop('TIMEPITCH_LOCAL_MODEL', None)
    process = None
    def start():
        nonlocal process
        process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'timepitch.app:create_app', '--factory', '--host', '127.0.0.1', '--port', str(port)],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        for _ in range(150):
            try:
                with opener.open(base + '/api/health', timeout=1) as response:
                    if response.status == 200: return
            except (URLError, ConnectionError, TimeoutError): time.sleep(.1)
        raise AssertionError('Isolated API failed to start')
    def stop():
        if process is not None and process.poll() is None: process.terminate(); process.wait(timeout=10)
    def get(path):
        with opener.open(base + path, timeout=5) as response: return json.load(response)
    try:
        start()
        catalog = CatalogRepository(ROOT / 'research/data-audit/2026-10-16/derived/coverage.sqlite')
        config = make_config(catalog, 'arsenal:1992', 'liverpool:2018')
        request = Request(base + '/api/matches', data=config.model_dump_json().encode(), headers={'Content-Type': 'application/json', 'Origin': base})
        with opener.open(request, timeout=5) as response: match_id = json.load(response)['id']
        deadline = time.monotonic()+40
        while time.monotonic() < deadline:
            if get('/api/matches/' + match_id)['state'] == 'ready': break
            time.sleep(.05)
        else: raise AssertionError('Isolated simulation did not finish within 40 s')
        before = get(f'/api/matches/{match_id}/replay')
        stop(); start()
        after = get(f'/api/matches/{match_id}/replay')
        assert before['trace_hash'] == after['trace_hash']
        assert before['events'] == after['events']
        assert get('/api/matches')[0]['id'] == match_id
    finally: stop()
