"""M1 measurement uses shared action/effort math and unchanged absolute gates."""
import math
from .action_statistics import _reduce_action_statistics
from .m1_codec import M1StreamValidator


def measure_m1_result(result,evidence,resources):
    from types import SimpleNamespace
    m=result.manifest;seconds=resources['seconds'];memory=resources['peak_private_bytes']
    if (evidence.identity!=m.worker_identity or evidence.trace_hash!=m.trace_hash or
        evidence.context['complete'] is not True or evidence.context['observation']!='available' or
        type(seconds) not in (int,float) or not math.isfinite(seconds) or not 0<=seconds<=600 or
        type(memory) is not int or not 0<memory<=512*1024*1024):raise ValueError('M1 measurement evidence/resources')
    profile=SimpleNamespace(identity=evidence.identity['profile_identity'],native_sha256=m.native_binary_sha256)
    summary=_reduce_action_statistics(m,result.chunks(),M1StreamValidator(m.input,profile))
    run=evidence.identity['run_id'];mode=evidence.identity['mode'];p=evidence.policy['counters']
    return dict(status='ready',complete=True,split='observe' if mode=='observe' else run.split('/')[1],
        fixture_id='01' if mode=='observe' else run.split('/')[2],candidate_id='m1',profile_identity=profile.identity,
        input_hash=m.input.input_hash,native_binary_sha256=m.native_binary_sha256,trace_hash=m.trace_hash,
        duration_ms=m.duration_ms,score=list(m.score),goals=sum(m.score),effective_minutes=summary.effective_ms/60000,
        shots=sum(t.shots for t in summary.team_actions),passes=sum(t.passes for t in summary.team_actions),
        releases=summary.classification.releases,release_ratio=summary.classification.release_ratio,
        player_coverage=[p.coverage for p in summary.players],
        outfield_km=[p.distance_m/1000 if p.distance_m is not None else None for p in summary.players if p.role!='GK'],
        players=[p.model_dump(mode='json') for p in summary.players],seconds=seconds,peak_private_bytes=memory,
        policy_valid=True,policy_counters=evidence.policy['base_counters'],marking_valid=True,illegal_ownership=0,
        guard_events=p['guards'],marking_counters=p,context=evidence.context,evidence_sha256=evidence.evidence_sha256,
        _analysis={'summary.json':summary.model_dump(mode='json')})
