import pytest
from grf_fixtures import replay_fixture,full_replay
from grf_statistics_fixtures import statistics_replay,native_event
from timepitch.grf.codec import encode_grf,parse_grf,grf_hash
from timepitch.grf.native_telemetry import normalize_events


def test_v3_roundtrip_and_legacy_bytes():
    record=statistics_replay([native_event()])
    assert parse_grf(encode_grf(record))==record
    for old in (replay_fixture(),full_replay()):
        raw=encode_grf(old);assert encode_grf(parse_grf(raw))==raw


@pytest.mark.parametrize('change',[
    lambda r:setattr(r.telemetry.events[0],'player',11),
    lambda r:setattr(r.telemetry.events[0],'seq',1),
    lambda r:setattr(r.telemetry,'emitted_count',2),
    lambda r:setattr(r.telemetry.events[0],'actual_time_ms',999999),
    lambda r:setattr(r.telemetry.events[0],'match_time_ms',999999),
    lambda r:setattr(r.telemetry.events[0],'phase',2),
    lambda r:setattr(r.telemetry.events[0],'score',(1,0)),
    lambda r:setattr(r.telemetry.events[0],'ball_xyz',(float('nan'),0,.1)),
    lambda r:setattr(r.telemetry,'overflowed',True),
])
def test_v3_invalid_native_evidence_is_rejected(change):
    record=statistics_replay([native_event()]);change(record)
    with pytest.raises(ValueError):
        record.trace_hash=grf_hash(record);parse_grf(encode_grf(record))


def test_two_events_in_same_tick_are_valid_and_duplicate_sequence_is_not():
    record=statistics_replay([native_event(),native_event(seq=1,kind='trap',player=8,action_id=2)])
    assert parse_grf(encode_grf(record))==record
    record.telemetry.events[1].seq=0;record.trace_hash=grf_hash(record)
    with pytest.raises(ValueError):parse_grf(encode_grf(record))


def test_normalized_coordinates_match_observation_frame():
    raw=native_event();raw.pop('sample_index');raw.pop('raw_actor_xy');raw.pop('raw_ball_xyz')
    raw.update(actor_xy=[-.5,.1],ball_xyz=[-.49,.1,.2],mirrored=True,ball_mirrored=True)
    normalized=normalize_events({'events':[raw],'overflowed':False,'emitted_count':1},2)[0]
    assert normalized['actor_xy']==[.5,-.1] and normalized['ball_xyz']==[.49,-.1,.2]
    assert normalized['raw_actor_xy']==[-.5,.1] and normalized['sample_index']==2
    with pytest.raises(ValueError):normalize_events({'events':[],'overflowed':True,'emitted_count':20001},2)


def test_mirror_preserves_side_scoped_players():
    record=statistics_replay(mirror=True)
    assert len({p.id for p in record.input.players})==22
    assert parse_grf(encode_grf(record))==record


def test_v3_limits():
    record=statistics_replay([native_event(seq=i) for i in range(20000)])
    raw=record.model_dump(mode='json');raw['telemetry']['events'].append(native_event(seq=20000))
    import json
    with pytest.raises(ValueError):parse_grf(json.dumps(raw).encode())
    with pytest.raises(ValueError):parse_grf(b' '*((16*1024*1024)+1))


def test_unknown_contact_function_is_rejected_before_statistics_can_claim_complete():
    record=statistics_replay([native_event(kind='other',function=99)])
    with pytest.raises(ValueError,match='Unknown native contact function'):
        parse_grf(encode_grf(record))
    known=statistics_replay([native_event(kind='other',function=10)])
    assert parse_grf(encode_grf(known))==known
