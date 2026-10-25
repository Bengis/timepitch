"""FactPack from a served GRF physical/activity recording plus its `recorded-events-1` sidecar.

Read-only and hash-bound. Only facts the engine recorded are derived: the result, goals with
their credited side and scorer, and the goals leader. Passes in the sidecar have no outcome,
and recoveries and possession are not exported, so those facts are left out rather than
estimated; the coverage says so.
"""
from collections import Counter
from hashlib import sha256
import gzip
import json

from .facts import _assemble
from .models import Coverage, FactPack

RECORDED_FACTS_VERSION = 'grf-recorded-facts-1'
_NOTES = ['Physical GRF recording: goals and scorers come from engine telemetry.',
          'Pass outcomes, recoveries and possession were not exported and are left out.',
          'Fictional cross-era simulation: this match never took place.']


def from_grf_recorded(recording_gz: bytes, sidecar_gz: bytes) -> FactPack:
    recording_sha = sha256(recording_gz).hexdigest()
    record = json.loads(gzip.decompress(recording_gz))
    events = json.loads(gzip.decompress(sidecar_gz))
    if events.get('schema') != 'recorded-events-1' or events.get('engine') != 'grf':
        raise ValueError('Unsupported events sidecar')
    ref = events.get('recording') or {}
    if ref.get('sha256') != recording_sha or ref.get('trace_hash') != record.get('trace_hash'):
        raise ValueError('Sidecar is bound to another recording')
    if events.get('engine_version') != record.get('engine_version'):
        raise ValueError('Sidecar engine version differs')
    inp = record['input']
    players = {p['id']: p['name'] for p in inp['players']}
    sides = {p['id']: p['side'] for p in inp['players']}
    final = record['samples'][-1]
    score = list(final['score'])
    goals, scored = [], Counter()
    for e in sorted((e for e in events['events'] if e['kind'] in ('goal', 'own_goal')), key=lambda e: (e['match_ms'], e['t_ms'])):
        credited = (e.get('extra') or {}).get('credited_side', e['side'])
        if credited not in ('home', 'away'):
            raise ValueError('Goal without credited side')
        actor = e.get('player_id')
        own = e['kind'] == 'own_goal' or (actor in sides and sides[actor] != credited)
        goals.append((f"grf:{e['sample_index']}", credited, actor if actor in players else None, own, e['match_ms']))
        if actor in players and not own:
            scored[actor] += 1
    if [sum(1 for g in goals if g[1] == s) for s in ('home', 'away')] != score:
        raise ValueError('Recorded goals do not match the final score')
    if score != list(record.get('grf_physical', {}).get('score', score)):
        raise ValueError('Final score differs from the physical manifest')
    # Shot touches are recorded per side; equal counts are dropped by _assemble.
    shots = Counter(e['side'] for e in events['events'] if e['kind'] == 'shot' and e['side'] in ('home', 'away'))
    team = {s: {'shots': float(shots[s])} for s in ('home', 'away')}
    metrics = {pid: {'goals': float(n)} for pid, n in scored.items()}
    coverage = Coverage(events_complete=False, native_clock=True, notes=list(_NOTES))
    return _assemble('grf', record['trace_hash'], inp['dataset_version'], inp['home_name'], inp['away_name'],
                     score, final['match_time_ms'], coverage, goals, players, metrics, team)
