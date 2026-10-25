"""One approved passive probe, anchored to the existing physical campaign.

Registration does not reserve an attempt. No function starts native code.
The original campaign lock serializes both ledgers and cumulative accounting.
"""
from pathlib import Path
import os
import re
from . import physical_campaign_budget as budget

STUDY='research/engine-evaluation/2026-10-17-grf-physical-validation'
DESCRIPTOR=STUDY+'/defensive-probe.json'
BUILD_MANIFEST=STUDY+'/native-defensive-probe-build.json'
RUN_ID='D-defense-42'
LIMITS=dict(wall_seconds=600,private_bytes=536870912,sidecar_bytes=8388608,maximum_ms=7440000)


def pin_defensive_windows(events):
    """Pin raw native event time, not its later sanction or sampled-frame time."""
    expected={1122:('touch','shot',None,781770),5489:('touch','shot',None,4133450),
        1537:('decision','foul','accepted',1164860),1538:('decision','foul','sanctioned',1164870)}
    found={}
    for event in events:
        value=event if isinstance(event,dict) else event.model_dump(mode='json')
        if value['seq'] not in expected:continue
        kind,detail,stage,time=expected[value['seq']]
        if (value['seq'] in found or value['type']!=kind or value['kind']!=detail or
            value['actual_time_ms']!=time or (stage is not None and value['stage']!=stage)):
            raise ValueError('Retained defensive incident changed')
        if stage is not None and value['function']!=13:raise ValueError('Expected executed slide')
        found[value['seq']]=value
    if set(found)!=set(expected):raise ValueError('Missing defensive incident')
    return [dict(event_seq=1122,event_ms=781770,start_ms=771770,end_ms=781770),
        dict(event_seq=1537,event_ms=1164860,start_ms=1162860,end_ms=1164960),
        dict(event_seq=5489,event_ms=4133450,start_ms=4123450,end_ms=4133450)]


def _paths(root):
    project=budget.PROJECT_ROOT.resolve();root=Path(root).resolve()
    if root!=(project/'.local/grf-physical-work/defensive-probe').resolve() or not root.is_relative_to(project):
        raise ValueError('Use canonical defensive probe root')
    return project,root,root.parent/'defensive-probe-registration.json'


def _source_descriptor(original,state):
    project=budget.PROJECT_ROOT.resolve();entry=state['runs'].get('T-actions')
    if entry is None or entry['state']!='ready':raise ValueError('Complete accepted T-actions required')
    capture=budget._verify_evidence(original,entry['evidence'])
    manifest=budget._read(capture/'manifest.json')
    if manifest['input']['config']['seed']!=42:raise ValueError('Expected seed 42')
    from .physical_codec import decode_chunk
    def events():
        for name in sorted(entry['evidence']['files']):
            if name.endswith('.zlib'):yield from decode_chunk((capture/name).read_bytes()).events
    files=[project/(STUDY+'/campaign.json'),original/'checkpoint.json',
        original.parent/'continuation-registration.json',project/state['campaign']['parent_checkpoint']]
    native=state['campaign']['native_dirs']['actions']
    dependencies={Path(name).name:sha for name,sha in state['campaign']['baseline_files'].items()
        if Path(name).parent==Path(native) and name.endswith('.dll')}
    if not dependencies:raise ValueError('Frozen baseline DLLs required')
    return dict(schema_version='grf-defensive-probe-1',id=RUN_ID,approved=True,maximum=71,max_candidates=5,
        baseline_used=28,seed=42,campaign_identity=state['identity'],
        original_files={p.relative_to(project).as_posix():budget._sha(p) for p in files},
        control=dict(result_path=capture.relative_to(project).as_posix(),
            input_hash=manifest['input']['input_hash'],trace_hash=manifest['trace_hash'],
            native_sha256=manifest['native_binary_sha256'],dependencies=dependencies,files=entry['evidence']['files']),
        windows=pin_defensive_windows(events()),limits=LIMITS.copy(),
        probe_build_manifest=BUILD_MANIFEST,native_binding='freeze-build-before-reservation')


def make_defensive_probe_descriptor(root:Path)->dict:
    original,registration=budget._locations(root)
    with budget._lock(registration):
        state=budget._load(original,registration)
        if (len(state['prior_runs'])+len(state['runs'])!=28 or len(state['candidate_bindings'])!=3 or
            set(state['runs'])!=set(budget.TECHNICAL)):
            raise ValueError('Expected 28 consumed attempts before this extension')
        return _source_descriptor(original,state)


def _load(project,root,registration):
    state=budget._read(root/'checkpoint.json');witness=budget._read(registration)
    descriptor=budget._read(project/DESCRIPTOR)
    marker=budget._read(root.parent/'defensive-probe-initialized.json')
    if (set(witness)!={'root','identity','state_sha256','descriptor_sha256'} or
        witness['root']!=str(root) or witness['identity']!=budget._digest(descriptor) or
        state.get('descriptor')!=descriptor or state.get('identity')!=witness['identity'] or
        budget._digest(state)!=witness['state_sha256'] or
        budget._sha(project/DESCRIPTOR)!=witness['descriptor_sha256'] or
        marker!={k:witness[k] for k in ('root','identity','descriptor_sha256')}):
        raise ValueError('Defensive probe identity or checkpoint changed; never reset it')
    return state


def _save(project,root,registration,state):
    budget._write(root/'checkpoint.json',state)
    budget._write(registration,dict(root=str(root),identity=state['identity'],
        state_sha256=budget._digest(state),descriptor_sha256=budget._sha(project/DESCRIPTOR)))


def initialize_defensive_probe(descriptor:dict,root:Path,*,approved:bool)->None:
    project,root,registration=_paths(root)
    if approved is not True:raise ValueError('Explicit approved extension required')
    original,old_registration=budget._locations(root.with_name('continuation'))
    with budget._lock(old_registration):
        budget.reject_superseded_reservation(project)
        old=budget._load(original,old_registration)
        if descriptor!=budget._read(project/DESCRIPTOR):raise ValueError('Unpinned defensive descriptor')
        marker=root.parent/'defensive-probe-initialized.json'
        if root.exists() or registration.exists() or marker.exists():
            _load(project,root,registration);return
        # Full source equality also pins schema, caps, input, windows and all baseline bytes.
        if (len(old['prior_runs'])+len(old['runs'])!=28 or len(old['candidate_bindings'])!=3 or
            descriptor!=_source_descriptor(original,old)):
            raise ValueError('Defensive source or approved scope changed')
        state=dict(identity=budget._digest(descriptor),descriptor=descriptor,run=None)
        # Permanent external witness survives loss of both mutable extension files.
        # A crash here blocks initialization instead of issuing another free attempt.
        with marker.open('xb') as stream:
            from .physical_wire import canonical
            stream.write(canonical(dict(root=str(root),identity=state['identity'],
                descriptor_sha256=budget._sha(project/DESCRIPTOR))))
            stream.flush();os.fsync(stream.fileno())
        root.mkdir()
        _save(project,root,registration,state)


def _extension_usage_locked(original,old,*,new_reservation=False):
    """Caller holds the original campaign lock. Never acquire it recursively."""
    project,root,registration=_paths(original.with_name('defensive-probe'))
    used=len(old['prior_runs'])+len(old['runs']);candidates=len(old['candidate_bindings'])
    if not any(p.exists() for p in (project/DESCRIPTOR,root,registration,root.parent/'defensive-probe-initialized.json')):
        return dict(original_used=used,extension_used=0,used=used,maximum=70,candidates=candidates)
    state=_load(project,root,registration);descriptor=state['descriptor'];run=state['run']
    if descriptor['campaign_identity']!=old['identity'] or used<28 or used>70 or candidates>5:
        raise ValueError('Wrong original campaign for extension')
    if new_reservation and (run is None or run['state']!='ready'):
        from .defensive_acceptance import verify_probe_analysis_acceptance_locked
        verify_probe_analysis_acceptance_locked(project,original,state)
    extra=int(run is not None)
    return dict(original_used=used,extension_used=extra,used=used+extra,maximum=71,candidates=candidates)


def cumulative_usage(root:Path)->dict:
    original,registration=budget._locations(root)
    with budget._lock(registration):
        from .coordination_authorization import supersession_present,usage_locked
        if supersession_present(budget.PROJECT_ROOT):return usage_locked(budget.PROJECT_ROOT)
        return _extension_usage_locked(original,budget._load(original,registration))


def _verify_build(project,descriptor,native_sha256):
    if not isinstance(native_sha256,str) or not re.fullmatch('[0-9a-f]{64}',native_sha256):
        raise ValueError('Expected explicit compiled native SHA')
    path=project/descriptor['probe_build_manifest'];build=budget._read(path)
    output=budget._artifact(project,build['binary_output'])
    if (output!=(project/'.local/grf-defense-native/Release').resolve() or
        build['native_binary_sha256']!=native_sha256 or build['build']['exit_code']!=0 or
        build['previous_native_binary_sha256']!=descriptor['control']['native_sha256'] or
        budget._sha(output/'_gameplayfootball.pyd')!=native_sha256 or
        build['dependencies']!=descriptor['control']['dependencies']):
        raise ValueError('Research build or native mismatch')
    for name,sha in build['dependencies'].items():
        if Path(name).name!=name or budget._sha(output/name)!=sha:raise ValueError('Research DLL changed')
    return budget._sha(path)


def reserve_defensive_probe(root:Path,*,input_hash:str,native_sha256:str)->dict:
    project,root,registration=_paths(root);original,old_registration=budget._locations(root.with_name('continuation'))
    with budget._lock(old_registration):
        budget.reject_superseded_reservation(project)
        old=budget._load(original,old_registration);state=_load(project,root,registration);descriptor=state['descriptor']
        if input_hash!=descriptor['control']['input_hash']:raise ValueError('Research input changed')
        build_sha=_verify_build(project,descriptor,native_sha256)
        binding=dict(input_hash=input_hash,native_sha256=native_sha256,build_manifest_sha256=build_sha)
        if state['run'] is not None:
            if state['run']['binding']!=binding or state['run']['state']!='ready':
                raise ValueError('Defensive probe consumed; no retry')
            path=budget._verify_evidence(root,state['run']['evidence'])
            return dict(id=RUN_ID,reused=True,result_path=str(path))
        # No original reservation may precede this run or occur while it is in progress.
        if descriptor!=_source_descriptor(original,old):raise ValueError('Frozen defensive baseline changed')
        state['run']=dict(id=RUN_ID,state='reserved',binding=binding)
        _save(project,root,registration,state)
        return dict(id=RUN_ID,reused=False,result_path=None)


def finish_defensive_probe(root:Path,*,state:str,evidence:dict)->None:
    project,root,registration=_paths(root);original,old_registration=budget._locations(root.with_name('continuation'))
    if state not in ('ready','failed','cancelled'):raise ValueError('Invalid probe terminal state')
    with budget._lock(old_registration):
        old=budget._load(original,old_registration);data=_load(project,root,registration);run=data['run']
        if run is None or run['state']!='reserved':raise ValueError('Only one consumed probe may finish')
        # Completing the probe must not conceal concurrent modification of the old experiment.
        if data['descriptor']!=_source_descriptor(original,old):raise ValueError('Original baseline changed during probe')
        if state=='ready':
            if not {'manifest.json','defense.jsonl','report.json'}<=set(evidence.get('files',{})):
                raise ValueError('Complete probe capture, sidecar and acceptance report required')
            budget._verify_evidence(root,evidence)
        run.update(state=state,evidence=evidence);_save(project,root,registration,data)
