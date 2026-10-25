"""Closed read-only tools bound to one already authorized record and window."""
from .models import MatchWindow,MetricFact,WindowStatistics,GroundedAnalysis
from ..simulation.metrics import metrics_until
from ..simulation.replay import events_until, frame_at
from ..simulation.replay_models import MatchRecordV2
from ..statistics.queries import statistics_until
from ..statistics.events import attacking_xy


def project_statistics(record,end_ms):
    end_ms=end_ms//250*250
    bundle=record.statistics if end_ms==5400000 and isinstance(record,MatchRecordV2) and record.statistics is not None else statistics_until(record,end_ms)
    elapsed=events_until(record,end_ms)
    facts=[]
    def add(category,metric,side,value,comparison,event_ids=(),player=None,ranges=()):
        facts.append(MetricFact(id=f'metric:{category}:{player.key if player else side}',category=category,
            metric_id=metric,side=side,player_key=player.key if player else None,
            player_name=player.name if player else None,team_name=getattr(record,side+'_name'),
            value=value.value,unit=value.unit,comparison_value=comparison,event_ids=list(event_ids),sample_ranges=list(ranges)))
    for side,rival in (('home','away'),('away','home')):
        xg=bundle.by_team[side]['simulated_xg'];opponent=bundle.by_team[rival]['simulated_xg']
        shot=next((e for e in reversed(elapsed) if e.type=='shot' and e.side==side and type(e.evidence.get('simulated_xg')) in (int,float)),None)
        if (xg.origin==opponent.origin=='simulated' and xg.status==opponent.status=='available'
                and xg.unit==opponent.unit=='xG' and xg.value is not None and opponent.value is not None
                and xg.value>opponent.value>=0 and shot):
            add('chance_quality_edge','simulated_xg',side,xg,opponent.value,[shot.id])
        tilt=bundle.by_team[side]['field_tilt_tp']
        eligible=next((e for e in reversed(elapsed) if e.type=='pass' and e.side==side and e.outcome=='complete'
            and e.context_available and e.origin_mm is not None and e.end_mm is not None
            and attacking_xy(*e.origin_mm,side,e.period)[0]>=70 and attacking_xy(*e.end_mm,side,e.period)[0]>=70),None)
        if tilt.origin=='simulated' and tilt.status=='available' and tilt.unit=='%' and tilt.value is not None and 50<tilt.value<=100 and (tilt.denominator or 0)>0 and eligible:
            add('territory_edge','field_tilt_tp',side,tilt,100-tilt.value,[eligible.id])
    if isinstance(record,MatchRecordV2):
        measured=[]
        for player in record.initial_frame.players:
            value=bundle.by_player.get(player.key,{}).get('distance_m')
            if value and value.origin=='simulated' and value.status=='available' and value.unit=='m' and value.value is not None and value.value>=0 and value.sample_ranges:
                measured.append((value.value,player.key,player,value))
        measured.sort(key=lambda item:(-item[0],item[1]))
        if len(measured)==len(record.initial_frame.players) and len(measured)>1 and measured[0][0]>measured[1][0]+1e-9:
            _,_,player,value=measured[0]
            ranges=value.sample_ranges
            if all(0<=start<=end<len(record.motion) and record.motion[end].clock_ms<=end_ms for start,end in ranges):
                # One bounded range covers the evidence; canonical reset codes still exclude placement distance.
                add('distance_leader','distance_m',player.side,value,measured[1][0],player=player,
                    ranges=[(min(r[0] for r in ranges),max(r[1] for r in ranges))])
    return WindowStatistics(end_ms=end_ms,facts=facts[:4])


def build_windows(record):
    goal = next((e.t1_ms for e in record.events if e.type == 'goal' and e.t1_ms < 2700000), 1800000)
    windows = []
    for name, end in [('moment', goal), ('halftime', 2700000), ('fulltime', 5400000)]:
        elapsed = events_until(record, end)
        statistics=project_statistics(record,end)
        candidates = [id for fact in statistics.facts for id in fact.event_ids]
        for kind in ('goal', 'shot', 'pressure'):
            candidate = next((e for e in reversed(elapsed) if e.type == kind), None)
            if candidate: candidates.append(candidate.id)
        last=elapsed[-1].id
        candidates=[id for id in dict.fromkeys(candidates) if id!=last][:3]+[last]
        windows.append(MatchWindow(id=name, end_ms=end, event_ids=candidates,
            metrics=metrics_until(record, end),score=frame_at(record, end).score,revision=record.trace_hash,statistics=statistics))
    return windows


class MatchTools:
    def __init__(self, match_id, record, window):
        self.match_id, self.record, self.window = match_id, record, window
        self.calls = 0

    def get_events(self, match_id, event_ids):
        if match_id != self.match_id or not set(event_ids) <= set(self.window.event_ids):
            raise ValueError('Tool scope does not include those events')
        events=[{'id':e.id,'type':e.type,'side':e.side,'participants':e.participants,
                 'outcome':e.outcome,'t1_ms':e.t1_ms} for e in self.record.events if e.id in event_ids and e.t1_ms<=self.window.end_ms]
        if len(events)!=len(set(event_ids)):raise ValueError('Tool reference outside resolved window')
        return events

    def get_metrics(self, match_id, window_id):
        if match_id != self.match_id or window_id != self.window.id:
            raise ValueError('Tool scope does not include that window')
        return self.window.metrics.model_dump()

    def get_statistics(self,match_id,window_id):
        if match_id!=self.match_id or window_id!=self.window.id:raise ValueError('Tool scope does not include that window')
        return (self.window.statistics or WindowStatistics(end_ms=self.window.end_ms)).model_dump()

    def observations(self):
        result={}
        def add(id,category,side,events,**extra):
            result[id]=GroundedAnalysis(window_id=self.window.id,revision=self.window.revision,score=self.window.score,
                category=category,side=side,event_ids=list(events),player_keys=[],**extra)
        for event in self.get_events(self.match_id,self.window.event_ids):
            if event['type'] in ('goal','shot','pressure'):
                add('event:'+event['id'],event['type'],event['side'],[event['id']])
        add('overview','overview',None,[self.window.event_ids[-1]])
        total=self.window.metrics.home.possession_ms+self.window.metrics.away.possession_ms
        for side in ('home','away'):
            if total and getattr(self.window.metrics,side).possession_ms/total>=.55:
                add('possession:'+side,'possession_edge',side,[self.window.event_ids[-1]])
        if self.window.statistics:
            for fact in self.window.statistics.facts:
                result[fact.id]=GroundedAnalysis(window_id=self.window.id,revision=self.window.revision,score=self.window.score,
                    category=fact.category,side=fact.side,event_ids=fact.event_ids,
                    player_keys=[fact.player_key] if fact.player_key else [],metric_id=fact.metric_id,
                    metric_player_key=fact.player_key,sample_ranges=fact.sample_ranges)
        return result

    def select_observation(self,id):
        try:return self.observations()[id]
        except KeyError:raise ValueError('Unknown authorized observation') from None

    def read_window(self):
        if self.calls >= 1: raise ValueError('Tool already read for this analysis')
        self.calls += 1
        return {'window_id': self.window.id, 'revision': self.window.revision,
                'events': self.get_events(self.match_id, self.window.event_ids),
                'metrics':self.get_metrics(self.match_id,self.window.id),'score':self.window.score.model_dump(),
                'statistics':self.get_statistics(self.match_id,self.window.id),
                'observations':[{'id':id,**analysis.model_dump(exclude={'window_id','revision','score'})} for id,analysis in self.observations().items()]}
