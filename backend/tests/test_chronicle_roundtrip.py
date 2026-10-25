"""Real worker/broker protocol on ASGI transport; no socket, model or match execution."""
import asyncio
import httpx
from test_chronicle_api import client_for,BODY,ORIGIN
from test_chronicle_worker_client import TOKEN
from test_chronicle_worker import Provider
from timepitch.chronicles.http_client import BrokerClient
from timepitch.chronicles.worker import run_worker
from timepitch.chronicles.worker_state import WorkerOutbox


def test_worker_round_trip_against_owned_in_process_broker(monkeypatch,tmp_path):
    # Fixture broker uses a different explicitly synthetic token; no private config involved.
    from test_chronicle_api import TOKEN as broker_token
    with client_for(monkeypatch,tmp_path)[0] as browser:
        created=browser.post('/api/chronicles',json=BODY,headers={'Origin':ORIGIN}).json()
        async def run():
            stop=asyncio.Event()
            broker=BrokerClient(ORIGIN,'test-worker',broker_token,transport=httpx.ASGITransport(app=browser.app))
            complete=broker.complete
            async def acknowledge(value): await complete(value); stop.set()
            broker.complete=acknowledge
            provider=Provider(); outbox=WorkerOutbox(tmp_path/'worker/active.json',binding='offline-fixture')
            await run_worker(broker,provider,outbox,stop)
            assert provider.calls==1 and outbox.load() is None
        asyncio.run(run())
        saved=browser.get('/api/chronicles/'+created['id']).json()
        assert saved['state']=='ready' and saved['calls_reserved']==saved['actual_calls']==4
        assert saved['provenance']=='validated_worker_ai' and saved['text']
