import pytest
from timepitch.grf.physical_repository import PhysicalRepository
from grf_fixtures import request_fixture
from grf_physical_fixtures import chunk
from grf_physical_fixtures import write_match,iter_fixture


@pytest.fixture(scope='module')
def complete_match(tmp_path_factory):
    directory=tmp_path_factory.mktemp('complete');return directory,write_match(directory)


def test_atomic_finish_checks_digests_and_is_owned(tmp_path,complete_match):
    directory,manifest=complete_match;repo=PhysicalRepository(tmp_path/'p.sqlite')
    job=repo.create(manifest.input.config,'alice');repo.start(job.id,'alice')
    for block in iter_fixture(directory,manifest):repo.append_chunk(job.id,'alice',block)
    altered=manifest.model_copy(update={'trace_hash':'f'*64})
    with pytest.raises(ValueError):repo.finish(job.id,'alice',altered)
    assert repo.get_job(job.id,'alice').state=='running'
    with pytest.raises(KeyError):repo.get_record(job.id,'alice')
    repo.finish(job.id,'alice',manifest)
    assert repo.get_record(job.id,'alice')==manifest
    assert repo.get_chunk(job.id,'alice',0).index==0
    with pytest.raises(KeyError):repo.get_chunk(job.id,'bob',0)
    with pytest.raises(KeyError):repo.export(job.id,'bob')
    assert len(list(repo.export(job.id,'alice')))==len(manifest.chunks)+1
    with pytest.raises(ValueError):repo.append_chunk(job.id,'alice',chunk(55))
    assert PhysicalRepository(repo.path).get_record(job.id,'alice').trace_hash==manifest.trace_hash


def test_truncated_job_cannot_be_published_and_failed_blocks_are_removed(tmp_path,complete_match):
    directory,manifest=complete_match;repo=PhysicalRepository(tmp_path/'p.sqlite')
    job=repo.create(manifest.input.config,'alice');repo.start(job.id,'alice')
    repo.append_chunk(job.id,'alice',next(iter_fixture(directory,manifest)))
    with pytest.raises(ValueError):repo.finish(job.id,'alice',manifest)
    repo.fail(job.id,'alice','interrupted')
    assert repo.get_job(job.id,'alice').state=='failed'
    with repo.connection() as conn:assert conn.execute('SELECT COUNT(*) FROM physical_chunks').fetchone()[0]==0


def test_partial_chunks_are_never_visible_and_restart_fails_job(tmp_path):
    path=tmp_path/'physical.sqlite';repo=PhysicalRepository(path)
    job=repo.create(request_fixture().config,'alice');repo.start(job.id,'alice')
    repo.append_chunk(job.id,'alice',chunk())
    with pytest.raises(KeyError):repo.get_chunk(job.id,'alice',0)
    with pytest.raises(KeyError):repo.get_job(job.id,'bob')
    reopened=PhysicalRepository(path)
    assert reopened.get_job(job.id,'alice').state=='failed'
    assert list(reopened.list_jobs('bob'))==[]


def test_chunk_order_duplicates_and_owner_are_enforced(tmp_path):
    repo=PhysicalRepository(tmp_path/'p.sqlite');job=repo.create(request_fixture().config,'alice');repo.start(job.id,'alice')
    with pytest.raises(KeyError):repo.append_chunk(job.id,'bob',chunk())
    with pytest.raises(ValueError):repo.append_chunk(job.id,'alice',chunk(1))
    repo.append_chunk(job.id,'alice',chunk())
    with pytest.raises(ValueError):repo.append_chunk(job.id,'alice',chunk())


def test_failed_job_retention_is_bounded_per_owner(tmp_path):
    repo=PhysicalRepository(tmp_path/'p.sqlite');config=request_fixture().config
    for _ in range(35):
        job=repo.create(config,'alice');repo.fail(job.id,'alice','interrupted')
    assert len(repo.list_jobs('alice'))==30
