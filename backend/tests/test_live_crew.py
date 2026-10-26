"""TP253: crónica IA en vivo. Hechos de partidos guardados (TouchLines y GRF físico), servicio con cola y blobs falsos,
lista de sobres del job y rutas HTTP. Sin red."""
from decimal import Decimal
import gzip
import json
from types import SimpleNamespace

import pytest

from crew_fixtures import NOW, grant, tp229_pack
from test_crew_cloud import BINDING, FakeQueue, FakeStore, Never
from test_recorded_facts import gz, players
from timepitch.chronicles.live_facts import from_grf_physical
from timepitch.chronicles.models import fact_pack_hash
from timepitch.chronicles.recorded_facts import from_recorded
from timepitch.crew.cloud import build_request, failed_name, report_name, run_job_once
from timepitch.crew.live import CLIENT_DAILY, LiveCrew, LiveCrewBusy, LiveCrewSettings, report_view
from timepitch.crew.models import request_hash

TRACE = '0' * 63 + '2'


# ---- hechos ------------------------------------------------------------------------------------------------

def touchlines_recording(score=(1, 1)):
    return {'engine_version': 'touchlines-test', 'trace_hash': TRACE,
            'input': {'dataset_version': 'synthetic', 'home_name': 'Home Town', 'away_name': 'Away City', 'players': players()},
            'samples': [{'score': [0, 0], 'match_time_ms': 0}, {'score': list(score), 'match_time_ms': 5400000}]}


def touchlines_events(goals):
    return {'schema': 'recorded-events-1', 'engine': 'touchlines', 'engine_version': 'touchlines-test',
            'recording': {'id': 'live:x', 'file': None, 'sha256': None, 'trace_hash': TRACE}, 'events': goals}


def tl_goal(sample, ms, side, actor):
    return {'t_ms': ms, 'sample_index': sample, 'match_ms': ms, 'kind': 'goal', 'side': side, 'player_id': actor}


def test_live_touchlines_recording_gives_goals_scorers_and_its_own_notes():
    pack = from_recorded(gz(touchlines_recording()), gz(touchlines_events([
        tl_goal(239, 23900, 'home', 'home:p9'), tl_goal(4732, 473200, 'away', 'away:p9')])), 'touchlines')
    assert pack.engine == 'touchlines' and pack.score == [1, 1]
    goals = [f for f in pack.facts if f.kind == 'goal']
    assert [(f.side, f.player_names, f.time_ms) for f in goals] == [('home', ['Home Player J'], 23900), ('away', ['Away Player J'], 473200)]
    assert pack.coverage.notes[0].startswith('TouchLines recording')


def test_touchlines_goals_must_match_the_score_and_the_trace():
    with pytest.raises(ValueError):
        from_recorded(gz(touchlines_recording((2, 1))), gz(touchlines_events([tl_goal(239, 23900, 'home', 'home:p9')])), 'touchlines')
    other = touchlines_events([])
    other['recording']['trace_hash'] = 'f' * 64
    with pytest.raises(ValueError):
        from_recorded(gz(touchlines_recording((0, 0))), gz(other), 'touchlines')


def native(seq, kind, ms, actor_team, player, team=0, own=False, type_='goal'):
    return SimpleNamespace(seq=seq, type=type_, kind=kind, match_time_ms=ms, actor_team=actor_team, player=player,
                           team=team, own_goal=own)


def physical_manifest(score=(2, 1)):
    ps = [SimpleNamespace(id=p['id'], side=p['side'], slot=p['slot'], name=p['name']) for p in players()]
    return SimpleNamespace(trace_hash=TRACE, score=score, input=SimpleNamespace(
        players=ps, dataset_version='synthetic', home_name='Home Town', away_name='Away City'))


def test_grf_physical_match_gives_goals_from_its_stored_chunks():
    chunks = [SimpleNamespace(events=[native(1, 'shot', 600000, 0, 9, type_='touch'), native(2, 'goal', 600100, 0, 9, team=0)]),
              SimpleNamespace(events=[native(3, 'goal', 3000000, 1, 4, team=1), native(4, 'goal', 5100000, 1, 2, team=0, own=True)])]
    pack = from_grf_physical(physical_manifest(), chunks)
    goals = [f for f in pack.facts if f.kind == 'goal']
    assert [(f.side, f.player_names, f.own_goal) for f in goals] == [('home', ['Home Player J'], False),
                                                                     ('away', ['Away Player E'], False), ('home', ['Away Player C'], True)]
    assert pack.full_time_ms == 5100000
    with pytest.raises(ValueError):
        from_grf_physical(physical_manifest((3, 1)), chunks)


# ---- servicio ----------------------------------------------------------------------------------------------

class SentQueue:
    def __init__(self):
        self.sent = []

    def send(self, body):
        self.sent.append(body)


def service(tmp_path, *, g=None, clock=None, blobs=None, source=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    env = tmp_path / 'envelope.json'
    env.write_bytes((g or grant(max_reports=3, locales=['en', 'es'])).model_dump_json().encode())
    env.chmod(0o600)  # the service only reads private envelope files
    clock = clock or [NOW]
    pack = tp229_pack()
    crew = LiveCrew(source or (lambda engine, match_id, owner: pack), LiveCrewSettings(mode='on', envelope=env),
                    tmp_path / 'live', queue=SentQueue(), blobs=blobs or FakeStore(), now=lambda: clock[0])
    return crew, clock


def test_request_queues_one_message_for_the_match_and_is_idempotent(tmp_path):
    crew, _ = service(tmp_path)
    first = crew.request('grf', 'physical-1', 'owner-a', 'es')
    assert first == {'status': 'pending', 'request_hash': request_hash(fact_pack_hash(tp229_pack()), 'es', BINDING)}
    assert crew.request('grf', 'physical-1', 'owner-a', 'es') == first
    assert len(crew._queue.sent) == 1
    assert crew.status('grf', 'physical-1', 'owner-a', 'es')['status'] == 'pending'


def test_one_in_flight_per_owner_a_daily_limit_and_the_envelope_cap(tmp_path):
    packs = {}

    def source(engine, match_id, owner):
        return packs.setdefault(match_id, tp229_pack().model_copy(update={'trace_hash': f'{len(packs) + 1:064x}'}))
    crew, clock = service(tmp_path, source=source)
    crew.request('grf', 'm1', 'owner-a', 'en')
    with pytest.raises(LiveCrewBusy, match='one_in_flight'):
        crew.request('grf', 'm2', 'owner-a', 'en')
    crew.request('grf', 'm2', 'owner-b', 'en')
    crew.request('grf', 'm3', 'owner-c', 'en')
    with pytest.raises(LiveCrewBusy, match='budget_exhausted'):
        crew.request('grf', 'm4', 'owner-d', 'en')
    assert crew.remaining() == 0 and len(crew._queue.sent) == 3



def test_new_sessions_from_one_ip_share_its_daily_limit_and_the_ip_is_not_stored(tmp_path):
    packs = {}

    def source(engine, match_id, owner):
        return packs.setdefault(match_id, tp229_pack().model_copy(update={'trace_hash': f'{len(packs) + 1:064x}'}))
    crew, clock = service(tmp_path, g=grant(max_reports=40, locales=['en', 'es']), source=source)
    for i in range(CLIENT_DAILY):  # a fresh cookie each time: the owner limits never apply
        crew.request('grf', f'm{i}', f'owner-{i}', 'en', '203.0.113.7')
    with pytest.raises(LiveCrewBusy, match='daily_limit'):
        crew.request('grf', 'm-extra', 'owner-extra', 'en', '203.0.113.7')
    crew.request('grf', 'm-other', 'owner-other', 'en', '198.51.100.9')
    stored = (tmp_path / 'live' / 'requests.json').read_text(encoding='utf-8')
    assert '203.0.113.7' not in stored and '198.51.100.9' not in stored

def test_failed_marker_and_timeout_close_the_request(tmp_path):
    blobs = FakeStore()
    crew, clock = service(tmp_path, blobs=blobs)
    rh = crew.request('grf', 'm1', 'owner-a', 'en')['request_hash']
    blobs.blobs[failed_name(rh)] = json.dumps({'code': 'envelope_not_allowed'}).encode()
    assert crew.status('grf', 'm1', 'owner-a', 'en') == {'status': 'failed', 'request_hash': rh, 'code': 'envelope_not_allowed'}
    crew2, clock2 = service(tmp_path / 'b')
    rh2 = crew2.request('grf', 'm1', 'owner-a', 'en')['request_hash']
    clock2[0] += 16 * 60
    assert crew2.status('grf', 'm1', 'owner-a', 'en') == {'status': 'failed', 'request_hash': rh2, 'code': 'timeout'}


def test_unknown_engine_or_match_is_not_found(tmp_path):
    def source(engine, match_id, owner):
        raise KeyError(match_id)
    crew, _ = service(tmp_path, source=source)
    with pytest.raises(KeyError):
        crew.request('grf', 'someone-else', 'owner-a', 'en')
    with pytest.raises(KeyError):
        crew.request('timepitch', 'x', 'owner-a', 'en')


# ---- job: solo el sobre permitido ---------------------------------------------------------------------------

def test_job_refuses_an_envelope_outside_the_allowlist_without_calls():
    queue, reports = FakeQueue(), FakeStore()
    body, rh = build_request(tp229_pack(), 'en', grant().model_dump_json().encode(), BINDING, now=lambda: NOW)
    queue.put(body)
    status = run_job_once(queue=queue, reports=reports, binding=BINDING, crew_runner=Never(), now=lambda: NOW,
                          allowed=frozenset({'a' * 64}))
    assert status == {'status': 'rejected', 'code': 'envelope_not_allowed', 'request_hash': rh}
    assert json.loads(reports.blobs[failed_name(rh)])['code'] == 'envelope_not_allowed' and report_name(rh) not in reports.blobs


# ---- vista ---------------------------------------------------------------------------------------------------

def test_report_view_keeps_only_what_the_sealed_report_says():
    draft = SimpleNamespace(headline=SimpleNamespace(text='Home win'),
                            paragraphs=[SimpleNamespace(sentences=[SimpleNamespace(text='One.'), SimpleNamespace(text='Two.')])])
    report = SimpleNamespace(draft=draft, fallback_text=None, steps=[SimpleNamespace(model='gpt-4.1-mini'), SimpleNamespace(model=None)],
                             source=SimpleNamespace(trace_hash=TRACE, engine='grf'), locale='en', coverage_notes=['n'],
                             total_cost=Decimal('0.0041'), report_sha256='b' * 64, provenance='crew_ai_draft_checked')
    view = report_view(report)
    assert view['headline'] == 'Home win' and view['paragraphs'] == [['One.', 'Two.']] and view['model'] == 'gpt-4.1-mini'
    assert view['total_cost'] == '0.0041' and view['evaluation'] is None


def test_report_view_turns_the_fallback_score_into_the_headline():
    report = SimpleNamespace(draft=None, fallback_text='Home 0–0 Away\n\nOne.\n\nTwo.', steps=[], locale='en', coverage_notes=[],
                             source=SimpleNamespace(trace_hash=TRACE, engine='grf'), total_cost=Decimal('0.0028'),
                             report_sha256='b' * 64, provenance='deterministic_fallback')
    view = report_view(report)
    assert view['headline'] == 'Home 0–0 Away' and view['paragraphs'] == [['One.'], ['Two.']]


def test_writer_keeps_the_home_side_first_when_the_away_side_won():
    # TP253: la primera crónica en vivo (Arsenal 0–3 Manchester City) cayó al respaldo por un «3–0» en el titular.
    from timepitch.crew.agents import writer_rules
    from timepitch.crew.checks import RULES
    assert 'never 3–0' in writer_rules('en') and 'Never write any score in the paragraphs' in writer_rules('es')
    assert any('home first' in option for option in RULES['unsupported_score'][1])


def test_verifier_accepts_the_away_side_first_only_with_both_full_names():
    # TP253: «Manchester City 3–0 Arsenal» es correcto si gana el visitante; «3–0» suelto o al revés, no.
    from timepitch.chronicles.azure.validation import DraftRejected, _number_checks
    pack = tp229_pack().model_copy(update={'home_name': 'Arsenal', 'away_name': 'Manchester City', 'score': [0, 3]})
    result = [f for f in pack.facts if f.kind == 'result']
    _number_checks('Arsenal 0–3 Manchester City', pack, result, 'en')
    _number_checks('Manchester City 3–0 Arsenal', pack, result, 'en')
    for wrong in ('Manchester City won 3–0', 'Arsenal 3–0 Manchester City'):
        with pytest.raises(DraftRejected):
            _number_checks(wrong, pack, result, 'en')
