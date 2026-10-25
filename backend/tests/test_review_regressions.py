from pathlib import Path
import threading
import pytest
from fastapi.testclient import TestClient
from timepitch.app import create_app
from timepitch.catalog.repository import CatalogRepository
from timepitch.matches.repository import MatchRepository
from timepitch.matches.service import MatchService
from timepitch.simulation.engine import make_config, simulate_match, compute_trace_hash, validate_trace
from timepitch.simulation.metrics import reduce_metrics

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


@pytest.fixture(scope='module')
def record():
    # Preserve V1's frame/identity security regressions after activating engine-2.
    from test_replay_versions import legacy_record
    return legacy_record()


@pytest.mark.parametrize('change', ['team_name', 'player_name'])
def test_import_rejects_rehashed_invented_historical_metadata(tmp_path, record, change):
    altered = record.model_copy(deep=True)
    if change == 'team_name': altered.home_name = 'Invented historical team'
    else:
        key = altered.initial_frame.players[0].key
        for frame in [altered.initial_frame, *(e.frame_after for e in altered.events)]:
            next(p for p in frame.players if p.key == key).name = 'Invented historical player'
    altered.trace_hash = compute_trace_hash(altered)
    service = MatchService(CatalogRepository(DATASET), MatchRepository(tmp_path / 'runtime.sqlite'))
    try:
        with pytest.raises(ValueError): service.import_match(altered, 'owner')
    finally: service.close()


def test_rehashed_trace_without_possession_evidence_is_invalid(record):
    altered = record.model_copy(deep=True)
    for event in altered.events: event.evidence.pop('possession_side', None)
    altered.metrics = reduce_metrics(altered.events)
    altered.trace_hash = compute_trace_hash(altered)
    assert validate_trace(altered)


def test_player_identity_cannot_change_inside_a_rehashed_replay(record):
    altered = record.model_copy(deep=True)
    altered.events[10].frame_after.players[0].name = 'Someone else'
    altered.trace_hash = compute_trace_hash(altered)
    assert validate_trace(altered)


@pytest.mark.parametrize('change', ['initial_carrier', 'period'])
def test_rehashed_frames_obey_carrier_and_period_invariants(record, change):
    altered = record.model_copy(deep=True)
    if change == 'initial_carrier': altered.initial_frame.carrier = 'unknown-player'
    else: altered.events[0].frame_after.period = 2
    altered.trace_hash = compute_trace_hash(altered)
    assert validate_trace(altered)


def test_second_runtime_instance_cannot_interrupt_the_first(tmp_path, monkeypatch):
    released = threading.Event()
    from timepitch.matches import service as module
    original = module.simulate_match
    def blocked(config, catalog):
        released.wait(10)
        return original(config, catalog)
    monkeypatch.setattr(module, 'simulate_match', blocked)
    app = create_app(dataset_path=DATASET, runtime_dir=tmp_path)
    with TestClient(app, base_url='http://127.0.0.1:8078', headers={'Origin': 'http://127.0.0.1:8078'}) as first:
        try:
            config = make_config(CatalogRepository(DATASET), 'arsenal:2003', 'mancity:2017')
            job = first.post('/api/matches', json=config.model_dump()).json()
            other = create_app(dataset_path=DATASET, runtime_dir=tmp_path)
            with pytest.raises(RuntimeError, match='already in use'):
                with TestClient(other): pass
            assert first.get('/api/matches/' + job['id']).json()['state'] in ('queued', 'running')
        finally: released.set()
