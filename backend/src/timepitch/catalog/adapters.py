"""Map audited aggregates without merging identities or replacing missing data by zero."""
from .models import PlayerSeason, Statistic

EPL_ROLES = {'G': 'GK', 'Goalkeeper': 'GK', 'D': 'DEF', 'Defender': 'DEF',
             'M': 'MID', 'Midfielder': 'MID', 'F': 'FWD', 'Forward': 'FWD'}
FPL_ROLES = {1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD'}
OPTIONAL_STATS = ('starts', 'minutes', 'goals', 'assists', 'assists_fpl', 'saves', 'passes', 'tackles', 'xg', 'xa')


def _stats(source: str) -> dict[str, Statistic]:
    return {name: Statistic(value=None, source=source, status='unavailable',
                            unit='minutes' if name == 'minutes' else 'count') for name in OPTIONAL_STATS}


def _measured(value, source: str, *, estimated=False, minutes=False) -> Statistic:
    return Statistic(value=value, source=source,
                     status='unavailable' if value is None else ('estimated' if estimated else 'measured'),
                     unit='minutes' if minutes else 'count')


def adapt_epl_player(row: dict) -> PlayerSeason | None:
    if row['player_id'] == 'OWNGOAL' or not row.get('appearances', 0):
        return None
    source = 'epldata'
    role = EPL_ROLES.get(row['position'])
    flags = [] if role else ['unknown_role']
    if row['goal_event_games_needing_review']:
        flags.append('goal_events_need_review')
    stats = _stats(source)
    for name in ('appearances', 'starts', 'goals', 'assists', 'own_goals', 'missed_penalties'):
        stats[name] = _measured(row[name], source)
    stats['minutes'] = _measured(row['minutes_estimated'], source, estimated=True, minutes=True)
    return PlayerSeason(key=f"epldata:{row['season_start']}:{row['club']}:{row['player_id']}",
                        source_id=row['player_id'], name=' '.join(filter(None, (row['first_name'], row['last_name']))),
                        role=role, stats=stats, quality_flags=flags)


def adapt_fpl_player(row: dict) -> PlayerSeason | None:
    if not row.get('appearances', 0) or not row.get('minutes', 0):
        return None
    role = FPL_ROLES.get(row['element_type'])
    flags = [] if role else ['unknown_role']
    if row['quarantined_conflicting_rows_in_season']:
        flags.append('quarantined_rows')
    if (row['season_start'], row['element']) in {(2018, 2), (2024, 123)}:
        flags.append('minutes_snapshot_disagrees')
    stats = _stats('fpl')
    for name in ('appearances', 'minutes', 'goals', 'assists_fpl', 'saves'):
        stats[name] = _measured(row[name], 'fpl', minutes=name == 'minutes')
    return PlayerSeason(key=f"fpl:{row['season_start']}:{row['club']}:{row['element']}",
                        source_id=str(row['element']), name=' '.join(filter(None, (row['first_name'], row['second_name']))),
                        role=role, stats=stats, quality_flags=flags)
