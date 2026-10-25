"""K1 uses the existing V2 reducer and diagnostics with a verified private pin."""
import math
from pathlib import Path

from .action_statistics import build_action_statistics
from .action_diagnostics import diagnose_actions
from .defensive_diagnostics import diagnose_defense
from .action_campaign import classify_goals
from .action_validation import RetainedResult
from .defensive_probe import compare_defensive_capture
from .coordination_models import Point,Player,CoordinationInput,CoordinationState,CoordinationDecision,encode_request
from .coordination_profile import load_coordination_profile,read,STUDY,sha
from .coordination_process import request_for_run
from .coordination_shadow import CppPolicy
from .coordination_wire import validate_coordination_policy,validate_coordination_sidecar,iter_coordination_frames,MAX_SIDECAR,MAX_EXPANDED
from .physical_wire import digest


def replay_coordination_decisions(sidecar,policy):
    """Exact one-step assignments and state-only events, no predicted match outcomes."""
    assignments=state_events=0;windows={i:0 for i in range(3)}
    for frame in iter_coordination_frames(sidecar):
        for tx in frame['transactions']:
            prior=CoordinationState.from_dict(tx['prior_state']);kind=tx['type']
            if kind=='assignment':
                x=dict(tx['input']);x['ball_100ms']=Point(*x['ball_100ms'])
                x['players']=tuple(Player(**{**p,'position':Point(*p['position']),
                    'formation':Point(*p['formation']) if p['formation'] is not None else None}) for p in x['players'])
                x['threat_ids']=tuple(x['threat_ids']);x['quality']=tuple(tuple(row) for row in x['quality'])
                actual=policy.coordinate(CoordinationInput(**x),prior)
                if actual!=CoordinationDecision.from_dict(tx['decision']):raise ValueError('Native assignment does not replay exactly')
                assignments+=1;windows[frame['native']['window']]+=1
            elif kind=='override':
                # K1V1's state-only override branch ignores its input header.
                # No Q, formation or earlier native input is reconstructed here.
                ignored=CoordinationInput(tx['physics_ms'],tx['period'],tx['team'],tx['dynamic_side'],(),(),(),Point())
                result=policy._run(encode_request(ignored,prior,override=(tx['player'],tx['physics_ms'],tx['kind'])))
                if not result['valid'] or CoordinationState.from_dict(result['state'])!=CoordinationState.from_dict(tx['state']):raise ValueError('Native override does not replay exactly')
                state_events+=1
            elif kind=='context':
                owned=bool(prior.marks or prior.cover_id>=0 or prior.hunts)
                changed=(prior.period,prior.dynamic_side)!=(tx['period'],tx['dynamic_side'])
                if not changed and (tx['eligible'] or not owned):raise ValueError('Native context reset has no cause')
                expected=CoordinationState(time_ms=tx['physics_ms'],period=tx['period'],team=tx['team'],dynamic_side=tx['dynamic_side'])
                if expected!=CoordinationState.from_dict(tx['state']):raise ValueError('Native context state does not replay exactly')
                state_events+=1
            else:raise ValueError('Unknown native transaction')
    return dict(exact_transactions=assignments,state_events=state_events,assignments_per_window={str(k):v for k,v in windows.items()},
        empty_assignment_windows=[k for k,v in windows.items() if not v],counterfactual_outcomes=False)


def measure_coordination_result(result,*,seconds,peak_private_bytes,profile,policy,sidecar_info):
    if load_coordination_profile(profile.project)!=profile:raise ValueError('Measured K1 profile changed')
    manifest=result.manifest;identity=policy['identity'];run_id=identity['run_id'];mode='observe' if run_id=='K-observe-42' else 'apply'
    request=request_for_run(profile,run_id)
    expected=dict(run_id=run_id,input_hash=request.input_hash,native_sha256=profile.native_sha256,
        profile_identity=profile.identity,build_manifest_sha256=profile.build_manifest_sha256)
    validate_coordination_policy(policy,expected,mode,manifest.trace_hash)
    if (manifest.input!=request or manifest.native_binary_sha256!=profile.native_sha256 or
        type(seconds) not in (int,float) or not math.isfinite(seconds) or not 0<=seconds<=600 or
        type(peak_private_bytes) is not int or not 0<peak_private_bytes<=512*1024*1024 or
        sidecar_info['trace_hash']!=manifest.trace_hash or sidecar_info['frames']!=303 or
        not 0<=sidecar_info['transactions']<=400 or not 0<sidecar_info['bytes']<=MAX_SIDECAR or
        not 0<sidecar_info['expanded_bytes']<=MAX_EXPANDED):raise ValueError('K1 measurement identity/resources/sidecar')
    summary=build_action_statistics(manifest,result.chunks(),_research_native_sha256=profile.native_sha256)
    diagnostic=diagnose_actions(manifest,result.chunks(),summary)
    defense=diagnose_defense(manifest,result.chunks(),summary,diagnostic)
    classification=classify_goals(manifest,diagnostic,defense)
    split='observe' if mode=='observe' else run_id.split('/')[1];fixture='01' if mode=='observe' else run_id.split('/')[2]
    return dict(status='ready',split=split,fixture_id=fixture,candidate_id='k1',profile_identity=profile.identity,input_hash=request.input_hash,
        native_binary_sha256=profile.native_sha256,trace_hash=manifest.trace_hash,seconds=seconds,peak_private_bytes=peak_private_bytes,
        duration_ms=manifest.duration_ms,effective_minutes=summary.effective_ms/60000,score=list(summary.score),goals=sum(summary.score),
        shots=sum(t.shots for t in summary.team_actions),passes=sum(t.passes for t in summary.team_actions),
        clearances=sum(t.clearances for t in summary.team_actions),releases=summary.classification.releases,
        classified_releases=summary.classification.classified_releases,release_ratio=summary.classification.release_ratio,
        player_coverage=[p.coverage for p in summary.players],
        outfield_km=[p.distance_m/1000 if p.distance_m is not None else None for p in summary.players if p.role!='GK'],
        role_distances_km={role:[p.distance_m/1000 if p.distance_m is not None else None for p in summary.players if p.role==role]
            for role in sorted({p.role for p in summary.players})},players=[p.model_dump(mode='json') for p in summary.players],
        policy_counters=policy['base_final']['counters'],policy_valid=True,coordination_counters=policy['coordination_final']['counters'],
        coordination_valid=True,coordination_state_origin='isolated_native_shadow' if mode=='observe' else 'native_assignment_transaction',
        sidecar=sidecar_info,**classification,
        _analysis={'summary.json':summary.model_dump(mode='json'),'actions-diagnostic.json':diagnostic,'defense-diagnostic.json':defense})


def observe_equivalence(evidence,profile):
    if load_coordination_profile(profile.project)!=profile:raise ValueError('Observation profile changed')
    control=RetainedResult(profile.project/'.local/grf-physical-work/continuation/evidence/c4/calibration/01');observed=RetainedResult(evidence)
    common=compare_defensive_capture(control,observed,_readbacks_by_identity=True)
    identity=dict(run_id='K-observe-42',input_hash=observed.manifest.input.input_hash,native_sha256=profile.native_sha256,
        profile_identity=profile.identity,build_manifest_sha256=profile.build_manifest_sha256)
    sidecar=Path(evidence)/'coordination.jsonl'
    transport=validate_coordination_sidecar(sidecar,identity,'observe',observed.manifest.trace_hash,
        expected_rows=(row for chunk in observed.chunks() for row in chunk.samples))
    build=read(profile.project/STUDY/'k1-replay-build.json');pure=CppPolicy(profile.project/build['executable'])
    if pure.sha256!=build['executable_sha256']:raise ValueError('Frozen pure replay executable changed')
    replay=replay_coordination_decisions(sidecar,pure)
    if replay['exact_transactions']<=0:raise ValueError('No exact native assignment exercise; observation cannot qualify')
    return dict(equivalent=True,**common,**replay,transport=transport,profile_identity=profile.identity,
        native_sha256=profile.native_sha256,sidecar_sha256=sha(sidecar))
