from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path

import pytest

from canary_fixtures import make_authorization,ancestor_bytes


def test_inherited_counts_four_new_calls_and_fifth_denied(tmp_path):
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused
    a,_=make_authorization(tmp_path);before=ancestor_bytes(tmp_path)
    b=CanaryBudget.create_once(a,root=tmp_path)
    assert (b.snapshot().cumulative_charged,b.snapshot().cumulative_reserved)==(3,4)
    b.begin()
    for _ in range(4):b.reserve_http(1);b.response()
    with pytest.raises(CanaryRefused):b.reserve_http(1)
    s=b.snapshot();assert (s.new_charged,s.new_reserved,s.cumulative_charged,s.cumulative_reserved)==(4,4,7,8)
    b.finish('succeeded')
    with pytest.raises(CanaryRefused):b.begin()
    with pytest.raises(CanaryRefused):CanaryBudget.create_once(a,root=tmp_path)
    assert ancestor_bytes(tmp_path)==before


@pytest.mark.parametrize('state',['fresh','running','failed','aborted','succeeded'])
def test_existing_or_terminal_admission_never_reissued(tmp_path,state):
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused
    a,_=make_authorization(tmp_path);b=CanaryBudget.create_once(a,root=tmp_path)
    if state!='fresh':
        b.begin()
        if state=='succeeded':b.reserve_http(1)
        if state!='running':b.finish(state)
    with pytest.raises(CanaryRefused):CanaryBudget.create_once(a,root=tmp_path)
    if state!='fresh':
        with pytest.raises(CanaryRefused):b.begin()
    if state in ('failed','aborted'):assert b.snapshot().new_reserved==4


@pytest.mark.parametrize('which',['approval','ancestor','source','code','anchor','partial','manifest'])
def test_missing_changed_or_partial_binding_fails_closed(tmp_path,which):
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused,canary_directory,BINDING_FILES
    a,_=make_authorization(tmp_path);d=canary_directory(tmp_path)
    if which=='approval':(d/'authorization.json').unlink()
    elif which=='ancestor':(tmp_path/'.local/ai-worker-acceptance/pc-worker-20261019-1/usage.sqlite').unlink()
    elif which=='source':(tmp_path/'.local/ai-worker-acceptance/pc-worker-20261019-1/timepitch-source.json').write_bytes(b'changed')
    elif which=='code':(tmp_path/BINDING_FILES[0]).write_bytes(b'changed')
    elif which=='partial':(d/'usage.sqlite').write_bytes(b'partial')
    elif which=='manifest':(d/'authorization.json').write_text('{}',encoding='utf-8')
    else:
        b=CanaryBudget.create_once(a,root=tmp_path);(d/'usage.anchor.json').unlink()
        with pytest.raises(CanaryRefused):b.snapshot()
        return
    with pytest.raises(CanaryRefused):CanaryBudget.create_once(a,root=tmp_path)


def test_phase3_approval_and_canonical_path_required_before_directory_creation(tmp_path):
    from timepitch.chronicles.canary_budget import CanaryAuthorization,CanaryBudget,CanaryRefused,canary_directory
    from timepitch.config import ROOT
    a,_=make_authorization(tmp_path)
    with pytest.raises(ValueError):CanaryAuthorization.model_validate({**a.model_dump(),'execution_phase':1})
    real=canary_directory(ROOT);before=real.exists()
    with pytest.raises(CanaryRefused):CanaryBudget.create_once(a,root=ROOT)
    assert real.exists()==before
    with pytest.raises(CanaryRefused):CanaryBudget(a,root=tmp_path,path=tmp_path/'another.sqlite')


def test_aborted_before_begin_has_no_new_reservation_and_no_refund_after_begin(tmp_path):
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused
    a,_=make_authorization(tmp_path);b=CanaryBudget.create_once(a,root=tmp_path)
    with pytest.raises(CanaryRefused):b.response()
    b.finish('aborted');s=b.snapshot();assert s.cumulative_reserved==4 and s.new_charged==0
    with pytest.raises(CanaryRefused):b.reserve_http(1)


def charge_one(args):
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryAuthorization,CanaryRefused
    root,raw=args
    try:
        b=CanaryBudget(CanaryAuthorization.model_validate_json(raw),root=Path(root));b.reserve_http(1);return 1
    except CanaryRefused:return 0


def test_two_processes_admit_exactly_four_from_twenty_one(tmp_path):
    from timepitch.chronicles.canary_budget import CanaryBudget
    a,_=make_authorization(tmp_path);b=CanaryBudget.create_once(a,root=tmp_path);b.begin()
    with ProcessPoolExecutor(2) as pool:
        assert sum(pool.map(charge_one,[(str(tmp_path),a.model_dump_json())]*21))==4
    assert b.snapshot().cumulative_charged==7


def test_deleting_child_journal_and_anchor_cannot_mint_another_admission(tmp_path):
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused,canary_directory
    a,_=make_authorization(tmp_path);b=CanaryBudget.create_once(a,root=tmp_path);b.begin();b.reserve_http(1)
    directory=canary_directory(tmp_path)
    (directory/'usage.sqlite').unlink();(directory/'usage.anchor.json').unlink()
    with pytest.raises(CanaryRefused):CanaryBudget.create_once(a,root=tmp_path)


def test_actual_sdk_version_drift_denies_before_child_creation(tmp_path,monkeypatch):
    import importlib.metadata
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused,canary_directory
    a,_=make_authorization(tmp_path)
    monkeypatch.setattr(importlib.metadata,'version',lambda _:'unapproved-version')
    with pytest.raises(CanaryRefused):CanaryBudget.create_once(a,root=tmp_path)
    assert not (canary_directory(tmp_path)/'usage.sqlite').exists()


def test_same_authorization_cannot_reissue_in_a_copied_checkout(tmp_path):
    import shutil
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused,canary_directory
    first=tmp_path/'first';second=tmp_path/'copied'
    a,_=make_authorization(first)
    shutil.copytree(first,second)  # Same approval/ancestor/source, copied before issuance.
    b=CanaryBudget.create_once(a,root=first);b.begin();b.reserve_http(1)
    with pytest.raises(CanaryRefused):CanaryBudget.create_once(a,root=second)
    assert not (canary_directory(second)/'usage.sqlite').exists()


def test_late_headers_are_observed_after_terminal_failure_without_new_sends(tmp_path):
    from timepitch.chronicles.canary_budget import CanaryBudget,CanaryRefused
    a,_=make_authorization(tmp_path);b=CanaryBudget.create_once(a,root=tmp_path)
    b.begin();b.reserve_http(1);b.finish('failed');b.response()
    assert b.snapshot().new_response_headers==1 and b.snapshot().state=='failed'
    with pytest.raises(CanaryRefused):b.reserve_http(1)
    with pytest.raises(CanaryRefused):b.response()
