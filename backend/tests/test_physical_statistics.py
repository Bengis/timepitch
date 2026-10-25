import pytest
from statistics_fixtures import frame, motion
from timepitch.statistics.physical import PhysicalStatistics


def trajectory(points):
    reducer=PhysicalStatistics(frame())
    for clock,x,reset in points:
        xy=list(motion(0).player_xy_mm)
        xy[:2]=[x,34000]
        reducer.on_sample(motion(clock,xy,reset))
    return reducer.result(points[-1][0]).by_player[frame().players[0].key]


def test_sprint_is_one_sustained_episode_and_distance_uses_motion_not_render_frames():
    result=trajectory([(i*250,1000+i*1750,0) for i in range(5)])
    assert result['distance_m'].value == 7
    assert result['sprint_count'].value == 1
    assert result['sprint_duration_s'].value == 1
    assert result['sprint_distance_m'].value == 7
    assert result['max_speed_kmh'].value == pytest.approx(25.2)
    assert trajectory([(i*250,1000+i*1750,0) for i in range(4)])['sprint_count'].value == 0


def test_hsr_and_sprint_bands_do_not_overlap_and_resets_do_not_add_distance():
    result=trajectory([(i*250,1000+i*1500,0) for i in range(5)]+[(1000,47000,3),(1250,48500,0)])
    assert result['distance_m'].value == 7.5
    assert result['hsr_distance_m'].value == 7.5
    assert result['sprint_distance_m'].value == 0
    assert result['high_acceleration_count'].value == 0


def test_rates_use_real_exposure_and_not_an_assumed_ninety_minutes():
    points=[]
    for i in range(3601):
        travelled=round(1000000*i/3600)
        cycle=travelled%200000
        x=cycle if cycle<=100000 else 200000-cycle
        points.append((i*250,x,0))
    values=trajectory(points)
    assert values['distance_m'].value == pytest.approx(1000,abs=1e-7)
    assert values['distance_km_per90'].value == 6
    assert values['metres_per_minute'].value == pytest.approx(66.66666667)
    assert values['distance_m'].covered_minutes == 15


@pytest.mark.parametrize('steps,expected',[(4,1),(3,0)])
def test_acceleration_requires_one_second_after_a_known_prior_velocity(steps,expected):
    positions=[1000,1000]
    for i in range(1,steps+1): positions.append(positions[-1]+i*250)
    values=trajectory([(i*250,x,0) for i,x in enumerate(positions)])
    assert values['high_acceleration_count'].value == expected


def test_no_motion_is_unavailable_and_reset_cuts_a_sprint_episode():
    values=trajectory([(0,1000,1)])
    assert values['max_speed_kmh'].value is None
    points=[(0,1000,1),(250,2750,0),(500,4500,0),(750,6250,0),
            (750,46250,3),(1000,48000,0),(1250,49750,0),(1500,51500,0)]
    assert trajectory(points)['sprint_count'].value == 0
