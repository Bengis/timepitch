"""Offline M1 hooks and transport; standalone fake actors, never a football core."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / 'research/engine-evaluation/2026-10-18-grf-priority-continuity'


@pytest.fixture(scope='module')
def hook():
    builder = STUDY / 'build_continuity.py'
    if not builder.is_file(): return None
    spec = importlib.util.spec_from_file_location('m1_builder', builder)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.build_fixtures()


def invoke(hook, case):
    assert hook is not None, 'Missing standalone native adapter/shot recorder fixture'
    p = subprocess.run([str(hook), case], capture_output=True, timeout=10)
    assert p.returncode == 0, p.stderr.decode(errors='replace')
    return json.loads(p.stdout)


@pytest.mark.parametrize('case,owner,setters', [
    ('apply', 1, 4), ('off', 2, 4), ('ineligible', 2, 4),
    ('reset', 2, 4), ('mirror', 1, 4), ('observe', 2, 4),
    ('invalid', -1, 0), ('unresolved', -1, 0), ('unresolved_later', -1, 0), ('tie', 1, 4),
    ('period_reset', 2, 4), ('side_reset', 2, 4), ('manual', 2, 4), ('contest', 2, 4)])
def test_atomic_native_commit_preserves_pool_and_modes(hook, case, owner, setters):
    r = invoke(hook, case)
    assert r['owner'] == owner and r['setters'] == setters
    assert r['setter_trace'] == ([] if setters == 0 else [[0, -1], [1, -1], [2, -1], [owner, 100]])
    if case == 'observe':
        assert r['hypothetical_owner'] == 1 and r['actual_owner'] == 2


def record(hook, case='six'): return invoke(hook, case)


def wire():
    from timepitch.grf import shot_context_wire
    return shot_context_wire


def identity():
    return dict(run_id='M-observe-42', mode='observe', input_hash='1'*64,
                native_sha256='2'*64, profile_identity='3'*64, build_manifest_sha256='4'*64)


def validate(tmp_path, r):
    w = wire(); p = tmp_path / 'context.zlib'
    w.write_shot_context_sidecar(p, identity(), r)
    return w.validate_shot_context_sidecar(p, identity(),
        [f['row'] for f in r['frames']], r['observed_contacts'])


def test_six_first_confirmed_contacts_not_intents_or_goals(hook, tmp_path):
    r = record(hook)
    assert [s['raw_seq'] for s in r['triggers']] == [10, 20, 30, 40, 50, 60]
    assert len(r['observed_contacts']) == 7
    assert len(r['frames']) == 186
    assert validate(tmp_path, r)['selected_contacts'] == 6


def test_overlaps_merge_keep_every_trigger(hook, tmp_path):
    r = record(hook, 'overlap')
    out = validate(tmp_path, r)
    assert out['windows'] == [{'start_ms': 100, 'end_ms': 3600, 'raw_seqs': [10, 20]}]
    assert out['frames'] == 36


@pytest.mark.parametrize('case,complete,shots', [('zero', True, 0), ('one', True, 1), ('prefix', False, 1)])
def test_empty_short_and_interrupted_capture_are_explicit(hook, tmp_path, case, complete, shots):
    r = record(hook, case); out = validate(tmp_path, r)
    assert out['complete'] is complete and out['selected_contacts'] == shots
    if case == 'zero': assert out['observation'] == 'insufficient'
    if case == 'prefix': assert out['posthistory_missing'] > 0


def test_reset_gap_is_not_interpolated(hook, tmp_path):
    r = record(hook, 'gap'); out = validate(tmp_path, r)
    assert out['reset_boundaries'] == [2200]
    assert out['interpolated_frames'] == 0


def test_epoch_change_drops_stale_request_lineage(hook):
    assert invoke(hook, 'epoch') == {'lineage': []}


@pytest.mark.parametrize('case,function', [('lineage', 4), ('lineage_trap', 3)])
def test_selected_nonmovement_is_not_movement_even_with_movement_in_queue(hook, tmp_path, case, function):
    r = record(hook, case); out = validate(tmp_path, r)
    assert out['movement_selected'] == 0
    assert out['nonmovement_selected'] > 0
    assert r['frames'][0]['lineage'][0]['queued'][1]['function'] == 1
    assert r['frames'][0]['lineage'][0]['selected_function'] == function


def test_native_transaction_readback_order_is_by_identity(hook, tmp_path):
    r = record(hook, 'transaction'); out = validate(tmp_path, r)
    assert out['transactions'] == 1
    tx = r['transactions'][0]
    assert tx['actual_pairs'] == [[1, 100], [2, 101]]
    assert tx['reference_pairs'] == [[2, 101], [1, 100]]
    assert tx['mirror_sign'] == 1


def test_hunt_inputs_preserve_native_guard_values(hook, tmp_path):
    r = record(hook, 'lineage'); validate(tmp_path, r)
    h = r['frames'][0]['lineage'][0]['hunt_input']
    assert h == dict(force_magnet=False, best_possession=False, marked=False, opponent=100,
                     predicted_distance_m=8, radius_m=12)


def test_transaction_omitting_native_decision_inputs_fails(hook, tmp_path):
    r = record(hook, 'transaction')
    assert r['transactions'], 'Fixture must exercise an actual assignment transaction'
    del r['transactions'][0]['input']['quality']
    with pytest.raises(ValueError): validate(tmp_path, r)


@pytest.mark.parametrize('case', ['duplicate', 'frame_order', 'tx_cap', 'record_cap'])
def test_native_recorder_caps_fail_closed(hook, case):
    r = record(hook, case)
    assert r['overflowed'] and not r['complete']


@pytest.mark.parametrize('field,count', [('frames', 304), ('transactions', 401)])
def test_wire_global_collection_caps(hook, tmp_path, field, count):
    r = record(hook, 'one')
    r[field] = [deepcopy(r['frames'][0]) if field == 'frames' else {} for _ in range(count)]
    with pytest.raises(ValueError, match='cap'): validate(tmp_path, r)


@pytest.mark.parametrize('tamper', ['shot', 'row', 'identity', 'movement', 'order', 'extra', 'missing', 'context', 'ownership'])
def test_transport_rejects_rebound_or_misleading_context(hook, tmp_path, tamper):
    w = wire(); r = record(hook, 'lineage'); p = tmp_path/'bad.zlib'
    good = deepcopy(r); ident = identity()
    if tamper == 'shot': r['triggers'][0]['raw_seq'] = 999
    elif tamper == 'row': r['frames'][0]['row']['players'][0]['position'][0] += 1
    elif tamper == 'identity': ident['input_hash'] = '5'*64
    elif tamper == 'movement': r['frames'][0]['lineage'][0]['movement_selected'] = True
    elif tamper == 'order': r['frames'].reverse()
    elif tamper == 'extra': r['triggers'].append(dict(r['triggers'][0]))
    elif tamper == 'context':
        r['frames'][0]['contexts'][0] = dict(initialized=True, team=1, period=1, relocation_id=0, dynamic_side=-1, eligible=True)
    elif tamper == 'ownership': r['frames'][0]['marks'][0] = [[999, 100]]
    else: r['frames'].pop()
    with pytest.raises(ValueError):
        w.write_shot_context_sidecar(p, ident, r)
        w.validate_shot_context_sidecar(p, identity(), [f['row'] for f in good['frames']], good['observed_contacts'])


def test_transport_size_caps_and_strict_json(tmp_path):
    import zlib
    w = wire(); p = tmp_path/'oversize.zlib'
    for raw in [b' '*(32*1024*1024+1), b'{"a":1,"a":2}', b'['*40+b']'*40]:
        p.write_bytes(zlib.compress(raw))
        with pytest.raises(ValueError): w.validate_shot_context_sidecar(p, identity(), [], [])
    p.write_bytes(b'x'*(8*1024*1024+1))
    with pytest.raises(ValueError): w.validate_shot_context_sidecar(p, identity(), [], [])
