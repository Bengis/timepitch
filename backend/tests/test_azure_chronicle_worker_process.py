"""Fresh OS consumers with synthetic sources and a fake provider; no inference."""
import asyncio
import multiprocessing
import socket
import pytest
from azure_chronicle_fixtures import ready, request, source, Clock
from timepitch.chronicles.azure.settings import AzureSettings
from timepitch.chronicles.azure.service import AzureChronicleService
from test_azure_chronicle_worker import api,FakeProvider


def consumer(path,binding,barrier,queue):
    loop=asyncio.new_event_loop()
    def deny(*_):raise AssertionError('Child network forbidden')
    socket.socket.connect=deny;socket.getaddrinfo=deny
    from timepitch.chronicles.azure.models import AzureBinding
    from timepitch.chronicles.azure.repository import AzureRepository
    from timepitch.chronicles.azure.worker import run_once
    b=AzureBinding.model_validate_json(binding)
    service=AzureChronicleService(AzureRepository(path,clock=Clock()),lambda *_:source(),AzureSettings(mode='public',binding=b))
    provider=FakeProvider();barrier.wait(15)
    outcome=loop.run_until_complete(run_once(service,provider,'child'))
    queue.put((outcome.state,provider.calls));loop.close()


def test_two_processes_dispatch_at_most_once(tmp_path):
    api();path=tmp_path/'runtime.sqlite';repo,_,b,_=ready(path)
    repo.submit('alice',request(),source(),b)
    ctx=multiprocessing.get_context('spawn');barrier=ctx.Barrier(2);queue=ctx.Queue()
    children=[ctx.Process(target=consumer,args=(path,b.model_dump_json(),barrier,queue)) for _ in range(2)]
    try:
        for child in children:child.start()
        for child in children:child.join(25);assert child.exitcode==0
        values=[queue.get(timeout=3) for _ in children]
        assert sum(calls for _,calls in values)==1
        assert sum(state=='ready' for state,_ in values)==1
        assert repo.usage()['charged_calls']==1
    finally:
        for child in children:
            if child.is_alive():child.terminate();child.join(5)
        queue.close();queue.join_thread()
