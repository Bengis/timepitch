"""Validate a rehashed V2 replay against physical, causal and catalogue constraints."""
from collections import defaultdict
from math import ceil, hypot
from .models import TraceViolation
from .metrics import metrics_until
from .replay import trace_hash, encode_replay, sample_frame
from .spatial import initial_world, arrange_restart
from .motion import capture_sample


def validate_v2(record, catalog):
    from .engine import _prepare
    violations, codes = [], set()

    def fail(where, code):
        # Bound diagnostics even for a wholly malicious trace.
        if code not in codes:
            violations.append(TraceViolation(event_id=str(where), code=code))
            codes.add(code)

    try:
        state, teams = _prepare(record.config, catalog)
    except (ValueError, KeyError):
        return [TraceViolation(event_id='config', code='config_mismatch')]
    expected_world = initial_world(record.config, teams, state.profiles)
    expected_initial = expected_world.snapshot()
    if (record.seed != record.config.seed or record.initial_frame != expected_initial
            or record.home_name != teams['home'].name or record.away_name != teams['away'].name):
        fail('initial', 'config_mismatch')
    if (record.dataset_version != catalog.dataset_version or record.engine_version != 'engine-2'
            or record.rules_version != 'rules-2' or record.ratings_version != 'ratings-1'
            or (record.metrics_version == 'basic-2') != (record.statistics is None)):
        fail('version', 'incompatible_version')
    try:
        if record.trace_hash != trace_hash(record): fail('hash', 'hash_mismatch')
        encode_replay(record)
    except ValueError: fail('size', 'invalid_encoding')
    samples, events = record.motion, record.events
    if not samples: return violations+[TraceViolation(event_id='initial', code='missing_motion')]
    if len(events) > 4000 or len(samples) > 25601: fail('size', 'trace_limit')
    initial = capture_sample(expected_world, 1)
    if samples[0] != initial: fail('initial', 'invalid_initial_frame')
    players = expected_world.players
    keys = {p.key for p in players}
    player_by_key = {p.key: p for p in players}
    by_sample, seen = defaultdict(list), {}
    previous_time, half_count, full_count = -1, 0, 0
    used_goals, used_saves = set(), set()
    for event in events:
        if event.id in seen: fail(event.id, 'duplicate_event')
        if (event.t1_ms < previous_time or event.t0_ms > event.released_ms or event.released_ms > event.t1_ms
                or any(t % 250 for t in [event.t0_ms, event.released_ms, event.t1_ms])):
            fail(event.id, 'invalid_clock')
        if event.t0_ms < 2700000 < event.t1_ms: fail(event.id, 'crossed_period')
        if any(key not in keys for key in event.participants): fail(event.id, 'unknown_participant')
        if event.side is not None and event.participants and event.participants[0] in keys:
            actor = next(p for p in players if p.key == event.participants[0])
            if actor.side != event.side: fail(event.id, 'participant_side_mismatch')
        if event.evidence.get('possession_side') not in ('home', 'away'): fail(event.id, 'invalid_possession_evidence')
        if not (0 <= event.origin_sample_index <= event.sample_index < len(samples)):
            fail(event.id, 'invalid_sample_index')
            continue
        source, target = samples[event.origin_sample_index], samples[event.sample_index]
        actor = player_by_key.get(event.participants[0]) if event.participants else None
        if (event.released_ms != source.clock_ms or event.t1_ms != target.clock_ms
                or event.period != target.period): fail(event.id, 'invalid_clock')
        if event.origin_mm != (source.ball_x_mm, source.ball_y_mm) or event.end_mm != (target.ball_x_mm, target.ball_y_mm):
            fail(event.id, 'event_geometry_mismatch')
        for related in event.related_event_ids:
            if related not in seen: fail(event.id, 'invalid_event_relation')
        if event.type in ('pass', 'shot', 'carry'):
            if not event.participants: fail(event.id, 'missing_actor')
            elif event.participants[0] in keys:
                index = next(p.index for p in players if p.key == event.participants[0])
                if hypot(source.player_xy_mm[2*index]-source.ball_x_mm,
                         source.player_xy_mm[2*index+1]-source.ball_y_mm) > 1801:
                    fail(event.id, 'actor_without_access')
            if event.type in ('pass', 'shot'):
                tx, ty = event.evidence.get('target_x_mm'), event.evidence.get('target_y_mm')
                if type(tx) is not int or type(ty) is not int or not (0 <= tx <= 105000 and 0 <= ty <= 68000):
                    fail(event.id, 'invalid_flight_target')
                elif event.outcome in ('complete', 'intercepted', 'saved'):
                    if hypot(target.ball_x_mm-tx, target.ball_y_mm-ty) > 1801:
                        fail(event.id, 'control_without_access')
                if type(tx) is int and type(ty) is int:
                    distance = hypot(tx-source.ball_x_mm, ty-source.ball_y_mm)
                    speed = 15 if event.type == 'pass' else 26
                    duration = max(250, ceil(distance/(speed*250))*250)
                    flight_samples = samples[event.origin_sample_index:event.sample_index+1]
                    if (event.t1_ms-event.released_ms != duration or source.carrier_index != -1
                            or source.ball_mode != 1 or source.reset_code or actor is None
                            or source.possession_index != (0 if actor.side == 'home' else 1)):
                        fail(event.id, 'invalid_flight')
                    for offset, point in enumerate(flight_samples):
                        fraction = min(1., speed*(point.clock_ms-source.clock_ms)/distance) if distance else 1.
                        ex = source.ball_x_mm+(tx-source.ball_x_mm)*fraction
                        ey = source.ball_y_mm+(ty-source.ball_y_mm)*fraction
                        last = offset == len(flight_samples)-1
                        tolerance = 1802 if last and event.outcome in ('complete', 'intercepted', 'saved') else 2
                        if (point.reset_code or point.period != source.period
                                or point.clock_ms != source.clock_ms+offset*250
                                or (not last and (point.ball_mode != 1 or point.carrier_index != -1))
                                or hypot(point.ball_x_mm-ex, point.ball_y_mm-ey) > tolerance):
                            fail(event.id, 'invalid_flight')
            if event.type == 'shot':
                if event.outcome == 'goal':
                    direction = 1 if (event.side == 'home') == (event.period == 1) else -1
                    goal_x = 105000 if direction == 1 else 0
                    if (target.ball_mode != 1 or target.carrier_index != -1
                            or target.ball_x_mm != goal_x or not 30340 <= target.ball_y_mm <= 37660
                            or tx != goal_x or not isinstance(ty, int) or not 30340 <= ty <= 37660):
                        fail(event.id, 'invalid_shot_resolution')
                elif event.outcome == 'saved':
                    winner = players[target.carrier_index] if target.carrier_index >= 0 else None
                    if (winner is None or winner.role != 'GK' or winner.side == event.side
                            or target.ball_mode != 0 or event.participants[-1:] != [winner.key]):
                        fail(event.id, 'invalid_control_actor')
                elif event.outcome != 'off_target' or target.carrier_index != -1 or target.ball_mode != 1:
                    fail(event.id, 'invalid_shot_resolution')
                if event.outcome in ('goal', 'off_target') and target.clock_ms not in (2700000, 5400000):
                    following = samples[event.sample_index+1] if event.sample_index+1 < len(samples) else None
                    if following is None or following.reset_code != (3 if event.outcome == 'goal' else 4):
                        fail(event.id, 'missing_shot_restart')
            if event.type == 'pass':
                receiver = player_by_key.get(event.participants[1]) if len(event.participants) >= 2 else None
                winner = players[target.carrier_index] if target.carrier_index >= 0 else None
                controlled = event.outcome in ('complete', 'intercepted')
                if (receiver is None or receiver.side != event.side or receiver == actor
                        or event.outcome not in ('complete', 'intercepted', 'incomplete')
                        or (controlled and (winner is None or winner == actor or target.ball_mode != 0
                            or event.participants[-1:] != [winner.key]
                            or (winner.side == event.side) != (event.outcome == 'complete')))
                        or (not controlled and (winner is not None or target.ball_mode != 1))):
                    fail(event.id, 'invalid_control_actor')
        if event.type in ('save', 'recovery'):
            if (actor is None or target.ball_mode != 0 or target.carrier_index != actor.index
                    or event.participants != [actor.key] or (event.type == 'save' and actor.role != 'GK')):
                fail(event.id, 'invalid_control_actor')
        if event.type in ('pressure', 'tackle'):
            victim = player_by_key.get(event.participants[1]) if len(event.participants) == 2 else None
            won = event.outcome == 'won_ball'
            if (actor is None or victim is None or actor.side == victim.side
                    or event.outcome not in ('won_ball', 'held') or (event.type == 'pressure' and won)
                    or target.carrier_index != (actor.index if won else victim.index)
                    or hypot(target.player_xy_mm[2*actor.index]-target.player_xy_mm[2*victim.index],
                             target.player_xy_mm[2*actor.index+1]-target.player_xy_mm[2*victim.index+1])
                       > (1802 if event.type == 'tackle' else 6002)):
                fail(event.id, 'invalid_control_actor')
        if event.type in ('goal', 'save'):
            shot_id = event.evidence.get('shot_id')
            shot = seen.get(shot_id)
            used = used_goals if event.type == 'goal' else used_saves
            if (shot is None or shot.type != 'shot' or shot_id in used
                    or shot.outcome != ('goal' if event.type == 'goal' else 'saved')
                    or shot.sample_index != event.sample_index or shot_id not in event.related_event_ids
                    or (shot.side == event.side) != (event.type == 'goal')
                    or (event.type == 'goal' and event.participants != shot.participants[:1])
                    or (event.type == 'save' and event.participants != shot.participants[-1:])):
                fail(event.id, 'unresolved_goal' if event.type == 'goal' else 'unresolved_save')
            used.add(shot_id)
        if event.type == 'halftime':
            half_count += 1
            if event.t1_ms != 2700000 or target.reset_code != 2: fail(event.id, 'invalid_halftime')
        if event.type == 'fulltime':
            full_count += 1
            if event.t1_ms != 5400000 or event.sample_index != len(samples)-1: fail(event.id, 'missing_fulltime')
        by_sample[event.sample_index].append(event)
        seen[event.id] = event
        previous_time = event.t1_ms
    if {e.id for e in events if e.type == 'shot' and e.outcome == 'goal'} != used_goals:
        fail('shots', 'unresolved_shot')
    if {e.id for e in events if e.type == 'shot' and e.outcome == 'saved'} != used_saves:
        fail('shots', 'unresolved_shot')
    if half_count != 1: fail('interval', 'invalid_halftime')
    if full_count != 1 or not events or events[-1].type != 'fulltime': fail('final', 'missing_fulltime')
    score = [0, 0]
    previous, velocities = None, [(0., 0.)]*22
    regular, resets = 0, 0
    for index, sample in enumerate(samples):
        markers = by_sample[index]
        if sample.clock_ms % 250: fail(index, 'invalid_clock')
        for event in markers:
            if event.type == 'goal' and event.side in ('home', 'away'):
                score[0 if event.side == 'home' else 1] += 1
        if [sample.home_goals, sample.away_goals] != score: fail(index, 'score_mismatch')
        expected_period = 1 if sample.clock_ms < 2700000 else 2
        if sample.clock_ms == 2700000 and sample.reset_code != 2 and (previous is None or previous.period == 1):
            expected_period = 1
        if sample.period != expected_period: fail(index, 'invalid_period')
        xy = sample.player_xy_mm
        if len(xy) != 44 or any(not 0 <= xy[i] <= (105000 if i%2 == 0 else 68000) for i in range(len(xy))):
            fail(index, 'invalid_geometry')
            continue
        if sample.carrier_index >= 0:
            carrier = sample.carrier_index
            if carrier >= 22 or ((carrier < 11) != (sample.possession_index == 0)):
                fail(index, 'invalid_carrier')
            elif (xy[carrier*2], xy[carrier*2+1]) != (sample.ball_x_mm, sample.ball_y_mm):
                fail(index, 'invalid_carrier')
            if sample.ball_mode == 1: fail(index, 'invalid_carrier')
        elif sample.ball_mode == 0: fail(index, 'invalid_carrier')
        if previous is not None:
            elapsed = sample.clock_ms-previous.clock_ms
            if sample.reset_code:
                resets += 1
                if elapsed != 0: fail(index, 'unjustified_reset')
                cause = next((e for e in markers if e.type == ('halftime' if sample.reset_code == 2 else 'restart')), None)
                justified = cause is not None and sample.reset_code in (2, 3, 4)
                if justified and sample.reset_code in (3, 4):
                    source = seen.get(cause.evidence.get('shot_id'))
                    justified = (source is not None and source.type == 'shot' and source.sample_index == index-1
                        and source.outcome == ('goal' if sample.reset_code == 3 else 'off_target')
                        and cause.side != source.side and source.id in cause.related_event_ids)
                if not justified: fail(index, 'unjustified_reset')
                else:
                    expected_world.clock, expected_world.period = sample.clock_ms, sample.period
                    expected_world.home_goals, expected_world.away_goals = score
                    arrange_restart(expected_world, ('home', 'away')[sample.possession_index], sample.reset_code != 4)
                    expected = capture_sample(expected_world, sample.reset_code)
                    if sample != expected: fail(index, 'invalid_reset_geometry')
                velocities = [(0., 0.)]*22
            else:
                regular += 1
                if elapsed != 250: fail(index, 'invalid_clock')
                if elapsed > 0:
                    next_velocities = []
                    for p in players:
                        vx, vy = (xy[2*p.index]-previous.player_xy_mm[2*p.index])/elapsed, (xy[2*p.index+1]-previous.player_xy_mm[2*p.index+1])/elapsed
                        speed = hypot(vx, vy)
                        if speed > p.max_speed+.01: fail(index, 'speed_limit')
                        old = velocities[p.index]
                        # Millimetre quantization can reverse a tiny speed decrease.
                        limit = 5.05 if speed < hypot(*old)+.01 else 4.05
                        if hypot(vx-old[0], vy-old[1])/(elapsed/1000) > limit: fail(index, 'acceleration_limit')
                        next_velocities.append((vx, vy))
                    velocities = next_velocities
                    if hypot(sample.ball_x_mm-previous.ball_x_mm, sample.ball_y_mm-previous.ball_y_mm) > 26*elapsed+1801:
                        fail(index, 'ball_speed_limit')
                    if sample.carrier_index != previous.carrier_index and sample.carrier_index >= 0:
                        key = players[sample.carrier_index].key
                        if not any(key in e.participants and e.type in ('pass', 'recovery', 'save', 'tackle') for e in markers):
                            fail(index, 'unresolved_control')
        previous = sample
    if regular != 21600 or resets > 4000 or samples[-1].clock_ms != 5400000: fail('final', 'invalid_clock')
    if record.metrics != metrics_until(record, 5400000): fail('metrics', 'metrics_mismatch')
    if record.metrics.home.possession_ms+record.metrics.away.possession_ms != 5400000:
        fail('metrics', 'possession_time_mismatch')
    if not violations and record.metrics_version == 'metrics-1':
        from ..statistics.queries import statistics_until
        if record.statistics != statistics_until(record,5400000): fail('statistics','statistics_mismatch')
    return violations
