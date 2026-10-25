"""Real file/lock lifecycle and runner doubles; never a football process."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError,replace
import importlib
import importlib.util
import json
import threading
import pytest
from grf_candidate_fixtures import bind,seed_project,save_ready_report
from test_grf_candidate_profiles import api
from timepitch.grf import physical_campaign_budget as budget


def campaign_api(monkeypatch):
    m=api('action_campaign')
    monkeypatch.setattr(m,'_require_native_authorization',lambda:None)
    return m


def test_binding_is_immutable_and_does_not_consume_candidate(tmp_path,monkeypatch):
    m,root,campaign,profile=bind(tmp_path,monkeypatch)
    state=budget._read(root/'checkpoint.json')
    assert len(state['runs'])==0 and set(state['candidate_bindings'])=={'c1','c2','c3'}
    assert len(profile.payloads)==32 and len(profile.dependencies)==14
    with pytest.raises((FrozenInstanceError,AttributeError)):profile.id='c5'
    with pytest.raises(TypeError):profile.policy['marking_floor']=.5
    with pytest.raises(TypeError):profile.payloads['calibration/01']['config']['seed']=9
    with pytest.raises(ValueError):profile.settings.rest_radius_m=1
    assert m.bind_candidate_profile(tmp_path,'c4',root)==profile
    (root/'candidate-bindings/c4.json').unlink();(root.parent/'continuation-c4-registration.json').unlink()
    with pytest.raises(ValueError):m.bind_candidate_profile(tmp_path,'c4',root)
    assert budget._read(root/'checkpoint.json')==state


def test_two_writers_bind_once_and_changed_code_or_payload_stops(tmp_path,monkeypatch):
    m,root,campaign=seed_project(tmp_path,monkeypatch);barrier=threading.Barrier(2)
    def writer():barrier.wait();return m.bind_candidate_profile(tmp_path,'c4',root).identity
    with ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(writer);b=pool.submit(writer);assert a.result()==b.result()
    code=tmp_path/'backend/src/timepitch/grf/action_statistics.py';code.write_bytes(code.read_bytes()+b'\n# changed\n')
    with pytest.raises(ValueError):m.load_candidate_profile(tmp_path,'c4')


def test_passing_c4_skips_c5(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);save_ready_report(root,profile)
    m=campaign_api(monkeypatch);calls=[]
    monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    before=budget._read(root/'checkpoint.json')
    descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    result=m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c5')
    assert result['status']=='skipped_c4_qualified' and not calls
    assert budget._read(root/'checkpoint.json')==before


def test_c5_requires_complete_eligible_c4_before_factory(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch)
    m=campaign_api(monkeypatch);calls=[];monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    before=budget._read(root/'checkpoint.json');descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c5')
    assert not calls and budget._read(root/'checkpoint.json')==before


def test_ready_reuse_never_calls_runner_and_failed_id_cannot_retry(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);saved=save_ready_report(root,profile)
    m=campaign_api(monkeypatch);calls=[];monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    before=budget._read(root/'checkpoint.json')
    result=m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')
    assert result['rows']==saved['rows'] and not calls and budget._read(root/'checkpoint.json')==before
    state=budget._read(root/'checkpoint.json');state['runs']['c4/calibration/01']['state']='failed'
    budget._save(root,root.parent/'continuation-registration.json',state)
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')
    assert not calls and budget._read(root/'checkpoint.json')==state


def test_factory_failure_consumes_once_and_preserves_failure_prefix(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);m=campaign_api(monkeypatch);calls=[]
    def fail(*a,**k):calls.append(1);raise RuntimeError('Synthetic capability failure')
    monkeypatch.setattr(m,'CandidateProcess',fail)
    descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(RuntimeError):m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')
    state=budget._read(root/'checkpoint.json');assert state['runs']['c4/calibration/01']['state']=='failed'
    assert (root/'evidence/c4/calibration/01/failure.json').is_file()
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')
    assert len(calls)==1 and budget._read(root/'checkpoint.json')==state


def test_fixed_eight_fake_runs_complete_then_reuse_without_any_child(tmp_path,monkeypatch):
    _,root,campaign,profile=bind(tmp_path,monkeypatch);m=campaign_api(monkeypatch);calls=[]
    from types import SimpleNamespace
    from grf_action_fixtures import action_trace
    from test_grf_action_gates import rows
    from timepitch.grf.physical_wire import canonical
    class FakeProcess:
        def __init__(self,p,*,root,run_id):
            self.id=run_id;self.path=root/'evidence'/run_id;self.peak_private_bytes=1000000;self.policy={}
        def run(self,request,cancelled):
            calls.append(self.id);manifest,_=action_trace();manifest.input=request
            (self.path/'manifest.json').write_text(manifest.model_dump_json())
            return SimpleNamespace(close=lambda:None)
        def close(self):pass
    def fake_measure(result,**kwargs):
        id=calls[-1].split('/')[-1];r=rows()[int(id)-1]
        return r|dict(input_hash=profile.payloads['calibration/'+id]['input_hash'],native_binary_sha256=profile.native_sha256,
            profile_identity=profile.identity,trace_hash='e'*64,_analysis={})
    monkeypatch.setattr(m,'CandidateProcess',FakeProcess);monkeypatch.setattr(m,'measure_action_result',fake_measure)
    descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    result=m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')
    assert result['qualified'] and len(calls)==8 and len(budget._read(root/'checkpoint.json')['runs'])==8
    screening=budget._read(root/'reports/c4-c5-eligibility.json')
    assert screening['source_report_sha256']==budget._sha(root/'reports/c4-calibration.json') and not screening['eligible']
    assert m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')==result and len(calls)==8


def test_native_optin_is_never_enabled_by_generic_tests(tmp_path,monkeypatch):
    _,root,_,profile=bind(tmp_path,monkeypatch);m=api('action_campaign');monkeypatch.delenv('TIMEPITCH_TEST_GRF_INTERVENTION',raising=False)
    calls=[];monkeypatch.setattr(m,'CandidateProcess',lambda *a,**k:calls.append(1))
    before=budget._read(root/'checkpoint.json');descriptor=budget._read(tmp_path/'research/engine-evaluation/2026-10-17-grf-defensive-calibration/intervention.json')
    with pytest.raises(ValueError):m.run_action_campaign(descriptor,root,split='calibration',candidate_id='c4')
    assert not calls and budget._read(root/'checkpoint.json')==before


def test_penalty_goals_require_linked_native_goal_foul_and_ledger():
    m=api('action_campaign')
    from types import SimpleNamespace
    goal=dict(raw_seq=20,own_goal=False,linked_release_raw_seq=10,linked_release_semantic_seq=2,period=1)
    shot=dict(raw_event_seq=10,semantic_seq=2,goal=True,phase_class='penalty',restart_kind='penalty',
        penalty_prepared_raw_seq=3,penalty_foul=dict(physics_ms=100,accepted_raw_seq=5,sanctioned_raw_seq=6))
    manifest=SimpleNamespace(score=(1,0),ledger=[SimpleNamespace(cause='penalty',id=i,period=1,start=t) for i,t in [(7,100),(8,500)]])
    diagnostic=dict(goals=dict(events=[goal],scoreboard_agrees=True));defense=dict(shots=[shot])
    counts=m.classify_goals(manifest,diagnostic,defense)
    assert counts['penalty_goals']==1 and counts['penalties_awarded']==2 and counts['goal_classification_complete']
    shot['penalty_foul']['accepted_raw_seq']=None
    counts=m.classify_goals(manifest,diagnostic,defense)
    assert counts['penalty_goals']==0 and counts['unknown_goals']==1 and not counts['goal_classification_complete']
    goal['own_goal']=True
    counts=m.classify_goals(manifest,diagnostic,defense)
    assert counts['own_goals']==1 and counts['penalty_goals']==0 and counts['goal_classification_complete']
