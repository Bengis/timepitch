from decimal import Decimal
import json
import pytest
from azure_chronicle_fixtures import api, binding, ready, prepared, submit, receipt, terminal


def test_decimal_rounding_reserves_upper_price():
    m, _ = api()
    from timepitch.chronicles.azure.budget import maximum_liability
    tariff = m.Tariff(currency='EUR', version='synthetic', input_per_million=Decimal('1.234'),
        output_per_million=Decimal('2.345'), quantum=Decimal('0.000001'))
    assert maximum_liability(tariff,128,2048) == Decimal('0.004961')
    with pytest.raises(ValueError): maximum_liability(tariff,-1,2048)


def test_zero_grant_never_queues(tmp_path):
    _, r = api()
    repo = r.AzureRepository(tmp_path/'runtime.sqlite',clock=lambda:1000.)
    with pytest.raises(r.AzureBudgetExceeded): submit(repo,binding())
    assert repo.usage()['charged_calls'] == 0


def test_changed_cookie_binding_or_id_does_not_refund(tmp_path):
    m, r = api()
    repo, clock, b, grant = ready(tmp_path/'runtime.sqlite')
    first = submit(repo,b)
    claim = repo.claim('worker')
    repo.authorize_send(claim.lease,prepared(claim))
    repo.fail(claim.lease,'uncertain_send',uncertain=True)
    reopened = r.AzureRepository(repo.path,clock=clock)
    assert submit(reopened,b).id == first.id
    for owner, match, candidate in [('new-cookie','two',b),('alice','two',b.model_copy(update={'version':'2'}))]:
        with pytest.raises(r.AzureBudgetExceeded): submit(reopened,candidate,owner,match)
    assert reopened.usage()['charged_calls'] == 1
    with pytest.raises(r.AzureConflict): reopened.install_grant(grant.model_copy(update={'call_limit':2}))


def test_uncertain_send_retains_liability(tmp_path):
    _, r = api()
    repo, clock, b, _ = ready(tmp_path/'runtime.sqlite')
    submit(repo,b)
    claim = repo.claim('worker')
    repo.authorize_send(claim.lease,prepared(claim))
    before = repo.usage()
    repo.fail(claim.lease,'uncertain_send',uncertain=True)
    reopened = r.AzureRepository(repo.path,clock=clock)
    assert reopened.usage()['reserved_money'] == before['reserved_money']
    assert reopened.usage()['actual_money'] is None
    with pytest.raises(r.AzureConflict): reopened.authorize_send(claim.lease,prepared(claim))
    assert reopened.claim('worker') is None


def test_dispatch_bound_and_identity_are_server_owned(tmp_path):
    _, r = api()
    repo, _, b, _ = ready(tmp_path/'runtime.sqlite')
    submit(repo,b); claim = repo.claim('worker'); p = prepared(claim)
    for changes in ({'input_upper_tokens':1},{'binding_hash':'b'*64},{'fact_hash':'b'*64},{'request_hash':'b'*64}):
        with pytest.raises((r.AzureConflict,ValueError)):
            repo.authorize_send(claim.lease,p.model_copy(update=changes))
    assert repo.usage()['charged_calls'] == 0


def test_ancestor_import_is_verified_and_not_a_reset(tmp_path):
    m, r = api()
    repo = r.AzureRepository(tmp_path/'runtime.sqlite',clock=lambda:1000.)
    terminal = m.AzureTerminalReceipt(parent_digest='a'*64, grant_digest='b'*64, binding_hash='c'*64,
        source_hash='d'*64, request_hash='e'*64, attempt_id='synthetic-prior-attempt', outcome='unavailable',
        charged_dispatches=1, reserved_input_tokens=128, reserved_output_tokens=2048, currency='EUR',
        reserved_money=Decimal('.01'), actual_input_tokens=None, actual_output_tokens=None,
        actual_reasoning_tokens=None, actual_money=None, elapsed_ms=10, validation='not_checked',human_review='pending')
    with pytest.raises(r.AzureConflict): repo.verify_ancestor(terminal)
    # Only the operator places this pretrusted private anchor, never an HTTP payload.
    digest = m.model_digest(terminal)
    repo.ancestor_dir.mkdir(exist_ok=True)
    anchor = repo.ancestor_dir/(digest+'.json')
    anchor.write_text(terminal.model_dump_json(),encoding='utf-8')
    verified = repo.verify_ancestor(terminal)
    repo.import_ancestor(verified); repo.import_ancestor(verified)
    assert repo.usage()['charged_calls'] == 1
    assert repo.usage()['reserved_money'] == Decimal('.01')
    with pytest.raises(r.AzureConflict): repo.import_ancestor(verified.model_copy(update={'charged_dispatches':0}))
    anchor.unlink()
    with pytest.raises(r.AzureConflict): repo.usage()


@pytest.mark.parametrize('damage',['anchor_deleted','db_restored'])
def test_missing_or_rolled_back_state_cannot_reissue_budget(tmp_path,damage):
    _, r = api()
    repo, clock, b, _ = ready(tmp_path/'runtime.sqlite')
    import sqlite3
    backup = tmp_path/'before.sqlite'
    with sqlite3.connect(repo.path) as src, sqlite3.connect(backup) as dst: src.backup(dst)
    submit(repo,b); claim = repo.claim('worker'); repo.authorize_send(claim.lease,prepared(claim))
    if damage == 'anchor_deleted': repo.anchor_path.unlink()
    else:
        with sqlite3.connect(backup) as src, sqlite3.connect(repo.path) as dst: src.backup(dst)
    with pytest.raises(r.AzureConflict): r.AzureRepository(repo.path,clock=clock)


def test_usage_above_bound_is_recorded_and_halts_admission(tmp_path):
    _, r = api()
    repo, _, b, _ = ready(tmp_path/'runtime.sqlite',calls=2)
    job=submit(repo,b); claim=repo.claim('worker'); permit=repo.authorize_send(claim.lease,prepared(claim))
    bad=receipt(claim,permit).model_copy(update={'input_tokens':129})
    repo.record_receipt(claim.lease,bad)
    assert repo.usage()['actual_input_tokens'] == 129
    with pytest.raises(r.AzureConflict): submit(repo,b,match='another')


def test_new_grant_id_does_not_reset_cumulative_charges(tmp_path):
    _,r=api()
    repo,_,b,grant=ready(tmp_path/'runtime.sqlite')
    submit(repo,b);claim=repo.claim('worker');repo.authorize_send(claim.lease,prepared(claim))
    repo.fail(claim.lease,'provider_error')
    newer=grant.model_copy(update={'id':'new-synthetic-id','parent_digest':repo.lineage_digest()})
    repo.install_grant(newer)
    with pytest.raises(r.AzureBudgetExceeded):submit(repo,b,owner='new-owner',match='new-id')


def test_terminal_receipt_cannot_deny_a_reserved_dispatch():
    m,_=api()
    with pytest.raises(ValueError):
        m.AzureTerminalReceipt(parent_digest='a'*64,grant_digest='b'*64,binding_hash='c'*64,source_hash='d'*64,
            request_hash='e'*64,attempt_id='synthetic',outcome='unavailable',charged_dispatches=0,
            reserved_input_tokens=128,reserved_output_tokens=2048,currency='EUR',reserved_money=Decimal('.01'),
            actual_input_tokens=None,actual_output_tokens=None,actual_reasoning_tokens=None,actual_money=None,
            elapsed_ms=1,validation='not_checked',human_review='pending')


def test_imported_currency_cannot_mix_with_an_active_grant(tmp_path):
    m,r=api()
    repo,_,_,_=ready(tmp_path/'runtime.sqlite')
    prior=terminal(currency='USD');digest=m.model_digest(prior)
    (repo.ancestor_dir/(digest+'.json')).write_text(prior.model_dump_json(),encoding='utf-8')
    with pytest.raises(r.AzureConflict):repo.import_ancestor(repo.verify_ancestor(prior))


def test_known_ancestor_cost_above_reservation_is_not_erased(tmp_path):
    m,r=api()
    repo=r.AzureRepository(tmp_path/'runtime.sqlite',clock=lambda:1000.)
    prior=terminal(actual_money=Decimal('.02'));digest=m.model_digest(prior)
    (repo.ancestor_dir/(digest+'.json')).write_text(prior.model_dump_json(),encoding='utf-8')
    repo.import_ancestor(repo.verify_ancestor(prior))
    b=binding()
    grant=m.AzureGrant(id='synthetic-next',mode='public',state_id=repo.state_id,parent_digest=repo.lineage_digest(),
        binding_hash=m.binding_hash(b),expires_at=2000.,call_limit=2,input_limit=256,output_limit=4096,
        money_limit=Decimal('.015'),per_owner_calls=2,tariff=m.Tariff(currency='EUR',version='synthetic',
        input_per_million=Decimal('1.234'),output_per_million=Decimal('2.345'),quantum=Decimal('.000001')))
    repo.install_grant(grant)
    with pytest.raises(r.AzureBudgetExceeded):submit(repo,b)


@pytest.mark.parametrize('field,value',[('actual_input_tokens',1000),('actual_output_tokens',5000)])
def test_known_ancestor_tokens_above_reservation_are_not_erased(tmp_path,field,value):
    m,r=api(); path=tmp_path/'runtime.sqlite'
    repo=r.AzureRepository(path,clock=lambda:1000.)
    prior=terminal(**{field:value});digest=m.model_digest(prior)
    (repo.ancestor_dir/(digest+'.json')).write_text(prior.model_dump_json(),encoding='utf-8')
    repo.import_ancestor(repo.verify_ancestor(prior))
    repo,_,b,_=ready(path,calls=2)
    with pytest.raises(r.AzureBudgetExceeded):submit(repo,b)


def test_operator_grant_requires_explicit_public_or_private_mode(tmp_path):
    m,_=api();_,_,_,grant=ready(tmp_path/'runtime.sqlite')
    with pytest.raises(ValueError):m.AzureGrant.model_validate(grant.model_dump(exclude={'mode'}))
