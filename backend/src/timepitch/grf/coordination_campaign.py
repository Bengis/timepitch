"""Prepared K1 scheduler. Real execution requires the separate Phase5 grant."""
import argparse
import json
import math
import os
from pathlib import Path
import threading
import time

from .coordination_profile import PROJECT_ROOT,DESCRIPTOR,RUN_ROOT,load_coordination_profile,sha,read
from .coordination_budget import CoordinationLedger,_exclusive
from .coordination_process import CoordinationProcess,request_for_run
from .coordination_wire import COUNTERS,coordination_state
from .action_gates import evaluate_action_gates
from .physical_wire import canonical,digest
from .process import GrfCancelled
from . import physical_campaign_budget as original


def evaluate_coordination_gates(rows,*,expected):
    gates=evaluate_action_gates(rows,expected=expected,_research_candidate_id='k1');valid=True
    try:
        for r in rows:
            c=r['coordination_counters']
            valid=valid and r['candidate_id']=='k1' and r['coordination_valid'] is True and set(c)==set(COUNTERS)
            valid=valid and all(type(v) is int and 0<=v<2**63 for v in c.values()) and c['invariant_violations']==0
            valid=valid and c['cover_requested']<=c['assignments'] and c['holds']+c['handovers']<=3*c['assignments']
        exercise=expected==24 or all(sum(r['coordination_counters'][k] for r in rows)>0 for k in ('assignments','holds','handovers','handover_rejections','cover_requested'))
    except (KeyError,TypeError):valid=exercise=False
    return dict(**gates,coordination=bool(gates['all_completed'] and valid),coordination_exercise=bool(gates['all_completed'] and valid and exercise))


def _verify_report(store,stage):
    n=8 if stage=='calibration' else 24;rows=[store.ready_row(f'k1/{stage}/{i:02}') for i in range(1,n+1)]
    value=read(store.root/f'reports/{stage}.json');gates=evaluate_coordination_gates(rows,expected=n)
    if value['rows']!=rows or value['gates']!=gates or value['qualified']!=all(gates.values()) or value['profile_identity']!=store.profile.identity:
        raise ValueError('Frozen campaign report changed')
    return value


def execute_stage(store,profile,stage,*,factory,measure,observe):
    """Testable scheduling with real durable ledger transitions and an injected child."""
    store.assert_stage(stage)
    if stage=='heldout':store.seal_selection(_verify_report(store,'calibration'));store.verify_selection()
    if stage in ('calibration','heldout') and (store.root/f'reports/{stage}.json').exists():return _verify_report(store,stage)
    ids=['K-observe-42'] if stage=='observe' else [f'k1/{stage}/{i:02}' for i in range(1,(8 if stage=='calibration' else 24)+1)]
    values=[]
    for id in ids:
        if load_coordination_profile(profile.project)!=profile:raise ValueError('Profile changed before reservation')
        if stage=='heldout':store.verify_selection()
        request=request_for_run(profile,id);reservation=store.reserve(id,request)
        if reservation.reused:values.append(store.ready_row(id));continue
        evidence=store.root/'evidence'/id;evidence.mkdir(parents=True,exist_ok=True)
        runner=result=None;start=time.monotonic()
        try:
            runner=factory(profile,root=store.root,run_id=id)  # Reservation exists before any capability or import.
            result=runner.run(request,threading.Event())
            value=measure(result,seconds=time.monotonic()-start,peak_private_bytes=runner.peak_private_bytes,
                profile=profile,policy=runner.policy,sidecar_info=runner.sidecar_info)
            for name,data in value.pop('_analysis',{}).items():_exclusive(evidence/name,data)
            _exclusive(evidence/'measurement.json',value);store.finish(id,state='ready');values.append(value)
        except BaseException as error:
            failure=dict(type=type(error).__name__,message=str(error)[-2000:],seconds=time.monotonic()-start,
                peak_private_bytes=getattr(runner,'peak_private_bytes',None),last_received_physics_ms=getattr(runner,'last_received_physics_ms',None),
                stderr=bytes(getattr(runner,'diagnostic_stderr',b'')).decode('utf-8',errors='replace')[-6000:])
            _exclusive(evidence/'failure.json',failure);store.finish(id,state='cancelled' if isinstance(error,GrfCancelled) else 'failed');raise
        finally:
            if result:result.close()
            if runner:runner.close()
    if stage=='observe':
        try:proof=observe(store.root/'evidence/K-observe-42',profile);store.accept_observation(proof)
        except BaseException as error:store.reject_observation(error);raise
        return dict(stage='observe',proof=proof,rows=values,profile_identity=profile.identity)
    gates=evaluate_coordination_gates(values,expected=len(ids))
    value=dict(schema_version='grf-coordination-campaign-report-1',candidate_id='k1',stage=stage,profile_identity=profile.identity,
        rows=values,gates=gates,qualified=all(gates.values()),publication='research-only-no-web-promotion')
    if stage=='calibration':
        baseline=read(profile.project/'.local/grf-physical-work/continuation/reports/c4-calibration.json')
        value['paired_k1_minus_c4']=[dict(fixture_id=a['fixture_id'],**{k:a[k]-b[k] for k in ('goals','shots','passes','effective_minutes')})
            for a,b in zip(values,baseline['rows'])]
    _exclusive(store.root/f'reports/{stage}.json',value);return _verify_report(store,stage)


def run_coordination_campaign(descriptor,root,*,stage):
    if os.getenv('TIMEPITCH_TEST_GRF_COORDINATION')!='1':raise ValueError('Explicit K1 research opt-in and linked approval required')
    profile=load_coordination_profile(PROJECT_ROOT);value=read(PROJECT_ROOT/DESCRIPTOR)
    if isinstance(descriptor,(str,Path)):
        if Path(descriptor).resolve()!=(PROJECT_ROOT/DESCRIPTOR).resolve():raise ValueError('Canonical coordination descriptor required')
        descriptor=read(descriptor)
    if descriptor!=value or Path(root).resolve()!=(PROJECT_ROOT/RUN_ROOT).resolve():raise ValueError('Canonical descriptor/root required')
    store=CoordinationLedger(root,profile)
    from .coordination_measurement import measure_coordination_result,observe_equivalence
    with original._lock(store.root.parent/'continuation-action-execution.json'):
        return execute_stage(store,profile,stage,factory=CoordinationProcess,measure=measure_coordination_result,observe=observe_equivalence)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--descriptor',type=Path,required=True);parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--stage',choices=('observe','calibration','heldout'),required=True);args=parser.parse_args()
    report=run_coordination_campaign(args.descriptor,args.root,stage=args.stage);print(json.dumps(report,sort_keys=True))
if __name__=='__main__':main()
