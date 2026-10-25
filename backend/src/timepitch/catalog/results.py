"""TP213 · Season tables and head-to-head computed only from audited full-time results (pure, no I/O).

Rules (documented in docs/kb): 3 points per win, 1 per draw; order by points, goal difference, goals for.
Teams level on all three share the position (rank = 1 + teams strictly ahead). TP214: official points deductions
(sourced table in `deductions.py`) are subtracted before ordering; the raw points by results are kept alongside.
With them, all 686 club-seasons match the official final position (Wikipedia final tables, tests).
"""
from collections.abc import Iterable, Mapping
from typing import Literal

from .deductions import PointsDeduction
from .models import CatalogModel


class MatchResult(CatalogModel):
    season_start: int
    date: str
    home: str
    away: str
    home_goals: int
    away_goals: int
    source: str


class TableRow(CatalogModel):
    club: str
    played: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    points: int
    raw_points: int
    points_deducted: int
    position: int
    position_shared: bool


class TeamSeasonRecord(CatalogModel):
    key: str
    club: str
    season_start: int
    season_label: str
    played: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    goal_difference: int
    points: int
    raw_points: int
    deduction: PointsDeduction | None
    position: int
    position_shared: bool
    teams: int
    results_sources: list[str]
    points_rule: Literal['win3_draw1'] = 'win3_draw1'
    point_deductions: Literal['applied'] = 'applied'
    deductions_version: str
    dataset_version: str


class HeadToHeadCounts(CatalogModel):
    """Pure result; the repository adds sources, seasons covered and dataset version."""
    club_a: str
    club_b: str
    played: int
    wins_a: int
    draws: int
    wins_b: int
    goals_a: int
    goals_b: int
    first_season: int | None
    last_season: int | None
    biggest_win_a: MatchResult | None
    biggest_win_b: MatchResult | None
    last_meeting: MatchResult | None


class HeadToHead(HeadToHeadCounts):
    results_sources: list[str]
    seasons_covered: list[int]
    dataset_version: str


def league_table(results: Iterable[MatchResult], deductions: Mapping[str, int] | None = None) -> list[TableRow]:
    """`deductions`: club -> points removed (positive). Ordering uses the points after the deduction."""
    deductions = deductions or {}
    acc: dict[str, list[int]] = {}  # played, wins, draws, losses, gf, ga

    def add(club: str, gf: int, ga: int):
        row = acc.setdefault(club, [0, 0, 0, 0, 0, 0])
        row[0] += 1
        row[1 if gf > ga else 2 if gf == ga else 3] += 1
        row[4] += gf
        row[5] += ga

    for m in results:
        add(m.home, m.home_goals, m.away_goals)
        add(m.away, m.away_goals, m.home_goals)
    if unknown := set(deductions) - set(acc):
        raise ValueError(f'Deduction for a club without results: {sorted(unknown)}')
    keys = {club: (3 * v[1] + v[2] - deductions.get(club, 0), v[4] - v[5], v[4]) for club, v in acc.items()}
    rows = []
    for club, v in acc.items():
        ahead = sum(1 for other in keys.values() if other > keys[club])
        level = sum(1 for other in keys.values() if other == keys[club])
        rows.append(TableRow(club=club, played=v[0], wins=v[1], draws=v[2], losses=v[3], goals_for=v[4],
                             goals_against=v[5], points=keys[club][0], raw_points=3 * v[1] + v[2],
                             points_deducted=deductions.get(club, 0), position=ahead + 1, position_shared=level > 1))
    rows.sort(key=lambda row: (row.position, row.club))
    return rows


def _win_key(m: MatchResult) -> tuple[int, int, str]:
    """Biggest win: widest margin, then more goals by the winner, then the most recent date."""
    return (abs(m.home_goals - m.away_goals), max(m.home_goals, m.away_goals), m.date)


def head_to_head(results: Iterable[MatchResult], club_a: str, club_b: str) -> HeadToHeadCounts:
    meetings = [m for m in results if {m.home, m.away} == {club_a, club_b} and club_a != club_b]
    wins_a = wins_b = draws = goals_a = goals_b = 0
    best_a = best_b = None
    for m in meetings:
        ga, gb = (m.home_goals, m.away_goals) if m.home == club_a else (m.away_goals, m.home_goals)
        goals_a += ga
        goals_b += gb
        if ga > gb:
            wins_a += 1
            best_a = m if best_a is None or _win_key(m) > _win_key(best_a) else best_a
        elif gb > ga:
            wins_b += 1
            best_b = m if best_b is None or _win_key(m) > _win_key(best_b) else best_b
        else:
            draws += 1
    seasons = sorted({m.season_start for m in meetings})
    last = max(meetings, key=lambda m: m.date) if meetings else None
    return HeadToHeadCounts(club_a=club_a, club_b=club_b, played=len(meetings), wins_a=wins_a, draws=draws, wins_b=wins_b,
                goals_a=goals_a, goals_b=goals_b, first_season=seasons[0] if seasons else None,
                last_season=seasons[-1] if seasons else None, biggest_win_a=best_a, biggest_win_b=best_b,
                last_meeting=last)
