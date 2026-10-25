import asyncio
import json
import httpx
import pytest
from chronicle_fixtures import pack
from timepitch.chronicles.models import ClaimedJob, LeaseRef, fact_pack_hash
from timepitch.chronicles.http_client import BrokerClient, BrokerError

ORIGIN='https://timepitch.diloclaro.app'
TOKEN='synthetic-offline-test-token-not-a-real-credential'


def claim():
    p=pack()
    return ClaimedJob(lease=LeaseRef(job_id='one',generation=1,lease_token='x'*40,fact_hash=fact_pack_hash(p)),
        fact_pack=p,locale='en',deadline_at=2000.)


@pytest.mark.parametrize('origin',['http://timepitch.diloclaro.app',ORIGIN+'/',ORIGIN+'/evil','https://foreign.example',
    'https://user:pass@timepitch.diloclaro.app',ORIGIN+'?token=x',ORIGIN+':443'])
def test_rejects_noncanonical_or_foreign_origin(origin):
    with pytest.raises(ValueError): BrokerClient(origin,'test-worker',TOKEN)


def test_fixed_origin_headers_timeouts_no_redirect_and_validated_claim():
    seen=[]
    def respond(request):
        seen.append(request)
        assert str(request.url)==ORIGIN+'/api/ai-worker/claim'
        assert request.headers['Authorization']=='Bearer '+TOKEN
        assert request.headers['User-Agent']=='TimePitchWorker/1'
        assert 'cookie' not in request.headers
        assert request.extensions['timeout']=={'connect':5.,'read':20.,'write':5.,'pool':5.}
        return httpx.Response(200,json=claim().model_dump(mode='json'))
    async def run():
        client=BrokerClient(ORIGIN,'test-worker',TOKEN,transport=httpx.MockTransport(respond))
        assert await client.claim(True)==claim()
        await client.close()
    asyncio.run(run()); assert len(seen)==1


@pytest.mark.parametrize('status',[204,401,409,429,500,302])
def test_statuses_no_hidden_retry_or_secret_echo(status):
    seen=[]
    def respond(request):
        seen.append(request)
        return httpx.Response(status,headers={'Location':'https://foreign.example','Retry-After':'999'},text=TOKEN)
    async def run():
        client=BrokerClient(ORIGIN,'test-worker',TOKEN,transport=httpx.MockTransport(respond))
        try:
            if status==204: assert await client.claim(False) is None
            else:
                with pytest.raises(BrokerError) as exc: await client.claim(True)
                assert TOKEN not in str(exc.value)
                if status==429: assert exc.value.retry_after<=15
        finally: await client.close()
    asyncio.run(run()); assert len(seen)==1


@pytest.mark.parametrize('change',['bad_json','oversize','profile','hash','extra','content_type'])
def test_malformed_or_changed_claim_rejected_before_provider(change):
    data=claim().model_dump(mode='json'); headers={'Content-Type':'application/json'}
    if change=='profile': data['profile']='foreign'
    if change=='hash': data['lease']['fact_hash']='c'*64
    if change=='extra': data['command']='run me'
    if change=='content_type': headers['Content-Type']='text/html'
    raw=b'{' if change=='bad_json' else b'x'*40961 if change=='oversize' else json.dumps(data).encode()
    async def run():
        client=BrokerClient(ORIGIN,'test-worker',TOKEN,transport=httpx.MockTransport(lambda _:httpx.Response(200,headers=headers,content=raw)))
        try:
            with pytest.raises(BrokerError): await client.claim(True)
        finally: await client.close()
    asyncio.run(run())
