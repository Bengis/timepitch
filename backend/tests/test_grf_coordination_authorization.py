"""Linked authorization and legacy exclusion using real files/locks; no native code."""
import importlib
import importlib.util
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
import threading

import pytest
from test_grf_physical_campaign_budget import setup_campaign,spec,H,N
from grf_action_fixtures import action_trace
from timepitch.grf.physical_wire import canonical,digest


def api():
    name='timepitch.grf.coordination_authorization'
    assert importlib.util.find_spec(name),'Missing linked coordination authorization'
    return importlib.import_module(name)


def setup(tmp_path,monkeypatch):
    a=api()
    from timepitch.grf import physical_campaign_budget as old,coordination_budget as b
    from timepitch.grf import defensive_probe_budget as probe
    monkeypatch.setattr(old,'PROJECT_ROOT',tmp_path);monkeypatch.setattr(b,'PROJECT_ROOT',tmp_path)
    parent,root,campaign=setup_campaign(tmp_path);old.initialize_continuation(parent,campaign,root,approved=True)
    state=old._load(root,root.parent/'continuation-registration.json')
    for id in list(old.TECHNICAL)+[f'c4/calibration/{i:02}' for i in range(1,9)]:
        state['runs'][id]=dict(state='ready',spec=dict(input_hash=H,native_sha256=N))
    state['candidate_bindings']['c4']=N;old._save(root,root.parent/'continuation-registration.json',state)
    probe_path=root.with_name('defensive-probe')/'checkpoint.json';probe_path.parent.mkdir();probe_path.write_bytes(b'{"consumed":"failed"}')
    archive=tmp_path/'archive.bin';archive.write_bytes(b'immutable historical evidence')
    def verify(project):
        if archive.read_bytes()!=b'immutable historical evidence':raise ValueError('Historical archive changed')
        return dict(historical_source_files=109,parent_files=10,protected_artifacts=1554,binding_sha256='e'*64)
    monkeypatch.setattr(a,'verify_source_archive',verify)
    monkeypatch.setattr(probe,'_extension_usage_locked',lambda r,s,**kw:dict(used=len(s['prior_runs'])+len(s['runs'])+1,maximum=71,candidates=len(s['candidate_bindings'])))
    request=action_trace()[0].input
    descriptor=tmp_path/a.DESCRIPTOR;descriptor.parent.mkdir(parents=True,exist_ok=True);descriptor.write_bytes(canonical({'source':'synthetic'}))
    profile=SimpleNamespace(project=tmp_path,identity=digest({'source':'synthetic'}),native_sha256='b'*64)
    monkeypatch.setattr(a,'load_coordination_profile',lambda project:profile)
    approval=tmp_path/a.APPROVAL;approval.parent.mkdir(parents=True,exist_ok=True)
    approval.write_bytes(canonical(dict(schema_version='grf-coordination-user-approval-1',user_statement=a.STATEMENT,
        maximum=72,parent_used=37,candidate_limit=5,substitute_ids=True,execute_phase=5)))
    newroot=root.with_name('coordination')
    return SimpleNamespace(a=a,b=b,old=old,root=newroot,prior=root,parent=parent,campaign=campaign,request=request,profile=profile,archive=archive)


def register(s):
    return s.a.register_coordination_authorization(s.root,s.a.APPROVAL,s.a.parent_snapshot(s.profile.project),max_total=72)


def test_original37_never_reset(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);before=(s.prior/'checkpoint.json').read_bytes()
    register(s);store=s.b.CoordinationLedger(s.root,s.profile)
    assert store.usage()==dict(used=37,maximum=72,candidates=4)
    store.reserve('K-observe-42',s.request)
    assert store.usage()==dict(used=38,maximum=72,candidates=5)
    from timepitch.grf.defensive_probe_budget import cumulative_usage
    assert cumulative_usage(s.prior)['used']==38
    assert (s.prior/'checkpoint.json').read_bytes()==before


def test_old_and_new_schedule_cannot_both_spend(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);register(s)
    with pytest.raises(ValueError,match='supersed'):s.old.reserve_run(s.prior,spec(s.old,'c5/calibration/01'))
    with pytest.raises(ValueError,match='supersed'):s.old.reserve_run(s.prior,spec(s.old,'selected/heldout/01'))
    assert s.b.CoordinationLedger(s.root,s.profile).reserve('K-observe-42',s.request).reused is False


def test_two_writers_one_reservation(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);register(s);barrier=threading.Barrier(2)
    def writer(_):
        barrier.wait()
        try:s.b.CoordinationLedger(s.root,s.profile).reserve('K-observe-42',s.request);return 'reserved'
        except ValueError:return 'blocked'
    with ThreadPoolExecutor(2) as pool:assert sorted(pool.map(writer,range(2)))==['blocked','reserved']
    assert s.b.CoordinationLedger(s.root,s.profile).usage()['used']==38


@pytest.mark.parametrize('damage',['markers','root_and_markers','grant','journal','parent','approval','anchor','supplement'])
def test_missing_deleted_both_markers_stays_blocked(tmp_path,monkeypatch,damage):
    s=setup(tmp_path,monkeypatch);register(s)
    if damage in ('markers','root_and_markers'):
        for n in ('coordination-registration.json','coordination-initialized.json'):(s.root.parent/n).unlink()
    if damage=='root_and_markers':
        # Preserve the consumed root in this synthetic fixture; simulate all mutable paths missing.
        s.root.rename(s.root.with_name('removed-root'))
    if damage=='grant':(s.root/'authorization.json').unlink()
    if damage=='journal':(s.root/'events.jsonl').unlink()
    if damage=='parent':(s.prior/'checkpoint.json').write_bytes(b'{}')
    if damage=='approval':(tmp_path/s.a.APPROVAL).unlink()
    if damage=='anchor':(tmp_path/s.a.ANCHOR).unlink()
    if damage=='supplement':(s.root.parent/'coordination-supersession.json').unlink()
    with pytest.raises(ValueError):s.b.CoordinationLedger(s.root,s.profile)
    with pytest.raises(ValueError):register(s)
    with pytest.raises(ValueError):s.old.reserve_run(s.prior,spec(s.old,'c5/calibration/01'))


def test_invalid_parent_archive_blocks(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);s.archive.write_bytes(b'changed')
    with pytest.raises(ValueError):register(s)
    assert not s.root.exists()


def test_no_slot_renewal_after_failed_observation(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);register(s);store=s.b.CoordinationLedger(s.root,s.profile)
    store.reserve('K-observe-42',s.request);e=s.root/'evidence/K-observe-42';e.mkdir(parents=True);(e/'failure.json').write_bytes(b'{}')
    store.finish('K-observe-42',state='failed')
    assert store.usage()==dict(used=38,maximum=72,candidates=5)
    with pytest.raises(ValueError):store.reserve('K-observe-42',s.request)
    register(s)
    assert s.b.CoordinationLedger(s.root,s.profile).usage()['used']==38


@pytest.mark.parametrize('change',['maximum','parent_hashes','statement','candidate_cap'])
def test_wrong_approval_or_parent_cannot_register(tmp_path,monkeypatch,change):
    s=setup(tmp_path,monkeypatch);parent=s.a.parent_snapshot(tmp_path);maximum=72
    if change=='maximum':maximum=73
    if change=='parent_hashes':parent['used']=0
    if change in ('statement','candidate_cap'):
        p=tmp_path/s.a.APPROVAL;v=json.loads(p.read_bytes());v['user_statement' if change=='statement' else 'candidate_limit']='unapproved';p.write_bytes(canonical(v))
    with pytest.raises(ValueError):s.a.register_coordination_authorization(s.root,s.a.APPROVAL,parent,max_total=maximum)
    assert not s.root.exists()


def test_parent_drift_after_grant_blocks_new_reservation(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);register(s);store=s.b.CoordinationLedger(s.root,s.profile)
    s.archive.write_bytes(b'changed')
    with pytest.raises(ValueError):store.reserve('K-observe-42',s.request)
    assert json.loads((s.root/'checkpoint.json').read_bytes())['runs']=={}


def test_old_initializers_and_probe_cannot_spend_after_supersession(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);register(s)
    from timepitch.grf import defensive_probe_budget as probe
    with pytest.raises(ValueError,match='supersed'):probe.initialize_defensive_probe({},s.prior.with_name('defensive-probe'),approved=True)
    with pytest.raises(ValueError,match='supersed'):probe.reserve_defensive_probe(s.prior.with_name('defensive-probe'),input_hash=H,native_sha256=N)
    (s.prior/'checkpoint.json').unlink();(s.prior.parent/'continuation-registration.json').unlink()
    with pytest.raises(ValueError,match='supersed'):s.old.initialize_continuation(s.parent,s.campaign,s.prior,approved=True)


def test_partial_registration_cannot_issue_a_second_grant(tmp_path,monkeypatch):
    s=setup(tmp_path,monkeypatch);real=s.a._exclusive
    def interrupted(path,value):
        if Path(path)==s.root/'authorization.json':raise OSError('Synthetic interrupted write')
        return real(path,value)
    monkeypatch.setattr(s.a,'_exclusive',interrupted)
    with pytest.raises(OSError):register(s)
    monkeypatch.setattr(s.a,'_exclusive',real)
    with pytest.raises(ValueError):register(s)
    with pytest.raises(ValueError):s.old.reserve_run(s.prior,spec(s.old,'c5/calibration/01'))
