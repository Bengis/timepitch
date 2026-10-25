from pathlib import Path
import pytest
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config, simulate_match
from timepitch.matches.repository import MatchRepository

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


@pytest.fixture(scope='module')
def record():
    catalog = CatalogRepository(DATASET)
    return simulate_match(make_config(catalog, 'arsenal:2003', 'mancity:2017', 42), catalog)


def test_restart_preserves_trace_and_duplicate_finish_is_idempotent(tmp_path, record):
    path = tmp_path / 'runtime.sqlite'
    repo = MatchRepository(path)
    job = repo.create(record.config, 'owner')
    assert repo.start(job.id, 'owner')
    repo.finish(job.id, 'owner', record)
    repo.finish(job.id, 'owner', record)
    recovered = MatchRepository(path)
    assert recovered.get_record(job.id, 'owner').trace_hash == record.trace_hash
    assert recovered.get_job(job.id, 'owner').summary.metrics == record.metrics
    with pytest.raises(KeyError):
        recovered.get_record(job.id, 'another-owner')


def test_interrupted_work_is_failed_instead_of_published_as_complete(tmp_path, record):
    path = tmp_path / 'runtime.sqlite'
    repo = MatchRepository(path)
    job = repo.create(record.config, 'owner')
    repo.start(job.id, 'owner')
    recovered = MatchRepository(path)
    assert recovered.get_job(job.id, 'owner').state == 'failed'
    assert recovered.get_job(job.id, 'owner').error == 'interrupted'


def test_retention_keeps_thirty_terminal_jobs_per_owner(tmp_path, record):
    repo = MatchRepository(tmp_path / 'runtime.sqlite')
    first = repo.create(record.config, 'owner')
    repo.fail(first.id, 'owner', 'controlled_failure')
    for _ in range(31):
        job = repo.create(record.config, 'owner')
        repo.fail(job.id, 'owner', 'controlled_failure')
    assert len(repo.list_jobs('owner')) == 30
    assert repo.list_jobs('other-owner') == []
    with pytest.raises(KeyError):
        repo.get_job(first.id, 'owner')
