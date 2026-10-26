"""TP265: traducción comprobada. El control no lee palabras: nombres grabados, números y relojes iguales en cada frase.
Servicio de traducción con caché y libro de gastos, y crónica en vivo traducida. Sin red ni modelo."""
import json

import timepitch.crew.ask as ask
from crew_fixtures import tp229_pack
from test_crew_ask import FakeGateClient, service as ask_service
from test_live_crew import service as live_service
from timepitch.crew.ask import AgentAnswer
from timepitch.crew.translate import apply_translation, native_locale, same_data

NAMES = ['Blackburn Rovers', 'Manchester United', "Steven N'Zonzi", 'Phil Jones']
SOURCE = "Steven N'Zonzi scores at 27:14 and Blackburn Rovers hold 51.17% of the ball."


def test_the_check_reads_names_numbers_and_clocks_only():
    assert same_data(SOURCE, "Steven N'Zonzi marque à 27:14 et Blackburn Rovers a 51,17 % du ballon.", NAMES)
    assert same_data(SOURCE, "Steven N'Zonziが２７:１４に決め、Blackburn Roversは51.17％を保持。", NAMES)  # full-width digits
    assert not same_data(SOURCE, "Steven N'Zonzi marque à 27:14 et Blackburn Rovers a 52 % du ballon.", NAMES)
    assert not same_data(SOURCE, "N'Zonzi marque à 27:14 et Blackburn Rovers a 51,17 % du ballon.", NAMES)  # name changed
    assert not same_data(SOURCE, "Steven N'Zonzi marque à 27:14 contre Manchester United, 51,17 %, Blackburn Rovers.", NAMES)
    assert not same_data(SOURCE, "スティーブン・ンゾンジが27:14に決め、Blackburn Roversは51.17%。", NAMES)  # transliterated


def test_a_sentence_that_fails_keeps_its_checked_source():
    out, kept = apply_translation([SOURCE, 'Phil Jones had 6.'], json.dumps({'sentences': [
        "Steven N'Zonzi marque à 27:14 et Blackburn Rovers a 51,17 % du ballon.", 'Phil Jones en avait 7.']}), NAMES)
    assert kept == 1 and out[1] == 'Phil Jones had 6.'
    assert apply_translation([SOURCE], 'not json', NAMES) == ([SOURCE], 0)


def test_only_english_and_spanish_are_written_directly():
    assert native_locale('es') == 'es' and native_locale('ja') == 'en' and native_locale('en') == 'en'


def fake_translator(text_for):
    async def run(client, sentences, language):
        request = type('R', (), {'content': json.dumps({'max_tokens': 1024}).encode()})()
        await client.gate.before_request(request)
        await client.gate.after_response(type('S', (), {'status_code': 200, 'headers': {}})())
        return AgentAnswer(text=json.dumps({'sentences': [text_for(s) for s in sentences]}), model='gpt-4.1-mini-2025-04-14',
                           input_tokens=300, output_tokens=60)
    return run


def test_translations_are_cached_and_charged_once(tmp_path, monkeypatch):
    svc, _ = ask_service(tmp_path, monkeypatch, lambda tools: '{}')
    calls = []

    def text_for(s):
        calls.append(s)
        return '« ' + s + ' »'
    monkeypatch.setattr(ask, 'run_translator', fake_translator(text_for))
    first = svc.translate([SOURCE], NAMES, 'fr')
    assert first['translated'] == 1 and first['sentences'] == ['« ' + SOURCE + ' »']
    assert svc.translate([SOURCE], NAMES, 'fr') == first and len(calls) == 1


def test_a_question_in_another_language_is_answered_checked_then_translated(tmp_path, monkeypatch):
    def reply(tools):
        pack = tools.pack
        h, a = pack.score
        return json.dumps({'answerable': True, 'sentences': [{'text': f'{pack.home_name} {h}–{a} {pack.away_name}.', 'fact_ids': ['result']}]})
    svc, _ = ask_service(tmp_path, monkeypatch, reply)
    monkeypatch.setattr(ask, 'run_translator', fake_translator(lambda s: s.replace('.', ' 。')))
    answer = svc.ask('grf', 'm1', 'owner-a', 'ja', 'Who won?')
    assert answer['status'] == 'answered' and answer['language'] == 'ja' and answer['translated'] == '1/1'
    assert answer['sentences'][0]['text'].endswith(' 。')


def test_the_live_report_is_translated_when_ready(tmp_path, monkeypatch):
    crew, _ = live_service(tmp_path / 'live')
    svc, _ = ask_service(tmp_path / 'ask', monkeypatch, lambda tools: '{}')
    monkeypatch.setattr(ask, 'run_translator', fake_translator(lambda s: '[fr] ' + s))
    crew.translator = svc
    view = {'headline': 'Blackburn Rovers 1–0 Manchester United', 'paragraphs': [['One.', 'Two.'], ['Three.']]}
    out = crew._translated(view, tp229_pack(), 'fr')
    assert out['headline'] == '[fr] Blackburn Rovers 1–0 Manchester United'
    assert out['paragraphs'] == [['[fr] One.', '[fr] Two.'], ['[fr] Three.']] and out['translated'] == '4/4'
    crew.translator = None
    assert crew._translated(view, tp229_pack(), 'fr') == view
