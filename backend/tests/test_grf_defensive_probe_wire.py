"""Strict bounded sidecar validation, using synthetic caches only."""
import copy
import importlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from grf_defense_fixtures import records,fields,selection

N='d82ed1bdd4f9a768d08a8c8efc3e0f069b3a16669d465f60fe6eb751cb765f5b'
IDENTITY=dict(input_hash='a'*64,native_sha256=N,descriptor_sha256='b'*64,build_manifest_sha256='c'*64)
WINDOWS=[dict(event_seq=1,event_ms=200,start_ms=90,end_ms=200)]


def api():
    name='timepitch.grf.defensive_probe_wire'
    assert importlib.util.find_spec(name),'Missing bounded defensive sidecar'
    return importlib.import_module(name)


def context(windows=WINDOWS):
    manifest=SimpleNamespace(input=SimpleNamespace(input_hash='a'*64),native_binary_sha256=N,
        trace_hash='d'*64,duration_ms=5400000,periods=[SimpleNamespace(duration_ms=2700000)]*2)
    return manifest,dict(identity=IDENTITY,windows=windows)


def saved(tmp_path):
    m,d=context();path=tmp_path/'defense.jsonl';w=api().DefenseSidecarWriter(path,IDENTITY,WINDOWS)
    w.append(100,1,records());w.append(200,2,records(200));w.finish(m.trace_hash)
    return path,m,d


def test_lossless_unknown_stale_and_rejected_proposal_stay_distinct(tmp_path):
    path,m,d=saved(tmp_path);report=api().validate_defense_sidecar(path,manifest=m,descriptor=d)
    frames=list(api().iter_defense_frames(path))
    assert report['frames']==2 and report['records']==44
    assert frames[0]['records']==records()
    r=frames[0]['records'][0]
    assert r['evaluation_ms']==90 and r['evaluation_ms']<frames[0]['physics_ms']
    assert 'hunt_distance' not in r['fields']['values']
    assert r['slide_proposal']['available'] and not r['slide_attempt']['found'] and not r['slide_selected']['available']
    assert r['slide_proposal']['fields']['values']['mirrored']==1 and not r['current_mirrored']


@pytest.mark.parametrize('change',['outside','duplicate','slot','future','nan','overflow','inactive','selection','proposal'])
def test_invalid_native_cache_fails_before_writing_frame(tmp_path,change):
    w=api().DefenseSidecarWriter(tmp_path/'d',IDENTITY,WINDOWS);rs=records();t=100;i=1
    if change=='outside':t=0
    if change=='duplicate':rs[1]=rs[0]
    if change=='slot':rs[0]['slot']=11
    if change=='future':rs[0]['evaluation_ms']=101
    if change=='nan':rs[0]['fields']['values']['mindset']=float('nan')
    if change=='overflow':rs[0]['fields']['overflowed']=True
    if change=='inactive':rs[0]['active']=False
    if change=='selection':rs[0]['slide_selected']=copy.deepcopy(rs[0]['slide_attempt'])
    if change=='proposal':rs[0]['slide_proposal']['physics_ms']=101
    with pytest.raises(ValueError):w.append(t,i,rs)
    w.close()


def test_inactive_and_unevaluated_cache_is_explicit(tmp_path):
    w=api().DefenseSidecarWriter(tmp_path/'d',IDENTITY,WINDOWS);rs=records()
    r=rs[0];r.update(active=False,availability_reason='inactive',evaluation_available=False,evaluation_complete=False,
        evaluation_ms=None,evaluation_sequence=None,fields=fields(),slide_proposal=dict(available=False,physics_ms=None,
        evaluation_sequence=None,fields=fields()),current_position=None,current_movement=None,current_function=None,current_animation=None)
    r['slide_attempt']=selection()
    w.append(100,1,rs);w.close()


def test_trip_queue_without_eliza_keeps_unknown_tactics_and_independent_selection(tmp_path):
    w=api().DefenseSidecarWriter(tmp_path/'d',IDENTITY,WINDOWS);rs=records();r=rs[0]
    r.update(availability_reason='no_evaluation',evaluation_available=False,evaluation_complete=False,evaluation_ms=None,
        evaluation_sequence=None,fields=fields(),slide_proposal=dict(available=False,physics_ms=None,evaluation_sequence=None,fields=fields()))
    r['fields']['values']={'queue_size':2.,'queue_movement_speed':3.}
    r['fields']['vectors']={'queue_movement_direction':[1.,0.,0.]}
    r['slide_attempt']=selection()
    r['last_selected']=dict(available=True,physics_ms=95,function=14,found=True,animation_before=4,animation_after=5,evaluation_sequence=None)
    w.append(100,1,rs);w.close()


def test_sidecar_preserves_negative_zero_and_distinct_selection_identities(tmp_path):
    import struct
    w=api().DefenseSidecarWriter(tmp_path/'d',IDENTITY,WINDOWS);rs=records();r=rs[0]
    r['fields']['values']['marking_bias']=-0.
    r['last_selected']=dict(available=True,physics_ms=92,function=3,found=True,animation_before=4,animation_after=5,evaluation_sequence=2)
    r['slide_selected']=dict(available=True,physics_ms=94,function=13,found=True,animation_before=5,animation_after=6,evaluation_sequence=None)
    w.append(100,1,rs);w.finish('d'*64)
    restored=next(api().iter_defense_frames(tmp_path/'d'))['records'][0]
    assert struct.pack('<d',restored['fields']['values']['marking_bias'])==b'\0\0\0\0\0\0\0\x80'
    assert restored['last_selected']['evaluation_sequence']==2 and restored['slide_selected']['evaluation_sequence'] is None
    assert restored['current_animation']==7 and restored['slide_selected']['animation_after']==6


def test_compressed_expansion_and_incomplete_zlib_fail_closed(tmp_path):
    import base64,zlib
    path,m,d=saved(tmp_path);lines=path.read_bytes().splitlines();frame=json.loads(lines[1])
    for raw in (zlib.compress(b' '*1048577),zlib.compress(b'[]')[:-1],zlib.compress(b'[]')+b'extra'):
        frame['data']=base64.b85encode(raw).decode();lines[1]=json.dumps(frame).encode();path.write_bytes(b'\n'.join(lines)+b'\n')
        with pytest.raises(ValueError):api().validate_defense_sidecar(path,manifest=m,descriptor=d)


@pytest.mark.parametrize('change',['input','native','descriptor','build','windows','trace','missing_final','truncated','reorder','trailing'])
def test_sidecar_identity_and_complete_window_coverage_fail_closed(tmp_path,change):
    path,m,d=saved(tmp_path);lines=path.read_bytes().splitlines()
    if change in ('input','native','descriptor','build'):
        key={'input':'input_hash','native':'native_sha256','descriptor':'descriptor_sha256','build':'build_manifest_sha256'}[change]
        d=copy.deepcopy(d);d['identity'][key]='f'*64
    if change=='windows':d=copy.deepcopy(d);d['windows'][0]['end_ms']=300
    if change=='trace':m.trace_hash='f'*64
    if change=='missing_final':lines=lines[:-1]
    if change=='truncated':del lines[2]
    if change=='reorder':lines[1:3]=reversed(lines[1:3])
    if change=='trailing':lines.append(lines[-1])
    path.write_bytes(b'\n'.join(lines)+b'\n')
    with pytest.raises(ValueError):api().validate_defense_sidecar(path,manifest=m,descriptor=d)


def test_incremental_limit_and_zip_bomb_fail_without_cap_increase(tmp_path,monkeypatch):
    module=api();w=module.DefenseSidecarWriter(tmp_path/'d',IDENTITY,WINDOWS)
    before=(tmp_path/'d').stat().st_size
    monkeypatch.setattr(module,'MAX_SIDECAR',before+20)
    with pytest.raises(ValueError):w.append(100,1,records())
    assert (tmp_path/'d').stat().st_size==before
    monkeypatch.setattr(module,'MAX_SIDECAR',8388608)
    with pytest.raises(ValueError):w.finish('d'*64)
    w.close()


def test_required_window_cannot_lie_beyond_the_complete_match(tmp_path):
    path,m,d=saved(tmp_path);m.duration_ms=100
    with pytest.raises(ValueError):api().validate_defense_sidecar(path,manifest=m,descriptor=d)


def test_fully_populated_all_three_windows_fit_eight_mib_losslessly(tmp_path):
    windows=[dict(event_seq=1122,event_ms=781770,start_ms=771770,end_ms=781770),
        dict(event_seq=1537,event_ms=1164860,start_ms=1162860,end_ms=1164960),
        dict(event_seq=5489,event_ms=4133450,start_ms=4123450,end_ms=4133450)]
    path=tmp_path/'full.jsonl';w=api().DefenseSidecarWriter(path,IDENTITY,windows);count=0
    for window in windows:
        for t in range((window['start_ms']+99)//100*100,window['end_ms']+1,100):
            w.append(t,t//100+int(t>2700000),records(t,full=True,seed=t));count+=1
    w.finish('d'*64);m,d=context(windows)
    report=api().validate_defense_sidecar(path,manifest=m,descriptor=d)
    assert count==221 and report['records']==4862
    assert path.stat().st_size<=8388608
    for frame in api().iter_defense_frames(path):
        assert frame['records']==records(frame['physics_ms'],full=True,seed=frame['physics_ms'])


def test_size_preflight_covers_the_frozen_native_field_inventory():
    """New instrumentation must not silently outgrow the preflight fixture."""
    import re
    from grf_defense_fixtures import VALUES,VECTORS
    patch=Path(__file__).resolve().parents[2]/'research/engine-evaluation/2026-10-17-grf-physical-validation/native-defensive-probe.patch'
    added='\n'.join(line[1:] for line in patch.read_text(encoding='utf-8').splitlines() if line.startswith('+') and not line.startswith('+++'))
    scalars=set(re.findall(r'\.Set\("([a-z_0-9]+)"',added))
    vectors=set(re.findall(r'\.Vector\("([a-z_0-9]+)"',added))
    # The native identity helper writes each prefix's team/slot, including top2.
    for prefix in ('marker_target','designated','team_designated','opponent_designated','marking_opponent','closest_0','closest_1'):
        scalars.update((prefix+'_team',prefix+'_slot'))
    assert set(VALUES)==scalars and set(VECTORS)==vectors
