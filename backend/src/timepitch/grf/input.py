"""Build native inputs only from the server's historical catalogue."""
from ..simulation.engine import _prepare
from .models import GrfInput, GrfPlayer, GrfMatchInput,GrfStatisticsInput
from .codec import grf_input_hash

MAPPING = {'physical_velocity': 'pace', 'technical_shot': 'shooting', 'technical_shortpass': 'passing'}
NATIVE_ROLES = {'GK': 'GK', 'DEF': 'CB', 'MID': 'CM', 'FWD': 'CF'}


def make_grf_input(config, catalog) -> GrfInput:
    if config.home_tactic != 'balanced' or config.away_tactic != 'balanced':
        raise ValueError('TimePitch tactics are not mapped to GRF')
    state, teams = _prepare(config, catalog)
    players = []
    for side in ('home', 'away'):
        people = {p.key: p for p in teams[side].players}
        for slot, profile in enumerate(state.profiles[side].players):
            players.append(GrfPlayer(id=f'{side}:{profile.player_key}', side=side, slot=slot,
                source_key=profile.player_key, name=people[profile.player_key].name,
                role=profile.role, native_role=NATIVE_ROLES[profile.role],
                attributes={n: profile.attributes[k] for n,k in MAPPING.items()},
                provenance={n: profile.provenance[k] for n,k in MAPPING.items()}))
    request = GrfInput(config=config, dataset_version=catalog.dataset_version,
                       home_name=teams['home'].name, away_name=teams['away'].name, players=players)
    request.input_hash = grf_input_hash(request)
    return request


def make_full_match_input(config,catalog) -> GrfMatchInput:
    legacy=make_grf_input(config,catalog)
    request=GrfMatchInput(**legacy.model_dump(exclude={'settings','input_hash'}))
    request.input_hash=grf_input_hash(request)
    return request


def make_statistics_input(config,catalog) -> GrfStatisticsInput:
    legacy=make_full_match_input(config,catalog)
    request=GrfStatisticsInput(**legacy.model_dump(exclude={'input_hash'}))
    request.input_hash=grf_input_hash(request)
    return request


def make_physical_input(config,catalog):
    from .physical_models import PhysicalInput
    legacy=make_grf_input(config,catalog)
    request=PhysicalInput(**legacy.model_dump(exclude={'settings','input_hash'}))
    request.input_hash=grf_input_hash(request)
    return request


def make_activity_input(config,catalog,settings=None):
    from .physical_models import ActivityInput,ActivitySettings
    legacy=make_grf_input(config,catalog)
    request=ActivityInput(**legacy.model_dump(exclude={'settings','input_hash'}),settings=settings or ActivitySettings())
    request.input_hash=grf_input_hash(request)
    return request


def make_action_input(config,catalog):
    from .action_models import ActionInput
    legacy=make_grf_input(config,catalog)
    request=ActionInput(**legacy.model_dump(exclude={'settings','input_hash'}))
    request.input_hash=grf_input_hash(request)
    return request
