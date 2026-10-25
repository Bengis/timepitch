"""Frozen K1 research closure. Loading a profile never authorizes execution."""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

from .coordination_evidence import STUDY,verify_source_archive
from .coordination_wire import CAPS,WINDOWS,VERSION
from .physical_wire import canonical,digest

PROJECT_ROOT=Path(__file__).resolve().parents[4]
DESCRIPTOR=STUDY+'/coordination.json'
NATIVE='.local/grf-coordination-native'
RUN_ROOT='.local/grf-physical-work/coordination'
POLICY=dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.70,switch_penalty=.10,
    hold_ms=800,assignment_ms=400,close_m=2.,distant_m=6.,cover_strip_m=12.,formation_leash_m=6.)
MATCH_CAPS=dict(child_seconds=600,private_bytes=512*1024*1024,samples=75001,events=100000,
    chunk_samples=1000,chunk_compressed=1024*1024,chunk_expanded=4*1024*1024,
    replay_compressed=32*1024*1024,replay_expanded=256*1024*1024,stdout=48*1024*1024,manifest=1024*1024,
    physics_ms=7440000,half_ms=3720000)


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def read(path):
    path=Path(path)
    if path.stat().st_size>8*1024*1024:raise ValueError('Profile metadata exceeds bound')
    return json.loads(path.read_text(encoding='utf-8-sig'))
def artifact(project,name):
    path=(project/name).resolve()
    if Path(name).is_absolute() or '..' in Path(name).parts or not path.is_relative_to(project):raise ValueError('Profile artifact outside project')
    return path
def sources(project):
    paths=list((project/'backend/src/timepitch').rglob('*.py'))+[project/'backend/src/timepitch/grf/assets.json',project/STUDY/'build_coordination.py',
        project/'backend/tests/fixtures/grf/coordination_policy_fixture.cpp']
    return {p.relative_to(project).as_posix():sha(p) for p in sorted(paths)}
def runtime_snapshot(project,python):
    root=artifact(project,python).parent
    files=[p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc']
    if len(files)<1000:raise ValueError('Complete existing Python/GRF runtime required')
    return {p.relative_to(project).as_posix():sha(p) for p in sorted(files)}
def _project(project):
    project=Path(project).resolve()
    if project!=PROJECT_ROOT.resolve():raise ValueError('Canonical coordination project required')
    return project
def _native_files(project,build):
    refs={STUDY+'/k1-build.json':sha(project/STUDY/'k1-build.json'),STUDY+'/k1-policy.patch':build['patch_sha256'],
        NATIVE+'/provenance/source-tree.json':build['source_tree_sha256'],NATIVE+'/Release/_gameplayfootball.pyd':build['native_binary_sha256']}
    refs.update({NATIVE+'/source/'+n:h for n,h in build['source_files'].items()})
    refs.update({NATIVE+'/build/'+n:h for n,h in build['project_sha256'].items()})
    refs.update({NATIVE+'/Release/'+n:h for n,h in build['dependencies'].items()})
    refs.update({STUDY+'/native/'+n:h for n,h in build['headers'].items()})
    refs.update(build['parent_files'])
    refs[NATIVE+'/provenance/exports-final.log']=build['static_exports_sha256']
    for name,h in build['build_logs'].items():
        candidates=[project/NATIVE/'provenance'/f'{name}{suffix}.log' for suffix in ('-build','-verify-build')]
        matches=[p for p in candidates if p.is_file() and sha(p)==h]
        if len(matches)!=1:raise ValueError('Native build log changed/missing: '+name)
        refs[matches[0].relative_to(project).as_posix()]=h
    for name,record in build['actual_compile_records'].items():
        matches=list((project/NATIVE/'build'/f'{name}.dir/Release').glob('*.tlog/CL.command.1.tlog'))
        if len(matches)!=1 or sha(matches[0])!=record['sha256']:raise ValueError('Actual native compiler record changed: '+name)
        refs[matches[0].relative_to(project).as_posix()]=record['sha256']
    replay=read(project/STUDY/'k1-replay-build.json')
    if replay['native_build_sha256']!=sha(project/STUDY/'k1-build.json') or replay['exit_code']!=0 or replay['native_imported'] is not False:raise ValueError('Pure replay build mismatch')
    refs[STUDY+'/k1-replay-build.json']=sha(project/STUDY/'k1-replay-build.json')
    refs[replay['executable']]=replay['executable_sha256']
    for name,h in replay['source_sha256'].items():
        if sha(artifact(project,name))!=h:raise ValueError('Pure replay fixture/header changed')
    return refs


def load_coordination_document(project):
    """Portable verifier also used before the worker can import native code."""
    project=_project(project)
    try:
        value=read(project/DESCRIPTOR);build=read(project/STUDY/'k1-build.json');proof=verify_source_archive(project)
        if (value['schema_version']!='grf-coordination-profile-1' or value['candidate_id']!='k1' or value['policy_version']!=VERSION or
            value['policy']!=POLICY or value['caps']!=MATCH_CAPS or value['sidecar_caps']!=CAPS or value['windows']!=[list(x) for x in WINDOWS] or
            value['root']!=RUN_ROOT or value['authorization_issued'] is not False or
            value['modes']!={'observe':'observe','calibration':'apply','heldout':'apply'}):raise ValueError('Frozen coordination descriptor changed')
        if (build['schema_version']!='grf-coordination-build-1' or build['candidate_id']!='k1' or build['policy_version']!=VERSION or
            build['build_exit_code']!=0 or build['native_imported'] is not False or build['native_core_created'] is not False or
            build['native_dir']!=NATIVE+'/Release' or len(build['source_files'])!=691 or len(build['project_sha256'])!=12 or
            len(build['dependencies'])!=14 or value['build_manifest_sha256']!=sha(project/STUDY/'k1-build.json') or
            value['native_sha256']!=build['native_binary_sha256']):raise ValueError('Frozen K1 build identity')
        if read(project/NATIVE/'provenance/source-tree.json')!=build['source_files']:raise ValueError('K1 source tree manifest changed')
        actual={p.relative_to(project/NATIVE/'source').as_posix() for p in (project/NATIVE/'source').rglob('*') if p.is_file()}
        if actual!=set(build['source_files']):raise ValueError('K1 source closure membership changed')
        if {p.name for p in (project/NATIVE/'Release').glob('*.dll')}!=set(build['dependencies']):raise ValueError('K1 dependency membership changed')
        refs=_native_files(project,build)
        if value['native_files']!=refs:raise ValueError('K1 artifact closure changed')
        for name,h in refs.items():
            if sha(artifact(project,name))!=h:raise ValueError('K1 native/parent artifact changed: '+name)
        for name,h in build['headers'].items():
            if sha(project/NATIVE/'source/src'/name)!=h:raise ValueError('Compiled header differs from reviewed solver/adapter')
        compiler=build['compiler']
        if (sha(Path(compiler['path']))!=compiler['sha256'] or
            any(sha(Path(command[0]))!=compiler['msbuild_sha256'] for command in build['commands'].values())):raise ValueError('Compiler/MSBuild changed')
        if value['measurement_sha256']!=sources(project):raise ValueError('K1 measurement/source closure changed')
        if value['historical_binding_sha256']!=sha(project/STUDY/'legacy-source-binding.json') or (
            proof['historical_source_files'],proof['parent_files'],proof['protected_artifacts'])!=(109,10,1554):raise ValueError('Historical archive changed')
        payloads=value['payloads'];expected={f'{s}/{i:02}' for s,n in (('calibration',8),('heldout',24)) for i in range(1,n+1)}
        parent=read(project/'.local/grf-physical-work/continuation/candidate-bindings/c4.json')
        if set(payloads)!=expected or payloads!=parent['payloads'] or value['settings']!=parent['native_profile']['settings']:raise ValueError('Original full32 payloads/settings changed')
        if value['payload_sha256']!={k:digest(v) for k,v in payloads.items()}:raise ValueError('Frozen full payload identity')
        campaign=read(project/'research/engine-evaluation/2026-10-17-grf-physical-validation/campaign.json')
        if value['python']!=campaign['python'] or sha(artifact(project,campaign['dataset']))!=campaign['dataset_sha256']:raise ValueError('Historical data/runtime changed')
        if value['runtime_sha256']!=runtime_snapshot(project,value['python']):raise ValueError('Python/GRF dependency runtime closure changed')
        return value
    except (OSError,KeyError,TypeError,json.JSONDecodeError) as e:raise ValueError('Missing/invalid frozen coordination profile') from e


@dataclass(frozen=True)
class CoordinationProfile:
    project:Path
    identity:str
    native_sha256:str
    build_manifest_sha256:str
    native_dir:Path
    python_path:Path
    payloads:object
    settings:object
    document:object
    id:str='k1'
    policy_version:str=VERSION

    def payload(self,key):
        from .candidate_profiles import plain
        return plain(self.payloads[key])


def load_coordination_profile(project=PROJECT_ROOT):
    from .candidate_profiles import freeze,FrozenSettings
    project=_project(project);value=load_coordination_document(project)
    return CoordinationProfile(project,digest(value),value['native_sha256'],value['build_manifest_sha256'],
        project/NATIVE/'Release',project/value['python'],freeze(value['payloads']),FrozenSettings.model_validate(value['settings']),freeze(value))


def freeze_coordination_profile(project=PROJECT_ROOT):
    """Offline reviewable closure, deliberately no grant, reservation or root creation."""
    project=_project(project);proof=verify_source_archive(project);build=read(project/STUDY/'k1-build.json')
    parent=read(project/'.local/grf-physical-work/continuation/candidate-bindings/c4.json')
    campaign=read(project/'research/engine-evaluation/2026-10-17-grf-physical-validation/campaign.json')
    value=dict(schema_version='grf-coordination-profile-1',candidate_id='k1',policy_version=VERSION,policy=POLICY,
        caps=MATCH_CAPS,sidecar_caps=CAPS,windows=WINDOWS,root=RUN_ROOT,authorization_issued=False,
        modes=dict(observe='observe',calibration='apply',heldout='apply'),
        native_sha256=build['native_binary_sha256'],build_manifest_sha256=sha(project/STUDY/'k1-build.json'),native_files=_native_files(project,build),
        measurement_sha256=sources(project),historical_binding_sha256=sha(project/STUDY/'legacy-source-binding.json'),
        archive_counts={k:proof[k] for k in ('historical_source_files','parent_files','protected_artifacts')},
        settings=parent['native_profile']['settings'],payloads=parent['payloads'],payload_sha256={k:digest(v) for k,v in parent['payloads'].items()},
        python=campaign['python'],runtime_sha256=runtime_snapshot(project,campaign['python']),
        coordinate_frame='native common controller frame;mirror_sign maps both x/y to replay frame',
        native_actor_identity='GetStableID;players preserve GetAllPlayers order within native team0/team1',
        state_origins=dict(observe='isolated_native_shadow',apply='native_assignment_transaction'),
        transaction_windows='start inclusive,end exclusive;sample endpoints inclusive;initial state before first transaction')
    with (project/DESCRIPTOR).open('xb') as f:f.write(canonical(value)+b'\n')
    return load_coordination_profile(project)
