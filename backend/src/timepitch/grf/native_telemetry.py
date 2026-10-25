"""Pure Python 3.10 normalization shared with the isolated native runner."""


def normalize_events(batch:dict,sample_index:int,*,limit=20000)->list[dict]:
    if batch['overflowed'] or batch['emitted_count']>limit:
        raise ValueError('Native telemetry overflow')
    output=[]
    for raw in batch['events']:
        e=dict(raw);actor=list(e['actor_xy']);ball=list(e['ball_xyz'])
        actor_sign=(-1 if e['actor_team']==1 else 1)*(-1 if e['mirrored'] else 1)
        ball_sign=-1 if e['ball_mirrored'] else 1
        e.update(sample_index=sample_index,raw_actor_xy=actor,raw_ball_xyz=ball,
                 actor_xy=[v*actor_sign for v in actor],
                 ball_xyz=[ball[0]*ball_sign,ball[1]*ball_sign,ball[2]])
        output.append(e)
    return output
