"""TP263: «Pregúntale al partido». Herramientas sobre los hechos, comprobación de cada frase, respuesta con los hechos si
falla, preguntas ajenas, límites, caché y libro de gastos. El agente se sustituye: sin red ni modelo."""
from decimal import Decimal
import json

import pytest

import timepitch.crew.ask as ask
from crew_fixtures import NOW, grant, tp229_pack
from timepitch.crew.ask import (AgentAnswer, AskBusy, AskService, AskSettings, MatchTools, check_answer, question_pack)
from timepitch.crew.ledger import CrewLedger


def packs():
    full = tp229_pack()
    half = full.model_copy(update={'period': 'half_time', 'facts': [f for f in full.facts if f.kind != 'goal' or f.time_ms < 2700000]})
    return full, half


def tools():
    full, half = packs()
    pack, first = question_pack(full, half)
    return pack, MatchTools(pack, first)


def test_tools_hand_out_facts_and_remember_them():
    pack, t = tools()
    match_result, goals, top_players, team_comparison = t.functions()
    result = json.loads(match_result())
    assert result[0]['fact_id'] == 'result' and result[0]['home'] == pack.home_name
    first = json.loads(goals('first'))
    assert all(g['fact_id'] in t.first for g in first)
    whole = json.loads(team_comparison('whole_match'))
    assert all(not c['fact_id'].startswith('ht:') for c in whole)
    assert t.fetched[0] == 'result' and set(t.fetched) >= {g['fact_id'] for g in first}


def test_a_checked_answer_passes_and_cites_fetched_facts_only():
    pack, t = tools()
    t.functions()[0]()
    h, a = pack.score
    good = json.dumps({'answerable': True, 'sentences': [{'text': f'{pack.home_name} {h}–{a} {pack.away_name}.', 'fact_ids': ['result']}]})
    assert check_answer(pack, t.fetched, good, 'en') == ('answered', [{'text': f'{pack.home_name} {h}–{a} {pack.away_name}.', 'fact_ids': ['result']}], None)
    goal = next(f for f in pack.facts if f.kind == 'goal')
    unfetched = json.dumps({'answerable': True, 'sentences': [{'text': f'{goal.player_names[0]} scores.', 'fact_ids': [goal.id]}]})
    status, sentences, reason = check_answer(pack, t.fetched, unfetched, 'en')
    assert status == 'facts_only' and sentences[0]['fact_ids'] == ['result'] and reason == 'unfetched_fact'


def test_an_invented_number_falls_back_to_the_fetched_facts():
    pack, t = tools()
    t.functions()[3]('whole_match')
    bad = json.dumps({'answerable': True, 'sentences': [{'text': f'{pack.home_name} had 99 shots.', 'fact_ids': [t.fetched[0]]}]})
    status, sentences, reason = check_answer(pack, t.fetched, bad, 'en')
    assert status == 'facts_only' and len(sentences) == min(4, len(t.fetched)) and reason == 'unsupported_number'


def test_an_off_topic_question_gets_no_text_from_the_model():
    pack, t = tools()
    assert check_answer(pack, t.fetched, json.dumps({'answerable': False, 'sentences': []}), 'en') == ('off_topic', [], None)
    status, sentences, reason = check_answer(pack, [], 'not json', 'en')
    assert status == 'facts_only' and sentences[0]['fact_ids'] == ['result'] and reason == 'invalid_answer'


# ---- servicio ------------------------------------------------------------------------------------------------

class FakeGateClient:
    """Stands for the chat client: the fake agent below drives the gate as two real requests would."""
    def __init__(self, gate):
        self.gate = gate


def fake_agent(reply):
    async def run(client, tools, locale, question):
        gate = client.gate
        for _ in range(2):  # a tool round and the final answer
            request = type('R', (), {'content': json.dumps({'max_tokens': 1024}).encode()})()
            await gate.before_request(request)
            await gate.after_response(type('S', (), {'status_code': 200, 'headers': {}})())
        tools.functions()[0]()
        return AgentAnswer(text=reply(tools), model='gpt-4.1-mini-2025-04-14', input_tokens=1200, output_tokens=80)
    return run


def service(tmp_path, monkeypatch, reply, *, max_reports=20, clock=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    env = tmp_path / 'ask-envelope.json'
    env.write_bytes(grant(max_reports=max_reports, locales=['en', 'es']).model_dump_json().encode())
    env.chmod(0o600)
    full, half = packs()

    def source(engine, match_id, owner, period='full_time'):
        return half if period == 'half_time' else full
    monkeypatch.setattr(ask, 'run_agent', fake_agent(reply))
    clock = clock or [NOW]
    svc = AskService(source, AskSettings(mode='on', envelope=env, credential='entra'), tmp_path / 'ask',
                     client_factory=FakeGateClient, now=lambda: clock[0])
    return svc, clock


def result_reply(tools):
    pack = tools.pack
    h, a = pack.score
    return json.dumps({'answerable': True, 'sentences': [{'text': f'{pack.home_name} {h}–{a} {pack.away_name}.', 'fact_ids': ['result']}]})


def test_a_question_is_answered_charged_in_its_ledger_and_cached(tmp_path, monkeypatch):
    svc, _ = service(tmp_path, monkeypatch, result_reply)
    answer = svc.ask('grf', 'm1', 'owner-a', 'en', '  Who   won? ', '203.0.113.7')
    assert answer['status'] == 'answered' and answer['calls'] == 2 and Decimal(answer['cost']) > 0
    assert svc.ask('grf', 'm1', 'owner-a', 'en', 'who won?') == answer  # same question: no new call
    ledgers = list((tmp_path / 'ask').glob('ask-ledger-*.sqlite'))
    assert len(ledgers) == 1
    stored = (tmp_path / 'ask' / 'questions.json').read_text(encoding='utf-8')
    assert '203.0.113.7' not in stored and svc.remaining() == 19


def test_question_limits(tmp_path, monkeypatch):
    svc, clock = service(tmp_path, monkeypatch, result_reply, max_reports=40)
    for i in range(ask.OWNER_DAILY):
        svc.ask('grf', 'm1', 'owner-a', 'en', f'question number {i}')
    with pytest.raises(AskBusy, match='daily_limit'):
        svc.ask('grf', 'm1', 'owner-a', 'en', 'one more question')
    with pytest.raises(ValueError):
        svc.ask('grf', 'm1', 'owner-b', 'en', 'x' * 201)
    svc2, _ = service(tmp_path / 'b', monkeypatch, result_reply, max_reports=1)
    svc2.ask('grf', 'm1', 'owner-a', 'en', 'who won?')
    with pytest.raises(AskBusy, match='budget_exhausted'):
        svc2.ask('grf', 'm1', 'owner-b', 'en', 'who scored?')


def test_the_ledger_refuses_a_fourth_request_for_one_question(tmp_path):
    g = grant(max_reports=5, locales=['en'])
    ledger = CrewLedger(tmp_path / 'l.sqlite', g, 'a' * 64, now=lambda: NOW)
    gate = ask.ask_gate(ledger, 'b' * 64)
    import asyncio
    request = type('R', (), {'content': json.dumps({'max_tokens': 1024}).encode()})()
    for _ in range(3):
        asyncio.run(gate.before_request(request))
    from timepitch.crew.ledger import EnvelopeRefused
    with pytest.raises(EnvelopeRefused, match='calls_exhausted'):
        asyncio.run(gate.before_request(request))
