"""Synthetic accounting fixtures; importing this module admits no work."""
import importlib
from decimal import Decimal
from hashlib import sha256
import json

from test_azure_chronicle_prose import source, raw
from timepitch.chronicles.models import ChronicleRequest, canonical_bytes


def api():
    m = importlib.import_module('timepitch.chronicles.azure.models')
    assert hasattr(m, 'AzureBinding'), 'Azure accounting contract is not implemented'
    return m, importlib.import_module('timepitch.chronicles.azure.repository')


class Clock:
    def __init__(self): self.now = 1000.
    def __call__(self): return self.now


def binding():
    m, _ = api()
    return m.AzureBinding(id='synthetic-binding', version='1', endpoint='https://synthetic.openai.azure.com/openai/v1/',
        deployment='synthetic-deployment', expected_model='synthetic-model', region='synthetic-region',
        input_token_ceiling=128, input_bound_proof='a'*64)


def ready(path, calls=1):
    m, r = api()
    clock = Clock()
    repo = r.AzureRepository(path, clock=clock)
    b = binding()
    tariff = m.Tariff(currency='EUR', version='synthetic-only', input_per_million=Decimal('1.234'),
                      output_per_million=Decimal('2.345'), quantum=Decimal('0.000001'))
    grant = m.AzureGrant(id='synthetic-grant', mode='public',state_id=repo.state_id, parent_digest=repo.lineage_digest(),
        binding_hash=m.binding_hash(b), expires_at=2000., call_limit=calls, input_limit=128*calls,
        output_limit=2048*calls, money_limit=Decimal('10'), per_owner_calls=calls, tariff=tariff)
    repo.install_grant(grant)
    return repo, clock, b, grant


def request(match='one', locale='en'):
    return ChronicleRequest(engine='grf', match_id=match, trace_hash=source().trace_hash, locale=locale)


def submit(repo, b, owner='alice', match='one', locale='en'):
    return repo.submit(owner, request(match, locale), source(), b)


def prepared(claim):
    m, _ = api()
    body = {'model': claim.binding.deployment, 'store': False, 'max_output_tokens': 2048,
            'input': [{'role': 'user', 'content': canonical_bytes(claim.fact_pack).decode()}]}
    return m.PreparedAzureRequest(body=body, request_hash=sha256(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),
        binding_hash=m.binding_hash(claim.binding), fact_hash=claim.lease.fact_hash,
        input_upper_tokens=claim.binding.input_token_ceiling)


def receipt(claim, permit):
    m, _ = api()
    return m.AzureReceipt(attempt_id=permit.attempt_id, request_hash=permit.request_hash,
        model=claim.binding.expected_model, provider_request_id='synthetic-receipt',
        draft=m.ChronicleDraft.model_validate(raw(claim.request.locale)), error=None,
        elapsed_ms=10, input_tokens=32, output_tokens=16, reasoning_tokens=0)


def checked(claim):
    m, _ = api()
    from timepitch.chronicles.azure.validation import validate_draft
    return validate_draft(claim.fact_pack, m.ChronicleDraft.model_validate(raw(claim.request.locale)), claim.request.locale)


def db_claim(path, worker):
    # A child only opens the synthetic SQLite repository; it cannot contact a model.
    import socket
    def deny(*args, **kwargs): raise AssertionError('DB contention child forbids network')
    socket.create_connection = socket.getaddrinfo = deny
    _, r = api()
    c = r.AzureRepository(path, clock=lambda:1000.).claim(worker)
    return c.lease.job_id if c else None


def terminal(**changes):
    m,_=api()
    data=dict(parent_digest='a'*64,grant_digest='b'*64,binding_hash='c'*64,source_hash='d'*64,
        request_hash='e'*64,attempt_id='synthetic-prior-attempt',outcome='unavailable',charged_dispatches=1,
        reserved_input_tokens=128,reserved_output_tokens=2048,currency='EUR',reserved_money=Decimal('.01'),
        actual_input_tokens=None,actual_output_tokens=None,actual_reasoning_tokens=None,actual_money=None,
        elapsed_ms=1,validation='not_checked',human_review='pending')
    data.update(changes)
    return m.AzureTerminalReceipt(**data)


def forbid_runtime(monkeypatch):
    import socket
    import subprocess
    import httpx
    from timepitch.simulation import engine
    from timepitch.grf.process import GrfProcess
    def deny(*args,**kwargs):raise AssertionError('Offline integration forbids network, models and match execution')
    monkeypatch.setattr(socket,'create_connection',deny)
    monkeypatch.setattr(socket,'getaddrinfo',deny)
    monkeypatch.setattr(subprocess,'Popen',deny)
    monkeypatch.setattr(httpx.HTTPTransport,'handle_request',deny)
    monkeypatch.setattr(httpx.AsyncHTTPTransport,'handle_async_request',deny)
    monkeypatch.setattr(GrfProcess,'run',deny)
    for name in ('simulate_match','simulate_metrics','simulate_statistics'):monkeypatch.setattr(engine,name,deny)
