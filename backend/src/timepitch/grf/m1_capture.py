"""Portable M1 capture hooks; never creates or imports a native core."""
from dataclasses import asdict
from .action_runner import ActionCapture
from .bounded_clock import BoundedClockState,BoundedObservation,advance_bounded_clock
from .m1_wire import POLICY,MANIFEST,ENGINE,validate_close
from .shot_context_wire import _json


class M1Capture(ActionCapture):
    def __init__(self,core,payload,launch):
        super().__init__(core,payload,None)
        self.launch=launch;self.clock=BoundedClockState();self.close_receipts=[];self.close_request=None
        self.last_observed_ms=None
        core._env.probe_enable_continuity_v2(launch.mode)
        self.mapping=list(core._env.probe_m1_identity_map())
        from .m1_evidence import validate_mapping
        validate_mapping(self.mapping)

    def _clock_step(self,state):
        self.last_observed_ms=state['physics_ms']
        observation=BoundedObservation(physics_ms=state['physics_ms'],period=state['phase'],effective_ms=state['effective_ms'],
            in_play=state['in_play'],restart_id=state['restart_id'],restart_cause=state['restart_cause'],
            restart_active=state['restart_active'],restart_start_ms=state['restart_start_ms'],pending_penalty=state['pending_penalty'],
            discontinuity=state['discontinuity'],relocation_id=state['relocation_id'])
        decision=advance_bounded_clock(self.clock,observation);self.clock=decision.state;self.close_request=decision.close

    def _after_sample(self,state,row):
        if self.close_request:
            request=asdict(self.close_request)
            raw=self.core._env.probe_close_physical_period(request['period'],request['physics_ms'],request['reason'])
            if not isinstance(raw,str) or len(raw.encode())>150000:raise ValueError('M1 close metadata budget')
            receipt=_json(raw);validate_close(receipt,request,row);self.close_receipts.append(receipt)

    def _flush_on_clock_error(self):return True

    def _manifest(self,result):
        if len(self.close_receipts)!=2:raise ValueError('M1 requires two native close receipts')
        return dict(result,schema_version=MANIFEST,engine_version=ENGINE,clock_policy=POLICY,
            worker_identity=self.launch.identity,close_receipts=self.close_receipts)
