"""A consumer of separate future native approval; no initializer or allocator."""
from dataclasses import dataclass
from pathlib import Path
import os
from . import m1_verifier as wire
from .campaign_ledger import CampaignLedger
from .m1_profile import load_worker_profile
from .continuity_profile import plain
from .physical_wire import digest


@dataclass(frozen=True)
class Admission:
    profile_identity:str
    maximum:int
    candidate_limit:int
    grant_sha256:str


def validate_worker_authorization(project,profile):
    root=Path(project).resolve()
    if profile.project!=root:raise ValueError('Successor project mismatch')
    d,h,grant=wire.verify_authorization(root)
    if profile.identity!=h:raise ValueError('Changed successor identity')
    return Admission(h,76,6,grant)


def validate_stage_selection(project,profile,stage):
    if stage not in ('observe','calibration','heldout'):raise ValueError('Fixed M1 stage required')
    if stage!='heldout':return
    state=wire.read(wire.artifact(project,wire.RUN_ROOT+'/checkpoint.json'))
    wire.verify_selection(project,plain(profile.document),profile.identity,state,require_sealed=False)


def _retained_files(project,run_id,row):
    files=row.get('retained_files')
    if type(files) is not dict or not files:raise ValueError('Retained replay/evidence required; a native equivalence flag is insufficient')
    prefix=wire.RUN_ROOT+'/evidence/'+run_id+'/'
    for name,h in files.items():
        if not name.startswith(prefix) or wire.sha(wire.artifact(project,name))!=h:raise ValueError('Retained result identity changed')


class WorkerLedger(CampaignLedger):
    """The same ledger/lock/IDs as the historical wrapper; a successor verifier."""
    def __init__(self,project,profile):
        super().__init__(project,profile,validate_worker_authorization)

    def verify_selection(self,state):
        wire.verify_selection(self.project,plain(self.profile.document),self.profile.identity,state,require_approval=False)

    def finish(self,id,row,*,failed=False):
        if not failed:raise ValueError('Producer rows cannot make ready; finish_capture required')
        if row.get('complete') is not False:raise ValueError('Explicit failed measurement required')
        return super().finish(id,row,failed=True)

    def finish_capture(self,run_id,capture,budget):
        from dataclasses import asdict
        from . import m1_admission as authority
        from .m1_resource_models import CapturedEvidence
        from .m1_resources import M1Budget,M1ResourceExceeded,record_resource_failure
        from .m1_wire import write_exclusive
        if type(capture) is not CapturedEvidence or type(budget) is not M1Budget:
            raise ValueError('Capture reference and actual budget required')
        # Serialize finalizers using the original campaign lock. No alternate
        # journal or counter; a competing/repeated finalizer never derives again.
        with self.locked():
            state=self._load();entry=state['runs'].get(run_id)
            if entry is None or entry['state']!='reserved':raise ValueError('Existing consumed reservation required')
            evidence=wire.artifact(self.project,wire.RUN_ROOT+'/evidence/'+run_id)
            created_measurement=False;created_receipt=False
            try:
                derived=authority.derive_measurement(self.profile,run_id,capture,budget)
                budget.checkpoint('finalize')
                manifest=authority.RetainedM1Result(evidence,budget).manifest
                if authority.retained_hashes(self.project,evidence,manifest,budget)!=derived.retained_files:
                    raise ValueError('Retained bytes changed before commit')
                authority.capture_launch(self.profile,run_id,capture,budget)
                budget.checkpoint('finalize')
                # Pending data are never an accepted measurement. The shared
                # journal transition remains fail-closed until the sealed receipt.
                pending=dict(complete=False,status='pending',derived=derived.row,retained_files=derived.retained_files)
                super().finish(run_id,pending)
                created_measurement=True
                snapshot=budget.checkpoint('finalize')
                receipt=dict(schema_version='m1-resource-receipt-1',identity=derived.identity,
                    trace_hash=derived.trace_hash,measurement_sha256=wire.sha(evidence/'measurement.json'),
                    retained_files=derived.retained_files,resources=asdict(snapshot),admitted=True,
                    resource_scope='current-budget; snapshot-before-receipt-seal; final-gate-after-seal')
                from .physical_wire import canonical
                if len(canonical(receipt))>16384:raise ValueError('Resource receipt budget')
                write_exclusive(evidence/'resource-receipt.json',receipt);created_receipt=True
                budget.checkpoint('finalize')
                # Seal the receipt itself in the existing witnessed journal.
                state=wire.read(self.root/'checkpoint.json')
                state['runs'][run_id]['resource_receipt_sha256']=wire.sha(evidence/'resource-receipt.json')
                self._save(state,dict(type='resource_sealed',id=run_id))
                budget.checkpoint('finalize')
                accepted=self._row(run_id,state['runs'][run_id])
                budget.checkpoint('finalize')
                return accepted
            except BaseException as error:
                if created_receipt:
                    try:os.rename(evidence/'resource-receipt.json',evidence/'resource-receipt-unadmitted.json')
                    except OSError as diagnostic_error:setattr(error,'diagnostic_error',type(diagnostic_error).__name__)
                if isinstance(error,M1ResourceExceeded):
                    from .m1_campaign import _launch
                    record_resource_failure(evidence/'resource-failure.json',error,
                        identity=_launch(self.profile,run_id).identity,
                        trace_hash=capture.trace_hash,last_durable_block=capture.last_durable_block,
                        last_durable_ms=capture.last_durable_ms)
                try:
                    if created_measurement:
                        # The locked, unaccepted pending envelope stays complete=false.
                        # Terminal failure consumes the same reservation and journal.
                        state=wire.read(self.root/'checkpoint.json')
                        entry=state['runs'][run_id]
                        entry.update(state='failed');entry.pop('resource_receipt_sha256',None)
                        state['terminal_failure']=dict(id=run_id,state='failed')
                        self._save(state,dict(type='resource_or_admission_failed',id=run_id,error_type=type(error).__name__))
                    elif not (evidence/'measurement.json').exists():
                        super().finish(run_id,dict(complete=False,status='failed',error_type=type(error).__name__,error=str(error)[-2000:]),failed=True)
                except Exception as finalization_error:setattr(error,'finalization_error',type(finalization_error).__name__)
                raise

    def _row(self,id,entry):
        row=super()._row(id,entry)
        if entry['state']=='ready':
            _retained_files(self.project,id,row)
            path=wire.artifact(self.project,wire.RUN_ROOT+'/evidence/'+id+'/resource-receipt.json')
            if wire.sha(path)!=entry.get('resource_receipt_sha256'):raise ValueError('Sealed resource receipt required')
            receipt=wire.read(path,16384)
            from .m1_campaign import _launch
            if (row.get('status')!='pending' or row.get('complete') is not False or
                receipt.get('schema_version')!='m1-resource-receipt-1' or receipt.get('admitted') is not True or
                receipt.get('identity')!=_launch(self.profile,id).identity or
                receipt.get('measurement_sha256')!=entry['result_sha256'] or
                receipt.get('retained_files')!=row['retained_files'] or
                receipt.get('trace_hash')!=row['derived']['trace_hash']):raise ValueError('Unbound resource admission receipt')
            resources=receipt['resources']
            row={**row,**row['derived']}
            row.update(seconds=resources['elapsed_seconds'],
                peak_private_bytes=max(resources['parent_peak_private_bytes'],resources['child_peak_private_bytes']))
            row.pop('derived',None)
        return row
