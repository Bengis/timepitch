from grf_statistics_fixtures import statistics_replay
from timepitch.grf.statistics import build_grf_statistics


def observed_intervals():
    record=statistics_replay()
    for sample in record.samples:sample.in_play=False
    for sample in record.samples[1:4]:sample.in_play=True
    record.samples[1].owner_team=0;record.samples[1].owner_slot=9
    record.samples[2].owner_team=-1;record.samples[2].owner_slot=-1
    return record


def test_possession_keeps_free_time_and_no_exposure_is_not_zero():
    summary=build_grf_statistics(observed_intervals())
    assert summary.by_team['home']['possession_pct'].value==50
    assert summary.by_team['away']['possession_pct'].value==0
    assert summary.coverage.free_ball_pct==50 and summary.coverage.eligible_ms==200
    record=observed_intervals()
    for s in record.samples:s.in_play=False
    summary=build_grf_statistics(record)
    assert summary.by_team['home']['possession_pct'].value is None


def test_restart_half_time_and_discontinuity_are_censored():
    record=observed_intervals();record.samples[2].set_piece=True
    assert build_grf_statistics(record).coverage.eligible_ms==0
    record=observed_intervals();record.samples[2].home_xy[0]=(.9,.5)
    assert build_grf_statistics(record).coverage.eligible_ms==0
    record=observed_intervals();record.samples[2].phase=record.samples[3].phase=2
    assert build_grf_statistics(record).coverage.eligible_ms==100


def test_geometry_active_masks_outside_bins_and_phases_are_explicit():
    record=observed_intervals()
    for sample in record.samples[1:4]:sample.home_xy[5]=(-1.1,.1)
    summary=build_grf_statistics(record)
    assert summary.coverage.outside_player_ms>0
    assert all(0<=cell.col<12 and 0<=cell.row<8 for cell in summary.occupancy)
    assert summary.by_team['home']['team_length_m'].value>0
    record.samples[2].home_active[5]=False
    result=build_grf_statistics(record)
    assert result.by_team['home']['team_length_m'].value is None
    assert result.coverage.activity_verified
