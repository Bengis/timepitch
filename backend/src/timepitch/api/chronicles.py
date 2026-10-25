"""Browser ownership and machine authentication are separate capabilities."""
import asyncio
import json
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from ..security import owner_session
from ..chronicles.models import ChronicleRequest, WorkerClaim, WorkerHeartbeat, WorkerResult, WorkerIdentity
from ..chronicles.repository import ChronicleConflict, ChronicleQueueFull


def chronicles_router():
    router=APIRouter(prefix='/api')
    Owner=Annotated[str,Depends(owner_session)]
    claim_gate=asyncio.Lock()

    def broker(request): return request.app.state.chronicles

    def generation(request,owner):
        settings=request.app.state.chronicles_settings
        if settings.mode=='off': raise HTTPException(503,'Chronicles are disabled')
        if not settings.permits_generation(owner): raise HTTPException(404,'Not found')

    def guarded(operation):
        try: return operation()
        except KeyError: raise HTTPException(404,'Chronicle or match not found') from None
        except ChronicleQueueFull: raise HTTPException(429,'Chronicle queue is full',headers={'Retry-After':'15'}) from None
        except ChronicleConflict: raise HTTPException(409,'Chronicle identity or lease is stale') from None
        except ValueError: raise HTTPException(422,'Invalid chronicle source or result') from None

    async def worker_body(request,model):
        # Also authenticate here if the router is ever mounted without our middleware.
        settings=request.app.state.chronicles_settings
        if not settings.authenticates(request.headers.get('authorization')):
            raise HTTPException(401,'Worker authentication required')
        try:
            data=await request.json()
            if not isinstance(data,dict): raise ValueError()
            for field,expected in (('profile','foundry-qwen2.5-1.5b-gpu4'),('protocol_version','timepitch-ai-worker-1')):
                if field in data and data[field]!=expected: raise HTTPException(409,'Worker contract mismatch')
            if 'worker_id' in data and data['worker_id']!=settings.worker_id:
                raise HTTPException(409,'Worker identity mismatch')
            return model.model_validate(data)
        except (ValidationError,ValueError,json.JSONDecodeError):
            raise HTTPException(422,'Invalid worker payload') from None

    @router.post('/chronicles',status_code=202)
    def create(body:ChronicleRequest,request:Request,owner:Owner):
        generation(request,owner)
        return guarded(lambda:broker(request).submit(owner,body))

    @router.get('/chronicles')
    def lookup(engine:str,match_id:str,trace_hash:str,locale:str,request:Request,owner:Owner):
        result=guarded(lambda:broker(request).lookup(owner,ChronicleRequest(engine=engine,match_id=match_id,trace_hash=trace_hash,locale=locale)))
        return result if result else Response(status_code=204)

    @router.get('/chronicles/{job_id}')
    def read(job_id:str,request:Request,owner:Owner):
        return guarded(lambda:broker(request).get(owner,job_id))

    @router.get('/chronicle-worker-status')
    def status(request:Request):
        return guarded(lambda:broker(request).repository.status())

    @router.post('/ai-worker/heartbeat')
    async def heartbeat(request:Request):
        body=await worker_body(request,WorkerHeartbeat)
        identity=WorkerIdentity(worker_id=body.worker_id)
        return guarded(lambda:broker(request).repository.heartbeat(identity,body.lease,body.model_ready))

    @router.post('/ai-worker/claim')
    async def claim(request:Request):
        body=await worker_body(request,WorkerClaim)
        if claim_gate.locked(): raise HTTPException(429,'Worker already polling',headers={'Retry-After':'15'})
        identity=WorkerIdentity(worker_id=body.worker_id)
        async with claim_gate:
            guarded(lambda:broker(request).repository.heartbeat(identity,None,body.model_ready))
            if not body.model_ready: return Response(status_code=204)
            deadline=asyncio.get_running_loop().time()+15
            while True:
                job=await asyncio.to_thread(guarded,lambda:broker(request).claim(identity))
                if job: return job
                if asyncio.get_running_loop().time()>=deadline or await request.is_disconnected():
                    return Response(status_code=204)
                await asyncio.sleep(min(.5,max(0,deadline-asyncio.get_running_loop().time())))

    @router.post('/ai-worker/result')
    async def complete(request:Request):
        body=await worker_body(request,WorkerResult)
        identity=WorkerIdentity(worker_id=request.app.state.chronicles_settings.worker_id)
        return guarded(lambda:broker(request).complete(identity,body))

    return router
