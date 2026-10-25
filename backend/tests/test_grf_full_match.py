"""Full-match clock/phase contract; synthetic data is not native acceptance."""
import pytest
from grf_fixtures import request_fixture,replay_fixture,full_request,full_replay
from timepitch.grf.input import make_full_match_input
from timepitch.grf.models import GrfFullMatchReplay,GrfMatchSample,MATCH_NATIVE_SHA256
from timepitch.grf.codec import encode_grf,parse_grf,grf_hash
from timepitch.catalog.repository import CatalogRepository
from grf_fixtures import DATASET


def test_new_input_and_full_match_keep_native_clock_and_actual_halves():
    request=full_request()
    assert request.settings.game_duration==4200 and request.settings.second_half==1500
    record=full_replay(request)
    assert parse_grf(encode_grf(record),request)==record
    assert record.samples[-1].match_time_ms>90*60*1000
    assert record.samples[-1].engine_step<request.settings.game_duration


@pytest.mark.parametrize('change',[
    lambda r:setattr(r.samples[-1],'match_time_ms',5*60*1000),
    lambda r:setattr(r,'halftime_sample_index',1),
    lambda r:setattr(r.samples[-1],'phase',1),
    lambda r:setattr(r,'steps_left',0),
    lambda r:setattr(r.samples[-1],'ball_xyz',(.9,0,.1)),
    lambda r:setattr(r.samples[-1],'game_mode',6),
])
def test_rehashed_incomplete_or_unsafe_full_match_is_rejected(change):
    record=full_replay();change(record);record.trace_hash=grf_hash(record)
    with pytest.raises(ValueError):parse_grf(encode_grf(record),record.input)


def test_old_experimental_replays_keep_original_bytes_and_hash():
    old=replay_fixture();raw=encode_grf(old)
    assert encode_grf(parse_grf(raw))==raw


def test_native_half_time_can_follow_a_late_restart_without_an_invented_cutoff():
    record=full_replay()
    for sample in record.samples[:1541]:sample.phase=1
    record.halftime_sample_index=1541
    record.trace_hash=grf_hash(record)
    assert parse_grf(encode_grf(record)).halftime_sample_index==1541


def test_reaching_the_96_minute_safety_ceiling_is_not_full_time():
    record=full_replay()
    for index in range(len(record.samples),3202):
        record.samples.append(record.samples[-1].model_copy(update={'index':index,'engine_step':index-1,
            'match_time_ms':(index-1)*1800,'actual_time_ms':1900+index*100}))
    record.duration_ms=(len(record.samples)-1)*100
    record.steps_left=4200-record.samples[-1].engine_step
    record.trace_hash=grf_hash(record)
    with pytest.raises(ValueError):parse_grf(encode_grf(record))
