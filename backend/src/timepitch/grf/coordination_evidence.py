"""Read-only coordination evidence; no policy, native admission or simulation."""
from dataclasses import asdict, dataclass, field
import hashlib
import json
import math
from pathlib import Path
from typing import Callable, Iterable

from .defensive_probe_wire import iter_defense_frames

STUDY = 'research/engine-evaluation/2026-10-18-grf-defensive-coordination'
ARCHIVE = '.local/grf-coordination-source-archive'
ARCHIVE_WITNESS = '.local/grf-coordination-source-archive-initialized.json'
CONTINUATION = '.local/grf-physical-work/continuation'
PREVIOUS = 'research/engine-evaluation/2026-10-17-grf-physical-validation'


def _path(root, relative):
    relative = Path(relative)
    result = (root / relative).resolve()
    if relative.is_absolute() or '..' in relative.parts or not result.is_relative_to(root.resolve()):
        raise ValueError('Evidence path outside its root')
    return result


def _sha(path):
    hashed = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hashed.update(block)
    return hashed.hexdigest()


def _read(path):
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('Evidence metadata exceeds bound')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def verify_source_archive(project: Path) -> dict:
    """Verify historical bytes, never rewrite a binding to fit the live tree."""
    project = Path(project).resolve()
    try:
        path = project / STUDY / 'legacy-source-binding.json'
        record = _read(path)
        if (record['schema_version'] != 'grf-coordination-legacy-source-1' or
                record['archive'] != ARCHIVE or record['source_count'] != 109 or
                len(record['measurement_sha256']) != 109):
            raise ValueError('Historical source closure changed')
        archive = _path(project, ARCHIVE)
        expected = dict(schema_version='grf-coordination-archive-witness-1',
            binding_sha256=_sha(path), profile_identity=record['profile_identity'], source_count=109,
            archived_from_commit=record['archived_from_commit'])
        if any(_read(p) != expected for p in (archive / 'initialized.json', project / ARCHIVE_WITNESS)):
            raise ValueError('Historical archive witness changed')
        sources = record['measurement_sha256']
        for group, files in (('source', sources), ('parents', record['parent_files'])):
            for name, digest in files.items():
                if _sha(_path(archive / group, name)) != digest:
                    raise ValueError('Archived bytes changed: ' + name)
        actual = {p.relative_to(archive / 'source').as_posix()
                  for p in (archive / 'source').rglob('*') if p.is_file()}
        if actual != set(sources):
            raise ValueError('Archived source membership changed')
        for name, digest in record['parent_files'].items():
            if _sha(_path(project, name)) != digest:
                raise ValueError('Historical parent changed: ' + name)
        for name, digest in record['evidence_sha256'].items():
            # A future shared-source edit is not permission to rewrite its historical bytes.
            base = archive / 'source' if name in sources else project
            if _sha(_path(base, name)) != digest:
                raise ValueError('Retained evidence changed: ' + name)
        live = {p.relative_to(project).as_posix(): _sha(p)
                for p in (project / 'backend/src/timepitch').rglob('*.py')}
        assets = 'backend/src/timepitch/grf/assets.json'
        if (project / assets).exists():
            live[assets] = _sha(project / assets)
        return dict(historical_source_files=len(sources), parent_files=len(record['parent_files']),
            protected_artifacts=len(record['evidence_sha256']), binding_sha256=_sha(path),
            archived_from_commit=record['archived_from_commit'], profile_identity=record['profile_identity'],
            live_source_closure_matches=live == sources,
            live_added=sorted(set(live) - set(sources)), live_missing=sorted(set(sources) - set(live)),
            live_modified=sorted(k for k in set(sources) & set(live) if sources[k] != live[k]))
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError('Missing or invalid immutable source archive') from error


@dataclass(frozen=True)
class FixtureEvidence:
    id: str
    actions: dict
    defense: dict
    summary: dict
    manifest: dict
    chunks: Callable[[], Iterable] | None = None


@dataclass(frozen=True)
class EvidenceInputs:
    fixtures: tuple[FixtureEvidence, ...]
    probe_frames: tuple[dict, ...] = ()
    provenance: dict = field(default_factory=dict)


@dataclass(frozen=True)
class EvidenceReport:
    schema_version: str
    provenance: dict
    fixtures: list[dict]
    c4_totals: dict
    probe: dict
    limitations: list[str]

    def as_dict(self):
        return asdict(self)


def load_evidence_inputs(project: Path) -> EvidenceInputs:
    """Canonical retained inputs; verification reads neither heldout outcomes nor GRF."""
    from .action_validation import RetainedResult
    project = Path(project).resolve()
    proof = verify_source_archive(project)
    record = _read(project / STUDY / 'legacy-source-binding.json')
    reference = project / STUDY / 'analysis.json'
    if _sha(reference) != record['reference_analysis_sha256']:
        raise ValueError('Original reference analysis changed')
    fixtures = []
    for label, folder in [('T-actions', project / CONTINUATION / 'evidence/T-actions/match')] + [
            (f'c4/{i:02}', project / CONTINUATION / f'evidence/c4/calibration/{i:02}') for i in range(1, 9)]:
        old = label == 'T-actions'
        action = project / PREVIOUS / 'action-diagnostic.json' if old else folder / 'actions-diagnostic.json'
        defense = project / PREVIOUS / 'defensive-diagnostic.json' if old else folder / 'defense-diagnostic.json'
        fixtures.append(FixtureEvidence(label, _read(action), _read(defense), _read(folder / 'summary.json'),
            _read(folder / 'manifest.json'), lambda folder=folder: RetainedResult(folder).chunks()))
    sidecar = project / '.local/grf-physical-work/defensive-probe/evidence/D-defense-42/defense.jsonl'
    return EvidenceInputs(tuple(fixtures), tuple(iter_defense_frames(sidecar)),
        dict(source='hash-verified-retained-evidence', archive=proof,
             reference_analysis_sha256=record['reference_analysis_sha256'],
             analysis_module_sha256=_sha(Path(__file__)),
             native_assignment_transactions_available=False, native_attempts_created=0))


def _aggregate(shots):
    wide = [s for s in shots if s['contact_nearest_outfield_m'] >= 4]
    last = [s['snapshots'][-1] for s in shots if s.get('snapshots')]
    two = [s for s in wide if any(-2100 <= v['offset_ms'] <= -2000 for v in s.get('snapshots', []))]
    return dict(n=len(shots), rival_at_least_4m=len(wide), last_frame_available=len(last),
        no_goal_side_outfield=sum(v['goal_side_outfield'] == 0 for v in last) if last else None,
        no_goal_side_static_DEF=sum(v['goal_side_DEF'] == 0 for v in last) if last else None,
        two_second_snapshot_available=len(two),
        already_wide_2s_before=sum(any(-2100 <= v['offset_ms'] <= -2000 and
            v['nearest_outfield_distance_m'] >= 4 for v in s['snapshots']) for s in two),
        close_coverage_lost_within_2s=sum(s.get('minimum_nearest_outfield_last_2s_m') is not None and
            s['minimum_nearest_outfield_last_2s_m'] < 2 for s in wide),
        receipt_within_700ms=sum(s.get('last_confirmed_receipt') is not None and
            s['last_confirmed_receipt']['receipt_to_shot_ms'] <= 700 for s in shots),
        first_touch=sum(s.get('last_confirmed_receipt') is not None and
            s['last_confirmed_receipt']['receipt_to_shot_ms'] == 0 for s in shots))


def summarize_shots(shots):
    opened = [s for s in shots if s['phase_class'] == 'open_play']
    return dict(context_shots=len(shots), penalty_shots=sum(s['phase_class'] == 'penalty' for s in shots),
        open_play_shots=_aggregate(opened), open_play_goals=_aggregate([s for s in opened if s['goal']]))


def summarize_probe(frames):
    observed = []; transitions = []; role_changes = []; ages = []
    seen = {}; history = {}; previous = None; boundary = 0; count = records = 0
    for frame in frames:
        count += 1; t = frame['physics_ms']; context = frame.get('context')
        continuous = (context is not None and previous is not None and previous.get('context') is not None and
            t - previous['physics_ms'] == 100 and frame['sample_index'] == previous['sample_index'] + 1 and
            context['period'] == previous['context']['period'] and
            context['relocation_id'] == previous['context']['relocation_id'] and not context['discontinuity'])
        if not continuous:
            history.clear(); boundary = t
        for actor in frame['records']:
            records += 1; key = (actor['team'], actor['slot'])
            if not actor['active'] or not actor['evaluation_available']:
                history.pop(key, None); continue
            evaluated = actor['evaluation_ms']; ages.append(t - evaluated)
            if evaluated > t:
                raise ValueError('Cached evaluation comes from the future')
            values = actor['fields']['values']; team = values.get('marker_target_team'); slot = values.get('marker_target_slot')
            known = team is not None and slot is not None
            seq = (*key, actor['evaluation_sequence'], evaluated)
            target = (team, slot) if known else None
            role = values.get('dynamic_role')
            fingerprint = (target, role)
            if seq in seen:
                if seen[seq] != fingerprint:
                    raise ValueError('Cached evaluation changed without new identity')
                continue
            seen[seq] = fingerprint
            row = dict(team=key[0], slot=key[1], sample_ms=t, evaluation_ms=evaluated,
                evaluation_sequence=actor['evaluation_sequence'], age_ms=t-evaluated,
                target_team=team if known else None, target_slot=slot if known else None,
                dynamic_role=role, availability='observed_cached' if known else 'unavailable',
                continuity='observed_segment' if context is not None and evaluated >= boundary else 'unavailable')
            observed.append(row)
            old = history.get(key)
            if known and context is not None and evaluated >= boundary:
                if old is not None and t - old['sample_ms'] <= 200:
                    if (old['target_team'], old['target_slot']) != target:
                        transitions.append(dict(kind='observed_cached_target_change', before=old, after=row))
                    if old['dynamic_role'] is not None and role is not None and old['dynamic_role'] != role:
                        role_changes.append(dict(kind='observed_cached_role_change', before=old, after=row))
                history[key] = row
            else:
                history.pop(key, None)
        previous = frame
    return dict(frames=count, records=records, distinct_evaluations=len(seen), observed_targets=observed,
        cached_target_transitions=transitions, cached_role_transitions=role_changes,
        cache_age_ms=dict(n=len(ages), minimum=min(ages), maximum=max(ages)) if ages else dict(n=0),
        native_assignment_transactions=None, quality_matrix=None, formation_targets=None,
        limitation='Asynchronous cached evaluations are not atomic assignments or deliberate handovers')


def _distribution(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return dict(n=0, mean=None, p95=None)
    return dict(n=len(values), mean=sum(values)/len(values), p95=values[math.ceil(.95*len(values))-1])


def _fixture(fixture, probe_indices):
    m = fixture.manifest; parts = (m, fixture.actions, fixture.defense, fixture.summary)
    if not m.get('trace_hash') or len({v.get('trace_hash') for v in parts}) != 1:
        raise ValueError('Fixture diagnostic identity mismatch')
    expected = m.get('input', {}).get('input_hash')
    if any(v.get('input_hash') != expected for v in parts[1:]):
        raise ValueError('Fixture input identity mismatch')
    result = dict(id=fixture.id, score=fixture.summary.get('score'), **summarize_shots(fixture.defense['shots']))
    result['player_coverage'] = _distribution(p['coverage'] for p in fixture.summary.get('players', []))
    result['missing_half_exposure'] = [dict(player_id=p['id'], period=h['period'], active_ms=h['active_ms'])
        for p in fixture.summary.get('players', []) for h in p.get('periods', []) if h['distance_m'] is None]
    targets = {}
    for shot in fixture.actions['shots']:
        if shot['origin'] == 'open_play_shot' and shot['context']['available']:
            targets.setdefault(shot['context']['frame_sample_index'], []).append(shot)
    contexts = {}; geometry = []
    if fixture.chunks is not None:
        players = {(0 if p['side']=='home' else 1, p['slot']): p for p in m['input']['players']}
        for chunk in fixture.chunks():
            for row in chunk.samples:
                index = int(row[0])
                if index in probe_indices:
                    contexts[index] = dict(physics_ms=int(row[1]), period=int(row[2]),
                        discontinuity=bool(row[7]), relocation_id=int(row[19]))
                for shot in targets.get(index, []):
                    if row[7] or row[2] != shot['period']:
                        raise ValueError('Geometry at discontinuity or wrong half')
                    attacker = shot['actor_team']; defender = 1-attacker
                    def states(team):
                        active = []
                        for slot in range(11):
                            offset = 21+(team*11+slot)*6
                            if row[offset+4] and players[(team,slot)]['role'] != 'GK':
                                active.append((slot, row[offset], row[offset+1]))
                        return active
                    defenders = states(defender); attackers = states(attacker)
                    if not defenders:
                        continue
                    direction = shot['context']['attack_direction']; goal = (55*direction, 0)
                    threats = [a for a in attackers if math.dist(a[1:], goal) <= 30]
                    nearest = [min(defenders, key=lambda d: math.dist(a[1:], d[1:]))[0] for a in threats]
                    shooter_x = row[21+(attacker*11+shot['slot'])*6]
                    geometry.append(dict(period=int(row[2]), defending_side='home' if defender==0 else 'away',
                        frame_sample_index=index, raw_event_seq=shot['raw_event_seq'],
                        length_m=max(d[1] for d in defenders)-min(d[1] for d in defenders),
                        width_m=max(d[2] for d in defenders)-min(d[2] for d in defenders),
                        threats_within_30m=len(threats), uncovered_threats_at_4m=sum(
                            min(math.dist(a[1:], d[1:]) for d in defenders)>=4 for a in threats),
                        nearest_defender_duplicate_excess=len(nearest)-len(set(nearest)),
                        central_goal_side_outfield=sum(direction*(d[1]-shooter_x)>=0 and abs(d[2])<=9 for d in defenders)))
        if len(geometry) != sum(len(s) for s in targets.values()):
            raise ValueError('Missing eligible geometric shot frame')
    result['geometry'] = dict(availability='observed_frames' if fixture.chunks else 'unavailable',
        eligible_shots=sum(len(s) for s in targets.values()), shots=len(geometry),
        length_m=_distribution(r['length_m'] for r in geometry), width_m=_distribution(r['width_m'] for r in geometry),
        no_central_goal_side=sum(r['central_goal_side_outfield']==0 for r in geometry) if fixture.chunks else None,
        nearest_overload=sum(r['nearest_defender_duplicate_excess']>0 for r in geometry) if fixture.chunks else None,
        rows=geometry, assignment_matrix=None, native_ownership=None, formation_targets=None)
    for group in ('period', 'defending_side'):
        result['geometry'][group] = {str(key):dict(shots=sum(r[group]==key for r in geometry))
            for key in sorted({r[group] for r in geometry})}
    return result, contexts


def analyze_coordination(inputs: EvidenceInputs) -> EvidenceReport:
    results = []; contexts = {}; indices = {f['sample_index'] for f in inputs.probe_frames}
    for fixture in inputs.fixtures:
        result, context = _fixture(fixture, indices if fixture.id=='T-actions' else set())
        results.append(result); contexts.update(context)
    frames = []
    for original in inputs.probe_frames:
        frame = dict(original); context = contexts.get(frame['sample_index'])
        if context:
            if context['physics_ms'] != frame['physics_ms']:
                raise ValueError('Probe frame/control time mismatch')
            frame['context'] = context
        frames.append(frame)
    candidates = [r for r in results if r['id'].startswith('c4/')]
    totals = {group:{key:sum(r[group][key] for r in candidates) if all(r[group][key] is not None for r in candidates) else None
        for key in (candidates[0][group] if candidates else ())} for group in ('open_play_shots','open_play_goals')}
    return EvidenceReport('grf-coordination-evidence-1', dict(inputs.provenance), results, totals, summarize_probe(frames),
        ['Geometry and cached targets are distinct from native assignment transactions',
         'Static roles are not dynamic defensive responsibilities',
         'Shot-frame geometry is not time-weighted whole-match structure',
         'Missing native Q, formation and ownership stay unavailable; no counterfactual goals or distances'])


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = analyze_coordination(load_evidence_inputs(args.project))
    # Do not overwrite a retained analysis or witness; this is a new report.
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report.as_dict(), stream, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        stream.write('\n')


if __name__ == '__main__':
    main()
