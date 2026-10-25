"""Independent research clock validation, reusing all action/contact rules."""
from dataclasses import asdict
from .action_codec import ActionStreamValidator
from .bounded_clock import BoundedClockState,BoundedObservation,advance_bounded_clock
from .physical_wire import CAUSES
from .m1_models import M1Manifest
from .m1_wire import validate_close


class M1StreamValidator(ActionStreamValidator):
    def __init__(self,request,profile):
        super().__init__(request,profile.native_sha256,_research_native_sha256=profile.native_sha256)
        self.profile=profile;self.clock=BoundedClockState();self.expected_closes=[]

    def _clock_step(self,row):
        decision=advance_bounded_clock(self.clock,BoundedObservation(physics_ms=int(row[1]),period=int(row[2]),effective_ms=int(row[4]),
            in_play=bool(row[5]),restart_id=int(row[8]),restart_active=bool(row[9]),restart_cause=CAUSES[int(row[10])],
            restart_start_ms=int(row[11]),pending_penalty=bool(row[12]),discontinuity=bool(row[7]),relocation_id=int(row[19])))
        self.clock=decision.state
        if decision.close:self.expected_closes.append((asdict(decision.close),list(row)))

    def _parse_manifest(self,manifest):
        return M1Manifest.model_validate(manifest.model_dump(mode='json'))

    def _validate_completion(self,manifest):
        identity=getattr(self.profile,'profile_identity',self.profile.identity)
        if len(self.expected_closes)!=2 or manifest.worker_identity['profile_identity']!=identity:
            raise ValueError('M1 completion/profile')
        for receipt,(request,row) in zip(manifest.close_receipts,self.expected_closes):validate_close(receipt,request,row)
