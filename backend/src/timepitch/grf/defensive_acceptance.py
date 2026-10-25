"""Registered offline equivalence; never changes the consumed probe or runs GRF."""
import math
import os
from pathlib import Path
from . import physical_campaign_budget as campaign
from . import defensive_probe_budget as probe
from .action_models import ActionManifest
from .action_codec import ActionStreamValidator
from .action_validation import RetainedResult
from .defensive_probe_wire import validate_defense_sidecar
from .physical_codec import manifest_hash
from .physical_wire import canonical

DESIGN='docs/superpowers/specs/2026-10-17-grf-causal-intervention-design.md'
AUTHORIZATION='research/engine-evaluation/2026-10-17-grf-defensive-calibration/phase1-authorization.json'
STATEMENT='Sí, apruebo el diseño y el plan, incluidas las dos enmiendas. Empieza por la fase 1.'
SCHEMA='grf-defensive-analysis-acceptance-1'


def _paths(root):
    root,lock=campaign._locations(root)
    extension=root.with_name('defensive-probe')
    return (root,lock,extension/'analysis-acceptance.json',
        root.parent/'defensive-probe-analysis-registration.json',
        root.parent/'defensive-probe-analysis-initialized.json')


def _compare_manifests(left,right):
    for m in (left,right):
        if not isinstance(m,ActionManifest) or manifest_hash(m)!=m.trace_hash:
            raise ValueError('Unbound action manifest')
    excluded={'native_binary_sha256','trace_hash','attribute_readbacks'}
    if left.model_dump(mode='json',exclude=excluded)!=right.model_dump(mode='json',exclude=excluded):
        raise ValueError('Capture differs beyond readback order/native identity')
    def keyed(m):
        records=[r.model_dump(mode='json') for r in m.attribute_readbacks]
        found={(r['side'],r['slot'],r['attribute']):r for r in records}
        expected={(p.side,p.slot,k) for p in m.input.players for k in p.attributes}
        if len(records)!=66 or len(found)!=66 or set(found)!=expected:
            raise ValueError('Missing or duplicate readback identity')
        return found
    a,b=keyed(left),keyed(right)
    if a!=b:raise ValueError('Readback values changed')
    if left.attribute_readbacks==right.attribute_readbacks:
        raise ValueError('Expected the approved readback ordering exception')
    return dict(readbacks=66,keyed_readbacks_equal=True,
        ordered_readbacks_equal=left.attribute_readbacks==right.attribute_readbacks,
        readbacks_sha256=campaign._digest([a[k] for k in sorted(a)]),
        blocks=len(left.chunks),samples=sum(r.samples for r in left.chunks),
        control_trace_hash=left.trace_hash,probe_trace_hash=right.trace_hash)


def _capture_proof(project,descriptor,state,build):
    control_path=project/descriptor['control']['result_path']
    evidence=campaign._artifact(project/'.local/grf-physical-work/defensive-probe',state['run']['evidence']['result_path'])
    control=RetainedResult(control_path);captured=RetainedResult(evidence)
    left,right=control.manifest,captured.manifest
    identity=dict(input_hash=descriptor['control']['input_hash'],native_sha256=build['native_binary_sha256'],
        descriptor_sha256=campaign._sha(project/probe.DESCRIPTOR),build_manifest_sha256=campaign._sha(project/probe.BUILD_MANIFEST))
    if (left.native_binary_sha256!=descriptor['control']['native_sha256'] or
        right.native_binary_sha256!=identity['native_sha256'] or
        left.trace_hash!=descriptor['control']['trace_hash'] or left.input.input_hash!=identity['input_hash'] or
        campaign._read(evidence/'launch.json')!=identity):raise ValueError('Capture provenance changed')
    proof=_compare_manifests(left,right)
    first=ActionStreamValidator(left.input,left.native_binary_sha256)
    second=ActionStreamValidator(right.input,right.native_binary_sha256,_research_native_sha256=identity['native_sha256'])
    # Exact compressed bytes let both independent validators consume each
    # decoded chunk once; neither source or manifest is normalized/replaced.
    for chunk in control.chunks():
        name=f'{chunk.index}.zlib'
        if (control_path/name).read_bytes()!=(evidence/name).read_bytes():raise ValueError('Gameplay block changed')
        first.append(chunk);second.append(chunk)
    first.finish(left);second.finish(right)
    sidecar=validate_defense_sidecar(evidence/'defense.jsonl',manifest=right,
        descriptor=dict(identity=identity,windows=descriptor['windows']))
    failure=campaign._read(evidence/'failure.json')
    if (failure!=state['run']['evidence']['error'] or failure.get('type')!='ValueError' or
        failure.get('message')!='Research manifest differs beyond native SHA/trace' or
        failure.get('last_received_physics_ms')!=right.duration_ms):raise ValueError('Not the approved complete ordering failure')
    for key,limit in (('wall_seconds',600),('peak_private_bytes',536870912)):
        value=failure.get(key)
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<value<=limit:
            raise ValueError('Capture resource limit')
    frozen=campaign._read(project/(probe.STUDY+'/defensive-probe-transport-freeze.json'))
    if (frozen['native_sha256']!=identity['native_sha256'] or frozen['old_native_sha256']!=left.native_binary_sha256 or
        frozen['historical_freeze_sha256']!=campaign._sha(project/(probe.STUDY+'/technical-freeze.json')) or
        build['patch_sha256']!=campaign._sha(project/(probe.STUDY+'/native-defensive-probe.patch'))):
        raise ValueError('Historical provenance changed')
    proof.update(sidecar=sidecar,input_hash=identity['input_hash'],identity=identity,
        wall_seconds=failure['wall_seconds'],peak_private_bytes=failure['peak_private_bytes'])
    return proof


def _snapshot(project,root,state):
    """Pin immutable evidence, excluding the legitimately evolving old ledger."""
    _,extension,registration=probe._paths(root.with_name('defensive-probe'))
    if probe._load(project,extension,registration)!=state:raise ValueError('Probe checkpoint changed')
    run=state['run'];d=state['descriptor']
    if run is None or run['id']!=probe.RUN_ID or run['state']!='failed':raise ValueError('Expected consumed failed probe')
    build=campaign._read(project/probe.BUILD_MANIFEST)
    build_sha=probe._verify_build(project,d,build['native_binary_sha256'])
    if run['binding']!=dict(input_hash=d['control']['input_hash'],native_sha256=build['native_binary_sha256'],build_manifest_sha256=build_sha):
        raise ValueError('Probe build/input binding changed')
    control=project/d['control']['result_path'];evidence=campaign._verify_evidence(extension,run['evidence'])
    for name,h in d['control']['files'].items():
        if campaign._sha(campaign._artifact(control,name))!=h:raise ValueError('Control bytes changed')
    files={}
    def add(path):
        path=path.resolve()
        if not path.is_relative_to(project):raise ValueError('Acceptance artifact outside project')
        files[path.relative_to(project).as_posix()]=campaign._sha(path)
    for name in (DESIGN,AUTHORIZATION,probe.DESCRIPTOR,probe.BUILD_MANIFEST,
        probe.STUDY+'/defensive-probe-report.json',probe.STUDY+'/native-defensive-probe.patch',
        probe.STUDY+'/defensive-probe-transport-freeze.json',probe.STUDY+'/technical-freeze.json'):
        add(project/name)
    for path in (extension/'checkpoint.json',registration,extension.parent/'defensive-probe-initialized.json'):add(path)
    # Campaign descriptor/parent are immutable. The continuation checkpoint and
    # registration are separately recorded at grant, not pinned forever here.
    for name in d['original_files']:
        if name not in {str((root/'checkpoint.json').relative_to(project).as_posix()),
            str((root.parent/'continuation-registration.json').relative_to(project).as_posix())}:
            add(project/name)
    for name in d['control']['files']:add(campaign._artifact(control,name))
    for name in run['evidence']['files']:add(campaign._artifact(evidence,name))
    old=campaign._read(project/(probe.STUDY+'/campaign.json'))
    for directory,dependencies in ((project/build['binary_output'],build['dependencies']),
        (project/old['native_dirs']['actions'],d['control']['dependencies'])):
        add(directory/'_gameplayfootball.pyd')
        for name,expected in dependencies.items():
            if Path(name).name!=name or campaign._sha(directory/name)!=expected:raise ValueError('Dependency changed')
            add(directory/name)
    if campaign._sha(project/old['native_dirs']['actions']/'_gameplayfootball.pyd')!=d['control']['native_sha256']:
        raise ValueError('Control native changed')
    return files,build


def _authorization(project,approved_design_sha256,authorization_ref):
    if authorization_ref!=AUTHORIZATION or approved_design_sha256!=campaign._sha(project/DESIGN):
        raise ValueError('Approved design and canonical authorization required')
    authorization=campaign._read(project/AUTHORIZATION)
    if authorization!=dict(schema_version='grf-defensive-analysis-authorization-1',user_statement=STATEMENT,
        approved_design_sha256=approved_design_sha256,execute_phase=1,
        scope=['supplemental_equivalence_registration','incremental_c5_design']):
        raise ValueError('Missing phase1 and amendment authorization')


def validate_probe_equivalence(project:Path)->dict:
    project=Path(project).resolve()
    if project!=campaign.PROJECT_ROOT.resolve():raise ValueError('Use canonical project')
    root,lock,*_= _paths(project/'.local/grf-physical-work/continuation')
    with campaign._lock(lock):
        old=campaign._load(root,lock)
        _,extension,registration=probe._paths(root.with_name('defensive-probe'))
        state=probe._load(project,extension,registration)
        if state['descriptor']['campaign_identity']!=old['identity']:raise ValueError('Campaign identity changed')
        _,build=_snapshot(project,root,state)
        return _capture_proof(project,state['descriptor'],state,build)


def verify_probe_analysis_acceptance_locked(project:Path,root:Path,probe_state:dict)->dict:
    root,_,receipt_path,registration,witness=_paths(root)
    if Path(project).resolve()!=campaign.PROJECT_ROOT.resolve():raise ValueError('Wrong project')
    receipt=campaign._read(receipt_path);registered=campaign._read(registration);marker=campaign._read(witness)
    identity=campaign._digest(receipt)
    expected=dict(root=str(root),identity=identity,receipt_sha256=campaign._sha(receipt_path))
    if registered!=expected or marker!=expected or receipt.get('schema_version')!=SCHEMA:
        raise ValueError('Analysis acceptance registration changed')
    if (receipt['campaign_identity']!=probe_state['descriptor']['campaign_identity'] or receipt['probe_identity']!=probe_state['identity']):
        raise ValueError('Analysis acceptance campaign changed')
    _authorization(project,receipt['approved_design_sha256'],receipt['authorization_ref'])
    files,_=_snapshot(project,root,probe_state)
    if files!=receipt['files']:raise ValueError('Accepted evidence changed')
    return receipt


def register_probe_analysis_acceptance(root:Path,*,approved_design_sha256:str,authorization_ref:str)->dict:
    root,lock,receipt_path,registration,witness=_paths(root);project=campaign.PROJECT_ROOT.resolve()
    _authorization(project,approved_design_sha256,authorization_ref)
    with campaign._lock(lock):
        old=campaign._load(root,lock)
        _,extension,probe_registration=probe._paths(root.with_name('defensive-probe'))
        state=probe._load(project,extension,probe_registration)
        if any(p.exists() for p in (receipt_path,registration,witness)):
            receipt=verify_probe_analysis_acceptance_locked(project,root,state)
            if (receipt['approved_design_sha256']!=approved_design_sha256 or receipt['authorization_ref']!=authorization_ref):
                raise ValueError('Analysis acceptance already bound')
            return receipt
        if (len(old['prior_runs'])+len(old['runs'])!=28 or len(old['candidate_bindings'])!=3 or
            state['descriptor']['campaign_identity']!=old['identity']):raise ValueError('Expected original28 plus consumed probe')
        files,build=_snapshot(project,root,state)
        for name,h in state['descriptor']['original_files'].items():
            if campaign._sha(project/name)!=h:raise ValueError('Pre-grant original baseline changed')
        proof=_capture_proof(project,state['descriptor'],state,build)
        receipt=dict(schema_version=SCHEMA,campaign_identity=old['identity'],probe_identity=state['identity'],
            approved_design_sha256=approved_design_sha256,authorization_ref=authorization_ref,files=files,proof=proof,
            original_checkpoint_at_grant=campaign._sha(root/'checkpoint.json'),
            original_registration_at_grant=campaign._sha(lock),used_at_grant=29,maximum=71,candidates_at_grant=3)
        registered=dict(root=str(root),identity=campaign._digest(receipt),
            receipt_sha256=campaign._digest(receipt))
        # The independent permanent witness is durable before either mutable file.
        with witness.open('xb') as stream:
            stream.write(canonical(registered));stream.flush();os.fsync(stream.fileno())
        campaign._write(receipt_path,receipt);campaign._write(registration,registered)
        return verify_probe_analysis_acceptance_locked(project,root,state)
