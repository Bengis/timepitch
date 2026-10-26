"""FactPack from a live match stored on the server (TP253: crónica IA al final de cada partido simulado).

* GRF physical/activity/action matches (``physical-*``): goals, credited side, scorer and shots from the native
  telemetry events kept in the stored chunks, checked against the manifest score.
* TouchLines matches (``tl-*``): the stored recording and its ``recorded-events-1`` sidecar, through the same adapter
  as the served recordings.

Read-only; only what the engine recorded becomes a fact (see ``recorded_facts``).
"""
from collections import Counter

from .facts import _assemble
from .models import Coverage, FactPack
from .recorded_facts import _NOTES, from_recorded

SIDES = ('home', 'away')


def from_grf_physical(manifest, chunks) -> FactPack:
    inp = manifest.input
    by_slot = {(p.side, p.slot): p for p in inp.players}
    players = {p.id: p.name for p in inp.players}
    goals, scored, shots, last_ms = [], Counter(), Counter(), None
    for chunk in chunks:
        for e in chunk.events:
            last_ms = e.match_time_ms if last_ms is None else max(last_ms, e.match_time_ms)
            actor = by_slot.get((SIDES[e.actor_team], e.player)) if e.actor_team in (0, 1) and e.player >= 0 else None
            if e.type == 'goal':
                credited = SIDES[e.team]
                own = e.own_goal or (actor is not None and actor.side != credited)
                goals.append((f'grf:{e.seq}', credited, actor.id if actor else None, own, e.match_time_ms))
                if actor is not None and not own:
                    scored[actor.id] += 1
            elif e.type == 'touch' and e.kind == 'shot' and e.actor_team in (0, 1):
                shots[SIDES[e.actor_team]] += 1
    goals.sort(key=lambda g: (g[4], g[0]))
    score = list(manifest.score)
    if [sum(1 for g in goals if g[1] == s) for s in SIDES] != score:
        raise ValueError('Recorded goals do not match the final score')
    team = {s: {'shots': float(shots[s])} for s in SIDES}
    metrics = {pid: {'goals': float(n)} for pid, n in scored.items()}
    coverage = Coverage(events_complete=False, native_clock=True, notes=list(_NOTES))
    return _assemble('grf', manifest.trace_hash, inp.dataset_version, inp.home_name, inp.away_name,
                     score, last_ms, coverage, goals, players, metrics, team)


def live_source(grf, touchlines):
    """``(engine, match_id, owner) -> FactPack`` over the owner's stored matches; KeyError if not theirs or not ready."""
    def resolve(engine: str, match_id: str, owner: str, period: str = 'full_time') -> FactPack:
        if engine == 'touchlines':
            repo = touchlines.repository
            return from_recorded(repo.blob(match_id, owner, 'record'), repo.blob(match_id, owner, 'events'), 'touchlines', period)
        if engine == 'grf' and match_id.startswith('physical-'):
            if period != 'full_time':
                raise ValueError('No recorded half-time')
            manifest = grf.get_match(match_id, owner)
            return from_grf_physical(manifest, grf.physical_repository.iter_physical_chunks(match_id, owner))
        if engine == 'grf':
            # Partidos GRF comprimidos (el modo del servidor público): el adaptador del sistema de crónicas anterior.
            from ..grf.models import GrfFullMatchReplay, GrfReplay, GrfStatisticsReplay
            from .facts import from_grf
            record = grf.get_match(match_id, owner)
            if not isinstance(record, (GrfReplay, GrfFullMatchReplay, GrfStatisticsReplay)):
                raise KeyError(match_id)
            return from_grf(record, grf.get_statistics(match_id, owner), period)
        raise KeyError(match_id)
    return resolve
