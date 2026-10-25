"""Serial pull worker; never restart uncertain inference or regenerate an acknowledgement."""
import asyncio
import time
from .interfaces import BrokerClientProtocol, ChronicleProvider
from .models import WorkerResult, ClaimedJob, fact_pack_hash
from .worker_state import WorkerOutbox, OutboxState, RecoveryRequired, attach_failure, error_category, drain_cleanup
from .diagnostics import safe_diagnostic
from .http_client import BrokerError

BACKOFF=(1,2,4,8,15)


async def run_worker(client: BrokerClientProtocol, provider: ChronicleProvider, outbox: WorkerOutbox,
                     stop: asyncio.Event, *, clock=time.time, sleep=None, heartbeat_seconds=10):
    async def pause(seconds):
        if sleep: await sleep(seconds)
        else:
            try: await asyncio.wait_for(stop.wait(),seconds)
            except TimeoutError: pass
    state=None; failure=None
    try:
        state=outbox.load()
        if state and state.stage=='generation_started': raise RecoveryRequired('Generation outcome is uncertain; recovery required')
        failures=0
        while not stop.is_set():
            if state is None:
                try:
                    ready=await provider.readiness()
                    if stop.is_set(): break
                    if not ready:
                        await client.heartbeat(None,False); await pause(15); continue
                    claimed=await client.claim(True)
                    if claimed is None: await pause(1); continue
                    claimed=ClaimedJob.model_validate_json(claimed.model_dump_json())
                    if fact_pack_hash(claimed.fact_pack)!=claimed.lease.fact_hash: raise RecoveryRequired('Claim facts changed')
                    state=OutboxState(claim=claimed,stage='claimed',lease_deadline_at=min(clock()+60,claimed.deadline_at))
                    outbox.save(state); failures=0
                    if stop.is_set(): break
                except BrokerError as error:
                    if error.permanent: raise RecoveryRequired('Broker rejected worker admission') from None
                    await pause(error.retry_after or BACKOFF[min(failures,4)]); failures+=1; continue
            if clock()>=min(state.claim.deadline_at,state.lease_deadline_at):
                raise RecoveryRequired('Original lease has expired')
            if state.stage=='claimed':
                if not await provider.readiness(): raise RecoveryRequired('Provider unavailable for saved claim')
                if stop.is_set(): break
                try: await client.heartbeat(state.claim.lease,True)
                except BrokerError: raise RecoveryRequired('Cannot establish saved lease') from None
                if stop.is_set(): break
                state.lease_deadline_at=min(clock()+60,state.claim.deadline_at)
                state.stage='generation_started'; outbox.save(state)
                used=0
                def reserve(count):
                    nonlocal used
                    if type(count) is not int or count<1 or used+count>4: raise ValueError('Model call budget exhausted')
                    used+=count
                generation=asyncio.create_task(provider.generate(state.claim.fact_pack,state.claim.locale,reserve))
                lost=False
                try:
                    while not generation.done():
                        await asyncio.wait({generation},timeout=heartbeat_seconds)
                        if generation.done(): break
                        if clock()>=min(state.claim.deadline_at,state.lease_deadline_at): lost=True; continue
                        try:
                            await client.heartbeat(state.claim.lease,True)
                            state.lease_deadline_at=min(clock()+60,state.claim.deadline_at); outbox.save(state)
                        except BrokerError as error:
                            if error.permanent: lost=True
                    receipt=await asyncio.shield(generation)
                    if used!=receipt.actual_calls: raise ValueError('Provider usage mismatch')
                    state.result=WorkerResult(lease=state.claim.lease,selection=receipt.selection,
                        actual_calls=receipt.actual_calls,evidence_reads=receipt.evidence_reads,model_id=receipt.model_id)
                    state.stage='result_saved'; outbox.save(state)
                    if lost: raise RecoveryRequired('Lease lost during generation')
                except asyncio.CancelledError as error:
                    # Close future sends, then drain the cancelled operation and owned native work.
                    generation.cancel()
                    try: await generation
                    except (Exception,asyncio.CancelledError) as generated_error:
                        attach_failure(error,generated_error)
                        error.chronicle_error_category='CancelledError'
                    raise
                except RecoveryRequired: raise
                except Exception as error:
                    raise attach_failure(RecoveryRequired('Generation did not produce a safe receipt'),error) from None
                finally:
                    if not generation.done():
                        await asyncio.shield(asyncio.gather(generation,return_exceptions=True))
                if stop.is_set(): break
            while state and not stop.is_set():
                if state.ack_attempts>=3 or clock()>=min(state.claim.deadline_at,state.lease_deadline_at):
                    raise RecoveryRequired('Receipt acknowledgement needs recovery')
                state.ack_attempts+=1; outbox.save(state)
                try: await client.complete(state.result)
                except BrokerError as error:
                    if error.permanent: raise attach_failure(RecoveryRequired('Original receipt was refused'),error,stage='broker_delivery') from None
                    if state.ack_attempts>=3: raise attach_failure(RecoveryRequired('Receipt acknowledgement needs recovery'),error,stage='broker_delivery') from None
                    await pause(error.retry_after or BACKOFF[state.ack_attempts-1]); continue
                outbox.clear(state.claim.lease); state=None
    except (Exception,asyncio.CancelledError) as error:
        failure=attach_failure(error,stage='broker_delivery' if state and state.stage=='result_saved' else 'unknown')
        if state is not None:
            try:
                saved=outbox.save_diagnostic(state.claim.lease,safe_diagnostic(failure),error_category(failure))
                failure.diagnostic=saved.diagnostic
                failure.chronicle_error_category=saved.error_category
            except Exception:
                failure.diagnostic_persistence_error='diagnostic_persistence_failed'
        raise
    finally:
        # close() drains uncertain provider requests before CLI releases inference.lock.
        try:
            try: await drain_cleanup(provider.close(),failure=failure)
            except (Exception,asyncio.CancelledError) as error:
                if isinstance(error,asyncio.CancelledError) or failure is None:
                    failure=attach_failure(error,failure) if failure is not None else attach_failure(error)
                    raise
        finally:
            try: await drain_cleanup(client.close(),failure=failure)
            except (Exception,asyncio.CancelledError) as error:
                if isinstance(error,asyncio.CancelledError) or failure is None:
                    raise attach_failure(error,failure) if failure is not None else error


def check_private_acl(path):
    """Require private config/outbox permissions without printing their contents."""
    import os
    import subprocess
    if os.name!='nt':
        if path.stat().st_mode&0o077: raise RecoveryRequired('Worker configuration permissions are not private')
        return
    script="""
$ErrorActionPreference='Stop'
$acl=Get-Acl -LiteralPath $env:TIMEPITCH_WORKER_CONFIG_FILE
$allowed=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed) { exit 2 }
foreach($rule in $acl.Access) {
 if($rule.AccessControlType -eq 'Allow') {
  $sid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if($sid -notin $allowed) { exit 2 }
 }
}
exit 0
"""
    completed=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],
        env={**{key:value for key,value in os.environ.items() if key.lower()!='psmodulepath'},
             'TIMEPITCH_WORKER_CONFIG_FILE':str(path)},capture_output=True,timeout=15)
    if completed.returncode: raise RecoveryRequired('Worker configuration permissions are not private')


def read_config(path,root):
    from hashlib import sha256
    import json
    from pathlib import Path
    from pydantic import SecretStr, Field
    from typing import Literal
    from .models import StrictModel, Identifier
    from .worker_state import safe_path
    class Config(StrictModel):
        origin: Literal['https://timepitch.diloclaro.app']
        worker_id: Identifier
        token: SecretStr = Field(min_length=32,max_length=512)
    path=safe_path(path); local=safe_path(Path(root)/'.local')
    if not path.is_relative_to(local) or not path.is_file() or path.stat().st_size>4096:
        raise RecoveryRequired('Worker requires a private config under project .local')
    check_private_acl(path); check_private_acl(path.parent)
    config=Config.model_validate_json(path.read_bytes())
    raw=config.token.get_secret_value()
    if any(ord(c)<33 or ord(c)>126 for c in raw): raise RecoveryRequired('Invalid worker configuration')
    binding=sha256(json.dumps([config.origin,config.worker_id,raw],separators=(',',':')).encode()).hexdigest()
    return config,binding


async def worker_main(config_path,*,check_only=False,root=None,stop=None):
    from contextlib import ExitStack
    from pathlib import Path
    from ..config import ROOT
    from ..runtime import RuntimeLease
    from .worker_state import safe_path
    root=Path(root or ROOT)
    config,binding=read_config(config_path,root)
    worker_dir=safe_path(root/'.local/ai-worker'); worker_dir.mkdir(parents=True,exist_ok=True)
    # The private config directory must be the worker directory in production.
    # Tests can provide another private .local config; the outbox still stays fixed.
    check_private_acl(worker_dir)
    with ExitStack() as leases:
        leases.enter_context(RuntimeLease(safe_path(worker_dir/'worker.lock')))
        leases.enter_context(RuntimeLease(safe_path(root/'.local/inference.lock')))
        outbox=WorkerOutbox(worker_dir/'active.json',binding=binding)
        state=outbox.load()
        if state and state.stage=='generation_started': raise RecoveryRequired('Generation outcome is uncertain; recovery required')
        if check_only: return 'Configuration, private permissions, outbox and leases valid. No model checked or started.'
        from .provider import FoundryChronicleProvider
        from .http_client import BrokerClient
        await run_worker(BrokerClient(config.origin,config.worker_id,config.token.get_secret_value()),
                         FoundryChronicleProvider(),outbox,stop or asyncio.Event())


def main():
    import argparse
    import signal
    parser=argparse.ArgumentParser(description='TimePitch outgoing AI worker; never starts or loads Foundry')
    parser.add_argument('--config',required=True); parser.add_argument('--check-only',action='store_true')
    args=parser.parse_args()
    async def launch():
        stop=asyncio.Event(); loop=asyncio.get_running_loop()
        previous=signal.signal(signal.SIGINT,lambda *_:loop.call_soon_threadsafe(stop.set))
        try:
            message=await worker_main(args.config,check_only=args.check_only,stop=stop)
            if message: print(message)
        finally: signal.signal(signal.SIGINT,previous)
    try: asyncio.run(launch())
    except Exception:
        print('Worker stopped safely. Check private configuration, permissions, leases or recovery instructions. No automatic regeneration.')
        return 1
    return 0


if __name__=='__main__': raise SystemExit(main())
