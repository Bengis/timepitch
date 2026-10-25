"""Causal physical exposure from fixed-step integer coordinates, excluding resets."""
from math import hypot
from .definitions import PHYSICAL_METRICS, definitions, metric_value
from ..simulation.replay_models import StatisticsBundle, PlotPoint


class PhysicalStatistics:
    def __init__(self, initial_frame):
        self.players=initial_frame.players
        self.previous,self.index=None,-1
        self.seconds=0.
        self.values=[dict.fromkeys(PHYSICAL_METRICS,0.) for _ in self.players]
        self.speeds=[None]*len(self.players)
        self.episodes=[[0,0,0] for _ in self.players]
        self.ranges,self.plots=[],[]

    def on_sample(self,sample):
        self.index+=1
        previous=self.previous
        self.previous=sample
        if previous is None: return
        dt=sample.clock_ms-previous.clock_ms
        if sample.reset_code or dt!=250:
            self.speeds=[None]*len(self.players)
            self.episodes=[[0,0,0] for _ in self.players]
            return
        self.seconds+=dt/1000
        if self.ranges and self.ranges[-1][1]==self.index-1: self.ranges[-1]=(self.ranges[-1][0],self.index)
        else: self.ranges.append((self.index-1,self.index))
        before,after=previous.player_xy_mm,sample.player_xy_mm
        for i in range(len(self.players)):
            distance=hypot(after[2*i]-before[2*i],after[2*i+1]-before[2*i+1])/1000
            speed=distance/(dt/1000)
            kmh=speed*3.6
            values=self.values[i]
            values['distance_m']+=distance
            values['max_speed_kmh']=max(values['max_speed_kmh'],kmh)
            if 20<=kmh<=25: values['hsr_distance_m']+=distance
            if kmh>25:
                values['sprint_distance_m']+=distance
                values['sprint_duration_s']+=dt/1000
            acceleration=(speed-self.speeds[i])/(dt/1000) if self.speeds[i] is not None else None
            flags=[kmh>25,acceleration is not None and acceleration>3,acceleration is not None and acceleration< -3]
            for j,(flag,id) in enumerate(zip(flags,('sprint_count','high_acceleration_count','high_deceleration_count'))):
                old=self.episodes[i][j]
                self.episodes[i][j]=old+dt if flag else 0
                if old<1000<=self.episodes[i][j]: values[id]+=1
            self.speeds[i]=speed
        if sample.clock_ms//60000 != previous.clock_ms//60000:
            self.plots.extend(self._points(sample.clock_ms))

    def _points(self,time):
        return [PlotPoint(kind='effort',time_ms=time,side=p.side,player_key=p.key,
                          value=self.values[i]['distance_m']) for i,p in enumerate(self.players)]

    def result(self,end_ms):
        if self.previous and self.previous.clock_ms>end_ms: raise ValueError('Cannot rewind a physical stream')
        registry={k:v for k,v in definitions().items() if k in PHYSICAL_METRICS}
        def metrics(values):
            result={}
            for id,definition in registry.items():
                value,denominator=values[id],None
                if id in ('distance_km_per90','metres_per_minute'):
                    denominator=self.seconds/60
                    value=values['distance_m']*(5.4 if id=='distance_km_per90' else 60)/self.seconds if self.seconds else None
                result[id]=metric_value(definition,value if self.seconds else None,
                    denominator=denominator,reason=None if self.seconds else 'insufficient_samples',
                    source='timepitch:canonical-motion',covered_minutes=self.seconds/60,sample_ranges=self.ranges)
            return result
        teams={}
        for side in ('home','away'):
            rows=[v for p,v in zip(self.players,self.values) if p.side==side]
            total={id:(max(v[id] for v in rows) if id=='max_speed_kmh' else sum(v[id] for v in rows)) for id in registry}
            teams[side]=metrics(total)
        plots=list(self.plots)
        if self.seconds and (not plots or plots[-1].time_ms!=end_ms): plots.extend(self._points(end_ms))
        return StatisticsBundle(end_ms=end_ms,definitions=registry,by_team=teams,
            by_player={p.key:metrics(v) for p,v in zip(self.players,self.values)},plots={'effort':plots})
