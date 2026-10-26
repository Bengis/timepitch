"""Crew fixtures: a TP229-style pack, scripted fake Azure Responses endpoint, no network."""
import asyncio
from decimal import Decimal
import json
import socket

import httpx2
import pytest

from timepitch.chronicles.models import ChronicleFact, Coverage, EventDescriptor, FactPack
from timepitch.crew.agents import CrewAgents, SendGate, bounded_client, chat_client
from timepitch.crew.ledger import CrewLedger
from timepitch.crew.models import CrewGrant, default_binding, default_tariff, digest
from timepitch.crew.workflow import CrewRuntime

NOW = 1_800_000_000.0


def tp229_pack() -> FactPack:
    """Synthetic replica of the TP229 canary source shape (Blackburn Rovers 1-0 Manchester United)."""
    return FactPack(engine='grf', trace_hash='9' * 64, dataset_version='synthetic-crew-test-only',
        home_name='Blackburn Rovers', away_name='Manchester United', score=[1, 0], full_time_ms=5400000,
        coverage=Coverage(events_complete=True, native_clock=True),
        facts=[ChronicleFact(id='result', kind='result'), ChronicleFact(id='coverage', kind='coverage'),
            ChronicleFact(id='goal:grf:134', kind='goal', side='home', player_ids=['b8'], player_names=["Steven N'Zonzi"],
                value=1., unit='count', time_ms=1634040, event_refs=['grf:134']),
            ChronicleFact(id='leader:goals', kind='actor_stat', metric_id='goals', player_ids=['b8'],
                player_names=["Steven N'Zonzi"], value=1., unit='count'),
            ChronicleFact(id='leader:recoveries', kind='actor_stat', metric_id='recoveries', player_ids=['m4'],
                player_names=['Phil Jones'], value=6., unit='count'),
            ChronicleFact(id='comparison:shots', kind='team_compare', side='home', metric_id='shots', value=7.,
                comparison_value=5., unit='count', availability='derived'),
            ChronicleFact(id='comparison:pass_received', kind='team_compare', side='home', metric_id='pass_received',
                value=31., comparison_value=27., unit='count', availability='derived'),
            ChronicleFact(id='comparison:recoveries', kind='team_compare', side='home', metric_id='recoveries',
                value=23., comparison_value=21., unit='count', availability='derived'),
            ChronicleFact(id='comparison:team_possession_pct', kind='team_compare', side='home',
                metric_id='team_possession_pct', value=51.17, comparison_value=48.83, unit='percent', availability='derived')],
        events=[EventDescriptor(id='grf:134', type='goal', time_ms=1634040, side='home')])


PLAN = {'angle': 'narrow_win', 'paragraphs': [['goal:grf:134', 'leader:goals'],
        ['comparison:team_possession_pct', 'comparison:shots', 'comparison:pass_received', 'comparison:recoveries']]}

# The TP229 canary draft: the headline names Steven N'Zonzi but cites only `result`.
CANARY = {'headline': {'text': "Steven N'Zonzi scores to give Blackburn Rovers a 1-0 lead over Manchester United",
                       'fact_ids': ['result']},
    'paragraphs': [
        {'sentences': [{'text': "Steven N'Zonzi scored the only goal of the match for Blackburn Rovers at 27:14 minutes, "
                                'securing a 1-0 lead against Manchester United.', 'fact_ids': ['goal:grf:134', 'leader:goals']}]},
        {'sentences': [{'text': 'Blackburn Rovers held 51.2% possession and outshot Manchester United 7 to 5, while also '
                                "receiving 31 passes compared to United's 27 and making 23 recoveries to United's 21.",
                        'fact_ids': ['comparison:team_possession_pct', 'comparison:shots', 'comparison:pass_received',
                                     'comparison:recoveries']}]}]}

# crew-fixer-3 cites a player named in several facts, so CANARY alone is now fixed without a revision. The revision and
# fallback paths use this variant: the headline also carries a number no cited fact holds, which no fixer may touch.
CANARY_HARD = {**CANARY, 'headline': {'text': "Steven N'Zonzi scores to give Blackburn Rovers a 1-0 lead over Manchester United "
                                               'with 9 shots', 'fact_ids': ['result']}}

FIXED = {'headline': {'text': "Steven N'Zonzi scores as Blackburn Rovers beat Manchester United 1–0",
                      'fact_ids': ['result', 'goal:grf:134']},
    'paragraphs': [
        {'sentences': [{'text': "Steven N'Zonzi scored for Blackburn Rovers at 27:14.", 'fact_ids': ['goal:grf:134']}]},
        {'sentences': [{'text': 'Blackburn Rovers recorded 7 shots and Manchester United had 5.',
                        'fact_ids': ['comparison:shots']}]}]}


# "Dale vida" (24-oct): a lively match report that is still fully cited and passes the validator.
LIVELY = {'headline': {'text': "Steven N'Zonzi strikes as Blackburn Rovers edge Manchester United 1–0",
                       'fact_ids': ['result', 'goal:grf:134']},
    'paragraphs': [
        {'sentences': [{'text': "At 27:14 Steven N'Zonzi struck for Blackburn Rovers, and that lone goal had to carry them "
                                'all the way to the final whistle.', 'fact_ids': ['goal:grf:134']}]},
        {'sentences': [{'text': 'It was tight from end to end: Blackburn Rovers edged the shot count 7 to 5 and won the '
                                'scramble for loose balls with 23 recoveries to 21.',
                        'fact_ids': ['comparison:shots', 'comparison:recoveries']},
                       {'text': 'Possession split almost evenly, 51.2% for Blackburn Rovers against 48.8% for Manchester United.',
                        'fact_ids': ['comparison:team_possession_pct']}]}]}

def reply(payload, *, model='gpt-4.1-mini', usage=(900, 120), request_id=None):
    return {'payload': payload, 'model': model, 'usage': usage, 'request_id': request_id}


class FakeAzure:
    """Scripted Responses endpoint at the httpx transport; never opens a socket."""

    def __init__(self, script):
        self.script = list(script)
        self.requests = []

    async def respond(self, request):
        assert str(request.url) == 'https://timepitch-ai.openai.azure.com/openai/v1/responses'
        self.requests.append(json.loads(request.content))
        if not self.script:
            pytest.fail('Unexpected extra request reached the transport')
        item = self.script.pop(0)
        if item == 'connect_error':
            raise httpx2.ReadTimeout('synthetic lost response', request=request)
        if item == 'http_500':
            return httpx2.Response(500, json={'error': {'message': 'synthetic'}}, headers={'x-request-id': 'req-500'})
        n = len(self.requests)
        value = {'id': f'resp_{n}', 'object': 'response', 'created_at': 0, 'model': item['model'], 'status': 'completed',
                 'output': [{'type': 'message', 'role': 'assistant', 'status': 'completed', 'id': f'msg_{n}',
                             'content': [{'type': 'output_text', 'text': json.dumps(item['payload']), 'annotations': []}]}],
                 'usage': {'input_tokens': item['usage'][0], 'output_tokens': item['usage'][1],
                           'total_tokens': sum(item['usage']), 'input_tokens_details': {'cached_tokens': 0},
                           'output_tokens_details': {'reasoning_tokens': 0}}}
        return httpx2.Response(200, json=value, headers={'x-request-id': item['request_id'] or f'req-{n}'})


class Offline:
    def __init__(self, loop, install):
        self.loop, self.install = loop, install

    def __call__(self, script):
        return self.install(script)

    def run(self, coroutine):
        return self.loop.run_until_complete(coroutine)


@pytest.fixture
def offline(monkeypatch):
    # The Windows proactor loop needs a loopback socketpair, so it is created before sockets are denied.
    loop = asyncio.new_event_loop()

    def deny(*args, **kwargs):
        raise AssertionError('Crew tests forbid network')
    monkeypatch.setattr(socket.socket, 'connect', deny)
    monkeypatch.setattr(socket.socket, 'connect_ex', deny)
    monkeypatch.setattr(socket, 'create_connection', deny)
    monkeypatch.setattr(socket, 'getaddrinfo', deny)
    active = []

    async def respond(_, request):
        return await active[-1].respond(request)
    monkeypatch.setattr(httpx2.AsyncHTTPTransport, 'handle_async_request', respond)

    def install(script):
        fake = script if hasattr(script, 'respond') else FakeAzure(script)  # or any fake with .respond()
        active.append(fake)
        return fake
    try:
        yield Offline(loop, install)
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()


def grant(**changes) -> CrewGrant:
    values = dict(id='crew-test', binding_hash=digest(default_binding()), tariff=default_tariff(), max_reports=2,
                  money_limit=Decimal('0.50'), expires_at=NOW + 3600, input_bound='crew-input-bytes-1')
    values.update(changes)
    return CrewGrant(**values)


class Harness:
    def __init__(self, tmp_path, g=None, *, now=NOW, ledger_name='ledger.sqlite'):
        self.grant = g or grant()
        self.clock = [now]
        self.ledger = CrewLedger(tmp_path / ledger_name, self.grant, 'e' * 64, now=lambda: self.clock[0])
        self.gate = SendGate(self.ledger)
        self.client = bounded_client(default_binding(), 'synthetic-key', self.gate)
        self.agents = CrewAgents(chat_client(default_binding(), self.client))

    def runtime(self, pack=None, locale='en'):
        return CrewRuntime(pack=pack or tp229_pack(), locale=locale, binding=default_binding(), grant=self.grant,
                           grant_sha256='e' * 64, ledger=self.ledger, gate=self.gate, agents=self.agents)

    async def close(self):
        # The ledger stays open so a test can inspect it; resume tests open a second one.
        await self.client.close()


def intents(ledger):
    return ledger.db.execute('SELECT step FROM intents ORDER BY rowid').fetchall()


def receipts(ledger):
    return ledger.db.execute('SELECT step, error FROM receipts ORDER BY rowid').fetchall()
