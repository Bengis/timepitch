"""Bounded complete-match acceptance, separate from gameplay and calibration."""
import hashlib
from itertools import zip_longest
import json
import os
from pathlib import Path
import shutil
import threading
import time
from .action_models import ActionInput,ActionManifest
from .action_process import ActionProcess
from .action_statistics import build_action_statistics
from .physical_models import ActivityInput
from .physical_process import ActivityProcess
from .physical_codec import encode_chunk,decode_chunk,parse_manifest,validate_manifest
from .physical_wire import canonical,digest,MAX_TOTAL_COMPRESSED
from .physical_campaign_budget import RunSpec,reserve_run,finish_run,TECHNICAL
from .process import GrfCancelled,GrfTimeout

PROJECT_ROOT=Path(__file__).resolve().parents[4]
STUDY='research/engine-evaluation/2026-10-17-grf-physical-validation'


def game_input_projection(request):
    result=request.model_dump(mode='json',exclude={'input_hash'})
    if 'telemetry_policy' in result['settings']:
        if result['settings'].pop('telemetry_policy')!='action-contact-1':raise ValueError('Unknown observer selector')
    return result


def validate_action_result(manifest,chunks):
    if not isinstance(manifest,ActionManifest):raise ValueError('Expected an action match')
    return build_action_statistics(manifest,chunks)


def compare_common_capture(control,actions):
    if game_input_projection(control.manifest.input)!=game_input_projection(actions.manifest.input):
        raise ValueError('Game inputs differ, not just the observer')
    for key in ('duration_ms','score','periods','ledger','attribute_readbacks','completion_reason'):
        if getattr(control.manifest,key)!=getattr(actions.manifest,key):raise ValueError('Native manifest projection differs: '+key)
    counts=dict(blocks=0,samples=0,events=0);hashed=hashlib.sha256();sentinel=object()
    for left,right in zip_longest(control.chunks(),actions.chunks(),fillvalue=sentinel):
        if left is sentinel or right is sentinel:raise ValueError('Capture ended at a different block')
        def common(c):return c.model_dump(mode='json',exclude={'schema_version','semantic_events','contact_roles'})
        a,b=common(left),common(right)
        if a!=b:raise ValueError(f'Native common projection differs in block {left.index}')
        hashed.update(canonical(a));counts['blocks']+=1;counts['samples']+=len(left.samples);counts['events']+=len(left.events)
    return dict(**counts,common_sha256=hashed.hexdigest())


class RetainedResult:
    def __init__(self,path):
        self.path=Path(path);self.manifest=parse_manifest(json.loads((self.path/'manifest.json').read_bytes()))
        self.count=len(self.manifest.chunks)
    def chunks(self):
        for ref in self.manifest.chunks:yield decode_chunk((self.path/f'{ref.index}.zlib').read_bytes())
    def close(self):pass  # Durable evidence, not the worker's temporary spool.


class _Recorder:
    def __init__(self,owner,request,inner):self.owner=owner;self.request=request;self.inner=inner;self.count=0;self.bytes=0
    def append(self,chunk):
        raw=encode_chunk(chunk);self.bytes+=len(raw)
        if self.bytes>MAX_TOTAL_COMPRESSED:raise ValueError('Observed prefix exceeds budget')
        (self.owner.observed/f'{chunk.index}.zlib').write_bytes(raw);self.count+=1
        self.owner.last_received_physics_ms=int(chunk.samples[-1][1])
        if self.inner is not None:self.inner.append(chunk)
        if self.count==1 and self.owner.cancel_after_first:
            self.owner.cancel_requested_at=time.monotonic();self.owner.cancelled.set()
    def chunks(self):
        for index in range(self.count):
            if self.owner.cancelled.is_set():raise GrfCancelled()
            if time.monotonic()-self.owner.record_started_at>self.owner.timeout:raise GrfTimeout()
            yield decode_chunk((self.owner.observed/f'{index}.zlib').read_bytes())
    def finish(self,manifest):
        (self.owner.observed/'manifest.json').write_bytes(canonical(manifest.model_dump(mode='json')))
        if self.inner is not None:self.inner.finish(manifest)
        else:validate_manifest(manifest,self.chunks(),self.request)


class _RecordedProcess:
    def __init__(self,*args,evidence_dir,cancelled,cancel_after_first=False,**kwargs):
        super().__init__(*args,**kwargs)
        self.observed=Path(evidence_dir)/'observed';self.observed.mkdir(parents=True,exist_ok=False)
        self.cancelled=cancelled;self.cancel_after_first=cancel_after_first;self.cancel_requested_at=None
        self.last_received_physics_ms=None;self.record_started_at=time.monotonic()
    def _stream_validator(self,request):return _Recorder(self,request,super()._stream_validator(request))


class RecordedActionProcess(_RecordedProcess,ActionProcess):pass
class RecordedActivityProcess(_RecordedProcess,ActivityProcess):pass


def _sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _retention(result,path):
    path.mkdir(exist_ok=False)
    (path/'manifest.json').write_bytes(canonical(result.manifest.model_dump(mode='json')))
    for ref in result.manifest.chunks:shutil.copyfile(result.path/f'{ref.index}.zlib',path/f'{ref.index}.zlib')


def _frozen(root,case_id):
    folder=PROJECT_ROOT/STUDY;campaign=json.loads((folder/'campaign.json').read_bytes())
    state=json.loads((root/'checkpoint.json').read_bytes())
    if state['campaign']!=campaign:raise ValueError('Registered campaign changed')
    freeze_path=folder/'technical-freeze.json';frozen=json.loads(freeze_path.read_bytes())
    if frozen['campaign_sha256']!=_sha(folder/'campaign.json'):raise ValueError('Technical freeze changed')
    for name,expected in (campaign['baseline_files']|frozen['files']).items():
        if _sha(PROJECT_ROOT/name)!=expected:raise ValueError('Frozen technical file changed: '+name)
    if _sha(PROJECT_ROOT/campaign['dataset'])!=campaign['dataset_sha256']:raise ValueError('Catalogue changed')
    predecessor={'T-actions':'T-control','T-repeat':'T-actions','T-cancel':'T-repeat'}.get(case_id)
    if predecessor:
        prior=state['runs'].get(predecessor)
        if not prior or prior['state']!='ready':raise ValueError('Previous technical gate has not completed')
        if prior['evidence']['freeze_sha256']!=_sha(freeze_path):raise ValueError('Technical revision changed after measurement')
    return campaign,_sha(freeze_path)


def run_technical_case(case_id:str,campaign_root:Path)->dict:
    if os.getenv('TIMEPITCH_TEST_GRF_CAMPAIGN')!='1':raise ValueError('Explicit campaign opt-in required')
    root=Path(campaign_root).resolve()
    if root!=(PROJECT_ROOT/'.local/grf-physical-work/continuation').resolve() or case_id not in TECHNICAL:
        raise ValueError('Only canonical approved phase-1 cases may run')
    if not (root/'checkpoint.json').is_file() or not (root.parent/'continuation-registration.json').is_file():
        raise ValueError('Registered cumulative budget required before any child')
    campaign,freeze_sha=_frozen(root,case_id);spec=RunSpec(case_id,'technical',**campaign['technical'][case_id])
    reservation=reserve_run(root,spec)
    if reservation.reused:
        return json.loads((root/'checkpoint.json').read_bytes())['runs'][case_id]['evidence']
    case_path=root/'evidence'/case_id;cancelled=threading.Event();runner=None;result=None;start=time.monotonic()
    try:
        control=case_id=='T-control';kind='control' if control else 'actions'
        request=(ActivityInput if control else ActionInput).model_validate(campaign['inputs'][kind])
        runner=(RecordedActivityProcess if control else RecordedActionProcess)(PROJECT_ROOT/campaign['python'],
            PROJECT_ROOT/campaign['native_dirs'][kind],evidence_dir=case_path,cancelled=cancelled,cancel_after_first=case_id=='T-cancel')
        try:result=runner.run(request,cancelled)
        except GrfCancelled:
            if case_id!='T-cancel' or runner.cancel_requested_at is None:raise
            latency=time.monotonic()-runner.cancel_requested_at
            if latency>5 or runner._active:raise ValueError('Cancelled native did not close within five seconds')
            evidence=dict(freeze_sha256=freeze_sha,wall_seconds=time.monotonic()-start,
                cancellation_seconds=latency,last_received_physics_ms=runner.last_received_physics_ms,
                peak_private_bytes=runner.peak_private_bytes,publication='not_ready')
            finish_run(root,case_id,state='cancelled',evidence=evidence);return evidence
        if case_id=='T-cancel':raise ValueError('Cancellation fixture unexpectedly completed')
        _retention(result,case_path/'match');saved=RetainedResult(case_path/'match')
        m=saved.manifest;summary=None
        evidence=dict(freeze_sha256=freeze_sha,result_path=(case_path/'match').relative_to(root).as_posix(),
            wall_seconds=time.monotonic()-start,peak_private_bytes=runner.peak_private_bytes,
            physics_ms=m.duration_ms,score=list(m.score),samples=sum(r.samples for r in m.chunks),
            raw_events=sum(r.events for r in m.chunks),blocks=len(m.chunks),
            compressed_bytes=sum(r.compressed_bytes for r in m.chunks),expanded_bytes=sum(r.expanded_bytes for r in m.chunks),
            trace_hash=m.trace_hash,readback_count=len(m.attribute_readbacks))
        if not control:
            summary_start=time.monotonic();summary=validate_action_result(m,saved.chunks())
            (case_path/'match/summary.json').write_bytes(canonical(summary.model_dump(mode='json')))
            evidence.update(summary_seconds=time.monotonic()-summary_start,summary_sha256=digest(summary.model_dump(mode='json')),
                semantic_events=m.semantic_event_count,release_count=len(summary.releases),pass_count=len(summary.passes))
            evidence['passive_equivalence']=compare_common_capture(RetainedResult(root/'evidence/T-control/match'),saved)
        if case_id=='T-repeat':
            first=RetainedResult(root/'evidence/T-actions/match')
            if first.manifest!=m:raise ValueError('Native action manifest did not reproduce')
            for a,b in zip_longest(first.manifest.chunks,m.chunks):
                if a is None or b is None or (first.path/f'{a.index}.zlib').read_bytes()!=(saved.path/f'{b.index}.zlib').read_bytes():
                    raise ValueError('Native action block bytes did not reproduce')
            if (first.path/'summary.json').read_bytes()!=(saved.path/'summary.json').read_bytes():raise ValueError('Native summary did not reproduce')
            evidence['reproduced_exactly']=True
        evidence['files']={p.name:_sha(p) for p in (case_path/'match').iterdir() if p.is_file()}
        finish_run(root,case_id,state='ready',evidence=evidence);return evidence
    except BaseException as error:
        causes=[];current=error
        while current is not None and len(causes)<5:
            causes.append(dict(type=type(current).__name__,message=str(current)[-2000:]));current=current.__cause__
        case_path.mkdir(parents=True,exist_ok=True)
        (case_path/'failure.json').write_bytes(canonical(dict(causes=causes,stderr=getattr(runner,'diagnostic_stderr',b'').decode('utf-8',errors='replace')[-6000:])))
        evidence=dict(freeze_sha256=freeze_sha,error=getattr(error,'code',type(error).__name__),wall_seconds=time.monotonic()-start,
            peak_private_bytes=getattr(runner,'peak_private_bytes',None),diagnostic=(case_path/'failure.json').relative_to(root).as_posix(),
            last_received_physics_ms=getattr(runner,'last_received_physics_ms',None),
            observed_files={p.relative_to(case_path).as_posix():_sha(p) for p in case_path.rglob('*') if p.is_file()})
        finish_run(root,case_id,state='failed',evidence=evidence);raise
    finally:
        if result:result.close()
        if runner:runner.close()
