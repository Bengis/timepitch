"""One observer protocol for stored traces, fast metrics and future statistics."""
from typing import Protocol
from .models import RenderFrame
from .replay_models import MotionSample, ResolvedEvent


class MatchObserver(Protocol):
    def on_start(self, initial_frame: RenderFrame) -> None: ...
    def on_sample(self, sample: MotionSample) -> None: ...
    def on_event(self, event: ResolvedEvent) -> None: ...


class NullObserver:
    def on_start(self, initial_frame): pass
    def on_sample(self, sample): pass
    def on_event(self, event): pass


class TraceObserver(NullObserver):
    def __init__(self): self.initial_frame, self.motion, self.events = None, [], []
    def on_start(self, initial_frame): self.initial_frame = initial_frame
    def on_sample(self, sample): self.motion.append(sample)
    def on_event(self, event): self.events.append(event)


class CompositeObserver:
    def __init__(self,*observers): self.observers=observers
    def on_start(self,frame):
        for observer in self.observers: observer.on_start(frame)
    def on_sample(self,sample):
        for observer in self.observers: observer.on_sample(sample)
    def on_event(self,event):
        for observer in self.observers: observer.on_event(event)
