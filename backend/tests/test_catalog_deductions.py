"""TP214 · Points deductions with source: points and positions match the official final tables for all 686 club-seasons."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from timepitch.app import create_app
from timepitch.catalog.deductions import load_deductions
from timepitch.catalog.repository import CatalogRepository
from timepitch.catalog.results import MatchResult, league_table

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / 'research/data-audit/2026-10-16/derived/coverage.sqlite'
# Independent check: final tables (order = official position) from the Wikipedia season articles, with revids.
OFFICIAL = json.loads((Path(__file__).parent / 'fixtures/premier_league_final_tables.json').read_text(encoding='utf-8'))


def r(home, away, hg, ag):
    return MatchResult(season_start=2000, date='2000-01-01', home=home, away=away, home_goals=hg, away_goals=ag, source='test')


def test_deduction_lowers_points_and_position_and_keeps_raw_points():
    results = [r('a', 'b', 1, 0), r('b', 'c', 1, 0), r('c', 'a', 0, 0)]  # a 4, b 3, c 1
    plain = {row.club: row for row in league_table(results)}
    assert (plain['a'].position, plain['a'].points_deducted) == (1, 0)
    rows = {row.club: row for row in league_table(results, {'a': 3})}
    assert (rows['a'].raw_points, rows['a'].points, rows['a'].points_deducted, rows['a'].position) == (4, 1, 3, 2)
    # Level on points with c (1), ahead on goal difference (+1 vs -1).
    assert (rows['b'].position, rows['c'].position) == (1, 3)


def test_deduction_for_a_club_without_results_is_rejected():
    with pytest.raises(ValueError):
        league_table([r('a', 'b', 1, 0)], {'zzz': 3})


def test_deductions_file_is_sourced_and_covers_every_catalogue_season():
    table = load_deductions()
    assert table.seasons_checked == list(range(1992, 2026))
    assert {(d.club, d.season_start, d.points) for d in table.deductions} == {
        ('middlesbrough', 1996, 3), ('portsmouth', 2009, 9), ('everton', 2023, 8), ('nottmforest', 2023, 4)}
    for d in table.deductions:
        assert d.source.revid > 0 and f'oldid={d.source.revid}' in d.source.url
        assert d.source.title.startswith(f'{d.season_start}–') and 'CC BY-SA' in d.licence
        assert d.reason and d.reason_es
        # Same revision as the independent final-table fixture, which carries the same adjustment.
        season = OFFICIAL['seasons'][str(d.season_start)]
        assert season['source']['revid'] == d.source.revid
        assert next(row for row in season['rows'] if row['club'] == d.club)['points_adjustment'] == -d.points


@pytest.fixture(scope='module')
def catalog():
    return CatalogRepository(DATASET)


def test_every_club_season_matches_the_official_final_position(catalog):
    assert sorted(OFFICIAL['seasons']) == [str(y) for y in range(1992, 2026)]
    checked, mismatches = 0, []
    teams = {t.key for t in catalog.list_teams()}
    for year, season in OFFICIAL['seasons'].items():
        for row in season['rows']:
            key = f"{row['club']}:{year}"
            assert key in teams, key
            rec = catalog.team_record(key)
            got = (rec.position, rec.position_shared, rec.wins, rec.draws, rec.losses, rec.goals_for, rec.goals_against,
                   rec.raw_points + row['points_adjustment'], rec.teams)
            want = (row['position'], False, row['wins'], row['draws'], row['losses'], row['goals_for'], row['goals_against'],
                    rec.points, len(season['rows']))
            if got != want:
                mismatches.append((key, got, want))
            checked += 1
    assert checked == len(teams) == 686
    assert mismatches == []


@pytest.mark.parametrize('key,raw,points,position,deducted', [
    ('middlesbrough:1996', 42, 39, 19, 3),   # 14th by results alone
    ('portsmouth:2009', 28, 19, 20, 9),
    ('everton:2023', 48, 40, 15, 8),          # 12th by results alone
    ('nottmforest:2023', 36, 32, 17, 4),
])
def test_known_deductions_apply_to_points_and_position(catalog, key, raw, points, position, deducted):
    rec = catalog.team_record(key)
    assert (rec.raw_points, rec.points, rec.position, rec.deduction.points) == (raw, points, position, deducted)
    assert rec.point_deductions == 'applied' and rec.deductions_version.startswith('sha256:')


def test_teams_displaced_by_a_deduction_move_up(catalog):
    # 1996/97: West Ham, Everton, Southampton, Coventry and Sunderland each one place higher than by results alone.
    assert [catalog.team_record(f'{c}:1996').position for c in ('westham', 'everton', 'southampton', 'coventry', 'sunderland')] == [14, 15, 16, 17, 18]
    assert catalog.team_record('wolves:2023').position == 14


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    with TestClient(create_app(dataset_path=DATASET, runtime_dir=tmp_path_factory.mktemp('runtime')), base_url='http://127.0.0.1:8078') as app:
        yield app


def test_record_endpoint_exposes_the_deduction_with_source(client):
    body = client.get('/api/catalog/teams/portsmouth:2009/record').json()
    assert (body['points'], body['raw_points'], body['position']) == (19, 28, 20)
    d = body['deduction']
    assert d['points'] == 9 and d['source']['title'] == '2009–10 Premier League' and d['source']['revid'] > 0
    assert 'administration' in d['reason'] and d['reason_es']
    assert client.get('/api/catalog/teams/arsenal:2003/record').json()['deduction'] is None
