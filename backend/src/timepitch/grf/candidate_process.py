"""One reserved, source-bound research child. Never a public engine factory."""
from dataclasses import asdict
import os
from pathlib import Path
import re
import time
from . import physical_campaign_budget as budget
from .candidate_profiles import load_candidate_profile,plain,intervention
from .candidate_wire import read_policy
from .action_models import ActionInput
from .action_codec import ActionStreamValidator
from .action_process import ActionProcess
from .action_validation import _Recorder
from .physical_wire import canonical
from .process import GrfExecutionError


def request_for_run(profile,run_id):
    if re.fullmatch(r'c[45]/calibration/0[1-8]',run_id):
        if not run_id.startswith(profile.id+'/'):raise ValueError('Wrong candidate run')
    elif re.fullmatch(r'selected/heldout/(0[1-9]|1[0-9]|2[0-4])',run_id) is None:
        raise ValueError('Only original candidate/heldout IDs')
    key='/'.join(run_id.split('/')[1:])
    return ActionInput.model_validate(plain(profile.payloads[key]))


def _context(profile,root,run_id):
    root,lock=budget._locations(root);project=budget.PROJECT_ROOT.resolve()
    fresh=load_candidate_profile(project,profile.id)
    if fresh!=profile:raise ValueError('Forged or changed candidate profile')
    request=request_for_run(fresh,run_id);spec=budget.RunSpec(run_id,run_id.split('/')[1],request.input_hash,profile.native_sha256,7440000)
    with budget._lock(lock):
        state=budget._load(root,lock);entry=state['runs'].get(run_id)
        if entry is None or entry['state']!='reserved' or entry['spec']!=asdict(spec):raise ValueError('Matching consumed reservation required before child')
    if spec.group=='heldout':
        from .action_selection import verify_frozen_selection
        selected=verify_frozen_selection(root)
        if selected['candidate_id']!=profile.id or selected['profile_identity']!=profile.identity:raise ValueError('Selected profile changed')
    return root,request


class CandidateProcess(ActionProcess):
    def __init__(self,profile,*,root:Path,run_id:str):
        self.root,self.frozen_request=_context(profile,root,run_id)
        self.profile=profile;self.run_id=run_id;self.native_sha256=profile.native_sha256
        self.identity=dict(run_id=run_id,input_hash=self.frozen_request.input_hash,native_sha256=profile.native_sha256,
            profile_identity=profile.identity,build_manifest_sha256=profile.build_manifest_sha256)
        self.evidence=self.root/'evidence'/run_id;self.evidence.mkdir(parents=True,exist_ok=True)
        self.observed=self.evidence;self.policy_path=self.evidence/'policy.json';self.policy=None
        self.cancel_after_first=False;self.last_received_physics_ms=None
        _,campaign=intervention(budget.PROJECT_ROOT)
        super().__init__(budget.PROJECT_ROOT/campaign['python'],profile.native_dir,timeout=600)

    def run(self,request,cancelled):
        _context(self.profile,self.root,self.run_id)
        if request!=self.frozen_request:raise ValueError('Exact frozen request required')
        # Claim before capability/Popen: a failure cannot make the reserved ID launchable again.
        with budget._lock(self.root.parent/'continuation-registration.json'):
            state=budget._load(self.root,self.root.parent/'continuation-registration.json')
            if state['runs'].get(self.run_id,{}).get('state')!='reserved':raise ValueError('Reservation lost')
            with (self.evidence/'launch.json').open('xb') as stream:
                stream.write(canonical(self.identity));stream.flush();os.fsync(stream.fileno())
        result=None
        try:
            result=super().run(request,cancelled)
            self.policy=read_policy(self.policy_path,self.identity,self.profile.spec(),result.manifest.trace_hash)
            return result
        except ValueError as error:
            if result:result.close()
            raise GrfExecutionError('Invalid candidate policy attestation') from error

    def _command(self):
        return [str(self.python_path),'-X','utf8','-u',str(Path(__file__).with_name('candidate_runner.py')),
            str(self.native_dir),str(self.root),self.run_id]

    def _stream_validator(self,request):
        if not isinstance(request,ActionInput) or request!=self.frozen_request:raise ValueError('Frozen action input required')
        return _Recorder(self,request,ActionStreamValidator(request,self.native_sha256,_research_native_sha256=self.profile.native_sha256))
