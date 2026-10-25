"""One explicitly selected live slot; check-only never constructs a provider."""
import asyncio
from contextlib import ExitStack
from hashlib import sha256
import json
import math
from pathlib import Path
import secrets
import time
from typing import Literal

from .models import StrictModel,FactPack,ChronicleRequest,Digest,fact_pack_hash,canonical_bytes
from .canary_budget import (CanaryAuthorization,CanaryBudget,CanaryUsage,CanaryRefused,
    canary_directory,verify_authorization,authorization_digest)
from .canary_recovery import issue_canary_permit,assert_active_canary
from .canary_runtime import OwnedRuntimeController,OwnedRuntimeChanges
from .diagnostics import ProviderDiagnostic,safe_diagnostic
from .worker_state import safe_path,atomic_write,WorkerOutbox,attach_failure,drain_cleanup
from ..runtime import RuntimeLease


class CanaryReadiness(StrictModel):
    ready:bool
    model_ready:Literal[False]=False
    blockers:list[Literal['authorization_invalid','source_invalid','story_source_insufficient']]
    fact_hash:Digest|None=None


def _source(authorization,root):
    from ..simulation.replay import parse_replay,trace_hash
    from .facts import from_timepitch
    _,path=verify_authorization(authorization,root)
    record=parse_replay(path.read_bytes())
    if trace_hash(record)!=record.trace_hash or record.trace_hash!=authorization.trace_hash:raise CanaryRefused('Source trace changed')
    pack=from_timepitch(record)
    if fact_pack_hash(pack)!=authorization.fact_hash:raise CanaryRefused('Source facts changed')
    if len([f for f in pack.facts if f.kind in ('goal','actor_stat','team_compare')])<2:raise CanaryRefused('Insufficient recorded observations')
    return pack


def check_canary_inputs(authorization,*,root):
    try:verify_authorization(authorization,root)
    except CanaryRefused:return CanaryReadiness(ready=False,blockers=['authorization_invalid'])
    try:pack=_source(authorization,root)
    except (ValueError,OSError,CanaryRefused):return CanaryReadiness(ready=False,blockers=['source_invalid'])
    return CanaryReadiness(ready=True,blockers=[],fact_hash=fact_pack_hash(pack))


class CanaryReport(StrictModel):
    status:Literal['succeeded','failed','aborted']
    authorization:Digest
    usage:CanaryUsage|None
    diagnostic:ProviderDiagnostic|None=None
    broker_state:Literal['not_submitted','queued','running','ready','unavailable','rejected','unknown']='not_submitted'
    text:str=''
    event_refs:list[str]=[]
    wall_ms:float
    sampled_resources:list[dict]
    errors:list[str]
    cleanup_complete:bool


def _sample(sampler):
    raw=sampler();keys=('monotonic_s','python_rss_bytes','foundry_rss_bytes','gpu_total_used_mib')
    return {key:(raw[key] if type(raw.get(key)) in (int,float) and math.isfinite(raw[key]) and raw[key]>=0 else None) for key in keys}


async def run_qwen_canary(authorization,*,root=None,provider_factory=None,runtime_controller=None,sampler=None,job_timeout_s=180):
    from ..config import ROOT
    from .acceptance import validate_story,sample_resources,AcceptanceRefused
    from .provider import FoundryChronicleProvider
    from .worker import run_worker
    from .repository import ChronicleRepository
    from .service import ChronicleService
    from .http_client import BrokerClient,ORIGIN,BrokerError
    from .auth import ChronicleSettings
    from ..api.chronicles import chronicles_router
    from ..security import install_security
    from fastapi import FastAPI
    import httpx
    root=safe_path(root or ROOT)
    if not 0<job_timeout_s<=180:raise CanaryRefused('Invalid job deadline')
    if root==ROOT and any(x is not None for x in (provider_factory,runtime_controller,sampler)):
        raise CanaryRefused('Production canary dependencies are fixed')
    if root!=ROOT and any(x is None for x in (provider_factory,runtime_controller,sampler)):
        raise CanaryRefused('Isolated roots require explicit synthetic dependencies')
    if not check_canary_inputs(authorization,root=root).ready:raise CanaryRefused('Canary inputs/approval unavailable')
    pack=_source(authorization,root);directory=canary_directory(root)
    controller=runtime_controller or OwnedRuntimeController(root,directory)
    sampler=sampler or sample_resources;provider_factory=provider_factory or FoundryChronicleProvider
    started=time.perf_counter();errors=[];samples=[];failure=None;cancelled=None
    provider=None;worker=None;setup=None;monitor=None;stop_monitor=asyncio.Event();cleanup_complete=True
    service=None;job=None;owner=secrets.token_hex(16);report=None
    native_completed=False;generation_failure=None;readiness_tasks=[]

    async def owned_readiness():
        task=asyncio.create_task(provider.readiness());readiness_tasks.append(task)
        return await asyncio.shield(task)

    async def close_provider():
        # Cancellation of to_thread does not cancel its native factory/inspection.
        # Finish readiness, including late transport assignment, before close.
        for task in readiness_tasks:
            await drain_cleanup(asyncio.gather(task,return_exceptions=True),failure=failure)
        await provider.close()

    async def sampling():
        while not stop_monitor.is_set():
            if len(samples)<512:samples.append(await asyncio.to_thread(_sample,sampler))
            try:await asyncio.wait_for(stop_monitor.wait(),2)
            except TimeoutError:pass

    async def observe(task):
        done,_=await asyncio.wait({task,monitor},return_when=asyncio.FIRST_COMPLETED)
        if monitor in done:
            raise RuntimeError('Resource sampling failed')
        return await task

    with ExitStack() as locks:
        locks.enter_context(RuntimeLease(directory/'canary.lock'))
        locks.enter_context(RuntimeLease(root/'.local/ai-worker/worker.lock'))
        budget=CanaryBudget.create_once(authorization,root=root)
        permit=None
        try:
            permit=issue_canary_permit(budget,inspector=controller.inspect_absence if root!=ROOT else None)
            # All provider/setup/drain/restore work is inside this common lease.
            with RuntimeLease(root/'.local/inference.lock',canary_recovery=permit):
                try:
                    budget.begin()
                    monitor=asyncio.create_task(sampling())
                    atomic_write(directory/'startup-intent.json',canonical_bytes(authorization))
                    setup=asyncio.create_task(asyncio.to_thread(controller.start_and_load,120))
                    async with asyncio.timeout(120):await observe(setup)
                    async with asyncio.timeout(job_timeout_s):
                        provider=provider_factory()
                        if not await owned_readiness():
                            error=RuntimeError('Approved provider is not ready')
                            error.diagnostic=ProviderDiagnostic(stage='readiness',reason='provider_not_ready',http_admitted=0)
                            raise error
                        instrumented=getattr(provider,'transport',None) is not None
                        if instrumented:
                            async def received(_):budget.response()
                            provider.transport.client.client._client.event_hooks.setdefault('response',[]).append(received)
                        repo=ChronicleRepository(directory/'broker.sqlite')
                        def source(_,request):
                            if request.engine!='timepitch' or request.trace_hash!=authorization.trace_hash:raise CanaryRefused('Wrong canary source')
                            _source(authorization,root)
                            return FactPack.model_validate_json(pack.model_dump_json())
                        service=ChronicleService(repo,source);app=FastAPI();app.state.chronicles=service
                        token=secrets.token_urlsafe(40);worker_id='timepitch-canary-1'
                        settings=ChronicleSettings(mode='public',worker_id=worker_id,token_sha256=sha256(token.encode()).hexdigest())
                        app.state.chronicles_settings=settings;app.include_router(chronicles_router())
                        install_security(app,runtime_dir=directory,worker_auth=settings,public_origin_override=ORIGIN)
                        job=service.submit(owner,ChronicleRequest(engine='timepitch',match_id='canary-stored',trace_hash=pack.trace_hash,locale='en'))
                        client=BrokerClient(ORIGIN,worker_id,token,transport=httpx.ASGITransport(app=app))
                        complete=client.complete;stop=asyncio.Event()
                        async def done(value):
                            try:validate_story(pack,value.selection,'en')
                            except (ValueError,AcceptanceRefused) as error:
                                usage=budget.snapshot()
                                error.diagnostic=ProviderDiagnostic(stage='story_validation',reason='selection_invalid',
                                    http_admitted=usage.new_charged,response_headers_received=usage.new_response_headers if instrumented else None,
                                    evidence_reads=value.evidence_reads)
                                raise
                            try:await complete(value)
                            except BrokerError as error:
                                error.permanent=True;raise  # One ACK attempt in this bounded canary.
                            stop.set()
                        client.complete=done
                        class Metered:
                            async def readiness(self):return await owned_readiness()
                            async def generate(self,pack,locale,reserve):
                                nonlocal native_completed,generation_failure
                                atomic_write(directory/'inference-uncertain.json',json.dumps({'authorization':authorization_digest(authorization),'state':'generation_started'}).encode())
                                if hasattr(controller,'mark_inference_started'):controller.mark_inference_started()
                                def charge(count):
                                    assert_active_canary(permit,budget);budget.reserve_http(count);reserve(count)
                                try:receipt=await provider.generate(pack,locale,charge)
                                except (Exception,asyncio.CancelledError) as error:
                                    if generation_failure is None:generation_failure=attach_failure(error)
                                    raise
                                native_completed=True
                                return receipt
                            async def close(self):await close_provider()
                        outbox=WorkerOutbox(directory/'active.json',binding=authorization_digest(authorization))
                        worker=asyncio.create_task(run_worker(client,Metered(),outbox,stop))
                        await observe(worker)
                        if service.get(owner,job.id).state!='ready':raise CanaryRefused('Broker did not accept the canary')
                except (Exception,asyncio.CancelledError) as error:
                    failure=attach_failure(error,generation_failure) if generation_failure is not None else attach_failure(error)
                    if isinstance(error,asyncio.CancelledError):cancelled=error
                    if worker and not worker.done():worker.cancel()
                    try:budget.finish('failed')
                    except Exception:errors.append('accounting_persistence_failed')
                finally:
                    # A timed-out native setup/generation is not proof it stopped.
                    for task in (setup,worker):
                        if task:
                            try:await drain_cleanup(asyncio.gather(task,return_exceptions=True),failure=failure)
                            except (Exception,asyncio.CancelledError) as error:
                                cleanup_complete=False
                                if isinstance(error,asyncio.CancelledError):cancelled=error
                    if provider:
                        try:await drain_cleanup(close_provider(),failure=failure)
                        except (Exception,asyncio.CancelledError) as error:
                            cleanup_complete=False;errors.append('provider_close_failed')
                            if isinstance(error,asyncio.CancelledError):cancelled=error
                    if setup:
                        try:
                            # A complete receipt or zero admitted sends is native completion evidence.
                            # Local parse/schema errors also follow a fully observed body, after SDK drain.
                            d=safe_diagnostic(failure) if failure else None
                            known_body=d and d.response_chars is not None and d.reason in ('json_invalid','json_object_required','schema_invalid',
                                'analysis_result_missing','analysis_duplicate_facts','analysis_insufficient_observations','evidence_missing','selection_invalid')
                            if provider and cleanup_complete and (native_completed or known_body or budget.snapshot().new_charged==0):
                                if hasattr(controller,'mark_inference_finished'):controller.mark_inference_finished()
                            await drain_cleanup(asyncio.to_thread(controller.restore,controller.owned_changes()),failure=failure)
                        except (Exception,asyncio.CancelledError) as error:
                            cleanup_complete=False;errors.append('owned_restore_failed')
                            if isinstance(error,asyncio.CancelledError):cancelled=error
                    stop_monitor.set()
                    if monitor:
                        try:await drain_cleanup(monitor,failure=failure)
                        except (Exception,asyncio.CancelledError) as error:
                            errors.append('resource_sample_failed');cleanup_complete=False
                            if isinstance(error,asyncio.CancelledError):cancelled=error
        except (Exception,asyncio.CancelledError) as error:
            if failure is None:failure=attach_failure(error)
            if isinstance(error,asyncio.CancelledError):cancelled=error
        try:
            usage=budget.snapshot()
            if usage.state=='fresh':budget.finish('aborted')
            elif usage.state=='running':budget.finish('succeeded' if failure is None and not errors and cancelled is None else 'failed')
            usage=budget.snapshot()
        except Exception:usage=None;errors.append('usage_unavailable')
        try:view=service.get(owner,job.id) if service and job else None
        except Exception:view=None;errors.append('broker_view_unavailable')
        status='aborted' if usage and usage.state=='aborted' else 'succeeded' if usage and usage.state=='succeeded' and failure is None and not errors else 'failed'
        report=CanaryReport(status=status,
            authorization=authorization_digest(authorization),usage=usage,diagnostic=safe_diagnostic(failure) if failure else None,
            broker_state=view.state if view else 'unknown' if job else 'not_submitted',text=view.text if view and view.state=='ready' else '',
            event_refs=view.event_refs if view and view.state=='ready' else [],wall_ms=(time.perf_counter()-started)*1000,
            sampled_resources=samples,errors=errors,cleanup_complete=cleanup_complete)
        try:atomic_write(directory/'report.json',report.model_dump_json(indent=2).encode())
        except Exception:report.status='failed';report.errors.append('report_persistence_failed')
    if cancelled is not None:raise cancelled
    return report


def main(argv=None):
    import argparse
    from ..config import ROOT
    parser=argparse.ArgumentParser(description='One explicitly selected Qwen canary; no automatic admission')
    mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--check-only',action='store_true');mode.add_argument('--run',action='store_true')
    args=parser.parse_args(argv)
    try:
        path=safe_path(canary_directory(ROOT)/'authorization.json')
        if not path.is_file() or path.stat().st_size>16384:raise CanaryRefused('No phase3 authorization')
        a=CanaryAuthorization.model_validate_json(path.read_bytes())
        if args.check_only:
            result=check_canary_inputs(a,root=ROOT);print(result.model_dump_json());return 0 if result.ready else 1
        report=asyncio.run(run_qwen_canary(a,root=ROOT));print('Canary stopped; inspect its private bounded report.');return 0 if report.status=='succeeded' else 1
    except Exception:
        print('Canary refused or stopped safely; preserve its original approval and evidence.');return 1


if __name__=='__main__':raise SystemExit(main())
