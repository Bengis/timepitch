"""Fixed private M1 entry. No supplied executor/factory and no initialization."""
from itertools import zip_longest
from pathlib import Path
from types import SimpleNamespace
import hashlib
import threading
from . import m1_verifier as wire
from .m1_profile import load_worker_profile
from .m1_authorization import WorkerLedger,validate_worker_authorization,validate_stage_selection
from .physical_wire import canonical
from .continuity_profile import plain


class RetainedM1Result:
    def __init__(self,path,budget=None):
        from .m1_models import M1Manifest
        self.path=Path(path);self.budget=budget
        if budget:budget.checkpoint('admission')
        self.manifest=M1Manifest.model_validate(wire.read(self.path/'manifest.json',1024*1024))
        self.count=len(self.manifest.chunks)
    def chunks(self):
        from .physical_codec import decode_chunk
        for ref in self.manifest.chunks:
            if self.budget:self.budget.checkpoint(self.budget.latest.stage)
            from .m1_verifier import artifact
            p=artifact(self.path, f'{ref.index}.zlib')
            with p.open('rb') as stream:raw=stream.read(1024*1024+1)
            if len(raw)>1024*1024:raise ValueError('Retained compressed block bound')
            yield decode_chunk(raw)
            if self.budget:self.budget.checkpoint(self.budget.latest.stage)
    def close(self):pass


def compare_m1_control(control,observed,budget=None):
    """Compare exact gameplay, explicitly excluding the successor envelope only."""
    from .physical_codec import manifest_hash
    left,right=control.manifest,observed.manifest
    if any(m.trace_hash!=manifest_hash(m) for m in (left,right)):raise ValueError('Unbound comparison manifest')
    def projection(m):
        v=m.model_dump(mode='json',exclude={'schema_version','engine_version','clock_policy','worker_identity','close_receipts',
            'native_binary_sha256','trace_hash'})
        records=v['attribute_readbacks'];key=lambda r:(r['side'],r['slot'],r['attribute'])
        if len(records)!=66 or len({key(r) for r in records})!=66:raise ValueError('Exactly66 unique readbacks required')
        v['attribute_readbacks']=sorted(records,key=key);return v
    if projection(left)!=projection(right):raise ValueError('M1 changed saved C4 gameplay/clock; revise control and budget')
    h=hashlib.sha256();counts=dict(blocks=0,samples=0,events=0,semantic_events=0)
    for a,b in zip_longest(control.chunks(),observed.chunks()):
        if budget:budget.checkpoint('admission')
        if a is None or b is None or a.model_dump(mode='json')!=b.model_dump(mode='json'):
            raise ValueError('M1 changed saved C4 replay; no retry or additional control allowed')
        h.update(canonical(a.model_dump(mode='json')));counts['blocks']+=1;counts['samples']+=len(a.samples)
        counts['events']+=len(a.events);counts['semantic_events']+=len(a.semantic_events)
    return dict(**counts,common_sha256=h.hexdigest())


def _observation(profile,result,receipt,budget=None):
    from .action_validation import RetainedResult
    if receipt.context['transactions']<=0:raise ValueError('Insufficient independently verified policy exercise; no replacement run')
    control=RetainedResult(profile.project/'.local/grf-physical-work/continuation/evidence/c4/calibration/01')
    common=compare_m1_control(control,result,budget)
    return dict(equivalent=True,exact_transactions=receipt.context['transactions'],control_manifest_sha256=wire.sha(control.path/'manifest.json'),
        trace_hash=result.manifest.trace_hash,profile_identity=profile.identity,**common)


def _launch(profile,run_id):
    who=dict(run_id=run_id,mode=wire.mode_for(run_id),input_hash=profile.payload(wire.payload_key(run_id))['input_hash'],
        native_sha256=profile.native_sha256,profile_identity=profile.identity,build_manifest_sha256=profile.build_manifest_sha256)
    return SimpleNamespace(identity=who,mode=who['mode'],run_id=run_id,profile_identity=profile.identity,
        native_sha256=profile.native_sha256,document=plain(profile.document),evidence=profile.project/wire.RUN_ROOT/'evidence'/run_id)


def validate_retained_measurement(profile,run_id,row):
    """Historical row checker only; cannot commit or admit a producer row."""
    from .m1_evidence import validate_evidence
    from .m1_measurement import measure_m1_result
    launch=_launch(profile,run_id);result=RetainedM1Result(launch.evidence);receipt=validate_evidence(result,launch)
    expected=measure_m1_result(result,receipt,dict(seconds=row['seconds'],peak_private_bytes=row['peak_private_bytes']))
    if any(row.get(k)!=v for k,v in expected.items()):raise ValueError('Stored measurement differs from retained replay')
    if run_id=='M-observe-42':
        proof=_observation(profile,result,receipt)
        if row.get('observation_proof')!=proof or row.get('equivalent') is not True or row.get('exact_transactions')!=proof['exact_transactions']:
            raise ValueError('Claimed native equivalence lacks matching retained control proof')


def _capture_reserved(profile,run_id,payload,budget):
    # The sole budget exists before imports, request parsing and constructor.
    from .action_models import ActionInput
    from .m1_process import M1Process
    budget.checkpoint('capture_preflight')
    request=ActionInput.model_validate(payload)
    evidence=wire.artifact(profile.project,wire.RUN_ROOT+'/evidence/'+run_id)
    evidence.mkdir(parents=True,exist_ok=True)
    process=None
    try:
        process=M1Process(profile,profile.project/wire.RUN_ROOT,run_id)
        budget.checkpoint('capture_preflight')
        return process.capture(request,threading.Event(),budget)
    finally:
        if process is not None:process.close()



def run_m1_stage(project=wire.PROJECT,stage=None):
    if stage not in ('observe','calibration','heldout'):raise ValueError('Explicit M1 research stage required')
    profile=load_worker_profile(project)
    validate_worker_authorization(project,profile)  # Missing grant creates no root, anchor, reservation or process.
    validate_stage_selection(project,profile,stage)
    store=WorkerLedger(project,profile)
    return _execute_stage(store,profile,stage)


def _execute_stage(store,profile,stage):
    """Reserve/finish under the shared lock; the claiming child needs it too."""
    from .continuity_campaign import evaluate_continuity_gates
    with store.locked():
        state=store.assert_stage(stage)
        if stage=='heldout':store.seal_selection()
        if stage=='calibration' and state['calibration_report'] is not None:return state['calibration_report']
    ids=['M-observe-42'] if stage=='observe' else [f'm1/{stage}/{i:02}' for i in range(1,(8 if stage=='calibration' else 24)+1)]
    values=[]
    for run_id in ids:
        with store.locked():
            payload=profile.payload(wire.payload_key(run_id));reservation=store.reserve(run_id,payload)
            if reservation['reused']:values.append(reservation['row']);continue
        # A reserved ID is already consumed: competitors cannot take it over.
        try:
            from .m1_resources import M1Budget
            budget=M1Budget()
            capture=_capture_reserved(profile,run_id,payload,budget)
            values.append(store.finish_capture(run_id,capture,budget))
        except BaseException as error:
            from .m1_resources import M1ResourceExceeded,record_resource_failure
            if isinstance(error,M1ResourceExceeded) and error.diagnostic_error is None:
                try:
                    evidence=wire.artifact(profile.project,wire.RUN_ROOT+'/evidence/'+run_id)
                    evidence.mkdir(parents=True,exist_ok=True)
                    if not (evidence/'resource-failure.json').exists():
                        record_resource_failure(evidence/'resource-failure.json',error,identity=_launch(profile,run_id).identity,
                            trace_hash=None,last_durable_block=None,last_durable_ms=None)
                except Exception as diagnostic_error:error.diagnostic_error=type(diagnostic_error).__name__
            try:
                with store.locked():
                    if store._load()['runs'][run_id]['state']=='reserved':
                        store.finish(run_id,dict(complete=False,error_type=type(error).__name__,error=str(error)[-2000:]),failed=True)
            except Exception as finalization_error:setattr(error,'finalization_error',type(finalization_error).__name__)
            raise
    with store.locked():
        if stage=='observe':
            try:store.accept_observation(values[0])
            except BaseException as error:store.stop(error);raise
            return dict(stage=stage,equivalent=True,rows=values,profile_identity=profile.identity)
        gates=evaluate_continuity_gates(values,expected=len(ids))
        report=dict(schema_version='m1-research-stage-1',stage=stage,profile_identity=profile.identity,
            rows=values,gates=gates,qualified=all(gates.values()),publication='research-only-no-web')
        if stage=='calibration':store.record_calibration(report)
        return report
