from typing import Annotated,Literal
import sqlite3

from fastapi import APIRouter, HTTPException, Query, Path as RoutePath,Depends,Request
from ..security import owner_session
from ..historical.crosswalk import resolve_matchup
from ..historical.comparison import compare_match,simulation_snapshot
from ..historical.models import MatchupPrefill,HistoricalComparison

from ..historical.models import HistoricalCapabilities, HistoricalEventPage, HistoricalMatch, HistoricalPage, HistoricalSeason, HistoricalStatistics
from ..historical.repository import HistoricalRepository
from ..reconstruction.models import ReconstructionManifest,ReconstructionSegment
from ..reconstruction.repository import ReconstructionRepository


def historical_router(repository: HistoricalRepository | None, *, dataset_state='absent', two_modes_ui=False, enabled=False,
                      reconstruction: ReconstructionRepository | None=None,catalog=None,crosswalk=None,
                      publication_approved: bool=False) -> APIRouter:
    router = APIRouter(prefix='/api/historical')

    @router.get('/capabilities', response_model=HistoricalCapabilities)
    def capabilities():
        return HistoricalCapabilities(two_modes_ui=two_modes_ui, reconstruction_enabled=enabled and repository is not None,
            dataset_state=dataset_state, dataset_version=repository.dataset_version if repository else None,
            publication_status='operator_confirmed_permission' if publication_approved else 'blocked_pending_permission')

    def read(method, *args):
        if not enabled or repository is None:
            raise HTTPException(503, 'Historical dataset unavailable for this deployment')
        try:
            return getattr(repository, method)(*args)
        except KeyError:
            raise HTTPException(404, 'Historical match not found') from None
        except ValueError as error:
            if str(error).startswith('Invalid historical'):
                raise HTTPException(422, 'Invalid historical query') from None
            raise HTTPException(503, 'Historical dataset unavailable; restart required') from None
        except (OSError, sqlite3.DatabaseError):
            raise HTTPException(503, 'Historical dataset unavailable') from None

    @router.get('/seasons', response_model=list[HistoricalSeason])
    def seasons():
        return read('list_seasons')

    @router.get('/matches', response_model=HistoricalPage)
    def matches(season_id: Annotated[int, Query(ge=1)], team_id: Annotated[int | None, Query(ge=1)] = None,
                offset: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(ge=1, le=50)] = 24):
        return read('list_matches', season_id, team_id, offset, limit)

    @router.get('/matches/{match_id}', response_model=HistoricalMatch)
    def match(match_id: int):
        if match_id <= 0:
            raise HTTPException(422, 'Invalid match identity')
        return read('get_match', match_id)

    @router.get('/matches/{match_id}/events', response_model=HistoricalEventPage)
    def events(match_id: int, period: Annotated[int, Query(ge=1, le=5)],
               from_ms: Annotated[int, Query(ge=0)] = 0, to_ms: Annotated[int, Query(ge=1, le=10_800_000)] = 60_000,
               offset: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(ge=1, le=200)] = 100):
        if match_id <= 0 or to_ms <= from_ms or to_ms-from_ms > 60_000:
            raise HTTPException(422, 'Invalid historical window')
        return read('events', match_id, period, from_ms, to_ms, offset, limit)

    @router.get('/matches/{match_id}/statistics', response_model=HistoricalStatistics)
    def statistics(match_id: int, period: Annotated[int,Query(ge=1,le=5)],
                   at_ms: Annotated[int,Query(ge=0,le=10_800_000)]):
        if match_id <= 0:
            raise HTTPException(422,'Invalid match identity')
        return read('statistics',match_id,period,at_ms)

    def prefill(match_id):
        match=read('get_match',match_id)
        if catalog is None or crosswalk is None:raise HTTPException(503,'Matchup crosswalk unavailable')
        starts=read('statistics',match_id,1,0).formations if match.clock and any(p.period==1 for p in match.clock.periods) else []
        try:result=resolve_matchup(match,catalog,crosswalk,starting_formations=starts)
        except (OSError,ValueError):raise HTTPException(503,'Matchup catalogue unavailable') from None
        return match,result.model_copy(update={'historical_dataset_version':repository.dataset_version})

    @router.get('/matches/{match_id}/matchup',response_model=MatchupPrefill)
    def matchup(match_id:int):
        if match_id<=0:raise HTTPException(422,'Invalid match identity')
        return prefill(match_id)[1]

    @router.get('/matches/{match_id}/comparison',response_model=HistoricalComparison)
    def comparison(match_id:int,engine:Literal['timepitch','grf'],
                   simulation_id:Annotated[str,Query(min_length=1,max_length=100)],request:Request,
                   owner:Annotated[str,Depends(owner_session)]):
        if match_id<=0:raise HTTPException(422,'Invalid match identity')
        # Authorize the stored simulation before inspecting any of its content.
        try:
            service=request.app.state.matches if engine=='timepitch' else request.app.state.grf
            record=service.get_match(simulation_id,owner)
        except KeyError:raise HTTPException(404,'Simulation not found') from None
        except (ValueError,OSError,sqlite3.DatabaseError):raise HTTPException(503,'Stored simulation unavailable') from None
        match,mapping=prefill(match_id)
        config=record.config if engine=='timepitch' else record.input.config
        if not mapping.available or (config.home_key,config.away_key)!=(mapping.home.catalog_key,mapping.away.catalog_key):
            raise HTTPException(422,'Comparison requires the same ordered clubs and seasons')
        if not match.clock or not match.clock.periods:raise HTTPException(503,'Historical final cutoff unavailable')
        final=match.clock.periods[-1]
        if final.duration_ms is None:raise HTTPException(503,'Historical final cutoff unavailable')
        facts=read('statistics',match_id,final.period,final.duration_ms)
        try:
            if engine=='grf' and record.schema_version not in ('grf-experimental-2','grf-experimental-3'):
                raise ValueError('Unsupported comparison replay')
            stats=service.get_statistics(simulation_id,owner) if engine=='grf' else None
            snapshot=simulation_snapshot(engine,simulation_id,record,grf_statistics=stats)
        except ValueError:raise HTTPException(503,'Comparison unavailable for this replay format') from None
        differences=[]
        for side in ('home','away'):
            mapped=getattr(mapping,side)
            if mapped.source_formation!=getattr(config,f'{side}_formation'):differences.append(f'{side}_formation_differs')
            if mapped.player_keys is None:differences.append(f'{side}_xi_unverified')
            elif set(mapped.player_keys)!=set(getattr(config,f'{side}_players')):differences.append(f'{side}_xi_differs')
        return compare_match(facts,snapshot,team_keys=(match.home_team.key,match.away_team.key)).model_copy(update={'historical_formations':{'home':mapping.home.source_formation,'away':mapping.away.source_formation},'lineup_differences':differences})

    def read_motion(match_id,method,*args):
        if match_id<=0:raise HTTPException(422,'Invalid match identity')
        read('_read_match',match_id)
        if reconstruction is None:raise HTTPException(503,'Prebuilt reconstruction unavailable')
        if reconstruction.dataset_version!=repository.dataset_version:
            raise HTTPException(503,'Reconstruction source differs from historical dataset')
        try:
            return getattr(reconstruction,method)(match_id,*args)
        except KeyError:
            raise HTTPException(404,'Reconstruction artifact not inventoried') from None
        except (ValueError,OSError):
            raise HTTPException(503,'Reconstruction artifact unavailable or corrupt') from None

    @router.get('/matches/{match_id}/reconstruction',response_model=ReconstructionManifest)
    def manifest(match_id:int):
        return read_motion(match_id,'get_manifest')

    @router.get('/matches/{match_id}/reconstruction/segments/{period}/{index}',response_model=ReconstructionSegment)
    def segment(match_id:int,period:Annotated[int,RoutePath(ge=1,le=4)],index:Annotated[int,RoutePath(ge=0,le=180)]):
        return read_motion(match_id,'get_segment',period,index)

    return router
