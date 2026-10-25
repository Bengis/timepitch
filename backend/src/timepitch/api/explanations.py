from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request
from ..security import owner_session
from ..agents.models import ExplanationRequest, ExplanationJob, MatchWindow
from ..agents.service import ExplanationQueueFull
from ..agents.tools import build_windows


def explanations_router():
    router = APIRouter(prefix='/api/matches')
    Owner = Annotated[str, Depends(owner_session)]

    @router.get('/{match_id}/windows', response_model=list[MatchWindow])
    def windows(match_id: str, request: Request, owner: Owner):
        try: return build_windows(request.app.state.matches.get_match(match_id, owner))
        except KeyError: raise HTTPException(404, 'Match not found') from None

    @router.post('/{match_id}/explanations', response_model=ExplanationJob, status_code=202)
    async def create(match_id: str, body: ExplanationRequest, request: Request, owner: Owner):
        try: return request.app.state.explanations.submit(match_id, owner, body)
        except KeyError: raise HTTPException(404, 'Match not found') from None
        except ExplanationQueueFull: raise HTTPException(429, 'Local explanation queue is full') from None
        except ValueError: raise HTTPException(422, 'Window or revision is invalid') from None

    @router.get('/{match_id}/explanations/{job_id}', response_model=ExplanationJob)
    def result(match_id: str, job_id: str, request: Request, owner: Owner):
        try: return request.app.state.explanations.get(match_id, job_id, owner)
        except KeyError: raise HTTPException(404, 'Explanation not found') from None

    return router
