"""Fixed research profile admission; no football imports or native attempts."""
import importlib
import importlib.util
import json
from pathlib import Path
import struct
import pytest
from grf_action_fixtures import action_trace
from timepitch.grf.physical_wire import canonical,digest

ROOT=Path(__file__).resolve().parents[2]


def api(name='candidate_profiles'):
    full='timepitch.grf.'+name
    assert importlib.util.find_spec(full), 'Missing verified candidate component: '+name
    return importlib.import_module(full)


def raw_state(**counters):
    state=dict(policy_version='c4-marking-1',**{k:struct.unpack('<f',struct.pack('<f',v))[0]
        for k,v in dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.7).items()},
        marking_eligible=0,marking_raised=0,area_slide_eligible=0,area_slide_rejected=0,invalid_inputs=0)
    return state|counters


def policy_spec():
    return dict(policy_version='c4-marking-1',policy=dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.7))


def test_native_policy_float32_attestation_uses_bits():
    wire=api('candidate_wire');state=raw_state()
    assert state['marking_floor']!=.85
    normalized=wire.normalize_state(state,policy_spec(),initial=True)
    assert normalized['float32_bits']['marking_floor']==1062836634
    state['marking_floor']=struct.unpack('<f',struct.pack('<I',1062836635))[0]
    with pytest.raises(ValueError):wire.normalize_state(state,policy_spec(),initial=True)


@pytest.mark.parametrize('change',[{'marking_raised':1},{'invalid_inputs':1},{'marking_eligible':True},
    {'marking_eligible':-1},{'marking_eligible':2**63},{'area_slide_rejected':1},
    {'policy_version':'unknown'},{'marking_floor':float('nan')}])
def test_start_and_invalid_policy_counters_are_rejected(change):
    with pytest.raises(ValueError):api('candidate_wire').normalize_state(raw_state(**change),policy_spec(),initial=True)


def test_policy_file_caps_identity_trace_and_monotonic_counters(tmp_path,monkeypatch):
    wire=api('candidate_wire');spec=policy_spec()
    identity=dict(run_id='c4/calibration/01',input_hash='a'*64,native_sha256='b'*64,
        profile_identity='c'*64,build_manifest_sha256='d'*64)
    path=tmp_path/'policy.json';start=raw_state();end=raw_state(marking_eligible=5,marking_raised=2)
    wire.write_policy(path,identity,spec,start,end,'e'*64)
    expected=wire.read_policy(path,identity,spec,'e'*64)
    assert expected['final']['counters']['marking_raised']==2
    before=path.read_bytes()
    original=wire.canonical
    monkeypatch.setattr(wire,'canonical',lambda value:original(value)+b' '*8193)
    with pytest.raises(ValueError):wire.write_policy(path,identity,spec,start,end,'e'*64)
    assert path.read_bytes()==before and not path.with_suffix('.tmp').exists()
    monkeypatch.setattr(wire,'canonical',original)
    with pytest.raises(ValueError):wire.write_policy(path,identity|{'extra':'x'*8193},spec,start,end,'e'*64)
    assert path.read_bytes()==before and not path.with_suffix('.tmp').exists()
    for value in [end|{'invalid_inputs':1},end|{'marking_raised':6},end|{'area_slide_rejected':1}]:
        with pytest.raises(ValueError):wire.write_policy(path,identity,spec,start,value,'e'*64)
    with pytest.raises(ValueError):wire.read_policy(path,identity,spec,'f'*64)
    data=json.loads(before);data['final']['counters']['marking_raised']=10;path.write_bytes(canonical(data))
    with pytest.raises(ValueError):wire.read_policy(path,identity,spec,'e'*64)
    path.write_bytes(b' '*8193)
    with pytest.raises(ValueError):wire.read_policy(path,identity,spec,'e'*64)
    path.unlink()
    with pytest.raises(ValueError):wire.read_policy(path,identity,spec,'e'*64)


def test_rehydrated_payload_has_identical_66_ordered_readbacks():
    wire=api('candidate_wire');m,_=action_trace();initial=m.input.model_dump(mode='json')
    loaded=json.loads(canonical(initial));left=wire.normalize_payload(initial);right=wire.normalize_payload(loaded)
    def reads(payload):return [(p['side'],p['slot'],k,v) for p in payload['players'] for k,v in p['attributes'].items()]
    assert len(reads(left))==66 and reads(left)==reads(right)
    assert left['input_hash']==right['input_hash']==initial['input_hash']
    for p in left['players']:assert list(p['attributes'])==['physical_velocity','technical_shot','technical_shortpass']


def test_unknown_unregistered_candidate_is_not_admitted():
    module=api()
    for name in ('unknown','../../c4','selected','c5'):
        with pytest.raises(ValueError):module.load_candidate_profile(ROOT,name)


def test_native_c4_artifacts_are_valid_without_core_creation():
    m=api();native=m.read_native_profile(ROOT,'c4')
    assert native['native_sha256']=='c856d3f454da6f959287028df71866a319e510cd2c031a743bb4f991cd95ba5b'
    assert len(native['dependencies'])==14 and native['policy']['marking_floor']==.85


def test_complete_capture_and_manifest_identical_after_canonical_rehydration(monkeypatch):
    from test_grf_action_capture import make_capture,SnapshotAdapter
    from timepitch.grf.action_runner import ActionCapture
    wire=api('candidate_wire');base=make_capture(monkeypatch)
    initial=wire.normalize_payload(base.payload);loaded=wire.normalize_payload(json.loads(canonical(base.payload)))
    left=ActionCapture(base.core,initial,None)
    other=make_capture(monkeypatch);right=ActionCapture(other.core,loaded,None)
    count=0
    from itertools import zip_longest
    for a,b in zip_longest(left,right):
        assert a is not None and b is not None and left.encode(a)==right.encode(b);count+=1
    assert count==55
    a=left.manifest('f'*64);b=right.manifest('f'*64)
    assert a==b and len(a['attribute_readbacks'])==66
