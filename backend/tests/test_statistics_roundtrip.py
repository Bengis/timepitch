import pytest
from pathlib import Path
from test_replay_versions import legacy_record
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config, simulate_match, simulate_statistics, validate_trace
from timepitch.simulation.replay import encode_replay, parse_replay, trace_hash
from timepitch.statistics.queries import statistics_until

DATASET=Path(__file__).resolve().parents[2]/'research/data-audit/2026-10-16/derived/coverage.sqlite'


@pytest.fixture(scope='module')
def generated():
    catalog=CatalogRepository(DATASET)
    record=simulate_match(make_config(catalog,'arsenal:2003','mancity:2017',42),catalog)
    return record,catalog


def test_fast_stored_and_reimported_statistics_share_one_canonical_reducer(generated):
    record,catalog=generated
    assert record.metrics_version=='metrics-1'
    assert record.statistics==statistics_until(record,5400000)==simulate_statistics(record.config,catalog)
    assert parse_replay(encode_replay(record)).statistics==record.statistics
    assert len(encode_replay(record))<=16*1024*1024
    assert validate_trace(record,catalog)==[]
    cut=statistics_until(record,1800349)
    assert cut.end_ms==1800250
    assert all(p.time_ms<=cut.end_ms for points in cut.plots.values() for p in points)
    assert all(e.t1_ms<=cut.end_ms for e in record.events if e.id in cut.by_team['home']['simulated_xg'].event_ids)


@pytest.mark.parametrize('tamper',['value','plot','evidence','new_metric','other_player'])
def test_rehashed_statistics_are_recalculated_instead_of_trusted(generated,tamper):
    record,catalog=generated
    forged=record.model_copy(deep=True)
    if tamper=='value': forged.statistics.by_team['home']['distance_m'].value+=1000
    elif tamper=='plot': forged.statistics.plots['shots'][0].x+=10
    elif tamper=='evidence': forged.statistics.by_team['home']['simulated_xg'].event_ids=['not-a-real-event']
    elif tamper=='new_metric': forged.statistics.by_team['home']['invented_metric']=forged.statistics.by_team['home']['distance_m']
    else: forged.statistics.plots['shots'][0].player_key=record.initial_frame.players[-1].key
    forged.trace_hash=trace_hash(forged)
    assert 'statistics_mismatch' in {v.code for v in validate_trace(forged,catalog)}


def test_old_replay_keeps_available_event_counts_without_fabricating_physical_or_context_data():
    original=legacy_record()
    stats=statistics_until(original,5400000)
    distance=stats.by_team['home']['distance_m']
    assert distance.value is None and distance.reason=='legacy_no_motion'
    tilt=stats.by_team['home']['field_tilt_tp']
    assert tilt.value is None and tilt.reason=='legacy_no_context'
    assert len(stats.plots['xg'])==sum(e.type=='shot' for e in original.events)


def test_partial_query_counts_only_resolved_physical_intervals():
    from test_replay_versions import small_v2
    from statistics_fixtures import motion
    record=small_v2()
    samples=[]
    for i in range(5):
        xy=list(motion(0).player_xy_mm)
        xy[:2]=[1000+i*1750,34000]
        samples.append(motion(i*250,xy))
    record.motion=samples
    key=record.initial_frame.players[0].key
    assert statistics_until(record,749).by_player[key]['distance_m'].value==3.5
    assert statistics_until(record,1000).by_player[key]['distance_m'].value==7


def test_previous_basic_v2_keeps_its_original_hash_and_remains_importable(generated):
    record,catalog=generated
    previous=record.model_copy(update={'metrics_version':'basic-2','statistics':None})
    previous.trace_hash=trace_hash(previous)
    assert previous.trace_hash=='1f912a419c757699eb68e481159c58acef6046165f6b719c74ca8c3c2e0e7e95'
    assert validate_trace(previous,catalog)==[]
