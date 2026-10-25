"""A whole-period synthetic solution. Segmentation never restarts its state."""
from bisect import bisect_right
from collections import defaultdict
import math

from ..historical.clock import project_point
from ..historical.models import HistoricalPoint
from .anchors import cut
from .models import PeriodMotion,ReconstructionFrame

# Illustrative formation slots in the attacking frame, not measured positions.
POSITIONS={1:(6,34),2:(28,55),3:(24,45),4:(24,34),5:(24,23),6:(28,13),
           7:(39,57),8:(40,46),9:(40,44),10:(40,34),11:(40,24),12:(40,22),13:(39,11),
           14:(53,57),15:(53,44),16:(53,24),17:(65,56),18:(65,44),19:(65,34),20:(65,24),
           21:(65,12),22:(77,44),23:(77,34),24:(77,24),25:(66,34)}


def reconstruct_period(match,period,anchors,participation,profile):
    extent=next((p.duration_ms for p in participation.clock.periods if p.period==period),None)
    if extent is None or extent<=0 or period>4:
        raise ValueError('Unavailable recorded period extent')
    original=[a for a in anchors.items if a.period==period]
    updated={a.id:a for a in original}
    cuts=[c for c in anchors.resets if c.period==period and 0<=c.from_ms<=extent]
    if not any(c.reason=='period_start' for c in cuts):
        cuts.append(cut(period,0,0,'all','period_start'))
    grouped=defaultdict(lambda:defaultdict(list))
    for a in original:
        if a.status=='placed' and a.location is not None and a.period_ms is not None and 0<=a.period_ms<=extent:
            grouped[a.entity_key][a.period_ms].append(a)
    nodes={}
    for entity,bytime in grouped.items():
        values=[]
        for at,rows in sorted(bytime.items()):
            coords={(a.location.x,a.location.y) for a in rows}
            conflict=len(coords)>1
            if conflict:
                cuts.append(cut(period,at,at,entity,'simultaneous_anchor_conflict',[a.event_id for a in rows]))
                for a in rows:
                    updated[a.id]=a.model_copy(update={'status':'conflict','reason':'simultaneous_anchor_conflict'})
            point=None if conflict and entity=='ball' else (rows[0].location.x,rows[0].location.y)
            values.append((at,point,[a.id for a in rows]))
        nodes[entity]=values
    ball_nodes=nodes.get('ball',[])
    ball_times=[n[0] for n in ball_nodes]
    restarts=sorted({c.from_ms for c in cuts if c.reason in ('recorded_restart','kickoff')})
    ball_reasons=[]
    unavailable=[]
    for left,right in zip(ball_nodes,ball_nodes[1:]):
        ta,a,_=left;tb,b,_=right
        reason=None
        if a is None or b is None:
            reason='conflicting_ball_anchor'
        elif tb-ta>profile.max_ball_gap_ms:
            reason='ball_gap_over_5s'
        elif math.dist(a,b)*1000/(tb-ta)>profile.ball_max_speed:
            reason='ball_motion_limit'
        elif bisect_right(restarts,ta)<bisect_right(restarts,tb):
            reason='recorded_restart'
        ball_reasons.append(reason)
        if reason:
            unavailable.append((ta,tb,reason))
            cuts.append(cut(period,ta,tb,'ball',reason,[updated[i].event_id for i in left[2]+right[2]]))
            if reason=='ball_motion_limit':
                for i in right[2]:
                    updated[i]=updated[i].model_copy(update={'status':'conflict','reason':reason})
    if not ball_nodes:
        unavailable.append((0,extent,'no_ball_anchor'))
    else:
        if ball_nodes[0][0]>0:
            unavailable.append((0,ball_nodes[0][0],'unbounded_ball_gap'))
        if ball_nodes[-1][0]<extent:
            unavailable.append((ball_nodes[-1][0],extent,'unbounded_ball_gap'))

    def ball_at(at):
        i=bisect_right(ball_times,at)-1
        if i>=0 and ball_times[i]==at:
            return ball_nodes[i][1],None if ball_nodes[i][1] else 'simultaneous_anchor_conflict'
        if i<0 or i>=len(ball_nodes)-1:
            return None,'unbounded_ball_gap' if ball_nodes else 'no_ball_anchor'
        reason=ball_reasons[i]
        if reason:
            return None,reason
        ta,a,_=ball_nodes[i];tb,b,_=ball_nodes[i+1]
        u=(at-ta)/(tb-ta)
        return (a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u),None

    roles=defaultdict(list)
    for role in anchors.roles:
        if role.period<=period:
            roles[role.player_key].append(role)

    def target(player,at):
        available=[r for r in roles[player.key] if r.period<period or r.period_ms<=at]
        role=available[-1].position_id if available else 10
        x,y=POSITIONS.get(role,(45,34))
        point=project_point(match,player.team_key,period,HistoricalPoint(x=x,y=y))
        ball,_=ball_at(at)
        if ball:
            # Shared, modest movement of the illustrative block toward the ball.
            shift_x=(ball[0]-52.5)*(.08 if role==1 else .22)
            shift_y=(ball[1]-34)*(.06 if role==1 else .15)
            return (max(2,min(103,point.x+shift_x)),max(2,min(66,point.y+shift_y)))
        return point.x,point.y

    def feasible(a,b,dt):
        if dt<=0:
            return a==b
        distance=math.dist(a,b);seconds=dt/1000
        # Quintic smoothstep has exact peaks 1.875 and 10/sqrt(3).
        return (1.875*distance/seconds<=profile.player_max_speed*.999 and
                (10/math.sqrt(3))*distance/seconds**2<=profile.player_max_acceleration*.999)

    # Each active appearance has its own stream; no substituted identity can return.
    streams=[]
    changes=set()
    kicks=sorted({c.from_ms for c in cuts if c.entity_key=='all' and c.reason=='kickoff'})
    for player in anchors.roster:
        for appearance in participation.intervals:
            if appearance.player_key!=player.key or appearance.start.period>period or appearance.end and appearance.end.period<period:
                continue
            start=appearance.start.period_ms if appearance.start.period==period else 0
            end=appearance.end.period_ms if appearance.end and appearance.end.period==period else extent
            end=min(extent,end)
            if start>end:
                continue
            end_exclusive=appearance.end is not None and appearance.end.period==period
            changes.update((start,end))
            if start:
                cuts.append(cut(period,start,start,player.key,'appearance_start',appearance.event_ids))
            if end_exclusive:
                cuts.append(cut(period,end,end,player.key,'appearance_end',appearance.event_ids))
            breaks=[start]+[t for t in kicks if start<t<end]+[end]
            for piece,(begin,finish) in enumerate(zip(breaks,breaks[1:])):
                hard=[n for n in nodes.get(player.key,[]) if begin<=n[0]<=finish and n[1] is not None]
                first=hard[0][1] if hard and hard[0][0]-begin<5000 else target(player,begin)
                last=hard[-1][1] if hard and finish-hard[-1][0]<5000 else target(player,finish)
                required=([(begin,first,[])] if not hard or hard[0][0]!=begin else [])+hard
                if not required or required[-1][0]!=finish:
                    required.append((finish,last,[]))
                knots=[];bad=[]
                for left,right in zip(required,required[1:]):
                    ta,a,refs=left;tb,b,endrefs=right
                    if not knots:
                        knots.append(left)
                    if not feasible(a,b,tb-ta):
                        cuts.append(cut(period,ta,tb,player.key,'player_motion_limit',
                                        [updated[i].event_id for i in refs+endrefs]))
                        for i in endrefs:
                            updated[i]=updated[i].model_copy(update={'status':'conflict','reason':'player_motion_limit'})
                        bad.append((ta,tb))
                    elif tb-ta>10_000:
                        previous=left
                        for at in range(((ta//5000)+1)*5000,tb,5000):
                            wanted=target(player,at)
                            if feasible(previous[1],wanted,at-previous[0]) and feasible(wanted,b,tb-at):
                                knots.append((at,wanted,[]));previous=knots[-1]
                    knots.append(right)
                if len(required)==1:
                    knots=required
                streams.append((player.index,begin,finish,end_exclusive if piece==len(breaks)-2 else True,
                                [k[0] for k in knots],knots,set(bad)))
    times=set(range(0,extent+1,profile.tick_ms))|{extent}|changes
    for a in original:
        if a.period_ms is not None and 0<=a.period_ms<=extent:
            times.add(a.period_ms)
    for reset in cuts:
        if 0<=reset.from_ms<=extent:times.add(reset.from_ms)
        if 0<=reset.to_ms<=extent:times.add(reset.to_ms)
    refs=defaultdict(list)
    for a in original:
        if a.period_ms is not None and 0<=a.period_ms<=extent:
            refs[a.period_ms].append(a.id)
    frames=[]
    for at in sorted(times):
        positions=[]
        for idx,begin,end,exclusive,knot_times,knots,bad in streams:
            if at<begin or at>end or at==end and exclusive:
                continue
            i=min(len(knots)-1,bisect_right(knot_times,at)-1)
            ta,a,_=knots[i]
            if i==len(knots)-1 or at==ta:
                pos=a
            else:
                tb,b,_=knots[i+1]
                if (ta,tb) in bad:
                    pos=a  # cut at the next anchor, never accelerate to chase it
                else:
                    u=(at-ta)/(tb-ta);s=u*u*u*(10+u*(-15+6*u))
                    pos=(a[0]+(b[0]-a[0])*s,a[1]+(b[1]-a[1])*s)
            positions.append((idx,pos[0],pos[1]))
        ball,reason=ball_at(at)
        frames.append(ReconstructionFrame.model_construct(period=period,period_ms=at,
            players=sorted(positions),ball=ball,ball_reason=reason,anchor_ids=refs.get(at,[])))
    return PeriodMotion(period=period,duration_ms=extent,frames=frames,
        anchors=list(updated.values()),cuts=sorted({c.id:c for c in cuts}.values(),key=lambda c:(c.from_ms,c.id)),
        ball_unavailable_ms=sum(b-a for a,b,_ in unavailable),ball_unavailable_ranges=unavailable)
