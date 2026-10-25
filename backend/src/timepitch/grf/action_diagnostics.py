"""Offline evidence from an already admitted action capture and public summary.

This is not another admission path. Component tests may use prefixes; callers
claiming a full match must supply its validated manifest, chunks and summary.
No simulation, interpolation, fitted xG or parameter changes occur here.
"""
from collections import Counter
import math
from typing import Iterable
from .action_models import ActionChunk,ActionManifest
from .action_statistics_models import ActionStatisticsSummary

GOAL_X=55.0  # gamedefines.hpp; native coordinates, not the 105m display pitch.
POST_Y=3.7
ACTIVITY=('native','rest','walk','urgent')


def _xy(row,side,slot):
    offset=21+(side*11+slot)*6
    return row[offset:offset+2]


def _context(event,before,after,people):
    side=event.actor_team;slot=event.player
    unavailable=dict(available=False,resolution_ms=100,reason='no_continuous_active_frame')
    if side not in (0,1) or (side,slot) not in people:return unavailable
    actor=(event.actor_xy[0]*54.4,event.actor_xy[1]*-83.6)
    ball=(event.ball_xyz[0]*54.4,event.ball_xyz[1]*-83.6,event.ball_xyz[2])
    direction=event.attack_direction[side];goal=(direction*GOAL_X,0)
    left=(goal[0]-actor[0],POST_Y-actor[1]);right=(goal[0]-actor[0],-POST_Y-actor[1])
    angle=math.degrees(math.atan2(abs(left[0]*right[1]-left[1]*right[0]),left[0]*right[0]+left[1]*right[1]))
    contact=dict(contact_geometry_available=True,actor_xy_m=list(actor),ball_xyz_m=list(ball),attack_direction=direction,
        goal_distance_m=math.dist(actor,goal),goal_opening_degrees=angle,
        in_play_at_contact=event.in_play,set_piece_at_contact=event.set_piece)
    unavailable.update(contact)
    if before is None or after is None:return unavailable
    if (after[1]-before[1]!=100 or before[2]!=after[2] or after[2]!=event.phase or
        after[7] or before[19]!=after[19] or not before[1]<=event.actual_time_ms<=after[1]):return unavailable
    frame=after if event.actual_time_ms==after[1] else before
    needed=[(side,slot),*((1-side,i) for i in range(11))]
    if any(not r[21+(team*11+i)*6+4] for team,i in needed for r in (before,after)):return unavailable
    rivals=[(p,_xy(frame,team,i)) for (team,i),p in people.items() if team==1-side]
    keeper=next(((p,xy) for p,xy in rivals if p.role=='GK'),None)
    defenders=[(p,xy) for p,xy in rivals if p.role!='GK']
    nearest=min(defenders,key=lambda v:math.dist(v[1],actor)) if defenders else None
    result=dict(available=True,resolution_ms=100,frame_sample_index=int(frame[0]),
        upper_sample_index=int(after[0]),frame_age_ms=int(event.actual_time_ms-frame[1]),period=event.phase,
        relocation_id=int(frame[19]),**contact,
        actor_frame_xy_m=list(_xy(frame,side,slot)),actor_frame_difference_m=math.dist(_xy(frame,side,slot),actor),
        nearest_outfield_opponent_m=math.dist(nearest[1],actor) if nearest else None,
        nearest_outfield_opponent_id=nearest[0].id if nearest else None)
    if keeper:
        p,xy=keeper
        result.update(keeper_id=p.id,keeper_xy_m=list(xy),keeper_forward_m=GOAL_X-direction*xy[0],
                      keeper_lateral_m=abs(xy[1]),actor_keeper_m=math.dist(xy,actor))
    return result


def diagnose_actions(manifest:ActionManifest,chunks:Iterable[ActionChunk],summary:ActionStatisticsSummary)->dict:
    if (summary.trace_hash!=manifest.trace_hash or summary.input_hash!=manifest.input.input_hash or
        summary.score!=manifest.score):raise ValueError('Diagnostic summary/capture identity mismatch')
    people={(0 if p.side=='home' else 1,p.slot):p for p in manifest.input.players}
    player_indexes={p.id:team*11+slot for (team,slot),p in people.items()}
    releases={r.raw_event_seq:r for r in summary.releases};raw_releases={};contexts={};goals=[]
    touch_kinds=Counter();roles=Counter();semantic_kinds=Counter();raw_contacts=0;last_touch={};goal_touches={}
    cells={};previous=None;previous_activity=None;last_index=-1;event_seq=-1
    for chunk in chunks:
        if not isinstance(chunk,ActionChunk):raise ValueError('Diagnostic requires action chunks')
        frames={int(row[0]):row for row in chunk.samples}
        activities={int(row[0]):a for row,a in zip(chunk.samples,chunk.activity)}
        prior={int(row[0]):(chunk.samples[i-1] if i else previous) for i,row in enumerate(chunk.samples)}
        for raw,role in zip(chunk.events,chunk.contact_roles):
            if raw.seq!=event_seq+1:raise ValueError('Diagnostic raw stream gap')
            event_seq=raw.seq
            if raw.type=='touch':
                raw_contacts+=1;touch_kinds[raw.kind]+=1;roles[str(role)]+=1;last_touch[raw.actor_team]=raw
            if raw.seq in releases:
                raw_releases[raw.seq]=raw
                if releases[raw.seq].intent in ('shot','clearance','unknown'):
                    context=_context(raw,prior.get(raw.sample_index),frames.get(raw.sample_index),people)
                    if context['available']:
                        code=activities.get(context['frame_sample_index'],previous_activity)
                        for key,id in (('nearest_outfield_opponent',context.get('nearest_outfield_opponent_id')),
                                       ('keeper',context.get('keeper_id'))):
                            context[key+'_activity']=ACTIVITY[code[player_indexes[id]]] if id is not None else None
                    contexts[raw.seq]=context
            if raw.type=='goal':goals.append(raw);goal_touches[raw.seq]=last_touch.get(raw.actor_team)
        semantic_kinds.update(s.kind for s in chunk.semantic_events)
        for row,activity in zip(chunk.samples,chunk.activity):
            if row[0]!=last_index+1:raise ValueError('Diagnostic sample stream gap')
            last_index=int(row[0]);period=int(row[2])
            continuous=(previous is not None and row[1]-previous[1]==100 and row[2]==previous[2] and
                        not row[7] and row[19]==previous[19])
            for (team,slot),person in people.items():
                index=team*11+slot;offset=21+index*6;key=(person.id,period)
                cell=cells.setdefault(key,dict(player_id=person.id,side=person.side,role=person.role,period=period,
                    first_physics_ms=int(row[1]),last_physics_ms=int(row[1]),fatigue_first=row[offset+5],
                    fatigue_last=row[offset+5],fatigue_min=row[offset+5],activity_ms=dict.fromkeys(ACTIVITY,0),
                    in_play_activity_ms=dict.fromkeys(ACTIVITY,0)))
                cell.update(last_physics_ms=int(row[1]),fatigue_last=row[offset+5],fatigue_min=min(cell['fatigue_min'],row[offset+5]))
                if continuous and previous[offset+4] and row[offset+4]:
                    code=ACTIVITY[previous_activity[index]];cell['activity_ms'][code]+=100
                    if previous[5] and row[5] and not previous[6] and not row[6]:cell['in_play_activity_ms'][code]+=100
            previous=row;previous_activity=activity
    if len(raw_releases)!=len(releases):raise ValueError('Diagnostic release reference missing')
    details=[]
    for release in summary.releases:
        raw=raw_releases[release.raw_event_seq]
        details.append(dict(**release.model_dump(mode='json'),sample_index=raw.sample_index,
            raw_action_id=raw.action_id,actor_team=raw.actor_team,slot=raw.player,
            context=contexts.get(raw.seq)))
    goal_details=[]
    for goal in goals:
        # Match uses the scoring/own-goal team's last toucher. probe_capture
        # reads the actor's CURRENT animation, which may change during flight.
        # Link only its actual final team contact, never an earlier same-ID shot.
        final=goal_touches[goal.seq]
        matches=[r for r in details if final is not None and r['raw_event_seq']==final.seq and
            r['period']==goal.phase and r['actor_team']==goal.actor_team and r['slot']==goal.player]
        release=matches[-1] if matches else None
        goal_details.append(dict(raw_seq=goal.seq,sample_index=goal.sample_index,physics_ms=goal.actual_time_ms,
            period=goal.phase,team=goal.team,actor_team=goal.actor_team,slot=goal.player,own_goal=goal.own_goal,
            score=list(goal.score),linked_release_raw_seq=release['raw_event_seq'] if release else None,
            linked_release_semantic_seq=release['semantic_seq'] if release else None,
            linked_release_intent=release['intent'] if release else None,
            animation_changed_after_contact=(goal.action_id!=release['raw_action_id']) if release else None,
            release_to_goal_ms=goal.actual_time_ms-release['physics_ms'] if release else None))
    for player in summary.players:
        for period in player.periods:
            cell=cells.get((player.id,period.period))
            if cell is not None:cell['effort']=period.model_dump(mode='json')
    by_period=[]
    for period in (1,2):
        selected=[r for r in details if r['period']==period]
        by_period.append(dict(period=period,releases=dict(sorted(Counter(r['intent'] for r in selected).items())),
            goals=sum(g.phase==period for g in goals),
            effective_ms=next(p.effective_ms for p in manifest.periods if p.period==period)))
    hypotheses=[dict(id='counter_inflation',
        status='not_supported' if len(goals)==sum(manifest.score) else 'counter_discrepancy_requires_investigation',
        mechanism='Native goal events and scoreboard are independent of semantic shot/pass counting.',
        evidence=[dict(raw_seq=g['raw_seq'],sample_index=g['sample_index'],physics_ms=g['physics_ms']) for g in goal_details],
        source='src/onthepitch/match.cpp:Match::Process',
        proposed_test='Compare preserved native scoreboard and all raw goal events; never delete unclassified goals.'),
        dict(id='chance_supply',status='observed_association_not_validated_cause',
        mechanism='Native offensive shot selection uses a shooting zone and a passing/interception heuristic, not a calibrated chance model.',
        evidence=[dict(raw_seq=r['raw_event_seq'],semantic_seq=r['semantic_seq'],sample_index=r['sample_index'],
            physics_ms=r['physics_ms'],goal_distance_m=r['context'].get('goal_distance_m'),
            nearest_outfield_opponent_m=r['context'].get('nearest_outfield_opponent_m')) for r in details if r['intent']=='shot'],
        source='src/onthepitch/player/controller/elizacontroller.cpp:ElizaController::GetOnTheBallCommands',
        proposed_test='Trace defensive targets/marking and shot proposal, odds, selected animation and release around the listed incidents before choosing one intervention.')]
    return dict(schema_version='grf-action-diagnostic-1',trace_hash=manifest.trace_hash,input_hash=manifest.input.input_hash,
        admission='requires_previously_admitted_capture',coordinate_units='native_m',sampling_resolution_ms=100,
        spatial_policy='native-contact-position-and-continuous-preceding-frame-1',
        score=list(manifest.score),physics_ms=manifest.duration_ms,raw_contacts=raw_contacts,
        raw_touch_kinds=dict(sorted(touch_kinds.items())),contact_roles=dict(sorted(roles.items())),
        semantic_kinds=dict(sorted(semantic_kinds.items())),
        releases=dict(total=len(details),by_intent=dict(sorted(Counter(r['intent'] for r in details).items())),
            by_origin=dict(sorted(Counter(r['origin'] for r in details).items()))),
        classification=summary.classification.model_dump(mode='json'),
        passes=dict(total=len(summary.passes),outcomes=dict(sorted(Counter(p.outcome for p in summary.passes).items()))),
        retention=dict(episodes=len(summary.retentions),closed=sum(r.end_physics_ms is not None for r in summary.retentions),
            observed_ms=sum(r.observed_ms for r in summary.retentions)),
        goals=dict(count=len(goals),own_goals=sum(g.own_goal for g in goals),events=goal_details,
            scoreboard_agrees=len(goals)==sum(manifest.score)),
        shots=[r for r in details if r['intent']=='shot'],clearances=[r for r in details if r['intent']=='clearance'],
        unknown_releases=[r for r in details if r['intent']=='unknown'],periods=by_period,
        players=[cells[k] for k in sorted(cells)],hypotheses=hypotheses,candidate_ready=False)
