"""Portable 3.10 adapter: normalize each native channel exactly once."""
if __package__:
    from .physical_native import PhysicalNativeAdapter
    from .native_telemetry import normalize_events
    from .physical_wire import MAX_EVENTS, MAX_PHYSICS_MS
else:
    from physical_native import PhysicalNativeAdapter
    from native_telemetry import normalize_events
    from physical_wire import MAX_EVENTS, MAX_PHYSICS_MS


class ActionNativeAdapter(PhysicalNativeAdapter):
    def __init__(self,core,players):
        super().__init__(core,players=players)
        if not all(hasattr(self.engine,k) for k in ('probe_drain_actions','probe_drain_stats','probe_drain_touches')):
            raise ValueError('Native action capability unavailable')
        self.actual_origin=int(self.engine.probe_physical_state()['actual_time_ms'])
        self.raw_count=0;self.semantic_count=0

    def drain(self,sample_index:int)->dict:
        batch=dict(self.engine.probe_drain_stats());actions=dict(self.engine.probe_drain_actions())
        if not actions['enabled'] or actions['overflowed']:raise ValueError('Native action overflow/disabled')
        events=normalize_events(batch,sample_index,limit=MAX_EVENTS)
        roles=list(actions['roles']);semantic=[]
        if len(roles)!=len(events):raise ValueError('Native action role alignment')
        for event,role in zip(events,roles):
            if event['seq']!=self.raw_count or role['raw_event_seq']!=self.raw_count or type(role['role']) is not int or not 0<=role['role']<=6:
                raise ValueError('Native raw action sequence')
            event['actual_time_ms']-=self.actual_origin
            if not 0<=event['actual_time_ms']<=MAX_PHYSICS_MS:raise ValueError('Native raw time origin')
            self.raw_count+=1
        for value in actions['events']:
            event=dict(value);event['physics_ms']=event.pop('actual_time_ms')-self.actual_origin
            event.pop('touch_frame',None);event['sample_index']=sample_index
            if event['seq']!=self.semantic_count or not 0<=event['physics_ms']<=MAX_PHYSICS_MS:
                raise ValueError('Native semantic sequence/time')
            semantic.append(event);self.semantic_count+=1
        if (batch['emitted_count']!=self.raw_count or actions['raw_event_count']!=self.raw_count or
            actions['semantic_event_count']!=self.semantic_count or self.raw_count+self.semantic_count>MAX_EVENTS):
            raise ValueError('Native combined action counts/budget')
        self.engine.probe_drain_touches()
        return dict(events=events,contact_roles=[r['role'] for r in roles],semantic_events=semantic)
