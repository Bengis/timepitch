"""Real on-disk reservation guard, without launching any native process."""
from concurrent.futures import ThreadPoolExecutor
import json
import pytest
from grf_action_native_helpers import reserve_action_case,finish_action_case,execute_reserved_case,CASE_LIMITS


def test_explicit_continuation_preserves_three_attempts_and_caps_eleven(tmp_path):
    from grf_action_native_helpers import extend_action_acceptance,CONTINUATION_LIMITS
    path=tmp_path/'checkpoint.json'
    for id in ('F1','F2','F3'):
        reserve_action_case(path,id,'old-input','old-binary',identity='original')
        finish_action_case(path,id,'complete',{'sha256':id})
    before=json.loads(path.read_text())['cases']
    extend_action_acceptance(path,'original','revision2',authorization='user-hazlo-tp033-continuation')
    assert json.loads(path.read_text())['cases']==before
    for id in CONTINUATION_LIMITS:reserve_action_case(path,id,'new-input','new-binary',identity='revision2')
    result=json.loads(path.read_text())
    assert len(result['cases'])==11 and sum(c['maximum_ms'] for c in result['cases'].values())==1620000
    with pytest.raises(ValueError):reserve_action_case(path,'F3-r3','new-input','new-binary',identity='revision2')
    with pytest.raises(ValueError):extend_action_acceptance(path,'original','revision3',authorization='user-hazlo-tp033-continuation')


def test_extension_requires_the_original_ledger_and_does_not_relaunch_old_fixtures(tmp_path):
    from grf_action_native_helpers import extend_action_acceptance
    path=tmp_path/'checkpoint.json'
    with pytest.raises(ValueError):extend_action_acceptance(path,'missing','revision2',authorization='user-hazlo-tp033-continuation')
    for id in ('F1','F2','F3'):
        reserve_action_case(path,id,'old','old',identity='original');finish_action_case(path,id,'complete',{})
    with pytest.raises(ValueError):extend_action_acceptance(path,'wrong','revision2',authorization='user-hazlo-tp033-continuation')
    with pytest.raises(ValueError):extend_action_acceptance(path,'original','revision2',authorization='')
    extend_action_acceptance(path,'original','revision2',authorization='user-hazlo-tp033-continuation')
    with pytest.raises(ValueError):reserve_action_case(path,'F4','old','old',identity='original')


def test_eight_exact_ids_are_reserved_once_and_unknown_ninth_is_rejected(tmp_path):
    path=tmp_path/'checkpoint.json'
    for id in CASE_LIMITS:assert reserve_action_case(path,id,'input','binary') is None
    assert len(json.loads(path.read_text())['cases'])==8
    with pytest.raises(ValueError):reserve_action_case(path,'ninth','input','binary')
    with pytest.raises(ValueError):reserve_action_case(path,'F1','input','binary')


def test_complete_reuse_requires_identical_input_binary_and_evidence(tmp_path):
    path=tmp_path/'checkpoint.json'
    reserve_action_case(path,'F1','input','binary')
    finish_action_case(path,'F1','complete',{'sha256':'evidence'})
    assert reserve_action_case(path,'F1','input','binary')=={'sha256':'evidence'}
    for values in [('other','binary'),('input','other')]:
        with pytest.raises(ValueError):reserve_action_case(path,'F1',*values)


def test_failed_or_interrupted_attempt_never_resets_its_budget(tmp_path):
    path=tmp_path/'checkpoint.json'
    reserve_action_case(path,'F1','input','binary')
    finish_action_case(path,'F1','failed',{'reason':'interrupted'})
    with pytest.raises(ValueError):reserve_action_case(path,'F1','input','binary')
    reserve_action_case(path,'F2','input','binary')
    with pytest.raises(ValueError):reserve_action_case(path,'F2','input','binary')


def test_two_writers_cannot_reserve_the_same_child(tmp_path):
    path=tmp_path/'checkpoint.json'
    def reserve(_):
        try:reserve_action_case(path,'F1','input','binary');return 'reserved'
        except ValueError:return 'rejected'
    with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(reserve,range(2)))==['rejected','reserved']
    assert len(json.loads(path.read_text())['cases'])==1


def test_different_acceptance_identity_cannot_reuse_completed_results(tmp_path):
    path=tmp_path/'checkpoint.json'
    reserve_action_case(path,'F1','input','binary',identity='setup-a')
    finish_action_case(path,'F1','complete',{})
    with pytest.raises(ValueError):reserve_action_case(path,'F2','input','binary',identity='setup-b')


def test_rejection_happens_before_child_and_failure_consumes_the_attempt(tmp_path):
    checkpoint=tmp_path/'checkpoint.json';calibration=tmp_path/'calibration.json';calibration.write_bytes(b'original')
    launches=[]
    def child():launches.append(1);raise RuntimeError('Interrupted child')
    with pytest.raises(RuntimeError):execute_reserved_case(checkpoint,'F1','input','binary',child)
    with pytest.raises(ValueError):execute_reserved_case(checkpoint,'F1','input','binary',child)
    assert launches==[1] and calibration.read_bytes()==b'original'
