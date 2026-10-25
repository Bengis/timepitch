import pytest
from statistics_fixtures import frame, motion
from timepitch.statistics.shape import ShapeStatistics


def shape_xy(length=28):
    xy=[]
    for side in ('home','away'):
        players=[p for p in frame().players if p.side==side]
        for index,p in enumerate(players):
            x=0 if p.role=='GK' else 20 if p.role=='DEF' else 20+length/2 if p.role=='MID' else 20+length
            y=14 if index==1 else 54 if index==2 else 34
            xy.extend([round((x if side=='home' else 105-x)*1000),y*1000])
    return xy


def test_shape_excludes_keeper_and_occupancy_aggregates_time_in_twelve_by_eight_cells():
    reducer=ShapeStatistics(frame())
    for i in range(9): reducer.on_sample(motion(i*250,shape_xy()))
    result=reducer.result(2000)
    home=result.by_team['home']
    assert home['team_length_m'].value == 28
    assert home['team_width_m'].value == 40
    assert home['defensive_line_height_m'].value == 20
    assert home['def_mid_gap_m'].value == 14
    assert home['mid_fwd_gap_m'].value == 14
    assert home['team_length_m_in_possession'].value == 28
    assert home['team_length_m_out_of_possession'].value is None
    points=[p for p in result.plots['occupancy_in_possession'] if p.side=='home']
    assert sum(p.value for p in points) == 20
    assert len(points)<=96


def test_time_weighting_phase_and_reset_geometry_are_not_confused_with_a_stable_block():
    reducer=ShapeStatistics(frame())
    for i in range(5): reducer.on_sample(motion(i*250,shape_xy(28),possession=0))
    reducer.on_sample(motion(1000,shape_xy(60),reset=3,possession=1))
    for i in range(5,10): reducer.on_sample(motion(i*250,shape_xy(40),possession=1))
    result=reducer.result(2250)
    # First interval after reset has no stable left-hand geometry, leaving 1s per phase.
    home=result.by_team['home']
    assert home['team_length_m'].value == pytest.approx(34)
    assert home['team_length_m_in_possession'].value == 28
    assert home['team_length_m_out_of_possession'].value == 40
    assert home['team_length_m'].covered_minutes == pytest.approx(2/60)
