"""TP213 · Versus screen: season record and head-to-head from the audited results (real snapshot + pure rules)."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from timepitch.app import create_app
from timepitch.catalog.repository import CatalogRepository
from timepitch.catalog.results import MatchResult, head_to_head, league_table

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


def r(home, away, hg, ag, date='2000-01-01', season=2000):
    return MatchResult(season_start=season, date=date, home=home, away=away, home_goals=hg, away_goals=ag, source='test')


# ---------- pure rules ----------

def test_league_table_uses_three_points_then_goal_difference_then_goals_for():
    rows = league_table([r('a', 'b', 2, 0), r('b', 'c', 1, 1), r('c', 'a', 3, 3), r('b', 'a', 0, 1)])
    by = {row.club: row for row in rows}
    assert (by['a'].played, by['a'].wins, by['a'].draws, by['a'].losses, by['a'].points) == (3, 2, 1, 0, 7)
    assert (by['a'].goals_for, by['a'].goals_against) == (6, 3)
    assert [row.club for row in rows] == ['a', 'c', 'b']
    assert [row.position for row in rows] == [1, 2, 3]


def test_teams_level_on_points_goal_difference_and_goals_share_the_position():
    rows = league_table([r('a', 'b', 1, 1), r('c', 'd', 1, 1)])
    assert {row.position for row in rows} == {1}
    assert all(row.position_shared for row in rows)


def test_head_to_head_counts_both_venues_and_picks_biggest_wins_and_last_meeting():
    results = [
        r('a', 'b', 3, 0, '2001-01-01', 2000), r('b', 'a', 1, 1, '2001-05-01', 2000),
        r('a', 'b', 4, 1, '2002-01-01', 2001), r('b', 'a', 2, 0, '2002-05-01', 2001),
        r('a', 'c', 9, 0, '2002-06-01', 2001),
    ]
    h = head_to_head(results, 'a', 'b')
    assert (h.played, h.wins_a, h.draws, h.wins_b, h.goals_a, h.goals_b) == (4, 2, 1, 1, 8, 4)
    # Same margin (3): more goals scored by the winner wins the tie (4-1 over 3-0).
    assert (h.biggest_win_a.home_goals, h.biggest_win_a.away_goals) == (4, 1)
    assert (h.biggest_win_b.home, h.biggest_win_b.home_goals, h.biggest_win_b.away_goals) == ('b', 2, 0)
    assert h.last_meeting.date == '2002-05-01'
    assert (h.first_season, h.last_season) == (2000, 2001)


def test_head_to_head_without_meetings_is_empty_not_zero_filled():
    h = head_to_head([r('a', 'c', 1, 0)], 'a', 'b')
    assert h.played == 0
    assert h.biggest_win_a is None and h.biggest_win_b is None and h.last_meeting is None
    assert h.first_season is None


# ---------- real snapshot ----------

@pytest.fixture(scope='module')
def catalog():
    return CatalogRepository(DATASET)


@pytest.mark.parametrize('key,record', [
    ('arsenal:2003', (38, 26, 12, 0, 73, 26, 90, 1, 20)),
    ('mancity:2017', (38, 32, 4, 2, 106, 27, 100, 1, 20)),
    ('manunited:1992', (42, 24, 12, 6, 67, 31, 84, 1, 22)),
])
def test_real_season_records_match_the_known_final_tables(catalog, key, record):
    rec = catalog.team_record(key)
    assert (rec.played, rec.wins, rec.draws, rec.losses, rec.goals_for, rec.goals_against,
            rec.points, rec.position, rec.teams) == record
    assert rec.goal_difference == rec.goals_for - rec.goals_against
    assert rec.points_rule == 'win3_draw1'
    assert rec.point_deductions == 'applied'
    assert rec.deduction is None and rec.raw_points == rec.points


def test_season_record_agrees_with_catalogue_totals_for_every_team_season(catalog):
    for team in catalog.list_teams():
        rec = catalog.team_record(team.key)
        assert (rec.played, rec.goals_for, rec.goals_against) == (team.matches, team.goals_for, team.goals_against), team.key
        assert rec.results_sources == team.results_sources


def test_unknown_team_record_raises_key_error(catalog):
    with pytest.raises(KeyError):
        catalog.team_record('arsenal:1900')


def test_north_london_derby_covers_every_complete_season(catalog):
    h = catalog.head_to_head('arsenal', 'tottenham')
    # Both clubs played every Premier League season 1992/93–2025/26: 34 seasons × 2 meetings.
    assert h.played == 68
    assert h.wins_a + h.draws + h.wins_b == 68
    assert (h.first_season, h.last_season) == (1992, 2025)
    assert h.last_meeting.season_start == 2025
    assert h.last_meeting.date >= '2025-11-23'
    # The partial 2026/27 season (outside the catalogue) never counts.
    assert all(m.season_start <= 2025 for m in (h.biggest_win_a, h.biggest_win_b, h.last_meeting) if m)


def test_head_to_head_is_symmetric(catalog):
    ab, ba = catalog.head_to_head('arsenal', 'mancity'), catalog.head_to_head('mancity', 'arsenal')
    assert (ab.played, ab.wins_a, ab.draws, ab.wins_b, ab.goals_a, ab.goals_b) == \
        (ba.played, ba.wins_b, ba.draws, ba.wins_a, ba.goals_b, ba.goals_a)
    assert ab.biggest_win_a == ba.biggest_win_b and ab.last_meeting == ba.last_meeting


# ---------- API ----------

@pytest.fixture(scope='module')
def client(tmp_path_factory):
    # Own runtime dir: the dev API already holds the lock on .local (TP213).
    with TestClient(create_app(dataset_path=DATASET, runtime_dir=tmp_path_factory.mktemp('runtime')), base_url='http://127.0.0.1:8078') as app:
        yield app


def test_record_endpoint(client):
    body = client.get('/api/catalog/teams/arsenal:2003/record').json()
    assert body['key'] == 'arsenal:2003' and body['points'] == 90 and body['position'] == 1
    assert body['results_sources'] == ['football-data']
    assert client.get('/api/catalog/teams/arsenal:1900/record').status_code == 404


def test_head_to_head_endpoint(client):
    response = client.get('/api/catalog/head-to-head', params={'home': 'arsenal', 'away': 'tottenham'})
    assert response.status_code == 200
    body = response.json()
    assert (body['club_a'], body['club_b'], body['played']) == ('arsenal', 'tottenham', 68)
    assert body['last_meeting']['source'] == 'football-data'
    assert client.get('/api/catalog/head-to-head', params={'home': 'arsenal', 'away': 'arsenal'}).status_code == 422
    assert client.get('/api/catalog/head-to-head', params={'home': 'arsenal', 'away': 'realmadrid'}).status_code == 404
    assert client.get('/api/catalog/head-to-head', params={'home': "a'; DROP", 'away': 'arsenal'}).status_code in (404, 422)
