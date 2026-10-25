from timepitch.simulation.metrics import reduce_metrics


def test_empty_trace_is_a_valid_zero_zero_without_fabricated_actions():
    result = reduce_metrics([])
    assert result.home.goals == result.away.goals == 0
    assert result.home.shots == result.away.shots == 0
    assert result.home.possession_ms == result.away.possession_ms == 0


def test_spatial_possession_uses_left_sample_and_does_not_count_reset_duration():
    from timepitch.simulation.metrics import BasicReducer
    from timepitch.simulation.replay_models import MotionSample
    reducer = BasicReducer()
    for time, owner, reset in [(0, 0, 1), (250, 1, 0), (250, 0, 2), (500, 0, 0)]:
        reducer.on_sample(MotionSample((time, 1, 0, 0, owner, -1, 1, reset, 0, 0, [0]*44)))
    assert reducer.metrics.home.possession_ms == 500
    assert reducer.metrics.away.possession_ms == 0
    assert reducer.metrics.home.shots == reducer.metrics.away.shots == 0
