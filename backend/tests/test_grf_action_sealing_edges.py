"""Additional causal-parent and tombstone regressions. Every file is synthetic."""
from concurrent.futures import ThreadPoolExecutor
import threading
import pytest
from grf_candidate_fixtures import bind,reserve,save_ready_report,bind_fake_c5
from test_grf_candidate_profiles import api
from test_grf_action_campaign import campaign_api
from timepitch.grf import physical_campaign_budget as budget
from timepitch.grf.physical_wire import canonical


def c5_setup(tmp_path,monkeypatch):
    m,root,campaign,c4=bind(tmp_path,monkeypatch);save_ready_report(root,c4,eligible=True)
    c5=bind_fake_c5(tmp_path,monkeypatch,m,root,c4);report=save_ready_report(root,c5)
    return m,root,campaign,c4,c5,report


def test_eligible_incremental_c5_selection_pins_both_calibration_reports(tmp_path,monkeypatch):
    _,root,campaign,_,c5,report=c5_setup(tmp_path,monkeypatch)
    selection=api('action_selection');value=selection.freeze_candidate(report,campaign,root)
    assert value['candidate_id']=='c5' and value['profile_identity']==c5.identity
    assert value['calibration_report_sha256']=={c:budget._sha(root/'reports'/f'{c}-calibration.json') for c in ('c4','c5')}
    assert selection.verify_frozen_selection(root)==value


def test_changed_c4_parent_report_blocks_selected_c5_before_reservation(tmp_path,monkeypatch):
    _,root,campaign,_,c5,report=c5_setup(tmp_path,monkeypatch);api('action_selection').freeze_candidate(report,campaign,root)
    path=root/'reports/c4-calibration.json';data=budget._read(path);data['changed_after_selection']=True;path.write_bytes(canonical(data))
    m=campaign_api(monkeypatch);calls=[]
    def forbidden(*a,**k):calls.append(1);raise AssertionError('Factory must not run')
    monkeypatch.setattr(m,'CandidateProcess',forbidden);before=budget._read(root/'checkpoint.json')
    descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='heldout',candidate_id='selected')
    assert not calls and budget._read(root/'checkpoint.json')==before


def test_lost_all_selection_files_cannot_reopen_calibration_after_heldout(tmp_path,monkeypatch):
    _,root,campaign,c4=bind(tmp_path,monkeypatch);report=save_ready_report(root,c4)
    api('action_selection').freeze_candidate(report,campaign,root);reserve(root,c4,'selected/heldout/01')
    for path in (root/'selection/freeze.json',root.parent/'continuation-selection-registration.json',root.parent/'continuation-selection-initialized.json'):path.unlink()
    m=campaign_api(monkeypatch);calls=[];monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    before=budget._read(root/'checkpoint.json');descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')
    assert not calls and budget._read(root/'checkpoint.json')==before


def test_consumed_candidate_cannot_rebind_after_all_binding_files_lost(tmp_path,monkeypatch):
    m,root,campaign,c4=bind(tmp_path,monkeypatch);reserve(root,c4)
    for path in (root/'candidate-bindings/c4.json',root.parent/'continuation-c4-registration.json',root.parent/'continuation-c4-initialized.json'):path.unlink()
    before=budget._read(root/'checkpoint.json')
    with pytest.raises(ValueError):m.bind_candidate_profile(tmp_path,'c4',root)
    assert budget._read(root/'checkpoint.json')==before


def test_two_selection_writers_choose_once_and_partial_witness_blocks(tmp_path,monkeypatch):
    _,root,campaign,c4=bind(tmp_path,monkeypatch);report=save_ready_report(root,c4);selection=api('action_selection');barrier=threading.Barrier(2)
    def writer():barrier.wait();return selection.freeze_candidate(report,campaign,root)
    with ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(writer);b=pool.submit(writer);assert a.result()==b.result()
    (root/'selection/freeze.json').unlink()
    with pytest.raises(ValueError):selection.freeze_candidate(report,campaign,root)
