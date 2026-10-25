"""One durable continuation of the rejected activity study, never a fresh budget."""
from contextlib import contextmanager
from dataclasses import asdict,dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import time

PROJECT_ROOT=Path(__file__).resolve().parents[4]
TECHNICAL=('T-control','T-actions','T-repeat','T-cancel')
RUN_GROUPS={**dict.fromkeys(TECHNICAL,'technical'),
    **{f'c{c}/calibration/{i:02}':'calibration' for c in (4,5) for i in range(1,9)},
    **{f'selected/heldout/{i:02}':'heldout' for i in range(1,25)},
    'R-selected':'repetition','W-local':'web'}
MAX_PHYSICS_MS=7440000


@dataclass(frozen=True)
class RunSpec:
    id:str
    group:str
    input_hash:str
    native_sha256:str
    maximum_ms:int


@dataclass(frozen=True)
class RunReservation:
    id:str
    reused:bool
    result_path:Path|None


def _digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def _sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _read(path):
    try:return json.loads(path.read_bytes())
    except (OSError,ValueError) as error:raise ValueError('Missing or invalid campaign state; do not reset it') from error


def _write(path,value):
    temporary=path.with_suffix('.tmp')
    with temporary.open('w',encoding='utf-8',newline='\n') as stream:
        json.dump(value,stream,sort_keys=True,separators=(',',':'),allow_nan=False)
        stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


def _locations(root):
    project=PROJECT_ROOT.resolve();expected=project/'.local/grf-physical-work/continuation'
    root=Path(root).resolve()
    if root!=expected.resolve() or not root.is_relative_to(project):raise ValueError('Use the canonical continuation root')
    return root,root.parent/'continuation-registration.json'


@contextmanager
def _lock(registration):
    lock=registration.with_suffix('.lock');deadline=time.monotonic()+5
    while True:
        try:stream=lock.open('x');break
        except FileExistsError:
            if time.monotonic()>=deadline:raise ValueError('Campaign locked; inspect its process before recovery')
            time.sleep(.01)
    try:
        stream.write(str(os.getpid()));stream.flush();yield
    finally:stream.close();lock.unlink()


def _load(root,registration):
    registered=_read(registration);state=_read(root/'checkpoint.json')
    if (registered.get('root')!=str(root) or registered.get('identity')!=state.get('identity') or
        _digest(state['campaign'])!=state['identity'] or
        registered.get('checkpoint_sha256')!=_digest(state)):raise ValueError('Campaign identity or checkpoint changed')
    parent=PROJECT_ROOT/state['campaign']['parent_checkpoint']
    try:unchanged=_sha(parent)==registered['parent_sha256']==state['campaign']['parent_sha256']
    except OSError:unchanged=False
    if not unchanged:raise ValueError('Original experiment changed; preserve and investigate')
    return state


def _save(root,registration,state):
    _write(root/'checkpoint.json',state)
    # A crash between these atomic replacements remains consumed and fails closed.
    _write(registration,dict(identity=state['identity'],root=str(root),
        parent_sha256=state['campaign']['parent_sha256'],checkpoint_sha256=_digest(state)))


def initialize_continuation(parent:Path,campaign:dict,root:Path,*,approved:bool)->None:
    root,registration=_locations(root)
    if approved is not True:raise ValueError('Explicit approved continuation required')
    if (campaign.get('schema_version')!='grf-physical-campaign-1' or
        campaign.get('max_native_matches')!=70 or campaign.get('max_candidates')!=5 or
        set(campaign.get('technical',{}))!=set(TECHNICAL)):
        raise ValueError('Unapproved campaign schema or limits')
    expected_parent=(PROJECT_ROOT/'.local/grf-physical-work/benchmark/checkpoint.json').resolve()
    if Path(parent).resolve()!=expected_parent or (PROJECT_ROOT/campaign['parent_checkpoint']).resolve()!=expected_parent:
        raise ValueError('Wrong predecessor checkpoint')
    prior=_read(expected_parent)
    keys={r['key'] for r in prior['runs']}
    expected={f'c{c}/calibration/{i:02}' for c in (1,2,3) for i in range(1,9)}
    if (len(prior['runs'])!=24 or keys!=expected or set(prior['candidate_bindings'])!={'c1','c2','c3'} or
        _sha(expected_parent)!=campaign['parent_sha256']):raise ValueError('Unexpected predecessor attempts')
    with _lock(registration):
        reject_superseded_reservation(PROJECT_ROOT)
        if root.exists() or registration.exists():
            state=_load(root,registration)
            if state['identity']!=_digest(campaign):raise ValueError('Continuation already registered; do not renew it')
            return
        root.mkdir()
        state=dict(identity=_digest(campaign),campaign=campaign,
            prior_runs=[{k:r[k] for k in ('key','status','input_hash')} for r in prior['runs']],
            prior_candidates=prior['candidate_bindings'],candidate_bindings=dict(prior['candidate_bindings']),runs={})
        _save(root,registration,state)


def _artifact(root,relative):
    path=Path(relative)
    if path.is_absolute() or '..' in path.parts:raise ValueError('Artifact outside campaign')
    result=(root/path).resolve()
    if not result.is_relative_to(root):raise ValueError('Artifact outside campaign')
    return result


def _verify_evidence(root,evidence):
    result=_artifact(root,evidence['result_path'])
    if not evidence.get('files') or 'manifest.json' not in evidence['files']:raise ValueError('Ready capture needs retained evidence')
    try:
        for name,digest in evidence['files'].items():
            if _sha(_artifact(result,name))!=digest:raise ValueError('Retained evidence changed')
    except OSError as error:raise ValueError('Retained evidence missing') from error
    return result


def reserve_run(root:Path,spec:RunSpec)->RunReservation:
    root,registration=_locations(root)
    if not registration.is_file() or not (root/'checkpoint.json').is_file():raise ValueError('Initialize the approved continuation once; no automatic fresh budget')
    if (RUN_GROUPS.get(spec.id)!=spec.group or type(spec.maximum_ms) is not int or spec.maximum_ms!=MAX_PHYSICS_MS or
        not re.fullmatch('[0-9a-f]{64}',spec.input_hash) or not re.fullmatch('[0-9a-f]{64}',spec.native_sha256)):
        raise ValueError('Unapproved run identity or limits')
    with _lock(registration):
        reject_superseded_reservation(PROJECT_ROOT)
        state=_load(root,registration)
        from .defensive_probe_budget import _extension_usage_locked
        _extension_usage_locked(root,state)
        if spec.id in TECHNICAL:
            pinned=state['campaign']['technical'][spec.id]
            if any(pinned[k]!=getattr(spec,k) for k in ('input_hash','native_sha256','maximum_ms')):
                raise ValueError('Frozen technical input or native changed')
        existing=state['runs'].get(spec.id)
        if existing:
            if existing['spec']!=asdict(spec):raise ValueError('Measured run binding changed')
            if existing['state']!='ready':raise ValueError('Attempt consumed; no automatic retry')
            return RunReservation(spec.id,True,_verify_evidence(root,existing['evidence']))
        usage=_extension_usage_locked(root,state,new_reservation=True)
        if len(state['prior_runs'])+len(state['runs'])>=70 or usage['used']>=usage['maximum']:
            raise ValueError('Cumulative native budget exhausted')
        if spec.group=='calibration':
            candidate=spec.id.split('/')[0];bindings=state['candidate_bindings']
            if candidate in bindings and bindings[candidate]!=spec.native_sha256:raise ValueError('Candidate native changed')
            if candidate not in bindings and len(bindings)>=5:raise ValueError('Cumulative candidate budget exhausted')
            bindings[candidate]=spec.native_sha256
        elif spec.group in ('heldout','repetition','web'):
            if spec.native_sha256 not in [state['candidate_bindings'].get(c) for c in ('c4','c5')]:
                raise ValueError('Selected candidate has not been bound')
        state['runs'][spec.id]=dict(spec=asdict(spec),state='reserved')
        _save(root,registration,state)
        return RunReservation(spec.id,False,None)


def finish_run(root:Path,id:str,*,state:str,evidence:dict)->None:
    root,registration=_locations(root)
    if state not in ('ready','failed','cancelled'):raise ValueError('Invalid terminal state')
    with _lock(registration):
        data=_load(root,registration);entry=data['runs'].get(id)
        if entry is None or entry['state']!='reserved':raise ValueError('Only a consumed reservation may finish once')
        if state=='ready':_verify_evidence(root,evidence)
        entry.update(state=state,evidence=evidence);_save(root,registration,data)


def reject_superseded_reservation(project):
    from .coordination_authorization import reject_legacy_reservation
    reject_legacy_reservation(Path(project).resolve())


def verify_coordination_supersession(root,grant):
    from .coordination_authorization import verify_supersession
    verify_supersession(root,grant)
