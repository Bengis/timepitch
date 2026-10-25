"""Synthetic clock/event cases; not a claim of calibrated professional possession."""
import pytest
from grf_statistics_fixtures import statistics_replay,native_event
from grf_fixtures import full_replay,replay_fixture
from timepitch.grf.statistics import build_grf_statistics
from timepitch.grf.telemetry_models import GrfNativeEvent


def observed(owners,events=()):
    record=statistics_replay()
    last=record.samples[-1]
    record.samples=record.samples[:len(owners)]+[last]
    record.halftime_sample_index=len(owners)
    for sample,owner in zip(record.samples,owners):
        sample.owner_team=owner;sample.owner_slot=9 if owner>=0 else -1
    record.telemetry.events=[GrfNativeEvent.model_validate(
        native_event(seq=i,sample_index=(time-1900+99)//100,actual_time_ms=time,**fields)) for i,(time,fields) in enumerate(events)]
    return record


def metric(summary,side):return summary.by_team[side]['team_possession_pct']


def test_pass_flight_stays_with_team_until_rival_control_at_exact_event_time():
    record=observed([0,-1,-1,-1,1,1],[(1950,{}),(2250,{'kind':'trap','team':1,'actor_team':1,'player':8})])
    summary=build_grf_statistics(record)
    assert metric(summary,'home').numerator==350
    assert metric(summary,'away').numerator==150
    assert metric(summary,'home').value==70 and metric(summary,'away').value==30
    assert metric(summary,'home').denominator==500
    assert summary.by_team['home']['possession_pct'].value==20
    assert summary.coverage.free_ball_pct==60


@pytest.mark.parametrize('event',[
    {'kind':'deflect','touch_type':2},
    {'kind':'shot'},
    {'type':'decision','kind':'free_kick','stage':'prepared'},
    {'type':'goal','kind':'goal'},
])
def test_disputes_shots_and_stoppages_end_pass_inference_without_assigning_free_ball(event):
    summary=build_grf_statistics(observed([0,-1,-1,-1,1,1],[(1950,{}),(2150,event)]))
    assert metric(summary,'home').numerator==250
    assert metric(summary,'away').numerator==100
    assert metric(summary,'home').denominator==350
    assert sum(metric(summary,s).value for s in ('home','away'))==pytest.approx(100)
    assert summary.coverage.eligible_ms==500


@pytest.mark.parametrize('boundary',['restart','phase','jump'])
def test_pass_cannot_bridge_excluded_intervals(boundary):
    record=observed([0,-1,-1,-1,1,1],[(1950,{})])
    if boundary=='restart':record.samples[2].set_piece=True
    elif boundary=='jump':record.samples[2].ball_xyz=(.8,0,.1)
    else:
        for sample in record.samples[2:]:sample.phase=2
        record.halftime_sample_index=2
    summary=build_grf_statistics(record)
    assert metric(summary,'home').numerator==100
    assert metric(summary,'away').numerator==100


def test_unresolved_pass_expires_and_duplicate_animation_does_not_extend_it():
    record=observed([0]+[-1]*103+[1,1],[(1950,{'action_id':7}),(10950,{'action_id':7})])
    summary=build_grf_statistics(record)
    assert metric(summary,'home').numerator==10050
    assert metric(summary,'away').numerator==100
    assert metric(summary,'home').denominator==10150


def test_repeated_animation_contact_cuts_a_rival_flight_without_starting_a_new_pass():
    record=observed([0,-1,-1,-1,-1,1],[(1950,{'action_id':7}),
        (2150,{'team':1,'actor_team':1,'player':8,'action_id':8}),(2250,{'action_id':7})])
    summary=build_grf_statistics(record)
    assert metric(summary,'home').numerator==250
    assert metric(summary,'away').numerator==100
    assert metric(summary,'home').denominator==350


@pytest.mark.parametrize('receiver',[8,9])
def test_sampled_receipt_ends_flight_even_without_a_new_contact_event(receiver):
    record=observed([0,-1,0,-1,-1,1],[(1950,{})])
    record.samples[2].owner_slot=receiver
    summary=build_grf_statistics(record)
    assert metric(summary,'home').numerator==300
    assert metric(summary,'home').denominator==300


def test_advantage_does_not_interrupt_a_pass_and_unowned_play_remains_unknown():
    record=observed([0,-1,-1,-1,1,1],[(1950,{}),(2150,{'type':'decision','kind':'foul','stage':'advantage_played'})])
    assert metric(build_grf_statistics(record),'home').numerator==400
    record=observed([-1]*6)
    assert metric(build_grf_statistics(record),'home').value is None


def test_legacy_replays_do_not_invent_team_pass_possession():
    for record in (full_replay(),replay_fixture()):
        summary=build_grf_statistics(record)
        assert metric(summary,'home').value is None
        assert metric(summary,'home').reason in ('events_not_recorded','native_clock_not_recorded')
