from typing import Annotated
from fastapi import APIRouter,Depends,HTTPException,Query,Request,Response
from ..security import owner_session
from ..simulation.replay_models import StatisticsBundle


def statistics_router():
    router=APIRouter(prefix='/api')

    @router.get('/matches/{match_id}/statistics',response_model=StatisticsBundle)
    def statistics(match_id:str,request:Request,response:Response,
                   end_ms:Annotated[int,Query(ge=0,le=5400000)],owner:Annotated[str,Depends(owner_session)]):
        try: result=request.app.state.statistics.get(match_id,owner,end_ms)
        except KeyError: raise HTTPException(404,'Match statistics not found') from None
        response.headers['Cache-Control']='no-store'
        return result
    return router
