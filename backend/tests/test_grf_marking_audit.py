"""Read-only audit of retained K1 decisions; never a match acceptance test."""
from copy import deepcopy
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def api():
    name = 'timepitch.grf.marking_audit'
    assert importlib.util.find_spec(name), 'Missing maintained marking auditor'
    return importlib.import_module(name)


def transaction():
    from timepitch.grf.coordination_wire import iter_coordination_frames
    path = ROOT / '.local/grf-physical-work/coordination/evidence/k1/calibration/01/coordination.jsonl'
    return next(tx for f in iter_coordination_frames(path) for tx in f['transactions']
                if tx['type'] == 'assignment' and tx['physics_ms'] == 4014600 and tx['team'] == 1)


def test_kompany_reservation_lowers_objective():
    module = api(); tx = transaction(); before = deepcopy(tx)
    result = module.compare_assignment(tx)
    assert result['status'] == 'available' and result['eligible']
    assert result['top_threat']['recorded_owner'] == 18
    assert result['top_threat']['recorded_distance_m'] == pytest.approx(22.653213132562207)
    assert result['top_threat']['eligible_greedy_owner'] == 14
    assert result['top_threat']['eligible_greedy_distance_m'] == pytest.approx(3.450581255768031)
    assert result['unreserved']['pairs'] == [[13, 7], [14, 9], [17, 6]]
    assert result['reservation_loss'] == pytest.approx(.06406128406524658)
    assert result['counterfactual_outcomes'] is False and tx == before


def test_override_pool_is_reported_separately():
    module = api(); tx = transaction()
    next(p for p in tx['input']['players'] if p['id'] == 14)['ball_contest'] = True
    tx['decision']['cover'] = None
    # Query reference pools independently; do not re-label the altered snapshot a native result.
    assert module.reference_greedy(tx['input'], exclude_overrides=False)[0] == [14, 9]
    assert module.reference_greedy(tx['input'], exclude_overrides=True)[0][0] != 14


@pytest.mark.parametrize('missing', ['input', 'prior_state', 'quality', 'formation'])
def test_missing_native_input_is_unavailable(missing):
    module = api(); tx = transaction()
    if missing in ('input', 'prior_state'): tx.pop(missing)
    elif missing == 'quality': tx['input'].pop('quality')
    else: next(p for p in tx['input']['players'] if p['team'] == 1 and not p['keeper'])['formation'] = None
    result = module.compare_assignment(tx)
    assert result['status'] == 'unavailable'
    assert result['recorded_pairs'] is None and result['unreserved'] is None
    assert 'predicted_goals' not in result


def fake_archive(root):
    m = api(); archive = root / m.ARCHIVE
    expected = {'backend/src/timepitch/old.py': hashlib.sha256(b'old\n').hexdigest()}
    file = archive / 'source/backend/src/timepitch/old.py'; file.parent.mkdir(parents=True); file.write_bytes(b'old\n')
    live = root / 'backend/src/timepitch/old.py'; live.parent.mkdir(parents=True); live.write_bytes(b'old\n')
    binding = dict(schema_version='grf-marking-historical-source-1', archive=m.ARCHIVE,
                   archived_from_commit='a' * 40, profile_identity='b' * 64,
                   measurement_sha256=expected, parent_files={}, protected_artifacts={})
    path = root / m.BINDING; path.parent.mkdir(parents=True); path.write_bytes(m.canonical(binding))
    witness = dict(schema_version='grf-marking-archive-witness-1', binding_sha256=m.file_sha(path),
                   profile_identity=binding['profile_identity'], source_count=1, archived_from_commit='a' * 40)
    (archive / 'initialized.json').write_bytes(m.canonical(witness))
    outer = root / m.ARCHIVE_WITNESS; outer.parent.mkdir(parents=True, exist_ok=True); outer.write_bytes(m.canonical(witness))
    return archive, expected, path


def test_historical_membership_not_refreshed(tmp_path):
    m = api(); archive, expected, binding = fake_archive(tmp_path); before = binding.read_bytes()
    (tmp_path / 'backend/src/timepitch/old.py').write_bytes(b'changed\n')
    (tmp_path / 'backend/src/timepitch/added.py').write_bytes(b'added\n')
    result = m.verify_historical_sources(tmp_path, archive, expected)
    assert result['source_count'] == 1 and not result['live_source_closure_matches']
    assert result['live_added'] == ['backend/src/timepitch/added.py']
    assert result['live_modified'] == ['backend/src/timepitch/old.py']
    assert binding.read_bytes() == before
    assert (archive / 'source/backend/src/timepitch/old.py').read_bytes() == b'old\n'


@pytest.mark.parametrize('failure', ['bytes', 'membership', 'binding', 'witness', 'outside', 'parent', 'protected'])
def test_archive_fails_closed(tmp_path, failure):
    m = api(); archive, expected, binding = fake_archive(tmp_path)
    if failure == 'bytes': (archive / 'source/backend/src/timepitch/old.py').write_bytes(b'bad')
    elif failure == 'membership': (archive / 'source/extra.py').write_bytes(b'bad')
    elif failure == 'binding': binding.write_bytes(binding.read_bytes() + b' ')
    elif failure == 'witness': (tmp_path / m.ARCHIVE_WITNESS).unlink()
    elif failure == 'outside': archive = tmp_path.parent
    else:
        record = json.loads(binding.read_bytes())
        record['parent_files' if failure == 'parent' else 'protected_artifacts']['missing'] = 'a' * 64
        binding.write_bytes(m.canonical(record))
        witness = json.loads((archive / 'initialized.json').read_bytes()); witness['binding_sha256'] = m.file_sha(binding)
        for path in (archive / 'initialized.json', tmp_path / m.ARCHIVE_WITNESS): path.write_bytes(m.canonical(witness))
    with pytest.raises(ValueError): m.verify_historical_sources(tmp_path, archive, expected)


@pytest.mark.parametrize('path,run', [
    ('.local/grf-physical-work/coordination/evidence/k1/heldout/01/manifest.json', 'k1/heldout/01'),
    ('../outside/manifest.json', 'k1/calibration/01'),
    ('.local/grf-physical-work/coordination/evidence/k1/calibration/03/manifest.json', 'k1/calibration/03')])
def test_no_execution_or_heldout_access(tmp_path, monkeypatch, path, run):
    m = api()
    def forbidden(*args, **kwargs): raise AssertionError('No file may be opened for a rejected reference')
    monkeypatch.setattr(Path, 'open', forbidden)
    with pytest.raises(ValueError, match='reference'):
        m.analyze_marking_evidence(tmp_path, (m.EvidenceRef(path, 'a' * 64, 'manifest', run),))


def test_module_never_imports_native_or_launch_modules(monkeypatch):
    import builtins
    original = builtins.__import__
    def guarded(name, *args, **kwargs):
        assert not any(v in name for v in ('football', 'coordination_campaign', 'coordination_process', 'coordination_runner', 'action_validation', 'physical_campaign_budget'))
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', guarded)
    m = api()
    assert m.compare_assignment(transaction())['status'] == 'available'


def test_reference_ties_use_native_order_and_partial_slots():
    m = api(); tx = transaction(); x = tx['input']
    own = [p for p in x['players'] if p['team'] == x['team']]
    for p in own:
        p['active'] = p['id'] in (14, 18)
        p['manual'] = False; p['ball_contest'] = False
    x['players'] = list(reversed(x['players']))
    x['quality'] = [[.5, .5, .5] for _ in own]
    assert m.reference_greedy(x, exclude_overrides=False) == [[18, 9], [14, 7]]


def test_source_expectation_cannot_be_rebound(tmp_path):
    m = api(); archive, expected, binding = fake_archive(tmp_path)
    expected = {key: 'a' * 64 for key in expected}
    with pytest.raises(ValueError, match='refreshed'):
        m.verify_historical_sources(tmp_path, archive, expected)


def test_audit_refuses_changed_live_dependency(tmp_path):
    m = api(); archive, expected, binding = fake_archive(tmp_path)
    descriptor = tmp_path / m.DESCRIPTOR; descriptor.parent.mkdir(parents=True, exist_ok=True)
    descriptor.write_bytes(m.canonical({'measurement_sha256': expected}))
    (tmp_path / 'backend/src/timepitch/old.py').write_bytes(b'changed dependency\n')
    ref = m.EvidenceRef(m.PREFIX + 'K-observe-42/manifest.json', 'a' * 64, 'manifest', 'K-observe-42')
    with pytest.raises(ValueError, match='Live historical'):
        m.analyze_marking_evidence(tmp_path, (ref,))


def test_retained_totals_and_exact_transactions(monkeypatch):
    import builtins
    import subprocess
    m = api(); imported = builtins.__import__; opened = Path.open; launched = subprocess.run
    pure = (ROOT / '.local/grf-coordination-native/provenance/replay/policy.exe').resolve()
    def guarded_import(name, *args, **kwargs):
        assert not any(v in name for v in ('football', 'coordination_campaign', 'coordination_process',
            'coordination_runner', 'action_validation', 'physical_campaign_budget'))
        return imported(name, *args, **kwargs)
    def guarded_open(path, *args, **kwargs):
        assert '/evidence/k1/heldout/' not in path.as_posix()
        assert '/evidence/k1/calibration/03/' not in path.as_posix()
        return opened(path, *args, **kwargs)
    def guarded_run(command, *args, **kwargs):
        assert command == [str(pure)] and not kwargs.get('shell')
        return launched(command, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', guarded_import)
    monkeypatch.setattr(Path, 'open', guarded_open)
    monkeypatch.setattr(subprocess, 'run', guarded_run)
    result = m.analyze_marking_evidence(ROOT, m.retained_references(ROOT))
    assert result['archive']['source_count'] == 122
    assert result['archive']['live_added'] == ['backend/src/timepitch/grf/continuity_budget.py',
                                             'backend/src/timepitch/grf/continuity_campaign.py',
                                             'backend/src/timepitch/grf/continuity_profile.py',
                                             'backend/src/timepitch/grf/marking_audit.py',
                                             'backend/src/timepitch/grf/shot_context_wire.py']
    assert result['archive']['live_modified'] == result['archive']['live_missing'] == []
    assert result['totals'] == dict(assignments=374, state_events=61, eligible=191,
        applied_eligible=114, applied_cover=103, applied_reservation_losses=36,
        applied_raw_top_degradation=9, applied_eligible_top_degradation=6,
        applied_unreserved_top_recovery=2, applied_shots_in_windows=0)
    assert result['exact_replay']['assignments'] == 374
    assert result['exact_replay']['state_events'] == 61
    assert result['usage'] == dict(used=41, maximum=72, candidates=5)
    assert result['counterfactual_outcomes'] is False
    assert sum(len(r['comparisons']) for r in result['runs'].values()) == 191
