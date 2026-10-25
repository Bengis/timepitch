"""Hand-controlled event fixtures, never presented as historical observations."""
from uuid import UUID

from historical_support import fixture, records
from timepitch.historical.import_dataset import fixture_model, normalize_events, normalize_lineups


def event(index, kind, *, period=1, ms=0, team=33, player=None, **details):
    seconds, fraction = divmod(ms, 1000)
    minutes, second = divmod(seconds, 60)
    hour, minute = divmod(minutes, 60)
    row = dict(id=str(UUID(int=index)), index=index, period=period,
               timestamp=f'{hour:02}:{minute:02}:{second:02}.{fraction:03}',
               minute={1:0, 2:45, 3:90, 4:105, 5:120}[period]+minutes,
               second=second, type={'name':kind}, team={'id':team}, **details)
    if player is not None:
        row['player'] = {'id':player}
    return row


def game(extra=(), *, score=None, ends=(2_800_000, 3_038_204), lineup_edit=None):
    raw_lineups, raw_events = records()
    for lineup, start in zip(raw_lineups, (100, 200)):
        lineup['lineup'].extend({'player_id':start+i, 'player_name':f'Bench {start+i}',
                                'positions':[], 'cards':[]} for i in (11, 12))
    if lineup_edit:
        lineup_edit(raw_lineups)
    raw = raw_events[:2]
    for period, end in enumerate(ends, 1):
        raw.extend([event(800+period*10, 'Half Start', period=period),
                    event(801+period*10, 'Half Start', period=period, team=1),
                    event(802+period*10, 'Half End', period=period, ms=end),
                    event(803+period*10, 'Half End', period=period, ms=end, team=1)])
    raw.extend(extra)
    source_match = fixture()
    if score:
        source_match.update(home_score=score['home'], away_score=score['away'])
    match = fixture_model(source_match, 27)
    lineups = normalize_lineups(raw_lineups, match)
    events, issues = normalize_events(raw, match, lineups)
    return match.model_copy(update={'lineups':lineups, 'event_count':len(events),
                                   'status':'partial' if issues else 'facts_ready', 'issues':issues}), events


def point(period, ms):
    from timepitch.historical.models import PeriodPoint
    return PeriodPoint(period=period, period_ms=ms)


def statistics(match, events, period=2, ms=3_038_204):
    from timepitch.historical.statistics import reduce_statistics
    return reduce_statistics(match, events, point(period, ms))
