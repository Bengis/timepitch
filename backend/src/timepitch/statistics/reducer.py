"""The same observer serves stored traces, queries and the fast statistics path."""
from .events import EventStatistics
from .physical import PhysicalStatistics
from .shape import ShapeStatistics
from ..simulation.replay import event_view
from ..simulation.replay_models import StatisticsBundle


class AdvancedReducer:
    def on_start(self,initial_frame):
        self.events=EventStatistics(initial_frame)
        self.physical=PhysicalStatistics(initial_frame)
        self.shape=ShapeStatistics(initial_frame)

    def on_sample(self,sample):
        self.physical.on_sample(sample)
        self.shape.on_sample(sample)

    def on_event(self,event): self.events.on_event(event_view(event))

    def result(self,end_ms):
        result=StatisticsBundle(end_ms=end_ms,definitions={},by_team={'home':{},'away':{}},by_player={})
        for part in (self.events.snapshot(end_ms),self.physical.result(end_ms),self.shape.result(end_ms)):
            result.definitions.update(part.definitions)
            for side,metrics in part.by_team.items(): result.by_team[side].update(metrics)
            for player,metrics in part.by_player.items(): result.by_player.setdefault(player,{}).update(metrics)
            result.plots.update(part.plots)
        return result
