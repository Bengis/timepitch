"""Frozen engine-1 validation; shared by import and legacy regression tests."""
from .models import MatchRecord, TraceViolation
from .metrics import reduce_metrics
from .replay import trace_hash as compute_trace_hash
HALF, FULL = 2700000, 5400000

def validate_legacy_record(record: MatchRecord) -> list[TraceViolation]:
    violations = []
    def fail(event, code):
        violations.append(TraceViolation(event_id=event, code=code))
    def check_carrier(frame, event_id):
        if frame.carrier is not None:
            holder = next((p for p in frame.players if p.key == frame.carrier), None)
            if holder is None or holder.side != frame.possession or (holder.x, holder.y) != (frame.ball.x, frame.ball.y):
                fail(event_id, 'invalid_carrier')
    keys = {p.key for p in record.initial_frame.players}
    identities = {p.key: (p.name, p.role, p.side) for p in record.initial_frame.players}
    expected_keys = {'home:' + key for key in record.config.home_players} | {'away:' + key for key in record.config.away_players}
    if keys != expected_keys or record.seed != record.config.seed: fail('config', 'config_mismatch')
    if len(keys) != 22: fail('initial', 'duplicate_entities')
    if record.initial_frame.clock_ms != 0 or record.initial_frame.period != 1 or record.initial_frame.score.home or record.initial_frame.score.away:
        fail('initial', 'invalid_initial_frame')
    check_carrier(record.initial_frame, 'initial')
    previous = 0
    period = 1
    shots, used_goals, used_saves, ids = {}, set(), set(), set()
    score = {'home': 0, 'away': 0}
    for event in record.events:
        if event.id in ids: fail(event.id, 'duplicate_event')
        ids.add(event.id)
        if event.t0_ms != previous or event.t1_ms < event.t0_ms: fail(event.id, 'invalid_clock')
        if event.t1_ms - event.t0_ms > 6000: fail(event.id, 'invalid_duration')
        duration = event.t1_ms - event.t0_ms
        if event.type not in ('goal', 'save', 'recovery', 'halftime', 'fulltime') and duration < 1500 and event.t1_ms not in (HALF, FULL):
            fail(event.id, 'invalid_duration')
        if event.t0_ms < HALF < event.t1_ms: fail(event.id, 'crossed_period')
        if any(key not in keys for key in event.participants): fail(event.id, 'unknown_participant')
        if event.evidence.get('possession_side') not in ('home', 'away'): fail(event.id, 'invalid_possession_evidence')
        frame = event.frame_after
        if event.type == 'halftime': period = 2
        if frame.period != period: fail(event.id, 'invalid_period')
        if frame.clock_ms != event.t1_ms or {p.key for p in frame.players} != keys: fail(event.id, 'invalid_frame')
        if {p.key: (p.name, p.role, p.side) for p in frame.players} != identities: fail(event.id, 'identity_mismatch')
        if event.type == 'shot': shots[event.id] = event
        if event.type == 'goal':
            source = event.evidence.get('shot_id')
            if source not in shots or source in used_goals or shots[source].outcome != 'goal' or shots[source].side != event.side:
                fail(event.id, 'unresolved_goal')
            used_goals.add(source)
            if event.side: score[event.side] += 1
        if event.type == 'save':
            source = event.evidence.get('shot_id')
            if source not in shots or source in used_saves or shots[source].outcome != 'saved' or shots[source].side == event.side:
                fail(event.id, 'unresolved_save')
            used_saves.add(source)
        if frame.score.model_dump() != score: fail(event.id, 'score_mismatch')
        check_carrier(frame, event.id)
        previous = event.t1_ms
    if not record.events or record.events[-1].type != 'fulltime' or previous != FULL: fail('final', 'missing_fulltime')
    if [e.t1_ms for e in record.events if e.type == 'halftime'] != [HALF]: fail('interval', 'invalid_halftime')
    if {key for key, shot in shots.items() if shot.outcome == 'goal'} != used_goals: fail('shots', 'unresolved_shot')
    if {key for key, shot in shots.items() if shot.outcome == 'saved'} != used_saves: fail('shots', 'unresolved_shot')
    if record.metrics != reduce_metrics(record.events): fail('metrics', 'metrics_mismatch')
    if record.metrics.home.possession_ms + record.metrics.away.possession_ms != FULL: fail('metrics', 'possession_time_mismatch')
    if record.trace_hash != compute_trace_hash(record): fail('hash', 'hash_mismatch')
    return violations
