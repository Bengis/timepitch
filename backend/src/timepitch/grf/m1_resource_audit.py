"""One-shot retained M1 diagnostic. Never authorizes or admits a native run."""
import builtins
from contextlib import contextmanager
from dataclasses import asdict,dataclass
import io
import math
import os
import platform
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

from . import m1_resource_history as history
from .m1_resource_history import verify_resource_archive
from .m1_resources import M1Budget,M1ResourceExceeded
from .m1_verifier import artifact,read,sha,RUN_ROOT
from .physical_wire import canonical,digest

STUDY=history.STUDY
RUN_ID='M-observe-42'
EVIDENCE_PROFILE='bd15b3499f08817503a3b91dc0ca18a9b7bf4705f5fd32115f75da5709702fb5'
COMMON_SHA='0f838382d5a1e79128f6b972a2c99004eb20bab1880de79cd7df6eda0b51815d'
SUMMARY_SHA='3323f06d50bcaec5bcb14156cf4916966ce5ac9181753efa64dd6cedce173d82'
REFERENCE_SHA='4ff15da1552b985b97aa0bf44ad74f9179fd9feb1f1f423bdf35a32a7262b57b'
DIAGNOSIS_SHA='514a456f5c181565713e5c068f5607f6ec49cd760f7037e55c72e6fb32bc2669'
PHASE1_DIGEST='f058a284d7585203470076e8c4f69b1b43632b0c36eeb8df89825db1ab970854'
PHASE2_DIGEST='e8896851f3228aab8e26f33f3c3dd011329865f3890326dcf97326fe799d2f4a'
AUDIT_SOURCE_ADDITIONS=('backend/src/timepitch/grf/m1_resource_audit.py','backend/tests/test_grf_m1_resource_audit.py')
REPORT_NAMES=('phase3-replay-audit.json','phase3-performance.json')
COUNTS=dict(blocks=60,samples=59557,events=9053,semantic_events=6269)
REFERENCE_SECONDS=95.016
TRIPLE_LIMIT_SECONDS=104.518
NATIVE_MODULES=('gfootball','gfootball_engine','_gameplayfootball')


@dataclass(frozen=True)
class AuditInputs:
    profile:object
    reference:dict
    history:dict
    source_sha256:dict
    protected_sha256:dict
    timeline:dict


def _clock():return time.perf_counter()


def _source_inventory(root,document):
    names=set(document['source_sha256'])|history.source_members(root,document)
    return {name:sha(artifact(root,name)) for name in sorted(names)}


def _reference(root):
    for name,h in (('offline-profile.json',REFERENCE_SHA),('diagnosis.json',DIAGNOSIS_SHA)):
        if sha(artifact(root,STUDY+'/'+name))!=h:raise ValueError('Changed pinned diagnostic reference')
    return read(artifact(root,STUDY+'/offline-profile.json')),read(artifact(root,STUDY+'/diagnosis.json'))


def _inputs(root,budget):
    state=verify_resource_archive(root);budget.checkpoint('capture_preflight')
    if state['live_missing']:raise ValueError('Missing current analysis sources')
    record=read(artifact(root,history.ARCHIVE+'/record.json'))
    document=read(artifact(root,history.ARCHIVE+'/metadata/'+history.DESCRIPTOR))
    if state['profile_identity']!=EVIDENCE_PROFILE:raise ValueError('Original evidence identity changed')
    reference,diagnosis=_reference(root)
    phase1=read(artifact(root,STUDY+'/phase1-acceptance.json'))
    phase2=read(artifact(root,STUDY+'/phase2-acceptance.json'))
    if digest(phase1)!=PHASE1_DIGEST or digest(phase2)!=PHASE2_DIGEST:
        raise ValueError('Approved implementation receipts changed')
    if phase1['phase']!=1 or phase1['native_authorized']:raise ValueError('Offline phase1 evidence required')
    if phase2['phase']!=2 or phase2['native_authorized'] or phase2['original_failed_attempt_admitted']:
        raise ValueError('Offline phase2 evidence required')
    expected={**document['source_sha256'],**phase1['source_sha256'],**phase2['source_sha256']}
    sources=_source_inventory(root,document)
    if set(sources)!=set(expected)|set(AUDIT_SOURCE_ADDITIONS):raise ValueError('Unapproved analysis source inventory')
    if any(sources[name]!=h for name,h in expected.items()):raise ValueError('Approved analysis implementation changed')
    protected={**record['metadata_sha256'],**record['evidence_sha256']}
    for name in ('offline-profile.json','diagnosis.json','phase1-acceptance.json','phase2-acceptance.json','source-binding.json'):
        relative=STUDY+'/'+name;protected[relative]=sha(artifact(root,relative))
    profile=SimpleNamespace(project=root,identity=EVIDENCE_PROFILE,native_sha256=document['native_sha256'],
        build_manifest_sha256=document['build_manifest_sha256'],document=document,payload=lambda key:document['payloads'][key])
    return AuditInputs(profile,reference,state,sources,protected,diagnosis['timeline'])


@contextmanager
def _offline_guard(root,output,blocks):
    """Guard the whole job, including helpers and imports. Restore on every exit."""
    if any(name.split('.')[0] in NATIVE_MODULES for name in sys.modules):raise ValueError('Fresh non-native process required')
    from .campaign_ledger import CampaignLedger
    patches=[]
    def install(owner,key,value):patches.append((owner,key,getattr(owner,key)));setattr(owner,key,value)
    def deny(kind):
        blocks[kind]+=1
        raise PermissionError('Offline audit forbids '+kind)
    original_import=builtins.__import__;original_open=builtins.open;original_io=io.open;original_path=Path.open
    def check(file,mode):
        if isinstance(file,int):
            if any(c in mode for c in 'wax+'):deny('write')
            return
        path=Path(os.fsdecode(file)).absolute()
        if 'heldout' in path.parts:deny('heldout')
        if any(c in mode for c in 'wax+'):
            relative=path.relative_to(root).as_posix() if path.is_relative_to(root) else ''
            allowed=REPORT_NAMES+tuple(name+'.pending' for name in REPORT_NAMES)
            if path.parent!=output or path.name not in allowed or not relative or artifact(root,relative)!=path:deny('write')
    def imported(name,*args,**kwargs):
        if name.split('.')[0] in NATIVE_MODULES:deny('native')
        return original_import(name,*args,**kwargs)
    def opened(file,mode='r',*args,**kwargs):check(file,mode);return original_open(file,mode,*args,**kwargs)
    def io_opened(file,mode='r',*args,**kwargs):check(file,mode);return original_io(file,mode,*args,**kwargs)
    def path_opened(file,mode='r',*args,**kwargs):check(file,mode);return original_path(file,mode,*args,**kwargs)
    class NoNative:
        def find_spec(self,name,path=None,target=None):
            if name.split('.')[0] in NATIVE_MODULES:deny('native')
            return None
    try:
        install(builtins,'__import__',imported);install(builtins,'open',opened);install(io,'open',io_opened)
        install(Path,'open',path_opened);install(subprocess,'Popen',lambda *a,**kw:deny('process'))
        install(CampaignLedger,'__init__',lambda *a,**kw:deny('ledger'))
        install(sys,'meta_path',[NoNative(),*sys.meta_path]);install(sys,'dont_write_bytecode',True)
        yield
    finally:
        for owner,key,value in reversed(patches):setattr(owner,key,value)


@contextmanager
def _instrument(telemetry):
    from . import physical_codec,action_validation
    from .action_codec import ActionStreamValidator
    # Capture both original aliases before replacing either; no double counting.
    targets=[(physical_codec,'decode_chunk','candidate'),(action_validation,'decode_chunk','control'),
        (ActionStreamValidator,'append','validator')]
    originals=[(owner,key,kind,getattr(owner,key)) for owner,key,kind in targets]
    def wrapper(fn,kind):
        def measured(*args,**kwargs):
            stage=telemetry['stages'][telemetry['active']];start=_clock()
            stage[kind+'_calls']+=1
            try:return fn(*args,**kwargs)
            finally:stage[kind+'_seconds']+=_clock()-start
        return measured
    try:
        for owner,key,kind,fn in originals:setattr(owner,key,wrapper(fn,kind))
        yield
    finally:
        for owner,key,kind,fn in reversed(originals):setattr(owner,key,fn)


def _retained(root,budget):
    from .m1_admission import RetainedM1Result
    return RetainedM1Result(artifact(root,RUN_ROOT+'/evidence/'+RUN_ID),budget)


def _evidence(result,launch):
    from .m1_admission import validate_evidence
    return validate_evidence(result,launch)


def _reduction(result,evidence,resources):
    from .m1_admission import measure_m1_result
    return measure_m1_result(result,evidence,resources)


def _comparison(profile,result,evidence,budget):
    from .m1_admission import _observation
    return _observation(profile,result,evidence,budget)


def _timed(name,fn,args,budget,telemetry,calls):
    telemetry['active']=name;calls[name]+=1;start=_clock();cpu=time.process_time()
    try:value=fn(*args)
    finally:
        telemetry['stages'][name].update(seconds=_clock()-start,cpu_seconds=time.process_time()-cpu)
    snapshot=budget.checkpoint('admission')
    telemetry['stages'][name]['parent_peak_private_bytes']=snapshot.parent_peak_private_bytes
    return value


def _correctness(result,evidence,row,proof,inputs):
    m=result.manifest;reference=inputs.reference
    reads=[r.model_dump(mode='json') for r in m.attribute_readbacks]
    unique={(r['side'],r['slot'],r['attribute']) for r in reads}
    players=m.input.players
    summary=digest(row['_analysis']['summary.json'])
    counts={key:proof.get(key) for key in COUNTS}
    checks=dict(original_identity=m.worker_identity['profile_identity']==EVIDENCE_PROFILE==inputs.profile.identity,
        evidence_identity=evidence.identity==m.worker_identity and evidence.trace_hash==m.trace_hash,
        control_proof=proof.get('equivalent') is True and proof.get('profile_identity')==EVIDENCE_PROFILE and
            proof.get('trace_hash')==m.trace_hash and type(proof.get('exact_transactions')) is int and
            proof['exact_transactions']==evidence.context.get('transactions')==79,
        common_digest=proof.get('common_sha256')==COMMON_SHA==reference['comparison']['common_sha256'],
        summary_digest=summary==SUMMARY_SHA==reference['summary_sha256'],
        counts=counts==COUNTS and all(proof.get(k)==reference['comparison'][k] for k in COUNTS),
        context=evidence.context==reference['context'] and evidence.context.get('transactions',0)>0 and
            evidence.context.get('frames')==186 and evidence.context.get('selected_contacts')==6 and
            evidence.context.get('interpolated_frames')==0 and evidence.context.get('complete') is True,
        policy=evidence.policy==reference['policy'],identities=len(players)==22 and len({p.id for p in players})==22 and
            {(p.side,p.slot) for p in players}=={(s,i) for s in ('home','away') for i in range(11)},
        readbacks=len(reads)==len(unique)==66,
        closes=len(m.close_receipts)==2 and [r['reason'] for r in m.close_receipts]==['natural_stoppage']*2)
    return checks,dict(common_sha256=proof.get('common_sha256'),summary_sha256=summary,**counts,
        context=evidence.context,policy=evidence.policy,identities=len(players),readbacks=len(reads),
        trace_hash=m.trace_hash,mapping_sha256=getattr(evidence,'mapping_sha256',None),
        readbacks_sha256=digest(sorted(reads,key=lambda r:(r['side'],r['slot'],r['attribute']))),
        close_receipts=m.close_receipts,score=list(m.score),duration_ms=m.duration_ms)


def _closing(inputs,budget):
    budget.checkpoint('finalize')
    if verify_resource_archive(inputs.profile.project)!=inputs.history:raise ValueError('Historical archive/state changed during audit')
    if _source_inventory(inputs.profile.project,inputs.profile.document)!=inputs.source_sha256:
        raise ValueError('Analysis source inventory changed during audit')
    for name,h in inputs.protected_sha256.items():
        if sha(artifact(inputs.profile.project,name))!=h:raise ValueError('Protected input changed during audit')
    budget.checkpoint('finalize')


def _write(path,value,*,replace_claim=None):
    raw=canonical(value)
    if len(raw)>1024*1024:raise ValueError('Audit report bound')
    if replace_claim is None:
        with path.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    else:
        if sha(path)!=replace_claim:raise ValueError('Audit invocation claim changed')
        pending=path.with_name(path.name+'.pending')
        with pending.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.replace(pending,path)


def _provisional(value):
    # Only the executor can attest that this function returned after its final
    # budget check. A partial write must never look like a completed acceptance.
    return dict(value,status='provisional',measured_verdict=value['status'],publication_complete=False,
        requires_executor_acceptance=True)


def audit_saved_observation(project:Path,output:Path)->dict:
    """Exactly one fixed diagnostic per output directory, even after failure."""
    root=Path(project).resolve();destination=artifact(root,STUDY)
    if Path(output).absolute()!=destination or not destination.is_dir():raise ValueError('Fixed canonical audit output required')
    audit_path=artifact(root,STUDY+'/phase3-replay-audit.json');perf_path=artifact(root,STUDY+'/phase3-performance.json')
    if any(p.exists() for p in (audit_path,perf_path,audit_path.with_name(audit_path.name+'.pending'))):
        raise FileExistsError('Offline audit already consumed/partial; no automatic retry')
    budget=M1Budget();blocks=dict.fromkeys(('native','process','heldout','write','ledger'),0)
    report=dict(schema_version='m1-resource-replay-audit-1',diagnostic_only=True,admission=False,status='started',publication_complete=False,
        evidence_profile_identity=EVIDENCE_PROFILE,analysis_source_identity=None,historical_resources=dict(
            charged_seconds=None,child_peak_private_bytes=None,parent_peak_private_bytes=None),
        new_native_matches=0,new_real_reservations=0,heldout_opened=False)
    calls=dict.fromkeys(('evidence','reduction','comparison'),0)
    telemetry=dict(active=None,stages={name:dict.fromkeys(
        ('candidate_calls','candidate_seconds','control_calls','control_seconds','validator_calls','validator_seconds'),0)
        for name in calls})
    perf=dict(schema_version='m1-resource-performance-1',diagnostic_only=True,admission=False,status='started',
        reference_seconds=REFERENCE_SECONDS,triple_limit_seconds=TRIPLE_LIMIT_SECONDS,call_counts=calls,stages=telemetry['stages'],
        timing_scope='fresh diagnostic job; warm filesystem caches; instrumented helpers, not original native time; imports/security/hash overhead separately included in job budget',
        decoder_scope=dict(candidate='instrumented current retained reader',control='instrumented separate alias; comparison time includes both replays'),
        reference_decoder_scope=dict(candidate_instrumented_per_triple=301,control_derived_per_comparison=60,
            note='old comparison time includes both; reference control alias was not instrumented'),
        environment=dict(python=platform.python_version(),system=platform.system(),release=platform.release(),
            machine=platform.machine(),logical_cpus=os.cpu_count()),
        resource_snapshot_scope='after closing checks, before report writes; same budget gated again after writes')
    with _offline_guard(root,destination,blocks):
        _write(audit_path,report);claim=sha(audit_path);inputs=None;error=None;security_start=_clock()
        try:
            budget.checkpoint('capture_preflight');inputs=_inputs(root,budget)
            report.update(analysis_source_identity=digest(inputs.source_sha256),analysis_source_sha256=inputs.source_sha256,
                history_before=inputs.history)
            from .m1_campaign import _launch
            result=_retained(root,budget);launch=_launch(inputs.profile,RUN_ID)
            perf['preflight_seconds']=_clock()-security_start
            with _instrument(telemetry):
                evidence=_timed('evidence',_evidence,(result,launch),budget,telemetry,calls)
                if (evidence.context.get('complete') is not True or evidence.context.get('observation')!='available' or
                    type(evidence.context.get('transactions')) is not int or evidence.context['transactions']<=0):
                    raise ValueError('Positive independently verified context transactions required')
                snapshot=budget.checkpoint('admission')
                row=_timed('reduction',_reduction,(result,evidence,dict(seconds=snapshot.elapsed_seconds,
                    peak_private_bytes=snapshot.peak_private_bytes)),budget,telemetry,calls)
                proof=_timed('comparison',_comparison,(inputs.profile,result,evidence,budget),budget,telemetry,calls)
            checks,observations=_correctness(result,evidence,row,proof,inputs)
            report.update(checks=checks,observations=observations,correctness_passed=all(checks.values()))
            closing_start=_clock();_closing(inputs,budget);perf['closing_security_and_hash_seconds']=_clock()-closing_start
            report['history_after']=inputs.history
        except Exception as failure:
            error=failure;report.update(correctness_passed=False,error_type=type(failure).__name__,error=str(failure)[:1500])
        try:snapshot=budget.checkpoint('finalize')
        except M1ResourceExceeded as failure:
            snapshot=failure.snapshot
            if error is None:error=failure;report.update(error_type=type(failure).__name__,error=str(failure))
        triple=sum(stage.get('seconds',0) for stage in telemetry['stages'].values())
        complete=all('seconds' in stage for stage in telemetry['stages'].values()) and all(v==1 for v in calls.values())
        perf.update(triple_seconds=triple,job_resources=asdict(snapshot),guard_blocks=blocks,
            structural_gate=complete,performance_gate=complete and math.isfinite(triple) and 0<=triple<=TRIPLE_LIMIT_SECONDS and
            error is None and not any(blocks.values()))
        passed=report.get('correctness_passed',False) and perf['performance_gate']
        report.update(status='passed' if passed else 'blocked',current_resources=asdict(snapshot),guard_blocks=blocks,
            performance_passed=perf['performance_gate'])
        perf['status']=report['status']
        if inputs:
            perf['indicative_mixed_clock_estimate']=dict(seconds=3*20.953+inputs.timeline['launch_to_manifest_seconds']+triple,
                formula='3 x old diagnostic freeze20.953s + unsigned historical launch-to-manifest interval + current triple',
                note='indicative only; not original monotonic time or proof of a future complete native job<=600s')
        _write(perf_path,_provisional(perf));_write(audit_path,_provisional(report),replace_claim=claim)
        try:snapshot=budget.checkpoint('finalize')
        except M1ResourceExceeded as failure:
            # Our newly written diagnostic reports can be downgraded, never retried.
            report.update(status='blocked',performance_passed=False,error_type=type(failure).__name__,error=str(failure),
                current_resources=asdict(failure.snapshot))
            perf.update(status='blocked',performance_gate=False,job_resources=asdict(failure.snapshot))
            try:
                _write(perf_path,_provisional(perf),replace_claim=sha(perf_path))
                _write(audit_path,_provisional(report),replace_claim=sha(audit_path))
            except Exception as diagnostic_failure:
                failure.diagnostic_error=type(diagnostic_failure).__name__
                raise failure from diagnostic_failure
            snapshot=failure.snapshot
        report.update(publication_complete=True,current_resources=asdict(snapshot))
        return report
