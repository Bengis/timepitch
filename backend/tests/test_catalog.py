"""Real-snapshot contract tests: wrong source/club, invented zeros and leakage break these."""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import sqlite3
import shutil
import os

import pytest
from fastapi.testclient import TestClient

from timepitch.app import create_app
from timepitch.catalog.adapters import adapt_epl_player
from timepitch.catalog.repository import CatalogRepository

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


@pytest.fixture(scope='module')
def catalog():
    return CatalogRepository(DATASET)


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    # Own runtime: the dev API on 8078 holds .local/runtime.lock (TP216).
    with TestClient(create_app(dataset_path=DATASET, runtime_dir=tmp_path_factory.mktemp('runtime')), base_url='http://127.0.0.1:8078') as app:
        yield app


def test_complete_catalog_can_be_filtered_without_current_season(catalog):
    teams = catalog.list_teams()
    assert len(teams) == len({t.key for t in teams}) == 686
    assert len({t.club for t in teams}) == 51
    assert {t.season_start for t in teams} == set(range(1992, 2026))
    assert len(catalog.list_teams(query='Manchester City', season_start=2017)) == 1
    assert catalog.list_teams(query="'; DROP TABLE matches;--") == []
    assert catalog.list_teams(query='Arsenal')[0].club == 'arsenal'


@pytest.mark.parametrize('key,gf,ga', [('arsenal:2003', 73, 26), ('mancity:2017', 106, 27)])
def test_examples_have_real_players_and_eligible_eleven(catalog, key, gf, ga):
    team = catalog.get_team(key)
    assert (team.matches, team.goals_for, team.goals_against) == (38, gf, ga)
    roles = Counter(p.role for p in team.players)
    assert all(roles[role] >= needed for role, needed in {'GK': 1, 'DEF': 4, 'MID': 4, 'FWD': 2}.items())
    assert '4-4-2' in team.available_formations
    assert len({p.key for p in team.players}) == len(team.players)
    assert all(p.key.startswith(f'{team.source}:{team.season_start}:{team.club}:') for p in team.players)
    assert all('OWNGOAL' not in p.key for p in team.players)


def test_henry_measured_goals_and_estimated_minutes_are_distinct(catalog):
    henry = next(p for p in catalog.get_team('arsenal:2003').players if p.source_id == 'HENRYT')
    assert henry.name == 'Thierry Henry'
    assert henry.stats['goals'].value == 30
    assert henry.stats['goals'].status == 'measured'
    assert henry.stats['minutes'].value == 3330
    assert henry.stats['minutes'].status == 'estimated'
    assert henry.stats['passes'].value is None
    assert henry.stats['passes'].status == 'unavailable'


def test_result_provenance_is_distinct_from_roster_source(catalog):
    assert catalog.get_team('arsenal:2003').source == 'epldata'
    assert catalog.get_team('arsenal:2003').results_sources == ['football-data']
    assert catalog.get_team('arsenal:1992').results_sources == ['footballcsv']


def test_transfer_is_scoped_to_fixture_club_not_final_registration(catalog):
    bournemouth = next(p for p in catalog.get_team('bournemouth:2018').players if p.source_id == '241')
    liverpool = next(p for p in catalog.get_team('liverpool:2018').players if p.source_id == '241')
    assert bournemouth.name == liverpool.name == 'Nathaniel Clyne'
    assert bournemouth.key != liverpool.key
    assert bournemouth.stats['minutes'].value == 1142
    assert liverpool.stats['minutes'].value == 108


def test_own_goal_placeholder_is_not_eligible():
    assert adapt_epl_player({'player_id': 'OWNGOAL', 'appearances': 20}) is None


def test_unknown_role_is_visible_without_inventing_position(catalog):
    player = next(p for p in catalog.get_team('watford:1999').players if p.name == 'Nordin Wooter')
    assert player.role is None
    assert 'unknown_role' in player.quality_flags


def test_all_team_rosters_have_real_participants_and_valid_formation(catalog):
    for summary in catalog.list_teams():
        team = catalog.get_team(summary.key)
        assert len(team.players) == summary.player_count
        assert len(team.players) >= 19
        assert team.available_formations
        assert all(p.stats['appearances'].value > 0 for p in team.players)


def test_catalog_connections_cannot_modify_original(catalog):
    before = sha256(DATASET.read_bytes()).hexdigest()
    catalog.get_team('arsenal:2003')
    with catalog.connection() as connection:
        with pytest.raises(sqlite3.OperationalError, match='readonly'):
            connection.execute('DELETE FROM matches')
    assert sha256(DATASET.read_bytes()).hexdigest() == before


def test_replacing_installed_dataset_requires_restart_instead_of_stale_version(tmp_path):
    copy = tmp_path / 'coverage.sqlite'
    shutil.copyfile(DATASET, copy)
    repository = CatalogRepository(copy)
    repository.list_teams()
    stamp = copy.stat()
    os.utime(copy, ns=(stamp.st_atime_ns, stamp.st_mtime_ns + 1_000_000))
    with pytest.raises(ValueError, match='changed'):
        repository.get_team('arsenal:2003')


def test_api_exposes_catalog_and_details_not_raw_files(client):
    response = client.get('/api/catalog/teams', params={'query': 'Manchester City', 'season_start': 2017})
    assert response.status_code == 200
    assert [t['key'] for t in response.json()] == ['mancity:2017']
    assert 'players' not in response.json()[0]
    details = client.get('/api/catalog/teams/arsenal:2003')
    assert details.status_code == 200
    assert any(p['name'] == 'Thierry Henry' for p in details.json()['players'])
    assert client.get('/research/data-audit/2026-10-16/derived/coverage.sqlite').status_code == 404
    assert client.get('/api/catalog/teams', params={'season_start': 2026}).status_code == 422


@pytest.mark.parametrize('key', ['arsenal:1991', "arsenal:2003' OR 1=1--", 'unknown:2003', '..%2F..%2F.env'])
def test_unknown_or_malicious_key_is_not_found(client, key):
    assert client.get(f'/api/catalog/teams/{key}').status_code == 404


def test_readonly_api_stays_local_and_sets_security_headers(client):
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['x-frame-options'] == 'DENY'
    assert 'content-security-policy' in response.headers
    assert client.get('/api/health', headers={'Host': 'attacker.example'}).status_code == 400
    assert client.get('/docs').status_code == 404
    assert client.get('/.env').status_code == 404
