"""Stdlib-only shared parent/3.10-child launch verifier. No grant initializer.

The successor document is written only by Phase4, after final source edits.
Reading or denying a launch creates neither a root nor a reservation.
"""
from dataclasses import dataclass
import hashlib
from pathlib import Path,PurePosixPath
import re
from .physical_wire import canonical,digest
from .shot_context_wire import _json,keys,_identity
from .m1_wire import POLICY,write_exclusive

PROJECT=Path(__file__).resolve().parents[4]
STUDY='research/engine-evaluation/2026-10-18-grf-clock-m1-worker'
FREEZE=STUDY+'/worker-profile.json'
WITNESS='.local/grf-m1-worker-profile-initialized.json'
RUN_ROOT='.local/grf-physical-work/priority-continuity'
ANCHOR='.local/grf-priority-continuity-authorization-initialized.json'
PARENT='ccdccdbd9d7efbabc7450d59f8c3e7e47431984562d8212d875689b80c3e8a9c'
NATIVE='.local/grf-m1-worker-native/revisions/a67476dad1885054/Release'
NATIVE_SHA='23351c012319cb00f6bab969a485010a0f86318a11185b61f2628e97d09dfe74'
PHASE2_SHA='c57a416f30ccf70c9b54ec8933d9692ca9d3391474ab334c55c68441ef7b0b2d'
IDS=('M-observe-42',)+tuple(f'm1/calibration/{i:02}' for i in range(1,9))+tuple(f'm1/heldout/{i:02}' for i in range(1,25))
ALL_IDS=IDS+('m1/R-selected','m1/W-local')


def sha(path):
    h=hashlib.sha256()
    try:
        with Path(path).open('rb') as stream:
            for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    except OSError as e:raise ValueError('Missing frozen M1 artifact') from e
    return h.hexdigest()


def artifact(project,name):
    if type(name) is not str or '\\' in name or ':' in name or not name or PurePosixPath(name).is_absolute() or any(p in ('','..','.') for p in name.split('/')):
        raise ValueError('M1 canonical relative path required')
    project=Path(project).resolve();raw=project.joinpath(*name.split('/'));resolved=raw.resolve()
    if raw!=resolved or not resolved.is_relative_to(project):raise ValueError('M1 path/symlink escape')
    return resolved


def read(path,limit=8*1024*1024):
    try:
        with Path(path).open('rb') as stream:raw=stream.read(limit+1)
        if len(raw)>limit:raise ValueError('M1 JSON budget')
        return _json(raw)
    except OSError as e:raise ValueError('Missing M1 freeze/grant/evidence') from e


def mode_for(run_id):
    if type(run_id) is not str or run_id not in IDS:raise ValueError('Fixed selected M1 research ID required')
    return 'observe' if run_id=='M-observe-42' else 'apply'


def payload_key(run_id):
    mode_for(run_id)
    return 'calibration/01' if run_id=='M-observe-42' else '/'.join(run_id.split('/')[1:])


def _files(project,mapping):
    if type(mapping) is not dict or not mapping:raise ValueError('Nonempty frozen closure required')
    for name,h in mapping.items():
        if type(h) is not str or not re.fullmatch('[0-9a-f]{64}',h) or sha(artifact(project,name))!=h:
            raise ValueError('Frozen source/runtime/build/parent changed')


def verify_profile(project):
    project=Path(project).resolve();d=read(artifact(project,FREEZE))
    keys(d,('schema_version','worker_status','native_authorized','web_admitted','parent_profile','clock_policy',
        'python_path','native_dir','native_sha256','build_manifest_sha256','source_sha256','runtime_sha256',
        'static_sha256','parent_sha256','inventories','payloads','compatibility_sha256','parent'))
    if (d['schema_version']!='m1-worker-profile-1' or d['worker_status']!='offline-validated' or d['native_authorized'] is not False or
        d['web_admitted'] is not False or d['parent_profile']!=PARENT or d['clock_policy']!=POLICY):
        raise ValueError('Successor research freeze required; no legacy admission')
    parent=d['parent']
    keys(parent,('used','maximum','candidates','terminal_id','files','heldout_opened','selection_sealed','legacy_retired'))
    if (type(parent['used']) is not int or type(parent['maximum']) is not int or type(parent['candidates']) is not int or
        (parent['used'],parent['maximum'],parent['candidates'],parent['terminal_id'])!=(41,72,5,'k1/calibration/03') or
        parent['heldout_opened'] is not False or parent['selection_sealed'] is not False or parent['legacy_retired'] is not True or
        parent['files']!=d['parent_sha256']):raise ValueError('Original terminal parent budget/history required')
    identity=digest(d)
    if read(artifact(project,WITNESS))!=dict(schema_version='m1-worker-freeze-witness-1',profile_identity=identity,descriptor_sha256=sha(artifact(project,FREEZE))):
        raise ValueError('Lost/changed successor witness; never refreeze')
    combined={}
    for k in ('source_sha256','runtime_sha256','static_sha256','parent_sha256'):
        _files(project,d[k]);combined.update(d[k])
    if type(d['inventories']) is not list or not d['inventories']:raise ValueError('Exact closure membership required')
    for inventory in d['inventories']:
        keys(inventory,('root','pattern','members'))
        folder=artifact(project,inventory['root'])
        if inventory['pattern'] not in ('*.py','*','test_grf_m1_*.py','*.hpp','archive:*'):raise ValueError('Fixed membership pattern')
        raw_archive=inventory['pattern']=='archive:*'
        actual={p.relative_to(project).as_posix() for p in folder.rglob('*' if raw_archive else inventory['pattern'])
            if p.is_file() and (raw_archive or '__pycache__' not in p.parts and p.suffix!='.pyc')}
        if actual!=set(inventory['members']) or not actual<=set(combined):raise ValueError('Frozen closure membership changed')
        for name in actual:artifact(project,name)
    if set(d['payloads'])!={f'{split}/{i:02}' for split,n in (('calibration',8),('heldout',24)) for i in range(1,n+1)}:
        raise ValueError('Original32 payloads required')
    binary=artifact(project,d['native_dir']+'/_gameplayfootball.pyd');python=artifact(project,d['python_path'])
    if (not python.is_file() or d['python_path'] not in d['runtime_sha256'] or
        d['native_dir']+'/_gameplayfootball.pyd' not in d['static_sha256'] or sha(binary)!=d['native_sha256'] or
        sha(artifact(project,STUDY+'/worker-build.json'))!=d['build_manifest_sha256']):raise ValueError('Frozen runtime/build binding')
    compatibility=read(artifact(project,STUDY+'/clock-compatibility.json'))
    if sha(artifact(project,STUDY+'/clock-compatibility.json'))!=d['compatibility_sha256'] or compatibility.get('status')!='compatible':
        raise ValueError('Saved-control compatibility required')
    if project==PROJECT.resolve() and (d['native_dir']!=NATIVE or d['native_sha256']!=NATIVE_SHA or d['build_manifest_sha256']!=PHASE2_SHA):
        raise ValueError('Consume exact Phase2 revision; never rebuild at launch')
    return d,identity


@dataclass(frozen=True)
class VerifiedLaunch:
    project:Path
    root:Path
    run_id:str
    mode:str
    identity:dict
    evidence:Path
    document:dict
    grant_sha256:str

    @property
    def native_sha256(self):return self.identity['native_sha256']
    @property
    def profile_identity(self):return self.identity['profile_identity']


def _authorization(project,d,h):
    root=artifact(project,RUN_ROOT)
    for name in ('authorization.json','approval.json','supplement.json','authorization-witness.json'):
        artifact(project,RUN_ROOT+'/'+name)
    grant=read(root/'authorization.json');approval=read(root/'approval.json')
    expected=dict(schema_version='m1-worker-authorization-1',profile_identity=h,maximum=76,parent_used=41,parent_candidates=5,
        candidate_limit=6,run_ids=list(ALL_IDS),clock_policy=POLICY,compatibility_sha256=d['compatibility_sha256'],
        parent_snapshot=d['parent'],approval_sha256=sha(root/'approval.json'))
    if canonical(grant)!=canonical(expected):raise ValueError('Explicit linked successor grant required')
    if (canonical(approval)!=canonical(dict(schema_version='m1-worker-user-approval-1',profile_identity=h,explicit_native=True,
        execute_phase=5,maximum=76,candidate_limit=6,run_ids=list(ALL_IDS),clock_policy=POLICY,user_statement=approval.get('user_statement'))) or
        type(approval['user_statement']) is not str or not approval['user_statement'].strip()):raise ValueError('Explicit user approval required')
    for name in ('supplement.json','authorization-witness.json'):
        if canonical(read(root/name))!=canonical(grant):raise ValueError('Permanent linked grant witness missing')
    if canonical(read(artifact(project,ANCHOR)))!=canonical(grant):raise ValueError('Permanent authorization anchor missing')
    return digest(grant)


def verify_authorization(project):
    """Portable grant consumer shared with the parent; no allocator/initializer."""
    project=Path(project).resolve();d,h=verify_profile(project)
    return d,h,_authorization(project,d,h)


def verify_selection(project,d,h,state,*,require_sealed=True,require_approval=True):
    """Portable parent/child selection gate; reads calibration, never heldout outcomes."""
    from .continuity_campaign import evaluate_continuity_gates
    root=artifact(project,RUN_ROOT);report=state['calibration_report']
    if type(report) is not dict or report.get('qualified') is not True:raise ValueError('Complete qualified calibration required')
    rows=[]
    for i in range(1,9):
        id=f'm1/calibration/{i:02}';entry=state['runs'].get(id,{})
        path=artifact(project,RUN_ROOT+'/evidence/'+id+'/measurement.json')
        if (entry.get('state')!='ready' or entry.get('profile_identity')!=h or
            entry.get('payload_sha256')!=digest(d['payloads'][f'calibration/{i:02}']) or sha(path)!=entry.get('result_sha256')):
            raise ValueError('Complete bound calibration selection required')
        row=read(path)
        if (row.get('run_id')!=id or row.get('profile_identity')!=h or row.get('payload_sha256')!=entry['payload_sha256']):
            raise ValueError('Calibration measurement identity changed')
        rows.append(row)
    gates=evaluate_continuity_gates(rows,expected=8)
    if not all(gates.values()) or canonical(report.get('rows'))!=canonical(rows) or canonical(report.get('gates'))!=canonical(gates):
        raise ValueError('Qualified calibration report changed')
    expected=dict(profile_identity=h,calibration_report_sha256=digest(report),
        payload_sha256={f'heldout/{i:02}':digest(d['payloads'][f'heldout/{i:02}']) for i in range(1,25)})
    if require_sealed or state['selection'] is not None:
        if canonical(state['selection'])!=canonical(expected):raise ValueError('Sealed selection changed')
        for name in ('selection/freeze.json','selection-registration.json','selection-initialized.json'):
            if canonical(read(artifact(project,RUN_ROOT+'/'+name)))!=canonical(expected):raise ValueError('Missing/changed selection witness')
    if require_approval:
        approved=dict(profile_identity=h,selection_sha256=digest(expected),execute_phase=6,explicit_native=True)
        if canonical(read(artifact(project,RUN_ROOT+'/phase6-approval.json')))!=canonical(approved):raise ValueError('Separate explicit Phase6 selection required')
    return expected


def _authorized(project,root,run_id,payload):
    mode=mode_for(run_id);project=Path(project).resolve()
    if Path(root).absolute()!=artifact(project,RUN_ROOT):raise ValueError('Canonical shared campaign root required')
    root=artifact(project,RUN_ROOT);d,h=verify_profile(project)
    for name in ('authorization.json','approval.json','supplement.json','authorization-witness.json','checkpoint.json',
        'events.jsonl','registration.json','initialized.json','phase6-approval.json'):
        artifact(project,RUN_ROOT+'/'+name)
    if len(canonical(payload))>32768 or canonical(payload)!=canonical(d['payloads'][payload_key(run_id)]):
        raise ValueError('Full frozen payload mismatch')
    grant_sha256=_authorization(project,d,h)
    phase=6 if '/heldout/' in run_id else 5
    state=read(root/'checkpoint.json');raw_path=root/'events.jsonl'
    with raw_path.open('rb') as stream:raw=stream.read(2*1024*1024+1)
    if not raw or len(raw)>2*1024*1024:raise ValueError('Append-only journal budget')
    keys(state,('schema_version','grant_sha256','runs','terminal_failure','observe_proof','calibration_report','selection','heldout_opened'))
    receipt=dict(grant_sha256=grant_sha256,checkpoint_sha256=digest(state),events_sha256=hashlib.sha256(raw).hexdigest())
    for name in ('registration.json','initialized.json'):
        if read(root/name)!=receipt:raise ValueError('Reservation witness changed')
    prefix=b''
    for seq,line in enumerate(raw.splitlines(keepends=True)):
        event=_json(line)
        if event.get('seq')!=seq or event.get('previous')!=hashlib.sha256(prefix).hexdigest():raise ValueError('Append-only journal changed')
        prefix+=line
    if event.get('checkpoint')!=digest(state) or state['schema_version']!='m1-ledger-1' or state['grant_sha256']!=grant_sha256 or state['terminal_failure'] is not None:
        raise ValueError('Stopped/changed campaign')
    if not set(state['runs'])<=set(ALL_IDS) or len(state['runs'])>35:raise ValueError('Cumulative quota')
    entry=state['runs'].get(run_id)
    if entry!=dict(state='reserved',profile_identity=h,payload_sha256=digest(payload),result_sha256=None):raise ValueError('Consumed exclusive reservation required')
    if mode=='apply':
        if state['observe_proof'] is None or state['runs'].get('M-observe-42',{}).get('state')!='ready':raise ValueError('Passive acceptance required')
        split=run_id.split('/')[1];index=int(run_id.rsplit('/',1)[1])
        if any(state['runs'].get(f'm1/{split}/{i:02}',{}).get('state')!='ready' for i in range(1,index)):
            raise ValueError('Fixed predecessor order')
    elif set(state['runs'])!={'M-observe-42'}:raise ValueError('Passive stage permanently closed')
    if phase==6:
        if state['selection'] is None or not state['heldout_opened']:raise ValueError('Sealed selection required')
        verify_selection(project,d,h,state)
    identity=dict(run_id=run_id,mode=mode,input_hash=payload['input_hash'],native_sha256=d['native_sha256'],profile_identity=h,build_manifest_sha256=d['build_manifest_sha256'])
    _identity(identity);evidence=artifact(project,RUN_ROOT+'/evidence/'+run_id)
    return VerifiedLaunch(project,root,run_id,mode,identity,evidence,d,grant_sha256)


def prepare_launch(project,root,run_id,payload):
    """Parent witness only, after an existing ledger reservation; no allocator."""
    launch=_authorized(project,root,run_id,payload)
    from .continuity_budget import global_lock
    with global_lock(launch.project):
        fresh=_authorized(project,root,run_id,payload)
        if fresh!=launch:raise ValueError('Launch changed between checks')
        # Evidence directory is created by the authorized ledger/caller, not here.
        write_exclusive(launch.evidence/'launch.json',dict(identity=launch.identity,grant_sha256=launch.grant_sha256))
    return launch


def verify_launch(project,root,run_id,payload):
    launch=_authorized(project,root,run_id,payload)
    witness=dict(identity=launch.identity,grant_sha256=launch.grant_sha256)
    path=artifact(launch.project,launch.evidence.relative_to(launch.project).as_posix()+'/launch.json')
    if read(path)!=witness:raise ValueError('Exclusive parent launch required')
    from .continuity_budget import global_lock
    with global_lock(launch.project):
        if _authorized(project,root,run_id,payload)!=launch:raise ValueError('Frozen files changed between checks')
        write_exclusive(launch.evidence/'worker-claimed.json',witness)
    return launch


def recheck_launch(launch,payload):
    """Last check before loader import; the exclusive claim remains consumed."""
    from .continuity_budget import global_lock
    with global_lock(launch.project):
        if _authorized(launch.project,launch.root,launch.run_id,payload)!=launch:raise ValueError('Source changed before import')
        witness=dict(identity=launch.identity,grant_sha256=launch.grant_sha256)
        path=artifact(launch.project,launch.evidence.relative_to(launch.project).as_posix()+'/worker-claimed.json')
        if read(path)!=witness:raise ValueError('Worker claim missing')
