"""Lossless storage/compatibility gates; no engine or model execution."""
import json
import zlib

import pytest

pytest.register_assert_rewrite('grf_json_fixtures')
from grf_json_fixtures import saved_record, SAVED, UBUNTU, no_match_or_model
from grf_fixtures import replay_fixture, full_replay
from timepitch.grf.codec import encode_grf, grf_hash, grf_input_hash
from timepitch.grf.repository import GrfRepository


def store(repo, record):
    job=repo.create(record.input.config,'owner')
    assert repo.start(job.id,'owner')
    repo.finish(job.id,'owner',record)
    return job


def blob(repo, job):
    with repo.connection() as conn:
        return conn.execute('SELECT record FROM grf_matches WHERE id=?',(job.id,)).fetchone()[0]


@pytest.mark.parametrize('source',['v1','v2','flota','ubuntu'])
def test_new_storage_uses_fast_compression_and_restores_complete_original(tmp_path, source):
    record=replay_fixture() if source=='v1' else full_replay() if source=='v2' else saved_record(UBUNTU) if source=='ubuntu' else saved_record()
    raw=encode_grf(record)
    repo=GrfRepository(tmp_path/'grf.sqlite');job=store(repo,record)
    assert blob(repo,job)==zlib.compress(raw,level=1)
    assert zlib.decompress(blob(repo,job))==raw
    restored=repo.get_record(job.id,'owner')
    assert encode_grf(restored)==raw and restored.trace_hash==record.trace_hash
    if source in ('flota','ubuntu'):
        from timepitch.grf.statistics import build_grf_statistics
        path=UBUNTU if source=='ubuntu' else SAVED
        assert build_grf_statistics(restored).model_dump(mode='json')==json.loads(path.with_name('match-statistics.json').read_bytes())


def test_old_level6_blob_remains_readable_and_is_not_rewritten(tmp_path):
    record=saved_record();raw=encode_grf(record)
    repo=GrfRepository(tmp_path/'grf.sqlite');job=store(repo,record)
    old=zlib.compress(raw,level=6)
    with repo.connection() as conn:
        conn.execute('UPDATE grf_matches SET record=? WHERE id=?',(old,job.id))
    assert encode_grf(repo.get_record(job.id,'owner'))==raw
    repo.finish(job.id,'owner',record)
    assert blob(repo,job)==old
    with pytest.raises(KeyError):repo.get_record(job.id,'stranger')
    with pytest.raises(KeyError):repo.finish(job.id,'stranger',record)
    assert blob(repo,job)==old


def test_ready_result_cannot_be_replaced_by_another_valid_replay(tmp_path):
    record=replay_fixture();raw=encode_grf(record)
    repo=GrfRepository(tmp_path/'grf.sqlite');job=store(repo,record)
    other=record.model_copy(deep=True)
    other.samples[-1].score=(1,0);other.trace_hash=grf_hash(other)
    with pytest.raises(ValueError,match='immutable'):repo.finish(job.id,'owner',other)
    assert encode_grf(repo.get_record(job.id,'owner'))==raw


@pytest.mark.parametrize('mutate',['identity','nonfinite','configuration','oversize'])
def test_failed_validation_never_finishes_or_persists_a_job(tmp_path,monkeypatch,mutate):
    record=replay_fixture();repo=GrfRepository(tmp_path/'grf.sqlite')
    job=repo.create(record.input.config,'owner');repo.start(job.id,'owner')
    if mutate=='identity':record.input.players[0].source_key='forged'
    elif mutate=='nonfinite':record.samples[1].ball_xyz=(float('nan'),0.,.1)
    elif mutate=='configuration':
        record.input.config.seed=123
        record.input.input_hash=grf_input_hash(record.input);record.trace_hash=grf_hash(record)
    else:monkeypatch.setattr('timepitch.grf.codec.MAX_BYTES',10)
    with pytest.raises(ValueError):repo.finish(job.id,'owner',record)
    assert repo.get_job(job.id,'owner').state=='running'
    with repo.connection() as conn:
        row=conn.execute('SELECT record,summary FROM grf_matches WHERE id=?',(job.id,)).fetchone()
    assert row['record'] is None and row['summary'] is None


@pytest.mark.parametrize('kind',['duplicate','nonfinite','unknown','truncated','trailing','concatenated'])
def test_untrusted_stored_blob_keeps_strict_json_and_zlib_guards(tmp_path,kind):
    record=replay_fixture();repo=GrfRepository(tmp_path/'grf.sqlite');job=store(repo,record)
    raw=encode_grf(record)
    if kind=='duplicate':raw=b'{"schema_version":"grf-experimental-1",'+raw[1:]
    if kind=='nonfinite':raw=b'{"unexpected":NaN,'+raw[1:]
    if kind=='unknown':raw=b'{"command":"forbidden",'+raw[1:]
    compressed=zlib.compress(raw,level=1)
    if kind=='truncated':compressed=compressed[:-2]
    if kind=='trailing':compressed+=b'garbage'
    if kind=='concatenated':compressed+=zlib.compress(raw,level=1)
    with repo.connection() as conn:
        conn.execute('UPDATE grf_matches SET record=? WHERE id=?',(compressed,job.id))
    with pytest.raises(ValueError):repo.get_record(job.id,'owner')
    with pytest.raises(KeyError):repo.get_record(job.id,'stranger')
