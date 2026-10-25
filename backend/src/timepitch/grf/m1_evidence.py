"""Replay-derived context-v2 evidence. Pure readers never import native GRF."""
from dataclasses import dataclass
import math
from .physical_wire import canonical,digest
from .shot_context_wire import (keys,integer,point,_contacts,_windows,_pairs,_lineage,_transaction,
    MAX_RECORD,MAX_FRAMES,MAX_TRANSACTIONS)
from .m1_wire import policy_state,read_context,COUNTERS

C4=dict(policy_version='c4-marking-1',policy=dict(marking_floor=.85,threat_radius_m=30.,own_area_duel_floor=.70))


def validate_mapping(mapping,players=None):
    if type(mapping) is not list or len(mapping)!=22:raise ValueError('Exactly22 native identities required')
    slots=set();ids=set()
    for p in mapping:
        keys(p,('side','slot','native_stable_id','active','keeper'))
        integer(p['side'],0,1);integer(p['slot'],0,10);integer(p['native_stable_id'],0,2**31-1)
        key=(p['side'],p['slot'])
        if key in slots or p['native_stable_id'] in ids or any(type(p[k]) is not bool for k in ('active','keeper')):
            raise ValueError('Duplicate/invalid native identity')
        if players is not None:
            person=next(x for x in players if (0 if x.side=='home' else 1,x.slot)==key)
            if p['keeper']!=(person.role=='GK'):raise ValueError('Native/catalogue keeper mismatch')
        slots.add(key);ids.add(p['native_stable_id'])
    return {(p['side'],p['slot']):p for p in mapping}


def replay_frame(row,mapping):
    people=validate_mapping(mapping);actors=[]
    for side in (0,1):
        for slot in range(11):
            p=people[(side,slot)];offset=21+6*(side*11+slot)
            actors.append(dict(id=p['native_stable_id'],team=side,position=list(row[offset:offset+2]),
                velocity=list(row[offset+2:offset+4]),active=bool(row[offset+4])))
    return dict(physics_ms=int(row[1]),period=int(row[2]),relocation_id=int(row[19]),
        attack_direction=[int(row[17]),int(row[18])],players=actors)


def frame_key(row):return (row['physics_ms'],row['period'],row['relocation_id'])


def compare_frame(actual,expected):
    keys(actual,('physics_ms','period','relocation_id','attack_direction','players'))
    if any(actual[k]!=expected[k] for k in ('physics_ms','period','relocation_id','attack_direction')):
        raise ValueError('Context epoch/time/direction mismatch')
    for k in ('physics_ms','period','relocation_id'):integer(actual[k])
    if type(actual['attack_direction']) is not list or len(actual['attack_direction'])!=2:raise ValueError('Context directions')
    for direction in actual['attack_direction']:
        integer(direction,-1,1)
        if not direction:raise ValueError('Context directions')
    if type(actual['players']) is not list or len(actual['players'])!=22:raise ValueError('Context22 players')
    got={};worst=dict(position=0.,velocity=0.)
    for p in actual['players']:
        keys(p,('id','team','position','velocity','active'))
        integer(p['id'],0,2**31-1);integer(p['team'],0,1)
        if p['id'] in got or type(p['active']) is not bool:raise ValueError('Context player identity')
        point(p['position']);point(p['velocity']);got[p['id']]=p
    if set(got)!={p['id'] for p in expected['players']}:raise ValueError('Crossed native mapping')
    for p in expected['players']:
        q=got[p['id']]
        if (p['team'],p['active'])!=(q['team'],q['active']):raise ValueError('Player mask/side mismatch')
        for k,tolerance in (('position',.0001),('velocity',.001)):
            for a,b in zip(p[k],q[k]):
                error=abs(a-b);worst[k]=max(worst[k],error)
                if not math.isclose(a,b,rel_tol=0,abs_tol=tolerance):raise ValueError('Context float transport tolerance')
    return worst


def _frame_state(f,expected):
    keys(f,('row','marks','contexts','designated','lineage'))
    worst=compare_frame(f['row'],expected);people={p['id']:p for p in expected['players']}
    if len(f['marks'])!=2 or len(f['contexts'])!=2 or len(f['designated'])!=3:raise ValueError('Context frame state')
    for team,pairs in enumerate(f['marks']):
        _pairs(pairs)
        for owner,target in pairs:
            if owner not in people or target not in people or people[owner]['team']!=team or people[target]['team']==team or not people[owner]['active']:
                raise ValueError('Frame illegal ownership')
    for team,c in enumerate(f['contexts']):
        if c is not None:
            keys(c,('initialized','team','period','relocation_id','dynamic_side','eligible'))
            if (c['initialized'] is not True or c['team']!=team or type(c['eligible']) is not bool or c['dynamic_side'] not in (-1,1) or
                (c['period'],c['relocation_id'])!=(expected['period'],expected['relocation_id'])):raise ValueError('Stale frame context')
    for i,actor in enumerate(f['designated']):
        integer(actor,-1,2**31-1)
        if actor!=-1 and (actor not in people or i>0 and people[actor]['team']!=i-1):raise ValueError('Designated identity')
    if type(f['lineage']) is not list or len(f['lineage'])>22:raise ValueError('Lineage bound')
    seen=set()
    for l in f['lineage']:
        if l['player'] in seen:raise ValueError('Repeated lineage')
        seen.add(l['player']);_lineage(l,expected['physics_ms'],people)
    return worst


def validate_context(record,expected_rows,expected_shots,mapping):
    """expected_rows must come from the separate decoded replay, not this record."""
    keys(record,('version','mode','complete','overflowed','end_ms','triggers','observed_contacts','frames','transactions'))
    if record['version']!='m1-shot-context-2' or record['mode'] not in ('observe','apply') or type(record['complete']) is not bool or record['overflowed'] is not False:
        raise ValueError('Context2 schema/completion/overflow')
    integer(record['end_ms']);_contacts(expected_shots);_contacts(record['triggers']);_contacts(record['observed_contacts'])
    if record['end_ms']%100 or record['observed_contacts']!=expected_shots or record['triggers']!=expected_shots[:6]:
        raise ValueError('Context independent contact binding')
    if any(s['physics_ms']>record['end_ms'] for s in expected_shots):raise ValueError('Future contact')
    windows=_windows(expected_shots[:6],record['end_ms'])
    expected={}
    for row in expected_rows:
        if any(w['start_ms']<=row[1]<=w['end_ms'] for w in windows):
            f=replay_frame(row,mapping);key=frame_key(f)
            if key in expected or len(expected)>=MAX_FRAMES:raise ValueError('Duplicate/oversized replay windows')
            expected[key]=f
    if type(record['frames']) is not list or len(record['frames'])>MAX_FRAMES or type(record['transactions']) is not list or len(record['transactions'])>MAX_TRANSACTIONS:
        raise ValueError('Context2 record count cap')
    seen=set();last=None;worst=dict(position=0.,velocity=0.);resets=[]
    for f in record['frames']:
        if len(canonical(f))>MAX_RECORD:raise ValueError('Frame byte budget')
        key=frame_key(f['row'])
        if key in seen or key not in expected or last is not None and key<=last:raise ValueError('Context epoch chronology/window')
        if last is not None and key[1:]!=last[1:]:resets.append(list(key))
        errors=_frame_state(f,expected[key])
        for k in worst:worst[k]=max(worst[k],errors[k])
        seen.add(key);last=key
    if seen!=set(expected):raise ValueError('Missing selected replay frame; no interpolation')
    known={p['native_stable_id']:p for p in mapping};last_tx=None;guards=changes=references=setters=0
    tx_seen=set()
    for tx in record['transactions']:
        if len(canonical(tx))>MAX_RECORD:raise ValueError('Transaction byte budget')
        keys(tx,('physics_ms','team','mirror_sign','period','relocation_id','input','context','reference_pairs','pairs','actual_pairs','reasons'))
        integer(tx['physics_ms'],0,record['end_ms']);integer(tx['team'],0,1);integer(tx['period'],1,2);integer(tx['relocation_id'])
        integer(tx['mirror_sign'],-1,1)
        k=(tx['physics_ms'],tx['period'],tx['relocation_id'],tx['team'])
        if k in tx_seen or last_tx is not None and k<last_tx or tx['mirror_sign'] not in (-1,1) or not any(w['start_ms']<=k[0]<=w['end_ms'] for w in windows):
            raise ValueError('Transaction epoch/window/order')
        tx_seen.add(k);last_tx=k
        x=tx['input']
        for name,lo,hi in (('time_ms',0,7440000),('team',0,1),('period',1,2),('relocation_id',0,7440000),('dynamic_side',-1,1)):
            integer(x[name],lo,hi)
        for name in ('own_ids','threat_ids'):
            for actor in x[name]:integer(actor,0,2**31-1)
        if (x['time_ms'],x['team'],x['period'],x['relocation_id'])!=(k[0],tx['team'],k[1],k[2]):raise ValueError('Transaction input identity')
        epoch_rows=[f for key,f in expected.items() if key[1:]==k[1:3]]
        if not epoch_rows or any(-x['dynamic_side']*tx['mirror_sign']!=f['attack_direction'][tx['team']] for f in epoch_rows):
            raise ValueError('Transaction mirror contradicts replay epoch')
        if len(x['players'])!=22:raise ValueError('Complete native input identity map required')
        for p in x['players']:
            identity=known.get(p['id'])
            if identity is None or (p['team'],p['keeper'])!=(identity['side'],identity['keeper']):raise ValueError('Transaction native mapping')
        for name in ('reference_pairs','pairs','actual_pairs'):_pairs(tx[name])
        _transaction(tx,record['mode'])
        references+=len(tx['reference_pairs']);setters+=len(x['own_ids'])+len(tx['actual_pairs'])
        guards+=sum(r['code']=='close_handover_retained' for r in tx['reasons'])
        reference={target:owner for owner,target in tx['reference_pairs']}
        changes+=sum(reference.get(target)!=owner for owner,target in tx['actual_pairs']) if record['mode']=='apply' else 0
    missing=sum(max(0,100*((s['physics_ms']+99)//100)+1000-record['end_ms'])//100 for s in expected_shots[:6])
    return dict(complete=record['complete'],selected_contacts=len(record['triggers']),frames=len(seen),transactions=len(tx_seen),
        references=references,setters=setters,guards=guards,behavioral_changes=changes,windows=windows,
        posthistory_missing=missing,reset_boundaries=resets,max_position_error_m=worst['position'],max_velocity_error_m_s=worst['velocity'],
        interpolated_frames=0,observation='available' if record['triggers'] else 'insufficient')


def replay_contacts(chunks):
    """Read only the independent V2 release stream; preserve epoch at resets."""
    shots=[];previous=None
    for chunk in chunks:
        rows={int(r[0]):r for r in chunk.samples}
        for e in chunk.semantic_events:
            if e.kind!='release' or e.origin!='open_play_shot':continue
            row=rows[e.sample_index]
            if row[7] and e.physics_ms<row[1]:
                before=rows.get(e.sample_index-1,previous)
                if before is None:raise ValueError('Missing pre-reset contact epoch')
                row=before
            if row[2]!=e.phase:raise ValueError('Ambiguous contact epoch')
            shots.append(dict(raw_seq=e.raw_event_seq,physics_ms=e.physics_ms,period=e.phase,relocation_id=int(row[19]),origin=e.origin))
        previous=chunk.samples[-1]
    _contacts(shots);return shots


@dataclass(frozen=True)
class EvidenceReceipt:
    identity:dict
    trace_hash:str
    policy:dict
    context:dict
    mapping_sha256:str
    evidence_sha256:str


def validate_evidence(result,launch):
    from .m1_codec import M1StreamValidator
    from .m1_verifier import read,sha
    from .candidate_wire import normalize_state,COUNTERS as BASE_COUNTERS
    m=result.manifest
    if m.worker_identity!=launch.identity or m.input.model_dump(mode='json')!=launch.document['payloads'][
        'calibration/01' if launch.mode=='observe' else '/'.join(launch.run_id.split('/')[1:])]:raise ValueError('Result launch identity')
    v=M1StreamValidator(m.input,launch)
    # VerifiedLaunch exposes the profile identity via profile_identity.
    for chunk in result.chunks():v.append(chunk)
    v.finish(m)
    policy=read(launch.evidence/'policy.json',1024*1024)
    keys(policy,('version','identity','trace_hash','mapping','start','final','base_start','base_final'))
    if policy['version']!='m1-worker-policy-1' or policy['identity']!=launch.identity or policy['trace_hash']!=m.trace_hash:
        raise ValueError('Policy trace/profile/run binding')
    mapping=policy['mapping'];by_slot=validate_mapping(mapping,m.input.players)
    initial_row=next(result.chunks()).samples[0]
    if any(p['active']!=bool(initial_row[21+6*(side*11+slot)+4]) for (side,slot),p in by_slot.items()):
        raise ValueError('Initial native identity mask differs from replay')
    start=policy_state(policy['start'],launch.mode,initial=True);final=policy_state(policy['final'],launch.mode)
    if any(final[k]<start[k] for k in COUNTERS) or final['ticks']==0:raise ValueError('Missing/regressed full-run policy proof')
    for k in ('base_start','base_final'):
        normalized=normalize_state(policy[k],C4,initial=k=='base_start')
        if k=='base_final':base_final=normalized
    if any(policy['base_final'][k]<policy['base_start'][k] for k in BASE_COUNTERS):raise ValueError('Base policy counters decreased')
    shots=replay_contacts(result.chunks());record=read_context(launch.evidence/'contexts.zlib',launch.identity,m.trace_hash)
    if record['end_ms']!=m.duration_ms or record['mode']!=launch.mode:raise ValueError('Context actual end/mode')
    context=validate_context(record,(r for c in result.chunks() for r in c.samples),shots,mapping)
    if not context['complete'] or any(final[k]<context[k] for k in ('references','guards','setters','behavioral_changes')) or final['ticks']<context['transactions']:
        raise ValueError('Context exceeds full-run counters/completion')
    return EvidenceReceipt(launch.identity,m.trace_hash,dict(counters=final,base_counters=base_final['counters']),context,digest(mapping),
        digest(dict(policy=sha(launch.evidence/'policy.json'),contexts=sha(launch.evidence/'contexts.zlib'))))
