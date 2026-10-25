"""Initial simulator estimates, never official ratings or reputation-based scores."""
from functools import lru_cache
from ..catalog.models import PlayerSeason, TeamSeason, Role
from ..catalog.repository import CatalogRepository
from .models import LeagueBaseline, RolePrior, PlayerProfile, TeamProfile

ROLE_ATTRIBUTES = {
    'GK': dict(passing=.35, shooting=.08, defending=.20, keeping=.75, pace=.35, stamina=.65),
    'DEF': dict(passing=.50, shooting=.25, defending=.68, keeping=.05, pace=.52, stamina=.70),
    'MID': dict(passing=.65, shooting=.45, defending=.50, keeping=.05, pace=.60, stamina=.75),
    'FWD': dict(passing=.55, shooting=.65, defending=.25, keeping=.05, pace=.65, stamina=.65),
}
DEFAULT_RATES = {'GK': (.002, .001), 'DEF': (.04, .06), 'MID': (.12, .16), 'FWD': (.35, .12)}


def default_role_prior(role: Role) -> RolePrior:
    goals, assists = DEFAULT_RATES[role]
    return RolePrior(role=role, attribute_values=ROLE_ATTRIBUTES[role].copy(),
                     rates_per90={'goals': goals, 'assists': assists})


def _usable(player: PlayerSeason, field: str) -> float | None:
    stat = player.stats.get(field)
    return stat.value if stat is not None and stat.status in {'measured', 'estimated'} else None


@lru_cache(maxsize=68)
def get_league_baseline(catalog: CatalogRepository, season_start: int) -> LeagueBaseline:
    all_teams = catalog.list_teams()
    teams = [team for team in all_teams if team.season_start == season_start]
    if not teams:
        raise ValueError('Unknown origin season')
    totals = {role: {'goals': 0., 'assists': 0., 'minutes': 0.} for role in ROLE_ATTRIBUTES}
    for summary in teams:
        for player in catalog.get_team(summary.key).players:
            minutes, goals = _usable(player, 'minutes'), _usable(player, 'goals')
            if player.role is None or not minutes or goals is None or 'goal_events_need_review' in player.quality_flags:
                continue
            target = totals[player.role]
            target['minutes'] += minutes
            target['goals'] += goals
            assists = _usable(player, 'assists_fpl' if summary.source == 'fpl' else 'assists')
            target['assists'] += assists or 0
    priors = {}
    for role, total in totals.items():
        prior = default_role_prior(role)
        if total['minutes'] > 0:
            prior.rates_per90 = {field: max(.002, total[field] * 90 / total['minutes']) for field in ('goals', 'assists')}
        priors[role] = prior
    return LeagueBaseline(season_start=season_start,
        goals_per_team_game=sum(team.goals_for for team in teams) / sum(team.matches for team in teams),
        neutral_goals_per_team_game=sum(team.goals_for for team in all_teams) / sum(team.matches for team in all_teams),
        role_priors=priors)


def build_player_profile(player: PlayerSeason, role_prior: RolePrior) -> PlayerProfile:
    if player.role is None or player.role != role_prior.role:
        raise ValueError('Player must have a known matching role')
    attributes = role_prior.attribute_values.copy()
    provenance = {key: 'estimated:role_prior' for key in attributes}
    minutes = _usable(player, 'minutes')
    reviewed = 'goal_events_need_review' not in player.quality_flags
    if minutes and minutes > 0 and reviewed:
        for field, attribute in (('goals', 'shooting'), ('assists', 'passing')):
            source_field = field
            value = _usable(player, field)
            if field == 'assists' and value is None:
                source_field = 'assists_fpl'
                value = _usable(player, source_field)
            if value is None:
                continue
            reference = max(.002, role_prior.rates_per90.get(field, DEFAULT_RATES[player.role][0 if field == 'goals' else 1]))
            smoothed = (value * 90 + role_prior.prior_minutes * reference) / (minutes + role_prior.prior_minutes)
            attributes[attribute] = min(.95, max(.05, attributes[attribute] * (smoothed / reference) ** .35))
            provenance[attribute] = f'estimated:{player.stats[source_field].source}:{source_field}_per90:role_smoothing_{role_prior.prior_minutes}m'
    confidence = 'medium' if minutes and minutes >= 900 and reviewed and not player.quality_flags else 'low'
    return PlayerProfile(player_key=player.key, role=player.role, attributes=attributes,
                         provenance=provenance, confidence=confidence)


def build_team_profile(team: TeamSeason, league_baseline: LeagueBaseline) -> TeamProfile:
    if league_baseline.season_start != team.season_start:
        raise ValueError('Baseline must use the team origin season')
    if team.matches <= 0 or league_baseline.goals_per_team_game <= 0:
        raise ValueError('Team and league must have recorded matches and goals')
    players = [build_player_profile(player, league_baseline.role_priors.get(player.role) or default_role_prior(player.role))
               for player in team.players if player.role is not None]
    return TeamProfile(team_key=team.key,
        attack_rate=min(2.5, max(.5, (team.goals_for / team.matches) / league_baseline.goals_per_team_game)),
        concession_rate=min(2.5, max(.5, (team.goals_against / team.matches) / league_baseline.goals_per_team_game)),
        players=players, confidence='low' if 'source_scores_disagree' in team.quality_flags else 'medium',
        quality_flags=team.quality_flags)
