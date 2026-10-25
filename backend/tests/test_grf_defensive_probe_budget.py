"""Ledger components only: real files/locks and hand-authored action events, no GRF."""
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import threading
import pytest
from test_grf_physical_campaign_budget import setup_campaign,spec,H,N
from grf_action_fixtures import action_trace
from grf_statistics_fixtures import native_event

STUDY='research/engine-evaluation/2026-10-17-grf-physical-validation'
BUILD=STUDY+'/native-defensive-probe-build.json'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes((json.dumps(value,sort_keys=True)+'\n').encode())


def events():
    return [native_event(seq=1122,type='touch',kind='shot',actual_time_ms=781770),
        native_event(seq=5489,type='touch',kind='shot',actual_time_ms=4133450),
        native_event(seq=1537,type='decision',kind='foul',stage='accepted',actual_time_ms=1164860,function=13),
        native_event(seq=1538,type='decision',kind='foul',stage='sanctioned',actual_time_ms=1164870,function=13)]


def api():
    name='timepitch.grf.defensive_probe_budget'
    assert importlib.util.find_spec(name) is not None,'Missing single-use defensive probe budget'
    return importlib.import_module(name)


def fixture(tmp_path,monkeypatch):
    from timepitch.grf import physical_campaign_budget as original
    from timepitch.grf.physical_codec import encode_chunk
    monkeypatch.setattr(original,'PROJECT_ROOT',tmp_path)
    parent,root,campaign=setup_campaign(tmp_path)
    base_dll=tmp_path/'.local/grf-actions-pressure-native/Release/python310.dll'
    base_dll.parent.mkdir(parents=True);base_dll.write_bytes(b'fixture dependency')
    campaign['native_dirs']={'actions':base_dll.parent.relative_to(tmp_path).as_posix()}
    campaign['baseline_files']={base_dll.relative_to(tmp_path).as_posix():sha(base_dll)}
    original.initialize_continuation(parent,campaign,root,approved=True)
    capture=root/'evidence/T-actions/match';capture.mkdir(parents=True)
    m,blocks=action_trace(events=events(),semantics=[])
    manifest=m.model_dump(mode='json');manifest['input']['input_hash']=H
    manifest['input']['config']['seed']=42;manifest['native_binary_sha256']=N
    write(capture/'manifest.json',manifest)
    (capture/'0.zlib').write_bytes(encode_chunk(blocks[0]))
    files={p.name:sha(p) for p in capture.iterdir()}
    for id in original.TECHNICAL:
        original.reserve_run(root,spec(original,id))
        original.finish_run(root,id,state='ready' if id=='T-actions' else 'failed',
            evidence=dict(result_path='evidence/T-actions/match',files=files) if id=='T-actions' else {})
    write(tmp_path/(STUDY+'/campaign.json'),campaign)
    module=api();descriptor=module.make_defensive_probe_descriptor(root)
    write(tmp_path/(STUDY+'/defensive-probe.json'),descriptor)
    extension=root.parent/'defensive-probe'
    return module,original,root,extension,descriptor


def build(tmp_path):
    binary=tmp_path/'.local/grf-defense-native/Release/_gameplayfootball.pyd'
    binary.parent.mkdir(parents=True);binary.write_bytes(b'fake compiled observation-only artifact, not executable')
    dll=binary.with_name('python310.dll');dll.write_bytes(b'fixture dependency')
    write(tmp_path/BUILD,dict(native_binary_sha256=sha(binary),previous_native_binary_sha256=N,
        binary_output=binary.parent.relative_to(tmp_path).as_posix(),dependencies={dll.name:sha(dll)},
        build=dict(exit_code=0)))
    return sha(binary)


def reserve(m,extension,tmp_path):return m.reserve_defensive_probe(extension,input_hash=H,native_sha256=build(tmp_path))


def ready(m,extension):
    capture=extension/'evidence/D-defense-42';capture.mkdir(parents=True)
    for name in ('manifest.json','defense.jsonl','report.json'):(capture/name).write_bytes(b'accepted research fixture')
    evidence=dict(result_path='evidence/D-defense-42',files={p.name:sha(p) for p in capture.iterdir()})
    m.finish_defensive_probe(extension,state='ready',evidence=evidence)
    return capture


def test_one_extension_only_and_same_ready_bytes_reused(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch)
    old=[p.read_bytes() for p in (root/'checkpoint.json',root.parent/'continuation-registration.json')]
    m.initialize_defensive_probe(d,extension,approved=True)
    assert m.cumulative_usage(root)==dict(original_used=28,extension_used=0,used=28,maximum=71,candidates=3)
    pin=build(tmp_path);first=m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    assert first['reused'] is False and first['id']=='D-defense-42'
    assert m.cumulative_usage(root)['used']==29
    capture=ready(m,extension)
    reused=m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    assert reused['reused'] and Path(reused['result_path'])==capture
    m.initialize_defensive_probe(d,extension,approved=True)
    assert m.cumulative_usage(root)['used']==29
    assert old==[p.read_bytes() for p in (root/'checkpoint.json',root.parent/'continuation-registration.json')]
    (capture/'defense.jsonl').write_bytes(b'altered')
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)


@pytest.mark.parametrize('terminal',[None,'failed','cancelled'])
def test_failure_or_interrupted_reservation_consumes_probe(tmp_path,monkeypatch,terminal):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,extension,approved=True)
    pin=build(tmp_path);m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    if terminal:m.finish_defensive_probe(extension,state=terminal,evidence={'reason':'fixture'})
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))
    assert m.cumulative_usage(root)['used']==29


@pytest.mark.parametrize('target',['checkpoint','registration','descriptor'])
def test_missing_or_altered_anchor_fails_closed(tmp_path,monkeypatch,target):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,extension,approved=True)
    path={'checkpoint':extension/'checkpoint.json','registration':extension.parent/'defensive-probe-registration.json',
        'descriptor':tmp_path/(STUDY+'/defensive-probe.json')}[target]
    old=path.read_bytes();path.unlink()
    with pytest.raises(ValueError):m.initialize_defensive_probe(d,extension,approved=True)
    with pytest.raises(ValueError):m.cumulative_usage(root)
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))
    changed=json.loads(old)
    if target=='registration':changed['identity']='0'*64
    elif target=='descriptor':changed['maximum']=72
    else:changed['run']={'state':'failed'}
    write(path,changed)
    with pytest.raises(ValueError):m.cumulative_usage(root)


def test_other_root_and_two_writers_cannot_reserve_twice(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch)
    with pytest.raises(ValueError):m.initialize_defensive_probe(d,extension.with_name('another'),approved=True)
    m.initialize_defensive_probe(d,extension,approved=True);pin=build(tmp_path);barrier=threading.Barrier(2)
    def writer():
        barrier.wait()
        try:m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin);return 'reserved'
        except ValueError:return 'consumed'
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:writer(),range(2)))
    assert sorted(results)==['consumed','reserved'] and m.cumulative_usage(root)['used']==29


def test_incident_windows_use_actual_acceptance_not_sanction_or_sample(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch)
    windows=m.pin_defensive_windows(events())
    assert [(w['event_seq'],w['start_ms'],w['end_ms']) for w in windows]==[
        (1122,771770,781770),(1537,1162860,1164960),(5489,4123450,4133450)]
    bad=events();bad[2]['actual_time_ms']=1164870
    with pytest.raises(ValueError):m.pin_defensive_windows(bad)
    with pytest.raises(ValueError):m.pin_defensive_windows(events()[:-1])


def test_approval_identity_windows_and_changed_control_fail_before_reservation(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch)
    with pytest.raises(ValueError):m.initialize_defensive_probe(d,extension,approved=False)
    wrong=copy.deepcopy(d);wrong['maximum']=72
    with pytest.raises(ValueError):m.initialize_defensive_probe(wrong,extension,approved=True)
    m.initialize_defensive_probe(d,extension,approved=True)
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=N)
    assert m.cumulative_usage(root)['used']==28
    pin=build(tmp_path)
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash='c'*64,native_sha256=pin)
    control=root/'evidence/T-actions/match/0.zlib';control.write_bytes(b'changed')
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)


def test_build_binary_dependency_and_pin_checked_before_consumption(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,extension,approved=True)
    pin=build(tmp_path)
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=N)
    dll=tmp_path/'.local/grf-defense-native/Release/python310.dll';dll.write_bytes(b'changed')
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    assert m.cumulative_usage(root)['used']==28


def test_crash_between_extension_files_cannot_reset_budget(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,extension,approved=True)
    pin=build(tmp_path);original=b.os.replace
    def fail(source,destination):
        if Path(destination).name=='defensive-probe-registration.json':raise OSError('interrupted durable update')
        original(source,destination)
    monkeypatch.setattr(b.os,'replace',fail)
    with pytest.raises(OSError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    monkeypatch.setattr(b.os,'replace',original)
    assert json.loads((extension/'checkpoint.json').read_bytes())['run']['state']=='reserved'
    with pytest.raises(ValueError):m.initialize_defensive_probe(d,extension,approved=True)
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)


def test_original_future_ids_reach_71_with_probe_and_five_candidates_only(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,extension,approved=True)
    reserve(m,extension,tmp_path);ready(m,extension)
    ids=[f'c{c}/calibration/{i:02}' for c in (4,5) for i in range(1,9)]
    ids += [f'selected/heldout/{i:02}' for i in range(1,25)]+['R-selected','W-local']
    for id in ids:b.reserve_run(root,spec(b,id))
    assert m.cumulative_usage(root)==dict(original_used=70,extension_used=1,used=71,maximum=71,candidates=5)
    for id in ('D-defense-42','c1/calibration/01','c6/calibration/01','selected/heldout/25','T-reroll'):
        with pytest.raises(ValueError):b.reserve_run(root,spec(b,id))
    # Ready technical evidence can be reused; this does not launch a child or use an ID.
    assert b.reserve_run(root,spec(b,'T-actions')).reused


def test_original_reservations_require_registered_extension_when_descriptor_exists(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch)
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))
    assert len(json.loads((root/'checkpoint.json').read_bytes())['runs'])==4


def test_losing_both_extension_files_cannot_reinitialize(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,extension,approved=True)
    pin=build(tmp_path);m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    (extension/'checkpoint.json').unlink();extension.rmdir()
    (extension.parent/'defensive-probe-registration.json').unlink()
    with pytest.raises(ValueError):m.initialize_defensive_probe(d,extension,approved=True)
    with pytest.raises(ValueError):b.reserve_run(root,spec(b,'c4/calibration/01'))


def test_build_cannot_introduce_unpinned_dependency(tmp_path,monkeypatch):
    m,b,root,extension,d=fixture(tmp_path,monkeypatch);m.initialize_defensive_probe(d,extension,approved=True)
    pin=build(tmp_path);path=tmp_path/BUILD;manifest=json.loads(path.read_bytes())
    dll=tmp_path/'.local/grf-defense-native/Release/new.dll';dll.write_bytes(b'unapproved dependency')
    manifest['dependencies'][dll.name]=sha(dll);write(path,manifest)
    with pytest.raises(ValueError):m.reserve_defensive_probe(extension,input_hash=H,native_sha256=pin)
    assert m.cumulative_usage(root)['used']==28
