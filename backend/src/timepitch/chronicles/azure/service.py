"""Owned saved sources and checked completion; no inference transport or worker loop."""
from ..models import ChronicleRequest, FactPack, fact_pack_hash
from .models import AzureReceipt, AzureStatus
from .repository import AzureConflict, clean
from .validation import validate_draft


class AzureStaleSource(AzureConflict): pass
class AzureDisabled(ValueError): pass
class AzureNotPermitted(ValueError): pass


class AzureChronicleService:
    def __init__(self,repository,source,settings):
        self.repository,self.source,self.settings=repository,source,settings

    def _current(self,owner,request):
        pack=clean(FactPack,self.source(owner,request))
        if pack.engine!=request.engine or pack.trace_hash!=request.trace_hash:
            raise AzureStaleSource('Source identity changed')
        return pack

    def _recheck(self,job_id):
        owner,request,stored=self.repository.internal(job_id)
        current=self._current(owner,request)
        if fact_pack_hash(current)!=fact_pack_hash(stored):
            raise AzureStaleSource('Frozen facts changed')
        return stored,request

    def submit(self,owner,request):
        if self.settings.mode=='off':raise AzureDisabled('Azure generation is disabled')
        if not self.settings.permits_generation(owner):raise AzureNotPermitted('Not found')
        request=clean(ChronicleRequest,request)
        return self.repository.submit(owner,request,self._current(owner,request),self.settings.binding)

    def lookup(self,owner,request):
        request=clean(ChronicleRequest,request)
        pack=self._current(owner,request)
        if self.settings.binding is None:return None
        job=self.repository.lookup(owner,request,self.settings.binding)
        if job and job.fact_hash!=fact_pack_hash(pack):raise AzureStaleSource('Frozen facts changed')
        return job

    def get(self,owner,job_id):
        job=self.repository.get(owner,job_id)
        self._recheck(job.id)
        return job

    def claim(self,worker_id):
        if self.settings.mode=='off':return None
        for _ in range(4):
            claim=self.repository.claim(worker_id)
            if claim is None:return None
            try:
                if not self.settings.permits_generation(claim.owner):raise KeyError('Scope no longer permitted')
                if claim.binding!=self.settings.binding:raise AzureStaleSource('Binding changed')
                self._recheck(claim.lease.job_id)
            except KeyError:
                self.repository.fail(claim.lease,'source_unavailable');continue
            except ValueError:
                self.repository.fail(claim.lease,'stale_revision');continue
            return claim
        return None

    def complete(self,lease,receipt):
        # A forged lease must not even invoke another owner's source resolver.
        self.repository.validate_lease(lease,receipt=True)
        receipt=clean(AzureReceipt,receipt)
        self.repository.record_receipt(lease,receipt)
        try:pack,request=self._recheck(lease.job_id)
        except (KeyError,ValueError) as exc:
            try:self.repository.fail(lease,'source_unavailable' if isinstance(exc,KeyError) else 'stale_revision')
            except AzureConflict:pass  # An immutable/expired job is never revived to reject it.
            raise AzureStaleSource('Saved source is no longer current') from None
        if receipt.model!=self.repository.binding_for_lease(lease).expected_model and receipt.error is None:
            try:self.repository.fail(lease,'model_mismatch')
            except AzureConflict:pass
            raise AzureConflict('Provider model differs from frozen binding')
        if receipt.error or receipt.draft is None:
            self.repository.fail(lease,receipt.error or 'invalid_result')
            raise ValueError('Provider did not produce a usable draft')
        try:checked=validate_draft(pack,receipt.draft,request.locale)
        except ValueError:
            self.repository.fail(lease,'invalid_result')
            raise ValueError('Draft checks failed') from None
        return self.repository.finish(lease,checked)

    def status(self,owner):
        mode=self.settings.mode
        allowed=self.settings.permits_generation(owner)
        try:
            available=allowed and self.repository.available(owner,self.settings.binding)
            busy=self.repository.busy() if mode!='off' else False
            reason='disabled' if mode=='off' else None if available else 'generation_unavailable'
        except AzureConflict:
            available=busy=False;reason='state_unavailable'
        return AzureStatus(mode=mode,worker='off' if mode=='off' else 'busy' if busy else 'unknown',
            generation_allowed=bool(available),supported_engines=['timepitch','grf'],reason=reason)


def build_saved_service(runtime,settings):
    """Read saved sources without constructors that recover API-owned running matches."""
    from contextlib import contextmanager
    from pathlib import Path
    import sqlite3
    from ..service import saved_source
    from ...matches.repository import MatchRepository
    from ...grf.repository import GrfRepository
    from ...grf.statistics import build_grf_statistics
    from .repository import AzureRepository

    class ReadOnly:
        def __init__(self,path):self.path=path
        @contextmanager
        def connection(self):
            conn=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True,timeout=10)
            conn.row_factory=sqlite3.Row
            try:
                conn.execute('PRAGMA query_only=ON');yield conn
            finally:conn.close()

    class Matches(ReadOnly):
        def get_record(self,id,owner):return MatchRepository.get_record(self,id,owner)

    class Grf(ReadOnly):
        def get_match(self,id,owner):return GrfRepository.get_record(self,id,owner)
        def get_statistics(self,id,owner):return build_grf_statistics(self.get_match(id,owner))

    runtime=Path(runtime)
    if not (runtime/'runtime.sqlite').is_file():raise ValueError('Saved runtime is required')
    return AzureChronicleService(AzureRepository(runtime/'runtime.sqlite'),
        saved_source(Matches(runtime/'runtime.sqlite'),Grf(runtime/'grf.sqlite')),settings)
