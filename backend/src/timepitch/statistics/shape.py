"""Role geometry and aggregated occupancy; transient resets carry no stable exposure."""
from collections import defaultdict
from statistics import median
from .definitions import SHAPE_METRICS, PHYSICAL_METRICS, EVENT_METRICS, definitions, metric_value
from .events import attacking_xy
from ..simulation.replay_models import StatisticsBundle, PlotPoint


class ShapeStatistics:
    def __init__(self,initial_frame):
        self.players=initial_frame.players
        self.groups={side:{role:[i for i,p in enumerate(self.players) if p.side==side and p.role==role]
                          for role in ('DEF','MID','FWD')} for side in ('home','away')}
        self.previous,self.index=None,-1
        self.totals,self.exposure,self.occupancy=defaultdict(float),defaultdict(float),defaultdict(float)
        self.zones,self.possession_seconds=defaultdict(float),defaultdict(float)
        self.ranges=defaultdict(list)

    def on_sample(self,sample):
        self.index+=1
        previous=self.previous
        self.previous=sample
        if previous is None or previous.reset_code or sample.reset_code or sample.clock_ms-previous.clock_ms!=250: return
        dt=.25
        owner=('home','away')[previous.possession_index]
        ball_x=attacking_xy(previous.ball_x_mm,previous.ball_y_mm,owner,previous.period)[0]
        self.zones[owner,min(2,int(ball_x/35))]+=dt
        self.possession_seconds[owner]+=dt
        for side,roles in self.groups.items():
            points={role:[attacking_xy(previous.player_xy_mm[2*i],previous.player_xy_mm[2*i+1],side,previous.period)
                          for i in indices] for role,indices in roles.items()}
            all_points=sum(points.values(),[])
            xs,ys=zip(*all_points)
            centers={role:sum(p[0] for p in positions)/len(positions) for role,positions in points.items()}
            values={'team_length_m':max(xs)-min(xs),'team_width_m':max(ys)-min(ys),
                'defensive_line_height_m':median(p[0] for p in points['DEF']),
                'def_mid_gap_m':centers['MID']-centers['DEF'],'mid_fwd_gap_m':centers['FWD']-centers['MID']}
            phase='in_possession' if side==owner else 'out_of_possession'
            for label in ('all',phase):
                self.exposure[side,label]+=dt
                ranges=self.ranges[side,label]
                if ranges and ranges[-1][1]==self.index-1: ranges[-1]=(ranges[-1][0],self.index)
                else: ranges.append((self.index-1,self.index))
                for id,value in values.items(): self.totals[side,label,id]+=value*dt
            for x,y in all_points:
                cx,cy=min(11,int(x/105*12)),min(7,int(y/68*8))
                self.occupancy[side,phase,cx,cy]+=dt

    def result(self,end_ms):
        if self.previous and self.previous.clock_ms>end_ms: raise ValueError('Cannot rewind a shape stream')
        registry={k:v for k,v in definitions().items() if k not in EVENT_METRICS and k not in PHYSICAL_METRICS}
        teams={side:{} for side in ('home','away')}
        for side,metrics in teams.items():
            for id,definition in registry.items():
                if id.startswith('possession_'):
                    zone=('own','middle','opponent').index(definition.parameters['zone'])
                    denominator=self.possession_seconds[side]
                    value=100*self.zones[side,zone]/denominator if denominator else None
                    ranges=self.ranges[side,'in_possession']
                else:
                    phase=definition.parameters['phase']
                    base=id if phase=='all' else id.removesuffix('_'+phase)
                    denominator=self.exposure[side,phase]
                    value=self.totals[side,phase,base]/denominator if denominator else None
                    ranges=self.ranges[side,phase]
                metrics[id]=metric_value(definition,value,denominator=denominator,source='timepitch:role-geometry',
                    sample_ranges=ranges,covered_minutes=denominator/60)
        plots={'occupancy_in_possession':[],'occupancy_out_of_possession':[]}
        for (side,phase,x,y),seconds in sorted(self.occupancy.items()):
            plots['occupancy_'+phase].append(PlotPoint(kind='occupancy',time_ms=end_ms,side=side,
                x=(x+.5)*105/12,y=(y+.5)*68/8,value=seconds))
        return StatisticsBundle(end_ms=end_ms,definitions=registry,by_team=teams,by_player={},plots=plots)
