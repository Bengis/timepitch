"""Exactly one reserved private K1 child. No public engine admission."""
import os
from pathlib import Path

from .action_models import ActionInput
from .action_process import ActionProcess
from .action_codec import ActionStreamValidator
from .action_validation import _Recorder
from .coordination_profile import load_coordination_profile
from .coordination_budget import CoordinationLedger
from .coordination_wire import read_coordination_policy,validate_coordination_sidecar
from .physical_wire import canonical
from . import physical_campaign_budget as original


def request_for_run(profile,run_id):
    if run_id=='K-observe-42':key='calibration/01'
    else:
        parts=run_id.split('/')
        if len(parts)!=3 or parts[0]!='k1' or parts[1] not in ('calibration','heldout'):raise ValueError('Fixed K1 run ID required')
        key='/'.join(parts[1:])
    try:return ActionInput.model_validate(profile.payload(key))
    except (KeyError,TypeError) as e:raise ValueError('Original full payload required') from e


class CoordinationProcess(ActionProcess):
    def __init__(self,profile,*,root:Path,run_id:str):
        if profile is None:raise ValueError('Frozen coordination profile required')
        fresh=load_coordination_profile(profile.project)
        if fresh!=profile:raise ValueError('Changed/forged coordination profile')
        self.profile=profile;self.run_id=run_id;self.mode='observe' if run_id=='K-observe-42' else 'apply'
        self.ledger=CoordinationLedger(root,profile);self.root=self.ledger.root
        self.frozen_request=request_for_run(profile,run_id);self.ledger.verify_reserved(run_id,self.frozen_request)
        if '/heldout/' in run_id:self.ledger.verify_selection()
        self.native_sha256=profile.native_sha256
        self.identity=dict(run_id=run_id,input_hash=self.frozen_request.input_hash,native_sha256=profile.native_sha256,
            profile_identity=profile.identity,build_manifest_sha256=profile.build_manifest_sha256)
        self.evidence=self.root/'evidence'/run_id;self.evidence.mkdir(parents=True,exist_ok=True)
        self.observed=self.evidence;self.sidecar=self.evidence/'coordination.jsonl';self.policy_path=self.evidence/'policy.json'
        self.policy=None;self.sidecar_info=None;self.last_received_physics_ms=None;self.cancel_after_first=False
        super().__init__(profile.python_path,profile.native_dir,timeout=600)
    def run(self,request,cancelled):
        if load_coordination_profile(self.profile.project)!=self.profile or request!=self.frozen_request:raise ValueError('Exact fixed source/profile/payload required')
        self.ledger.verify_reserved(self.run_id,request)
        with original._lock(self.ledger.lock):
            if self.ledger._load()['runs'][self.run_id]['state']!='reserved':raise ValueError('Reservation lost')
            with (self.evidence/'launch.json').open('xb') as f:f.write(canonical(dict(identity=self.identity,mode=self.mode)));f.flush();os.fsync(f.fileno())
        result=None
        try:
            result=super().run(request,cancelled)
            self.policy=read_coordination_policy(self.policy_path,self.identity,self.mode,result.manifest.trace_hash)
            self.sidecar_info=validate_coordination_sidecar(self.sidecar,self.identity,self.mode,result.manifest.trace_hash,
                expected_rows=(r for chunk in result.chunks() for r in chunk.samples))
            return result
        except BaseException:
            if result:result.close()
            raise
    def _command(self):
        return [str(self.python_path),'-X','utf8','-u',str(Path(__file__).with_name('coordination_runner.py')),
            str(self.native_dir),str(self.root),self.run_id]
    def _stream_validator(self,request):
        if not isinstance(request,ActionInput) or request!=self.frozen_request:raise ValueError('Frozen action request required')
        return _Recorder(self,request,ActionStreamValidator(request,self.native_sha256,_research_native_sha256=self.native_sha256))
