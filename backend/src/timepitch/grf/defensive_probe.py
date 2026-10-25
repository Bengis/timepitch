"""One ledgered research process; never a product engine or public SHA admission."""
import argparse
import hashlib
from itertools import zip_longest
import json
import os
from pathlib import Path
import threading
import time
from . import defensive_probe_budget as budget
from . import physical_campaign_budget as campaign
from .action_codec import ActionStreamValidator,make_action_chunk_ref
from .action_models import ActionInput,ActionManifest
from .action_process import ActionProcess
from .action_validation import RetainedResult,_Recorder
from .physical_codec import manifest_hash
from .physical_wire import canonical
from .defensive_probe_wire import validate_defense_sidecar


def _sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _context(descriptor_path,root):
    project,root,registration=budget._paths(root);path=Path(descriptor_path).resolve()
    if path!=(project/budget.DESCRIPTOR).resolve():raise ValueError('Canonical probe descriptor required')
    descriptor=campaign._read(path)
    with campaign._lock(root.parent/'continuation-registration.json'):
        state=budget._load(project,root,registration)
    build_path=project/descriptor['probe_build_manifest'];build=campaign._read(build_path)
    budget._verify_build(project,descriptor,build['native_binary_sha256'])
    identity=dict(input_hash=descriptor['control']['input_hash'],native_sha256=build['native_binary_sha256'],
        descriptor_sha256=_sha(path),build_manifest_sha256=_sha(build_path))
    return project,root,descriptor,state,build,identity


class DefensiveProbeProcess(ActionProcess):
    def __init__(self,descriptor_path:Path,root:Path):
        project,root,d,state,build,identity=_context(descriptor_path,root)
        run=state['run']
        if run is None or run['state']!='reserved' or run['binding']!={
            k:identity[k] for k in ('input_hash','native_sha256','build_manifest_sha256')}:
            raise ValueError('Probe reservation required before constructing worker')
        self.descriptor_path=Path(descriptor_path).resolve();self.root=root;self.identity=identity;self.descriptor=d
        self.native_sha256=identity['native_sha256'];self.evidence=root/'evidence'/budget.RUN_ID
        self.evidence.mkdir(parents=True,exist_ok=True);self.sidecar=self.evidence/'defense.jsonl'
        self.observed=self.evidence;self.cancel_after_first=False
        self.last_received_physics_ms=None
        control=campaign._read(project/d['control']['result_path']/'manifest.json');self.frozen_input=control['input']
        original=campaign._read(project/(budget.STUDY+'/campaign.json'))
        super().__init__(project/original['python'],project/build['binary_output'],timeout=d['limits']['wall_seconds'])

    def _command(self):
        # Exclusive durable witness also prevents a caller launching twice from a reserved ID.
        _,_,_,state,_,identity=_context(self.descriptor_path,self.root)
        if state['run']['state']!='reserved' or identity!=self.identity:raise ValueError('Research reservation/build changed')
        with (self.evidence/'launch.json').open('xb') as stream:
            stream.write(canonical(self.identity));stream.flush();os.fsync(stream.fileno())
        return [str(self.python_path),'-X','utf8','-u',str(Path(__file__).with_name('defensive_probe_runner.py')),
            str(self.native_dir),str(self.descriptor_path),str(self.sidecar)]

    def _stream_validator(self,request):
        if not isinstance(request,ActionInput) or request.model_dump(mode='json')!=self.frozen_input:
            raise ValueError('Exact frozen action input required')
        return _Recorder(self,request,ActionStreamValidator(request,self.native_sha256,_research_native_sha256=self.identity['native_sha256']))


def compare_defensive_capture(control,probe,*,_readbacks_by_identity=False)->dict:
    """Exact logical equality, including block partitions; neither source is rewritten.

    Full admissibility is the stream validator's separate gate. This function
    also supports tiny synthetic comparison components without inventing FT.
    """
    left,right=control.manifest,probe.manifest
    for m in (left,right):
        if not isinstance(m,ActionManifest) or manifest_hash(m)!=m.trace_hash:raise ValueError('Unbound research source manifest')
    def projection(m):
        value=m.model_dump(mode='json',exclude={'native_binary_sha256','trace_hash'})
        if _readbacks_by_identity:
            records=value['attribute_readbacks'];key=lambda r:(r['side'],r['slot'],r['attribute'])
            if len(records)!=66 or len({key(r) for r in records})!=66:raise ValueError('Unique66 readback identities required')
            value['attribute_readbacks']=sorted(records,key=key)
        return value
    if projection(left)!=projection(right):
        raise ValueError('Research manifest differs beyond native SHA/trace')
    hashed=hashlib.sha256();counts=dict(blocks=0,samples=0,events=0,semantic_events=0);sentinel=object()
    for a,b in zip_longest(control.chunks(),probe.chunks(),fillvalue=sentinel):
        if a is sentinel or b is sentinel:raise ValueError('Research block partition differs')
        index=counts['blocks']
        if (index>=len(left.chunks) or make_action_chunk_ref(a)!=left.chunks[index] or
            make_action_chunk_ref(b)!=right.chunks[index]):raise ValueError('Research block not bound to manifest')
        raw=canonical(a.model_dump(mode='json'))
        if raw!=canonical(b.model_dump(mode='json')):raise ValueError('Research trajectory/action differs')
        hashed.update(raw);counts['blocks']+=1;counts['samples']+=len(a.samples)
        counts['events']+=len(a.events);counts['semantic_events']+=len(a.semantic_events)
    if counts['blocks']!=len(left.chunks):raise ValueError('Missing research block')
    result=dict(**counts,logical_sha256=hashed.hexdigest(),control_trace_hash=left.trace_hash,probe_trace_hash=right.trace_hash)
    if _readbacks_by_identity:result['readbacks']=66
    return result


def _harness_freeze(project):
    path=project/budget.STUDY/'defensive-probe-transport-freeze.json';freeze=campaign._read(path)
    for name,entry in freeze['files'].items():
        if _sha(project/name)!=entry['sha256']:raise ValueError('Frozen research harness changed: '+name)
    if _sha(project/budget.STUDY/'technical-freeze.json')!=freeze['historical_freeze_sha256']:
        raise ValueError('Historical technical freeze changed')
    return _sha(path)


def run_defensive_probe(descriptor_path:Path,root:Path)->dict:
    if os.getenv('TIMEPITCH_TEST_GRF_DEFENSE_PROBE')!='1':raise ValueError('Explicit one-process probe opt-in required')
    project,root,d,_,build,identity=_context(descriptor_path,root);freeze_sha=_harness_freeze(project)
    # Check every retained byte before consuming the one attempt; never run a new control.
    source=project/d['control']['result_path']
    for name,sha in d['control']['files'].items():
        if _sha(source/name)!=sha:raise ValueError('Retained control changed')
    control=RetainedResult(source);request=control.manifest.input
    reservation=budget.reserve_defensive_probe(root,input_hash=request.input_hash,native_sha256=identity['native_sha256'])
    if reservation['reused']:return campaign._read(Path(reservation['result_path'])/'report.json')
    evidence=root/'evidence'/budget.RUN_ID;evidence.mkdir(parents=True,exist_ok=True)
    runner=None;result=None;started=time.monotonic()
    try:
        runner=DefensiveProbeProcess(descriptor_path,root);result=runner.run(request,threading.Event())
        saved=RetainedResult(evidence)
        sidecar=validate_defense_sidecar(runner.sidecar,manifest=saved.manifest,descriptor=dict(identity=identity,windows=d['windows']))
        equality=compare_defensive_capture(control,saved)
        report=dict(status='passive_research_capture',freeze_sha256=freeze_sha,sidecar=sidecar,equality=equality,
            wall_seconds=time.monotonic()-started,peak_private_bytes=runner.peak_private_bytes,
            compressed_bytes=sum(r.compressed_bytes for r in saved.manifest.chunks),
            expanded_bytes=sum(r.expanded_bytes for r in saved.manifest.chunks),publication='research_only',
            causal_interpretation='pending_incident_review')
        if report['wall_seconds']>d['limits']['wall_seconds'] or report['peak_private_bytes']>d['limits']['private_bytes']:
            raise ValueError('Research resource budget')
        (evidence/'report.json').write_bytes(canonical(report))
        files={p.name:_sha(p) for p in evidence.iterdir() if p.is_file()}
        budget.finish_defensive_probe(root,state='ready',evidence=dict(result_path=evidence.relative_to(root).as_posix(),files=files))
        return report
    except BaseException as error:
        failure=dict(type=type(error).__name__,message=str(error)[-2000:],
            stderr=bytes(getattr(runner,'diagnostic_stderr',b'')).decode('utf-8',errors='replace')[-6000:],
            wall_seconds=time.monotonic()-started,peak_private_bytes=getattr(runner,'peak_private_bytes',None),
            last_received_physics_ms=getattr(runner,'last_received_physics_ms',None))
        (evidence/'failure.json').write_bytes(canonical(failure))
        budget.finish_defensive_probe(root,state='failed',evidence=dict(error=failure,
            result_path=evidence.relative_to(root).as_posix(),files={p.name:_sha(p) for p in evidence.iterdir() if p.is_file()}))
        raise
    finally:
        if result:result.close()
        if runner:runner.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--descriptor',type=Path,required=True)
    parser.add_argument('--root',type=Path,required=True);args=parser.parse_args()
    print(json.dumps(run_defensive_probe(args.descriptor,args.root),sort_keys=True))


if __name__=='__main__':main()
