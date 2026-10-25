from pathlib import Path
import pytest
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import simulate_match, make_config, validate_trace, compute_trace_hash
from timepitch.simulation.metrics import metrics_until
from timepitch.simulation.replay import sample_frame

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


@pytest.fixture(scope='module')
def catalog():
    return CatalogRepository(DATASET)


def test_same_seed_and_versions_produce_identical_event_trace(catalog):
    config = make_config(catalog, 'arsenal:2003', 'mancity:2017', seed=42)
    first = simulate_match(config, catalog)
    second = simulate_match(config, catalog)
    assert first.trace_hash == second.trace_hash
    assert first.events == second.events
    assert first.events[-1].type == 'fulltime'
    assert first.events[-1].t1_ms == 5_400_000
    assert [e.t1_ms for e in first.events if e.type == 'halftime'] == [2_700_000]
    assert validate_trace(first, catalog) == []
    assert first.metrics == metrics_until(first, 5400000)


def test_mirror_match_uses_distinct_entities_on_each_side(catalog):
    record = simulate_match(make_config(catalog, 'arsenal:2003', 'arsenal:2003', seed=7), catalog)
    assert len({p.key for p in record.initial_frame.players}) == 22
    assert all(p.key.startswith(p.side + ':') for p in record.initial_frame.players)
    assert validate_trace(record, catalog) == []


def test_invalid_eleven_and_role_are_rejected_before_simulating(catalog):
    config = make_config(catalog, 'arsenal:2003', 'mancity:2017', seed=1)
    bad = config.model_copy(update={'home_players': [config.home_players[0]] * 11})
    with pytest.raises(ValueError, match='eleven'):
        simulate_match(bad, catalog)
    bad = config.model_copy(update={'home_formation': '4-3-3'})
    with pytest.raises(ValueError, match='formation'):
        simulate_match(bad, catalog)


def test_goals_derive_from_shots_and_frames_stay_on_pitch(catalog):
    record = simulate_match(make_config(catalog, 'arsenal:2003', 'mancity:2017', seed=2), catalog)
    seen_shots = set()
    for event in record.events:
        frame = sample_frame(record, event.sample_index)
        if event.type == 'shot':
            seen_shots.add(event.id)
        if event.type == 'goal':
            assert event.evidence['shot_id'] in seen_shots
        assert len(frame.players) == 22
        assert 0 <= frame.ball.x <= 105
        assert 0 <= frame.ball.y <= 68
        assert all(0 <= p.x <= 105 and 0 <= p.y <= 68 for p in frame.players)
        if frame.carrier:
            holder = next(p for p in frame.players if p.key == frame.carrier)
            assert holder.side == frame.possession
    assert record.initial_frame.score.home == record.initial_frame.score.away == 0
    assert frame.score.home == record.metrics.home.goals
    assert frame.score.away == record.metrics.away.goals


def test_trace_validation_rejects_tampered_metrics_and_geometry(catalog):
    record = simulate_match(make_config(catalog, 'arsenal:2003', 'mancity:2017', seed=3), catalog)
    record.metrics.home.goals += 1
    assert {'metrics_mismatch', 'hash_mismatch'} <= {v.code for v in validate_trace(record, catalog)}
    record.trace_hash = compute_trace_hash(record)
    assert 'metrics_mismatch' in {v.code for v in validate_trace(record, catalog)}


def test_a_declared_goal_shot_cannot_lose_its_scoring_event(catalog):
    record = simulate_match(make_config(catalog, 'arsenal:2003', 'mancity:2017', seed=3), catalog)
    shot = next(e for e in record.events if e.type == 'shot' and e.outcome != 'goal')
    shot.outcome = 'goal'
    record.metrics = metrics_until(record, 5400000)
    record.trace_hash = compute_trace_hash(record)
    assert 'unresolved_shot' in {v.code for v in validate_trace(record, catalog)}
