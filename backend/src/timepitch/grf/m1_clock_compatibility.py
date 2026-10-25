"""Read-only clock replay against the archived oracle; no native execution path."""
from dataclasses import asdict, fields
import json
import math
from pathlib import Path
import sys
from types import ModuleType
import zlib

from .bounded_clock import BoundedClockState, BoundedObservation, advance_bounded_clock, POLICY
from .physical_clock import ClockState, ClockObservation, advance_clock
from .physical_wire import (CAUSES, COLUMNS, MAX_COMPRESSED, MAX_EXPANDED, MAX_SAMPLES,
                            MAX_TOTAL_COMPRESSED, MAX_TOTAL_EXPANDED, canonical, digest, unpack_samples)
from .m1_history import ARCHIVE, DESCRIPTOR, STUDY, artifact, sha, verify_tp058_archive, _read

_SCALARS=tuple(f.name for f in fields(ClockState) if f.name not in ('ledger','periods'))


def _view(state):
    return (tuple(getattr(state,n) for n in _SCALARS),
            tuple(tuple(vars(r).values()) for r in state.ledger),state.periods)


def compare_clock_rows(rows, *, complete, manifest=None, legacy_advance=advance_clock, legacy_state=None):
    old=legacy_state if legacy_state is not None else ClockState()
    live=ClockState();new=BoundedClockState();count=0;fallback=0;difference=None;error=None;last=None
    try:
        for row in rows:
            if len(row)!=len(COLUMNS) or any(not math.isfinite(x) for x in row[:21]) or any(x!=int(x) for x in row[:21]):
                raise ValueError('Invalid retained physical row')
            if row[0]!=count or any(row[i] not in (0,1) for i in (5,7,9,12)) or not 0<=row[10]<len(CAUSES):
                raise ValueError('Invalid retained sample identity/flag')
            values=dict(physics_ms=int(row[1]),period=int(row[2]),effective_ms=int(row[4]),in_play=bool(row[5]),
                restart_id=int(row[8]),restart_active=bool(row[9]),restart_cause=CAUSES[int(row[10])],
                restart_start_ms=int(row[11]),pending_penalty=bool(row[12]),discontinuity=bool(row[7]))
            old=legacy_advance(old,ClockObservation(**values));live=advance_clock(live,ClockObservation(**values))
            decision=advance_bounded_clock(new,BoundedObservation(**values,relocation_id=int(row[19])))
            new=decision.state;count+=1;last=int(row[1])
            fallback+=int(decision.close is not None and decision.close.reason=='bounded_open_play')
            if (_view(old)!=_view(live) or _view(old)!=_view(new) or row[3]!=old.period_elapsed_ms) and difference is None:
                difference=dict(sample_index=int(row[0]),physics_ms=last,kind='clock-state-or-closure-changed')
            if count>MAX_SAMPLES:raise ValueError('Retained sample limit')
        if complete and not (old.finished and live.finished and new.finished):raise ValueError('Incomplete saved control')
        if manifest is not None:
            if (manifest['duration_ms']!=last or list(old.periods)!=manifest['periods'] or
                [asdict(r) for r in old.ledger]!=manifest['ledger']):raise ValueError('Saved manifest clock differs')
    except (ValueError,TypeError,KeyError,IndexError,OverflowError) as e:
        error=str(e)
    return dict(compatible=difference is None and error is None and fallback==0,samples=count,
        last_physics_ms=last,finished=new.finished,fallback_count=fallback,first_difference=difference,error=error,
        final_clock=dict(physics_ms=new.physics_ms,period=new.period,period_elapsed_ms=new.period_elapsed_ms,
            effective_ms=new.effective_ms,allowance_ms=new.allowance_ms,announced_minimum_ms=new.announced_minimum_ms,
            target_ms=new.target_ms,deadline_ms=new.deadline_ms,penalty_protected=new.penalty_protected),
        periods=list(new.periods),ledger=[asdict(r) for r in new.ledger])


def _archived_clock(root):
    name='_timepitch_tp058_original_clock'
    path=artifact(root,ARCHIVE+'/source/backend/src/timepitch/grf/physical_clock.py')
    module=ModuleType(name);module.__file__=str(path);sys.modules[name]=module
    # Source is hash-verified by the archive gate. Compile in memory so the
    # oracle cannot create __pycache__ inside immutable evidence.
    try:exec(compile(path.read_bytes(),str(path),'exec'),module.__dict__)
    except BaseException:
        sys.modules.pop(name,None);raise
    return module


def _retained_rows(folder,hashes,manifest):
    names={name for name in hashes if name.endswith('.zlib')}
    if not names or names!={f'{i}.zlib' for i in range(len(names))}:raise ValueError('Retained block membership/sequence')
    if {p.name for p in folder.glob('*.zlib')}!=names:raise ValueError('Unexpected retained block')
    refs=manifest['chunks'] if manifest else None
    if refs is not None and len(refs)!=len(names):raise ValueError('Retained manifest block count')
    compressed=expanded=0
    for i in range(len(names)):
        name=f'{i}.zlib';path=artifact(folder,name)
        if path.stat().st_size>MAX_COMPRESSED or sha(path)!=hashes[name]:raise ValueError('Retained block bytes changed')
        raw=path.read_bytes();decoder=zlib.decompressobj();data=decoder.decompress(raw,MAX_EXPANDED+1)
        if len(data)>MAX_EXPANDED or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError('Retained block expansion bound')
        compressed+=len(raw);expanded+=len(data)
        if compressed>MAX_TOTAL_COMPRESSED or expanded>MAX_TOTAL_EXPANDED:raise ValueError('Retained replay bound')
        block=unpack_samples(json.loads(data))
        if block['index']!=i or block['columns']!=list(COLUMNS):raise ValueError('Retained block index/columns')
        if refs is not None and (refs[i]['index']!=i or refs[i]['samples']!=len(block['samples']) or
            refs[i]['physics_start']!=block['samples'][0][1] or refs[i]['physics_end']!=block['samples'][-1][1] or
            refs[i]['compressed_bytes']!=len(raw) or refs[i]['expanded_bytes']!=len(data)):
            raise ValueError('Retained block reference differs')
        yield from block['samples']


def audit_saved_clocks(project):
    """Fixed inventory: twelve complete controls and failed03's retained prefix."""
    root=Path(project).resolve()
    report=dict(schema_version='m1-clock-compatibility-1',status='blocked',clock_policy=POLICY,
        native_attempts_created=0,heldout_outcomes_read=0,complete_controls=[],failed_prefix={},errors=[])
    try:
        archive=verify_tp058_archive(root);oracle=_archived_clock(root)
        report['archive']=asdict(archive)
        report['source_sha256']={n:sha(root/n) for n in (
            'backend/src/timepitch/grf/physical_clock.py','backend/src/timepitch/grf/bounded_clock.py',
            'backend/src/timepitch/grf/m1_clock_compatibility.py','backend/src/timepitch/grf/m1_history.py')}
        continuation=artifact(root,'.local/grf-physical-work/continuation/checkpoint.json')
        coordination=artifact(root,'.local/grf-physical-work/coordination/checkpoint.json')
        report['checkpoint_sha256']={p.relative_to(root).as_posix():sha(p) for p in (continuation,coordination)}
        old=_read(continuation)['runs'];k1=_read(coordination)['runs'];items=[]
        for run_id in ['T-control','T-actions','T-repeat']+[f'c4/calibration/{i:02}' for i in range(1,9)]:
            row=old[run_id]
            if row['state']!='ready':raise ValueError('Required saved control is not ready')
            e=row['evidence'];items.append((run_id,artifact(root,'.local/grf-physical-work/continuation/'+e['result_path']),e['files'],True))
        if k1['K-observe-42']['state']!='ready' or k1['k1/calibration/03']['state']!='failed':
            raise ValueError('Original K1 terminal history changed')
        for run_id,full in [('K-observe-42',True),('k1/calibration/03',False)]:
            e=k1[run_id]['evidence'];items.append((run_id,artifact(root,'.local/grf-physical-work/coordination/'+e['path']),e['files'],full))
        for run_id,folder,hashes,full in items:
            result=dict(run_id=run_id,path=folder.relative_to(root).as_posix(),input_sha256={})
            try:
                names=[n for n in hashes if n.endswith('.zlib')]+(['manifest.json'] if full else [])
                result['input_sha256']={n:hashes[n] for n in sorted(names)}
                if full and sha(folder/'manifest.json')!=hashes['manifest.json']:raise ValueError('Saved manifest bytes changed')
                manifest=_read(folder/'manifest.json') if full else None
                result.update(compare_clock_rows(_retained_rows(folder,hashes,manifest),complete=full,manifest=manifest,
                    legacy_advance=oracle.advance_clock,legacy_state=oracle.ClockState()))
                if not full and (result['samples']!=60000 or result['last_physics_ms']!=5999800 or result['finished']):
                    result.update(compatible=False,error='Failed03 retained prefix boundary differs')
            except (OSError,ValueError,KeyError,TypeError) as e: result.update(compatible=False,error=str(e))
            if full:report['complete_controls'].append(result)
            else:report['failed_prefix']=result
        if all(x['compatible'] for x in report['complete_controls']) and report['failed_prefix'].get('compatible'):
            report['status']='compatible'
        report['scope']='retained-calibration-controls-only;missing-failed03-observation-not-reproduced;no-native-equivalence'
    except (OSError,ValueError,KeyError,TypeError) as e:report['errors'].append(str(e))
    return report


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',type=Path,default=Path(__file__).resolve().parents[4])
    parser.add_argument('--write-report',action='store_true')
    args=parser.parse_args();report=audit_saved_clocks(args.project)
    if args.write_report:
        path=artifact(args.project,STUDY+'/clock-compatibility.json')
        with path.open('xb') as f:f.write(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False).encode()+b'\n')
    print(json.dumps(dict(status=report['status'],complete_controls=len(report['complete_controls']),
                         prefix_samples=report['failed_prefix'].get('samples'),errors=report['errors'])))
    return 0 if report['status']=='compatible' else 1


if __name__=='__main__':raise SystemExit(main())
