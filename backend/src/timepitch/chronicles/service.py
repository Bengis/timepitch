"""Resolve owned saved evidence, freeze it, and independently compose results."""
from .models import fact_pack_hash
from .repository import ChronicleConflict
from .render import render_chronicle


def saved_source(matches, grf):
    def resolve(owner, request):
        from .facts import from_grf, from_timepitch
        if request.engine=='timepitch':
            record=matches.get_record(request.match_id,owner)
            if record.trace_hash!=request.trace_hash: raise ValueError('Stale source')
            return from_timepitch(record)
        from ..grf.models import GrfReplay, GrfFullMatchReplay, GrfStatisticsReplay
        record=grf.get_match(request.match_id,owner)
        if not isinstance(record,(GrfReplay,GrfFullMatchReplay,GrfStatisticsReplay)):
            raise ValueError('Unsupported replay profile')
        if record.trace_hash!=request.trace_hash: raise ValueError('Stale source')
        return from_grf(record,grf.get_statistics(request.match_id,owner))
    return resolve


class ChronicleService:
    def __init__(self, repository, source):
        self.repository,self.source=repository,source

    def submit(self, owner, request):
        return self.repository.submit(owner,request,self.source(owner,request))

    def lookup(self, owner, request):
        current=self.source(owner,request)
        job=self.repository.lookup(owner,request)
        if job and job.fact_hash!=fact_pack_hash(current): raise ValueError('Stale facts')
        return job

    def get(self, owner, job_id):
        job=self.repository.get(job_id,owner)
        _,request,_=self.repository.internal(job_id)
        if fact_pack_hash(self.source(owner,request))!=job.fact_hash: raise ValueError('Stale facts')
        return job

    def _recheck(self, job_id):
        owner,request,stored=self.repository.internal(job_id)
        current=self.source(owner,request)
        if fact_pack_hash(current)!=fact_pack_hash(stored): raise ValueError('Stale facts')
        return stored,request.locale

    def claim(self, identity):
        self.repository.expire()
        for id in self.repository.pending():
            try: self._recheck(id)
            except KeyError:
                self.repository.fail(id,'source_unavailable'); continue
            except ValueError:
                self.repository.fail(id,'stale_revision'); continue
            job=self.repository.claim(identity,job_id=id)
            if job: return job
        return None

    def complete(self, identity, result):
        # Fence before touching state: a forged result cannot reject someone else's job.
        self.repository.validate_lease(identity,result.lease)
        try: pack,locale=self._recheck(result.lease.job_id)
        except (KeyError,ValueError) as exc:
            error='source_unavailable' if isinstance(exc,KeyError) else 'stale_revision'
            self.repository.fail(result.lease.job_id,error)
            raise ChronicleConflict('Source no longer available') from None
        try: text=render_chronicle(pack,result.selection,locale)
        except ValueError:
            self.repository.fail(result.lease.job_id,'invalid_result',rejected=True)
            raise ValueError('Invalid fact selection') from None
        return self.repository.complete(identity,result,text=text)
