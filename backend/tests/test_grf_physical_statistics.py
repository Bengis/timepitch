"""Physical effort is measured from samples, never extrapolated."""
from copy import deepcopy
import pytest
from timepitch.grf.physical_statistics import build_physical_statistics
from grf_physical_fixtures import row
from grf_fixtures import request_fixture,DATASET
from timepitch.catalog.repository import CatalogRepository
from timepitch.grf.input import make_physical_input
from timepitch.grf.physical_models import PhysicalManifest,PhysicalChunk,PHYSICAL_NATIVE_SHA256
from timepitch.grf.physical_codec import make_chunk_ref,manifest_hash


def trace(rows,splits=()):
    request=make_physical_input(request_fixture().config,CatalogRepository(DATASET))
    chunks=[];start=0
    for stop in (*splits,len(rows)):
        chunks.append(PhysicalChunk(index=len(chunks),samples=rows[start:stop]));start=stop
    refs=[make_chunk_ref(chunk) for chunk in chunks]
    manifest=PhysicalManifest(input=request,native_binary_sha256=PHYSICAL_NATIVE_SHA256,duration_ms=5400000,
        score=(0,0),periods=[dict(period=i,duration_ms=2700000,allowance_ms=0,announced_minimum_ms=0,effective_ms=0) for i in (1,2)],
        ledger=[],chunks=refs,attribute_readbacks=[dict(side=p.side,slot=p.slot,attribute=k,base=v,effective=v)
            for p in request.players for k,v in p.attributes.items()])
    manifest.trace_hash=manifest_hash(manifest)
    return manifest,chunks


def person(summary,side='home',slot=1):
    return next(p for p in summary.players if p.side==side and p.slot==slot)


def walk_rows(count=501):
    return [row(i,i*100,elapsed=i*100,home_1_x_m=i*.2,home_1_vx_m_s=2,in_play=1,effective_ms=i*100) for i in range(count)]


def test_known_100_metres_in_50_seconds_uses_native_units_and_physical_clock():
    manifest,chunks=trace(walk_rows());summary=build_physical_statistics(manifest,iter(chunks));p=person(summary)
    assert p.distance_m==pytest.approx(100) and p.observed_ms==p.active_ms==50000
    assert p.coverage==1 and p.distance_kind=='observed_complete'
    assert p.maximum_speed_m_s==pytest.approx(2)
    assert p.running_ms==50000 and p.high_speed_ms==0
    assert summary.trace_hash==manifest.trace_hash
    assert p.periods[0].period==1 and p.periods[0].distance_m==pytest.approx(100)


def test_partitioning_does_not_change_effort_or_maximum_speed():
    rows=walk_rows();outputs=[]
    for splits in ((),(250,),(1,100,499)):
        manifest,chunks=trace(rows,splits);outputs.append(person(build_physical_statistics(manifest,iter(chunks))).model_dump())
    assert outputs[0]==outputs[1]==outputs[2]


def test_discontinuity_teleport_is_not_running_and_partial_coverage_is_explicit():
    rows=walk_rows(6);rows[2][7]=1;rows[2][19]=1
    for r in rows[2:]:r[19]=1
    for r in rows[2:]:r[27]=80+(r[0]-2)*.2
    manifest,chunks=trace(rows);p=person(build_physical_statistics(manifest,iter(chunks)))
    assert p.distance_m<1 and p.coverage<.95 and p.distance_kind=='observed_partial'
    assert 'discontinuity' in p.reasons


def test_missing_interval_inactive_player_and_halftime_never_join_positions():
    rows=walk_rows(6);rows[2][31]=0
    manifest,chunks=trace(rows);p=person(build_physical_statistics(manifest,iter(chunks)))
    assert p.distance_m==pytest.approx(.6) and p.observed_ms==300 and p.active_ms==400
    assert p.coverage==.75 and p.distance_kind=='observed_partial'
    assert 'inactive_or_missing' in p.reasons
    rows=[row(0,0,elapsed=0,home_1_x_m=0),row(1,100,elapsed=100,home_1_x_m=.2),
        row(2,100,period=2,elapsed=0,discontinuity=1,home_1_x_m=80),row(3,200,period=2,elapsed=100,home_1_x_m=80.2)]
    manifest,chunks=trace(rows);p=person(build_physical_statistics(manifest,iter(chunks)))
    assert p.distance_m==pytest.approx(.4)


def test_maximum_requires_three_continuous_intervals_and_zero_exposure_is_missing():
    manifest,chunks=trace(walk_rows(3));p=person(build_physical_statistics(manifest,iter(chunks)))
    assert p.maximum_speed_m_s is None
    manifest,chunks=trace(walk_rows(1));p=person(build_physical_statistics(manifest,iter(chunks)))
    assert p.distance_m is None and p.coverage is None and p.distance_kind=='unavailable'


def test_mixed_hash_or_wrong_chunk_sequence_is_rejected():
    manifest,chunks=trace(walk_rows(6),(3,))
    with pytest.raises(ValueError):build_physical_statistics(manifest,reversed(chunks))
    altered=deepcopy(chunks);altered[0].samples[0][27]=1
    with pytest.raises(ValueError):build_physical_statistics(manifest,iter(altered))


def test_contacts_and_pass_edges_use_physical_time_and_survive_chunk_boundaries():
    from grf_statistics_fixtures import native_event
    from timepitch.grf.physical_models import PhysicalEvent
    rows=[row(i,5000000+i*100,period=2,elapsed=2300000+i*100,in_play=1,
              owner_team=0 if i>=2 else -1,owner_slot=10 if i>=2 else -1) for i in range(4)]
    manifest,chunks=trace(rows,(2,))
    chunks[0].events=[PhysicalEvent(**native_event(sample_index=1,actual_time_ms=5000100,phase=2,player=9))]
    manifest.chunks=[make_chunk_ref(c) for c in chunks];manifest.trace_hash=manifest_hash(manifest)
    summary=build_physical_statistics(manifest,iter(chunks))
    action=next(a for a in summary.actions if a.side=='home' and a.period==2)
    assert action.pass_contacts==1
    edge=summary.pass_edges[0]
    assert edge.source_id==manifest.input.players[9].id and edge.target_id==manifest.input.players[10].id
    assert edge.period==2 and edge.count==1
    assert edge.evidence[0].released_physics_ms==5000100 and edge.evidence[0].received_physics_ms==5000200


def test_expired_pass_does_not_bridge_restart_or_unobserved_ball_flight():
    from grf_statistics_fixtures import native_event
    from timepitch.grf.physical_models import PhysicalEvent
    rows=walk_rows(4);rows[2][7]=1
    rows[3][13:15]=[0,10]
    manifest,chunks=trace(rows)
    chunks[0].events=[PhysicalEvent(**native_event(sample_index=1,actual_time_ms=100,player=9))]
    manifest.chunks=[make_chunk_ref(c) for c in chunks];manifest.trace_hash=manifest_hash(manifest)
    assert build_physical_statistics(manifest,iter(chunks)).pass_edges==[]


@pytest.mark.parametrize('team,slot',[(1,5),(0,9)])
def test_touch_during_flight_cancels_pass_before_later_teammate_control(team,slot):
    from grf_statistics_fixtures import native_event
    from timepitch.grf.physical_models import PhysicalEvent
    rows=walk_rows(5);rows[4][13:15]=[0,10]
    manifest,chunks=trace(rows)
    chunks[0].events=[PhysicalEvent(**native_event(seq=0,sample_index=1,actual_time_ms=100,player=9)),
        PhysicalEvent(**native_event(seq=1,sample_index=3,actual_time_ms=300,kind='ball_control',actor_team=team,team=team,player=slot))]
    manifest.chunks=[make_chunk_ref(c) for c in chunks];manifest.trace_hash=manifest_hash(manifest)
    assert build_physical_statistics(manifest,iter(chunks)).pass_edges==[]
