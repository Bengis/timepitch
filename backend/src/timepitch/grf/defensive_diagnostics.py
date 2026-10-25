"""Ten-second observed defensive windows, plus explicitly labelled source projections.

Inputs are already admitted captures. This module neither reconstructs hidden
marking assignments/AI targets nor changes any native decision or parameter.
"""
from collections import defaultdict,deque
import math

OFFSETS=(10000,5000,3000,2000,1000,500,0)


def project_movement_guard(side,position,target):
    """Literal scalar predicate from NeedDefendingMovement, not its caller state."""
    deep=max((target[0]-position[0])*-side,0)-.5
    return abs(target[1]-position[1])>deep*.8


def hunt_radius_bounds(fatigue,difficulty):
    """Unknown dynamic mindset [0,1] and normalized ten-second speed [0,1]."""
    factor=.3+.7*difficulty
    return 10*.5*fatigue*factor,20*(.5*fatigue+.5)*factor


def _state(row,key):
    offset=21+(key[0]*11+key[1])*6
    return dict(xy=row[offset:offset+2],velocity=row[offset+2:offset+4],
                active=bool(row[offset+4]),fatigue=row[offset+5])


def _intercept_projection(defender,attacker,velocity,direction):
    # GetDefendPosition's perpendicular-bisector geometry on OBSERVED positions.
    # The real method uses a mental image whose age/state is not in this capture.
    goal=(55*direction,0);to_goal=(goal[0]-attacker[0],goal[1]-attacker[1])
    delta=(defender[0]-attacker[0],defender[1]-attacker[1])
    denominator=2*sum(a*b for a,b in zip(to_goal,delta));length=math.hypot(*to_goal)
    if abs(denominator)<1e-8 or length<1e-8:return None
    u=max(0,min(1,sum(v*v for v in delta)/denominator))
    return [attacker[i]+u*to_goal[i]+.8*to_goal[i]/length+.14*velocity[i] for i in (0,1)]


def _snapshot(row,activity,shot,people,fixed,difficulty,offset):
    attacker=(shot['actor_team'],shot['slot']);actor=_state(row,attacker);direction=shot['context']['attack_direction']
    rivals=[(key,p,_state(row,key)) for key,p in people.items() if key[0]!=attacker[0] and _state(row,key)['active']]
    outfield=[v for v in rivals if v[1].role!='GK']
    nearest=min(outfield,key=lambda v:math.dist(v[2]['xy'],actor['xy']))
    key,person,state=nearest;fixed_state=_state(row,fixed)
    target=_intercept_projection(state['xy'],actor['xy'],actor['velocity'],direction)
    projected_carrier=[actor['xy'][i]+.1*actor['velocity'][i] for i in (0,1)]
    closest=sorted(rivals,key=lambda v:math.dist(v[2]['xy'],projected_carrier))[:2]
    return dict(offset_ms=offset,sample_index=int(row[0]),physics_ms=int(row[1]),actor_xy_m=actor['xy'],
        ball_xy_m=row[-3:-1],nearest_outfield_id=person.id,nearest_outfield_name=person.name,
        nearest_outfield_distance_m=math.dist(state['xy'],actor['xy']),nearest_outfield_xy_m=state['xy'],
        nearest_activity_code=activity[key[0]*11+key[1]],nearest_speed_m_s=math.hypot(*state['velocity']),
        fixed_final_defender_xy_m=fixed_state['xy'],fixed_final_defender_distance_m=math.dist(fixed_state['xy'],actor['xy']),
        goal_side_DEF=sum(p.role=='DEF' and direction*(s['xy'][0]-actor['xy'][0])>=0 for _,p,s in outfield),
        goal_side_outfield=sum(direction*(s['xy'][0]-actor['xy'][0])>=0 for _,_,s in outfield),
        hunt_radius_bounds_m=list(hunt_radius_bounds(state['fatigue'],difficulty)),
        guard_projection=dict(target_xy_m=target,allows_hunt_override=(project_movement_guard(direction,state['xy'],target) if target else None),
            actual_branch='unknown',assumption='shooter is designated opponent; instantaneous observed geometry replaces missing mental image'),
        closest_two_projection=[dict(id=p.id,role=p.role) for _,p,_ in closest])


def diagnose_defense(manifest,chunks,summary,diagnostic):
    if any(value!=manifest.trace_hash for value in (summary.trace_hash,diagnostic['trace_hash'])) or any(
        value!=manifest.input.input_hash for value in (summary.input_hash,diagnostic['input_hash'])):
        raise ValueError('Defensive diagnostic identity mismatch')
    people={(0 if p.side=='home' else 1,p.slot):p for p in manifest.input.players};ids={p.id:key for key,p in people.items()}
    target_frames=defaultdict(list)
    for shot in diagnostic['shots']:
        if shot['context']['available']:target_frames[shot['context']['frame_sample_index']].append(shot)
    goal_releases={g['linked_release_raw_seq'] for g in diagnostic['goals']['events']};window=deque(maxlen=101)
    previous=None;records=[];semantics={};touches=[];decisions=[];last_index=-1
    for chunk in chunks:
        semantics.update({s.seq:s for s in chunk.semantic_events})
        for raw,role in zip(chunk.events,chunk.contact_roles):
            if raw.type=='touch':touches.append((raw,role))
            elif raw.type=='decision':decisions.append(raw)
        for row,activity in zip(chunk.samples,chunk.activity):
            if int(row[0])!=last_index+1:raise ValueError('Defensive sample stream gap')
            last_index=int(row[0])
            if previous is not None and (row[1]-previous[1]!=100 or row[2]!=previous[2] or row[7] or row[19]!=previous[19]):window.clear()
            window.append((row,activity));previous=row
            for shot in target_frames.get(int(row[0]),[]):
                attacker=(shot['actor_team'],shot['slot']);actor=_state(row,attacker)
                outfield_keys=[key for key,p in people.items() if key[0]!=attacker[0] and p.role!='GK']
                rivals=[key for key in outfield_keys if _state(row,key)['active']]
                fixed=ids.get(shot['context'].get('nearest_outfield_opponent_id'))
                if fixed is None:fixed=min(rivals,key=lambda key:math.dist(_state(row,key)['xy'],actor['xy']))
                history=list(window)
                invalid=[i for i,(w,_) in enumerate(history) if not _state(w,attacker)['active'] or not _state(w,fixed)['active']]
                if invalid:history=history[invalid[-1]+1:]
                if not history:raise ValueError('Inactive defensive target frame')
                difficulty=(manifest.input.settings.right_team_difficulty if attacker[0]==0 else manifest.input.settings.left_team_difficulty)
                snapshots=[]
                for age in OFFSETS:
                    eligible=[v for v in history if v[0][1]<=row[1]-age]
                    if eligible:
                        before,code=eligible[-1]
                        if before[21+(attacker[0]*11+attacker[1])*6+4] and before[21+(fixed[0]*11+fixed[1])*6+4]:
                            snapshots.append(_snapshot(before,code,shot,people,fixed,difficulty,int(before[1]-row[1])))
                distances=[]
                for before,_ in history:
                    if row[1]-before[1]<=2000 and before[21+(attacker[0]*11+attacker[1])*6+4]:
                        pos=_state(before,attacker)['xy'];active=[_state(before,k)['xy'] for k in outfield_keys if _state(before,k)['active']]
                        if active:distances.extend((math.dist(p,pos),int(before[0])) for p in active)
                minimum=min(distances) if distances else None
                records.append(dict(raw_event_seq=shot['raw_event_seq'],semantic_seq=shot['semantic_seq'],
                    sample_index=shot['sample_index'],physics_ms=shot['physics_ms'],period=shot['period'],
                    shooter_id=shot['player_id'],shooter_name=people[attacker].name,origin=shot['origin'],
                    goal=shot['raw_event_seq'] in goal_releases,frame_sample_index=int(row[0]),frame_age_ms=int(shot['physics_ms']-row[1]),
                    history_ms=int(row[1]-history[0][0][1]),final_nearest_outfield_id=people[fixed].id,
                    final_nearest_outfield_name=people[fixed].name,
                    contact_nearest_outfield_m=shot['context'].get('nearest_outfield_opponent_m',snapshots[-1]['nearest_outfield_distance_m']),
                    minimum_nearest_outfield_last_2s_m=minimum[0] if minimum else None,
                    minimum_last_2s_sample_index=minimum[1] if minimum else None,snapshots=snapshots,decision_trace_available=False))
    by_raw={s['raw_event_seq']:s for s in diagnostic['shots']}
    for record in records:
        shot=by_raw[record['raw_event_seq']];semantic=semantics.get(shot['semantic_seq'])
        if semantic is None or semantic.raw_event_seq!=shot['raw_event_seq']:raise ValueError('Missing defensive action reference')
        record['phase_class']=('penalty' if shot['origin']=='set_piece_shot' and semantic.restart_kind=='penalty' else
            'open_play' if shot['origin']=='open_play_shot' else 'other_set_piece_or_unknown')
        record['restart_kind']=semantic.restart_kind
        history_start=record['physics_ms']-record['frame_age_ms']-record['history_ms']
        receipts=[p for p in summary.passes if p.outcome=='received' and p.receiver_id==shot['player_id'] and p.period==shot['period'] and
            history_start<=p.received_physics_ms and 0<=shot['physics_ms']-p.received_physics_ms<=10000]
        receipt=max(receipts,key=lambda p:p.received_physics_ms) if receipts else None
        record['last_confirmed_receipt']=(dict(receipt_to_shot_ms=shot['physics_ms']-receipt.received_physics_ms,
            release_raw_seq=receipt.raw_event_seq,release_semantic_seq=receipt.semantic_seq,
            evidence=[e.model_dump(mode='json') for e in receipt.evidence]) if receipt else None)
        candidates=[(raw,role) for raw,role in touches if raw.actor_team!=shot['actor_team'] and raw.player>=0 and
            people[(raw.actor_team,raw.player)].role=='GK' and raw.phase==shot['period'] and history_start<=raw.actual_time_ms and
            0<shot['physics_ms']-raw.actual_time_ms<=3000]
        keeper=max(candidates,key=lambda v:v[0].actual_time_ms) if candidates else None
        record['previous_opponent_keeper_contact']=(dict(raw_seq=keeper[0].seq,age_ms=shot['physics_ms']-keeper[0].actual_time_ms,
            contact_role_code=keeper[1]) if keeper else None)
        restart=next((r for r in manifest.ledger if r.id==semantic.restart_id and r.cause=='penalty' and r.period==shot['period']),None)
        prepared=[raw for raw in decisions if restart is not None and raw.kind=='penalty' and raw.stage=='prepared' and
            raw.phase==shot['period'] and raw.team==shot['actor_team'] and restart.start<=raw.actual_time_ms<=restart.end]
        record['penalty_prepared_raw_seq']=prepared[-1].seq if record['phase_class']=='penalty' and prepared else None
        sanctioned=[raw for raw in decisions if restart is not None and raw.kind=='foul' and raw.stage=='sanctioned' and
            raw.phase==shot['period'] and raw.actual_time_ms==restart.start and raw.victim_team==shot['actor_team']]
        foul=sanctioned[-1] if record['phase_class']=='penalty' and sanctioned else None
        accepted=[raw for raw in decisions if foul is not None and raw.kind=='foul' and raw.stage=='accepted' and
            raw.incident_id==foul.incident_id and raw.actor_team==foul.actor_team and raw.player==foul.player]
        record['penalty_foul']=(dict(sanctioned_raw_seq=foul.seq,physics_ms=foul.actual_time_ms,actor_team=foul.actor_team,
            slot=foul.player,actor_name=people[(foul.actor_team,foul.player)].name,victim_slot=foul.victim_player,
            accepted_raw_seq=accepted[-1].seq if accepted else None,
            native_function_at_acceptance=accepted[-1].function if accepted else None) if foul else None)
    if len(records)!=sum(map(len,target_frames.values())):raise ValueError('Defensive frame missing')
    groups={kind:dict(shots=sum(r['phase_class']==kind for r in records),goals=sum(r['phase_class']==kind and r['goal'] for r in records))
            for kind in ('open_play','penalty','other_set_piece_or_unknown')}
    return dict(schema_version='grf-defensive-diagnostic-1',trace_hash=manifest.trace_hash,input_hash=manifest.input.input_hash,
        groups=groups,shots=records,native_decision_trace_available=False,candidate_ready=False,
        window_policy='last-10s-continuous-segment-1',projection_policy='observed-geometry-only-not-native-branch-replay-1',
        unavailable_shots=len(diagnostic['shots'])-len(records),
        sanctioned_fouls=[dict(raw_seq=r.seq,physics_ms=r.actual_time_ms,period=r.phase,actor_team=r.actor_team,
            slot=r.player,victim_team=r.victim_team,victim_slot=r.victim_player,incident_id=r.incident_id,
            actor_xy_m=[r.actor_xy[0]*54.4,r.actor_xy[1]*-83.6]) for r in decisions if r.kind=='foul' and r.stage=='sanctioned'])
