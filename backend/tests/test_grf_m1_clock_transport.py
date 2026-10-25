"""Research transport only; all observations are hand authored or fake cores."""
from dataclasses import replace
from types import SimpleNamespace
import copy
import pytest
from grf_action_fixtures import action_trace
from grf_physical_fixtures import row
from grf_offline_guard import offline_only


def test_new_manifest_and_clock_are_not_legacy():
    from timepitch.grf.m1_models import M1Manifest
    from timepitch.grf.m1_codec import M1StreamValidator
    from timepitch.grf.bounded_clock import BoundedClockState
    m, _ = action_trace()
    profile = SimpleNamespace(identity='a'*64, native_sha256='b'*64)
    v = M1StreamValidator(m.input, profile)
    assert isinstance(v.clock, BoundedClockState)
    with pytest.raises(ValueError): M1Manifest.model_validate(m.model_dump())


def close_receipt(r, reason='bounded_open_play'):
    from timepitch.grf.m1_wire import state_digest
    before = dict(physics_ms=int(r[1]), effective_ms=int(r[4]), period=int(r[2]),
        relocation_id=int(r[19]), score=[int(r[15]), int(r[16])], in_play=bool(r[5]),
        pending_penalty=bool(r[12]), protected_restart=False,
        state_signature='fake exact state', state_digest=dict(algorithm='fnv1a64',value=state_digest('fake exact state')))
    return dict(version='m1-period-close-1', reason=reason, before=before, after=dict(before,in_play=False))


@pytest.mark.parametrize('field,value', [('physics_ms',2820100),('period',2),('relocation_id',9),
    ('effective_ms',10),('score',[1,0]),('in_play',True),('pending_penalty',True),
    ('state_signature','mutated'),('state_digest',dict(algorithm='fnv1a64',value='0'*16))])
def test_close_receipt_checks_state_and_observation(field,value):
    from timepitch.grf.m1_wire import validate_close
    r=row(28200,2820000,elapsed=2820000,in_play=1)
    good=close_receipt(r);validate_close(good,dict(period=1,physics_ms=2820000,reason='bounded_open_play'),r)
    bad=copy.deepcopy(good);bad['after'][field]=value
    with pytest.raises(ValueError):validate_close(bad,dict(period=1,physics_ms=2820000,reason='bounded_open_play'),r)


def test_parent_clock_derives_due_close_and_does_not_forge_out_of_play():
    from timepitch.grf.m1_codec import M1StreamValidator
    from timepitch.grf.bounded_clock import BoundedClockState
    m,_=action_trace();v=M1StreamValidator(m.input,SimpleNamespace(identity='a'*64,native_sha256='b'*64))
    v.clock=BoundedClockState(initialized=True,physics_ms=2819900,period_elapsed_ms=2819900,
        announced_minimum_ms=0,target_ms=2700000,deadline_ms=2820000)
    r=row(28200,2820000,elapsed=2820000,in_play=1)
    v._clock_step(r)
    assert v.clock.period_complete and r[5]==1 and v.expected_closes[0][0]['reason']=='bounded_open_play'


@pytest.mark.parametrize('protected',[False,True])
def test_capture_fallback_uses_native_receipt_and_protected_limit_fails(protected):
    import json
    from timepitch.grf.m1_capture import M1Capture
    from timepitch.grf.bounded_clock import BoundedClockState,ClockLimitError
    capture=M1Capture.__new__(M1Capture)
    capture.clock=BoundedClockState(initialized=True,physics_ms=2819900,period_elapsed_ms=2819900,announced_minimum_ms=0,
        target_ms=2700000,deadline_ms=2820000,penalty_protected=protected)
    capture.close_receipts=[];capture.close_request=None
    r=row(28200,2820000,elapsed=2820000,in_play=1);calls=[]
    def close(period,ms,reason):calls.append((period,ms,reason));return json.dumps(close_receipt(r))
    capture.core=SimpleNamespace(_env=SimpleNamespace(probe_close_physical_period=close))
    state=dict(physics_ms=2820000,phase=1,effective_ms=0,in_play=True,restart_id=0,restart_cause='none',restart_active=False,
        restart_start_ms=0,pending_penalty=False,discontinuity=False,relocation_id=0)
    if protected:
        with pytest.raises(ClockLimitError):capture._clock_step(state)
        assert calls==[] and capture.last_observed_ms==2820000
    else:
        capture._clock_step(state);assert calls==[]
        capture._after_sample(state,r)
        assert calls==[(1,2820000,'bounded_open_play')] and len(capture.close_receipts)==1 and r[5]==1


def test_capture_flushes_valid_prefix_on_clock_failure(monkeypatch):
    from timepitch.grf import action_runner
    from timepitch.grf.m1_capture import M1Capture
    from timepitch.grf.bounded_clock import BoundedClockState,ClockLimitError
    from test_grf_action_capture import SnapshotAdapter,SetupDouble
    m,_=action_trace();engine=SetupDouble()
    engine.probe_enable_continuity_v2=lambda mode:None
    engine.probe_m1_identity_map=lambda:[dict(side=s,slot=i,native_stable_id=100+s*11+i,active=True,keeper=i==0)
        for s in (0,1) for i in range(11)]
    monkeypatch.setattr(action_runner,'ActionNativeAdapter',SnapshotAdapter)
    obs=dict(ball_owned_team=-1,ball_owned_player=-1,left_team=[[0.,0.]]*11,right_team=[[0.,0.]]*11,
        left_team_direction=[[0.,0.]]*11,right_team_direction=[[0.,0.]]*11)
    c=M1Capture(SimpleNamespace(_env=engine,observation=lambda:obs),m.input.model_dump(mode='json'),SimpleNamespace(mode='observe'))
    original=c._clock_step
    def step(state):
        if state['physics_ms']==200:
            c.last_observed_ms=200
            raise ClockLimitError('protected_restart_limit')
        return original(state)
    monkeypatch.setattr(c,'_clock_step',step)
    it=iter(c);block=next(it)
    assert len(block['samples'])==2 and block['samples'][-1][1]==100
    with pytest.raises(ClockLimitError):next(it)
    assert not c.completed and c.last_observed_ms==200
    with pytest.raises(ValueError):c.manifest('b'*64)


def test_legacy_validator_cannot_select_m1_clock():
    from timepitch.grf.action_codec import ActionStreamValidator
    m,_=action_trace()
    with pytest.raises(TypeError):ActionStreamValidator(m.input,m.native_binary_sha256,clock='m1')


def test_full_fake_worker_parent_evidence_and_shared_measurement(tmp_path,monkeypatch):
    """54,002 fake snapshots, one shot; no physics, GRF, reservation or services."""
    import json,threading
    from dataclasses import replace
    from test_grf_action_capture import SnapshotAdapter,SetupDouble
    from grf_m1_fixtures import synthetic_launch
    from test_grf_m1_worker import FakeChild
    from timepitch.grf import action_runner,m1_process
    from timepitch.grf.m1_verifier import verify_launch
    from timepitch.grf.m1_runner import capture_worker
    from timepitch.grf.m1_models import M1Manifest
    from timepitch.grf.m1_evidence import validate_evidence,replay_frame
    from timepitch.grf.m1_measurement import measure_m1_result
    from timepitch.grf.m1_codec import M1StreamValidator
    from timepitch.grf.m1_wire import COUNTERS
    from timepitch.grf.physical_wire import canonical,CAUSES
    from timepitch.grf.physical_native import physical_sample
    from timepitch.grf.physical_codec import parse_manifest,manifest_hash
    from timepitch.grf.action_statistics import build_action_statistics
    from timepitch.grf.candidate_wire import COUNTERS as BASE_COUNTERS
    campaign,payload,d=synthetic_launch(tmp_path);launch=verify_launch(tmp_path,campaign,'M-observe-42',payload)
    engine=SetupDouble();engine.closes=[];engine.frames=[];engine.current=None
    obs=dict(ball_owned_team=-1,ball_owned_player=-1,left_team=[[.1,.2]]*11,right_team=[[-.3,-.4]]*11,
        left_team_direction=[[.01,.02]]*11,right_team_direction=[[-.01,-.01]]*11)
    mapping=[dict(side=0 if p['side']=='home' else 1,slot=p['slot'],native_stable_id=300+(0 if p['side']=='home' else 20)+p['slot'],
        active=True,keeper=p['role']=='GK') for p in payload['players']]
    class Adapter(SnapshotAdapter):
        def snapshot(self):
            state=super().snapshot();engine.current=state
            if state['phase']==1 and state['physics_ms']<=1100:
                clock=SimpleNamespace(physics_ms=state['physics_ms'],period=1,period_elapsed_ms=state['physics_ms'],effective_ms=0)
                r=physical_sample(state,obs,0,clock,CAUSES)
                engine.frames.append(dict(row=replay_frame(r,mapping),marks=[[],[]],contexts=[None,None],designated=[-1,-1,-1],lineage=[]))
            return state
        def drain(self,index):
            batch=super().drain(index)
            if index==1:batch['semantic_events'][0].update(intent='shot',origin='open_play_shot')
            return batch
    def close(period,ms,reason):
        state=engine.current
        assert period==state['phase'] and ms==state['physics_ms'] and period not in engine.closes
        engine.closes.append(period)
        r=row(0,ms,period,engine.elapsed,relocation_id=state['relocation_id'],in_play=int(state['in_play']))
        return json.dumps(close_receipt(r,reason))
    def halftime():
        assert engine.closes==[1]
        SetupDouble.probe_begin_second_half(engine)
    def counters():
        return json.dumps(dict(dict.fromkeys(COUNTERS,0),version='m1-policy-counters-1',mode='observe',enabled=True,overflowed=False,
            ticks=int(engine.phase==2)))
    def contexts(complete):
        shots=[dict(raw_seq=0,physics_ms=100,period=1,relocation_id=0,origin='open_play_shot')]
        return json.dumps(dict(version='m1-shot-context-2',mode='observe',complete=complete,overflowed=False,end_ms=5400000,
            triggers=shots,observed_contacts=shots,frames=engine.frames,transactions=[]))
    engine.probe_enable_continuity_v2=lambda mode:None;engine.probe_m1_identity_map=lambda:mapping
    engine.probe_close_physical_period=close;engine.probe_begin_second_half=halftime
    engine.probe_m1_policy_state=counters;engine.probe_finish_shot_context_v2=contexts
    engine.probe_intervention_state=lambda:dict(policy_version='c4-marking-1',marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.70,
        **dict.fromkeys(BASE_COUNTERS,0))
    monkeypatch.setattr(action_runner,'ActionNativeAdapter',Adapter)
    wire=[];capture_worker(SimpleNamespace(_env=engine,observation=lambda:obs),payload,launch,lambda message:wire.append(canonical(message)+b'\n'))
    manifest=M1Manifest.model_validate(json.loads(wire[-1])['manifest'])
    assert engine.closes==[1,2] and len(manifest.attribute_readbacks)==66 and manifest.duration_ms==5400000
    assert manifest.input.settings.clock_policy=='physical-periods-1' and manifest.clock_policy=='m1-bounded-whistle-1'
    with pytest.raises(ValueError):parse_manifest(manifest.model_dump(mode='json'))
    with pytest.raises(ValueError):build_action_statistics(manifest,[],_research_native_sha256=manifest.native_binary_sha256)
    process=m1_process.M1Process(SimpleNamespace(project=tmp_path,identity=launch.profile_identity),campaign,launch.run_id)
    monkeypatch.setattr(process,'_spawn',lambda:FakeChild(b''.join(wire)))
    monkeypatch.setattr(m1_process,'private_bytes',lambda child:1024)
    result=process._run_transport(manifest.input,threading.Event(),launch)
    try:
        receipt=validate_evidence(result,launch)
        measurement=measure_m1_result(result,receipt,dict(seconds=1.,peak_private_bytes=1024))
        assert receipt.context['selected_contacts']==1 and receipt.context['frames']==12
        assert len(measurement['players'])==22 and measurement['shots']==1 and measurement['candidate_id']=='m1'
        assert measurement['goals']==0 and measurement['complete'] is True
        # Phase4's ready gate re-admits the retained replay/evidence, and cannot
        # turn a changed metric into a valid measurement. Observation equality
        # is doubled here only; its projection has separate component tests.
        from timepitch.grf import m1_campaign,m1_profile
        profile=m1_profile.load_worker_profile(tmp_path)
        proof=dict(equivalent=True,exact_transactions=1)
        monkeypatch.setattr(m1_campaign,'_observation',lambda *args:proof)
        saved_row=dict(measurement,equivalent=True,exact_transactions=1,observation_proof=proof)
        m1_campaign.validate_retained_measurement(profile,launch.run_id,saved_row)
        saved_row['goals']=1
        with pytest.raises(ValueError):m1_campaign.validate_retained_measurement(profile,launch.run_id,saved_row)
        # Completion denial does not require an expensive second stream pass.
        validator=M1StreamValidator(manifest.input,launch)
        validator.expected_closes=[(dict(period=int(r['before']['period']),physics_ms=int(r['before']['physics_ms']),reason=r['reason']),
            row(0,r['before']['physics_ms'],r['before']['period'],2700000,relocation_id=r['before']['relocation_id'])) for r in manifest.close_receipts]
        bad=manifest.model_copy(deep=True);bad.close_receipts[0]['reason']='bounded_open_play'
        with pytest.raises(ValueError):validator._validate_completion(bad)
        # A sidecar cannot attest itself: changing it without the trace binding fails.
        policy_path=launch.evidence/'policy.json';original=policy_path.read_bytes();policy=json.loads(original)
        policy['trace_hash']='0'*64;policy_path.write_bytes(canonical(policy))
        with pytest.raises(ValueError,match='Policy trace'):validate_evidence(result,launch)
        # Read binding directly; replay admission already exercised above.
        from timepitch.grf.m1_wire import read_context
        with pytest.raises(ValueError):read_context(launch.evidence/'contexts.zlib',launch.identity,'0'*64)
        policy_path.write_bytes(original)
    finally:result.close()
