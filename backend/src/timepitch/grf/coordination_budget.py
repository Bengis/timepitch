"""Consumer of a future linked authorization. This module never creates a grant.

Phase 4 only prepares these transitions. Real access stays closed until Phase 5
installs and proves the legacy supersession guard and registers its witnesses.
"""
from dataclasses import dataclass
import copy
import hashlib
import json
import os
from pathlib import Path

from . import physical_campaign_budget as original
from .coordination_profile import PROJECT_ROOT,RUN_ROOT,sha,read
from .physical_wire import canonical,digest

IDS=('K-observe-42',)+tuple(f'k1/calibration/{i:02}' for i in range(1,9))+tuple(f'k1/heldout/{i:02}' for i in range(1,25))+('k1/R-selected','k1/W-local')


def _authorized_context(root,profile):
    root=Path(root).resolve();project=PROJECT_ROOT.resolve()
    if root!=(project/RUN_ROOT).resolve() or profile is None or profile.project!=project:raise ValueError('Canonical coordination root/profile required')
    guard=getattr(original,'verify_coordination_supersession',None)
    if guard is None:raise ValueError('Phase5 linked authorization and legacy supersession guard required')
    try:
        grant=read(root/'authorization.json')
        if (grant['schema_version']!='grf-coordination-authorization-1' or grant['profile_identity']!=profile.identity or
            grant['maximum']!=72 or grant['parent_used']!=37 or grant['parent_candidates']!=4 or grant['candidate_limit']!=5 or
            grant['run_ids']!=list(IDS) or not isinstance(grant['approval_ref'],str) or not grant['approval_ref']):raise ValueError('Linked authorization identity/limits')
        guard(root,grant)  # Phase5 must prove that old and new schedules cannot both spend.
        return root,grant
    except (OSError,KeyError,TypeError) as e:raise ValueError('Missing linked authorization; never initialize a fresh budget') from e


def _exclusive(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as f:f.write(canonical(value));f.flush();os.fsync(f.fileno())


@dataclass(frozen=True)
class Reservation:
    id:str
    reused:bool
    result_path:Path|None=None


class CoordinationLedger:
    def __init__(self,root,profile):
        self.root,self.grant=_authorized_context(root,profile);self.profile=profile
        self.lock=self.root.parent/'continuation-registration.json'
        with original._lock(self.lock):self._load()
    def _load(self):
        root,grant=_authorized_context(self.root,self.profile)
        if grant!=self.grant:raise ValueError('Authorization changed')
        try:
            state=read(root/'checkpoint.json');events=root/'events.jsonl'
            expected=dict(root=str(root),grant_sha256=digest(grant),checkpoint_sha256=digest(state),events_sha256=sha(events))
            if (read(root.parent/'coordination-registration.json')!=expected or read(root.parent/'coordination-initialized.json')!=expected or
                state['schema_version']!='grf-coordination-ledger-1' or state['grant_sha256']!=digest(grant) or
                not set(state['runs'])<=set(IDS) or len(state['runs'])>35):raise ValueError('Coordination checkpoint/witness changed')
            raw=events.read_bytes()
            if len(raw)>2*1024*1024:raise ValueError('Coordination journal bound')
            prefix=b''
            for i,line in enumerate(raw.splitlines(keepends=True)):
                e=json.loads(line)
                if e['seq']!=i or e['previous']!=hashlib.sha256(prefix).hexdigest():raise ValueError('Append-only journal chain changed')
                prefix+=line
            if raw and json.loads(raw.splitlines()[-1])['checkpoint']!=digest(state):raise ValueError('Journal head differs from checkpoint')
            for id,entry in state['runs'].items():
                if entry['state'] not in ('reserved','ready','failed','cancelled') or entry['profile_identity']!=self.profile.identity:raise ValueError('Consumed run identity/state')
            return state
        except (OSError,KeyError,TypeError,json.JSONDecodeError) as e:raise ValueError('Missing/invalid coordination ledger; no reset') from e
    def _save(self,state,event):
        events=self.root/'events.jsonl';before=events.read_bytes()
        record=dict(seq=len(before.splitlines()),previous=hashlib.sha256(before).hexdigest(),event=event,checkpoint=digest(state))
        with events.open('ab') as f:f.write(canonical(record)+b'\n');f.flush();os.fsync(f.fileno())
        original._write(self.root/'checkpoint.json',state)
        receipt=dict(root=str(self.root),grant_sha256=digest(self.grant),checkpoint_sha256=digest(state),events_sha256=sha(events))
        for name in ('coordination-registration.json','coordination-initialized.json'):original._write(self.root.parent/name,receipt)
    def usage(self):
        with original._lock(self.lock):s=self._load()
        return dict(used=37+len(s['runs']),maximum=72,candidates=5 if s['runs'] else 4)
    def entry(self,id):
        with original._lock(self.lock):return copy.deepcopy(self._load()['runs'].get(id))
    def verify_reserved(self,id,request):
        with original._lock(self.lock):s=self._load();e=s['runs'].get(id)
        if e is None or e['state']!='reserved' or e['input_hash']!=request.input_hash or e['payload_sha256']!=digest(request.model_dump(mode='json')) or e['native_sha256']!=self.profile.native_sha256:
            raise ValueError('Matching consumed reservation required before child')
        return e
    def _selection_marked(self,s):
        return s['selection_sealed'] or s['heldout_opened'] or any(p.exists() for p in self._selection_paths())
    def _selection_paths(self):
        return self.root/'selection/freeze.json',self.root.parent/'coordination-selection-registration.json',self.root.parent/'coordination-selection-initialized.json'
    def assert_stage(self,stage):
        with original._lock(self.lock):s=self._load()
        if s['terminal_failure']:raise ValueError('Study stopped at first technical/equivalence failure')
        if stage=='observe':
            if any(id!='K-observe-42' for id in s['runs']):raise ValueError('Observation cannot reopen after calibration')
        elif stage=='calibration':
            if not s['observe_proof']:raise ValueError('Exact accepted passive observation required')
            if self._selection_marked(s):raise ValueError('Selection sealed/heldout opened; calibration permanently closed')
        elif stage=='heldout':
            if not s['observe_proof']:raise ValueError('Accepted observation required')
        else:raise ValueError('Fixed observe/calibration/heldout stages only')
    def reserve(self,id,request):
        with original._lock(self.lock):
            s=self._load()
            if id not in IDS or id.endswith(('R-selected','W-local')):raise ValueError('Run ID outside prepared phase4 scheduler')
            stage='observe' if id=='K-observe-42' else id.split('/')[1]
            if s['terminal_failure']:raise ValueError('Study already stopped')
            if stage!='observe' and not s['observe_proof']:raise ValueError('Passive equivalence not accepted')
            if stage=='calibration' and self._selection_marked(s):raise ValueError('Calibration permanently closed')
            if stage=='heldout':self._verify_selection(s)
            prior=s['runs'].get(id)
            payload_hash=digest(request.model_dump(mode='json'))
            if prior is not None:
                if prior['input_hash']!=request.input_hash or prior['payload_sha256']!=payload_hash or prior['state']!='ready':raise ValueError('Consumed/failed/reserved ID cannot retry')
                return Reservation(id,True,self._evidence(id,prior))
            if stage in ('calibration','heldout'):
                index=int(id.rsplit('/',1)[1])
                if any(s['runs'].get(f'k1/{stage}/{i:02}',{}).get('state')!='ready' for i in range(1,index)):
                    raise ValueError('Original fixture order required; prior reserved/failed/missing run blocks')
            if len(s['runs'])>=35 or 37+len(s['runs'])>=72:raise ValueError('Cumulative attempt budget exhausted')
            if stage=='observe' and s['runs']:raise ValueError('Only one passive control before all other runs')
            if stage=='heldout':s['heldout_opened']=True
            s['runs'][id]=dict(state='reserved',input_hash=request.input_hash,payload_sha256=payload_hash,
                native_sha256=self.profile.native_sha256,profile_identity=self.profile.identity,evidence=None)
            self._save(s,dict(type='reserve',id=id));return Reservation(id,False)
    def _evidence(self,id,entry):
        evidence=entry['evidence'];expected=(self.root/'evidence'/id).resolve()
        if evidence is None or (self.root/evidence['path']).resolve()!=expected:raise ValueError('Ready evidence outside reserved ID')
        if set(evidence['files'])!={p.name for p in expected.iterdir() if p.is_file()}:raise ValueError('Evidence file inventory changed')
        for name,h in evidence['files'].items():
            if Path(name).name!=name or sha(expected/name)!=h:raise ValueError('Ready evidence hash changed')
        return expected
    def finish(self,id,*,state):
        if state not in ('ready','failed','cancelled'):raise ValueError('Terminal run state required')
        with original._lock(self.lock):
            s=self._load();e=s['runs'].get(id)
            if e is None or e['state']!='reserved':raise ValueError('Reservation already finished or missing')
            path=self.root/'evidence'/id;files={p.name:sha(p) for p in path.iterdir() if p.is_file()}
            if not files or state=='ready' and 'measurement.json' not in files:raise ValueError('Retain evidence before finishing')
            e.update(state=state,evidence=dict(path=path.relative_to(self.root).as_posix(),files=files))
            if state!='ready':s['terminal_failure']=dict(id=id,state=state)
            self._save(s,dict(type='finish',id=id,state=state))
    def ready_row(self,id):
        with original._lock(self.lock):
            s=self._load();e=s['runs'].get(id)
            if e is None or e['state']!='ready':raise ValueError('Ready evidence required')
            path=self._evidence(id,e);row=read(path/'measurement.json')
            if row['profile_identity']!=self.profile.identity or row['input_hash']!=e['input_hash'] or row['native_binary_sha256']!=self.profile.native_sha256:raise ValueError('Measurement differs from consumed reservation')
            return row
    def accept_observation(self,proof):
        with original._lock(self.lock):
            s=self._load()
            if s['runs'].get('K-observe-42',{}).get('state')!='ready' or proof.get('equivalent') is not True or proof.get('exact_transactions',0)<=0:raise ValueError('Complete exact passive proof required')
            if s['observe_proof'] is not None and s['observe_proof']!=proof:raise ValueError('Observation proof already fixed')
            if s['observe_proof'] is None:s['observe_proof']=copy.deepcopy(proof);self._save(s,dict(type='observe_accept',proof_sha256=digest(proof)))
    def reject_observation(self,reason):
        with original._lock(self.lock):
            s=self._load();s['terminal_failure']=dict(id='K-observe-42',reason=str(reason)[-2000:]);self._save(s,dict(type='observe_reject'))
    def seal_selection(self,report):
        from .coordination_campaign import evaluate_coordination_gates
        with original._lock(self.lock):
            s=self._load()
            if self._selection_marked(s):return self._verify_selection(s)
            rows=[self._ready_row_locked(s,f'k1/calibration/{i:02}') for i in range(1,9)]
            gates=evaluate_coordination_gates(rows,expected=8)
            if report.get('rows')!=rows or report.get('gates')!=gates or not all(gates.values()) or report.get('profile_identity')!=self.profile.identity:raise ValueError('One complete qualifying K1 calibration required')
            path,registration,witness=self._selection_paths()
            frozen=dict(schema_version='grf-coordination-selection-1',profile_identity=self.profile.identity,native_sha256=self.profile.native_sha256,
                report_sha256=digest(report),payload_sha256={f'{i:02}':digest(self.profile.payload(f'heldout/{i:02}')) for i in range(1,25)})
            s['selection_sealed']=True;self._save(s,dict(type='selection_sealed',identity=digest(frozen)))
            _exclusive(path,frozen);receipt=dict(root=str(self.root),identity=digest(frozen),freeze_sha256=sha(path))
            _exclusive(registration,receipt);_exclusive(witness,receipt);return self._verify_selection(s)
    def _ready_row_locked(self,s,id):
        e=s['runs'].get(id)
        if e is None or e['state']!='ready':raise ValueError('Complete ready rows required')
        return read(self._evidence(id,e)/'measurement.json')
    def _verify_selection(self,s):
        try:return self._selection(s)
        except (OSError,KeyError,TypeError,json.JSONDecodeError) as e:raise ValueError('Missing/invalid sealed selection; never reopen calibration') from e
    def _selection(self,s):
        path,registration,witness=self._selection_paths();value=read(path)
        receipt=dict(root=str(self.root),identity=digest(value),freeze_sha256=sha(path))
        if (not s['selection_sealed'] or read(registration)!=receipt or read(witness)!=receipt or
            value['profile_identity']!=self.profile.identity or value['native_sha256']!=self.profile.native_sha256 or
            value['payload_sha256']!={f'{i:02}':digest(self.profile.payload(f'heldout/{i:02}')) for i in range(1,25)} or
            value['report_sha256']!=digest(read(self.root/'reports/calibration.json'))):raise ValueError('Sealed selection/payload/report changed')
        return value
    def verify_selection(self):
        with original._lock(self.lock):return self._verify_selection(self._load())
