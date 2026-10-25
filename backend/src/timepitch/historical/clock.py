"""Period-local source clocks and an explicitly chosen display coordinate frame."""
from collections.abc import Sequence

from .models import HistoricalClock, HistoricalEvent, HistoricalMatch, HistoricalPeriod, HistoricalPoint


def build_clock(events: Sequence[HistoricalEvent]) -> HistoricalClock:
    periods, issues, offset = [], [], 0
    numbers = sorted({e.period for e in events})
    for number in numbers:
        rows = [e for e in events if e.period == number]
        starts = sorted((e for e in rows if e.type == 'Half Start'), key=lambda e:e.source_index)
        ends = sorted((e for e in rows if e.type == 'Half End'), key=lambda e:e.source_index)
        start_times, end_times = {e.period_ms for e in starts}, {e.period_ms for e in ends}
        duration = next(iter(end_times)) if len(end_times) == 1 else None
        if not starts:
            issues.append(f'missing_half_start:{number}')
        elif start_times != {0}:
            issues.append(f'conflicting_half_start:{number}')
        if not ends:
            issues.append(f'missing_half_end:{number}')
        elif len(end_times) != 1:
            issues.append(f'conflicting_half_end:{number}')
        after_end=duration is not None and any(e.period_ms > duration for e in rows)
        if after_end:
            issues.append(f'event_after_half_end:{number}')
        if len(end_times) != 1 or duration == 0:
            duration = None
        if number != len(periods)+1:
            issues.append(f'missing_prior_period:{number}')
            offset = None
        periods.append(HistoricalPeriod(period=number, duration_ms=duration,observed_end_ms=max(e.period_ms for e in rows),
            playback_start_ms=offset if duration is not None and start_times=={0} else None,
            start_event_ids=[e.id for e in starts], end_event_ids=[e.id for e in ends]))
        offset = offset+duration if offset is not None and duration is not None and start_times=={0} and not after_end else None
    return HistoricalClock(periods=periods, issues=issues)


def _flipped(match: HistoricalMatch, team_key: str, period: int) -> bool:
    if team_key not in (match.home_team.key, match.away_team.key) or not 1 <= period <= 4:
        raise ValueError('Invalid historical coordinate frame')
    # Display convention, not a claim about which goal the real home team chose.
    return (team_key == match.away_team.key) != (period in (2, 4))


def project_point(match: HistoricalMatch, team_key: str, period: int, point: HistoricalPoint) -> HistoricalPoint:
    return HistoricalPoint(x=105-point.x,y=68-point.y) if _flipped(match,team_key,period) else point


def unproject_point(match: HistoricalMatch, team_key: str, period: int, point: HistoricalPoint) -> list[float]:
    value = project_point(match,team_key,period,point)
    return [value.x*120/105, value.y*80/68]


def orient_event(match: HistoricalMatch, event: HistoricalEvent) -> HistoricalEvent:
    if event.team_key not in (match.home_team.key,match.away_team.key) or event.period == 5:
        return event
    return event.model_copy(update={
        'canonical_location':project_point(match,event.team_key,event.period,event.location) if event.location else None,
        'canonical_end_location':project_point(match,event.team_key,event.period,event.end_location) if event.end_location else None,
        'canonical_frame':'display-home-right-first-half-105x68',
        'coordinate_provenance':'derived_from_events' if event.location or event.end_location else 'unavailable'})
