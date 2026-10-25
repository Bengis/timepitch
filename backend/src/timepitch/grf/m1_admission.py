"""The sole parent derivation. A producer reference/row never proves readiness."""
import hashlib
from pathlib import Path
from . import m1_verifier as wire
from .m1_resource_models import CapturedEvidence,DerivedMeasurement
from .m1_resources import M1Budget,ResourceSnapshot
from .m1_evidence import validate_evidence
from .m1_measurement import measure_m1_result
from .m1_campaign import RetainedM1Result,_observation


def retained_hashes(project,path,manifest,budget):
    """Closed canonical input inventory, with content checks rather than mtimes."""
    prefix=wire.RUN_ROOT+'/evidence/'+manifest.worker_identity['run_id']
    if path!=wire.artifact(project,prefix):raise ValueError('Canonical retained path required')
    names={'launch.json':8192,'worker-claimed.json':8192,'manifest.json':1024*1024,
        'policy.json':1024*1024,'contexts.zlib':8*1024*1024}
    if not 1<=len(manifest.chunks)<=76:raise ValueError('Bounded retained chunks required')
    names.update({f'{ref.index}.zlib':1024*1024 for ref in manifest.chunks})
    # Derived outputs are sealed separately; never digest a receipt into itself.
    outputs={'measurement.json','resource-receipt.json','resource-receipt-unadmitted.json','resource-failure.json'}
    if {p.name for p in path.iterdir()}-outputs!=set(names):raise ValueError('Retained inventory changed/missing context')
    result={}
    for name,limit in sorted(names.items()):
        budget.checkpoint('finalize' if budget.latest.stage=='finalize' else 'admission')
        relative=prefix+'/'+name;p=wire.artifact(project,relative)
        if not p.is_file() or p.stat().st_size>limit:raise ValueError('Retained file bound')
        h=hashlib.sha256();total=0
        with p.open('rb') as stream:
            for block in iter(lambda:stream.read(1024*1024),b''):
                total+=len(block)
                if total>limit:raise ValueError('Retained file grew beyond bound')
                h.update(block);budget.checkpoint(budget.latest.stage)
        result[relative]=h.hexdigest()
    return result


def capture_launch(profile,run_id,capture,budget):
    if type(capture) is not CapturedEvidence or type(budget) is not M1Budget:
        raise ValueError('Private capture and actual budget required; no producer rows')
    budget.checkpoint('admission')
    if (capture.run_id!=run_id or capture.budget_id!=id(budget) or type(capture.resources) is not ResourceSnapshot or
        capture.resources.child_peak_private_bytes is None or capture.resources.sensor_status!='ok' or
        capture.resources.child_peak_private_bytes!=budget.latest.child_peak_private_bytes):
        raise ValueError('Unmeasured, diagnostic or foreign capture resources')
    payload=profile.payload(wire.payload_key(run_id))
    launch=wire._authorized(profile.project,profile.project/wire.RUN_ROOT,run_id,payload)
    if (profile.identity!=launch.profile_identity or profile.native_sha256!=launch.native_sha256 or
        capture.path!=launch.evidence or dict(capture.identity)!=launch.identity):raise ValueError('Capture path/identity changed')
    wire.recheck_launch(launch,payload)
    if wire.read(launch.evidence/'launch.json')!=wire.read(launch.evidence/'worker-claimed.json'):
        raise ValueError('Parent launch and exclusive child claim differ')
    if wire.sha(launch.evidence/'manifest.json')!=capture.manifest_sha256:raise ValueError('Capture manifest changed')
    budget.checkpoint('admission')
    return launch


def derive_measurement(profile,run_id,capture,budget)->DerivedMeasurement:
    launch=capture_launch(profile,run_id,capture,budget)
    result=RetainedM1Result(launch.evidence,budget)
    m=result.manifest
    if (m.worker_identity!=launch.identity or m.trace_hash!=capture.trace_hash or
        m.input.model_dump(mode='json')!=profile.payload(wire.payload_key(run_id)) or
        type(capture.last_durable_block) is not int or capture.last_durable_block!=len(m.chunks)-1 or
        type(capture.last_durable_ms) is not int or capture.last_durable_ms!=m.duration_ms):raise ValueError('Capture manifest/watermark identity')
    before=retained_hashes(profile.project,launch.evidence,m,budget)
    evidence=validate_evidence(result,launch)
    if (evidence.context.get('complete') is not True or evidence.context.get('observation')!='available' or
        type(evidence.context.get('transactions')) is not int or evidence.context['transactions']<=0):
        raise ValueError('Positive independently verified context transactions required')
    snapshot=budget.checkpoint('admission')
    row=measure_m1_result(result,evidence,dict(seconds=snapshot.elapsed_seconds,peak_private_bytes=snapshot.peak_private_bytes))
    budget.checkpoint('admission')
    if run_id=='M-observe-42':
        proof=_observation(profile,result,evidence,budget)
        row.update(equivalent=True,exact_transactions=proof['exact_transactions'],observation_proof=proof)
    budget.checkpoint('admission')
    if retained_hashes(profile.project,launch.evidence,m,budget)!=before:raise ValueError('Retained bytes changed during derivation')
    return DerivedMeasurement(row,before,launch.identity,m.trace_hash,capture.last_durable_block,capture.last_durable_ms)
