"""Offline M1 closure. Reading/freezing metadata never admits a native engine."""
from dataclasses import dataclass
import hashlib
from pathlib import Path
from types import MappingProxyType

from .physical_wire import canonical, digest
from .shot_context_wire import _json

PROJECT_ROOT = Path(__file__).resolve().parents[4]
STUDY = 'research/engine-evaluation/2026-10-18-grf-priority-continuity'
DESCRIPTOR = STUDY+'/continuity.json'
RUN_ROOT = '.local/grf-physical-work/priority-continuity'
PROFILE_WITNESS = '.local/grf-priority-continuity-profile-initialized.json'
PHASE3_ARCHIVE = '.local/grf-priority-continuity-phase3-source-archive'
PHASE3_RECEIPT_SHA = '222265ddfa6ef8a3d01eae81aeca011f3ee9f955acbdb63d3323b88df2d601f1'
NATIVE_SHA = 'de424cb245f11c7c66ed4e7112363ed12308399dcb426a808587a62e9c2f447e'
POLICY = dict(version='m1-marking-continuity-1', parent='c4-marking-1', close_m=2., distant_m=6.,
              assignment_ms=400, team_offset_ms=200, marking_floor=.85, threat_radius_m=30., own_area_duel_floor=.70)
OBSERVATION = dict(version='m1-shot-context-1', shots=6, grid_ms=100, pre_ms=2000, post_ms=1000,
    anchor='100*ceil(physics_ms/100)', trigger='confirmed-open-play-release', selection='first-raw-sequences',
    interpolate_resets=False, frames=303, transactions=400, record_bytes=65536,
    compressed_bytes=8*1024*1024, expanded_bytes=32*1024*1024, attestation_bytes=8192)
MATCH_CAPS = dict(child_seconds=600, private_bytes=512*1024*1024, samples=75001, events=100000,
    chunk_samples=1000, chunk_compressed=1024*1024, chunk_expanded=4*1024*1024,
    replay_compressed=32*1024*1024, replay_expanded=256*1024*1024,
    stdout=48*1024*1024, manifest=1024*1024, physics_ms=7440000, half_ms=3720000)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''): h.update(block)
    return h.hexdigest()


def read(path):
    try:
        with Path(path).open('rb') as f: data = f.read(8*1024*1024+1)
        if len(data) > 8*1024*1024: raise ValueError('Continuity metadata bound')
        return _json(data)
    except OSError as e: raise ValueError('Missing continuity metadata: '+str(path)) from e


def artifact(project, name):
    if type(name) is not str or Path(name).is_absolute() or '..' in Path(name).parts:
        raise ValueError('Continuity artifact outside project')
    path = (Path(project)/name).resolve()
    if not path.is_relative_to(Path(project).resolve()): raise ValueError('Continuity artifact escaped project')
    return path


def plain(value):
    if isinstance(value, (dict, MappingProxyType)): return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [plain(v) for v in value]
    return value


def freeze(value):
    if isinstance(value, dict): return MappingProxyType({k: freeze(v) for k, v in value.items()})
    if isinstance(value, list): return tuple(freeze(v) for v in value)
    return value


def measurement_sources(project):
    root = Path(project)
    paths = list((root/'backend/src/timepitch').rglob('*.py'))
    for name in ['backend/src/timepitch/grf/assets.json', STUDY+'/build_continuity.py', STUDY+'/m1-policy.patch']:
        if (root/name).is_file(): paths.append(root/name)
    paths += list((root/STUDY/'native').glob('*.hpp'))
    paths += list((root/'backend/tests').glob('test_grf_continuity_*.py'))
    for name in ['marking_continuity_fixture.cpp', 'marking_native_hook_fixture.cpp']:
        p = root/'backend/tests/fixtures/grf'/name
        if p.is_file(): paths.append(p)
    return {p.relative_to(root).as_posix(): sha(p) for p in sorted(set(paths))}


def verify_phase3_archive(project):
    root = Path(project); receipt = root/STUDY/'phase3-acceptance.json'
    if sha(receipt) != PHASE3_RECEIPT_SHA: raise ValueError('Original Phase3 acceptance changed')
    expected = dict(schema_version='m1-phase3-source-archive-1', receipt_sha256=PHASE3_RECEIPT_SHA,
                    source_sha256=read(receipt)['source_sha256'])
    paths = [root/PHASE3_ARCHIVE/'binding.json', root/(PHASE3_ARCHIVE+'-initialized.json'), root/STUDY/'phase3-source-binding.json']
    if any(read(p) != expected for p in paths): raise ValueError('Phase3 archive witness changed')
    source_root = root/PHASE3_ARCHIVE/'source'
    if set(expected['source_sha256']) != {p.relative_to(source_root).as_posix() for p in source_root.rglob('*') if p.is_file()}:
        raise ValueError('Phase3 archive source membership changed')
    for name, h in expected['source_sha256'].items():
        if sha(artifact(root/PHASE3_ARCHIVE/'source', name)) != h: raise ValueError('Archived Phase3 source changed')
    return sha(paths[-1])


def gather_profile_inputs(project):
    """Verify real parents/build/runtime, but never read heldout outcomes."""
    root = Path(project).resolve()
    from .marking_audit import verify_historical_sources, ARCHIVE, DESCRIPTOR as K1_DESCRIPTOR
    from .coordination_evidence import verify_source_archive
    from .coordination_profile import runtime_snapshot
    from .candidate_profiles import _native_artifacts
    from .continuity_budget import parent_snapshot
    archive = verify_historical_sources(root, root/ARCHIVE, read(root/K1_DESCRIPTOR)['measurement_sha256'])
    if archive['live_modified'] or archive['live_missing']: raise ValueError('Historical K1 dependencies drifted')
    legacy = verify_source_archive(root); phase3 = verify_phase3_archive(root)
    accepted = read(root/STUDY/'phase3-acceptance.json'); build_path = root/STUDY/'m1-build.json'; build = read(build_path)
    if sha(build_path) != accepted['build_sha256'] or build['native_binary_sha256'] != NATIVE_SHA:
        raise ValueError('Phase3 static build identity changed')
    if build['native_imported'] is not False or build['native_core_created'] is not False or build['matches_executed'] != 0:
        raise ValueError('Offline static build required')
    native = artifact(root, build['native_dir']); folder = native.parent
    if len(build['source_files']) != 691 or len(build['projects']) != 12 or len(build['dependencies']) != 14:
        raise ValueError('Complete isolated native build required')
    if set(build['source_files']) != {p.relative_to(folder/'source').as_posix() for p in (folder/'source').rglob('*') if p.is_file()}:
        raise ValueError('Native source membership changed')
    if set(build['dependencies']) != {p.name for p in native.glob('*.dll')}: raise ValueError('Native dependency membership changed')
    refs = dict(build['parent_files']); refs[build_path.relative_to(root).as_posix()] = sha(build_path)
    refs.update({(folder/'source'/n).relative_to(root).as_posix(): h for n, h in build['source_files'].items()})
    refs.update({(folder/'build'/n).relative_to(root).as_posix(): h for n, h in build['projects'].items()})
    refs.update({(native/n).relative_to(root).as_posix(): h for n, h in build['dependencies'].items()})
    refs[(native/'_gameplayfootball.pyd').relative_to(root).as_posix()] = NATIVE_SHA
    refs[(folder/'provenance/source-tree.json').relative_to(root).as_posix()] = build['source_tree_sha256']
    for n, h in build['inputs'].items(): refs[n] = h
    for n, h in build['build_logs'].items(): refs[(folder/'provenance'/(n+'-build.log')).relative_to(root).as_posix()] = h
    for n, record in build['actual_compile_records'].items():
        paths = list((folder/'build'/(n+'.dir/Release')).glob('*.tlog/CL.command.1.tlog'))
        if len(paths) != 1: raise ValueError('Native compiler provenance missing')
        refs[paths[0].relative_to(root).as_posix()] = record['sha256']
    for key, name in [('static_exports_sha256', 'exports.log'), ('static_dependencies_sha256', 'dependencies.log')]:
        refs[(folder/'provenance'/name).relative_to(root).as_posix()] = build[key]
    for name, h in refs.items():
        if sha(artifact(root, name)) != h: raise ValueError('Native/build/parent artifact changed: '+name)
    c4, _ = _native_artifacts(root, 'c4')
    parent = read(root/'.local/grf-physical-work/continuation/candidate-bindings/c4.json')
    prior = read(root/K1_DESCRIPTOR)
    expected_keys = {f'{s}/{i:02}' for s, n in [('calibration', 8), ('heldout', 24)] for i in range(1, n+1)}
    if set(parent['payloads']) != expected_keys or parent['payloads'] != prior['payloads'] or c4['settings'] != prior['settings']:
        raise ValueError('Original 32 payloads/settings changed')
    campaign_path = root/'research/engine-evaluation/2026-10-17-grf-physical-validation/campaign.json'
    campaign = read(campaign_path)
    if sha(artifact(root, campaign['dataset'])) != campaign['dataset_sha256']: raise ValueError('Historical dataset changed')
    runtime = runtime_snapshot(root, campaign['python'])
    if runtime != prior['runtime_sha256']: raise ValueError('Existing Python/GRF runtime changed')
    refs[campaign_path.relative_to(root).as_posix()] = sha(campaign_path)
    refs[campaign['dataset']] = campaign['dataset_sha256']
    for name in ['phase2-acceptance.json', 'phase2-replay.json', 'phase3-acceptance.json', 'phase3-fixtures.json', 'phase3-source-binding.json']:
        refs[STUDY+'/'+name] = sha(root/STUDY/name)
    clocks = {n: sha(root/n) for n in ('backend/src/timepitch/grf/physical_clock.py', 'backend/src/timepitch/grf/action_runner.py')}
    return dict(native_dir=build['native_dir'], native_sha256=NATIVE_SHA, build_manifest_sha256=sha(build_path),
        python=campaign['python'], settings=c4['settings'], payloads=parent['payloads'], runtime_files=runtime,
        static_files=refs, clock_sources=clocks, parent=parent_snapshot(root),
        archive_bindings=dict(k1=archive['binding_sha256'], c4=legacy['binding_sha256'], phase3=phase3))


def _document(project, facts):
    return dict(schema_version='m1-continuity-profile-1', candidate_id='m1', policy=POLICY, observation=OBSERVATION,
        match_caps=MATCH_CAPS, run_root=RUN_ROOT, authorization_issued=False, execution_adapter='not-admitted-offline',
        modes=dict(observe='observe', calibration='apply', heldout='apply'),
        clock_gate=dict(status='unresolved', reference_source_sha256=facts['clock_sources'], common_reference_candidate_required=True,
                        changed_saved_control='stop-and-revise-design-control-budget'),
        proposed_allowance=dict(maximum=76, candidate_limit=6, additional_attempts=35, services_cost=0),
        measurement_sha256=measurement_sources(project), **{k: v for k, v in facts.items() if k != 'clock_sources'})


@dataclass(frozen=True)
class ContinuityProfile:
    project: Path
    identity: str
    native_sha256: str
    build_manifest_sha256: str
    native_dir: Path
    python_path: Path
    document: object

    def payload(self, key): return plain(self.document['payloads'][key])


def load_continuity_profile(project=PROJECT_ROOT):
    root = Path(project).resolve()
    try:
        value = read(root/DESCRIPTOR); expected = _document(root, gather_profile_inputs(root))
        if canonical(value) != canonical(expected): raise ValueError('Frozen M1 source/runtime/payload/observation closure changed')
        for group in ('static_files', 'runtime_files'):
            for name, h in value[group].items():
                if sha(artifact(root, name)) != h: raise ValueError('Frozen artifact changed: '+name)
        receipt = dict(schema_version='m1-profile-initialized-1', profile_identity=digest(value), descriptor_sha256=sha(root/DESCRIPTOR))
        if read(root/PROFILE_WITNESS) != receipt: raise ValueError('Frozen profile witness changed; never refreeze after deletion')
        return ContinuityProfile(root, digest(value), value['native_sha256'], value['build_manifest_sha256'],
                                 root/value['native_dir'], root/value['python'], freeze(value))
    except (OSError, KeyError, TypeError) as e: raise ValueError('Invalid frozen M1 profile') from e


def freeze_continuity_profile(project=PROJECT_ROOT):
    root = Path(project).resolve(); path = root/DESCRIPTOR; witness = root/PROFILE_WITNESS
    if path.exists() or witness.exists(): raise ValueError('Profile freeze already attempted; never overwrite or renew')
    value = _document(root, gather_profile_inputs(root)); data = canonical(value)+b'\n'
    receipt = dict(schema_version='m1-profile-initialized-1', profile_identity=digest(value), descriptor_sha256=hashlib.sha256(data).hexdigest())
    witness.parent.mkdir(parents=True, exist_ok=True)
    with witness.open('xb') as f: f.write(canonical(receipt))
    with path.open('xb') as f: f.write(data)
    return load_continuity_profile(root)
