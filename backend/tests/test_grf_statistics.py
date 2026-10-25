from grf_fixtures import replay_fixture,full_replay
from grf_statistics_fixtures import statistics_replay
from timepitch.grf.statistics import build_grf_statistics


def test_statistics_are_reproducible_and_versions_declare_absence():
    record=statistics_replay()
    assert build_grf_statistics(record)==build_grf_statistics(record)
    summary=build_grf_statistics(record)
    assert summary.statistics_version=='grf-statistics-1' and summary.trace_hash==record.trace_hash
    assert summary.by_team['home']['shots'].value==0
    for old in (replay_fixture(),full_replay()):
        legacy=build_grf_statistics(old)
        assert legacy.by_team['home']['shots'].value is None
        assert not legacy.coverage.events_complete
    assert build_grf_statistics(replay_fixture()).full_time_ms is None


def test_mirror_keeps_player_rows_and_graph_nodes_separate():
    summary=build_grf_statistics(statistics_replay(mirror=True))
    assert len(summary.players)==len(summary.by_player)==22
    assert len({p.id for p in summary.players})==22
