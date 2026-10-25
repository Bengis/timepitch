"""Changes in performance must survive normalisation; missing stats cannot become zero skill."""
from pathlib import Path
import pytest

from timepitch.catalog.models import PlayerSeason, Statistic, TeamSeason
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.models import LeagueBaseline, RolePrior
from timepitch.simulation.ratings import build_player_profile, build_team_profile, get_league_baseline, default_role_prior


def player(goals=10, minutes=1800, *, flags=None):
    return PlayerSeason(key='fixture:2003:example:1', source_id='1', name='Example', role='FWD',
        stats={'goals': Statistic(value=goals, source='fixture', status='measured'),
               'minutes': Statistic(value=minutes, source='fixture', status='measured', unit='minutes')}, quality_flags=flags or [])


def test_performance_difference_survives_smoothing_without_reputation():
    prior = default_role_prior('FWD')
    lower = build_player_profile(player(5), prior)
    higher = build_player_profile(player(15), prior)
    assert higher.attributes['shooting'] > lower.attributes['shooting']
    renamed = player(15).model_copy(update={'name': 'Any famous name'})
    assert build_player_profile(renamed, prior).attributes == higher.attributes


def test_minimal_role_prior_contract_has_safe_reference_rates():
    prior = RolePrior(role='FWD', attribute_values={'shooting': .65, 'passing': .55})
    profile = build_player_profile(player(10), prior)
    assert 0 < profile.attributes['shooting'] < 1


def test_missing_data_and_zero_attempts_use_explicit_role_priors():
    p = player(0, None)
    p.stats['passes'] = Statistic(value=0, source='fixture', status='measured')
    profile = build_player_profile(p, default_role_prior('FWD'))
    assert profile.attributes['passing'] > 0
    assert profile.attributes['shooting'] > 0
    assert profile.provenance['passing'] == 'estimated:role_prior'
    assert profile.confidence == 'low'


def test_partial_xg_and_flagged_goals_do_not_inflate_precision():
    p = player(100, 1000, flags=['goal_events_need_review'])
    p.stats['xg'] = Statistic(value=200, source='fpl', status='partial')
    prior = default_role_prior('FWD')
    profile = build_player_profile(p, prior)
    assert profile.attributes['shooting'] == prior.attribute_values['shooting']
    assert profile.provenance['shooting'] == 'estimated:role_prior'
    assert profile.confidence == 'low'


def test_few_minutes_remain_uncertain_and_attributes_bounded():
    profile = build_player_profile(player(5, 10), default_role_prior('FWD'))
    assert profile.confidence == 'low'
    assert all(0.05 <= value <= 0.95 for value in profile.attributes.values())


def test_team_profile_uses_origin_season_and_neutral_context():
    repo = CatalogRepository(Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite')
    arsenal = repo.get_team('arsenal:2003')
    baseline = get_league_baseline(repo, 2003)
    profile = build_team_profile(arsenal, baseline)
    assert profile.attack_rate == pytest.approx((73 / 38) / baseline.goals_per_team_game)
    assert profile.concession_rate == pytest.approx((26 / 38) / baseline.goals_per_team_game)
    assert 1 < baseline.neutral_goals_per_team_game < 2
    assert all(p.role is not None for p in profile.players)
    with pytest.raises(ValueError, match='origin'):
        build_team_profile(arsenal, baseline.model_copy(update={'season_start': 2017}))


def test_extreme_team_totals_are_bounded():
    repo = CatalogRepository(Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite')
    team = repo.get_team('arsenal:2003').model_copy(update={'goals_for': 1000, 'goals_against': 0})
    baseline = LeagueBaseline(season_start=2003, goals_per_team_game=1.5, neutral_goals_per_team_game=1.4)
    profile = build_team_profile(team, baseline)
    assert profile.attack_rate == 2.5
    assert profile.concession_rate == 0.5
