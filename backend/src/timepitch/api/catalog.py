from typing import Annotated
from fastapi import APIRouter, HTTPException, Query
from ..catalog.models import Health, TeamSummary, TeamSeason
from ..catalog.repository import CatalogRepository
from ..catalog.results import HeadToHead, TeamSeasonRecord


def catalog_router(repository: CatalogRepository) -> APIRouter:
    router = APIRouter(prefix='/api')

    @router.get('/health', response_model=Health)
    def health():
        teams = repository.list_teams()
        return Health(teams=len(teams), clubs=len({t.club for t in teams}),
                      seasons=len({t.season_start for t in teams}), dataset_version=repository.dataset_version)

    @router.get('/catalog/teams', response_model=list[TeamSummary])
    def teams(query: Annotated[str, Query(max_length=100)] = '',
              season_start: Annotated[int | None, Query(ge=1992, le=2025)] = None):
        return repository.list_teams(query, season_start)

    @router.get('/catalog/teams/{key}', response_model=TeamSeason)
    def team(key: str):
        try:
            return repository.get_team(key)
        except KeyError:
            raise HTTPException(status_code=404, detail='Team season not found') from None

    @router.get('/catalog/teams/{key}/record', response_model=TeamSeasonRecord)
    def team_record(key: str):
        """TP213 · Season record by results (3-1-0; no point deductions), read-only."""
        try:
            return repository.team_record(key)
        except KeyError:
            raise HTTPException(status_code=404, detail='Team season not found') from None

    @router.get('/catalog/head-to-head', response_model=HeadToHead)
    def club_head_to_head(home: Annotated[str, Query(max_length=40)], away: Annotated[str, Query(max_length=40)]):
        """TP213 · Premier League meetings between two clubs over the catalogue seasons, read-only."""
        try:
            return repository.head_to_head(home, away)
        except KeyError:
            raise HTTPException(status_code=404, detail='Club not found') from None
        except ValueError:
            raise HTTPException(status_code=422, detail='Choose two different clubs') from None

    return router
