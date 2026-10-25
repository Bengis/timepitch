import importlib
import pytest
from azure_chronicle_fixtures import api, ready, source, request, prepared, receipt, forbid_runtime
from timepitch.chronicles.models import canonical_bytes


@pytest.fixture(autouse=True)
def offline_only(monkeypatch):forbid_runtime(monkeypatch)


def service_for(tmp_path):
    m,r=api()
    assert importlib.util.find_spec('timepitch.chronicles.azure.service') is not None, 'Azure service is not implemented'
    s=importlib.import_module('timepitch.chronicles.azure.service')
    from timepitch.chronicles.azure.settings import AzureSettings
    repo,clock,b,grant=ready(tmp_path/'runtime.sqlite')
    pack=source()
    def resolve(owner,req):
        if owner!='alice':raise KeyError('missing')
        return pack
    return s.AzureChronicleService(repo,resolve,AzureSettings('public',b)),pack


def test_source_rechecked_at_claim_and_completion(tmp_path):
    service,pack=service_for(tmp_path)
    service.submit('alice',request())
    claim=service.claim('worker');permit=service.repository.authorize_send(claim.lease,prepared(claim))
    pack.coverage.notes.append('changed source')
    with pytest.raises(ValueError):service.complete(claim.lease,receipt(claim,permit))
    assert service.repository.get('alice',claim.lease.job_id).state=='stale'
    assert service.repository.usage()['actual_input_tokens']==32


def test_invalid_lease_cannot_touch_source_or_reject_job(tmp_path):
    _,r=api();service,_=service_for(tmp_path)
    job=service.submit('alice',request());claim=service.claim('worker')
    permit=service.repository.authorize_send(claim.lease,prepared(claim))
    def deny(*args):raise AssertionError('Forged lease must be fenced before source resolution')
    service.source=deny
    with pytest.raises(r.AzureConflict):service.complete(claim.lease.model_copy(update={'token':'x'*43}),receipt(claim,permit))
    assert service.repository.get('alice',job.id).state=='running'
    assert service.repository.usage()['actual_input_tokens'] is None


def test_claim_skips_stale_or_unowned_sources_without_reserving(tmp_path):
    service,pack=service_for(tmp_path)
    job=service.submit('alice',request());pack.score[0]=2
    assert service.claim('worker') is None
    assert service.repository.get('alice',job.id).state=='stale'
    assert service.repository.usage()['charged_calls']==0


def test_source_adapter_reuses_guarded_saved_records(tmp_path):
    from chronicle_fixtures import canonical,grf_pair
    from timepitch.chronicles.service import saved_source
    from timepitch.chronicles.models import ChronicleRequest
    service,_=service_for(tmp_path);record,stats=grf_pair();legacy=canonical()
    class Matches:
        def get_record(self,id,owner):
            if owner!='alice':raise KeyError('missing')
            return legacy
    class Grf:
        def get_match(self,id,owner):
            if owner!='alice':raise KeyError('missing')
            return record
        def get_statistics(self,id,owner):return stats
    resolve=saved_source(Matches(),Grf());before=canonical_bytes(record)
    for engine,trace in [('grf',record.trace_hash),('timepitch',legacy.trace_hash)]:
        req=ChronicleRequest(engine=engine,match_id='one',trace_hash=trace,locale='en')
        assert resolve('alice',req).engine==engine
        with pytest.raises(KeyError):resolve('bob',req)
    # A source without the actual fulltime event is not a finished TimePitch match.
    legacy.events=[e for e in legacy.events if e.type!='fulltime']
    with pytest.raises(ValueError):resolve('alice',ChronicleRequest(engine='timepitch',match_id='one',trace_hash=legacy.trace_hash,locale='en'))
    assert canonical_bytes(record)==before
    from types import SimpleNamespace
    record=SimpleNamespace(schema_version='grf-physical-1')
    with pytest.raises(ValueError,match='Unsupported replay profile'):
        resolve('alice',ChronicleRequest(engine='grf',match_id='one',trace_hash='a'*64,locale='en'))


def test_fenced_late_receipt_records_usage_without_reopening(tmp_path):
    _,r=api()
    service,_=service_for(tmp_path);repo=service.repository
    job=service.submit('alice',request());claim=service.claim('worker')
    permit=repo.authorize_send(claim.lease,prepared(claim));repo.clock.now=1181.
    assert repo.get('alice',job.id).state=='unavailable'
    with pytest.raises(ValueError):service.complete(claim.lease,receipt(claim,permit))
    assert repo.usage()['actual_input_tokens']==32
    assert repo.get('alice',job.id).state=='unavailable'


@pytest.mark.parametrize('change',[{'model':'unexpected-model'},{'error':'provider_error','draft':None}])
def test_terminal_provider_failure_preserves_usage_and_ends_job(tmp_path,change):
    service,_=service_for(tmp_path);repo=service.repository
    job=service.submit('alice',request());claim=service.claim('worker')
    permit=repo.authorize_send(claim.lease,prepared(claim))
    with pytest.raises(ValueError):service.complete(claim.lease,receipt(claim,permit).model_copy(update=change))
    assert repo.usage()['actual_input_tokens']==32
    assert repo.get('alice',job.id).state in ('rejected','unavailable')
