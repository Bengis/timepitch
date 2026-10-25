"""Team control exposure, including bounded native pass flight evidence."""
from .statistics_events import PASS_KINDS,CONTROL_KINDS

# Internal physical time, not the accelerated match clock. Unresolved flight must
# not grant the last passer ownership indefinitely when there is no new evidence.
MAX_PASS_FLIGHT_MS=10000


class TeamPossession:
    def __init__(self,events):
        self.events=events;self.cursor=0;self.flight=None;self.flight_free=False;self.seen_passes=set()
        self.exposure=[0,0];self.ranges=[];self.refs=[]

    def _event(self,event,phase,owner):
        if event.phase!=phase:
            self.flight=None;return None
        if event.type=='decision':
            if event.stage in ('sanctioned','prepared','awarded'):
                self.flight=None;return None
            return owner
        if event.type=='goal' or not event.in_play or event.set_piece:
            self.flight=None;return None
        intentional=(event.touch_type in (0,1) and event.kind in CONTROL_KINDS and
                     event.actor_team>=0 and event.player>=0)
        if not intentional:
            self.flight=None;return None
        if event.kind in PASS_KINDS:
            key=(event.actor_team,event.player,event.action_id)
            if key not in self.seen_passes:
                self.seen_passes.add(key)
                self.flight=(event.actor_team,event.actual_time_ms+MAX_PASS_FLIGHT_MS,event.player)
                self.flight_free=False
                self.refs.append(event.seq)
            elif self.flight and self.flight[0]!=event.actor_team:
                # Deduplication prevents a new attempt, not the physical contact:
                # an opponent's old animation still interrupts the current flight.
                self.flight=None
            return None
        self.flight=None
        if event.kind=='shot':return None
        self.refs.append(event.seq)
        return event.actor_team

    def _credit(self,start,end,owner):
        if owner is not None:
            self.exposure[owner]+=end-start
        elif self.flight:
            side,deadline,_=self.flight
            self.exposure[side]+=max(0,min(end,deadline)-start)
        if self.flight and end>=self.flight[1]:self.flight=None

    def interval(self,a,b,eligible):
        if not eligible:
            self.flight=None
            while self.cursor<len(self.events) and self.events[self.cursor].actual_time_ms<b.actual_time_ms:
                self.cursor+=1
            return
        owner=a.owner_team if a.owner_team>=0 and a.owner_slot>=0 else None
        if owner is not None:
            active=getattr(a,('home' if owner==0 else 'away')+'_active')[a.owner_slot]
            next_active=getattr(b,('home' if owner==0 else 'away')+'_active')[a.owner_slot]
            if not (active and next_active):owner=None
        if self.flight:
            if owner is None:self.flight_free=True
            elif owner!=self.flight[0] or a.owner_slot!=self.flight[2] or self.flight_free:
                # A sampled receipt is evidence too. Do not carry that old pass
                # into a later loss of control; the passer's stale launch sample
                # alone, before any free-ball sample, does not prove a receipt.
                self.flight=None
        start=a.actual_time_ms;before=sum(self.exposure)
        while self.cursor<len(self.events) and self.events[self.cursor].actual_time_ms<b.actual_time_ms:
            event=self.events[self.cursor];self.cursor+=1
            time=max(start,event.actual_time_ms)
            self._credit(start,time,owner)
            owner=self._event(event,a.phase,owner);start=time
        self._credit(start,b.actual_time_ms,owner)
        if sum(self.exposure)>before:self.ranges.append((a.index,b.index))
