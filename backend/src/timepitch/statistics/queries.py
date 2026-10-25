"""Bounded temporal queries never expose the stored final aggregate before its clock."""
from .reducer import AdvancedReducer
from .definitions import definitions, metric_value, EVENT_METRICS, PHYSICAL_METRICS
from .events import EventStatistics
from ..simulation.replay import events_until
from ..simulation.replay_models import MatchRecordV2


def statistics_until(record,end_ms):
    end_ms=max(0,min(5400000,end_ms//250*250))
    if not isinstance(record,MatchRecordV2):
        reducer=EventStatistics(record.initial_frame)
        for event in events_until(record,end_ms): reducer.on_event(event)
        result=reducer.snapshot(end_ms)
        for id,definition in definitions().items():
            if id in EVENT_METRICS: continue
            result.definitions[id]=definition
            reason='legacy_no_motion' if id in PHYSICAL_METRICS else 'legacy_no_context'
            for metrics in result.by_team.values(): metrics[id]=metric_value(definition,None,reason=reason)
            if id in PHYSICAL_METRICS:
                for metrics in result.by_player.values(): metrics[id]=metric_value(definition,None,reason=reason)
        # Even an empty legacy window has no spatial context.
        for metrics in [*result.by_team.values(),*result.by_player.values()]:
            for id,value in list(metrics.items()):
                if id in EVENT_METRICS and id not in ('simulated_xg','simulated_xga','simulated_xgd','simulated_xg_per_shot','goals_minus_xg'):
                    metrics[id]=metric_value(result.definitions[id],None,reason='legacy_no_context')
        return result
    reducer=AdvancedReducer()
    reducer.on_start(record.initial_frame)
    cursor=0
    for index,sample in enumerate(record.motion):
        if sample.clock_ms>end_ms: break
        reducer.on_sample(sample)
        while cursor<len(record.events) and record.events[cursor].sample_index==index:
            reducer.on_event(record.events[cursor])
            cursor+=1
    return reducer.result(end_ms)
