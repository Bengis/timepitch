"""Durable synthetic scheduling. No native factory is used."""
import copy
import importlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest
from grf_action_fixtures import action_trace
from test_grf_action_gates import rows
from timepitch.grf.physical_wire import canonical,digest


def api(name='coordination_campaign'):
    full='timepitch.grf.'+name
    assert importlib.util.find_spec(full),'Missing '+name
    return importlib.import_module(full)


def good_counters():
    from timepitch.grf.coordination_wire import COUNTERS
    c=dict.fromkeys(COUNTERS,0)
    c.update(assignments=3,holds=1,handovers=1,handover_rejections=1,cover_requested=1,cover_exposed=1,movement_requests=1,selected_commands=1)
    return c


@pytest.fixture
def synthetic(tmp_path,monkeypatch):
    m=api();b=api('coordination_budget');from timepitch.grf.coordination_profile import CoordinationProfile,RUN_ROOT
    from timepitch.grf.candidate_profiles import freeze,FrozenSettings
    request=action_trace()[0].input;payload=request.model_dump(mode='json')
    payloads={f'{s}/{i:02}':copy.deepcopy(payload) for s,n in (('calibration',8),('heldout',24)) for i in range(1,n+1)}
    profile=CoordinationProfile(tmp_path,'a'*64,'b'*64,'c'*64,tmp_path/'native',tmp_path/'python.exe',
        freeze(payloads),FrozenSettings.model_validate(payload['settings']),freeze({}))
    root=tmp_path/RUN_ROOT;root.mkdir(parents=True)
    baseline=tmp_path/'.local/grf-physical-work/continuation/reports/c4-calibration.json';baseline.parent.mkdir(parents=True)
    baseline.write_bytes(canonical(dict(rows=rows(candidate='c4'))))
    grant=dict(schema_version='grf-coordination-authorization-1',profile_identity=profile.identity,maximum=72,parent_used=37,
        parent_candidates=4,candidate_limit=5,approval_ref='synthetic-fixture-not-an-approval')
    (root/'authorization.json').write_bytes(canonical(grant));(root/'events.jsonl').write_bytes(b'')
    state=dict(schema_version='grf-coordination-ledger-1',grant_sha256=digest(grant),runs={},observe_proof=None,
        selection_sealed=False,heldout_opened=False,terminal_failure=None)
    (root/'checkpoint.json').write_bytes(canonical(state))
    receipt=dict(root=str(root),grant_sha256=digest(grant),checkpoint_sha256=digest(state),events_sha256=b.sha(root/'events.jsonl'))
    for name in ('coordination-registration.json','coordination-initialized.json'):(root.parent/name).write_bytes(canonical(receipt))
    monkeypatch.setattr(b,'_authorized_context',lambda r,p:(Path(r),copy.deepcopy(grant)))
    monkeypatch.setattr(m,'load_coordination_profile',lambda project:profile)
    store=b.CoordinationLedger(root,profile);created=[]
    class Fake:
        def __init__(self,p,*,root,run_id):
            created.append(run_id);self.run_id=run_id;self.peak_private_bytes=1000;self.policy={};self.sidecar_info={};self.sidecar=root/'evidence'/run_id/'coordination.jsonl'
        def run(self,request,cancelled):
            self.sidecar.write_bytes(b'synthetic');return SimpleNamespace(close=lambda:None)
        def close(self):pass
    def measurement(result,**kwargs):
        id=created[-1];split='calibration' if '/calibration/' in id else 'heldout' if '/heldout/' in id else 'observe'
        r=rows(n=1,candidate='k1',split=split)[0]
        r.update(fixture_id=id.split('/')[-1] if id!='K-observe-42' else '01',profile_identity=profile.identity,
            input_hash=request.input_hash,native_binary_sha256=profile.native_sha256,trace_hash='f'*64,
            coordination_counters=good_counters(),coordination_valid=True)
        return r
    def observation(*args,**kwargs):return dict(equivalent=True,exact_transactions=1,control_trace_hash='d'*64,observed_trace_hash='f'*64)
    return SimpleNamespace(module=m,budget=b,store=store,profile=profile,root=root,factory=Fake,measure=measurement,observe=observation,created=created)


def execute(s,stage):
    return s.module.execute_stage(s.store,s.profile,stage,factory=s.factory,measure=s.measure,observe=s.observe)


def test_public_entrypoint_stays_blocked_without_linked_approval(tmp_path,monkeypatch):
    m=api();monkeypatch.delenv('TIMEPITCH_TEST_GRF_COORDINATION',raising=False)
    with pytest.raises(ValueError):m.run_coordination_campaign({},tmp_path,stage='observe')
    assert not list(tmp_path.iterdir())


def test_calibration_has_eight_fixed_ids_and_ready_only_reuse(synthetic):
    s=synthetic;execute(s,'observe');result=execute(s,'calibration')
    assert s.created==['K-observe-42']+[f'k1/calibration/{i:02}' for i in range(1,9)]
    assert result['qualified'] is True and len(result['rows'])==8
    assert execute(s,'calibration')==result and len(s.created)==9
    assert s.store.usage()==dict(used=46,maximum=72,candidates=5)


@pytest.mark.parametrize('failure',['factory','worker','capability','import'])
def test_first_failure_consumes_id_and_stops_without_retry(synthetic,failure):
    s=synthetic;execute(s,'observe');original=s.factory
    class Fail(original):
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs)
            if failure=='factory':raise RuntimeError('factory')
        def run(self,*args):raise RuntimeError(failure)
    s.factory=Fail
    with pytest.raises(RuntimeError):execute(s,'calibration')
    assert s.created==['K-observe-42','k1/calibration/01']
    assert s.store.entry('k1/calibration/01')['state']=='failed'
    assert (s.root/'evidence/k1/calibration/01/failure.json').is_file()
    with pytest.raises(ValueError):execute(s,'calibration')
    assert len(s.created)==2 and s.store.usage()['used']==39


def test_reserved_id_cannot_retry_even_if_no_factory_started(synthetic):
    s=synthetic;execute(s,'observe');request=s.module.request_for_run(s.profile,'k1/calibration/01')
    s.store.reserve('k1/calibration/01',request)
    with pytest.raises(ValueError):execute(s,'calibration')
    assert s.created==['K-observe-42']


def test_unqualified_cannot_open_heldout_and_selection_loss_cannot_reopen(synthetic):
    s=synthetic;execute(s,'observe');old=s.measure
    def bad(*args,**kwargs):r=old(*args,**kwargs);r['goals']=20;return r
    s.measure=bad;assert execute(s,'calibration')['qualified'] is False
    with pytest.raises(ValueError):execute(s,'heldout')
    assert not any('/heldout/' in id for id in s.created)


def test_sealed_selection_and_payloads_are_required_before_heldout(synthetic):
    s=synthetic;execute(s,'observe');execute(s,'calibration');result=execute(s,'heldout')
    assert len(result['rows'])==24 and len(s.created)==33
    assert s.store.usage()['used']==70
    for name in ('coordination-selection-registration.json','coordination-selection-initialized.json'):(s.root.parent/name).unlink()
    (s.root/'selection/freeze.json').unlink()
    with pytest.raises(ValueError):execute(s,'calibration')
    with pytest.raises(ValueError):execute(s,'heldout')
    assert len(s.created)==33


def test_coordination_exercise_never_substitutes_for_base_gates():
    m=api();values=rows(candidate='k1')
    for r in values:r.update(coordination_counters=good_counters(),coordination_valid=True)
    assert all(m.evaluate_coordination_gates(values,expected=8).values())
    values[0]['policy_counters']['invalid_inputs']=1
    assert not all(m.evaluate_coordination_gates(values,expected=8).values())
    values=rows(candidate='k1')
    for r in values:r.update(coordination_counters=good_counters(),coordination_valid=True)
    for r in values:r['coordination_counters']['handover_rejections']=0
    assert not m.evaluate_coordination_gates(values,expected=8)['coordination_exercise']


def test_two_writers_cannot_reserve_twice(synthetic):
    s=synthetic;execute(s,'observe');request=s.module.request_for_run(s.profile,'k1/calibration/01');barrier=threading.Barrier(2)
    def reserve():
        barrier.wait()
        try:return s.store.reserve('k1/calibration/01',request)
        except ValueError:return 'blocked'
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:reserve(),range(2)))
    assert results.count('blocked')==1 and s.store.usage()['used']==39


def test_missing_both_witnesses_never_initializes_a_fresh_ledger(synthetic):
    s=synthetic;before=(s.root/'checkpoint.json').read_bytes()
    for name in ('coordination-registration.json','coordination-initialized.json'):(s.root.parent/name).unlink()
    with pytest.raises(ValueError):s.budget.CoordinationLedger(s.root,s.profile)
    assert (s.root/'checkpoint.json').read_bytes()==before


def test_out_of_order_reservation_and_cancelled_run_are_terminal(synthetic):
    s=synthetic;execute(s,'observe');request=s.module.request_for_run(s.profile,'k1/calibration/02')
    with pytest.raises(ValueError):s.store.reserve('k1/calibration/02',request)
    from timepitch.grf.process import GrfCancelled
    class Cancel(s.factory):
        def run(self,*args):raise GrfCancelled()
    s.factory=Cancel
    with pytest.raises(GrfCancelled):execute(s,'calibration')
    assert s.store.entry('k1/calibration/01')['state']=='cancelled'
