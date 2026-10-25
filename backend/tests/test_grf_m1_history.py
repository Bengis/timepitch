"""Archive raw metadata/source bytes, never import GRF or grant execution."""
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path

import pytest
from grf_offline_guard import offline_only


def api():
    name = 'timepitch.grf.m1_history'
    assert importlib.util.find_spec(name), 'Missing TP058 archive verifier'
    return importlib.import_module(name)


def seed(root):
    m = api()
    def put(name, data):
        p = root/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
        return hashlib.sha256(data).hexdigest()
    source = {'backend/src/timepitch/example.py': put('backend/src/timepitch/example.py', b'# raw\r\nx=1\r\n')}
    doc = dict(schema_version='m1-continuity-profile-1', measurement_sha256=source,
               static_files={'native/old.pyd': put('native/old.pyd', b'not executable')},
               runtime_files={'runtime/old.exe': put('runtime/old.exe', b'never loaded')},
               parent={'files': {'old/checkpoint.json': put('old/checkpoint.json', b'{}')}})
    raw = m.canonical(doc)+b'\n'
    put(m.DESCRIPTOR, raw)
    witness = dict(schema_version='m1-profile-initialized-1', profile_identity=hashlib.sha256(m.canonical(doc)).hexdigest(),
                   descriptor_sha256=hashlib.sha256(raw).hexdigest())
    put(m.PROFILE_WITNESS, m.canonical(witness))
    return m, doc


def test_archive_preserves_raw_crlf_and_metadata_and_cannot_be_renewed(tmp_path):
    m, doc = seed(tmp_path)
    receipt = m.archive_tp058(tmp_path)
    assert receipt.source_count == 1
    assert receipt.profile_identity == json.loads((tmp_path/m.PROFILE_WITNESS).read_bytes())['profile_identity']
    assert (tmp_path/m.ARCHIVE/'source/backend/src/timepitch/example.py').read_bytes() == b'# raw\r\nx=1\r\n'
    assert m.verify_tp058_archive(tmp_path) == receipt
    with pytest.raises(ValueError, match='attempted'): m.archive_tp058(tmp_path)


@pytest.mark.parametrize('change', ['source', 'extra', 'missing', 'metadata', 'descriptor', 'witness', 'binding', 'anchor', 'public', 'static', 'runtime', 'parent'])
def test_archive_membership_witnesses_and_artifacts_fail_closed(tmp_path, change):
    m, _ = seed(tmp_path); m.archive_tp058(tmp_path)
    paths = {'source': m.ARCHIVE+'/source/backend/src/timepitch/example.py',
        'extra': m.ARCHIVE+'/source/extra.py', 'missing': m.ARCHIVE+'/source/backend/src/timepitch/example.py',
        'metadata': m.ARCHIVE+'/metadata/'+m.DESCRIPTOR, 'descriptor': m.DESCRIPTOR, 'witness': m.PROFILE_WITNESS,
        'binding': m.ARCHIVE+'/binding.json', 'anchor': m.ARCHIVE_WITNESS, 'public': m.BINDING,
        'static': 'native/old.pyd', 'runtime': 'runtime/old.exe', 'parent': 'old/checkpoint.json'}
    path = tmp_path/paths[change]
    if change in ('missing', 'anchor'): path.unlink()
    else: path.write_bytes(b'changed')
    with pytest.raises(ValueError): m.verify_tp058_archive(tmp_path)


def test_live_changes_are_reported_not_rebound_to_old_profile(tmp_path):
    m, _ = seed(tmp_path); original = m.archive_tp058(tmp_path)
    (tmp_path/'backend/src/timepitch/example.py').write_bytes(b'# new version')
    (tmp_path/'backend/src/timepitch/new.py').write_bytes(b'# deliberately added')
    receipt = m.verify_tp058_archive(tmp_path)
    assert receipt.profile_identity == original.profile_identity
    assert receipt.live_modified == ('backend/src/timepitch/example.py',)
    assert receipt.live_added == ('backend/src/timepitch/new.py',)


def test_partial_archive_and_path_escape_never_initialize_again(tmp_path):
    m, _ = seed(tmp_path)
    (tmp_path/m.ARCHIVE).mkdir(parents=True)
    with pytest.raises(ValueError, match='attempted'): m.archive_tp058(tmp_path)
    with pytest.raises(ValueError): m.verify_tp058_archive(tmp_path)
    for name in ('../escape', str(tmp_path.resolve())):
        with pytest.raises(ValueError): m.artifact(tmp_path, name)
