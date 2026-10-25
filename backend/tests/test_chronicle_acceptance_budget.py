from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import pytest
from timepitch.chronicles.acceptance import AcceptanceBudget, AcceptanceRefused

HASH='a'*64


def budget(tmp_path):
    path=tmp_path/'usage.sqlite'
    AcceptanceBudget.initialize(path,HASH,grant_root=tmp_path)
    return AcceptanceBudget(path,HASH,grant_root=tmp_path)


def test_slots_conserve_twenty_and_public_remains_locked(tmp_path):
    b=budget(tmp_path)
    for slot in ('preflight','timepitch-en','timepitch-es','grf-en'):
        b.begin(slot)
        for _ in range(4): b.reserve_http(slot)
        with pytest.raises(AcceptanceRefused): b.reserve_http(slot)
        b.finish(slot,True)
    report=b.snapshot()
    assert sum(s['charged'] for s in report.values())==16
    assert report['grf-es-public']['state']=='locked' and report['grf-es-public']['charged']==0
    with pytest.raises(AcceptanceRefused): b.begin('grf-es-public')
    with pytest.raises(AcceptanceRefused): b.begin('preflight')


def test_failed_or_interrupted_slot_cannot_restart_or_reassign(tmp_path):
    b=budget(tmp_path); b.begin('preflight'); b.reserve_http('preflight')
    restart=AcceptanceBudget(b.path,HASH,grant_root=tmp_path)
    with pytest.raises(AcceptanceRefused): restart.begin('preflight')
    with pytest.raises(AcceptanceRefused): restart.begin('timepitch-en')
    b.finish('preflight',False)
    with pytest.raises(AcceptanceRefused): b.begin('timepitch-en')
    assert b.snapshot()['preflight']['charged']==1


def test_missing_partial_changed_manifest_and_duplicate_init_fail_closed(tmp_path):
    b=budget(tmp_path)
    with pytest.raises(AcceptanceRefused): AcceptanceBudget.initialize(b.path,HASH,grant_root=tmp_path)
    with pytest.raises(AcceptanceRefused): AcceptanceBudget(b.path,'c'*64,grant_root=tmp_path)
    b.path.unlink()
    with pytest.raises(AcceptanceRefused): AcceptanceBudget(b.path,HASH,grant_root=tmp_path)
    with pytest.raises(AcceptanceRefused): AcceptanceBudget.initialize(b.path,HASH,grant_root=tmp_path)
    b.path.write_bytes(b'partial')
    with pytest.raises(AcceptanceRefused): AcceptanceBudget(b.path,HASH,grant_root=tmp_path)


def process_charge(path):
    path=Path(path)
    try:
        AcceptanceBudget(path,HASH,grant_root=path.parent).reserve_http('preflight')
        return 1
    except AcceptanceRefused: return 0


def test_two_process_connections_cannot_overspend(tmp_path):
    b=budget(tmp_path); b.begin('preflight')
    with ProcessPoolExecutor(2) as pool: assert sum(pool.map(process_charge,[str(b.path)]*21))==4
    assert b.snapshot()['preflight']['charged']==4


def test_response_count_cannot_exceed_admitted_requests(tmp_path):
    b=budget(tmp_path); b.begin('preflight')
    with pytest.raises(AcceptanceRefused): b.response('preflight')
    b.reserve_http('preflight'); b.response('preflight')
    assert b.snapshot()['preflight']['responses']==1


def test_same_grant_cannot_be_reissued_under_another_filename(tmp_path):
    budget(tmp_path)
    with pytest.raises(AcceptanceRefused): AcceptanceBudget.initialize(tmp_path/'another.sqlite',HASH,grant_root=tmp_path)
    with pytest.raises(AcceptanceRefused): AcceptanceBudget.initialize(tmp_path/'elsewhere/usage.sqlite',HASH,grant_root=tmp_path)
