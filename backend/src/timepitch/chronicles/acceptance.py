"""One immutable PC-worker grant; no simulated matches, bootstrap or automatic retry."""
import asyncio
from contextlib import contextmanager, ExitStack
from hashlib import sha256
import json
from pathlib import Path
import secrets
import sqlite3
import time
from typing import Callable
from .models import StrictModel, FactPack, ChronicleRequest, PROFILE, fact_pack_hash
from .worker_state import safe_path, atomic_write, WorkerOutbox, attach_failure, error_category, drain_cleanup
from .diagnostics import safe_diagnostic

SLOTS=('preflight','timepitch-en','timepitch-es','grf-en','grf-es-public')


def implementation_binding():
    directory=Path(__file__).parent
    files=('acceptance.py','provider.py','worker.py','worker_state.py','diagnostics.py','facts.py','render.py','models.py','http_client.py')
    return {name:sha256((directory/name).read_bytes()).hexdigest() for name in files}


class AcceptanceRefused(RuntimeError): pass


class AcceptanceBudget:
    @staticmethod
    def canonical(path,grant_root=None):
        from ..config import ROOT
        grant_root=safe_path(grant_root or ROOT/'.local/ai-worker-acceptance/pc-worker-20261019-1')
        path=safe_path(path)
        if path!=grant_root/'usage.sqlite': raise AcceptanceRefused('Grant has one canonical ledger path')
        return path

    @staticmethod
    def initialize(path:Path, manifest_hash:str,*,grant_root=None):
        path=AcceptanceBudget.canonical(path,grant_root); anchor=safe_path(path.with_suffix('.anchor.json'))
        if path.exists() or anchor.exists(): raise AcceptanceRefused('Allowance already exists; never initialise again')
        path.parent.mkdir(parents=True,exist_ok=True)
        nonce=secrets.token_hex(32)
        # Anchor is deliberately created first. Interrupted initialisation cannot mint a replacement grant.
        try:
            with anchor.open('xb') as stream:
                stream.write(json.dumps({'nonce':nonce,'manifest':manifest_hash}).encode()); stream.flush()
                import os
                os.fsync(stream.fileno())
            with path.open('xb'): pass
            from contextlib import closing
            with closing(sqlite3.connect(path)) as conn, conn:
                conn.executescript('CREATE TABLE metadata(nonce TEXT,manifest TEXT,halted INTEGER); CREATE TABLE slots(name TEXT PRIMARY KEY,state TEXT,charged INTEGER,reserved INTEGER,responses INTEGER);')
                conn.execute('INSERT INTO metadata VALUES(?,?,0)',(nonce,manifest_hash))
                conn.executemany('INSERT INTO slots VALUES(?,?,0,0,0)',[(name,'locked' if name==SLOTS[-1] else 'pending') for name in SLOTS])
        except (OSError,sqlite3.Error) as exc: raise AcceptanceRefused('Allowance initialisation interrupted; preserve files') from exc

    def __init__(self,path:Path,manifest_hash:str,*,grant_root=None):
        self.path=self.canonical(path,grant_root); self.manifest_hash=manifest_hash
        self._anchor=safe_path(self.path.with_suffix('.anchor.json'))
        self.snapshot()  # Missing/partial/binding mismatch is refused, never recreated.

    @contextmanager
    def connection(self):
        conn=None
        try:
            if not self.path.is_file() or not self._anchor.is_file() or self._anchor.stat().st_size>2048: raise ValueError()
            anchor=json.loads(self._anchor.read_bytes())
            conn=sqlite3.connect(self.path.resolve().as_uri()+'?mode=rw',uri=True,timeout=10)
            conn.row_factory=sqlite3.Row; conn.execute('BEGIN IMMEDIATE')
            meta=conn.execute('SELECT * FROM metadata').fetchall()
            if len(meta)!=1 or meta[0]['nonce']!=anchor['nonce'] or meta[0]['manifest']!=anchor['manifest'] or meta[0]['manifest']!=self.manifest_hash:
                raise ValueError()
            rows=conn.execute('SELECT * FROM slots').fetchall()
            if {r['name'] for r in rows}!=set(SLOTS) or any(not 0<=r['charged']<=4 or r['reserved'] not in (0,4) or not 0<=r['responses']<=r['charged'] for r in rows): raise ValueError()
            if sum(r['charged'] for r in rows)>20: raise ValueError()
            yield conn,meta[0]
            conn.commit()
        except (OSError,sqlite3.Error,ValueError,KeyError) as exc:
            if conn: conn.rollback()
            raise AcceptanceRefused('Allowance is missing, changed or invalid') from exc
        finally:
            if conn: conn.close()

    def snapshot(self):
        with self.connection() as (conn,_): return {r['name']:dict(r) for r in conn.execute('SELECT * FROM slots')}

    def require_fresh(self):
        with self.connection() as (conn,meta):
            if meta['halted'] or any(r['state'] not in ('pending','locked') for r in conn.execute('SELECT * FROM slots')):
                raise AcceptanceRefused('This grant already started; never rerun it')

    def begin(self,slot):
        with self.connection() as (conn,meta):
            rows={r['name']:r for r in conn.execute('SELECT * FROM slots')}
            if slot not in SLOTS[:-1] or meta['halted'] or rows[slot]['state']!='pending': raise AcceptanceRefused('Slot cannot be admitted')
            if any(rows[name]['state']!='accepted' for name in SLOTS[:SLOTS.index(slot)]): raise AcceptanceRefused('Previous slot did not pass')
            conn.execute("UPDATE slots SET state='running',reserved=4 WHERE name=?",(slot,))

    def reserve_http(self,slot):
        with self.connection() as (conn,meta):
            row=conn.execute('SELECT * FROM slots WHERE name=?',(slot,)).fetchone()
            total=conn.execute('SELECT SUM(charged) FROM slots').fetchone()[0]
            if meta['halted'] or slot not in SLOTS[:-1] or row['state']!='running' or row['charged']>=4 or total>=20:
                raise AcceptanceRefused('HTTP allowance exhausted or slot inactive')
            conn.execute('UPDATE slots SET charged=charged+1 WHERE name=?',(slot,))

    def response(self,slot):
        with self.connection() as (conn,_):
            row=conn.execute('SELECT * FROM slots WHERE name=?',(slot,)).fetchone()
            if row is None or row['responses']>=row['charged']: raise AcceptanceRefused('Unadmitted response')
            conn.execute('UPDATE slots SET responses=responses+1 WHERE name=?',(slot,))

    def finish(self,slot,accepted):
        with self.connection() as (conn,_):
            row=conn.execute('SELECT * FROM slots WHERE name=?',(slot,)).fetchone()
            if row is None or row['state']!='running': raise AcceptanceRefused('Slot is not running')
            conn.execute('UPDATE slots SET state=? WHERE name=?',('accepted' if accepted else 'failed',slot))
            if not accepted: conn.execute('UPDATE metadata SET halted=1')

    def halt(self):
        with self.connection() as (conn,_): conn.execute('UPDATE metadata SET halted=1')


class AcceptanceReport(StrictModel):
    status:str
    source_hashes:dict[str,str]
    slot_receipts:list[dict]
    actual_calls:int
    charged_calls:int
    reserved_calls:int
    remaining_slots:list[str]
    sampled_resources:list[dict]
    errors:list[str]


def validate_story(pack,selection,locale):
    from .render import render_chronicle
    selected={id for part in selection.paragraphs for id in part.fact_ids}
    substantive=[f for f in pack.facts if f.id in selected and f.kind in ('goal','actor_stat','team_compare')]
    if len(substantive)<2: raise AcceptanceRefused('Chronicle needs multiple recorded football observations')
    return render_chronicle(pack,selection,locale)


def load_sources(manifest_path):
    from ..simulation.replay import parse_replay, trace_hash
    from ..grf.codec import parse_grf
    from ..grf.statistics import build_grf_statistics
    from .facts import from_timepitch, from_grf
    manifest_path=safe_path(manifest_path)
    manifest=json.loads(manifest_path.read_bytes())
    if manifest['profile']!=PROFILE or manifest['grant']!='pc-worker-20261019-1' or set(manifest['sources'])!={'timepitch','grf'}:
        raise AcceptanceRefused('Unsupported acceptance manifest')
    if manifest.get('implementation')!=implementation_binding(): raise AcceptanceRefused('Acceptance implementation changed')
    packs={}
    for engine,entry in manifest['sources'].items():
        path=safe_path(manifest_path.parent/entry['file'])
        if not path.is_relative_to(manifest_path.parent) or path.stat().st_size>16*1024*1024: raise AcceptanceRefused('Invalid snapshot path')
        raw=path.read_bytes()
        if sha256(raw).hexdigest()!=entry['sha256']: raise AcceptanceRefused('Source snapshot changed')
        if engine=='timepitch':
            record=parse_replay(raw)
            if trace_hash(record)!=record.trace_hash: raise AcceptanceRefused('Canonical trace integrity mismatch')
            pack=from_timepitch(record)
        else:
            record=parse_grf(raw); pack=from_grf(record,build_grf_statistics(record))
        if pack.trace_hash!=entry['trace_hash'] or fact_pack_hash(pack)!=entry['fact_hash']: raise AcceptanceRefused('Source facts changed')
        packs[engine]=pack
    return manifest,packs


def sample_resources():
    """Samples, not exact peaks. GPU usage includes other applications."""
    import os,subprocess,ctypes
    python_rss=None
    if os.name=='nt':
        class Counters(ctypes.Structure):
            _fields_=[('cb',ctypes.c_ulong),('faults',ctypes.c_ulong)]+[(name,ctypes.c_size_t) for name in ('peak_ws','ws','peak_page','page','peak_nonpage','nonpage','pagefile','peak_pagefile')]
        kernel=ctypes.WinDLL('kernel32'); kernel.GetCurrentProcess.restype=ctypes.c_void_p
        api=ctypes.WinDLL('psapi'); api.GetProcessMemoryInfo.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
        counters=Counters(); counters.cb=ctypes.sizeof(counters)
        if api.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(counters),counters.cb): python_rss=counters.ws
    response=subprocess.run(['nvidia-smi','--query-gpu=memory.used','--format=csv,noheader,nounits'],capture_output=True,timeout=5)
    gpu=int(response.stdout.decode().strip().splitlines()[0]) if response.returncode==0 else None
    foundry_rss=None
    if os.name=='nt':
        from ..config import ROOT
        script="""
$prefix=$env:TIMEPITCH_SAMPLE_FOUNDRY+[IO.Path]::DirectorySeparatorChar
$sum=0L
Get-Process -Name foundry,Inference.Service.Agent,RestartAgent -ErrorAction SilentlyContinue | ForEach-Object { try { if($_.Path -and $_.Path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { $sum+=$_.WorkingSet64 } } catch {} }
[Console]::Write($sum)
"""
        env={key:value for key,value in os.environ.items() if key.lower()!='psmodulepath'}
        response=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],
            env={**env,'TIMEPITCH_SAMPLE_FOUNDRY':str(ROOT/'.local/foundry-runtime/0.8.119')},capture_output=True,timeout=5)
        if response.returncode==0: foundry_rss=int(response.stdout.decode().strip())
    return {'monotonic_s':time.monotonic(),'python_rss_bytes':python_rss,'foundry_rss_bytes':foundry_rss,'gpu_total_used_mib':gpu}


async def run_gpu_acceptance(manifest_path:Path,usage_path:Path,*,provider_factory=None,sampler:Callable=sample_resources,root=None,job_timeout_s=180):
    """Explicit single attempt. Caller prepares/owns the runtime; this never starts it."""
    from ..runtime import RuntimeLease
    from ..config import ROOT
    root=Path(root or ROOT)
    if not 0<job_timeout_s<=180: raise AcceptanceRefused('Acceptance timeout may not exceed 180 seconds')
    from .provider import FoundryChronicleProvider
    from .render import render_chronicle
    from .repository import ChronicleRepository
    from .service import ChronicleService
    from .http_client import BrokerClient,ORIGIN
    from .worker import run_worker
    from .auth import ChronicleSettings
    from ..api.chronicles import chronicles_router
    from ..security import install_security
    from fastapi import FastAPI
    import httpx
    manifest_path=safe_path(manifest_path); usage_path=safe_path(usage_path)
    manifest,packs=load_sources(manifest_path)
    budget=AcceptanceBudget(usage_path,sha256(manifest_path.read_bytes()).hexdigest(),grant_root=root/'.local/ai-worker-acceptance/pc-worker-20261019-1')
    directory=usage_path.parent
    report_path=safe_path(directory/'report.json')
    if report_path.exists(): raise AcceptanceRefused('Acceptance already has a report')
    provider_factory=provider_factory or FoundryChronicleProvider
    receipts=[]; samples=[]; errors=[]; current=None; cancelled=None
    owner=secrets.token_hex(16); worker_id='timepitch-acceptance-1'; credential=secrets.token_urlsafe(40)
    repo=ChronicleRepository(directory/'broker.sqlite')
    def source(_,request):
        entry=manifest['sources'][request.engine]; path=safe_path(manifest_path.parent/entry['file'])
        if sha256(path.read_bytes()).hexdigest()!=entry['sha256'] or request.trace_hash!=packs[request.engine].trace_hash:
            raise ValueError('Acceptance source changed')
        return FactPack.model_validate_json(packs[request.engine].model_dump_json())
    service=ChronicleService(repo,source)
    app=FastAPI(); app.state.chronicles=service
    settings=ChronicleSettings(mode='public',worker_id=worker_id,token_sha256=sha256(credential.encode()).hexdigest())
    app.state.chronicles_settings=settings
    app.include_router(chronicles_router()); install_security(app,runtime_dir=directory,worker_auth=settings,public_origin_override=ORIGIN)
    sampling_stop=asyncio.Event()
    quarantine=safe_path(root/'.local/inference-uncertain.json')
    async def sampling():
        while not sampling_stop.is_set():
            try:
                if len(samples)<512: samples.append(await asyncio.to_thread(sampler))
            except Exception as exc:
                samples.append({'error':type(exc).__name__}); errors.append('resource_sample_failed')
                return
            try: await asyncio.wait_for(sampling_stop.wait(),2)
            except TimeoutError: pass
    async def attach(provider,slot):
        if not await provider.readiness(): raise AcceptanceRefused('Approved prepared provider is not ready')
        if getattr(provider,'transport',None):
            async def received(response): budget.response(slot)
            provider.transport.client.client._client.event_hooks.setdefault('response',[]).append(received)
    async def close_failed_provider(provider,failure):
        nonlocal cancelled
        try: await drain_cleanup(provider.close(),failure=failure)
        except (Exception,asyncio.CancelledError) as error:
            if 'provider_close_failed' not in errors: errors.append('provider_close_failed')
            if isinstance(error,asyncio.CancelledError) and cancelled is None: cancelled=error
            budget.halt()
            return False
        return True
    async def perform(provider,slot,started):
        await attach(provider,slot)
        if quarantine.exists(): raise AcceptanceRefused('Uncertain inference already registered')
        marker=json.dumps({'grant':manifest['grant'],'slot':slot,'nonce':secrets.token_hex(16)}).encode()
        atomic_write(quarantine,marker)
        if slot=='preflight':
            def charge(count):
                for _ in range(count): budget.reserve_http(slot)
            receipt=await provider.generate(packs['timepitch'],'en',charge)
            render_chronicle(packs['timepitch'],receipt.selection,'en')
            result={'slot':slot,'state':'accepted','actual_calls':receipt.actual_calls,'evidence_reads':receipt.evidence_reads}
        else:
            engine,locale=slot.split('-'); pack=packs[engine]
            job=service.submit(owner,ChronicleRequest(engine=engine,match_id=engine+'-stored',trace_hash=pack.trace_hash,locale=locale))
            stop=asyncio.Event()
            client=BrokerClient(ORIGIN,worker_id,credential,transport=httpx.ASGITransport(app=app))
            complete=client.complete
            evidence_reads=[]
            async def done(value):
                validate_story(pack,value.selection,locale)
                await complete(value); evidence_reads.append(value.evidence_reads); stop.set()
            client.complete=done
            class Metered:
                async def readiness(self): return await provider.readiness()
                async def generate(self,pack,locale,reserve):
                    def charge(count):
                        for _ in range(count): budget.reserve_http(slot)
                        reserve(count)
                    return await provider.generate(pack,locale,charge)
                async def close(self): await provider.close()
            outbox=WorkerOutbox(directory/slot/'active.json',binding=sha256((worker_id+slot).encode()).hexdigest())
            await run_worker(client,Metered(),outbox,stop)
            view=service.get(owner,job.id)
            if view.state!='ready': raise AcceptanceRefused('Broker did not accept chronicle')
            result={'slot':slot,'state':view.state,'actual_calls':view.actual_calls,'calls_reserved':view.calls_reserved,
                'text':view.text,'event_refs':view.event_refs,'fact_hash':view.fact_hash,'evidence_reads':sum(evidence_reads)}
        result['wall_ms']=(time.perf_counter()-started)*1000
        return result,marker
    with ExitStack() as leases:
        leases.enter_context(RuntimeLease(directory/'acceptance.lock'))
        leases.enter_context(RuntimeLease(root/'.local/ai-worker/worker.lock'))
        leases.enter_context(RuntimeLease(root/'.local/inference.lock'))
        budget.require_fresh()
        if report_path.exists(): raise AcceptanceRefused('Acceptance already has a report')
        monitor=asyncio.create_task(sampling())
        try:
            for slot in SLOTS[:-1]:
                current=slot; provider=None; slot_failure=None; cleanup_ok=True; started=time.perf_counter()
                try:
                    budget.begin(slot)
                    provider=provider_factory()
                    async with asyncio.timeout(job_timeout_s):
                        result,marker=await perform(provider,slot,started)
                    await drain_cleanup(provider.close())
                    if quarantine.read_bytes()!=marker: raise AcceptanceRefused('Quarantine binding changed')
                    quarantine.unlink()  # Only a completed validated generation proves quiescence here.
                    budget.finish(slot,True)
                    receipts.append(result)
                except (Exception,asyncio.CancelledError) as exc:
                    slot_failure=exc
                    attach_failure(exc)
                    category=error_category(exc); errors.append(category)
                    if isinstance(exc,asyncio.CancelledError): cancelled=exc
                    if budget.snapshot()[slot]['state']=='running': budget.finish(slot,False)
                    engine='timepitch' if slot=='preflight' else slot.split('-')[0]
                    failed={'slot':slot,'state':'failed','error':category,
                        'diagnostic':safe_diagnostic(exc).model_dump(mode='json'),
                        'fact_hash':fact_pack_hash(packs[engine]),'manifest_hash':sha256(manifest_path.read_bytes()).hexdigest(),
                        'wall_ms':(time.perf_counter()-started)*1000}
                    if vars(exc).get('diagnostic_persistence_error')=='diagnostic_persistence_failed':
                        failed['diagnostic_persistence_error']='diagnostic_persistence_failed'
                    receipts.append(failed)
                    break
                finally:
                    if provider: cleanup_ok=await close_failed_provider(provider,slot_failure)
                if not cleanup_ok or cancelled is not None: break
        finally:
            sampling_stop.set(); await monitor
    rows=budget.snapshot()
    report=AcceptanceReport(status='passed' if len(receipts)==4 and not errors else 'failed',
        source_hashes={engine:entry['sha256'] for engine,entry in manifest['sources'].items()},slot_receipts=receipts,
        actual_calls=sum(row['responses'] for row in rows.values()),charged_calls=sum(row['charged'] for row in rows.values()),
        reserved_calls=sum(row['reserved'] for row in rows.values()),remaining_slots=[s for s in SLOTS if rows[s]['state'] in ('pending','locked')],
        sampled_resources=samples,errors=errors)
    try: atomic_write(report_path,report.model_dump_json(indent=2).encode())
    except Exception:
        report.status='failed'; report.errors.append('report_persistence_failed')
    if cancelled is not None: raise cancelled
    return report
