"""Shared effort accumulator. Callers admit rows before adding them."""
from collections import deque
import math
from typing import Sequence
from .models import GrfPlayer
from .physical_models import PhysicalEffort,PhysicalPlayerEffort,PhysicalPeriodEffort


def _accumulator():
    return dict(distance=0.,observed=0,active=0,bands=[0]*4,window=deque(maxlen=3),maximum=None,reasons=set())


def _effort(a):
    coverage=a['observed']/a['active'] if a['active'] else None
    kind='unavailable' if not a['observed'] else ('observed_complete' if coverage is not None and coverage>=.95 else 'observed_partial')
    return PhysicalEffort(distance_m=a['distance'] if a['observed'] else None,observed_ms=a['observed'],
        active_ms=a['active'],coverage=coverage,distance_kind=kind,stationary_ms=a['bands'][0],walking_ms=a['bands'][1],
        running_ms=a['bands'][2],high_speed_ms=a['bands'][3],maximum_speed_m_s=a['maximum'],reasons=sorted(a['reasons']))


class PhysicalEffortAccumulator:
    def __init__(self,players:Sequence[GrfPlayer]):
        self.players=players;self.previous=None
        self.accum={period:[_accumulator() for _ in range(22)] for period in (1,2)}

    def add(self,row:list[float])->None:
        previous=self.previous
        if previous is not None:
            dt=int(row[1]-previous[1])
            continuous=dt==100 and row[2]==previous[2] and not row[7] and row[19]==previous[19]
            for i,a in enumerate(self.accum[int(row[2])]):
                offset=21+i*6
                # Preserve the V1 left-continuous exposure and exclusions exactly.
                if previous[offset+4]:a['active']+=dt
                reason=None
                if not continuous:reason='discontinuity'
                elif not (previous[offset+4] and row[offset+4]):reason='inactive_or_missing'
                distance=math.hypot(row[offset]-previous[offset],row[offset+1]-previous[offset+1])
                if reason is None and distance>20*dt/1000+1e-7:reason='implausible_displacement'
                if reason:
                    a['reasons'].add(reason);a['window'].clear();continue
                a['distance']+=distance;a['observed']+=dt
                speed=distance*1000/dt
                band=sum(speed>=t or math.isclose(speed,t,abs_tol=1e-8) for t in (.5,2.,5.5))
                if math.isclose(speed,5.5,abs_tol=1e-8):band=2
                a['bands'][band]+=dt;a['window'].append(distance)
                if len(a['window'])==3:
                    maximum=sum(a['window'])/.3
                    a['maximum']=max(a['maximum'] or 0.,maximum)
        self.previous=row

    def finish(self)->list[PhysicalPlayerEffort]:
        players=[]
        for p in self.players:
            index=p.slot+(11 if p.side=='away' else 0);parts=[self.accum[period][index] for period in (1,2)]
            total=_accumulator()
            for a in parts:
                for key in ('distance','observed','active'):total[key]+=a[key]
                total['bands']=[x+y for x,y in zip(total['bands'],a['bands'])];total['reasons']|=a['reasons']
                if a['maximum'] is not None:total['maximum']=max(total['maximum'] or 0.,a['maximum'])
            players.append(PhysicalPlayerEffort(**_effort(total).model_dump(),id=p.id,side=p.side,slot=p.slot,name=p.name,role=p.role,
                periods=[PhysicalPeriodEffort(**_effort(a).model_dump(),period=period) for period,a in enumerate(parts,1)]))
        return players
