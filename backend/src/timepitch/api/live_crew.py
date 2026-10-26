"""TP253: crónica IA en vivo al final de un partido simulado (crew en Azure). Misma sesión de dueño que los partidos."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..crew.ledger import EnvelopeRefused
from ..crew.live import LiveCrewBusy, LiveCrewUnavailable
from ..security import owner_session


class LiveCrewRequest(BaseModel):
    engine: Literal['grf', 'touchlines']
    match_id: str = Field(min_length=1, max_length=120)
    locale: Literal['en', 'es']
    names: Literal['fictional', 'real'] = 'real'  # TP259: fictional league or real names
    audience: Literal['fan', 'analyst'] = 'fan'  # TP260: who the report is written for


def live_crew_router():
    router = APIRouter(prefix='/api/crew/live')
    Owner = Annotated[str, Depends(owner_session)]

    def service(request: Request):
        crew = getattr(request.app.state, 'live_crew', None)
        if crew is None or not crew.available():
            raise HTTPException(503, 'Live AI match reports are not enabled')
        return crew

    @router.get('/status')
    def status(request: Request, owner: Owner):
        crew = getattr(request.app.state, 'live_crew', None)
        available = crew is not None and crew.available()
        return {'available': available, 'remaining': crew.remaining() if available else None}

    @router.post('', status_code=202)
    def create(body: LiveCrewRequest, request: Request, owner: Owner):
        crew = service(request)
        try:
            return crew.request(body.engine, body.match_id, owner, body.locale, request.client.host if request.client else None,
                                body.names, body.audience)
        except KeyError:
            raise HTTPException(404, 'Match not found or not finished') from None
        except LiveCrewBusy as error:
            raise HTTPException(429, error.code) from None
        except EnvelopeRefused as error:
            raise HTTPException(503, error.code) from None
        except (LiveCrewUnavailable, OSError, ValueError):
            raise HTTPException(503, 'Live AI match reports are unavailable') from None

    @router.get('')
    def read(engine: Literal['grf', 'touchlines'], match_id: str, locale: Literal['en', 'es'], request: Request, owner: Owner,
             names: Literal['fictional', 'real'] = 'real', audience: Literal['fan', 'analyst'] = 'fan'):
        crew = service(request)
        try:
            return crew.status(engine, match_id, owner, locale, names, audience)
        except KeyError:
            raise HTTPException(404, 'Match not found or not finished') from None
        except (LiveCrewUnavailable, OSError, ValueError):
            raise HTTPException(503, 'Live AI match reports are unavailable') from None
    return router
