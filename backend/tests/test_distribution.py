from pathlib import Path
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import simulate_match, simulate_metrics, make_config, validate_trace
from timepitch.simulation.actions import advance_pass

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


def test_pass_progress_is_symmetric_when_attacking_direction_is_reversed():
    assert advance_pass(50, 90, 1) == 68
    assert advance_pass(55, 15, -1) == 37


def test_fast_distribution_path_and_full_trace_share_the_same_outcomes():
    catalog = CatalogRepository(DATASET)
    config = make_config(catalog, 'arsenal:2003', 'mancity:2017', seed=10)
    assert simulate_metrics(config, catalog) == simulate_match(config, catalog).metrics


def test_ten_paired_spatial_seeds_respond_to_attack_and_pressing():
    catalog = CatalogRepository(DATASET)
    original = catalog.get_team('arsenal:2003')
    class BoostedCatalog(CatalogRepository):
        def get_team(self, key):
            team = super().get_team(key)
            return team.model_copy(update={'goals_for': original.goals_for * 2}) if key == 'arsenal:2003' else team
    boosted = BoostedCatalog(DATASET)
    totals = {'normal_shots': 0, 'boosted_shots': 0, 'normal_goals': 0, 'boosted_goals': 0,
              'normal_interventions': 0, 'press_interventions': 0}
    for seed in range(10):
        config = make_config(catalog, 'arsenal:2003', 'mancity:2017', seed=seed)
        normal = simulate_metrics(config, catalog)
        stronger = simulate_metrics(config, boosted)
        pressing = simulate_metrics(config.model_copy(update={'home_tactic': 'press'}), catalog)
        totals['normal_shots'] += normal.home.shots
        totals['normal_goals'] += normal.home.goals
        totals['boosted_shots'] += stronger.home.shots
        totals['boosted_goals'] += stronger.home.goals
        # At close range a pressure attempt becomes a tackle. Counting only
        # distant pressure labels penalizes the spatial model for reaching the ball.
        totals['normal_interventions'] += normal.home.pressures+normal.home.tackles
        totals['press_interventions'] += pressing.home.pressures+pressing.home.tackles
    assert totals['boosted_shots'] > totals['normal_shots'], totals
    assert totals['boosted_goals'] > totals['normal_goals'], totals
    assert totals['press_interventions'] > totals['normal_interventions'], totals
    # Ten paired seeds test directional response, not a calibrated score distribution.
