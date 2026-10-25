from .models import MatchMetrics, SideMetrics


def reduce_metrics(events) -> MatchMetrics:
    result = MatchMetrics()
    for event in events:
        owner = event.evidence.get('possession_side')
        if owner in ('home', 'away'):
            getattr(result, owner).possession_ms += event.t1_ms - event.t0_ms
        if event.side is None:
            continue
        side = getattr(result, event.side)
        if event.type == 'goal': side.goals += 1
        elif event.type == 'shot':
            side.shots += 1
            side.shots_on_target += event.outcome in ('goal', 'saved')
        elif event.type == 'save': side.saves += 1
        elif event.type == 'pressure': side.pressures += 1
        elif event.type == 'tackle': side.tackles += 1
        elif event.type == 'pass':
            side.passes += 1
            side.completed_passes += event.outcome == 'complete'
    return result


class BasicReducer:
    """Possession belongs to the left sample; actions counted once on resolution."""
    def __init__(self):
        self.metrics, self.previous = MatchMetrics(), None

    def on_start(self, initial_frame): pass

    def on_sample(self, sample):
        if self.previous is not None:
            elapsed = sample.clock_ms-self.previous.clock_ms
            side = ('home', 'away')[self.previous.possession_index]
            getattr(self.metrics, side).possession_ms += elapsed
        self.previous = sample

    def on_event(self, event):
        counted = reduce_metrics([event])
        for side in ('home', 'away'):
            for name in SideMetrics.model_fields:
                if name != 'possession_ms':
                    value = getattr(getattr(counted, side), name)
                    current = getattr(self.metrics, side)
                    setattr(current, name, getattr(current, name)+value)


def metrics_until(record, end_ms):
    from .replay_models import MatchRecordV2
    if not isinstance(record, MatchRecordV2):
        return reduce_metrics(e for e in record.events if e.t1_ms <= end_ms)
    reducer = BasicReducer()
    for sample in record.motion:
        if sample.clock_ms > end_ms: break
        reducer.on_sample(sample)
    for event in record.events:
        if event.t1_ms <= end_ms: reducer.on_event(event)
    return reducer.metrics
