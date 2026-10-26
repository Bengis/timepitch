"""TP263: «Pregúntale al partido». Same owner session as the matches; the answer comes back in the response."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..crew.ask import QUESTION_MAX, AskBusy, AskUnavailable
from ..crew.ledger import EnvelopeRefused
from ..security import owner_session


class AskRequest(BaseModel):
    engine: Literal['grf', 'touchlines']
    match_id: str = Field(min_length=1, max_length=120)
    locale: Literal['en', 'es']
    names: Literal['fictional', 'real'] = 'real'
    question: str = Field(min_length=3, max_length=QUESTION_MAX)


def ask_router():
    router = APIRouter(prefix='/api/crew/ask')
    Owner = Annotated[str, Depends(owner_session)]

    @router.get('/status')
    def status(request: Request, owner: Owner):
        service = getattr(request.app.state, 'ask', None)
        available = service is not None and service.available()
        return {'available': available, 'remaining': service.remaining() if available else None}

    @router.post('')
    def ask(body: AskRequest, request: Request, owner: Owner):
        service = getattr(request.app.state, 'ask', None)
        if service is None or not service.available():
            raise HTTPException(503, 'Match questions are not enabled')
        try:
            return service.ask(body.engine, body.match_id, owner, body.locale, body.question,
                               request.client.host if request.client else None, body.names)
        except KeyError:
            raise HTTPException(404, 'Match not found or not finished') from None
        except AskBusy as error:
            raise HTTPException(429, error.code) from None
        except EnvelopeRefused as error:
            raise HTTPException(503, error.code) from None
        except ValueError:
            raise HTTPException(422, 'question_length') from None
        except (AskUnavailable, OSError):
            raise HTTPException(503, 'Match questions are unavailable') from None
    return router
