import json
from pathlib import Path
import pytest
from timepitch.catalog.repository import CatalogRepository
from timepitch.simulation.engine import make_config, simulate_match, simulate_metrics, validate_trace
from timepitch.simulation.replay import encode_replay, parse_replay, trace_hash
from timepitch.simulation.replay_models import MatchRecordV2

DATASET = Path(__file__).resolve().parents[2] / 'research/data-audit/2026-10-16/derived/coverage.sqlite'


@pytest.fixture(scope='module')
def catalog(): return CatalogRepository(DATASET)


@pytest.fixture(scope='module')
def record(catalog): return simulate_match(make_config(catalog, 'arsenal:2003', 'mancity:2017', 42), catalog)


def test_generated_match_has_canonical_motion_and_deterministic_fast_path(catalog, record):
    assert isinstance(record, MatchRecordV2)
    assert record.motion[0].clock_ms == 0
    assert record.motion[-1].clock_ms == 5400000
    assert sum(s.reset_code == 0 for s in record.motion) <= 21601
    assert all(s.clock_ms % 250 == 0 for s in record.motion)
    assert simulate_match(record.config, catalog).trace_hash == record.trace_hash
    assert simulate_metrics(record.config, catalog) == record.metrics
    assert validate_trace(record, catalog) == []
    assert {v.code for v in validate_trace(record)} == {'missing_catalog'}
    assert len(encode_replay(record)) <= 16*1024*1024
    assert all('simulated_xg' not in e.evidence for e in record.events if e.type == 'pass')


@pytest.mark.parametrize('change,code', [('jump', 'speed_limit'), ('reset', 'unjustified_reset'),
    ('clock', 'invalid_clock'), ('score', 'score_mismatch'), ('acceleration', 'acceleration_limit'),
    ('coordinate', 'event_geometry_mismatch'), ('carrier', 'invalid_carrier')])
def test_rehashed_motion_tampering_is_rejected(catalog, record, change, code):
    assert isinstance(record, MatchRecordV2)
    wire = json.loads(encode_replay(record))
    sample = wire['motion'][10]
    if change == 'jump': sample[-1][0] += 30000
    elif change == 'reset': sample[7] = 4
    elif change == 'clock': sample[0] += 1
    elif change == 'score': sample[2] += 1
    elif change == 'acceleration': sample[-1][0] += 400
    elif change == 'coordinate': wire['events'][3]['origin_mm'][0] += 1
    elif change == 'carrier': sample[5] = 0 if sample[5] != 0 else 1
    forged = parse_replay(wire)
    forged.trace_hash = trace_hash(forged)
    assert code in {v.code for v in validate_trace(forged, catalog)}


def test_reset_and_event_causality_at_period_boundaries(record, catalog):
    assert isinstance(record, MatchRecordV2)
    halftime = next(e for e in record.events if e.type == 'halftime')
    assert halftime.t1_ms == 2700000
    assert record.motion[halftime.sample_index].reset_code == 2
    assert record.motion[halftime.sample_index-1].clock_ms == 2700000
    for event in record.events:
        if event.type in ('goal', 'save'):
            source = next(e for e in record.events if e.id == event.evidence['shot_id'])
            assert source.sample_index == event.sample_index
            assert source.t1_ms == event.t1_ms
            assert source.id in event.related_event_ids
    assert validate_trace(record, catalog) == []


@pytest.mark.parametrize('change', ['unknown_index', 'unmarked_duplicate', 'extra_regular'])
def test_rehashed_reference_and_grid_corruption_rejected(catalog, record, change):
    wire = json.loads(encode_replay(record))
    if change == 'unknown_index': wire['events'][2]['sample_index'] = len(wire['motion'])+1
    elif change == 'unmarked_duplicate': wire['motion'][10][0] = wire['motion'][9][0]
    else: wire['motion'].append(wire['motion'][-1])
    altered = parse_replay(wire)
    altered.trace_hash = trace_hash(altered)
    assert {'invalid_clock', 'invalid_sample_index'} & {v.code for v in validate_trace(altered, catalog)}


def test_rehashed_action_cannot_attribute_an_actor_to_the_opposite_team(catalog, record):
    altered = record.model_copy(deep=True)
    action = next(e for e in altered.events if e.type == 'pass')
    action.side = 'away' if action.side == 'home' else 'home'
    altered.trace_hash = trace_hash(altered)
    assert 'participant_side_mismatch' in {v.code for v in validate_trace(altered, catalog)}


def test_rehashed_goal_requires_a_shot_flight_into_the_attacked_goal(catalog, record):
    from timepitch.simulation.metrics import metrics_until
    altered = record.model_copy(deep=True)
    action = next(e for e in altered.events if e.type == 'carry' and e.t1_ms > e.released_ms)
    action.type, action.outcome = 'shot', 'goal'
    action.evidence.update(simulated_xg=.2, target_x_mm=action.end_mm[0], target_y_mm=action.end_mm[1])
    goal = action.model_copy(deep=True, update={'id': 'forged-goal', 'type': 'goal',
        'outcome': 'scored', 'origin_sample_index': action.sample_index, 't0_ms': action.t1_ms,
        'released_ms': action.t1_ms, 'origin_mm': action.end_mm,
        'related_event_ids': [action.id], 'evidence': {'shot_id': action.id, 'possession_side': action.side}})
    altered.events.insert(altered.events.index(action)+1, goal)
    score = [0, 0]
    goals = {}
    for event in altered.events:
        if event.type == 'goal': goals.setdefault(event.sample_index, []).append(event)
    for index, sample in enumerate(altered.motion):
        for event in goals.get(index, []): score[0 if event.side == 'home' else 1] += 1
        wire = list(sample.root)
        wire[2:4] = score
        altered.motion[index] = type(sample)(tuple(wire))
    altered.metrics = metrics_until(altered, 5400000)
    altered.trace_hash = trace_hash(altered)
    assert 'invalid_shot_resolution' in {v.code for v in validate_trace(altered, catalog)}


def test_rehashed_save_cannot_credit_a_remote_forward_with_the_keeper_as_extra(catalog, record):
    altered = record.model_copy(deep=True)
    save = next(e for e in altered.events if e.type == 'save')
    remote = next(p for p in altered.initial_frame.players if p.side == save.side and p.role == 'FWD')
    save.participants = [remote.key, *save.participants]
    altered.trace_hash = trace_hash(altered)
    assert 'invalid_control_actor' in {v.code for v in validate_trace(altered, catalog)}


@pytest.mark.parametrize('kind', ['pass', 'recovery', 'tackle'])
def test_rehashed_control_requires_the_actual_winner_in_the_declared_role(catalog, record, kind):
    altered = record.model_copy(deep=True)
    event = next(e for e in altered.events if e.type == kind and e.outcome in ('complete', 'won_ball'))
    sample = altered.motion[event.sample_index]
    winner = altered.initial_frame.players[sample.carrier_index]
    remote = next(p for p in altered.initial_frame.players if p.side == winner.side and p.key != winner.key
                  and p.key not in event.participants)
    if kind == 'pass': event.participants[-1] = remote.key
    else: event.participants = [remote.key, winner.key]
    altered.trace_hash = trace_hash(altered)
    assert 'invalid_control_actor' in {v.code for v in validate_trace(altered, catalog)}
