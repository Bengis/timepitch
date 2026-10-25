"""Reuse owner-scoped physical storage, without schema migration or flattened fields."""
import json
import pytest
from grf_action_fixtures import write_action_match
from grf_physical_fixtures import iter_fixture
from timepitch.grf.physical_repository import PhysicalRepository
from timepitch.grf.physical_codec import make_chunk_ref, manifest_hash,parse_manifest


@pytest.fixture(scope='module')
def stored_actions(tmp_path_factory):
    path=tmp_path_factory.mktemp('action-store');return path,write_action_match(path)


def test_action_publish_is_atomic_and_export_preserves_evidence_for_owner(tmp_path,stored_actions):
    directory,m=stored_actions;repo=PhysicalRepository(tmp_path/'actions.sqlite')
    job=repo.create(m.input.config,'alice');repo.start(job.id,'alice')
    for c in iter_fixture(directory,m):repo.append_chunk(job.id,'alice',c)
    with pytest.raises(KeyError):repo.get_record(job.id,'alice')
    with pytest.raises(KeyError):repo.get_chunk(job.id,'alice',0)
    bad=m.model_copy(deep=True);bad.semantic_event_count=0;bad.trace_hash=manifest_hash(bad)
    with pytest.raises(ValueError):repo.finish(job.id,'alice',bad)
    assert repo.get_job(job.id,'alice').state=='running'
    repo.finish(job.id,'alice',m)
    actual=repo.get_record(job.id,'alice')
    assert actual==m and repo.get_chunk(job.id,'alice',0).contact_roles==[2]
    lines=iter(repo.export(job.id,'alice'));exported=parse_manifest(json.loads(next(lines))['manifest'])
    assert exported==m
    from timepitch.grf.action_models import ActionChunk
    for ref,line in zip(m.chunks,lines):
        block=ActionChunk.model_validate(json.loads(line)['chunk'])
        assert make_chunk_ref(block)==ref
    for method,args in [(repo.get_job,()),(repo.get_record,()),(repo.get_chunk,(0,)),(repo.export,()),(repo.finish,(m,))]:
        with pytest.raises(KeyError):method(job.id,'bob',*args)


def test_prefix_never_becomes_ready_and_failure_removes_chunks(tmp_path,stored_actions):
    directory,m=stored_actions;repo=PhysicalRepository(tmp_path/'actions.sqlite')
    job=repo.create(m.input.config,'alice');repo.start(job.id,'alice')
    repo.append_chunk(job.id,'alice',next(iter_fixture(directory,m)))
    with pytest.raises(ValueError):repo.finish(job.id,'alice',m)
    with pytest.raises(KeyError):repo.get_record(job.id,'alice')
    repo.fail(job.id,'alice','interrupted')
    with repo.connection() as conn:assert conn.execute('SELECT COUNT(*) FROM physical_chunks').fetchone()[0]==0
