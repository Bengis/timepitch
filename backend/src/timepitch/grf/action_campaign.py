"""Execute fixed research splits through the original durable campaign budget."""
import argparse
from dataclasses import asdict
import json
import math
import os
from pathlib import Path
import statistics
import threading
import time
from . import physical_campaign_budget as budget
from .candidate_profiles import (STUDY,CAMPAIGN,load_candidate_profile,bind_candidate_profile,intervention,plain)
from .candidate_process import CandidateProcess,request_for_run
from .candidate_wire import validate_policy,MAX_POLICY_BYTES
from .action_gates import evaluate_action_gates,c5_eligibility
from .action_statistics import build_action_statistics
from .action_diagnostics import diagnose_actions
from .defensive_diagnostics import diagnose_defense
from .action_validation import RetainedResult
from .physical_wire import canonical,digest
from .process import GrfCancelled


def _require_native_authorization():
    if os.getenv('TIMEPITCH_TEST_GRF_INTERVENTION')!='1':raise ValueError('Explicit intervention execution opt-in required')


def classify_goals(manifest,diagnostic,defense):
    """Count only linked penalty goals with semantic, restart and native foul proof."""
    by_raw={r['raw_event_seq']:r for r in defense['shots']};penalties=[];open_play=own=other=unknown=0
    for goal in diagnostic['goals']['events']:
        if goal['own_goal']:own+=1;continue
        shot=by_raw.get(goal['linked_release_raw_seq'])
        if shot is None or not shot['goal'] or shot['semantic_seq']!=goal['linked_release_semantic_seq']:
            unknown+=1;continue
        if shot['phase_class']=='open_play':open_play+=1;continue
        if shot['phase_class']=='penalty':
            foul=shot.get('penalty_foul');prepared=shot.get('penalty_prepared_raw_seq')
            restarts=[r for r in manifest.ledger if foul is not None and r.cause=='penalty' and
                r.period==goal['period'] and r.start==foul['physics_ms']]
            if (foul is not None and prepared is not None and foul.get('accepted_raw_seq') is not None and len(restarts)==1):
                penalties.append(dict(goal_raw_seq=goal['raw_seq'],release_raw_seq=goal['linked_release_raw_seq'],
                    release_semantic_seq=goal['linked_release_semantic_seq'],restart_id=restarts[0].id,
                    prepared_raw_seq=prepared,sanctioned_raw_seq=foul['sanctioned_raw_seq'],accepted_raw_seq=foul['accepted_raw_seq']))
                continue
        if shot['phase_class']=='other_set_piece_or_unknown' and shot['restart_kind'] not in ('none','penalty'):
            other+=1
        else:unknown+=1
    goals=sum(manifest.score)
    return dict(penalty_goals=len(penalties),penalty_goal_evidence=penalties,open_play_goals=open_play,own_goals=own,
        other_set_piece_goals=other,unknown_goals=unknown,
        goal_classification_complete=diagnostic['goals']['scoreboard_agrees'] and goals==len(penalties)+open_play+own+other and unknown==0,
        penalties_awarded=len({r.id for r in manifest.ledger if r.cause=='penalty'}))


def measure_action_result(result,*,seconds:float,peak_private_bytes:int,profile,policy:dict)->dict:
    fresh=load_candidate_profile(budget.PROJECT_ROOT,profile.id)
    if fresh!=profile:raise ValueError('Measured profile changed')
    manifest=result.manifest;identity=policy['identity'];request=request_for_run(profile,identity['run_id'])
    expected=dict(run_id=identity['run_id'],input_hash=request.input_hash,native_sha256=profile.native_sha256,
        profile_identity=profile.identity,build_manifest_sha256=profile.build_manifest_sha256)
    if (manifest.input!=request or manifest.native_binary_sha256!=profile.native_sha256 or
        len(canonical(policy))>MAX_POLICY_BYTES or type(seconds) not in (int,float) or not math.isfinite(seconds) or not 0<=seconds<=600 or
        type(peak_private_bytes) is not int or not 0<peak_private_bytes<=512*1024*1024):raise ValueError('Measurement identity/resources')
    validate_policy(policy,expected,profile.spec(),manifest.trace_hash)
    started=time.monotonic()
    summary=build_action_statistics(manifest,result.chunks(),_research_native_sha256=profile.native_sha256)
    diagnostic=diagnose_actions(manifest,result.chunks(),summary)
    defense=diagnose_defense(manifest,result.chunks(),summary,diagnostic)
    classification=classify_goals(manifest,diagnostic,defense)
    split,fixture_id=identity['run_id'].split('/')[1:]
    return dict(status='ready',split=split,fixture_id=fixture_id,candidate_id=profile.id,profile_identity=profile.identity,
        input_hash=request.input_hash,native_binary_sha256=profile.native_sha256,trace_hash=manifest.trace_hash,
        seconds=seconds,peak_private_bytes=peak_private_bytes,reduction_seconds=time.monotonic()-started,
        duration_ms=manifest.duration_ms,effective_minutes=summary.effective_ms/60000,score=list(summary.score),goals=sum(summary.score),
        shots=sum(c.shots for c in summary.team_actions),passes=sum(c.passes for c in summary.team_actions),
        clearances=sum(c.clearances for c in summary.team_actions),releases=summary.classification.releases,
        classified_releases=summary.classification.classified_releases,release_ratio=summary.classification.release_ratio,
        player_coverage=[p.coverage for p in summary.players],
        outfield_km=[p.distance_m/1000 if p.distance_m is not None else None for p in summary.players if p.role!='GK'],
        role_distances_km={role:[p.distance_m/1000 if p.distance_m is not None else None for p in summary.players if p.role==role]
            for role in sorted({p.role for p in summary.players})},
        players=[p.model_dump(mode='json') for p in summary.players],
        policy_counters=policy['final']['counters'],policy_valid=True,**classification,
        _analysis={'summary.json':summary.model_dump(mode='json'),'actions-diagnostic.json':diagnostic,'defense-diagnostic.json':defense})


def _row(root,state,profile,run_id):
    request=request_for_run(profile,run_id);entry=state['runs'].get(run_id)
    spec=budget.RunSpec(run_id,run_id.split('/')[1],request.input_hash,profile.native_sha256,7440000)
    if entry is None or entry['state']!='ready' or entry['spec']!=asdict(spec):raise ValueError('Complete ready evidence required; no rerun')
    evidence=budget._verify_evidence(root,entry['evidence'])
    if not {'manifest.json','measurement.json'}<=set(entry['evidence']['files']):raise ValueError('Measurement not bound to ready evidence')
    if evidence!=(root/'evidence'/run_id).resolve():raise ValueError('Run evidence outside its reserved ID')
    row=budget._read(evidence/'measurement.json')
    if (row['input_hash']!=request.input_hash or row['candidate_id']!=profile.id or row['profile_identity']!=profile.identity or
        row['native_binary_sha256']!=profile.native_sha256 or row['split']!=run_id.split('/')[1] or row['fixture_id']!=run_id.split('/')[2]):
        raise ValueError('Measured row binding changed')
    return row


def verified_report(root,candidate,*,_locked_state=None,split='calibration'):
    root,lock=budget._locations(root);profile=load_candidate_profile(budget.PROJECT_ROOT,candidate)
    if _locked_state is None:
        with budget._lock(lock):state=budget._load(root,lock)
    else:state=_locked_state
    label=candidate if split=='calibration' else 'selected';n=8 if split=='calibration' else 24
    report=budget._read(root/'reports'/f'{label}-{split}.json')
    rows=[_row(root,state,profile,f'{label}/{split}/{i:02}') for i in range(1,n+1)]
    gates=evaluate_action_gates(rows,expected=n)
    if (report.get('schema_version')!='grf-action-campaign-report-1' or report['candidate_id']!=candidate or
        report['split']!=split or report['profile_identity']!=profile.identity or report['rows']!=rows or
        report['gates']!=gates or report['qualified']!=all(gates.values()) or not gates['all_completed']):
        raise ValueError('Complete immutable campaign report changed')
    return report


def _selection_exists(root):
    return any(p.exists() for p in (root/'selection/freeze.json',root.parent/'continuation-selection-registration.json',root.parent/'continuation-selection-initialized.json'))


def run_action_campaign(manifest:dict,root:Path,*,split:str,candidate_id:str)->dict:
    _require_native_authorization();root,lock=budget._locations(root);project=budget.PROJECT_ROOT.resolve()
    descriptor,campaign=intervention(project)
    if manifest!=descriptor or (split,candidate_id) not in {('calibration','c4'),('calibration','c5'),('heldout','selected')}:
        raise ValueError('Use the canonical intervention and fixed split/candidate')
    # Serialize the entire native study, without holding/reentering the budget lock during child work.
    with budget._lock(root.parent/'continuation-action-execution.json'):
        from .action_selection import verify_frozen_selection
        if split=='calibration':
            with budget._lock(lock):opened=any('/heldout/' in id for id in budget._load(root,lock)['runs'])
            if opened:raise ValueError('Heldout already opened; calibration permanently closed')
            if _selection_exists(root):
                verify_frozen_selection(root);raise ValueError('Selection sealed; calibration closed')
            if candidate_id=='c5':
                c4=verified_report(root,'c4')
                if all(c4['gates'].values()):return dict(status='skipped_c4_qualified',candidate_id='c5',source_report_sha256=digest(c4))
                if not c5_eligibility(c4)['eligible']:raise ValueError('Fixed C5 screening failed')
                profile=bind_candidate_profile(project,'c5',root)
            else:profile=load_candidate_profile(project,'c4')
            label=profile.id;n=8
        else:
            selected=verify_frozen_selection(root);profile=load_candidate_profile(project,selected['candidate_id']);label='selected';n=24
        report_path=root/'reports'/f'{label}-{split}.json'
        if report_path.exists():return verified_report(root,profile.id,split=split)
        rows=[]
        for i in range(1,n+1):
            if load_candidate_profile(project,profile.id)!=profile:raise ValueError('Candidate changed before reservation')
            if split=='heldout':verify_frozen_selection(root)
            run_id=f'{label}/{split}/{i:02}';request=request_for_run(profile,run_id)
            reservation=budget.reserve_run(root,budget.RunSpec(run_id,split,request.input_hash,profile.native_sha256,7440000))
            if reservation.reused:
                with budget._lock(lock):state=budget._load(root,lock)
                rows.append(_row(root,state,profile,run_id));continue
            evidence=root/'evidence'/run_id;evidence.mkdir(parents=True,exist_ok=True)
            runner=result=None;start=time.monotonic()
            try:
                runner=CandidateProcess(profile,root=root,run_id=run_id)
                result=runner.run(request,threading.Event());seconds=time.monotonic()-start
                row=measure_action_result(RetainedResult(evidence),seconds=seconds,peak_private_bytes=runner.peak_private_bytes,profile=profile,policy=runner.policy)
                for name,value in row.pop('_analysis').items():(evidence/name).write_bytes(canonical(value))
                (evidence/'measurement.json').write_bytes(canonical(row))
                files={p.name:budget._sha(p) for p in evidence.iterdir() if p.is_file()}
                budget.finish_run(root,run_id,state='ready',evidence=dict(result_path=evidence.relative_to(root).as_posix(),files=files))
                rows.append(row)
            except BaseException as error:
                failure=dict(type=type(error).__name__,message=str(error)[-2000:],seconds=time.monotonic()-start,
                    peak_private_bytes=getattr(runner,'peak_private_bytes',None),last_received_physics_ms=getattr(runner,'last_received_physics_ms',None),
                    stderr=bytes(getattr(runner,'diagnostic_stderr',b'')).decode('utf-8',errors='replace')[-6000:])
                (evidence/'failure.json').write_bytes(canonical(failure))
                budget.finish_run(root,run_id,state='cancelled' if isinstance(error,GrfCancelled) else 'failed',
                    evidence=dict(result_path=evidence.relative_to(root).as_posix(),files={p.name:budget._sha(p) for p in evidence.iterdir() if p.is_file()}))
                raise
            finally:
                if result:result.close()
                if runner:runner.close()
        gates=evaluate_action_gates(rows,expected=n)
        report=dict(schema_version='grf-action-campaign-report-1',candidate_id=profile.id,split=split,profile_identity=profile.identity,
            rows=rows,gates=gates,qualified=all(gates.values()),publication='research-only-no-web-promotion',
            denominators=dict(matches=n,outfield_players=sum(len(r['outfield_km']) for r in rows),releases=sum(r['releases'] for r in rows)),
            policy_exercise={key:sum(r['policy_counters'][key] for r in rows) for key in rows[0]['policy_counters']},
            comparable_baseline='T-actions seed42 only; C1-C3 contact definitions differ')
        if split=='calibration' and profile.id=='c5':
            prior=verified_report(root,'c4')
            report['paired_c5_minus_c4']=[dict(fixture_id=a['fixture_id'],**{k:a[k]-b[k] for k in ('goals','penalty_goals','shots','passes','effective_minutes')})
                for a,b in zip(rows,prior['rows'])]
        report_path.parent.mkdir(exist_ok=True)
        with report_path.open('xb') as stream:stream.write(canonical(report));stream.flush();os.fsync(stream.fileno())
        if split=='calibration' and profile.id=='c4':
            screening=report_path.with_name('c4-c5-eligibility.json')
            with screening.open('xb') as stream:stream.write(canonical(c5_eligibility(report)));stream.flush();os.fsync(stream.fileno())
        return verified_report(root,profile.id,split=split)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--root',type=Path,required=True);parser.add_argument('--split',choices=['calibration','heldout'],required=True)
    parser.add_argument('--candidate',choices=['c4','c5','selected'],required=True);args=parser.parse_args()
    if args.manifest.resolve()!=(budget.PROJECT_ROOT/STUDY/'intervention.json').resolve():raise ValueError('Canonical manifest path required')
    report=run_action_campaign(budget._read(args.manifest),args.root,split=args.split,candidate_id=args.candidate)
    print(json.dumps({k:v for k,v in report.items() if k!='rows'},sort_keys=True))


if __name__=='__main__':main()
