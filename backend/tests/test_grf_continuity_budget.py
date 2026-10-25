"""Authorization and durable accounting use synthetic files only."""
import copy
import importlib
import importlib.util
import json

import pytest
from test_grf_continuity_profile import frozen


def api():
    name = 'timepitch.grf.continuity_budget'
    assert importlib.util.find_spec(name), 'Missing stopped continuity accounting'
    return importlib.import_module(name)


def put(path, value):
    from timepitch.grf.physical_wire import canonical
    path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(canonical(value))


@pytest.fixture
def permitted(frozen, monkeypatch):
    """Entirely synthetic future approval, never the canonical real campaign."""
    b = api(); p = frozen.project; root = p/b.RUN_ROOT
    from timepitch.grf.continuity_profile import plain
    monkeypatch.setattr(b, 'parent_snapshot', lambda project: plain(frozen.document['parent']))
    approval = dict(schema_version='m1-user-approval-1', maximum=76, candidate_limit=6, parent_used=41,
                    run_ids=list(b.IDS), execute_phase=5, explicit_native=True, user_statement='Synthetic test approval in tmp_path')
    put(root/'approval.json', approval)
    design = p/'docs/superpowers/specs/synthetic-clock.md'; design.parent.mkdir(parents=True); design.write_text('synthetic clock design')
    clock = dict(schema_version='m1-clock-acceptance-1', approved=True, design='docs/superpowers/specs/synthetic-clock.md',
                 design_sha256=b.sha(design), source_sha256=plain(frozen.document['clock_gate']['reference_source_sha256']),
                 saved_c4_gameplay_unchanged=True, common_reference_candidate=True,
                 boundary_tests={'long_open_play': True, 'pending_penalty': True, 'pending_restart': True}, approval_ref='synthetic-only')
    put(root/'clock.json', clock)
    grant = dict(schema_version='m1-linked-authorization-1', profile_identity=frozen.identity,
        maximum=76, parent_used=41, parent_candidates=5, candidate_limit=6, run_ids=list(b.IDS),
        approval_sha256=b.sha(root/'approval.json'), clock_sha256=b.sha(root/'clock.json'),
        parent_snapshot=plain(frozen.document['parent']))
    for name in ('authorization.json', 'supplement.json', 'authorization-witness.json'): put(root/name, grant)
    put(p/b.ANCHOR, grant)
    state = dict(schema_version='m1-ledger-1', grant_sha256=b.digest(grant), runs={}, terminal_failure=None,
                 observe_proof=None, calibration_report=None, selection=None, heldout_opened=False)
    event = dict(seq=0, previous=b.digest_bytes(b''), checkpoint=b.digest(state), event={'type': 'linked_authorization', 'parent_used': 41})
    journal = b.canonical(event)+b'\n'; (root/'events.jsonl').write_bytes(journal); put(root/'checkpoint.json', state)
    receipt = dict(grant_sha256=b.digest(grant), checkpoint_sha256=b.digest(state), events_sha256=b.digest_bytes(journal))
    for name in ('registration.json', 'initialized.json'): put(root/name, receipt)
    return frozen


def test_absent_authorization_never_initializes_budget(frozen, monkeypatch):
    b = api(); monkeypatch.setattr(b, 'parent_snapshot', lambda project: dict(frozen.document['parent']))
    with pytest.raises(ValueError): b.validate_continuity_authorization(frozen.project, frozen)
    assert not (frozen.project/b.RUN_ROOT).exists()


@pytest.mark.parametrize('missing', ['authorization.json', 'supplement.json', 'authorization-witness.json', 'approval.json', 'clock.json', 'checkpoint.json', 'events.jsonl', 'registration.json', 'initialized.json', 'anchor'])
def test_deleted_grants_and_witnesses_never_renew_attempts(permitted, missing):
    b = api(); p = permitted.project
    assert b.validate_continuity_authorization(p, permitted).maximum == 76
    target = p/b.ANCHOR if missing == 'anchor' else p/b.RUN_ROOT/missing
    target.unlink()
    with pytest.raises(ValueError): b.ContinuityLedger(p, permitted)
    assert not target.exists()


@pytest.mark.parametrize('change', ['ceiling72', 'slot5', 'clock_changed', 'missing_boundary', 'phase4', 'legacy_id'])
def test_unapproved_limits_clock_or_legacy_ids_are_blocked(permitted, change):
    b = api(); p = permitted.project; root = p/b.RUN_ROOT
    if change in ('clock_changed', 'missing_boundary'):
        path = root/'clock.json'; value = json.loads(path.read_bytes())
        if change == 'clock_changed': value['saved_c4_gameplay_unchanged'] = False
        else: value['boundary_tests']['pending_penalty'] = False
    elif change == 'phase4':
        path = root/'approval.json'; value = json.loads(path.read_bytes()); value['execute_phase'] = 4
    else:
        path = root/'authorization.json'; value = json.loads(path.read_bytes())
        if change == 'ceiling72': value['maximum'] = 72
        elif change == 'slot5': value['candidate_limit'] = 5
        else: value['run_ids'][0] = 'K-observe-42'
    put(path, value)
    with pytest.raises(ValueError): b.validate_continuity_authorization(p, permitted)


def test_first_reservation_claims_sixth_slot_and_failed_id_is_consumed(permitted):
    b = api(); store = b.ContinuityLedger(permitted.project, permitted)
    assert store.usage() == dict(used=41, maximum=76, candidates=5, candidate_limit=6)
    with store.locked():
        store.reserve('M-observe-42', permitted.payload('calibration/01'))
        store.finish('M-observe-42', {'complete': False}, failed=True)
    assert store.usage()['used'] == 42 and store.usage()['candidates'] == 6
    with store.locked(), pytest.raises(ValueError): store.reserve('M-observe-42', permitted.payload('calibration/01'))
    with store.locked(), pytest.raises(ValueError): store.reserve('k1/calibration/04', permitted.payload('calibration/04'))


def test_ready_evidence_cannot_be_rebound_to_different_input(permitted):
    b = api(); s = b.ContinuityLedger(permitted.project, permitted); payload = permitted.payload('calibration/01')
    with s.locked():
        s.reserve('M-observe-42', payload); s.finish('M-observe-42', {'complete': True, 'equivalent': True, 'exact_transactions': 1})
    changed = copy.deepcopy(payload); changed['players'][0]['id'] = 99
    with s.locked(), pytest.raises(ValueError): s.reserve('M-observe-42', changed)


def test_global_lock_serializes_duplicate_writers(permitted):
    from concurrent.futures import ThreadPoolExecutor
    import threading
    b = api(); s = b.ContinuityLedger(permitted.project, permitted); barrier = threading.Barrier(2)
    def reserve(_):
        barrier.wait()
        try:
            with s.locked(): s.reserve('M-observe-42', permitted.payload('calibration/01'))
            return 'reserved'
        except ValueError: return 'blocked'
    with ThreadPoolExecutor(max_workers=2) as pool: result = list(pool.map(reserve, range(2)))
    assert sorted(result) == ['blocked', 'reserved'] and s.usage()['used'] == 42
    with pytest.raises(ValueError): s.reserve('M-observe-42', permitted.payload('calibration/01'))


def test_observation_proof_must_equal_retained_complete_result(permitted):
    b = api(); s = b.ContinuityLedger(permitted.project, permitted)
    with s.locked():
        s.reserve('M-observe-42', permitted.payload('calibration/01'))
        s.finish('M-observe-42', {'complete': True, 'equivalent': False, 'exact_transactions': 1})
        with pytest.raises(ValueError): s.accept_observation({'complete': True, 'equivalent': True, 'exact_transactions': 1})


def test_evidence_loss_or_journal_edit_never_refunds(permitted):
    b = api(); s = b.ContinuityLedger(permitted.project, permitted)
    with s.locked(): s.reserve('M-observe-42', permitted.payload('calibration/01'))
    path = permitted.project/b.RUN_ROOT/'events.jsonl'; path.write_bytes(path.read_bytes()+b'{}\n')
    with pytest.raises(ValueError): s.usage()


def test_clock_test_results_must_be_boolean_not_numeric(permitted):
    b = api(); root = permitted.project/b.RUN_ROOT
    clock = json.loads((root/'clock.json').read_bytes()); clock['boundary_tests']['pending_penalty'] = 1
    put(root/'clock.json', clock)
    grant = json.loads((root/'authorization.json').read_bytes()); grant['clock_sha256'] = b.sha(root/'clock.json')
    for path in [root/'authorization.json', root/'supplement.json', root/'authorization-witness.json', permitted.project/b.ANCHOR]: put(path, grant)
    with pytest.raises(ValueError): b.validate_continuity_authorization(permitted.project, permitted)
