"""M1 event-centered passive contexts. Portable, bounded, no engine import."""
import hashlib
import json
import math
from pathlib import Path
import re
import zlib

VERSION = 'm1-shot-context-1'
MAX_FRAMES, MAX_TRANSACTIONS = 303, 400
MAX_RECORD, MAX_COMPRESSED, MAX_EXPANDED, MAX_ATTESTATION = 65536, 8*1024*1024, 32*1024*1024, 8192


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def keys(v, names):
    if type(v) is not dict or set(v) != set(names): raise ValueError('shot context schema')


def integer(v, lo=0, hi=7440000):
    if type(v) is not int or not lo <= v <= hi: raise ValueError('shot context integer bounds')


def point(p):
    if type(p) is not list or len(p) != 2: raise ValueError('shot context point')
    for n in p:
        if type(n) not in (int, float) or not math.isfinite(n): raise ValueError('shot context finite coordinate')


def _identity(v):
    keys(v, ('run_id', 'mode', 'input_hash', 'native_sha256', 'profile_identity', 'build_manifest_sha256'))
    if not re.fullmatch(r'M-observe-42|m1/(calibration/0[1-8]|heldout/(0[1-9]|1[0-9]|2[0-4]))', v['run_id']):
        raise ValueError('shot context run identity')
    if v['mode'] != ('observe' if v['run_id'] == 'M-observe-42' else 'apply'): raise ValueError('shot context mode')
    for k in ('input_hash', 'native_sha256', 'profile_identity', 'build_manifest_sha256'):
        if type(v[k]) is not str or not re.fullmatch('[a-f0-9]{64}', v[k]): raise ValueError('shot context digest')


def _json(raw):
    def pairs(xs):
        result = {}
        for k, v in xs:
            if k in result: raise ValueError('duplicate context key')
            result[k] = v
        return result
    try:
        v = json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('finite JSON')))
        def depth(x, level=0):
            if level > 20: raise ValueError('context nesting')
            if isinstance(x, dict):
                for y in x.values(): depth(y, level+1)
            elif isinstance(x, list):
                for y in x: depth(y, level+1)
        depth(v); return v
    except (RecursionError, UnicodeError, json.JSONDecodeError) as e: raise ValueError('invalid context JSON') from e


def _contacts(xs):
    if type(xs) is not list or len(xs) > 100000: raise ValueError('contact bound')
    last_seq = last_ms = -1
    for x in xs:
        keys(x, ('raw_seq', 'physics_ms', 'period', 'relocation_id', 'origin'))
        integer(x['raw_seq'], 0, 99999); integer(x['physics_ms']); integer(x['period'], 1, 2); integer(x['relocation_id'])
        if x['origin'] != 'open_play_shot' or x['raw_seq'] <= last_seq or x['physics_ms'] < last_ms:
            raise ValueError('confirmed contact order/provenance')
        last_seq, last_ms = x['raw_seq'], x['physics_ms']


def _windows(contacts, end_ms):
    windows = []
    for s in contacts:
        anchor = 100*((s['physics_ms']+99)//100)
        start, end = max(0, anchor-2000), min(end_ms, anchor+1000)
        if windows and start <= windows[-1]['end_ms']:
            windows[-1]['end_ms'] = max(end, windows[-1]['end_ms']); windows[-1]['raw_seqs'].append(s['raw_seq'])
        else: windows.append(dict(start_ms=start, end_ms=end, raw_seqs=[s['raw_seq']]))
    return windows


def _pairs(xs):
    if type(xs) is not list or len(xs) > 3: raise ValueError('mark pair bound')
    owners, targets = set(), set()
    for m in xs:
        if type(m) is not list or len(m) != 2: raise ValueError('mark pair shape')
        for v in m: integer(v, 0, 2**31-1)
        if m[0] in owners or m[1] in targets: raise ValueError('duplicate marking ownership')
        owners.add(m[0]); targets.add(m[1])


def _lineage(l, ms, actors):
    keys(l, ('player', 'request_seq', 'request_ms', 'selection_ms', 'mirror_sign', 'queued', 'selected_index',
        'selected_function', 'selected', 'movement_selected', 'animation_before', 'animation_after',
        'strategy_direction', 'strategy_velocity', 'hunt', 'hunt_input'))
    if l['player'] not in actors: raise ValueError('lineage actor')
    integer(l['request_seq'], 1, 2**63-1); integer(l['request_ms'], 0, ms)
    integer(l['selection_ms'], -1, ms)
    if l['selection_ms'] != -1 and l['selection_ms'] < l['request_ms']: raise ValueError('selection chronology')
    if l['mirror_sign'] not in (-1, 1): raise ValueError('lineage mirror')
    if type(l['selected']) is not bool or type(l['movement_selected']) is not bool: raise ValueError('lineage booleans')
    if type(l['queued']) is not list or len(l['queued']) > 64: raise ValueError('queue bound')
    for c in l['queued']:
        keys(c, ('function', 'direction', 'velocity')); integer(c['function'], 0, 14); point(c['direction'])
        if type(c['velocity']) not in (int, float) or not math.isfinite(c['velocity']) or c['velocity'] < 0:
            raise ValueError('queue velocity')
    f = -1
    if l['selected']:
        integer(l['selected_index'], 0, len(l['queued'])-1); f = l['queued'][l['selected_index']]['function']
        if l['selection_ms'] < 0: raise ValueError('unobserved selection')
    elif l['selected_index'] != -1: raise ValueError('failed selection index')
    if l['selected_function'] != f or l['movement_selected'] != (l['selected'] and f == 1):
        raise ValueError('nonmovement cannot be successful movement')
    if l['strategy_direction'] is None:
        if l['strategy_velocity'] is not None: raise ValueError('strategy unavailable')
    else:
        point(l['strategy_direction'])
        if type(l['strategy_velocity']) not in (int, float) or not math.isfinite(l['strategy_velocity']): raise ValueError('strategy velocity')
    for k in ('animation_before', 'animation_after'): integer(l[k], 0, 2**32-1)
    if l['hunt'] not in ('unobserved', 'manual', 'designated', 'no_opponent', 'possession', 'marked', 'outside_radius',
                         'not_closest', 'no_defending_movement', 'hunting', 'not_evaluated'):
        raise ValueError('hunt rejection reason')
    h = l['hunt_input']
    if h is not None:
        keys(h, ('force_magnet', 'best_possession', 'marked', 'opponent', 'predicted_distance_m', 'radius_m'))
        if any(type(h[k]) is not bool for k in ('force_magnet', 'best_possession', 'marked')): raise ValueError('hunt guard booleans')
        integer(h['opponent'], 0, 2**31-1)
        for k in ('predicted_distance_m', 'radius_m'):
            if type(h[k]) not in (int, float) or not math.isfinite(h[k]) or h[k] < 0: raise ValueError('hunt guard scalar')
    return int(l['movement_selected']), int(l['selected'] and f != 1)


def _transaction(tx, mode):
    """Validate the complete native input and independently recompute ordered pairs."""
    x = tx['input']; c = tx['context']
    keys(x, ('time_ms', 'team', 'period', 'relocation_id', 'dynamic_side', 'guard_eligible',
             'own_ids', 'players', 'threat_ids', 'quality', 'actual_prior_marks'))
    keys(c, ('initialized', 'team', 'period', 'relocation_id', 'dynamic_side', 'eligible'))
    if type(c['initialized']) is not bool or type(c['eligible']) is not bool or type(x['guard_eligible']) is not bool:
        raise ValueError('native eligibility boolean')
    if x['dynamic_side'] not in (-1, 1): raise ValueError('native mirror')
    if c['initialized']:
        if c['team'] != x['team'] or c['period'] not in (1, 2) or c['dynamic_side'] not in (-1, 1): raise ValueError('native previous context')
        integer(c['relocation_id'])
    elif c != dict(initialized=False, team=-1, period=0, relocation_id=0, dynamic_side=0, eligible=False):
        raise ValueError('native cold context')
    players = {}
    if type(x['players']) is not list or len(x['players']) > 22: raise ValueError('native player cap')
    for p in x['players']:
        keys(p, ('id', 'team', 'active', 'keeper', 'manual', 'ball_contest', 'position'))
        integer(p['id'], 0, 2**31-1); integer(p['team'], 0, 1); point(p['position'])
        if p['id'] in players or any(type(p[k]) is not bool for k in ('active', 'keeper', 'manual', 'ball_contest')):
            raise ValueError('native player identity')
        players[p['id']] = p
    own = x['own_ids']; threats = x['threat_ids']; q = x['quality']; prior = x['actual_prior_marks']
    if type(own) is not list or len(own) > 11 or len(set(own)) != len(own) or set(own) != {
        p['id'] for p in players.values() if p['team'] == x['team'] and p['active']}:
        raise ValueError('native own order/membership')
    if type(threats) is not list or len(threats) > 3 or len(set(threats)) != len(threats) or any(
        t not in players or players[t]['team'] == x['team'] or not players[t]['active'] for t in threats):
        raise ValueError('native threats')
    if type(q) is not list or len(q) != len(own): raise ValueError('native Q rows')
    for row in q:
        if type(row) is not list or len(row) != len(threats) or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in row):
            raise ValueError('native Q columns/scalars')
    if type(prior) is not list or len(prior) > 11: raise ValueError('native prior cap')
    seen_owners, previous = set(), {}
    for pair in prior:
        if type(pair) is not list or len(pair) != 2: raise ValueError('native prior pair')
        a, b = pair
        if a not in players or b not in players or a in seen_owners or b in previous or players[a]['keeper'] or players[a]['team'] != x['team'] or players[b]['team'] == x['team']:
            raise ValueError('native prior identity')
        seen_owners.add(a); previous[b] = a
    pool = [a for a in own if not players[a]['keeper']]
    reference = []; remaining = list(pool)
    for rank, target in enumerate(threats):
        if not remaining: break
        owner = max(remaining, key=lambda a: q[own.index(a)][rank])
        reference.append([owner, target]); remaining.remove(owner)
    compatible = c['initialized'] and c['eligible'] and x['guard_eligible'] and all(c[k] == x[k] for k in ('period', 'dynamic_side', 'relocation_id'))
    reset = ('cold_start' if not c['initialized'] else 'epoch_reset' if any(c[k] != x[k] for k in ('period', 'dynamic_side', 'relocation_id'))
             else 'eligibility_reset' if not c['eligible'] or not x['guard_eligible'] else '')
    selected = []; remaining = list(pool); reasons = []
    for rank, target in enumerate(threats):
        if not remaining: break
        owner = max(remaining, key=lambda a: q[own.index(a)][rank]); proposed = owner; old = previous.get(target)
        code = reset or 'native_choice'; old_distance = new_distance = None
        distance = lambda a: math.hypot(*(players[a]['position'][i]-players[target]['position'][i] for i in (0, 1)))
        if old is not None:
            old_distance, new_distance = distance(old), distance(owner)
            if not reset:
                if not players[old]['active']: code = 'previous_owner_inactive'
                elif old not in remaining: code = 'owner_consumed'
                elif any(players[a]['manual'] or players[a]['ball_contest'] for a in (old, owner)): code = 'override_guard_disabled'
        if compatible and old in remaining and old != owner and not any(
            players[a]['manual'] or players[a]['ball_contest'] for a in (old, owner)):
            if old_distance <= 2 and new_distance > 6: owner = old; code = 'close_handover_retained'
        reasons.append(dict(rank=rank, target=target, native_owner=proposed, reference_owner=reference[rank][0],
            previous_owner=-1 if old is None else old, code=code, previous_distance_m=old_distance, native_distance_m=new_distance))
        selected.append([owner, target]); remaining.remove(owner)
    if tx['reference_pairs'] != reference or tx['pairs'] != selected: raise ValueError('native ordered marking decision')
    if sorted(tx['actual_pairs']) != sorted(reference if mode == 'observe' else selected): raise ValueError('committed pairs/mode')
    if type(tx['reasons']) is not list or len(tx['reasons']) != len(selected): raise ValueError('marking reasons')
    for rank, reason in enumerate(tx['reasons']):
        keys(reason, ('rank', 'target', 'native_owner', 'reference_owner', 'previous_owner', 'code', 'previous_distance_m', 'native_distance_m'))
        for k, expected in reasons[rank].items():
            if k.endswith('_distance_m') and expected is not None:
                value = reason[k]
                if type(value) not in (int, float) or not math.isfinite(value) or not math.isclose(value, expected, rel_tol=0, abs_tol=1e-8):
                    raise ValueError('reason distance')
            elif reason[k] != expected: raise ValueError('reason identity/predicate')


def _validate_record(r, expected_rows, expected_shots):
    keys(r, ('version', 'mode', 'complete', 'overflowed', 'end_ms', 'triggers', 'observed_contacts', 'frames', 'transactions'))
    if r['version'] != VERSION or r['mode'] not in ('observe', 'apply'): raise ValueError('context version/mode')
    if type(r['complete']) is not bool or r['overflowed'] is not False: raise ValueError('overflowed context')
    integer(r['end_ms'])
    if r['end_ms'] % 100: raise ValueError('context end grid')
    _contacts(expected_shots); _contacts(r['observed_contacts']); _contacts(r['triggers'])
    if r['observed_contacts'] != expected_shots or r['triggers'] != expected_shots[:6]: raise ValueError('first six contact binding')
    if any(s['physics_ms'] > r['end_ms'] for s in expected_shots): raise ValueError('future contact')
    windows = _windows(r['triggers'], r['end_ms'])
    expected_times = {ms for w in windows for ms in range(w['start_ms'], w['end_ms']+1, 100)}
    if type(r['frames']) is not list or len(r['frames']) > MAX_FRAMES: raise ValueError('context frame cap')
    if type(r['transactions']) is not list or len(r['transactions']) > MAX_TRANSACTIONS: raise ValueError('context transaction cap')
    rows = {}
    for row in expected_rows:
        ms = row['physics_ms']
        if ms in rows: raise ValueError('duplicate source row')
        rows[ms] = row
    last_ms = -1; times = set(); resets = []; epoch = None; movement = nonmovement = 0
    for f in r['frames']:
        if len(canonical(f)) > MAX_RECORD: raise ValueError('context record cap')
        keys(f, ('row', 'marks', 'contexts', 'designated', 'lineage')); row = f['row']
        keys(row, ('physics_ms', 'period', 'relocation_id', 'attack_direction', 'players'))
        ms = row['physics_ms']; integer(ms, 0, r['end_ms']); integer(row['period'], 1, 2); integer(row['relocation_id'])
        if ms not in expected_times or ms <= last_ms or ms % 100: raise ValueError('selected frame ordering/window')
        if ms not in rows or canonical(rows[ms]) != canonical(row): raise ValueError('source sample identity')
        if row['attack_direction'] not in ([1, -1], [-1, 1]): raise ValueError('frame mirror')
        current = (row['period'], row['relocation_id'], tuple(row['attack_direction']))
        if epoch is not None and current != epoch: resets.append(ms)
        epoch = current; times.add(ms); last_ms = ms
        actors = set(); members = {}
        if type(row['players']) is not list or not 1 <= len(row['players']) <= 22: raise ValueError('frame players')
        for p in row['players']:
            keys(p, ('id', 'team', 'position', 'velocity', 'active')); integer(p['id'], 0, 2**31-1); integer(p['team'], 0, 1)
            if p['id'] in actors or type(p['active']) is not bool: raise ValueError('frame actor')
            actors.add(p['id']); members[p['id']] = p; point(p['position']); point(p['velocity'])
        if len(f['marks']) != 2 or len(f['contexts']) != 2 or len(f['designated']) != 3: raise ValueError('frame state')
        for team, ps in enumerate(f['marks']):
            _pairs(ps)
            for owner, target in ps:
                if owner not in members or target not in members or members[owner]['team'] != team or members[target]['team'] == team or not members[owner]['active']:
                    raise ValueError('frame marking identity')
        for team, c in enumerate(f['contexts']):
            if c is not None:
                keys(c, ('initialized', 'team', 'period', 'relocation_id', 'dynamic_side', 'eligible'))
                if c['initialized'] is not True or c['team'] != team or type(c['eligible']) is not bool or c['dynamic_side'] not in (-1, 1):
                    raise ValueError('frame context identity')
                if (c['period'], c['relocation_id']) != current[:2]: raise ValueError('stale context at reset')
        for index, actor in enumerate(f['designated']):
            integer(actor, -1, 2**31-1)
            if actor != -1 and (actor not in members or index > 0 and members[actor]['team'] != index-1): raise ValueError('designated actor identity')
        if type(f['lineage']) is not list or len(f['lineage']) > 22: raise ValueError('frame lineage bound')
        seen = set()
        for l in f['lineage']:
            if l['player'] in seen: raise ValueError('duplicate lineage')
            seen.add(l['player']); a, b = _lineage(l, ms, actors); movement += a; nonmovement += b
    if times != expected_times: raise ValueError('missing selected frame: cannot interpolate')
    last_tx = -1
    for tx in r['transactions']:
        if len(canonical(tx)) > MAX_RECORD: raise ValueError('transaction record cap')
        keys(tx, ('physics_ms', 'team', 'mirror_sign', 'period', 'relocation_id', 'input', 'context', 'reference_pairs', 'pairs', 'actual_pairs', 'reasons'))
        if tx['mirror_sign'] not in (-1, 1): raise ValueError('transaction mirror')
        ms = tx['physics_ms']; integer(ms, 0, r['end_ms']); integer(tx['team'], 0, 1)
        if ms < last_tx or not any(w['start_ms'] <= ms <= w['end_ms'] for w in windows): raise ValueError('transaction chronology/window')
        last_tx = ms
        for k in ('reference_pairs', 'pairs', 'actual_pairs'): _pairs(tx[k])
        x = tx['input']
        if (x['time_ms'], x['team'], x['period'], x['relocation_id']) != (ms, tx['team'], tx['period'], tx['relocation_id']):
            raise ValueError('native snapshot identity')
        _transaction(tx, r['mode'])
    missing = sum(max(0, 100*((s['physics_ms']+99)//100)+1000-r['end_ms'])//100 for s in r['triggers'])
    return dict(complete=r['complete'], selected_contacts=len(r['triggers']), frames=len(times), transactions=len(r['transactions']),
        windows=windows, posthistory_missing=missing, reset_boundaries=resets, interpolated_frames=0,
        movement_selected=movement, nonmovement_selected=nonmovement, observation='available' if r['triggers'] else 'insufficient')


def validate_record(r, expected_rows, expected_shots):
    try: return _validate_record(r, expected_rows, expected_shots)
    except (KeyError, TypeError, IndexError, OverflowError) as e: raise ValueError('malformed shot context') from e


def write_shot_context_sidecar(path, identity, record):
    _identity(identity)
    if type(record.get('frames')) is not list or len(record['frames']) > MAX_FRAMES: raise ValueError('context frame cap')
    if any(type(f) is not dict or 'row' not in f for f in record['frames']): raise ValueError('source row schema')
    validate_record(record, [f['row'] for f in record['frames']], record['observed_contacts'])
    if record['mode'] != identity['mode']: raise ValueError('record mode identity')
    attestation = dict(identity=identity, record_sha256=hashlib.sha256(canonical(record)).hexdigest())
    if len(canonical(attestation)) > MAX_ATTESTATION: raise ValueError('attestation cap')
    raw = canonical(dict(attestation=attestation, record=record))
    if len(raw) > MAX_EXPANDED: raise ValueError('expanded sidecar cap')
    compressed = zlib.compress(raw)
    if len(compressed) > MAX_COMPRESSED: raise ValueError('compressed sidecar cap')
    with Path(path).open('xb') as f: f.write(compressed)


def validate_shot_context_sidecar(path, identity, expected_rows, expected_shots):
    _identity(identity)
    with Path(path).open('rb') as f: compressed = f.read(MAX_COMPRESSED+1)
    if len(compressed) > MAX_COMPRESSED: raise ValueError('compressed sidecar cap')
    try:
        stream = zlib.decompressobj(); raw = stream.decompress(compressed, MAX_EXPANDED+1)
        if len(raw) > MAX_EXPANDED or stream.unconsumed_tail or stream.unused_data or not stream.eof: raise ValueError('expanded sidecar cap/trailing data')
    except zlib.error as e: raise ValueError('sidecar compression') from e
    envelope = _json(raw); keys(envelope, ('attestation', 'record')); a = envelope['attestation']
    keys(a, ('identity', 'record_sha256'))
    if len(canonical(a)) > MAX_ATTESTATION or a['identity'] != identity: raise ValueError('sidecar identity')
    r = envelope['record']
    if a['record_sha256'] != hashlib.sha256(canonical(r)).hexdigest() or r['mode'] != identity['mode']: raise ValueError('sidecar content/mode binding')
    return validate_record(r, expected_rows, expected_shots)
