"""Independent serial consumer; a possible dispatch is never generated again."""
import asyncio
import json
from pathlib import Path
import sqlite3
from typing import Literal

from ...runtime import RuntimeLease
from ..models import canonical_bytes, fact_pack_hash
from .models import AzureClaim,AzureReceipt,ProseModel,WorkerOutcome
from .provider import AzureProvider,prepare_request
from .repository import AzureBudgetExceeded,AzureConflict
from .service import build_saved_service


class Active(ProseModel):
    claim: AzureClaim
    stage: Literal['claimed','dispatching','receipt_saved'] = 'claimed'
    receipt: AzureReceipt | None = None


class WorkerStopped(RuntimeError):
    def __init__(self,outcome):self.outcome=outcome;super().__init__('Consumer stopped safely')


def _save(repo,path,state):repo._write_private(path,canonical_bytes(state),replace=True)


def _fail(service,claim,code,*,uncertain=False):
    try:service.repository.fail(claim.lease,code,uncertain=uncertain)
    except AzureConflict:pass


def _settle(service,state,path):
    repo=service.repository;claim=state.claim;receipt=state.receipt
    repo.record_receipt(claim.lease,receipt)
    if receipt.error=='uncertain_send':
        _fail(service,claim,'uncertain_send',uncertain=True)
        return WorkerOutcome(state='uncertain',job_id=claim.lease.job_id,reason='uncertain_send')
    try:job=service.complete(claim.lease,receipt)
    except (KeyError,ValueError):job=repo.get(claim.owner,claim.lease.job_id)
    if job.state not in ('ready','rejected','unavailable','stale'):
        return WorkerOutcome(state='unavailable',job_id=job.id,reason='configuration_unavailable')
    path.unlink()
    return WorkerOutcome(state='ready' if job.state=='ready' else 'rejected' if job.state=='rejected' else 'unavailable',
        job_id=job.id,reason=job.error)


async def run_once(service,provider,worker_id,*,stop=None):
    if service.settings.mode=='off':return WorkerOutcome(state='idle',reason='disabled')
    repo=service.repository;path=repo.private_dir/'worker-active.json'
    try:
        lock=RuntimeLease(repo.path.parent/'azure-chronicle.lock')
        try:lock.__enter__()
        except RuntimeError:return WorkerOutcome(state='unavailable',reason='worker_busy')
        try:
            if path.exists():
                if path.is_symlink() or path.stat().st_size>262144:raise ValueError('Invalid private outbox')
                state=Active.model_validate_json(path.read_bytes())
                if fact_pack_hash(state.claim.fact_pack)!=state.claim.lease.fact_hash:raise ValueError('Outbox facts changed')
                saved=repo.saved_receipt(state.claim.lease)
                if saved is not None:
                    if state.receipt is not None and state.receipt!=saved:raise ValueError('Receipt changed')
                    state.receipt=saved
                if state.receipt is not None:return _settle(service,state,path)
                uncertain=repo.has_attempt(state.claim.lease)
                _fail(service,state.claim,'uncertain_send' if uncertain else 'provider_error',uncertain=uncertain)
                if not uncertain:path.unlink()
                return WorkerOutcome(state='uncertain' if uncertain else 'unavailable',job_id=state.claim.lease.job_id,
                    reason='uncertain_send' if uncertain else 'interrupted_before_send')
            interrupted=repo.interrupt_orphans()
            if interrupted:return WorkerOutcome(state='uncertain' if interrupted=='uncertain_send' else 'unavailable',reason=interrupted)
            if stop is not None and stop.is_set():return WorkerOutcome(state='idle',reason='stopped')
            claim=service.claim(worker_id)
            if claim is None:return WorkerOutcome(state='idle')
            state=Active(claim=claim);_save(repo,path,state)
            try:
                prepared=prepare_request(claim.fact_pack,claim.request.locale,claim.binding)
                def authorize(value):
                    if stop is not None and stop.is_set():raise ValueError('Stopped before dispatch')
                    if (not service.settings.permits_generation(claim.owner) or service.settings.binding!=claim.binding):
                        raise ValueError('Generation scope changed')
                    try:service._recheck(claim.lease.job_id)
                    except (KeyError,ValueError) as exc:
                        _fail(service,claim,'source_unavailable' if isinstance(exc,KeyError) else 'stale_revision')
                        raise
                    permit=repo.authorize_send(claim.lease,value)
                    state.stage='dispatching';_save(repo,path,state)
                    return permit
                state.receipt=await provider.generate(prepared,authorize)
                # SQL first: a crash before saving the outbox can still replay this exact receipt.
                repo.record_receipt(claim.lease,state.receipt)
                state.stage='receipt_saved';_save(repo,path,state)
                return _settle(service,state,path)
            except AzureBudgetExceeded:
                _fail(service,claim,'budget_exhausted')
                return WorkerOutcome(state='unavailable',job_id=claim.lease.job_id,reason='budget_exhausted')
            except Exception:
                # Preserve a returned receipt even if SQLite was busy before its first write.
                if state.receipt is not None:
                    state.stage='receipt_saved';_save(repo,path,state)
                uncertain=repo.has_attempt(claim.lease)
                _fail(service,claim,'uncertain_send' if uncertain else 'provider_error',uncertain=uncertain)
                if not uncertain:path.unlink()
                return WorkerOutcome(state='uncertain' if uncertain else 'unavailable',job_id=claim.lease.job_id,
                    reason='uncertain_send' if uncertain else 'configuration_unavailable')
        finally:lock.__exit__(None,None,None)
    except AzureBudgetExceeded:return WorkerOutcome(state='unavailable',reason='budget_exhausted')
    except (ValueError,OSError,sqlite3.DatabaseError):return WorkerOutcome(state='unavailable',reason='configuration_unavailable')


async def run_worker(service,provider,worker_id,*,stop):
    try:
        while not stop.is_set():
            result=await run_once(service,provider,worker_id,stop=stop)
            if result.state=='uncertain' or result.reason in ('disabled','configuration_unavailable','budget_exhausted','worker_busy'):
                raise WorkerStopped(result)
            if result.state=='idle':
                try:await asyncio.wait_for(stop.wait(),1)
                except TimeoutError:pass
    finally:await provider.close()


def exit_code(outcome):
    if outcome.state=='uncertain':return 3
    if outcome.reason in ('disabled','configuration_unavailable','budget_exhausted','worker_busy'):return 2
    return 0


def main(argv=None):
    import argparse
    import os
    import signal
    from .settings import AzureSettings
    parser=argparse.ArgumentParser(description='TimePitch Azure chronicle consumer; no model probes or grants')
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--runtime',type=Path,default=Path(os.getenv('TIMEPITCH_RUNTIME_DIR','.local')))
    args=parser.parse_args(argv)
    async def launch():
        settings=AzureSettings.from_env()
        if settings.mode=='off':return WorkerOutcome(state='idle',reason='disabled')
        service=build_saved_service(args.runtime,settings);provider=AzureProvider(settings)
        stop=asyncio.Event();loop=asyncio.get_running_loop();previous={}
        for sig in (signal.SIGINT,signal.SIGTERM):
            previous[sig]=signal.signal(sig,lambda *_:loop.call_soon_threadsafe(stop.set))
        try:
            if args.once:return await run_once(service,provider,'azure-serial',stop=stop)
            try:await run_worker(service,provider,'azure-serial',stop=stop)
            except WorkerStopped as exc:return exc.outcome
            return WorkerOutcome(state='idle',reason='stopped')
        finally:
            await provider.close()
            for sig,handler in previous.items():signal.signal(sig,handler)
    try:outcome=asyncio.run(launch())
    except Exception:outcome=WorkerOutcome(state='unavailable',reason='configuration_unavailable')
    print(json.dumps({'state':outcome.state,'reason':outcome.reason},separators=(',',':')))
    return exit_code(outcome)


if __name__=='__main__':raise SystemExit(main())
