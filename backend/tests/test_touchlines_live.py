"""TP243: TouchLines en vivo con el bundle nativo versionado en engines/touchlines (Node real si está instalado)."""
import gzip
import json
import shutil
import time
from pathlib import Path

import pytest
from grf_fixtures import request_fixture, DATASET
from timepitch.catalog.repository import CatalogRepository
from timepitch.touchlines.service import TouchLinesRepository, TouchLinesService, TouchLinesUnavailable, ENGINE_VERSION

ENGINE_DIR = Path(__file__).resolve().parents[2] / 'engines/touchlines'
NODE = shutil.which('node')


def service(tmp_path, node=NODE, engine_dir=ENGINE_DIR):
    return TouchLinesService(CatalogRepository(DATASET), TouchLinesRepository(tmp_path / 'tl.sqlite'), engine_dir, node)


def test_capability_reports_missing_node_and_foreign_bundle(tmp_path):
    assert service(tmp_path, node=None).capability().reason == 'missing_runtime'
    fake = tmp_path / 'engine'; (fake / 'build').mkdir(parents=True)
    (fake / 'build/freeplay-native.mjs').write_text('// not the pinned bundle')
    (fake / 'cal-native.json').write_text('{}')
    assert service(tmp_path, node=NODE or __file__, engine_dir=fake).capability().reason == 'unsupported_native_binary'
    with pytest.raises(TouchLinesUnavailable):
        service(tmp_path, node=None).create_match(request_fixture().config, 'owner')


@pytest.mark.skipif(NODE is None, reason='Node is not installed')
def test_plays_a_native_match_and_stores_recording_and_events(tmp_path):
    tl = service(tmp_path)
    assert tl.capability().available
    job = tl.create_match(request_fixture().config, 'owner')
    for _ in range(240):
        state = tl.repository.get_job(job.id, 'owner')
        if state.state in ('ready', 'failed'): break
        time.sleep(.25)
    assert state.state == 'ready', state.error
    record = json.loads(gzip.decompress(tl.repository.blob(job.id, 'owner', 'record')))
    events = json.loads(gzip.decompress(tl.repository.blob(job.id, 'owner', 'events')))
    assert record['engine_version'] == ENGINE_VERSION and record['touchlines']['native_clock'] is True
    assert record['touchlines']['stop_reason'] == 'match_end' and record['samples'][-1]['match_time_ms'] >= 90 * 60 * 1000
    assert events['schema'] == 'recorded-events-1' and events['recording']['trace_hash'] == record['trace_hash']
    goals = sum(1 for e in events['events'] if e['kind'] == 'goal')
    assert list(state.summary.score) == record['samples'][-1]['score'] and goals == sum(state.summary.score)
    # Otro dueño no ve el partido.
    with pytest.raises(KeyError): tl.repository.blob(job.id, 'other', 'record')
    tl.close()
