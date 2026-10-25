"""Immutable offline successor. Freezing is metadata, never native permission."""
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from . import m1_verifier as wire
from .physical_wire import canonical,digest
from .continuity_profile import freeze,plain
from .m1_wire import write_exclusive

PHASE3_ARCHIVE='.local/grf-m1-worker-phase3-source-archive'
PHASE3_WITNESS=PHASE3_ARCHIVE+'-initialized.json'
PHASE3_BINDING=wire.STUDY+'/phase3-source-binding.json'


def verify_phase3_archive(project):
    root=Path(project).resolve();folder=wire.artifact(root,PHASE3_ARCHIVE)
    record=wire.read(folder/'record.json');anchor=wire.read(wire.artifact(root,PHASE3_BINDING))
    expected=dict(schema_version='m1-worker-phase3-archive-witness-1',record_sha256=wire.sha(folder/'record.json'),
        acceptance_sha256=wire.sha(folder/'phase3-acceptance.json'))
    if anchor!=expected or wire.read(wire.artifact(root,PHASE3_WITNESS))!=expected:
        raise ValueError('TP062 archive witness changed')
    if expected['acceptance_sha256']!=wire.sha(wire.artifact(root,wire.STUDY+'/phase3-acceptance.json')):
        raise ValueError('TP062 archive differs from original acceptance')
    if record['schema_version']!='m1-worker-phase3-archive-1' or record['acceptance_sha256']!=expected['acceptance_sha256']:
        raise ValueError('TP062 archive identity changed')
    accepted=wire.read(folder/'phase3-acceptance.json')
    if record['source_sha256']!=accepted['source_sha256']:raise ValueError('TP062 archive source map changed')
    files={p.relative_to(folder/'source').as_posix() for p in (folder/'source').rglob('*') if p.is_file()}
    if files!=set(record['source_sha256']):raise ValueError('TP062 archive membership changed')
    for name,h in record['source_sha256'].items():
        if wire.sha(wire.artifact(folder/'source',name))!=h:raise ValueError('TP062 raw archived source changed')
    return dict(source_count=len(files),record_sha256=expected['record_sha256'],acceptance_sha256=expected['acceptance_sha256'])


def _verify_compatibility(root):
    report=wire.read(wire.artifact(root,wire.STUDY+'/clock-compatibility.json'))
    accepted=wire.read(wire.artifact(root,wire.STUDY+'/phase1-acceptance.json'))
    # The independently generated report, source map and retained controls are
    # checked below; a handwritten compatible=true cannot replace this proof.
    if report.get('status')!='compatible' or report.get('errors') or len(report.get('complete_controls',[]))!=12:
        raise ValueError('Retained clock compatibility blocked')
    if accepted['evidence_sha256'].get('clock-compatibility.json')!=wire.sha(root/wire.STUDY/'clock-compatibility.json'):
        raise ValueError('Compatibility differs from accepted Phase1 evidence')
    for name,h in report['source_sha256'].items():
        if wire.sha(wire.artifact(root,name))!=h:raise ValueError('Audited clock source changed')
    for name,h in report['checkpoint_sha256'].items():
        if wire.sha(wire.artifact(root,name))!=h:raise ValueError('Audited clock parent changed')
    for item in [*report['complete_controls'],report['failed_prefix']]:
        if item.get('compatible') is not True or item.get('fallback_count')!=0 or item.get('error') is not None:
            raise ValueError('Retained control changed; revise budget/control before native launch')
        for name,h in item['input_sha256'].items():
            if wire.sha(wire.artifact(root,item['path']+'/'+name))!=h:raise ValueError('Retained clock evidence changed')
    # Phase1's immutable report hash is itself linked by Phase2 and the archive.
    phase2=wire.read(wire.artifact(root,wire.STUDY+'/phase2-acceptance.json'))
    if phase2['phase1_acceptance_sha256']!=wire.sha(root/wire.STUDY/'phase1-acceptance.json'):
        raise ValueError('Phase1 acceptance changed')
    return report


def _seal_archive_closure(root,static,inventories,archives,witnesses):
    """Carry verified raw archives and exact membership into portable admission."""
    for name in archives:
        folder=wire.artifact(root,name)
        members=sorted(p.relative_to(root).as_posix() for p in folder.rglob('*') if p.is_file())
        if not members:raise ValueError('Nonempty historical archive required')
        for member in members:static[member]=wire.sha(wire.artifact(root,member))
        inventories.append(dict(root=name,pattern='archive:*',members=members))
    for name in witnesses:static[name]=wire.sha(wire.artifact(root,name))


def gather_worker_inputs(project):
    root=Path(project).resolve()
    if root!=wire.PROJECT.resolve():raise ValueError('Canonical real worker project required')
    from .m1_history import verify_tp058_archive,ARCHIVE,DESCRIPTOR as TP058_DESCRIPTOR,PROFILE_WITNESS,BINDING as TP058_BINDING
    from .continuity_budget import parent_snapshot
    from .coordination_profile import runtime_snapshot
    from .coordination_evidence import verify_source_archive,ARCHIVE as C4_ARCHIVE,STUDY as C4_STUDY
    from .marking_audit import verify_historical_sources,ARCHIVE as K1_ARCHIVE,DESCRIPTOR,BINDING as K1_BINDING
    from .continuity_profile import verify_phase3_archive as verify_native_parent_archive,PHASE3_ARCHIVE as NATIVE_ARCHIVE,STUDY as OLD_STUDY
    verify_tp058_archive(root);verify_phase3_archive(root);verify_source_archive(root)
    verify_historical_sources(root,root/K1_ARCHIVE,wire.read(root/DESCRIPTOR)['measurement_sha256'])
    verify_native_parent_archive(root);compatibility=_verify_compatibility(root)
    verifier=wire.artifact(root,wire.STUDY+'/verify_worker_build.py')
    module=ModuleType('_m1_static_freeze_verifier');module.__file__=str(verifier)
    exec(compile(verifier.read_bytes(),str(verifier),'exec'),module.__dict__)
    module.verify_static_worker(root)
    build=wire.read(root/wire.STUDY/'worker-build.json');native=wire.artifact(root,build['native_dir']);revision=native.parent
    static=dict(build['parent_files'])
    for name,h in build['inputs'].items():static[name]=h
    for group,folder in (('source_files',revision/'source'),('projects',revision/'build'),('dependencies',native)):
        static.update({(folder/n).relative_to(root).as_posix():h for n,h in build[group].items()})
    static[(native/'_gameplayfootball.pyd').relative_to(root).as_posix()]=build['native_binary_sha256']
    # Bind every independently checked provenance artifact, not only the binary.
    for name in ('source-tree.json','exports.log','dependencies.log',*[n+'-build.log' for n in build['build_logs']]):
        p=revision/'provenance'/name;static[p.relative_to(root).as_posix()]=wire.sha(p)
    for n in build['actual_compile_records']:
        p=next((revision/'build'/(n+'.dir/Release')).glob('*.tlog/CL.command.1.tlog'));static[p.relative_to(root).as_posix()]=wire.sha(p)
    for p in native.rglob('*'):
        if p.is_file():static[p.relative_to(root).as_posix()]=wire.sha(p)
    for item in [*compatibility['complete_controls'],compatibility['failed_prefix']]:
        for name,h in item['input_sha256'].items():static[item['path']+'/'+name]=h
    for p in (root/PHASE3_ARCHIVE).rglob('*'):
        if p.is_file():static[p.relative_to(root).as_posix()]=wire.sha(p)
    static[PHASE3_WITNESS]=wire.sha(root/PHASE3_WITNESS)
    for name in ('worker-build.json','verify_worker_build.py','phase1-acceptance.json','phase2-acceptance.json','phase3-acceptance.json',
        'clock-compatibility.json','tp058-source-binding.json','phase3-source-binding.json'):
        p=root/wire.STUDY/name;static[p.relative_to(root).as_posix()]=wire.sha(p)
    original=wire.read(root/ARCHIVE/'metadata'/TP058_DESCRIPTOR)
    python=original['python'];runtime=runtime_snapshot(root,python)
    if runtime!=original['runtime_files']:raise ValueError('Original runtime closure changed')
    sources=list((root/'backend/src/timepitch').rglob('*.py'))+list((root/'backend/tests').glob('test_grf_m1_*.py'))
    sources+=[root/'backend/tests/grf_m1_fixtures.py',root/'backend/tests/grf_offline_guard.py',root/'backend/tests/fixtures/grf/m1_wire_child.py']
    sources+=list((root/wire.STUDY).glob('*.py'))+list((root/wire.STUDY/'native').glob('*.hpp'))
    source_map={p.relative_to(root).as_posix():wire.sha(p) for p in sorted(set(sources))}
    inventories=[]
    # These maps have just been independently verified above. Bind their live
    # protected artifacts too, redirecting historical source entries to archive.
    static.update(original['static_files']);static.update(original['runtime_files']);static.update(original['parent']['files'])
    c4_binding=C4_STUDY+'/legacy-source-binding.json';c4=wire.read(root/c4_binding);k1=wire.read(root/K1_BINDING)
    static.update(c4['parent_files']);static.update(k1['parent_files']);static.update(k1['protected_artifacts'])
    for name,h in c4['evidence_sha256'].items():
        static[C4_ARCHIVE+'/source/'+name if name in c4['measurement_sha256'] else name]=h
    archives=[ARCHIVE,C4_ARCHIVE,K1_ARCHIVE,NATIVE_ARCHIVE,PHASE3_ARCHIVE]
    witnesses=[*(a+'-initialized.json' for a in archives),TP058_DESCRIPTOR,PROFILE_WITNESS,TP058_BINDING,
        c4_binding,K1_BINDING,OLD_STUDY+'/phase3-source-binding.json',OLD_STUDY+'/phase3-acceptance.json',PHASE3_BINDING]
    _seal_archive_closure(root,static,inventories,archives,witnesses)
    for folder,pattern in ((root/'backend/src/timepitch','*.py'),((root/python).parent,'*'),(revision/'source','*'),(native,'*'),
        (root/'backend/tests','test_grf_m1_*.py'),(root/wire.STUDY,'*.py'),(root/wire.STUDY/'native','*.hpp')):
        members=[p.relative_to(root).as_posix() for p in folder.rglob(pattern) if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc']
        inventories.append(dict(root=folder.relative_to(root).as_posix(),pattern=pattern,members=sorted(members)))
    return dict(schema_version='m1-worker-profile-1',worker_status='offline-validated',native_authorized=False,web_admitted=False,
        parent_profile=wire.PARENT,clock_policy=wire.POLICY,python_path=python,native_dir=build['native_dir'],
        native_sha256=build['native_binary_sha256'],build_manifest_sha256=wire.sha(root/wire.STUDY/'worker-build.json'),
        source_sha256=source_map,runtime_sha256=runtime,static_sha256=static,parent_sha256=parent_snapshot(root)['files'],
        inventories=inventories,payloads=original['payloads'],compatibility_sha256=wire.sha(root/wire.STUDY/'clock-compatibility.json'),parent=parent_snapshot(root))


@dataclass(frozen=True)
class WorkerProfile:
    project:Path
    identity:str
    native_sha256:str
    build_manifest_sha256:str
    native_dir:Path
    python_path:Path
    document:object

    def payload(self,key):return plain(self.document['payloads'][key])


def load_worker_profile(project=wire.PROJECT):
    root=Path(project).resolve();d,h=wire.verify_profile(root)
    return WorkerProfile(root,h,d['native_sha256'],d['build_manifest_sha256'],root/d['native_dir'],root/d['python_path'],freeze(d))


def freeze_worker_profile(project=wire.PROJECT):
    root=Path(project).resolve();path=wire.artifact(root,wire.FREEZE);witness=wire.artifact(root,wire.WITNESS)
    if path.exists() or witness.exists():raise ValueError('Successor freeze already attempted; never renew')
    d=gather_worker_inputs(root)
    # Verify the full candidate before consuming its exclusive witness.
    for group in ('source_sha256','runtime_sha256','static_sha256','parent_sha256'):wire._files(root,d[group])
    if wire.read(root/wire.STUDY/'clock-compatibility.json').get('status')!='compatible' or wire.sha(root/wire.STUDY/'clock-compatibility.json')!=d['compatibility_sha256']:
        raise ValueError('Clock compatibility changed before freeze')
    witness.parent.mkdir(parents=True,exist_ok=True);path.parent.mkdir(parents=True,exist_ok=True)
    value=dict(schema_version='m1-worker-freeze-witness-1',profile_identity=digest(d),descriptor_sha256=digest(d))
    write_exclusive(witness,value,8*1024*1024);write_exclusive(path,d,8*1024*1024)
    return load_worker_profile(root)
