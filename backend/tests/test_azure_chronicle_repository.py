import json
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import multiprocessing
from pathlib import Path
import sqlite3
from hashlib import sha256
import pytest
from azure_chronicle_fixtures import api, ready, submit, prepared, receipt, checked, db_claim


def test_concurrent_owners_share_global_limit(tmp_path):
    _, r = api()
    repo, _, b, _ = ready(tmp_path/'runtime.sqlite')
    with ThreadPoolExecutor(2) as pool:
        jobs=list(pool.map(lambda owner:submit(repo,b,owner),('alice','bob')))
    claim=repo.claim('worker')
    def send(_):
        try: return repo.authorize_send(claim.lease,prepared(claim)).attempt_id
        except r.AzureConflict: return None
    with ThreadPoolExecutor(2) as pool: results=list(pool.map(send,range(2)))
    assert sum(value is not None for value in results)==1
    assert repo.usage()['charged_calls']==1
    repo.fail(claim.lease,'uncertain_send',uncertain=True)
    with pytest.raises(r.AzureBudgetExceeded): repo.claim('another-worker')


def test_two_processes_cannot_claim_two_running_jobs(tmp_path):
    api()
    repo, _, b, _=ready(tmp_path/'runtime.sqlite',calls=2)
    submit(repo,b); submit(repo,b,match='two')
    with ProcessPoolExecutor(2,mp_context=multiprocessing.get_context('spawn')) as pool:
        outcomes=list(pool.map(db_claim,[str(repo.path)]*2,['child-a','child-b']))
    assert sum(value is not None for value in outcomes)==1


def test_duplicate_completion_is_idempotent(tmp_path):
    _, r=api()
    repo,clock,b,_=ready(tmp_path/'runtime.sqlite'); job=submit(repo,b)
    claim=repo.claim('worker'); permit=repo.authorize_send(claim.lease,prepared(claim))
    value=receipt(claim,permit); repo.record_receipt(claim.lease,value)
    done=repo.finish(claim.lease,checked(claim))
    assert done.state=='ready' and done.checked.semantic_verified is False
    clock.now+=500
    assert repo.finish(claim.lease,checked(claim))==done
    assert repo.get('alice',job.id)==done
    with pytest.raises(KeyError): repo.get('bob',job.id)
    with pytest.raises(r.AzureConflict): repo.record_receipt(claim.lease,value.model_copy(update={'elapsed_ms':999}))
    dumped=done.model_dump_json()
    assert claim.lease.token not in dumped and 'owner' not in dumped and 'openai.azure.com' not in dumped


def test_expiry_clock_regression_and_stale_generation(tmp_path):
    _,r=api()
    repo,clock,b,_=ready(tmp_path/'runtime.sqlite',calls=3)
    first=submit(repo,b); clock.now=1901.
    assert repo.claim('worker') is None
    assert repo.get('alice',first.id).state=='unavailable'
    submit(repo,b,match='two'); claim=repo.claim('worker')
    with pytest.raises(r.AzureConflict): repo.authorize_send(claim.lease.model_copy(update={'generation':99}),prepared(claim))
    repo.authorize_send(claim.lease,prepared(claim)); clock.now=1800.
    with pytest.raises(r.AzureConflict): repo.claim('worker')
    clock.now=1902.
    assert repo.get('alice',claim.lease.job_id).state=='unavailable'
    assert repo.usage()['charged_calls']==1


def test_queue_bound_terminal_identity_and_frozen_facts(tmp_path):
    _,r=api()
    repo,_,b,_=ready(tmp_path/'runtime.sqlite',calls=10)
    jobs=[submit(repo,b,match=str(i)) for i in range(4)]
    assert submit(repo,b,match='0').id==jobs[0].id
    with pytest.raises(r.AzureBudgetExceeded): submit(repo,b,match='extra')
    claim=repo.claim('worker')
    original_checked=checked(claim)
    claim.fact_pack.score[0]=9
    with pytest.raises(r.AzureConflict): repo.finish(claim.lease,original_checked)
    assert repo.internal(claim.lease.job_id)[2].score==[1,0]


def test_additive_migration_preserves_legacy_rows(tmp_path):
    _,r=api()
    path=tmp_path/'runtime.sqlite'
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE chronicle_usage(id TEXT,reserved INTEGER,actual INTEGER)')
        conn.execute("INSERT INTO chronicle_usage VALUES('historical-failed',8,6)")
    r.AzureRepository(path,clock=lambda:1000.)
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT * FROM chronicle_usage').fetchall()==[('historical-failed',8,6)]
        conn.execute('UPDATE azure_chronicle_meta SET version=999')
        conn.commit()
    with pytest.raises(r.AzureConflict): r.AzureRepository(path,clock=lambda:1000.)


def test_copied_real_database_keeps_all_legacy_rows(tmp_path):
    _,r=api()
    original=Path(__file__).resolve().parents[2]/'.local/unified-player-acceptance/2026-10-19-phase5/runtime/runtime.sqlite'
    if not original.is_file(): pytest.skip('Private retained database absent; synthetic migration still mandatory')
    before=sha256(original.read_bytes()).hexdigest()
    dest=tmp_path/'copied.sqlite'
    with sqlite3.connect(original.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(dest) as dst: src.backup(dst)
    def legacy_rows():
        with sqlite3.connect(dest) as conn:
            names=[row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'azure_chronicle_%'")]
            return {name:conn.execute('SELECT * FROM "'+name.replace('"','""')+'"').fetchall() for name in names}
    snapshot=legacy_rows(); r.AzureRepository(dest,clock=lambda:1000.)
    assert legacy_rows()==snapshot
    assert sha256(original.read_bytes()).hexdigest()==before


def test_deadlines_are_persisted_without_an_active_worker(tmp_path):
    _,r=api()
    repo,clock,b,_=ready(tmp_path/'runtime.sqlite')
    job=submit(repo,b);clock.now=1901.
    assert repo.get('alice',job.id).error=='queue_expired'
    clock.now=1100.
    assert repo.get('alice',job.id).state=='unavailable'
    with pytest.raises(r.AzureConflict): submit(repo,b,match='new-after-clock-regression')


def test_failed_migration_rolls_back_namespace_without_touching_legacy(tmp_path,monkeypatch):
    _,r=api(); path=tmp_path/'runtime.sqlite'
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE legacy(value INTEGER)');conn.execute('INSERT INTO legacy VALUES(6)')
    def fail(*args):raise OSError('synthetic migration failure before anchor')
    with monkeypatch.context() as patch:
        patch.setattr(r.AzureRepository,'_seal',fail)
        with pytest.raises(OSError):r.AzureRepository(path,clock=lambda:1000.)
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT * FROM legacy').fetchall()==[(6,)]
        assert not conn.execute("SELECT name FROM sqlite_master WHERE name LIKE 'azure_chronicle_%'").fetchall()
    assert r.AzureRepository(path,clock=lambda:1000.).usage()['charged_calls']==0
