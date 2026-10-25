"""Conservative action resolution from ordered native evidence."""
from collections import Counter,defaultdict
from .statistics_models import GrfMetric,GrfEventStatistics,GrfGoal,GrfShot,GrfPass,GrfPassEdge

SIDES=('home','away')
PASS_KINDS={'short_pass','long_pass','high_pass'}
CONTROL_KINDS=PASS_KINDS|{'shot','trap','ball_control'}
EVENT_METRICS=('goals','own_goals','own_goals_for','unattributed_goals','assists','shots','pass_attempts',
    'pass_received','pass_intercepted','pass_interrupted','pass_same_actor','pass_unresolved',
    'recoveries','fouls','offsides','corners','penalties')


def meters(point):return (point[0]+1)*52.5,(point[1]+.42)*68/.84


def empty_events(record,available):
    def metrics():return {name:GrfMetric(value=0 if available else None,availability='measured' if available else 'unavailable',
        definition_id=name,reason=None if available else 'events_not_recorded') for name in EVENT_METRICS}
    return GrfEventStatistics(by_team={s:metrics() for s in SIDES},
        by_player={p.id:metrics() for p in record.input.players},goals=[],shots=[],passes=[],pass_edges=[])


def reduce_events(record)->GrfEventStatistics:
    result=empty_events(record,True);players=record.input.players
    pending=None;candidate=None;last_shot=None;control=None;phase=None;seen_actions=set();seen_decisions=set()
    edges=Counter()
    def actor(event):
        return players[event.actor_team*11+event.player].id if event.actor_team>=0 and event.player>=0 else None
    def add(name,side,who,refs):
        for metrics in [result.by_team[side]]+([result.by_player[who]] if who else []):
            metric=metrics[name];metric.value+=1;metric.event_refs.extend(refs)
    def finish(outcome,event=None):
        nonlocal pending,candidate
        if pending is None:return
        item,source=pending;item.outcome=outcome
        if event is not None:
            item.event_refs.append(event.seq);item.end_x,item.end_y=meters(event.ball_xyz)
        add('pass_'+outcome,item.side,item.actor_id,item.event_refs)
        if outcome=='received':
            item.receiver_id=actor(event);edges[item.side,item.phase,item.actor_id,item.receiver_id]+=1
            candidate=(item.actor_id,item.receiver_id,event.actual_time_ms,item.seq,event.seq)
        pending=None
    for event in record.telemetry.events:
        if phase is not None and event.phase!=phase:
            finish('interrupted');candidate=None;last_shot=None;control=None
        phase=event.phase
        if event.type=='decision':
            key=(event.incident_id,event.kind)
            count=((event.kind=='foul' and event.stage in ('accepted','sanctioned','advantage_played')) or event.kind in ('offside','corner','penalty'))
            if count and key not in seen_decisions:
                seen_decisions.add(key)
                side=SIDES[event.actor_team] if event.kind in ('foul','offside') and event.actor_team>=0 else SIDES[event.team]
                name={'foul':'fouls','offside':'offsides','corner':'corners','penalty':'penalties'}[event.kind]
                who=actor(event) if event.kind in ('foul','offside') else None
                add(name,side,who,[event.seq])
            if event.stage in ('sanctioned','prepared','awarded'):
                finish('interrupted',event);candidate=None;last_shot=None;control=None
            continue
        if event.type=='goal':
            side=SIDES[event.team];who=actor(event)
            add('goals',side,who if not event.own_goal else None,[event.seq])
            if event.own_goal:
                add('own_goals_for',side,None,[event.seq])
                if who:add('own_goals',SIDES[event.actor_team],who,[event.seq])
            elif who is None:add('unattributed_goals',side,None,[event.seq])
            goal=GrfGoal(seq=event.seq,side=side,actor_id=who,own_goal=event.own_goal,
                match_time_ms=event.match_time_ms,playback_ms=event.sample_index*100,phase=event.phase)
            if not event.own_goal and last_shot and last_shot[0].actor_id==who and last_shot[0].side==side:
                shot,assistance,_=last_shot;shot.outcome='goal';goal.shot_seq=shot.seq
                if assistance and assistance[1]==who:
                    goal.assist_id=assistance[0];add('assists',side,goal.assist_id,[assistance[3],assistance[4],shot.seq,event.seq])
            result.goals.append(goal);finish('interrupted',event);candidate=None;last_shot=None;control=None
            continue
        who=actor(event);side=SIDES[event.team]
        key=(event.actor_team,event.player,event.action_id)
        intentional=event.touch_type in (0,1) and event.kind in CONTROL_KINDS and event.in_play
        repeated=key in seen_actions
        if repeated and intentional:
            if last_shot and key==last_shot[2]:continue
            if pending and key==(pending[1].actor_team,pending[1].player,pending[1].action_id):continue
        if candidate and (not intentional or who!=candidate[1]):candidate=None
        if pending:
            item,_=pending
            if not intentional:finish('unresolved',event)
            elif who==item.actor_id:finish('same_actor',event)
            elif side==item.side:finish('received',event)
            else:finish('intercepted',event)
        if last_shot:last_shot=None
        if not intentional:continue
        if control and control[0]!=side and not event.set_piece:
            add('recoveries',side,who,[control[1],event.seq])
        control=(side,event.seq)
        x,y=meters(event.ball_xyz)
        if event.kind in PASS_KINDS and not repeated:
            seen_actions.add(key)
            candidate=None
            item=GrfPass(seq=event.seq,side=side,actor_id=who,kind=event.kind,
                match_time_ms=event.match_time_ms,playback_ms=event.sample_index*100,phase=event.phase,
                x=x,y=y,event_refs=[event.seq])
            result.passes.append(item);add('pass_attempts',side,who,[event.seq]);pending=(item,event)
        elif event.kind=='shot' and not repeated:
            seen_actions.add(key)
            shot=GrfShot(seq=event.seq,side=side,actor_id=who,x=x,y=y,match_time_ms=event.match_time_ms,
                playback_ms=event.sample_index*100,phase=event.phase,set_piece=event.set_piece)
            assistance=candidate if candidate and 0<=event.actual_time_ms-candidate[2]<=10000 else None
            result.shots.append(shot);add('shots',side,who,[event.seq]);last_shot=(shot,assistance,key)
    if pending and pending[1].phase==1 and record.samples[-1].phase==2:finish('interrupted')
    else:finish('unresolved')
    result.pass_edges=[GrfPassEdge(side=s,phase=phase,source_id=a,target_id=b,count=n) for (s,phase,a,b),n in sorted(edges.items())]
    for metrics in list(result.by_team.values())+list(result.by_player.values()):
        attempts=metrics['pass_attempts'].value;received=metrics['pass_received'].value
        metrics['confirmed_receipt_pct']=GrfMetric(value=100*received/attempts if attempts else None,
            availability='derived' if attempts else 'unavailable',definition_id='confirmed_receipt_pct',
            numerator=received,denominator=attempts,reason=None if attempts else 'no_attempts',
            event_refs=metrics['pass_attempts'].event_refs)
    return result
