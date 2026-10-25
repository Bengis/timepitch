import json
from concurrent.futures import ThreadPoolExecutor
import pytest
from chronicle_fixtures import pack
from timepitch.chronicles.repository import ChronicleRepository, ChronicleConflict, ChronicleQueueFull
from timepitch.chronicles.models import ChronicleRequest, WorkerIdentity, WorkerResult, ChronicleSelection

WORKER = WorkerIdentity(worker_id='test-worker')


class Clock:
    def __init__(self): self.now = 1000.
    def __call__(self): return self.now


def submit(repo, id='one', engine='grf', locale='en', owner='alice'):
    p = pack().model_copy(update={'engine':engine})
    return repo.submit(owner, ChronicleRequest(engine=engine, match_id=id, trace_hash=p.trace_hash, locale=locale), p)


def result(claim, variant=0):
    goal = next(f.id for f in claim.fact_pack.facts if f.kind == 'goal')
    return WorkerResult(lease=claim.lease, selection=ChronicleSelection(headline={'fact_ids':['result'],'variant':variant},
        paragraphs=[{'fact_ids':[goal],'variant':variant}]), actual_calls=4, evidence_reads=1)


def ready_repo(tmp_path):
    clock = Clock(); repo = ChronicleRepository(tmp_path/'runtime.sqlite',clock)
    repo.heartbeat(WORKER,None,True)
    return repo,clock


def test_owner_engine_cache_identity_and_immutability(tmp_path):
    repo, _ = ready_repo(tmp_path)
    a = submit(repo); assert submit(repo).id == a.id
    assert submit(repo,engine='timepitch').id != a.id
    assert submit(repo,locale='es').id != a.id
    assert submit(repo,owner='bob').id != a.id
    with pytest.raises(KeyError): repo.get(a.id,'bob')
    claim = repo.claim(WORKER,job_id=a.id)
    done = repo.complete(WORKER,result(claim),text='Validated text')
    assert done.state == 'ready' and done.calls_reserved == done.actual_calls == 4
    assert repo.complete(WORKER,result(claim),text='Validated text') == done
    with pytest.raises(ChronicleConflict): repo.complete(WORKER,result(claim,1),text='Different text')
    assert repo.get(a.id,'alice') == done
    public = done.model_dump_json()
    assert claim.lease.lease_token not in public and 'owner' not in public


def test_bounded_queue_and_worker_readiness(tmp_path):
    repo, _ = ready_repo(tmp_path)
    for i in range(4): submit(repo,str(i))
    with pytest.raises(ChronicleQueueFull): submit(repo,'extra')
    claim = repo.claim(WORKER); assert claim
    submit(repo,'fourth-waiting')
    with pytest.raises(ChronicleQueueFull): submit(repo,'sixth')
    assert repo.claim(WORKER) is None
    assert repo.status().state == 'busy'


def test_single_claim_and_completion_race_between_connections(tmp_path):
    repo, clock = ready_repo(tmp_path); submit(repo)
    other = ChronicleRepository(tmp_path/'runtime.sqlite',clock)
    with ThreadPoolExecutor(2) as pool: claims = list(pool.map(lambda r:r.claim(WORKER), [repo,other]))
    assert sum(c is not None for c in claims) == 1
    claim = next(c for c in claims if c)
    with ThreadPoolExecutor(2) as pool: results = list(pool.map(lambda r:r.complete(WORKER,result(claim),text='same'), [repo,other]))
    assert results[0] == results[1] and results[0].state == 'ready'


@pytest.mark.parametrize('seconds,error',[(60,'lease_expired'),(180,'job_timeout')])
def test_expiry_never_reruns_or_refunds(tmp_path,seconds,error):
    repo, clock = ready_repo(tmp_path); job = submit(repo); claim=repo.claim(WORKER)
    clock.now += seconds
    repo.expire()
    assert repo.get(job.id,'alice').error == error
    with pytest.raises(ChronicleConflict): repo.complete(WORKER,result(claim),text='late')
    assert repo.get(job.id,'alice').calls_reserved == 4
    assert repo.claim(WORKER) is None


def test_heartbeat_job_deadline_and_restart_persist(tmp_path):
    repo, clock = ready_repo(tmp_path); job=submit(repo); claim=repo.claim(WORKER)
    clock.now += 50; repo.heartbeat(WORKER,claim.lease,True)
    restarted = ChronicleRepository(tmp_path/'runtime.sqlite',clock)
    assert restarted.get(job.id,'alice').state == 'running'
    assert restarted.claim(WORKER) is None
    clock.now += 40; restarted.heartbeat(WORKER,claim.lease,True)
    clock.now += 50; restarted.heartbeat(WORKER,claim.lease,True)
    clock.now = 1180; restarted.expire()
    assert restarted.get(job.id,'alice').error == 'job_timeout'


def test_queue_expiry_clock_regression_and_no_uncertain_refund(tmp_path):
    repo, clock = ready_repo(tmp_path); job=submit(repo)
    clock.now += 900; repo.expire()
    assert repo.get(job.id,'alice').error == 'queue_expired'
    assert repo.get(job.id,'alice').calls_reserved == 0
    repo.heartbeat(WORKER,None,True); next_job=submit(repo,'next'); repo.claim(WORKER)
    clock.now -= 1
    with pytest.raises(ChronicleConflict): repo.claim(WORKER)
    clock.now += 1
    assert repo.get(next_job.id,'alice').error == 'clock_regressed'
    assert repo.get(next_job.id,'alice').calls_reserved == 4


@pytest.mark.parametrize('field,value',[('lease_token','x'*40),('fact_hash','c'*64),('generation',2)])
def test_wrong_lease_never_completes(tmp_path,field,value):
    repo, _ = ready_repo(tmp_path); job=submit(repo); claim=repo.claim(WORKER)
    bad=result(claim).model_copy(update={'lease':claim.lease.model_copy(update={field:value})})
    with pytest.raises(ChronicleConflict): repo.complete(WORKER,bad,text='forged')
    assert repo.get(job.id,'alice').state == 'running'


def test_legacy_usage_all_modes_prevents_new_allowance(tmp_path):
    repo, _ = ready_repo(tmp_path)
    with repo.connection() as conn:
        conn.execute('CREATE TABLE explanations (id TEXT, owner TEXT, match_id TEXT, revision TEXT, locale TEXT, mode TEXT, body TEXT)')
        for mode in ('fan','analyst'):
            body=json.dumps({'calls_reserved':2,'window':{'id':'fulltime'}})
            conn.execute('INSERT INTO explanations VALUES(?,?,?,?,?,?,?)',(mode,'alice','one','a'*64,'en',mode,body))
    job=submit(repo,engine='timepitch')
    assert repo.claim(WORKER) is None
    assert repo.get(job.id,'alice').error == 'budget_exhausted'
    with repo.connection() as conn: assert conn.execute('SELECT body FROM explanations').fetchall()[0][0] == body


def test_wrong_worker_and_corrupted_stored_pack_are_refused(tmp_path):
    repo, _ = ready_repo(tmp_path); job=submit(repo)
    with repo.connection() as conn: conn.execute("UPDATE chronicle_jobs SET pack_json='{}' WHERE id=?",(job.id,))
    with pytest.raises(ChronicleConflict): repo.claim(WORKER)
    assert repo.get(job.id,'alice').calls_reserved == 0


def test_refused_late_result_persists_expiry(tmp_path):
    repo, clock = ready_repo(tmp_path); job=submit(repo); claim=repo.claim(WORKER)
    clock.now += 60
    with pytest.raises(ChronicleConflict): repo.complete(WORKER,result(claim),text='late')
    with repo.connection() as conn:
        row=conn.execute('SELECT state,error FROM chronicle_jobs WHERE id=?',(job.id,)).fetchone()
        assert tuple(row)==('unavailable','lease_expired')
