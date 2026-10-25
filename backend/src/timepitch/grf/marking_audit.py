"""Read-only K1 postmortem. Pure decision replay is never match execution.

No campaign, admission, worker or football dependency is imported here. Evidence
references name only the three accepted retained captures; historical sources
are checked against archived bytes, never rebound to a changed live tree.
"""
from collections import Counter
from dataclasses import dataclass
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import zlib

from .coordination_wire import (
    WINDOWS, iter_coordination_frames, native_input, state,
    validate_coordination_policy, validate_coordination_sidecar,
)
from .physical_wire import (
    canonical, digest, unpack_samples, MAX_COMPRESSED, MAX_EXPANDED,
    MAX_TOTAL_COMPRESSED, MAX_TOTAL_EXPANDED, MAX_SAMPLES,
)

STUDY = 'research/engine-evaluation/2026-10-18-grf-priority-continuity'
ARCHIVE = '.local/grf-priority-continuity-source-archive'
ARCHIVE_WITNESS = ARCHIVE + '-initialized.json'
BINDING = STUDY + '/k1-source-binding.json'
DESCRIPTOR = 'research/engine-evaluation/2026-10-18-grf-defensive-coordination/coordination.json'
CHECKPOINT = '.local/grf-physical-work/coordination/checkpoint.json'
RUNS = ('K-observe-42', 'k1/calibration/01', 'k1/calibration/02')
PREFIX = '.local/grf-physical-work/coordination/evidence/'
_KINDS = {'manifest.json': 'manifest', 'policy.json': 'policy',
          'coordination.jsonl': 'sidecar', 'defense-diagnostic.json': 'defense'}


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def _inside(root, relative):
    root = Path(root).resolve(); relative = Path(relative)
    result = (root / relative).resolve()
    if relative.is_absolute() or '..' in relative.parts or not result.is_relative_to(root):
        raise ValueError('Path outside historical evidence root')
    return result


def _json(path, maximum=8 * 1024 * 1024):
    with Path(path).open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError('Evidence metadata exceeds bound')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise ValueError('Duplicate evidence key')
            result[key] = value
        return result
    return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def _binding(project):
    path = _inside(project, BINDING); record = _json(path)
    if record.get('schema_version') != 'grf-marking-historical-source-1' or record.get('archive') != ARCHIVE:
        raise ValueError('Historical binding schema/root changed')
    archive = _inside(project, ARCHIVE)
    witness = dict(schema_version='grf-marking-archive-witness-1', binding_sha256=file_sha(path),
                   profile_identity=record['profile_identity'], source_count=len(record['measurement_sha256']),
                   archived_from_commit=record['archived_from_commit'])
    if any(_json(p) != witness for p in (archive / 'initialized.json', _inside(project, ARCHIVE_WITNESS))):
        raise ValueError('Historical binding witness changed')
    return record


def verify_historical_sources(project: Path, archive: Path, expected: dict[str, str]) -> dict:
    """Validate original membership and bytes; live drift is an explicit result."""
    project = Path(project).resolve()
    try:
        if Path(archive).resolve() != _inside(project, ARCHIVE):
            raise ValueError('Unregistered historical archive')
        record = _binding(project); sources = record['measurement_sha256']
        if not sources or sources != expected:
            raise ValueError('Historical membership was refreshed')
        for group, files in (('source', sources), ('parents', record['parent_files'])):
            for name, sha in files.items():
                if not re.fullmatch('[a-f0-9]{64}', sha) or file_sha(_inside(Path(archive) / group, name)) != sha:
                    raise ValueError('Archived bytes changed: ' + name)
            actual = {p.relative_to(Path(archive) / group).as_posix()
                      for p in (Path(archive) / group).rglob('*') if p.is_file()}
            if actual != set(files): raise ValueError('Archived membership changed: ' + group)
        for name, sha in {**record['parent_files'], **record['protected_artifacts']}.items():
            if name in sources: raise ValueError('Live source cannot replace archived source')
            if file_sha(_inside(project, name)) != sha:
                raise ValueError('Protected historical artifact changed: ' + name)
        live = {p.relative_to(project).as_posix(): file_sha(p)
                for p in (project / 'backend/src/timepitch').rglob('*.py')}
        for name in sources:
            if not name.startswith('backend/src/timepitch/') or not name.endswith('.py'):
                path = _inside(project, name)
                if path.is_file(): live[name] = file_sha(path)
        return dict(source_count=len(sources), parent_count=len(record['parent_files']),
                    protected_count=len(record['protected_artifacts']), binding_sha256=file_sha(project / BINDING),
                    profile_identity=record['profile_identity'], live_source_closure_matches=live == sources,
                    live_added=sorted(live.keys() - sources.keys()), live_missing=sorted(sources.keys() - live.keys()),
                    live_modified=sorted(k for k in live.keys() & sources.keys() if live[k] != sources[k]))
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError('Missing or invalid historical archive') from error


@dataclass(frozen=True)
class EvidenceRef:
    relative_path: str
    sha256: str
    kind: str
    run_id: str


def _validate_reference(ref):
    if not isinstance(ref, EvidenceRef) or ref.run_id not in RUNS:
        raise ValueError('Disallowed evidence reference run')
    prefix = PREFIX + ref.run_id + '/'
    if not ref.relative_path.startswith(prefix): raise ValueError('Disallowed evidence reference path')
    name = ref.relative_path[len(prefix):]
    kind = 'chunk' if re.fullmatch(r'(0|[1-9][0-9]?)\.zlib', name) else _KINDS.get(name)
    if kind is None or ref.kind != kind or re.fullmatch('[a-f0-9]{64}', ref.sha256) is None:
        raise ValueError('Disallowed evidence reference kind/hash')


def _checkpoint(project, record):
    path = _inside(project, CHECKPOINT)
    if file_sha(path) != record['protected_artifacts'].get(CHECKPOINT):
        raise ValueError('Terminal checkpoint changed')
    checkpoint = _json(path)
    if (checkpoint['terminal_failure'] != dict(id='k1/calibration/03', state='failed') or
            checkpoint['selection_sealed'] or checkpoint['heldout_opened'] or
            set(checkpoint['runs']) != set(RUNS) | {'k1/calibration/03'}):
        raise ValueError('Expected stopped calibration history')
    return checkpoint


def retained_references(project: Path) -> tuple[EvidenceRef, ...]:
    """Named ready-run files from the frozen terminal ledger, no directory scan."""
    project = Path(project).resolve(); record = _binding(project); checkpoint = _checkpoint(project, record)
    refs = []
    for run in RUNS:
        entry = checkpoint['runs'][run]
        if entry['state'] != 'ready': raise ValueError('Retained run is not complete')
        for name, sha in sorted(entry['evidence']['files'].items()):
            kind = 'chunk' if re.fullmatch(r'(0|[1-9][0-9]?)\.zlib', name) else _KINDS.get(name)
            if kind:
                ref = EvidenceRef(PREFIX + run + '/' + name, sha, kind, run)
                _validate_reference(ref); refs.append(ref)
    return tuple(refs)


def reference_greedy(snapshot: dict, *, exclude_overrides: bool) -> list[list[int]]:
    players = native_input(snapshot)
    own = [p for p in snapshot['players'] if p['team'] == snapshot['team']]
    quality = {p['id']: snapshot['quality'][i] for i, p in enumerate(own)}
    remaining = [p['id'] for p in own if p['active'] and not p['keeper'] and
                 (not exclude_overrides or not (p['manual'] or p['ball_contest']))]
    result = []
    for col, target in enumerate(snapshot['threat_ids']):
        if exclude_overrides and not players[target]['active']: continue
        if not remaining: break
        owner = max(remaining, key=lambda p: quality[p][col])
        result.append([owner, target]); remaining.remove(owner)
    return result


def _optimum(tx, reserved=-1):
    x = tx['input']; players = {p['id']: p for p in x['players']}
    own = [p for p in x['players'] if p['team'] == x['team']]
    quality = {p['id']: x['quality'][i] for i, p in enumerate(own)}
    eligible = sorted(p['id'] for p in own if p['active'] and not (p['keeper'] or p['manual'] or p['ball_contest']))
    targets = [t for t in x['threat_ids'] if players[t]['active']]
    prior = tx['prior_state']
    old = {m['target']: m for m in prior['marks'] if m['owner'] in eligible and m['target'] in targets}
    if (prior['period'], prior['dynamic_side']) != (x['period'], x['dynamic_side']): old = {}
    held = {t: m for t, m in old.items() if x['time_ms'] - m['committed_ms'] < 800}
    allowed = {}
    for a in eligible:
        for t in targets:
            ok = all(not ((ht == t and hm['owner'] != a) or (ht != t and hm['owner'] == a)) for ht, hm in held.items())
            if t in old and old[t]['owner'] != a:
                if (math.dist(players[old[t]['owner']]['position'], players[t]['position']) <= 2 and
                        math.dist(players[a]['position'], players[t]['position']) > 6): ok = False
            allowed[a, t] = ok
    best = None
    # Independent exhaustive enumeration of feasible partial injective assignments.
    for owners in itertools.product([a for a in eligible if a != reserved] + [None], repeat=len(targets)):
        chosen = [a for a in owners if a is not None]
        if len(chosen) != len(set(chosen)): continue
        if any((a is None and t in held) or (a is not None and not allowed[a, t]) for a, t in zip(owners, targets)): continue
        pairs = sorted([a, t] for a, t in zip(owners, targets) if a is not None)
        score = sum(quality[a][x['threat_ids'].index(t)] for a, t in pairs)
        score -= .1 * sum([m['owner'], t] not in pairs for t, m in old.items())
        if (best is None or len(pairs) > len(best['pairs']) or len(pairs) == len(best['pairs']) and
                (score > best['objective'] + 1e-12 or abs(score - best['objective']) <= 1e-12 and pairs < best['pairs'])):
            best = dict(pairs=pairs, objective=score)
    return best


def compare_assignment(tx: dict) -> dict:
    """One-step alternatives with the recorded prior, never propagated outcomes."""
    missing = []
    if not tx.get('input'): missing.append('native_input')
    elif 'quality' not in tx['input']: missing.append('native_quality')
    elif any(p.get('formation') is None for p in tx['input']['players']
             if p['team'] == tx['input']['team'] and p['active'] and not p['keeper']): missing.append('native_formation')
    if 'prior_state' not in tx: missing.append('native_prior')
    if missing:
        return dict(status='unavailable', missing=missing, recorded_pairs=None, unreserved=None, counterfactual_outcomes=False)
    x = tx['input']; players = native_input(x); state(tx['prior_state'])
    if tx['prior_state']['time_ms'] > x['time_ms']: raise ValueError('Prior is from the future')
    d = tx['decision']; recorded = sorted([[m['owner'], m['target']] for m in d['marks']])
    result = dict(status='available', eligible=x['play_eligible'] and x['defending'],
                  recorded_pairs=recorded, recorded_objective=d['objective'], counterfactual_outcomes=False)
    if not result['eligible']: return result
    best = _optimum(tx); cover = -1 if d['cover'] is None else d['cover']['id']
    constrained = _optimum(tx, cover)
    if (constrained is None or constrained['pairs'] != recorded or
            abs(constrained['objective'] - d['objective']) > 1e-10):
        raise ValueError('Recorded solution differs from independent exhaustive optimum')
    greedy = reference_greedy(x, exclude_overrides=False)
    eligible = reference_greedy(x, exclude_overrides=True)
    result.update(raw_greedy=greedy, eligible_greedy=eligible, unreserved=best,
                  cover=cover, reservation_loss=best['objective'] - d['objective'])
    targets = [t for t in x['threat_ids'] if players[t]['active']]
    comparisons = []
    for rank, target in enumerate(targets):
        item = dict(rank=rank, target=target)
        for label, pairs in [('recorded', recorded), ('raw_greedy', greedy), ('eligible_greedy', eligible), ('unreserved', best['pairs'])]:
            owner = next((a for a, t in pairs if t == target), None)
            item[label + '_owner'] = owner
            item[label + '_distance_m'] = None if owner is None else math.dist(players[owner]['position'], players[target]['position'])
        comparisons.append(item)
    result['per_rank'] = comparisons
    result['top_threat'] = comparisons[0] if comparisons else None
    return result


def _rows(project, refs, manifest):
    by_name = {Path(r.relative_path).name: r for r in refs if r.kind == 'chunk'}
    expected = manifest['chunks']; compressed_total = expanded_total = samples = 0
    if set(by_name) != {str(c['index']) + '.zlib' for c in expected}: raise ValueError('Missing/extra chunk reference')
    for index, chunk in enumerate(expected):
        if chunk['index'] != index: raise ValueError('Nonconsecutive chunk reference')
        ref = by_name[str(index) + '.zlib']; path = _inside(project, ref.relative_path)
        with path.open('rb') as f: raw = f.read(MAX_COMPRESSED + 1)
        if len(raw) != chunk['compressed_bytes'] or len(raw) > MAX_COMPRESSED or hashlib.sha256(raw).hexdigest() != ref.sha256:
            raise ValueError('Chunk identity/size changed')
        inflater = zlib.decompressobj(); expanded = inflater.decompress(raw, MAX_EXPANDED + 1)
        if (len(expanded) > MAX_EXPANDED or len(expanded) != chunk['expanded_bytes'] or not inflater.eof or
                inflater.unconsumed_tail or inflater.unused_data): raise ValueError('Chunk expanded bound/trailing data')
        compressed_total += len(raw); expanded_total += len(expanded)
        if compressed_total > MAX_TOTAL_COMPRESSED or expanded_total > MAX_TOTAL_EXPANDED: raise ValueError('Replay total bound')
        decoded = unpack_samples(json.loads(expanded))
        if digest(decoded) != chunk['sha256']: raise ValueError('Logical chunk digest changed')
        if len(decoded['samples']) != chunk['samples']: raise ValueError('Chunk sample count')
        for row in decoded['samples']:
            if (row[0] != samples or any(not math.isfinite(v) for v in row) or samples >= MAX_SAMPLES):
                raise ValueError('Sample ordering/finite/count')
            samples += 1; yield row


def _replay(frame, policy):
    # Reuse the frozen pure fixture wire/models without importing the worker harness.
    from .coordination_models import CoordinationInput, CoordinationState, CoordinationDecision, Player, Point, encode_request
    assignments = events = 0
    for tx in frame['transactions']:
        prior = CoordinationState.from_dict(tx['prior_state'])
        if tx['type'] == 'assignment':
            x = dict(tx['input']); x['ball_100ms'] = Point(*x['ball_100ms'])
            x['players'] = tuple(Player(**{**p, 'position': Point(*p['position']),
                'formation': Point(*p['formation']) if p['formation'] is not None else None}) for p in x['players'])
            x['quality'] = tuple(tuple(r) for r in x['quality']); x['threat_ids'] = tuple(x['threat_ids'])
            if policy.coordinate(CoordinationInput(**x), prior) != CoordinationDecision.from_dict(tx['decision']):
                raise ValueError('Recorded native assignment does not replay exactly')
            assignments += 1
        elif tx['type'] == 'override':
            header = CoordinationInput(tx['physics_ms'], tx['period'], tx['team'], tx['dynamic_side'], (), (), (), Point())
            result = policy._run(encode_request(header, prior, override=(tx['player'], tx['physics_ms'], tx['kind'])))
            if not result['valid'] or CoordinationState.from_dict(result['state']) != CoordinationState.from_dict(tx['state']):
                raise ValueError('Recorded override does not replay exactly')
            events += 1
        else:
            expected = CoordinationState(time_ms=tx['physics_ms'], period=tx['period'], team=tx['team'], dynamic_side=tx['dynamic_side'])
            if expected != CoordinationState.from_dict(tx['state']): raise ValueError('Recorded context reset differs')
            events += 1
    return assignments, events


def analyze_marking_evidence(project: Path, refs: tuple[EvidenceRef, ...]) -> dict:
    """Audit only pinned ready calibration/observer files. Never admits an engine."""
    if type(refs) is not tuple or not refs: raise ValueError('Explicit evidence references required')
    for ref in refs: _validate_reference(ref)  # Before opening even metadata.
    if len({r.relative_path for r in refs}) != len(refs): raise ValueError('Duplicate reference')
    project = Path(project).resolve(); record = _binding(project)
    descriptor = _json(_inside(project, DESCRIPTOR))
    proof = verify_historical_sources(project, project / ARCHIVE, descriptor['measurement_sha256'])
    if proof['live_modified'] or proof['live_missing']:
        raise ValueError('Live historical dependencies differ; archived verification is not live-code equivalence')
    if set(refs) != set(retained_references(project)): raise ValueError('Incomplete or unpinned reference set')
    checkpoint = _checkpoint(project, record); before = file_sha(project / CHECKPOINT)
    for ref in refs:
        if file_sha(_inside(project, ref.relative_path)) != ref.sha256: raise ValueError('Evidence reference hash changed')
    build_path = 'research/engine-evaluation/2026-10-18-grf-defensive-coordination/k1-replay-build.json'
    build = _json(_inside(project, build_path)); executable = _inside(project, build['executable'])
    if file_sha(executable) != build['executable_sha256'] or record['protected_artifacts'].get(build['executable']) != build['executable_sha256']:
        raise ValueError('Unpinned pure replay executable')
    from .coordination_shadow import CppPolicy
    policy = CppPolicy(executable)
    grant = _json(project / '.local/grf-physical-work/coordination/authorization.json')
    if digest(grant) != checkpoint['grant_sha256'] or grant['profile_identity'] != record['profile_identity']:
        raise ValueError('Historical authorization identity changed')
    usage = dict(used=grant['parent_used'] + len(checkpoint['runs']), maximum=grant['maximum'],
                 candidates=grant['parent_candidates'] + 1)
    if usage != dict(used=41, maximum=72, candidates=5) or grant['candidate_limit'] != 5:
        raise ValueError('Historical usage changed')
    result = dict(schema_version='grf-marking-audit-1', archive=proof, usage=usage,
                  runs={}, exact_replay=dict(assignments=0, state_events=0), counterfactual_outcomes=False)
    totals = Counter()
    for run in RUNS:
        run_refs = [r for r in refs if r.run_id == run]
        metadata = {r.kind: _json(_inside(project, r.relative_path)) for r in run_refs if r.kind not in ('chunk', 'sidecar')}
        manifest = metadata['manifest']; attestation = metadata['policy']; defense = metadata['defense']
        entry = checkpoint['runs'][run]; identity = dict(run_id=run, input_hash=entry['input_hash'],
            native_sha256=entry['native_sha256'], profile_identity=entry['profile_identity'],
            build_manifest_sha256=descriptor['build_manifest_sha256'])
        if (identity['profile_identity'] != record['profile_identity'] or manifest['input']['input_hash'] != identity['input_hash'] or
                manifest['native_binary_sha256'] != identity['native_sha256'] or defense['input_hash'] != identity['input_hash'] or
                defense['trace_hash'] != manifest['trace_hash']): raise ValueError('Mixed evidence identity')
        mode = 'observe' if run == RUNS[0] else 'apply'
        validate_coordination_policy(attestation, identity, mode, manifest['trace_hash'])
        sidecar = _inside(project, next(r.relative_path for r in run_refs if r.kind == 'sidecar'))
        transport = validate_coordination_sidecar(sidecar, identity, mode, manifest['trace_hash'], expected_rows=_rows(project, run_refs, manifest))
        counts = Counter(); comparisons = []
        for frame in iter_coordination_frames(sidecar):
            assignments, events = _replay(frame, policy)
            counts['assignments'] += assignments; counts['state_events'] += events
            for tx in frame['transactions']:
                if tx['type'] != 'assignment': continue
                comparison = compare_assignment(tx)
                if not comparison.get('eligible'): continue
                counts['eligible'] += 1
                comparison.update(sample=frame['sample'], window=frame['native']['window'], physics_ms=tx['physics_ms'], team=tx['team'])
                comparisons.append(comparison)
                top = comparison['top_threat']
                if mode == 'apply':
                    counts['applied_eligible'] += 1
                    counts['applied_cover'] += comparison['cover'] >= 0
                    counts['applied_reservation_losses'] += comparison['cover'] >= 0 and comparison['reservation_loss'] > 1e-10
                    counts['applied_raw_top_degradation'] += top['recorded_distance_m'] > top['raw_greedy_distance_m'] + 4
                    counts['applied_eligible_top_degradation'] += top['recorded_distance_m'] > top['eligible_greedy_distance_m'] + 4
                    counts['applied_unreserved_top_recovery'] += top['recorded_distance_m'] > top['unreserved_distance_m'] + 4
        counts['applied_shots_in_windows'] = sum(any(a <= shot['physics_ms'] <= b for a, b in WINDOWS) for shot in defense['shots']) if mode == 'apply' else 0
        totals.update(counts)
        result['runs'][run] = dict(counts=dict(counts), transport=transport, comparisons=comparisons)
        result['exact_replay']['assignments'] += counts['assignments']; result['exact_replay']['state_events'] += counts['state_events']
    if file_sha(project / CHECKPOINT) != before: raise ValueError('Terminal checkpoint changed during audit')
    result['totals'] = dict(totals)
    result['evidence_sha256'] = {r.relative_path: r.sha256 for r in refs}
    result['checkpoint_sha256'] = before
    return result
