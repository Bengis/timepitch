"""Experimental GRF routes use the existing local session and HTTP policy."""
from typing import Annotated
from pydantic import Field
from fastapi import APIRouter,Depends,HTTPException,Request,Response
from fastapi.responses import StreamingResponse
from ..security import owner_session
from ..simulation.models import MatchConfig
from ..grf.models import EngineCapability,GrfJob,GrfRecord
from ..grf.physical_models import PhysicalManifest,PhysicalChunk,ActivityManifest,ActivityChunk,PhysicalStatisticsSummary
from ..grf.statistics_models import GrfStatisticsSummary
from ..grf.action_models import ActionManifest,ActionChunk
from ..grf.action_statistics_models import ActionStatisticsSummary
from ..grf.process import GrfUnavailable,GrfCancelled
from ..matches.service import QueueFullError


def grf_router():
    router=APIRouter(prefix='/api')
    Owner=Annotated[str,Depends(owner_session)]

    @router.get('/engines',response_model=list[EngineCapability])
    def engines(request:Request,owner:Owner):
        engines=[EngineCapability(id='timepitch',available=True),request.app.state.grf.capability()]
        # TP243: TouchLines en vivo, si el servicio está montado.
        touchlines=getattr(request.app.state,'touchlines',None)
        return engines+([touchlines.capability()] if touchlines else [])

    @router.post('/grf/matches',response_model=GrfJob,status_code=202)
    def create(config:MatchConfig,request:Request,owner:Owner):
        try:return request.app.state.grf.create_match(config,owner)
        except QueueFullError:raise HTTPException(429,'The local GRF queue is full') from None
        except (GrfUnavailable,GrfCancelled):raise HTTPException(503,'Experimental GRF is unavailable') from None
        except (ValueError,KeyError):raise HTTPException(422,'Invalid team, players, formation or unmapped tactics') from None

    @router.get('/grf/matches',response_model=list[GrfJob])
    def recent(request:Request,owner:Owner):return request.app.state.grf.repository.list_jobs(owner)

    @router.get('/grf/matches/{match_id}',response_model=GrfJob)
    def job(match_id:str,request:Request,owner:Owner):
        try:return request.app.state.grf.repository.get_job(match_id,owner)
        except KeyError:raise HTTPException(404,'GRF match not found') from None

    @router.get('/grf/matches/{match_id}/replay',response_model=GrfRecord|PhysicalManifest|ActivityManifest|ActionManifest)
    def replay(match_id:str,request:Request,response:Response,owner:Owner):
        try:record=request.app.state.grf.get_match(match_id,owner)
        except KeyError:raise HTTPException(404,'GRF replay not found') from None
        response.headers['Content-Disposition']=f'attachment; filename="timepitch-grf-{match_id}.json"'
        return record

    @router.get('/grf/matches/{match_id}/replay/chunks/{index}',response_model=Annotated[PhysicalChunk|ActivityChunk|ActionChunk,Field(discriminator='schema_version')])
    def chunk(match_id:str,index:int,request:Request,owner:Owner):
        try:return request.app.state.grf.physical_repository.get_chunk(match_id,owner,index)
        except KeyError:raise HTTPException(404,'GRF block not found') from None

    @router.get('/grf/matches/{match_id}/export')
    def export(match_id:str,request:Request,owner:Owner):
        try:lines=request.app.state.grf.physical_repository.export(match_id,owner)
        except KeyError:raise HTTPException(404,'GRF physical replay not found') from None
        return StreamingResponse(lines,media_type='application/x-ndjson',
            headers={'Content-Disposition':f'attachment; filename="timepitch-grf-{match_id}.jsonl"'})

    @router.get('/grf/matches/{match_id}/statistics',response_model=Annotated[GrfStatisticsSummary|PhysicalStatisticsSummary|ActionStatisticsSummary,Field(discriminator='statistics_version')])
    def statistics(match_id:str,request:Request,owner:Owner):
        try:return request.app.state.grf.get_statistics(match_id,owner)
        except KeyError:raise HTTPException(404,'GRF statistics not found') from None
    return router
