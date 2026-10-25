"""Independent evidence validation; hashes alone cannot prove event semantics."""
from .native_telemetry import normalize_events


def validate_telemetry(record)->None:
    telemetry=record.telemetry;events=telemetry.events
    if telemetry.overflowed or telemetry.emitted_count!=len(events):raise ValueError('Incomplete native telemetry')
    previous_time=-1;previous_sample=0;score=[0,0];cursor=0;decisions=set()
    for index,event in enumerate(events):
        if event.seq!=index or event.sample_index<previous_sample or event.actual_time_ms<previous_time:
            raise ValueError('Native event order mismatch')
        if event.sample_index>=len(record.samples):raise ValueError('Native event beyond replay')
        a,b=record.samples[event.sample_index-1:event.sample_index+1]
        if not (a.actual_time_ms<=event.actual_time_ms<=b.actual_time_ms and
                a.match_time_ms<=event.match_time_ms<=b.match_time_ms and event.phase in (a.phase,b.phase)):
            raise ValueError('Native event clock differs from observation interval')
        for side,slot in ((event.actor_team,event.player),(event.victim_team,event.victim_player)):
            if (side==-1)!=(slot==-1):raise ValueError('Incomplete native actor')
        if event.attack_direction[0]!=-event.attack_direction[1]:raise ValueError('Invalid attack directions')
        raw=event.model_dump(exclude={'raw_actor_xy','raw_ball_xyz','sample_index'})
        raw.update(actor_xy=event.raw_actor_xy,ball_xyz=event.raw_ball_xyz)
        normalized=normalize_events({'events':[raw],'overflowed':False,'emitted_count':1},event.sample_index)[0]
        if tuple(normalized['actor_xy'])!=event.actor_xy or tuple(normalized['ball_xyz'])!=event.ball_xyz:
            raise ValueError('Native coordinate normalization mismatch')
        if event.type=='touch':
            # gfootball 2.10.2 e_FunctionType is None..Special (0..14).
            # Known non-pass functions may be 'other'; unknown functions cannot
            # silently become measured zero actions in a complete summary.
            if not 0<=event.function<=14:raise ValueError('Unknown native contact function')
            if event.player<0 or event.actor_team!=event.team or event.touch_type<0 or event.own_goal:
                raise ValueError('Invalid native contact')
        elif event.type=='goal':
            if event.kind!='goal' or (event.player>=0 and event.actor_team!=(1-event.team if event.own_goal else event.team)):
                raise ValueError('Invalid native goal attribution')
            score[event.team]+=1
        elif event.type=='decision':
            key=(event.incident_id,event.kind,event.stage)
            if event.incident_id==0 or key in decisions:raise ValueError('Duplicate native decision')
            decisions.add(key)
        if tuple(score)!=event.score:raise ValueError('Native event score mismatch')
        previous_time=event.actual_time_ms;previous_sample=event.sample_index
    for sample in record.samples:
        while cursor<len(events) and events[cursor].sample_index<=sample.index:cursor+=1
        expected=(0,0) if cursor==0 else events[cursor-1].score
        if sample.score!=expected:raise ValueError('Native adjudication differs from scoreboard')
    for sample in record.samples:
        if sample.attack_direction[0]!=-sample.attack_direction[1]:raise ValueError('Invalid sampled attack directions')
