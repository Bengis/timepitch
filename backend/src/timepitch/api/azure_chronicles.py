"""Versioned browser-only endpoints; no grant/provider/worker mutation surface."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..security import owner_session
from ..chronicles.models import ChronicleRequest
from ..chronicles.azure.models import AzureJobView, AzureStatus
from ..chronicles.azure.repository import AzureBudgetExceeded, AzureConflict
from ..chronicles.azure.service import AzureDisabled, AzureNotPermitted


def azure_chronicles_router():
    router=APIRouter(prefix='/api/chronicles/v2')
    Owner=Annotated[str,Depends(owner_session)]

    def service(request):
        result=getattr(request.app.state,'azure_chronicles',None)
        if result is None:raise HTTPException(503,'Azure chronicles are unavailable')
        return result

    def guarded(operation):
        try:return operation()
        except AzureDisabled:raise HTTPException(503,'Azure generation is disabled') from None
        except (AzureNotPermitted,KeyError):raise HTTPException(404,'Chronicle or source not found') from None
        except AzureBudgetExceeded:raise HTTPException(429,'Azure allowance or queue unavailable',headers={'Retry-After':'15'}) from None
        except AzureConflict:raise HTTPException(409,'Chronicle state or source is stale') from None
        except ValueError:raise HTTPException(422,'Invalid chronicle request or source') from None

    @router.post('',status_code=202,response_model=AzureJobView)
    def create(body:ChronicleRequest,request:Request,owner:Owner):
        return guarded(lambda:service(request).submit(owner,body))

    @router.get('',response_model=AzureJobView|None,responses={204:{'description':'No matching chronicle'}})
    def lookup(engine:str,match_id:str,trace_hash:str,locale:str,request:Request,owner:Owner):
        result=guarded(lambda:service(request).lookup(owner,ChronicleRequest(engine=engine,match_id=match_id,trace_hash=trace_hash,locale=locale)))
        return result if result is not None else Response(status_code=204)

    @router.get('/status',response_model=AzureStatus)
    def status(request:Request,owner:Owner):
        if getattr(request.app.state,'azure_chronicles_config_error',False):
            return AzureStatus(mode='off',worker='off',generation_allowed=False,
                supported_engines=['timepitch','grf'],reason='configuration_unavailable')
        return guarded(lambda:service(request).status(owner))

    @router.get('/{job_id}',response_model=AzureJobView)
    def read(job_id:str,request:Request,owner:Owner):
        return guarded(lambda:service(request).get(owner,job_id))

    return router
