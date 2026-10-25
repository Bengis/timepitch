"""Supplemental offline acceptance; synthetic files only, never a native core."""
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import threading
from types import SimpleNamespace
import pytest
from test_grf_defensive_probe_budget import fixture,build,write,sha,STUDY
from test_grf_physical_campaign_budget import spec
from grf_action_fixtures import action_trace
from timepitch.grf.physical_codec import manifest_hash

DESIGN='docs/superpowers/specs/2026-10-17-grf-causal-intervention-design.md'
AUTH='research/engine-evaluation/2026-10-17-grf-defensive-calibration/phase1-authorization.json'
STATEMENT='Sí, apruebo el diseño y el plan, incluidas las dos enmiendas. Empieza por la fase 1.'


def api():
    name='timepitch.grf.defensive_acceptance'
    assert importlib.util.find_spec(name),'Missing supplemental offline acceptance'
    return importlib.import_module(name)


def paired():
    m,blocks=action_trace(splits=(2,))
    p=m.model_copy(deep=True);p.native_binary_sha256='c'*64
    p.attribute_readbacks=list(reversed(p.attribute_readbacks));p.trace_hash=manifest_hash(p)
    return m,p,blocks


def test_reordered_readbacks_only_are_equivalent():
    a,b,blocks=paired();result=api()._compare_manifests(a,b)
    assert result['readbacks']==66 and result['keyed_readbacks_equal']
    assert result['ordered_readbacks_equal'] is False
    from timepitch.grf.defensive_probe import compare_defensive_capture
    with pytest.raises(ValueError):compare_defensive_capture(
        SimpleNamespace(manifest=a,chunks=lambda:iter(blocks)),
        SimpleNamespace(manifest=b,chunks=lambda:iter(blocks)))


def test_supplement_requires_the_actual_ordering_exception():
    a,b,_=paired();b.attribute_readbacks=copy.deepcopy(a.attribute_readbacks);b.trace_hash=manifest_hash(b)
    with pytest.raises(ValueError,match='ordering exception'):api()._compare_manifests(a,b)


@pytest.mark.parametrize('change',['value','duplicate','missing','input','ledger','trace','chunk','score'])
def test_changed_value_duplicate_key_or_middle_block_rejected(change):
    a,b,_=paired()
    if change=='value':b.attribute_readbacks[0].effective+=.001
    if change=='duplicate':b.attribute_readbacks[0]=b.attribute_readbacks[1]
    if change=='missing':b.attribute_readbacks.pop()
    if change=='input':b.input.config.seed+=1
    if change=='ledger':b.periods[0].effective_ms+=100
    if change=='chunk':b.chunks[0].sha256='f'*64
    if change=='score':b.score=(1,0)
    b.trace_hash=manifest_hash(b)
    if change=='trace':b.trace_hash='f'*64
    with pytest.raises(ValueError):api()._compare_manifests(a,b)


def setup(tmp_path,monkeypatch):
    import test_grf_defensive_probe_budget as old_fixture
    import test_grf_physical_campaign_budget as original_fixture
    old_bytes=b'fixture old binary'
    monkeypatch.setattr(old_fixture,'N',hashlib.sha256(old_bytes).hexdigest())
    monkeypatch.setattr(original_fixture,'N',hashlib.sha256(old_bytes).hexdigest())
    m,b,root,probe,d=fixture(tmp_path,monkeypatch)
    m.initialize_defensive_probe(d,probe,approved=True);native=build(tmp_path)
    m.reserve_defensive_probe(probe,input_hash=d['control']['input_hash'],native_sha256=native)
    evidence=probe/'evidence/D-defense-42';evidence.mkdir(parents=True)
    for name in ('manifest.json','defense.jsonl','failure.json','launch.json'):
        (evidence/name).write_bytes(b'synthetic sealed '+name.encode())
    m.finish_defensive_probe(probe,state='failed',evidence=dict(result_path='evidence/D-defense-42',
        files={p.name:sha(p) for p in evidence.iterdir()}))
    design=tmp_path/DESIGN;design.parent.mkdir(parents=True);design.write_text('Approved synthetic design\n')
    write(tmp_path/AUTH,dict(schema_version='grf-defensive-analysis-authorization-1',
        user_statement=STATEMENT,approved_design_sha256=sha(design),execute_phase=1,
        scope=['supplemental_equivalence_registration','incremental_c5_design']))
    write(tmp_path/(STUDY+'/defensive-probe-report.json'),dict(acceptance={'quote':'accepted offline'}))
    write(tmp_path/(STUDY+'/defensive-probe-transport-freeze.json'),dict(historical_freeze_sha256='f'*64))
    write(tmp_path/(STUDY+'/technical-freeze.json'),dict(historical='immutable'))
    (tmp_path/(STUDY+'/native-defensive-probe.patch')).write_bytes(b'fixture patch')
    old_native=tmp_path/'.local/grf-actions-pressure-native/Release/_gameplayfootball.pyd'
    old_native.write_bytes(old_bytes)
    module=api()
    # Durability tests isolate the expensive full stream/sidecar proof. Its
    # real implementation has a separate complete synthetic capture test.
    proof=dict(readbacks=66,keyed_readbacks_equal=True,ordered_readbacks_equal=False,
        blocks=1,samples=3,sidecar={'frames':3},input_hash=d['control']['input_hash'])
    calls=[]
    def prove(*args):calls.append(1);return copy.deepcopy(proof)
    monkeypatch.setattr(module,'_capture_proof',prove)
    return module,m,b,root,probe,calls


def register(module,root,tmp_path):
    return module.register_probe_analysis_acceptance(root,approved_design_sha256=sha(tmp_path/DESIGN),authorization_ref=AUTH)


def grant_files(root):
    return (root.with_name('defensive-probe')/'analysis-acceptance.json',
        root.parent/'defensive-probe-analysis-registration.json',
        root.parent/'defensive-probe-analysis-initialized.json')


def test_acceptance_preserves_failed_terminal_and_usage29(tmp_path,monkeypatch):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch)
    original={p:p.read_bytes() for p in (probe/'checkpoint.json',probe.parent/'defensive-probe-registration.json',
        root/'checkpoint.json',root.parent/'continuation-registration.json')}
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))
    receipt=register(a,root,tmp_path)
    assert receipt['schema_version']=='grf-defensive-analysis-acceptance-1'
    assert original=={p:p.read_bytes() for p in original}
    assert m.cumulative_usage(root)==dict(original_used=28,extension_used=1,used=29,maximum=71,candidates=3)
    assert register(a,root,tmp_path)==receipt and len(calls)==1
    assert json.loads((probe/'checkpoint.json').read_bytes())['run']['state']=='failed'
    b.reserve_run(root,spec(b,'c4/calibration/01'))
    assert m.cumulative_usage(root)['used']==30
    pin=sha(tmp_path/'.local/grf-defense-native/Release/_gameplayfootball.pyd')
    with pytest.raises(ValueError):m.reserve_defensive_probe(probe,input_hash='a'*64,native_sha256=pin)


@pytest.mark.parametrize('deleted',[(0,),(1,),(2,),(0,1),(0,1,2)])
def test_acceptance_missing_both_files_stays_blocked(tmp_path,monkeypatch,deleted):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch);register(a,root,tmp_path)
    for i in deleted:grant_files(root)[i].unlink()
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))
    if deleted!=(0,1,2):
        with pytest.raises(ValueError):register(a,root,tmp_path)
    assert m.cumulative_usage(root)['used']==29


def test_partial_creation_witness_blocks_reinitialization(tmp_path,monkeypatch):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch);old=b._write
    def fail(path,value):
        if Path(path).name=='analysis-acceptance.json':raise OSError('synthetic crash after witness')
        old(path,value)
    monkeypatch.setattr(b,'_write',fail)
    with pytest.raises(OSError):register(a,root,tmp_path)
    monkeypatch.setattr(b,'_write',old)
    assert grant_files(root)[2].exists()
    with pytest.raises(ValueError):register(a,root,tmp_path)
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))


def test_two_writers_register_once(tmp_path,monkeypatch):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch);barrier=threading.Barrier(2)
    def writer():barrier.wait();return register(a,root,tmp_path)
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:writer(),range(2)))
    assert results[0]==results[1] and len(calls)==1 and m.cumulative_usage(root)['used']==29


def test_old_campaign_advances_without_invalidating_grant(tmp_path,monkeypatch):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch);receipt=register(a,root,tmp_path)
    b.reserve_run(root,spec(b,'c4/calibration/01'));b.finish_run(root,'c4/calibration/01',state='failed',evidence={})
    b.reserve_run(root,spec(b,'c4/calibration/02'))
    assert register(a,root,tmp_path)==receipt and m.cumulative_usage(root)['used']==31
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))


@pytest.mark.parametrize('changed',['failed','control','report','binary','dependency','patch','freeze','authorization','design','receipt','registration','witness'])
def test_changed_binding_blocks_new_reservation(tmp_path,monkeypatch,changed):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch);register(a,root,tmp_path)
    path={'failed':probe/'evidence/D-defense-42/defense.jsonl',
        'control':root/'evidence/T-actions/match/0.zlib',
        'report':tmp_path/(STUDY+'/defensive-probe-report.json'),
        'binary':tmp_path/'.local/grf-defense-native/Release/_gameplayfootball.pyd',
        'dependency':tmp_path/'.local/grf-defense-native/Release/python310.dll',
        'patch':tmp_path/(STUDY+'/native-defensive-probe.patch'),
        'freeze':tmp_path/(STUDY+'/defensive-probe-transport-freeze.json'),
        'authorization':tmp_path/AUTH,'design':tmp_path/DESIGN,
        'receipt':grant_files(root)[0],'registration':grant_files(root)[1],'witness':grant_files(root)[2]}[changed]
    path.write_bytes(path.read_bytes()+b'changed')
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))
    assert len(json.loads((root/'checkpoint.json').read_bytes())['runs'])==4


@pytest.mark.parametrize('bad',['hash','authorization','path'])
def test_unapproved_identity_or_alternate_root_cannot_register(tmp_path,monkeypatch,bad):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch)
    with pytest.raises(ValueError):a.register_probe_analysis_acceptance(
        root.with_name('other') if bad=='path' else root,
        approved_design_sha256='0'*64 if bad=='hash' else sha(tmp_path/DESIGN),
        authorization_ref='' if bad=='authorization' else AUTH)
    assert not any(p.exists() for p in grant_files(root)) and m.cumulative_usage(root)['used']==29


def test_full_synthetic_capture_sidecar_and_changed_compressed_block(tmp_path):
    from grf_action_fixtures import write_action_match
    from grf_defense_fixtures import records
    from timepitch.grf.defensive_probe_wire import DefenseSidecarWriter
    from timepitch.grf.defensive_probe_budget import DESCRIPTOR,BUILD_MANIFEST
    import shutil
    control=tmp_path/'.local/control';left=write_action_match(control)
    captured=tmp_path/'.local/grf-physical-work/defensive-probe/evidence/D-defense-42'
    shutil.copytree(control,captured)
    right=left.model_copy(deep=True);right.native_binary_sha256='c'*64
    right.attribute_readbacks.reverse();right.trace_hash=manifest_hash(right)
    write(captured/'manifest.json',right.model_dump(mode='json'))
    windows=[dict(event_seq=i,event_ms=end,start_ms=start,end_ms=end)
        for i,(start,end) in enumerate(((90,200),(390,500),(690,800)),1)]
    d=dict(control=dict(result_path=control.relative_to(tmp_path).as_posix(),input_hash=left.input.input_hash,
        trace_hash=left.trace_hash,native_sha256=left.native_binary_sha256),windows=windows)
    write(tmp_path/DESCRIPTOR,d)
    patch=tmp_path/(STUDY+'/native-defensive-probe.patch');patch.write_bytes(b'compiled fixture metadata only')
    build=dict(native_binary_sha256=right.native_binary_sha256,patch_sha256=sha(patch))
    write(tmp_path/BUILD_MANIFEST,build)
    historical=tmp_path/(STUDY+'/technical-freeze.json');write(historical,{'old':'preserved'})
    write(tmp_path/(STUDY+'/defensive-probe-transport-freeze.json'),dict(native_sha256=right.native_binary_sha256,
        old_native_sha256=left.native_binary_sha256,historical_freeze_sha256=sha(historical)))
    identity=dict(input_hash=left.input.input_hash,native_sha256=right.native_binary_sha256,
        descriptor_sha256=sha(tmp_path/DESCRIPTOR),build_manifest_sha256=sha(tmp_path/BUILD_MANIFEST))
    write(captured/'launch.json',identity)
    writer=DefenseSidecarWriter(captured/'defense.jsonl',identity,windows)
    for t in (100,200,400,500,700,800):writer.append(t,t//100,records(t))
    writer.finish(right.trace_hash)
    failure=dict(type='ValueError',message='Research manifest differs beyond native SHA/trace',
        last_received_physics_ms=5400000,wall_seconds=100,peak_private_bytes=1000000)
    write(captured/'failure.json',failure)
    state=dict(run=dict(evidence=dict(result_path='evidence/D-defense-42',error=failure)))
    result=api()._capture_proof(tmp_path,d,state,build)
    assert result['samples']==54002 and result['blocks']==55 and result['sidecar']['frames']==6
    changed=captured/'27.zlib';changed.write_bytes(changed.read_bytes()+b'changed')
    with pytest.raises(ValueError,match='Gameplay block changed'):api()._capture_proof(tmp_path,d,state,build)


def test_failed_probe_grant_keeps_all_42_ids_and_71_limit(tmp_path,monkeypatch):
    a,m,b,root,probe,calls=setup(tmp_path,monkeypatch);register(a,root,tmp_path)
    ids=[f'c{c}/calibration/{i:02}' for c in (4,5) for i in range(1,9)]
    ids += [f'selected/heldout/{i:02}' for i in range(1,25)]+['R-selected','W-local']
    for id in ids:b.reserve_run(root,spec(b,id))
    assert m.cumulative_usage(root)==dict(original_used=70,extension_used=1,used=71,maximum=71,candidates=5)
    for id in ('D-defense-42','c1/calibration/01','c6/calibration/01','selected/heldout/25'):
        with pytest.raises(ValueError):b.reserve_run(root,spec(b,id))
    assert len(calls)==1 and json.loads((probe/'checkpoint.json').read_bytes())['run']['state']=='failed'
