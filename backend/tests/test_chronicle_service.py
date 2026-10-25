"""Offline broker acceptance: synthetic facts only, no engines/providers."""
import pytest
from chronicle_fixtures import pack
from test_chronicle_repository import Clock, WORKER, result
from timepitch.chronicles.models import ChronicleRequest
from timepitch.chronicles.repository import ChronicleRepository, ChronicleConflict
from timepitch.chronicles.service import ChronicleService


def setup(tmp_path):
    clock=Clock(); repo=ChronicleRepository(tmp_path/'runtime.sqlite',clock)
    sources={('alice','one'):pack()}
    def source(owner,request):
        value=sources[(owner,request.match_id)]
        if value.trace_hash!=request.trace_hash or value.engine!=request.engine: raise ValueError('Stale source')
        return value
    return ChronicleService(repo,source),sources,clock


def request(): return ChronicleRequest(engine='grf',match_id='one',trace_hash='a'*64,locale='en')


def test_owned_source_lookup_and_server_composition(tmp_path):
    service,sources,_=setup(tmp_path)
    assert service.lookup('alice',request()) is None
    with pytest.raises(KeyError): service.submit('bob',request())
    with pytest.raises(ValueError): service.submit('alice',request().model_copy(update={'engine':'timepitch'}))
    job=service.submit('alice',request()); service.repository.heartbeat(WORKER,None,True)
    claim=service.claim(WORKER); done=service.complete(WORKER,result(claim))
    assert done.state=='ready' and done.provenance=='validated_worker_ai'
    assert '1' in done.text and claim.fact_pack.home_name in done.text
    assert service.complete(WORKER,result(claim))==done
    with pytest.raises(KeyError): service.get('bob',job.id)
    del sources[('alice','one')]
    with pytest.raises(KeyError): service.get('alice',job.id)


def test_pruned_source_before_claim_has_no_reservation(tmp_path):
    service,sources,_=setup(tmp_path); job=service.submit('alice',request())
    del sources[('alice','one')]; service.repository.heartbeat(WORKER,None,True)
    assert service.claim(WORKER) is None
    saved=service.repository.get(job.id,'alice')
    assert saved.error=='source_unavailable' and saved.calls_reserved==0


def test_changed_facts_and_invalid_selection_cannot_be_ready(tmp_path):
    service,sources,_=setup(tmp_path); job=service.submit('alice',request())
    service.repository.heartbeat(WORKER,None,True); claim=service.claim(WORKER)
    bad=result(claim); bad.selection.paragraphs[0].fact_ids=['invented']
    with pytest.raises(ValueError): service.complete(WORKER,bad)
    saved=service.repository.get(job.id,'alice')
    assert saved.state=='rejected' and saved.calls_reserved==4 and saved.text==''


def test_invalid_lease_cannot_reject_another_job(tmp_path):
    service,_,_=setup(tmp_path); job=service.submit('alice',request())
    service.repository.heartbeat(WORKER,None,True); claim=service.claim(WORKER)
    bad=result(claim); bad.lease.lease_token='z'*40; bad.selection.paragraphs[0].fact_ids=['invented']
    with pytest.raises(ChronicleConflict): service.complete(WORKER,bad)
    assert service.repository.get(job.id,'alice').state=='running'


def test_same_trace_changed_pack_is_rejected_at_completion(tmp_path):
    service,sources,_=setup(tmp_path); job=service.submit('alice',request())
    service.repository.heartbeat(WORKER,None,True); claim=service.claim(WORKER)
    sources[('alice','one')].home_name='Changed name'
    with pytest.raises(ValueError): service.complete(WORKER,result(claim))
    assert service.repository.get(job.id,'alice').error=='stale_revision'
