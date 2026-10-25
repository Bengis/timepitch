from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from ..matches.models import MatchJob
from ..matches.service import QueueFullError
from ..security import owner_session
from ..simulation.models import MatchConfig
from ..simulation.replay import ReplayRecord, parse_replay
from pydantic import BeforeValidator
ReplayInput = Annotated[ReplayRecord, BeforeValidator(lambda value: parse_replay(value) if isinstance(value, dict) else value)]


def matches_router():
    router = APIRouter(prefix='/api')
    Owner = Annotated[str, Depends(owner_session)]

    @router.post('/matches', response_model=MatchJob, status_code=202)
    def create(config: MatchConfig, request: Request, owner: Owner):
        try:
            return request.app.state.matches.create_match(config, owner)
        except QueueFullError:
            raise HTTPException(429, 'The local match queue is full') from None
        except (ValueError, KeyError):
            raise HTTPException(422, 'Invalid team, players or formation') from None

    @router.get('/matches', response_model=list[MatchJob])
    def recent(request: Request, owner: Owner):
        return request.app.state.matches.repository.list_jobs(owner)

    @router.get('/matches/{match_id}', response_model=MatchJob)
    def match(match_id: str, request: Request, owner: Owner):
        try:
            return request.app.state.matches.repository.get_job(match_id, owner)
        except KeyError:
            raise HTTPException(404, 'Match not found') from None

    @router.get('/matches/{match_id}/replay', response_model=ReplayRecord)
    def replay(match_id: str, request: Request, response: Response, owner: Owner):
        try:
            record = request.app.state.matches.get_match(match_id, owner)
        except KeyError:
            raise HTTPException(404, 'Replay not found') from None
        response.headers['Content-Disposition'] = f'attachment; filename="timepitch-{match_id}.json"'
        return record

    @router.post('/replays/import', response_model=MatchJob, status_code=201)
    async def import_replay(record: ReplayInput, request: Request, owner: Owner):
        try:
            # FastAPI's JSON decoder keeps the last duplicate key. Retain the
            # documented body schema, but make the original bytes authoritative.
            record = parse_replay(await request.body())
            return request.app.state.matches.import_match(record, owner)
        except (ValueError, KeyError):
            raise HTTPException(422, 'Replay version, participants or integrity are invalid') from None

    return router
