"""Observed geometry and possession exposure; never extrapolates physical effort."""
from collections import defaultdict
from math import hypot
from .statistics_events import meters,SIDES
from .statistics_models import GrfMetric,GrfCoverage,GrfShapeStatistics,GrfPositionMean,GrfOccupancy,GrfTeamShape
from .statistics_possession import TeamPossession


def reduce_shape(record)->GrfShapeStatistics:
    verified=record.schema_version=='grf-experimental-3'
    coverage=GrfCoverage(events_complete=verified,native_clock_available=True,activity_verified=verified,
        warnings=[] if verified else ['activity_not_recorded'])
    possession=defaultdict(int);ranges=[];means=defaultdict(lambda:[0.,0.,0]);bins=defaultdict(int)
    shape=defaultdict(lambda:[0.,0.,0]);shape_ranges=defaultdict(list)
    team_control=TeamPossession(record.telemetry.events) if verified else None
    for a,b in zip(record.samples,record.samples[1:]):
        dt=b.actual_time_ms-a.actual_time_ms
        ax=[meters(p) for p in a.home_xy+a.away_xy];bx=[meters(p) for p in b.home_xy+b.away_xy]
        eligible=(0<dt<=100 and a.phase==b.phase and a.in_play and b.in_play and
            not a.set_piece and not b.set_piece and a.game_mode==b.game_mode==0 and
            all(hypot(x-u,y-v)<=3 for (x,y),(u,v) in zip(ax,bx)) and
            hypot(*(u-v for u,v in zip(meters(a.ball_xyz),meters(b.ball_xyz))))<=10)
        if team_control:team_control.interval(a,b,eligible)
        if not eligible:
            coverage.excluded_ms+=max(0,dt);continue
        coverage.eligible_ms+=dt;ranges.append((a.index,b.index))
        possession[SIDES[a.owner_team] if a.owner_team>=0 and a.owner_slot>=0 else 'free']+=dt
        for side,start in (('home',0),('away',11)):
            active=getattr(a,side+'_active',[True]*11);next_active=getattr(b,side+'_active',[True]*11)
            field=[]
            for slot,(x,y) in enumerate(ax[start:start+11]):
                if not (active[slot] and next_active[slot]):continue
                player=record.input.players[start+slot]
                accum=means[side,player.id,a.phase];accum[0]+=x*dt;accum[1]+=y*dt;accum[2]+=dt
                if 0<=x<=105 and 0<=y<=68:
                    bins[side,player.id,a.phase,min(11,int(x/105*12)),min(7,int(y/68*8))]+=dt
                else:coverage.outside_player_ms+=dt
                if player.role!='GK':field.append((x,y))
            if len(field)==10:
                xs,ys=zip(*field);accum=shape[side,a.phase]
                accum[0]+=(max(xs)-min(xs))*dt;accum[1]+=(max(ys)-min(ys))*dt;accum[2]+=dt
                shape_ranges[side].append((a.index,b.index))
    teams={s:{} for s in SIDES};exposure=coverage.eligible_ms
    coverage.free_ball_pct=100*possession['free']/exposure if exposure else None
    for side in SIDES:
        assigned=sum(team_control.exposure) if team_control else 0
        teams[side]['team_possession_pct']=GrfMetric(
            value=100*team_control.exposure[SIDES.index(side)]/assigned if assigned else None,
            availability='derived' if assigned else 'unavailable',definition_id='team_possession_pct',
            numerator=team_control.exposure[SIDES.index(side)] if team_control else None,
            denominator=assigned if team_control else None,covered_ms=assigned,
            reason=None if assigned else 'no_attributable_samples' if verified else 'events_not_recorded',
            sample_ranges=team_control.ranges if team_control else [],event_refs=team_control.refs if team_control else [])
        teams[side]['possession_pct']=GrfMetric(value=100*possession[side]/exposure if exposure else None,
            availability='derived' if exposure else 'unavailable',definition_id='possession_pct',
            numerator=possession[side],denominator=exposure,covered_ms=exposure,
            reason=None if exposure else 'no_eligible_samples',sample_ranges=ranges)
        for column,name in ((0,'team_length_m'),(1,'team_width_m')):
            total=sum(v[column] for (s,_),v in shape.items() if s==side)
            covered=sum(v[2] for (s,_),v in shape.items() if s==side)
            teams[side][name]=GrfMetric(value=total/covered if covered else None,
                availability='derived' if covered else 'unavailable',definition_id=name,covered_ms=covered,
                numerator=total,denominator=covered,reason=None if covered else 'no_eligible_samples',sample_ranges=shape_ranges[side])
    return GrfShapeStatistics(by_team=teams,coverage=coverage,
        positions=[GrfPositionMean(side=s,player_id=p,phase=phase,x=x/n,y=y/n,covered_ms=n)
            for (s,p,phase),(x,y,n) in sorted(means.items()) if n],
        occupancy=[GrfOccupancy(side=s,player_id=p,phase=phase,col=x,row=y,duration_ms=n)
            for (s,p,phase,x,y),n in sorted(bins.items())],
        team_shape=[GrfTeamShape(side=s,phase=phase,length_m=x/n,width_m=y/n,covered_ms=n)
            for (s,phase),(x,y,n) in sorted(shape.items()) if n])
