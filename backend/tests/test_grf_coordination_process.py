"""Bounded portable wire, exact pure replay and reserved process boundaries."""
import copy
from dataclasses import asdict,replace
import importlib
import importlib.util
import json
from pathlib import Path
import subprocess
import threading
import struct

import pytest
from test_grf_coordination_policy import policy,scenario,run
from grf_physical_fixtures import row
from timepitch.grf.coordination_models import CoordinationState
from timepitch.grf.physical_wire import canonical,digest
from test_grf_coordination_profile import runtime
from test_grf_coordination_campaign import synthetic
from test_grf_candidate_process import full_actions


def wire():
    name='timepitch.grf.coordination_wire'
    assert importlib.util.find_spec(name),'Missing bounded coordination wire'
    return importlib.import_module(name)


def identity():return dict(run_id='K-observe-42',input_hash='a'*64,native_sha256='b'*64,profile_identity='c'*64,build_manifest_sha256='d'*64)


def empty_state():
    s=asdict(CoordinationState());s['cover_target']=[0,0];return json.loads(json.dumps(s))


def samples(policy):
    inp=replace(scenario(),time_ms=2149000);decision=run(policy,inp)
    raw=asdict(inp);raw['ball_100ms']=[inp.ball_100ms.x,inp.ball_100ms.y]
    for p in raw['players']:
        p['position']=list(p['position'].values());p['formation']=list(p['formation'].values()) if p['formation'] else None
    raw=json.loads(json.dumps(raw))
    start=dict(physics_ms=2149000,period=1,relocation_id=7,window=0,states=[empty_state(),empty_state()],state_mirror_signs=[0,0],lineage=[])
    end=copy.deepcopy(start);end.update(physics_ms=2149100);end['states'][0]=decision['state'];end['state_mirror_signs'][0]=1
    txn=dict(type='assignment',physics_ms=2149000,period=1,team=0,dynamic_side=-1,relocation_id=7,
        prior_state=empty_state(),actual_prior_marks=[],input=raw,decision=decision,applied=False,mirror_sign=1)
    return [(row(21490,2149000,relocation_id=7),start,[]),(row(21491,2149100,relocation_id=7),end,[txn])]


def write_short(tmp_path,policy,change=None):
    m=wire();parts=samples(policy)
    if change:change(parts)
    path=tmp_path/'coordination.jsonl';writer=m.CoordinationWriter(path,identity(),'observe')
    for r,f,t in parts:writer.append(r,f,t)
    writer.finish('e'*64)
    return path,parts


def test_wire_roundtrip_preserves_native_Q_state_and_order(tmp_path,policy):
    path,parts=write_short(tmp_path,policy);m=wire()
    result=m.validate_coordination_sidecar(path,identity(),'observe','e'*64,expected_rows=[v[0] for v in parts])
    assert result['frames']==2 and result['transactions']==1
    restored=list(m.iter_coordination_frames(path));assert restored[1]['transactions']==parts[1][2]
    txn=restored[1]['transactions'][0]
    assert txn['input']['quality']==parts[1][2][0]['input']['quality']
    assert restored[0]['native']['states']==[empty_state(),empty_state()]


@pytest.mark.parametrize('change,reason',[
    ('clock','clock'),('mirror','mirror'),('initial','initial'),('prior','continuity'),
    ('window','window'),('native_time','clock'),('state_time','state'),('duplicate_owner','ownership'),
    ('nan_quality','finite'),('oversize_record','record'),('applied','mode')])
def test_invalid_native_frame_or_transaction_rejected(tmp_path,policy,change,reason):
    def alter(parts):
        r,f,t=parts[1];tx=t[0]
        if change=='clock':f['physics_ms']+=1
        if change=='mirror':tx['dynamic_side']=1;tx['input']['dynamic_side']=1
        if change=='initial':parts.pop(0)
        if change=='prior':tx['prior_state']['cover_id']=2
        if change=='window':f['window']=2
        if change=='native_time':tx['input']['time_ms']+=1
        if change=='state_time':tx['decision']['state']['time_ms']+=1000
        if change=='duplicate_owner':tx['decision']['marks'].append(copy.deepcopy(tx['decision']['marks'][0]))
        if change=='nan_quality':tx['input']['quality'][0][0]=float('nan')
        if change=='oversize_record':tx['untrusted_padding']='x'*65536
        if change=='applied':tx['applied']=True
    with pytest.raises(ValueError,match=reason):write_short(tmp_path,policy,alter)


def test_corrupted_truncated_oversize_and_wrong_identity_sidecar(tmp_path,policy):
    path,parts=write_short(tmp_path,policy);m=wire();raw=path.read_bytes()
    for changed in (raw[:-50],raw.replace(b'grf-coordination-sidecar-1',b'grf-coordination-sidecar-0'),b'x'*(m.MAX_SIDECAR+1)):
        bad=tmp_path/'bad.jsonl';bad.write_bytes(changed)
        with pytest.raises(ValueError):m.validate_coordination_sidecar(bad,identity(),'observe','e'*64,expected_rows=[v[0] for v in parts])
    with pytest.raises(ValueError,match='identity'):
        m.validate_coordination_sidecar(path,{**identity(),'input_hash':'f'*64},'observe','e'*64,expected_rows=[v[0] for v in parts])


def test_dictionary_order_is_semantic_but_request_and_state_order_are_bound(tmp_path,policy):
    def reverse_keys(parts):
        tx=parts[1][2][0];tx['input']={k:tx['input'][k] for k in reversed(tx['input'])}
    a,_=write_short(tmp_path,policy,reverse_keys)
    m=wire();assert m.validate_coordination_sidecar(a,identity(),'observe','e'*64,expected_rows=[v[0] for v in samples(policy)])['transactions']==1


def test_frame_and_transaction_caps_are_fixed():
    m=wire();assert (m.MAX_FRAMES,m.MAX_TRANSACTIONS,m.MAX_RECORD,m.MAX_POLICY_BYTES)==(303,400,65536,8192)


def test_missing_matching_consumed_reservation_prevents_process(tmp_path):
    name='timepitch.grf.coordination_process'
    assert importlib.util.find_spec(name),'Missing reserved coordination process'
    m=importlib.import_module(name)
    with pytest.raises(ValueError):m.CoordinationProcess(None,root=tmp_path,run_id='K-observe-42')


def test_native_runtime_serialization_roundtrips_through_real_wire(runtime,tmp_path):
    native=wire()._json(subprocess.check_output([str(runtime),'wire']))
    m=wire();path=tmp_path/'native.jsonl';w=m.CoordinationWriter(path,identity(),'observe')
    parts=[(row(21490,2149000,relocation_id=7),native['initial'],[]),
        (row(21491,2149100,relocation_id=7),native['final'],native['transactions'])]
    for r,f,t in parts:w.append(r,f,t)
    w.finish('e'*64)
    assert m.validate_coordination_sidecar(path,identity(),'observe','e'*64,expected_rows=[p[0] for p in parts])['transactions']==1
    lineages=list(m.iter_coordination_frames(path))[-1]['native']['lineage']
    assert struct.pack('<d',lineages[0]['position_at_request'][0])==struct.pack('<d',-0.0)
    assert lineages[1]['position_at_request'] is None and lineages[1]['movement_requested'] is False


def test_launch_tombstone_precedes_capability_and_blocks_a_second_launch(synthetic,monkeypatch):
    s=synthetic;m=importlib.import_module('timepitch.grf.coordination_process')
    from timepitch.grf.models import EngineCapability
    from timepitch.grf.process import GrfUnavailable
    monkeypatch.setattr(m,'load_coordination_profile',lambda project:s.profile)
    request=m.request_for_run(s.profile,'K-observe-42');s.store.reserve('K-observe-42',request)
    p=m.CoordinationProcess(s.profile,root=s.root,run_id='K-observe-42');calls=[]
    def missing():calls.append(1);return EngineCapability(id='grf',available=False,reason='missing_assets')
    monkeypatch.setattr(p,'capability',missing)
    try:
        with pytest.raises(GrfUnavailable):p.run(request,threading.Event())
        assert (p.evidence/'launch.json').is_file()
        with pytest.raises(FileExistsError):p.run(request,threading.Event())
        assert len(calls)==1 and s.store.usage()['used']==38
    finally:p.close()


def test_policy_is_bounded_and_base_counters_remain_distinct(tmp_path):
    m=wire();assert hasattr(m,'validate_coordination_policy'),'Missing shared policy validator'
    from timepitch.grf.candidate_wire import COUNTERS as BASE_COUNTERS
    base=dict(policy_version='c4-marking-1',**m.BASE_SPEC['policy'],**dict.fromkeys(BASE_COUNTERS,0))
    start=dict(version=m.VERSION,mode='observe',overflowed=False,counters=dict.fromkeys(m.COUNTERS,0))
    final=copy.deepcopy(start);final['counters']['assignments']=1
    value=m.policy_value(identity(),'observe','e'*64,base,base,start,final)
    path=tmp_path/'policy.json';m.write_coordination_policy(path,value)
    assert m.read_coordination_policy(path,identity(),'observe','e'*64)==value
    bad=copy.deepcopy(value);bad['base_final']['counters']=final['counters']
    with pytest.raises(ValueError):m.validate_coordination_policy(bad,identity(),'observe','e'*64)
    bad=copy.deepcopy(value);bad['coordination_final']['counters']['invariant_violations']=1
    with pytest.raises(ValueError):m.validate_coordination_policy(bad,identity(),'observe','e'*64)
    path.write_bytes(b'x'*8193)
    with pytest.raises(ValueError,match='8KiB'):m.read_coordination_policy(path,identity(),'observe','e'*64)


def test_full_window_frame_cap_rejects_304th_frame(tmp_path):
    m=wire();w=m.CoordinationWriter(tmp_path/'frames.jsonl',identity(),'observe');index=0;last=None
    for win,(a,b) in enumerate(m.WINDOWS):
        for ms in range(a,b+1,100):
            f=dict(physics_ms=ms,period=1,relocation_id=0,window=win,states=[empty_state(),empty_state()],state_mirror_signs=[0,0],lineage=[])
            r=row(index,ms);w.append(r,f,[]);index+=1;last=(r,f)
    assert index==303
    extra=copy.deepcopy(last[0]);extra[0]+=1
    with pytest.raises(ValueError,match='frame count'):w.append(extra,last[1],[])


def test_transaction_keeps_native_relocation_before_end_of_sample(tmp_path,policy):
    def transition(parts):parts[1][0][19]=8;parts[1][1]['relocation_id']=8
    path,parts=write_short(tmp_path,policy,transition)
    assert wire().validate_coordination_sidecar(path,identity(),'observe','e'*64,expected_rows=[v[0] for v in parts])['transactions']==1


def measurement_api():
    name='timepitch.grf.coordination_measurement'
    assert importlib.util.find_spec(name),'Missing K1 measurement/replay'
    return importlib.import_module(name)


def test_native_decision_replay_is_exact_and_rejects_changed_objective(tmp_path,policy):
    path,_=write_short(tmp_path,policy);m=measurement_api()
    from timepitch.grf.coordination_shadow import CppPolicy
    assert m.replay_coordination_decisions(path,CppPolicy(policy))['exact_transactions']==1
    bad=tmp_path/'changed';bad.mkdir()
    def alter(parts):parts[1][2][0]['decision']['objective']+=.01
    changed,_=write_short(bad,policy,alter)
    with pytest.raises(ValueError,match='exact'):m.replay_coordination_decisions(changed,CppPolicy(policy))


def test_observe_equivalence_uses_unique_readback_identity():
    from types import SimpleNamespace
    from grf_action_fixtures import action_trace
    from timepitch.grf.defensive_probe import compare_defensive_capture
    from timepitch.grf.physical_codec import manifest_hash
    a,chunks=action_trace();b=a.model_copy(deep=True);b.attribute_readbacks=list(reversed(b.attribute_readbacks));b.trace_hash=manifest_hash(b)
    control=SimpleNamespace(manifest=a,chunks=lambda:iter(chunks));probe=SimpleNamespace(manifest=b,chunks=lambda:iter(chunks))
    with pytest.raises(ValueError):compare_defensive_capture(control,probe)
    result=compare_defensive_capture(control,probe,_readbacks_by_identity=True)
    assert result['blocks']==1 and result['readbacks']==66
    b.attribute_readbacks[0]=b.attribute_readbacks[1];b.trace_hash=manifest_hash(b)
    with pytest.raises(ValueError,match='readback'):compare_defensive_capture(control,probe,_readbacks_by_identity=True)


def test_measurement_reuses_v2_with_exact_private_pin(full_actions,tmp_path,monkeypatch):
    from types import SimpleNamespace
    from timepitch.grf.physical_codec import manifest_hash
    from timepitch.grf.action_statistics import build_action_statistics
    m=measurement_api();manifest=full_actions.manifest.model_copy(deep=True);manifest.native_binary_sha256='b'*64;manifest.trace_hash=manifest_hash(manifest)
    profile=SimpleNamespace(project=tmp_path,identity='c'*64,native_sha256='b'*64,build_manifest_sha256='d'*64,
        payload=lambda key:manifest.input.model_dump(mode='json'))
    monkeypatch.setattr(m,'load_coordination_profile',lambda project:profile)
    expected=dict(run_id='k1/calibration/01',input_hash=manifest.input.input_hash,native_sha256='b'*64,profile_identity='c'*64,build_manifest_sha256='d'*64)
    w=wire();from timepitch.grf.candidate_wire import COUNTERS as BASE_COUNTERS
    base=dict(policy_version='c4-marking-1',**w.BASE_SPEC['policy'],**dict.fromkeys(BASE_COUNTERS,0))
    c=dict(version=w.VERSION,mode='apply',overflowed=False,counters=dict.fromkeys(w.COUNTERS,0))
    policy=w.policy_value(expected,'apply',manifest.trace_hash,base,base,c,c)
    calls=[]
    def reduce(*args,**kwargs):calls.append(kwargs['_research_native_sha256']);return build_action_statistics(*args,**kwargs)
    monkeypatch.setattr(m,'build_action_statistics',reduce)
    result=SimpleNamespace(manifest=manifest,chunks=full_actions.chunks)
    row=m.measure_coordination_result(result,seconds=300,peak_private_bytes=1000,profile=profile,policy=policy,
        sidecar_info=dict(trace_hash=manifest.trace_hash,sha256='a'*64,frames=303,transactions=0,bytes=1000,expanded_bytes=1000))
    assert calls==['b'*64] and row['candidate_id']=='k1'
    assert row['policy_counters']==policy['base_final']['counters']
    assert row['coordination_counters']==c['counters'] and len(row['outfield_km'])==20
    assert set(row['_analysis'])=={'summary.json','actions-diagnostic.json','defense-diagnostic.json'}


def test_native_integer_looking_negative_zero_preserves_float64_bits():
    m=wire();values=m._json(b'[-0,0,-0.0]')
    assert struct.pack('<d',values[0])==struct.pack('<d',-0.0)
    assert struct.pack('<d',values[1])==struct.pack('<d',0.0)


def test_worker_claims_once_before_native_import_and_accepts_dictionary_order(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from grf_action_fixtures import action_trace
    import timepitch.grf.coordination_profile as p
    import timepitch.grf.coordination_budget as b
    from timepitch.grf.coordination_runner import worker_identity
    monkeypatch.setattr(p,'PROJECT_ROOT',tmp_path)
    payload=action_trace()[0].input.model_dump(mode='json');doc=dict(native_sha256='b'*64,build_manifest_sha256='c'*64,payloads={'calibration/01':payload})
    monkeypatch.setattr(p,'load_coordination_document',lambda project:copy.deepcopy(doc))
    calls=[]
    monkeypatch.setattr(b,'CoordinationLedger',lambda root,profile:SimpleNamespace(verify_reserved=lambda *args:calls.append('verified'),verify_selection=lambda:None))
    root=tmp_path/p.RUN_ROOT;native=tmp_path/p.NATIVE/'Release';evidence=root/'evidence/K-observe-42';evidence.mkdir(parents=True)
    expected=dict(run_id='K-observe-42',input_hash=payload['input_hash'],native_sha256='b'*64,profile_identity=digest(doc),build_manifest_sha256='c'*64)
    (evidence/'launch.json').write_bytes(canonical(dict(identity=expected,mode='observe')))
    reordered=copy.deepcopy(payload)
    for player in reordered['players']:player['attributes']={k:player['attributes'][k] for k in reversed(player['attributes'])}
    assert worker_identity(native,root,'K-observe-42',reordered)[0]==expected
    assert calls==['verified'] and (evidence/'worker-claimed.json').is_file()
    with pytest.raises(FileExistsError):worker_identity(native,root,'K-observe-42',reordered)
    source=Path(importlib.import_module('timepitch.grf.coordination_runner').__file__).read_text()
    assert source.index('payload=normalize_payload(payload)')<source.index('core=create_core(payload)')
