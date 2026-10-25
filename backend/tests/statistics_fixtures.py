"""Small reducer inputs, deliberately not full physically validated match traces."""
from timepitch.simulation.replay_models import EventView, ResolvedEvent
from timepitch.simulation.replay_models import MotionSample
from test_replay_versions import small_v2
from functools import lru_cache


@lru_cache(maxsize=1)
def _template():
    value = small_v2().initial_frame.model_copy(deep=True)
    value.ball.x, value.ball.y = 5, 34
    return value


def frame(): return _template().model_copy(deep=True)


def motion(clock, xy=None, reset=0, possession=0, period=1):
    xy=xy if xy is not None else [round(c*1000) for p in frame().players for c in (p.x,p.y)]
    return MotionSample((clock,period,0,0,possession,-1,1,reset,52500,34000,xy))


def action(id, kind='pass', side='home', start=0, end=1000, origin=(20000, 34000),
           destination=(50000, 34000), participants=None, outcome='complete', seq=0, related=None, **evidence):
    initial = frame()
    people = [p.key for p in initial.players if p.side == side]
    participants = participants if participants is not None else people[5:7]
    return EventView(id=id, type=kind, side=side, participants=participants,
        outcome=outcome, t0_ms=start, t1_ms=end, released_ms=start, period=1,
        origin_mm=origin, end_mm=destination, possession_id=0, sequence_id=seq,
        related_event_ids=related or [], origin_sample_index=0, sample_index=0,
        context_available=True, evidence={'possession_side': side or 'away', **evidence})


def event_fixture():
    record = small_v2()
    record.initial_frame = frame()
    home = [p.key for p in record.initial_frame.players if p.side == 'home']
    away = [p.key for p in record.initial_frame.players if p.side == 'away']
    events = [
        action('p1', participants=home[5:7]),
        action('s1', 'shot', start=5000, end=5500, origin=(55000,34000), destination=(105000,34000),
               participants=[home[6]], outcome='goal', simulated_xg=.2),
        action('g1', 'goal', start=5500, end=5500, origin=(105000,34000), destination=(105000,34000),
               participants=[home[6]], outcome='scored', related=['s1'], shot_id='s1'),
        action('s2', 'shot', start=6000, end=6500, origin=(55000,34000), destination=(105000,23000),
               participants=[home[6]], outcome='off_target', seq=1, simulated_xg=.3),
        action('s3', 'shot', 'away', start=10000, end=10500, participants=[away[6]],
               outcome='off_target', seq=2, simulated_xg=.1),
    ]
    record.events = [ResolvedEvent(**e.model_dump(exclude={'context_available'})) for e in events]
    return record
