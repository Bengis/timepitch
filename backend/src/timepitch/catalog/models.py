from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

Role = Literal['GK', 'DEF', 'MID', 'FWD']


class CatalogModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class Statistic(CatalogModel):
    value: float | None
    source: str
    status: Literal['measured', 'estimated', 'unavailable', 'partial']
    unit: str = 'count'


class HistoricalStatistic(Statistic):
    definition_version: str = 'historical-advanced-1'
    covered_minutes: float | None = Field(default=None,ge=0,allow_inf_nan=False)
    fixtures_covered: int = Field(default=0,ge=0)
    fixtures_total: int = Field(default=0,ge=0)
    coverage_from: str | None = None
    coverage_to: str | None = None
    reason: str | None = None


class PlayerSeason(CatalogModel):
    key: str
    source_id: str
    name: str
    role: Role | None
    stats: dict[str, Statistic]
    quality_flags: list[str]
    advanced_stats: dict[str,HistoricalStatistic] = Field(default_factory=dict)


class TeamSummary(CatalogModel):
    key: str
    club: str
    name: str
    season_start: int
    season_label: str
    source: Literal['epldata', 'fpl']
    results_sources: list[str]
    dataset_version: str
    player_count: int
    matches: int
    goals_for: int
    goals_against: int
    available_formations: list[str]
    coverage: dict[str, str]
    quality_flags: list[str]


class TeamSeason(TeamSummary):
    players: list[PlayerSeason]
    advanced_dataset_version: str | None = None


class Health(CatalogModel):
    status: Literal['ok'] = 'ok'
    phase: Literal['catalog'] = 'catalog'
    teams: int
    clubs: int
    seasons: int
    dataset_version: str
