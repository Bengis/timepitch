"""Frozen, resumable native activity experiment. No rerolls or extrapolation."""
import argparse
from collections import Counter,defaultdict
import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import threading
import time
from .physical_wire import canonical,digest
from .physical_statistics import build_physical_statistics
from .physical_models import ActivitySettings,ACTIVITY_NATIVE_SHA256
from .physical_process import ActivityProcess
from .input import make_activity_input
from ..catalog.repository import CatalogRepository
from ..simulation.models import MatchConfig

ROOT=Path(__file__).resolve().parents[4]
MATCHUPS=(('arsenal:2003','mancity:2017'),('arsenal:2003','arsenal:2003'),
          ('arsenal:1992','mancity:2017'),('arsenal:2025','mancity:2024'))
CRITERIA=dict(coverage_min=.95,outfield_mean_km=[8,14],outfield_p95_max_km=16,effective_mean_minutes=[45,70],
    goals_mean=[1.5,4.5],max_over_nine_goals=1,shots_mean=[12,50],passes_mean=[400,1500])


def _write(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_bytes(canonical(value));temporary.replace(path)


def experiment_identity(manifest):
    return digest({k:v for k,v in manifest.items() if k not in ('split','candidate','candidates')})


def bind_candidate(checkpoint,candidate):
    value=digest(candidate)
    bindings=checkpoint['candidate_bindings'];key=candidate['id']
    if key in bindings and bindings[key]!=value:raise ValueError('Measured candidate changed')
    if key not in bindings and len(bindings)>=3:raise ValueError('Candidate budget exhausted')
    bindings[key]=value


def evaluate_gates(rows,*,expected):
    ready=[r for r in rows if r['status']=='ready']
    complete=len(rows)==expected and len(ready)==expected
    def mean(key):return statistics.fmean(r[key] for r in ready) if ready else math.inf
    distances=sorted(d for r in ready for d in r['outfield_km'])
    p95=distances[math.ceil(.95*len(distances))-1] if distances else math.inf
    return dict(all_completed=complete,
        coverage=complete and all(c is not None and c>=.95 for r in ready for c in r['player_coverage']),
        distance_mean=complete and bool(distances) and 8<=statistics.fmean(distances)<=14,
        distance_p95=complete and p95<=16,
        effective_time=complete and 45<=mean('effective_minutes')<=70,
        goals=complete and 1.5<=mean('goals')<=4.5,
        extreme_scores=complete and sum(r['goals']>9 for r in ready)<=1,
        shot_contacts=complete and 12<=mean('shot_contacts')<=50,
        pass_contacts=complete and 400<=mean('pass_contacts')<=1500)


def validate_benchmark(manifest):
    if manifest.get('schema_version')!='grf-activity-benchmark-1':raise ValueError('Unknown benchmark')
    if manifest.get('criteria')!=CRITERIA or manifest.get('limits')!={'max_candidates':3,'max_native_matches':48}:
        raise ValueError('Unfrozen experiment criteria or budget')
    for split,pairs,seeds in (('calibration',MATCHUPS[:2],(42,43)),('heldout',MATCHUPS,(101,202,303))):
        expected={(h,a,f,s) for h,a in pairs for f in ('4-4-2','4-3-3') for s in seeds}
        actual=set();ids=set()
        for fixture in manifest[split]:
            config=MatchConfig.model_validate(fixture['config'])
            if config.home_formation!=config.away_formation:raise ValueError('Unfrozen formation')
            actual.add((config.home_key,config.away_key,config.home_formation,config.seed));ids.add(fixture['id'])
        if actual!=expected or len(ids)!=len(expected) or len(manifest[split])!=len(expected):
            raise ValueError('Unfrozen benchmark fixtures')
    if not 1<=len(manifest['candidates'])<=3:raise ValueError('Candidate budget exceeded')
    ids=[c['id'] for c in manifest['candidates']]
    if len(ids)!=len(set(ids)) or any(c not in ('c1','c2','c3') for c in ids):raise ValueError('Invalid candidate identity')
    for c in manifest['candidates']:ActivitySettings.model_validate(c['settings'])


def _measure(result,runner,seconds):
    summary=build_physical_statistics(result.manifest,result.chunks())
    contacts=Counter();activity=Counter();fatigue={};period_geometry=defaultdict(lambda:defaultdict(float));previous=None
    for block in result.chunks():
        for event in block.events:
            if event.type=='touch':contacts[(event.phase,event.kind)]+=1
        for row,codes in zip(block.samples,block.activity):
            if previous is not None and row[1]-previous[1]==100 and row[2]==previous[2] and not row[7] and row[19]==previous[19]:
                for i,p in enumerate(result.manifest.input.players):
                    # Catalogue order is not a native slot index.
                    n=p.slot+(11 if p.side=='away' else 0);offset=21+n*6
                    if row[offset+4] and previous[offset+4]:
                        d=math.hypot(row[offset]-previous[offset],row[offset+1]-previous[offset+1])
                        if d<=2+1e-7:period_geometry[int(row[2])][p.id]+=d
                        activity[(int(row[2]),p.role,str(codes[n]))]+=100
            for i in range(22):
                key=(int(row[2]),i);factor=row[21+i*6+5]
                if key not in fatigue:fatigue[key]=[factor,factor,factor]
                else:fatigue[key][1]=factor;fatigue[key][2]=min(fatigue[key][2],factor)
            previous=row
    outfield=[p.distance_m/1000 for p in summary.players if p.role!='GK' and p.distance_m is not None]
    roles={role:[p.distance_m/1000 if p.distance_m is not None else None for p in summary.players if p.role==role]
           for role in {p.role for p in summary.players}}
    shots=sum(v for (phase,kind),v in contacts.items() if kind=='shot')
    passes=sum(v for (phase,kind),v in contacts.items() if kind in ('short_pass','long_pass','high_pass'))
    return dict(status='ready',trace_hash=result.manifest.trace_hash,input_hash=result.manifest.input.input_hash,
        native_binary_sha256=result.manifest.native_binary_sha256,seconds=seconds,peak_private_bytes=runner.peak_private_bytes,
        score=list(summary.score),goals=sum(summary.score),effective_minutes=summary.effective_ms/60000,
        duration_ms=summary.duration_ms,outfield_km=outfield,role_distances_km=roles,
        player_coverage=[p.coverage for p in summary.players],shot_contacts=shots,pass_contacts=passes,
        contacts_by_period={str(phase):{kind:value for (p,kind),value in contacts.items() if p==phase} for phase in (1,2)},
        activity_ms=[dict(period=p,role=role,state=state,ms=ms) for (p,role,state),ms in sorted(activity.items())],
        period_distance_m={str(p):dict(values) for p,values in period_geometry.items()},
        fatigue=[dict(period=p,slot_index=i,start=values[0],end=values[1],minimum=values[2]) for (p,i),values in fatigue.items()],
        players=[p.model_dump() for p in summary.players])


def run_benchmark(manifest:dict,output_dir:Path)->dict:
    output_dir=Path(output_dir);output_dir.mkdir(parents=True,exist_ok=True)
    lock=output_dir/'benchmark.lock'
    descriptor=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    try:
        os.write(descriptor,str(os.getpid()).encode())
        return _run_benchmark(manifest,output_dir)
    finally:
        os.close(descriptor);lock.unlink()


def _run_benchmark(manifest:dict,output_dir:Path)->dict:
    validate_benchmark(manifest)
    split=manifest.get('split','calibration');candidate_id=manifest.get('candidate','c1')
    if split not in ('calibration','heldout'):raise ValueError('Unknown split')
    candidate=next(c for c in manifest['candidates'] if c['id']==candidate_id)
    settings=ActivitySettings.model_validate(candidate['settings'])
    identity=experiment_identity(manifest)
    checkpoint_path=output_dir/'checkpoint.json'
    checkpoint=json.loads(checkpoint_path.read_text()) if checkpoint_path.exists() else dict(identity=identity,runs=[],candidate_bindings={})
    if checkpoint['identity']!=identity:raise ValueError('Benchmark manifest changed after measurement')
    freeze_path=output_dir/'freeze.json'
    if freeze_path.exists():
        frozen=json.loads(freeze_path.read_text())
        if (split!='heldout' or frozen['identity']!=identity or frozen['candidate']!=candidate_id or
            frozen['settings']!=settings.model_dump() or frozen['native_binary_sha256']!=ACTIVITY_NATIVE_SHA256):
            raise ValueError('Experiment frozen; only its held-out candidate may resume')
    elif any('/heldout/' in run['key'] for run in checkpoint['runs']):
        raise ValueError('Missing freeze for a started held-out experiment')
    bind_candidate(checkpoint,candidate)
    _write(checkpoint_path,checkpoint)
    catalog_path=ROOT/manifest['dataset']
    if hashlib.sha256(catalog_path.read_bytes()).hexdigest()!=manifest['dataset_sha256']:raise ValueError('Catalogue changed')
    catalog=CatalogRepository(catalog_path)
    # Validate every held-out lineup before seeing any results.
    for name in ('calibration','heldout'):
        for fixture in manifest[name]:
            request=make_activity_input(MatchConfig.model_validate(fixture['config']),catalog,settings)
            if digest(request.model_dump(exclude={'settings','input_hash'}))!=fixture['catalogue_hash']:
                raise ValueError('Frozen catalogue/lineup mismatch')
    python=ROOT/manifest['python'];native=ROOT/candidate['native_dir']
    runner=ActivityProcess(python,native)
    if not runner.capability().available:raise ValueError('Pinned activity native unavailable')
    if split=='heldout':
        calibration=output_dir/f'{candidate_id}-calibration-report.json'
        prior=json.loads(calibration.read_text())
        if prior['identity']!=identity or not all(prior['gates'].values()):raise ValueError('Calibration gates failed; held-out remains sealed')
        frozen=dict(identity=identity,candidate=candidate_id,settings=settings.model_dump(),native_binary_sha256=ACTIVITY_NATIVE_SHA256,
                    calibration_report_sha256=hashlib.sha256(calibration.read_bytes()).hexdigest())
        freeze=output_dir/'freeze.json'
        if freeze.exists() and json.loads(freeze.read_text())!=frozen:raise ValueError('Held-out parameters already frozen')
        _write(freeze,frozen)
    selected=[]
    try:
        for fixture in manifest[split]:
            key=f'{candidate_id}/{split}/{fixture["id"]}'
            existing=next((r for r in checkpoint['runs'] if r['key']==key),None)
            if existing:
                if existing['status']=='running':existing.update(status='failed',error='interrupted_without_reroll');_write(checkpoint_path,checkpoint)
                selected.append(existing);continue
            if len(checkpoint['runs'])>=48:raise ValueError('Native match budget exhausted')
            request=make_activity_input(MatchConfig.model_validate(fixture['config']),catalog,settings)
            record=dict(key=key,status='running',input_hash=request.input_hash)
            checkpoint['runs'].append(record);_write(checkpoint_path,checkpoint)
            print(f'START {key} ({len(checkpoint["runs"])}/48)',flush=True)
            start=time.monotonic();result=None
            try:
                result=runner.run(request,threading.Event())
                record.update(_measure(result,runner,time.monotonic()-start))
            except Exception as error:
                record.update(status='failed',error=getattr(error,'code',type(error).__name__),seconds=time.monotonic()-start)
                (output_dir/f'{candidate_id}-{split}-{fixture["id"]}-diagnostic.txt').write_text(
                    str(error)+'\n'+getattr(runner,'diagnostic_stderr',b'').decode('utf8',errors='replace')[-6000:],encoding='utf8')
            finally:
                if result:result.close()
                _write(checkpoint_path,checkpoint)
            selected.append(record)
            print(f'END {key}: {record["status"]}; goals={record.get("goals")}; distance_km={statistics.fmean(record["outfield_km"]) if record.get("outfield_km") else None}',flush=True)
    finally:runner.close()
    report=dict(schema_version='grf-activity-calibration-report-1',identity=identity,candidate=candidate_id,split=split,
        settings=settings.model_dump(),native_binary_sha256=ACTIVITY_NATIVE_SHA256,fixtures=selected,
        gates=evaluate_gates(selected,expected=len(manifest[split])),promoted=False,
        criteria_note='Project engineering criteria; passing does not establish Premier tactical or predictive realism.')
    _write(output_dir/f'{candidate_id}-{split}-report.json',report)
    return report


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--split',choices=('calibration','heldout'),default='calibration')
    parser.add_argument('--candidate',default='c1');parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();manifest=json.loads(args.manifest.read_text(encoding='utf8'))
    manifest.update(split=args.split,candidate=args.candidate)
    report=run_benchmark(manifest,args.output);print(json.dumps(report['gates']),flush=True)


if __name__=='__main__':main()
