"""TouchLines en vivo (TP243): mismas reglas de sesión y dueño que GRF."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from ..security import owner_session
from ..simulation.models import MatchConfig
from ..grf.models import GrfJob
from ..matches.service import QueueFullError
from ..touchlines.service import TouchLinesUnavailable


def touchlines_router():
    router = APIRouter(prefix='/api/touchlines')
    Owner = Annotated[str, Depends(owner_session)]

    def service(request: Request):
        tl = getattr(request.app.state, 'touchlines', None)
        if tl is None: raise HTTPException(503, 'TouchLines is unavailable')
        return tl

    @router.post('/matches', response_model=GrfJob, status_code=202)
    def create(config: MatchConfig, request: Request, owner: Owner):
        try: return service(request).create_match(config, owner)
        except QueueFullError: raise HTTPException(429, 'The TouchLines queue is full') from None
        except TouchLinesUnavailable: raise HTTPException(503, 'TouchLines is unavailable') from None
        except (ValueError, KeyError): raise HTTPException(422, 'Invalid team, players, formation or unmapped tactics') from None

    @router.get('/matches/{match_id}', response_model=GrfJob)
    def job(match_id: str, request: Request, owner: Owner):
        try: return service(request).repository.get_job(match_id, owner)
        except KeyError: raise HTTPException(404, 'TouchLines match not found') from None

    # Grabación y eventos se sirven tal como se guardaron (gzip); el navegador los descomprime.
    def gzip_json(match_id: str, request: Request, owner: str, column: str):
        try: body = service(request).repository.blob(match_id, owner, column)
        except KeyError: raise HTTPException(404, 'TouchLines match not found') from None
        return Response(body, media_type='application/json', headers={'Content-Encoding': 'gzip', 'Cache-Control': 'private, max-age=3600'})

    @router.get('/matches/{match_id}/replay')
    def replay(match_id: str, request: Request, owner: Owner): return gzip_json(match_id, request, owner, 'record')

    @router.get('/matches/{match_id}/events')
    def events(match_id: str, request: Request, owner: Owner): return gzip_json(match_id, request, owner, 'events')
    return router
