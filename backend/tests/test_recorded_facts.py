"""FactPack from a GRF physical recording + recorded-events-1 sidecar: synthetic and, if present, the real demo."""
from hashlib import sha256
import gzip
import json
from pathlib import Path

import pytest

from timepitch.chronicles.azure.models import ChronicleDraft
from timepitch.chronicles.azure.validation import validate_draft
from timepitch.chronicles.models import fact_pack_hash
from timepitch.chronicles.recorded_facts import from_grf_recorded
from timepitch.crew import cli

TRACE = '0' * 63 + '1'


def players():
    out = []
    for side in ('home', 'away'):
        for slot in range(11):
            out.append({'id': f'{side}:p{slot}', 'side': side, 'slot': slot, 'name': f'{side.title()} Player {chr(65 + slot)}'})
    return out


def recording(score=(2, 1)):
    return {'schema_version': 'grf-experimental-1', 'engine_version': 'grf-2.10.2-activity-1', 'trace_hash': TRACE,
            'input': {'dataset_version': 'synthetic', 'home_name': 'Home Town', 'away_name': 'Away City', 'players': players()},
            'samples': [{'score': [0, 0], 'match_time_ms': 0}, {'score': list(score), 'match_time_ms': 5520000}],
            'grf_physical': {'score': list(score)}}


def goal(sample, ms, side, actor, credited=None):
    return {'t_ms': ms, 'sample_index': sample, 'match_ms': ms, 'kind': 'goal', 'side': side, 'player_id': actor,
            'extra': {'credited_side': credited or side}}


def gz(value):
    return gzip.compress(json.dumps(value).encode(), mtime=0)


def build(events, score=(2, 1), tamper=None):
    rec = recording(score)
    rec_gz = gz(rec)
    side = {'schema': 'recorded-events-1', 'engine': 'grf', 'engine_version': rec['engine_version'],
            'recording': {'sha256': sha256(rec_gz).hexdigest(), 'trace_hash': rec['trace_hash']}, 'events': events}
    if tamper:
        tamper(side)
    return rec_gz, gz(side)


def events():
    return [goal(100, 600000, 'home', 'home:p9'), goal(200, 1200000, 'away', 'home:p3', credited='away'),
            goal(300, 3000000, 'home', 'home:p9'),
            {'t_ms': 50, 'sample_index': 1, 'match_ms': 50, 'kind': 'pass', 'side': 'home', 'player_id': 'home:p2', 'extra': {}},
            {'t_ms': 70, 'sample_index': 2, 'match_ms': 70, 'kind': 'shot', 'side': 'home', 'player_id': 'home:p9', 'extra': {}}]


def test_goals_scorers_own_goal_and_honest_coverage():
    pack = from_grf_recorded(*build(events()))
    assert pack.score == [2, 1] and pack.full_time_ms == 5520000 and pack.home_name == 'Home Town'
    goals = [f for f in pack.facts if f.kind == 'goal']
    assert [(g.id, g.side, g.own_goal, g.time_ms) for g in goals] == [
        ('goal:grf:100', 'home', False, 600000), ('goal:grf:200', 'away', True, 1200000),
        ('goal:grf:300', 'home', False, 3000000)]
    leader = next(f for f in pack.facts if f.id == 'leader:goals')
    assert leader.player_names == ['Home Player J'] and leader.value == 2  # the own goal is not credited
    shots = next(f for f in pack.facts if f.id == 'comparison:shots')
    assert (shots.value, shots.comparison_value) == (1, 0)
    ids = {f.id for f in pack.facts}
    assert not ids & {'leader:pass_received', 'comparison:pass_received', 'comparison:recoveries',
                      'leader:recoveries', 'comparison:team_possession_pct'}
    assert pack.coverage.events_complete is False and pack.coverage.native_clock is True
    assert any('not exported' in n for n in pack.coverage.notes)


def test_own_goal_draft_passes_only_when_marked():
    pack = from_grf_recorded(*build(events()))
    draft = {'headline': {'text': 'Home Town beat Away City 2–1', 'fact_ids': ['result']},
             'paragraphs': [{'sentences': [{'text': 'Home Player J scored twice for Home Town.', 'fact_ids': ['leader:goals']}]},
                            {'sentences': [{'text': 'Away City were gifted an own goal by Home Player D at 20:00.',
                                            'fact_ids': ['goal:grf:200']}]}]}
    assert validate_draft(pack, ChronicleDraft.model_validate(draft), 'en').semantic_verified is False


@pytest.mark.parametrize('tamper,message', [
    (lambda s: s['recording'].update(sha256='f' * 64), 'another recording'),
    (lambda s: s['recording'].update(trace_hash='f' * 64), 'another recording'),
    (lambda s: s.update(schema='recorded-events-2'), 'Unsupported'),
    (lambda s: s.update(engine_version='other'), 'engine version'),
    (lambda s: s['events'].pop(0), 'final score')])
def test_mismatched_inputs_are_refused(tamper, message):
    with pytest.raises(ValueError, match=message):
        from_grf_recorded(*build(events(), tamper=tamper))


def test_cli_freeze_recorded_writes_canonical_pack(tmp_path, capsys):
    rec_gz, side_gz = build(events())
    (tmp_path / 'r.json.gz').write_bytes(rec_gz)
    (tmp_path / 'r.events.json.gz').write_bytes(side_gz)
    out = tmp_path / 'pack.json'
    assert cli.main(['freeze-recorded', '--recording', str(tmp_path / 'r.json.gz'), '--events',
                     str(tmp_path / 'r.events.json.gz'), '--out', str(out)]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed['fact_hash'] == sha256(out.read_bytes()).hexdigest() == fact_pack_hash(cli.load_source(out))


DEMO = Path(__file__).resolve().parents[2] / '.local' / 'replays-dist' / 'arsenal2003-mancity2024-43'


@pytest.mark.skipif(not (DEMO / 'grf-cal1.events.json.gz').exists(), reason='private demo recording not present')
def test_real_seed43_recording_is_read_faithfully():
    pack = from_grf_recorded((DEMO / 'grf-cal1.json.gz').read_bytes(), (DEMO / 'grf-cal1.events.json.gz').read_bytes())
    assert pack.trace_hash == '0dd67ae120fb5b9db4d82659848ccf2eda910110350085a003f30b8f58ff0e67'
    assert pack.score == [6, 1] and len([f for f in pack.facts if f.kind == 'goal']) == 7
    assert next(f for f in pack.facts if f.id == 'leader:goals').player_names == ['Thierry Henry', 'Gilberto Silva']
    assert 'comparison:shots' not in {f.id for f in pack.facts}  # 39 v 39 shot touches: no comparison
