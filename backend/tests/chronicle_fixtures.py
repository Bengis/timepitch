"""Hand-built replay data; neither simulator nor a model is executed."""
from grf_statistics_fixtures import statistics_replay, native_event
from timepitch.grf.statistics import build_grf_statistics
from timepitch.simulation.models import MatchRecord, RenderFrame, PlayerFrame, Point, Score, MatchEvent, MatchMetrics
from functools import lru_cache


@lru_cache(maxsize=1)
def _grf_base():
    record = statistics_replay([native_event(type='goal', kind='goal', score=[1, 0])])
    record.samples[-1].score = (1, 0)
    record.trace_hash = 'a' * 64
    return record, build_grf_statistics(record)


def grf_pair():
    record, summary = _grf_base()
    return record.model_copy(deep=True), summary.model_copy(deep=True)


def canonical():
    grf, _ = grf_pair()
    players = [PlayerFrame(key=p.id, name=p.name, role=p.role, side=p.side, x=30, y=34) for p in grf.input.players]
    frame = RenderFrame(players=players, ball=Point(x=30, y=34), carrier=None, possession='home', clock_ms=0, period=1, score=Score())
    events = [MatchEvent(id='goal-one', t0_ms=1000, t1_ms=1000, type='goal', side='home', participants=[players[9].key], outcome='scored', evidence={}, frame_after=frame),
              MatchEvent(id='end', t0_ms=5400000, t1_ms=5400000, type='fulltime', side=None, participants=[], outcome='end', evidence={}, frame_after=frame.model_copy(update={'score': Score(home=1)}))]
    return MatchRecord(config=grf.input.config, seed=42, dataset_version=grf.input.dataset_version, home_name=grf.input.home_name, away_name=grf.input.away_name,
                       initial_frame=frame, events=events, metrics=MatchMetrics(), trace_hash='b' * 64)


@lru_cache(maxsize=1)
def _pack_base():
    from timepitch.chronicles.facts import from_grf
    return from_grf(*grf_pair())


def pack():
    return _pack_base().model_copy(deep=True)
