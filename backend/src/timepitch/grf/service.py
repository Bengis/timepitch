"""One bounded native worker and explicitly owned experimental jobs."""
from concurrent.futures import ThreadPoolExecutor
import threading
from .input import make_statistics_input
from .codec import validate_grf
from .process import GrfExecutionError,GrfUnavailable,GrfCancelled
from ..matches.service import QueueFullError


class GrfService:
    @staticmethod
    def validate_selection(mode,physical_telemetry):
        if mode not in ('compressed','physical'):raise ValueError('Unknown GRF mode')
        if physical_telemetry not in ('legacy','actions-1') or (physical_telemetry=='actions-1' and mode!='physical'):
            raise ValueError('Invalid physical telemetry selection')

    def __init__(self,catalog,repository,runner,*,physical_repository=None,physical_runner=None,mode='compressed',physical_telemetry='legacy'):
        self.validate_selection(mode,physical_telemetry)
        self.catalog=catalog;self.repository=repository;self.runner=runner
        self.physical_telemetry=physical_telemetry
        self.mode=mode;self.physical_repository=physical_repository;self.physical_runner=physical_runner
        self.legacy_repository=repository
        if physical_repository is not None:
            from .physical_repository import GrfRepositoryFacade
            self.repository=GrfRepositoryFacade(repository,physical_repository)
        self._slots=threading.BoundedSemaphore(5);self._lock=threading.RLock()
        self._cancelled=threading.Event();self._futures={}
        self._worker=ThreadPoolExecutor(max_workers=1,thread_name_prefix='timepitch-grf')

    def capability(self):
        runner=self.physical_runner if self.mode=='physical' else self.runner
        result=runner.capability()
        return result.model_copy(update={'clock_policy':'physical-periods-1' if self.mode=='physical' else 'compressed'})

    def create_match(self,config,owner):
        with self._lock:
            if self._cancelled.is_set():raise GrfCancelled()
        if self.mode=='physical':
            from .input import make_physical_input,make_action_input
            request=(make_action_input if self.physical_telemetry=='actions-1' else make_physical_input)(config,self.catalog)
        else:request=make_statistics_input(config,self.catalog)
        if not self.capability().available:raise GrfUnavailable()
        with self._lock:
            if self._cancelled.is_set():raise GrfCancelled()
            if not self._slots.acquire(blocking=False):raise QueueFullError()
            job=None
            try:
                target=self.physical_repository if self.mode=='physical' else self.legacy_repository
                job=target.create(config,owner)
                future=self._worker.submit(self._run,job,owner,request)
                self._futures[future]=(job.id,owner)
                future.add_done_callback(self._done)
                return job
            except Exception:
                self._slots.release()
                if job:target.fail(job.id,owner,'native_failed')
                raise

    def _done(self,future):
        with self._lock:
            job=self._futures.pop(future,None)
        if job:
            try:
                if future.cancelled():self._repository(job[0]).fail(*job,'interrupted')
            finally:self._slots.release()

    def _run(self,job,owner,request):
        repository=self._repository(job.id);result=None
        try:
            if self._cancelled.is_set():raise GrfCancelled()
            if not repository.start(job.id,owner):return
            if job.id.startswith('physical-'):
                result=self.physical_runner.run(request,self._cancelled)
                for chunk in result.chunks():
                    if self._cancelled.is_set():raise GrfCancelled()
                    repository.append_chunk(job.id,owner,chunk)
                record=result.manifest
            else:
                record=self.runner.run(request,self._cancelled)
                validate_grf(record,request)
            with self._lock:
                if self._cancelled.is_set():raise GrfCancelled()
                repository.finish(job.id,owner,record)
        except GrfExecutionError as error:repository.fail(job.id,owner,error.code)
        except Exception:repository.fail(job.id,owner,'native_failed')
        finally:
            if result:result.close()

    def _repository(self,id):return self.physical_repository if id.startswith('physical-') else self.legacy_repository

    def get_match(self,id,owner):return self.repository.get_record(id,owner)

    def get_statistics(self,id,owner):
        if id.startswith('physical-'):
            from .physical_statistics import build_physical_statistics
            from .action_statistics import build_action_statistics
            from .action_models import ActionManifest
            record=self.get_match(id,owner)
            builder=build_action_statistics if isinstance(record,ActionManifest) else build_physical_statistics
            return builder(record,self.physical_repository.iter_physical_chunks(id,owner))
        from .statistics import build_grf_statistics
        return build_grf_statistics(self.get_match(id,owner))

    def close(self):
        with self._lock:
            self._cancelled.set();futures=list(self._futures)
        for future in futures:future.cancel()
        self.runner.close()
        if self.physical_runner:self.physical_runner.close()
        self._worker.shutdown(wait=True,cancel_futures=True)
