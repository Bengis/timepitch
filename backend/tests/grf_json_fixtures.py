"""Saved/derived JSON oracles and guards. Never generates a football match."""
import builtins
import gzip
import hashlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SAVED = ROOT/'research/engine-evaluation/2026-10-19-grf-server-match/match-replay.json.gz'
UBUNTU = ROOT/'research/engine-evaluation/2026-10-18-grf-ubuntu-match/match-replay.json.gz'
SAVED_GZIP_SHA = 'c13ed421b66dc24218e303acef622070529486244ca49e83eea56898b3d3bc80'
SAVED_RAW_SHA = '1d9065160cf65ddfdfb4ea6164f5d0f0c0460d90212da17e7de361c29612065d'


@pytest.fixture(autouse=True)
def no_match_or_model(monkeypatch):
    monkeypatch.delenv('TIMEPITCH_LOCAL_MODEL', raising=False)
    original = builtins.__import__
    def guarded(name, *args, **kwargs):
        if name.split('.')[0] in ('gfootball', 'gfootball_engine', '_gameplayfootball'):
            if not getattr(sys.modules.get(name), 'offline_fixture', False):
                raise AssertionError('Real GRF import forbidden in JSON offline tests')
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', guarded)
    from timepitch.simulation import engine
    def forbidden(*args, **kwargs):
        raise AssertionError('Match generation forbidden in JSON offline tests')
    for name in ('simulate_match', 'simulate_metrics', 'simulate_statistics'):
        monkeypatch.setattr(engine, name, forbidden)


def saved_record(path=SAVED):
    from timepitch.grf.codec import parse_grf
    compressed = path.read_bytes()
    raw = gzip.decompress(compressed)
    if path == SAVED:
        assert hashlib.sha256(compressed).hexdigest() == SAVED_GZIP_SHA
        assert hashlib.sha256(raw).hexdigest() == SAVED_RAW_SHA
    return parse_grf(raw)


def derived_native_payload(record):
    """Derived from canonical data; NOT the original recorded native stdout."""
    result = record.model_dump(mode='json', exclude={'input', 'trace_hash'})
    result['input_hash'] = record.input.input_hash
    return result
