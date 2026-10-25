"""Cross-platform launch checks without starting GRF or a match."""
import hashlib
import gzip
import json
from pathlib import Path

import pytest

from grf_statistics_fixtures import statistics_replay
from timepitch.grf.codec import encode_grf, grf_hash, parse_grf
from timepitch.grf.process import GrfProcess
from timepitch.grf import runtime_layout as layout


def test_linux_layout_checks_assets_without_windows_dlls(tmp_path, monkeypatch):
    monkeypatch.setattr(layout, 'PLATFORM', 'linux')
    python = tmp_path/'env/bin/python3.10'
    python.parent.mkdir(parents=True)
    python.write_bytes(b'python')
    native = tmp_path/'native'
    native.mkdir()
    binary = native/'_gameplayfootball.so'
    binary.write_bytes(b'linux-test-fixture')
    monkeypatch.setattr(layout, 'LINUX_STATS_SHA256', hashlib.sha256(binary.read_bytes()).hexdigest())
    packages = tmp_path/'env/lib/python3.10/site-packages'
    assets = packages/'gfootball_engine'
    files = [packages/'gfootball/env/football_env_core.py', assets/'fonts/AlegreyaSansSC-ExtraBold.ttf']
    manifest = json.loads(Path(layout.__file__).with_name('assets.json').read_text())
    files += [assets/'data'/name for name in manifest]
    for file in files:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b'present')
    runner = GrfProcess(python, native)
    assert runner.capability().available
    assert layout.native_binary(native) == binary
    assert layout.package_directory(python) == packages
    files[-1].unlink()
    assert runner.capability().reason == 'missing_assets'
    files[-1].write_bytes(b'present')
    binary.write_bytes(b'changed')
    assert runner.capability().reason == 'unsupported_native_binary'


def test_linux_identity_is_accepted_without_loosening_other_hashes():
    record = statistics_replay()
    windows = record.native_binary_sha256
    record.native_binary_sha256 = layout.LINUX_STATS_SHA256
    record.trace_hash = grf_hash(record)
    assert parse_grf(encode_grf(record)).native_binary_sha256 == layout.LINUX_STATS_SHA256
    record.native_binary_sha256 = 'f'*64
    record.trace_hash = grf_hash(record)
    with pytest.raises(ValueError, match='integrity'):
        parse_grf(encode_grf(record))
    record.native_binary_sha256 = windows
    record.trace_hash = grf_hash(record)
    assert parse_grf(encode_grf(record)) == record


def test_windows_layout_remains_explicit(monkeypatch, tmp_path):
    monkeypatch.setattr(layout, 'PLATFORM', 'win32')
    python = tmp_path/'python/python.exe'
    assert layout.package_directory(python) == python.parent/'Lib/site-packages'
    assert layout.native_binary(tmp_path).name == '_gameplayfootball.pyd'
    assert len(layout.required_libraries(tmp_path)) == 14


def test_retained_ubuntu_match_parses_and_reduces_without_native_execution():
    from timepitch.grf.statistics import build_grf_statistics
    evidence = Path(__file__).resolve().parents[2]/'research/engine-evaluation/2026-10-18-grf-ubuntu-match'
    result = json.loads((evidence/'match-result.json').read_bytes())
    raw = gzip.decompress((evidence/'match-replay.json.gz').read_bytes())
    assert hashlib.sha256(raw).hexdigest() == result['replay_file_sha256']
    record = parse_grf(raw)
    assert record.native_binary_sha256 == layout.LINUX_STATS_SHA256
    assert len(record.attribute_readbacks) == 66
    assert record.completion_reason == 'full_time'
    assert record.samples[-1].score == (0, 0)
    assert build_grf_statistics(record).model_dump(mode='json') == json.loads((evidence/'match-statistics.json').read_bytes())
