import zlib
import pytest
from grf_fixtures import replay_fixture
from timepitch.grf.repository import GrfRepository
from timepitch.grf.codec import MAX_BYTES


@pytest.fixture(scope='module')
def record(): return replay_fixture()


def store(repo, record, owner='owner'):
    job=repo.create(record.input.config, owner)
    assert repo.start(job.id, owner)
    repo.finish(job.id, owner, record)
    return job


def test_owned_roundtrip_immutable_ready_and_interrupted_recovery(tmp_path, record):
    repo=GrfRepository(tmp_path/'grf.sqlite');job=store(repo, record)
    repo.finish(job.id,'owner',record)
    assert repo.get_record(job.id,'owner') == record
    with pytest.raises(KeyError):repo.get_record(job.id,'stranger')
    with pytest.raises(KeyError):repo.get_job(job.id,'stranger')
    assert not repo.start(job.id,'stranger')
    active=repo.create(record.input.config,'owner');repo.start(active.id,'owner')
    reopened=GrfRepository(repo.path)
    assert reopened.get_job(active.id,'owner').error == 'interrupted'
    assert reopened.get_job(job.id,'owner').summary.score == (0,0)
    changed=record.model_copy(deep=True);changed.trace_hash='0'*64
    with pytest.raises(ValueError):reopened.finish(job.id,'owner',changed)


def test_retains_thirty_terminal_jobs_and_all_active_jobs_per_owner(tmp_path, record):
    repo=GrfRepository(tmp_path/'grf.sqlite')
    active=repo.create(record.input.config,'owner')
    outsider=store(repo,record,'stranger')
    for _ in range(32):
        job=repo.create(record.input.config,'owner');repo.fail(job.id,'owner','controlled')
    jobs=repo.list_jobs('owner')
    assert len([j for j in jobs if j.state=='failed']) == 30
    assert any(j.id==active.id and j.state=='queued' for j in jobs)
    assert repo.get_record(outsider.id,'stranger') == record


def test_compressed_bomb_and_wrong_job_configuration_are_rejected(tmp_path, record):
    repo=GrfRepository(tmp_path/'grf.sqlite');job=store(repo,record)
    with repo.connection() as conn:
        conn.execute('UPDATE grf_matches SET record=? WHERE id=?',(zlib.compress(b' '*(MAX_BYTES+1)),job.id))
    with pytest.raises(ValueError):repo.get_record(job.id,'owner')
    wrong=repo.create(record.input.config.model_copy(update={'seed':123}),'owner');repo.start(wrong.id,'owner')
    with pytest.raises(ValueError):repo.finish(wrong.id,'owner',record)


def test_restart_prunes_new_terminal_jobs_without_losing_other_owners(tmp_path, record):
    repo=GrfRepository(tmp_path/'grf.sqlite')
    for _ in range(30):
        job=repo.create(record.input.config,'owner');repo.fail(job.id,'owner','controlled')
    for _ in range(4): repo.create(record.input.config,'owner')
    other=store(repo,record,'stranger')
    reopened=GrfRepository(repo.path)
    assert len(reopened.list_jobs('owner')) == 30
    assert reopened.get_record(other.id,'stranger') == record
