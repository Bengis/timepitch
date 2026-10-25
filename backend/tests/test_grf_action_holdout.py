"""Sealed selection before heldout, with fake ready measurements and no native work."""
import pytest
from grf_candidate_fixtures import bind,save_ready_report
from test_grf_candidate_profiles import api
from test_grf_action_campaign import campaign_api
from timepitch.grf import physical_campaign_budget as budget


def test_deleted_selection_pair_does_not_reopen_tuning(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);report=save_ready_report(root,profile)
    selection=api('action_selection');selection.freeze_candidate(report,campaign,root)
    (root/'selection/freeze.json').unlink();(root.parent/'continuation-selection-registration.json').unlink()
    m=campaign_api(monkeypatch);calls=[];monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json');before=budget._read(root/'checkpoint.json')
    for split,candidate in [('calibration','c4'),('calibration','c5'),('heldout','selected')]:
        with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split=split,candidate_id=candidate)
    assert not calls and budget._read(root/'checkpoint.json')==before


@pytest.mark.parametrize('change',['reducer','native','payload','profile'])
def test_mutated_reducer_or_candidate_blocks_heldout(tmp_path,monkeypatch,change):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);report=save_ready_report(root,profile)
    api('action_selection').freeze_candidate(report,campaign,root)
    if change=='reducer':path=tmp_path/'backend/src/timepitch/grf/action_statistics.py'
    elif change=='native':path=profile.native_dir/'_gameplayfootball.pyd'
    elif change=='payload':path=root/'candidate-bindings/c4.json'
    else:path=tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/c4-profile.json'
    path.write_bytes(path.read_bytes()+b' ')
    m=campaign_api(monkeypatch);calls=[];monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    before=budget._read(root/'checkpoint.json');descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='heldout',candidate_id='selected')
    assert not calls and budget._read(root/'checkpoint.json')==before


def test_partial_heldout_cannot_qualify(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);report=save_ready_report(root,profile)
    selection=api('action_selection');freeze=selection.freeze_candidate(report,campaign,root)
    assert freeze['candidate_id']=='c4' and len(freeze['heldout_payload_hashes'])==24
    m=campaign_api(monkeypatch);calls=[]
    def fail(*a,**k):calls.append(1);raise RuntimeError('Synthetic stopped first heldout')
    monkeypatch.setattr(m,'CandidateProcess',fail);descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(RuntimeError):m.run_action_campaign(descriptor,root,split='heldout',candidate_id='selected')
    state=budget._read(root/'checkpoint.json');assert state['runs']['selected/heldout/01']['state']=='failed'
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='heldout',candidate_id='selected')
    assert len(calls)==1 and budget._read(root/'checkpoint.json')==state


def test_no_heldout_outcomes_or_reservation_before_selection(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);m=campaign_api(monkeypatch);calls=[]
    monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    before=budget._read(root/'checkpoint.json');descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='heldout',candidate_id='selected')
    assert not calls and budget._read(root/'checkpoint.json')==before
