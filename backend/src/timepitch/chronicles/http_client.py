"""Single fixed HTTPS origin; credentials never follow redirects or environment proxies."""
import httpx
from .models import WorkerClaim, WorkerHeartbeat, WorkerResult, WorkerStatus, ClaimedJob, ChronicleView, fact_pack_hash

ORIGIN='https://timepitch.diloclaro.app'


class BrokerError(RuntimeError):
    def __init__(self, message='Broker unavailable', *, permanent=False, retry_after=0):
        super().__init__(message)
        self.permanent,self.retry_after=permanent,retry_after


class BrokerClient:
    def __init__(self, origin: str, worker_id: str, token: str, *, transport=None):
        if origin!=ORIGIN: raise ValueError('Worker requires the fixed canonical HTTPS origin')
        WorkerClaim(worker_id=worker_id,model_ready=False)
        if not 32<=len(token)<=512 or any(ord(c)<33 or ord(c)>126 for c in token): raise ValueError('Invalid worker credential')
        self.worker_id=worker_id
        self.client=httpx.AsyncClient(base_url=origin,headers={'Authorization':'Bearer '+token,'User-Agent':'TimePitchWorker/1'},
            timeout=httpx.Timeout(20.,connect=5.,write=5.,pool=5.),follow_redirects=False,trust_env=False,
            transport=transport or httpx.AsyncHTTPTransport(retries=0))

    async def _post(self, route, body, model, *, empty=False):
        try:
            async with self.client.stream('POST','/api/ai-worker/'+route,json=body.model_dump(mode='json')) as response:
                if response.status_code==204 and empty: return None
                if response.status_code!=200:
                    retry=0
                    if response.status_code==429:
                        try: retry=max(1,min(15,int(response.headers.get('Retry-After','1'))))
                        except ValueError: retry=1
                    raise BrokerError('Broker refused request',permanent=(400<=response.status_code<500 and response.status_code!=429) or 300<=response.status_code<400,retry_after=retry)
                if response.headers.get('Content-Type','').split(';')[0].strip()!='application/json':
                    raise BrokerError('Invalid broker response')
                data=bytearray()
                async for part in response.aiter_bytes():
                    data.extend(part)
                    if len(data)>40960: raise BrokerError('Broker response exceeds contract')
                try: return model.model_validate_json(bytes(data))
                except ValueError: raise BrokerError('Invalid broker response') from None
        except httpx.HTTPError: raise BrokerError('Broker connection unavailable') from None

    async def claim(self, model_ready):
        job=await self._post('claim',WorkerClaim(worker_id=self.worker_id,model_ready=model_ready),ClaimedJob,empty=True)
        if job and fact_pack_hash(job.fact_pack)!=job.lease.fact_hash: raise BrokerError('Fact identity mismatch',permanent=True)
        return job

    async def heartbeat(self, lease, model_ready):
        return await self._post('heartbeat',WorkerHeartbeat(worker_id=self.worker_id,model_ready=model_ready,lease=lease),WorkerStatus)

    async def complete(self, result: WorkerResult):
        result=WorkerResult.model_validate_json(result.model_dump_json())
        view=await self._post('result',result,ChronicleView)
        if view.id!=result.lease.job_id or view.fact_hash!=result.lease.fact_hash or view.state!='ready':
            raise BrokerError('Result acknowledgement mismatch',permanent=True)

    async def close(self): await self.client.aclose()
