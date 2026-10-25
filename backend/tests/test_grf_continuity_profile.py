"""Frozen M1 metadata only: no engine import, process, core or reservation."""
import copy
import importlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def api():
    name = 'timepitch.grf.continuity_profile'
    assert importlib.util.find_spec(name), 'Missing offline continuity profile'
    return importlib.import_module(name)


@pytest.fixture
def frozen(tmp_path, monkeypatch):
    m = api()
    for name in ('backend/src/timepitch/example.py', '.local/runtime/python.exe', '.local/native/engine.pyd', 'legacy/checkpoint.json'):
        p = tmp_path/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'synthetic bytes, never executed')
    (tmp_path/m.STUDY).mkdir(parents=True)
    payloads = {f'{s}/{i:02}': dict(input_hash=f'{i:064x}', settings={'unchanged': True}, players=[{'id': 1}])
                for s, count in [('calibration', 8), ('heldout', 24)] for i in range(1, count+1)}
    facts = dict(native_dir='.local/native', native_sha256=m.sha(tmp_path/'.local/native/engine.pyd'),
        build_manifest_sha256='b'*64, python='.local/runtime/python.exe', settings={'unchanged': True}, payloads=payloads,
        runtime_files={'.local/runtime/python.exe': m.sha(tmp_path/'.local/runtime/python.exe')},
        static_files={'.local/native/engine.pyd': m.sha(tmp_path/'.local/native/engine.pyd')},
        clock_sources={'backend/src/timepitch/example.py': m.sha(tmp_path/'backend/src/timepitch/example.py')},
        parent=dict(used=41, maximum=72, candidates=5, terminal_id='k1/calibration/03',
                    files={'legacy/checkpoint.json': m.sha(tmp_path/'legacy/checkpoint.json')}, heldout_opened=False,
                    selection_sealed=False, legacy_retired=True), archive_bindings={'k1': 'c'*64, 'c4': 'd'*64})
    monkeypatch.setattr(m, 'gather_profile_inputs', lambda project: copy.deepcopy(facts))
    return m.freeze_continuity_profile(tmp_path)


def test_freeze_is_metadata_only_and_does_not_create_execution_state(frozen):
    m = api(); p = frozen.project
    assert m.load_continuity_profile(p).identity == frozen.identity
    assert not (p/m.RUN_ROOT).exists()
    assert frozen.document['authorization_issued'] is False
    assert frozen.document['clock_gate']['status'] == 'unresolved'
    assert frozen.payload('calibration/01')['input_hash'] == f'{1:064x}'
    with pytest.raises(ValueError): m.freeze_continuity_profile(p)


@pytest.mark.parametrize('tamper', ['source', 'extra_source', 'runtime', 'native', 'window', 'payload', 'caps', 'clock', 'authorization'])
def test_frozen_source_payload_window_and_runtime_cannot_drift(frozen, tamper):
    m = api(); root = frozen.project; path = root/m.DESCRIPTOR
    doc = json.loads(path.read_bytes())
    if tamper in ('source', 'runtime', 'native'):
        name = {'source': 'backend/src/timepitch/example.py', 'runtime': '.local/runtime/python.exe', 'native': '.local/native/engine.pyd'}[tamper]
        (root/name).write_bytes(b'changed')
    elif tamper == 'extra_source': (root/'backend/src/timepitch/new.py').write_bytes(b'added')
    else:
        if tamper == 'window': doc['observation']['shots'] = 7
        elif tamper == 'payload': doc['payloads']['calibration/01']['players'][0]['id'] = 5
        elif tamper == 'caps': doc['match_caps']['child_seconds'] = 601
        elif tamper == 'clock': doc['clock_gate']['status'] = 'approved'
        else: doc['authorization_issued'] = True
        path.write_text(json.dumps(doc))
    with pytest.raises(ValueError): m.load_continuity_profile(root)


def test_profile_data_is_immutable_and_payload_copy_is_detached(frozen):
    value = frozen.payload('calibration/01'); value['players'][0]['id'] = 99
    assert frozen.payload('calibration/01')['players'][0]['id'] == 1
    with pytest.raises(TypeError): frozen.document['policy']['close_m'] = 3


def test_path_escape_and_metadata_corruption_fail(frozen):
    m = api()
    with pytest.raises(ValueError): m.artifact(frozen.project, '../outside')
    with pytest.raises(ValueError): m.artifact(frozen.project, str(frozen.project))
    (frozen.project/m.DESCRIPTOR).write_bytes(b'{"x":1,"x":2}')
    with pytest.raises(ValueError): m.load_continuity_profile(frozen.project)


def test_deleted_profile_witness_cannot_be_refrozen(frozen):
    m = api(); (frozen.project/m.PROFILE_WITNESS).unlink()
    with pytest.raises(ValueError): m.load_continuity_profile(frozen.project)
    with pytest.raises(ValueError): m.freeze_continuity_profile(frozen.project)


def test_phase3_archive_membership_is_fixed(tmp_path, monkeypatch):
    from timepitch.grf.physical_wire import canonical
    m = api(); study = tmp_path/m.STUDY; study.mkdir(parents=True)
    archive = tmp_path/m.PHASE3_ARCHIVE; p = archive/'source/example.py'; p.parent.mkdir(parents=True); p.write_bytes(b'original')
    receipt = study/'phase3-acceptance.json'; receipt.write_bytes(canonical({'source_sha256': {'example.py': m.sha(p)}}))
    monkeypatch.setattr(m, 'PHASE3_RECEIPT_SHA', m.sha(receipt))
    proof = dict(schema_version='m1-phase3-source-archive-1', receipt_sha256=m.sha(receipt), source_sha256={'example.py': m.sha(p)})
    for target in [archive/'binding.json', tmp_path/(m.PHASE3_ARCHIVE+'-initialized.json'), study/'phase3-source-binding.json']:
        target.write_bytes(canonical(proof))
    m.verify_phase3_archive(tmp_path)
    (archive/'source/added.py').write_bytes(b'untracked addition')
    with pytest.raises(ValueError): m.verify_phase3_archive(tmp_path)
