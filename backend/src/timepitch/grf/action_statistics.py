"""Single-pass reduction of admitted raw contacts and native semantic actions."""
from collections import defaultdict
import heapq
from typing import Iterable
from .action_models import ActionManifest,ActionChunk
from .action_codec import ActionStreamValidator
from .physical_effort import PhysicalEffortAccumulator
from .physical_models import PhysicalActionCount
from .action_statistics_models import (ActionStatisticsSummary,TeamActionCounts,PlayerActionCounts,ActionRelease,
    ActionPass,ActionPassEvidence,ActionPassEdge,RetentionEpisode,ActionClassificationCoverage)


class _ActionAccumulator:
    """Internal components, not a publicly admitted replay summary.

    Buffers scalar time/barrier/exposure metadata when a contact's semantic
    reference is delayed. No previous sample blocks or position rows are kept.
    """
    def __init__(self,players,ledger=()):
        self.people={(0 if p.side=='home' else 1,p.slot):p for p in players}
        self.raw={(s,p):PhysicalActionCount(side=s,period=p) for s in ('home','away') for p in (1,2)}
        self.team={(s,p):TeamActionCounts(side=s,period=p) for s in ('home','away') for p in (1,2)}
        self.individual={(p.id,n):PlayerActionCounts(player_id=p.id,side=p.side,period=n) for p in players for n in (1,2)}
        self.unknown_cells=defaultdict(int);self.contacts=0;self.unknown_contacts=0;self.unknown_releases=0
        self.releases=[];self.passes=[];self.retentions=[];self.edges=defaultdict(list)
        self.pending=None;self.pending_restart=0;self.retainer=None;self.exposure_cursor=0
        self.heap=[];self.order=0;self.previous=None;self.finished=False;self.settled_time=-1;self.restart_ids=set()
        for restart in ledger:self._restart(restart.start,restart.period,restart.id)

    def _push(self,time,period,priority,kind,value):
        if time<=self.settled_time:raise ValueError('Late action boundary before settled evidence')
        heapq.heappush(self.heap,(time,period,priority,self.order,kind,value));self.order+=1

    def _restart(self,time,period,identity):
        key=(period,identity)
        if key not in self.restart_ids:
            self._push(time,period,1,'restart',identity);self.restart_ids.add(key)

    def add_chunk(self,chunk,watermark):
        if self.finished:raise ValueError('Action reduction already finished')
        for raw,role in zip(chunk.events,chunk.contact_roles):
            if raw.type!='touch':continue
            person=self.people[(raw.actor_team,raw.player)];cell=self.raw[(person.side,raw.phase)]
            field='pass_contacts' if raw.kind in ('short_pass','long_pass','high_pass') else ('shot_contacts' if raw.kind=='shot' else 'other_contacts')
            setattr(cell,field,getattr(cell,field)+1);self.contacts+=1
            if role==6:self.unknown_contacts+=1;self.unknown_cells[(person.id,raw.phase)]+=1
        for row in chunk.samples:
            before=self.previous;time=int(row[1]);period=int(row[2])
            current_active=sum(1<<i for i in range(22) if row[21+i*6+4])
            if before is not None:
                continuous=time-before[0]==100 and period==before[1] and not row[7] and row[19]==before[3]
                active=current_active&before[4] if continuous else 0
                self._push(time,period,0,'interval',(before[0],active))
                if period!=before[1] or row[7] or row[19]!=before[3]:self._push(time,period,1,'barrier',None)
            elif row[7]:self._push(time,period,1,'barrier',None)
            if row[8]>0 and (before is None or row[8]!=before[2]):
                self._restart(int(row[11]),period,int(row[8]))
            self.previous=(time,period,int(row[8]),int(row[19]),current_active)
        for event in chunk.semantic_events:self._push(event.physics_ms,event.phase,2,'semantic',event)
        self._drain(watermark)

    def _resolve(self,outcome,time,event=None):
        if self.pending is None:return
        release=self.pending
        receiver=self.people[(event.actor_team,event.slot)].id if outcome=='received' else None
        evidence=ActionPassEvidence(release_semantic_seq=release.semantic_seq,release_raw_event_seq=release.raw_event_seq,
            arrival_semantic_seq=event.seq if event is not None else None,arrival_raw_event_seq=event.raw_event_seq if event is not None else None,
            released_physics_ms=release.physics_ms,arrival_physics_ms=event.physics_ms if event is not None else None,
            received_physics_ms=time if outcome=='received' else None,resolved_physics_ms=time)
        result=ActionPass(**release.model_dump(),released_physics_ms=release.physics_ms,receiver_id=receiver,outcome=outcome,
            received_physics_ms=time if outcome=='received' else None,resolved_physics_ms=time,evidence=[evidence])
        self.passes.append(result)
        if outcome=='received':self.edges[(release.side,release.period,release.player_id,receiver)].append(evidence)
        self.pending=None

    def _event(self,event):
        person=self.people[(event.actor_team,event.slot)]
        if event.kind=='retention_start':
            self.retainer=RetentionEpisode(player_id=person.id,side=person.side,period=event.phase,
                start_physics_ms=event.physics_ms,start_semantic_seq=event.seq)
            self.retentions.append(self.retainer);return
        if event.kind=='retention_end':
            self.retainer.end_physics_ms=event.physics_ms;self.retainer.closed_by=event.retention_end_reason
            self.retainer.end_semantic_seq=event.seq;self.retainer=None
            if event.retention_end_reason=='reset':self._resolve('interrupted',event.physics_ms,event)
            return
        if self.pending is not None:
            if event.kind in ('control','release'):
                outcome=('intercepted' if person.side!=self.pending.side else
                    ('same_actor' if person.id==self.pending.player_id else 'received'))
            else:outcome='interrupted'
            self._resolve(outcome,event.physics_ms,event)
        if event.kind!='release':return
        release=ActionRelease(semantic_seq=event.seq,raw_event_seq=event.raw_event_seq,release_key=event.release_key,
            player_id=person.id,side=person.side,period=event.phase,physics_ms=event.physics_ms,intent=event.intent,origin=event.origin)
        self.releases.append(release)
        field={'pass':'passes','shot':'shots','clearance':'clearances','unknown':'unknown_releases'}[event.intent]
        for cell in (self.team[(person.side,event.phase)],self.individual[(person.id,event.phase)]):setattr(cell,field,getattr(cell,field)+1)
        if event.intent=='unknown':self.unknown_releases+=1;self.unknown_cells[(person.id,event.phase)]+=1
        if event.intent=='pass':self.pending=release;self.pending_restart=event.restart_id

    def _interval(self,time,period,start,active):
        cursor=self.exposure_cursor
        while cursor<len(self.retentions):
            episode=self.retentions[cursor]
            if episode.period>period or episode.start_physics_ms>=time:break
            end=episode.end_physics_ms
            if episode.period==period:
                person=next(p for p in self.people.values() if p.id==episode.player_id)
                index=person.slot+(11 if person.side=='away' else 0)
                if active&(1<<index):episode.observed_ms+=max(0,min(time,end if end is not None else time)-max(start,episode.start_physics_ms))
            if episode.period<period or (end is not None and end<=time):cursor+=1
            else:break
        self.exposure_cursor=cursor

    def _drain(self,watermark,*,inclusive=False):
        while self.heap and (self.heap[0][0]<watermark or (inclusive and self.heap[0][0]==watermark)):
            time=self.heap[0][0]
            if self.pending is not None and self.pending.physics_ms+10000<time:self._resolve('unresolved',self.pending.physics_ms+10000)
            while self.heap and self.heap[0][0]==time:
                _,period,_,_,kind,value=heapq.heappop(self.heap)
                if kind=='semantic':self._event(value)
                elif kind=='interval':self._interval(time,period,*value)
                elif kind=='restart':
                    if self.pending is not None and value!=self.pending_restart:self._resolve('interrupted',time)
                else:self._resolve('interrupted',time)
            if self.pending is not None and self.pending.physics_ms+10000<=time:self._resolve('unresolved',self.pending.physics_ms+10000)
            self.settled_time=time

    def finish(self,duration_ms,period):
        if self.finished:raise ValueError('Action reduction already finished')
        self._push(duration_ms,period,3,'final',None);self._drain(duration_ms,inclusive=True);self.finished=True
        for key,cell in self.individual.items():
            if self.unknown_cells[key]:
                cell.availability='observed_partial';self.team[(cell.side,cell.period)].availability='observed_partial'
        for episode in self.retentions:
            duration=None if episode.end_physics_ms is None else episode.end_physics_ms-episode.start_physics_ms
            episode.availability=('observed_complete' if duration is not None and episode.observed_ms==duration else
                ('observed_partial' if episode.observed_ms else 'unavailable'))
        total=len(self.releases);reasons=[]
        if self.unknown_contacts:reasons.append('unknown_contact_role')
        if self.unknown_releases:reasons.append('unknown_release_intent')
        if not self.contacts:reasons.append('no_contacts')
        if not total:reasons.append('no_releases')
        coverage=ActionClassificationCoverage(contacts=self.contacts,unknown_contacts=self.unknown_contacts,releases=total,
            classified_releases=total-self.unknown_releases,unknown_releases=self.unknown_releases,
            contact_ratio=(self.contacts-self.unknown_contacts)/self.contacts if self.contacts else None,
            release_ratio=(total-self.unknown_releases)/total if total else None,
            availability='unavailable' if not self.contacts else ('observed_partial' if self.unknown_contacts or self.unknown_releases else 'observed_complete'),reasons=reasons)
        return dict(actions=list(self.raw.values()),team_actions=list(self.team.values()),player_actions=list(self.individual.values()),
            releases=self.releases,passes=self.passes,retentions=self.retentions,classification=coverage,
            pass_edges=[ActionPassEdge(side=s,period=p,source_id=a,target_id=b,count=len(e),evidence=e) for (s,p,a,b),e in sorted(self.edges.items())])


def build_action_statistics(manifest:ActionManifest,chunks:Iterable[ActionChunk],*,_research_native_sha256:str|None=None)->ActionStatisticsSummary:
    if not isinstance(manifest,ActionManifest):raise ValueError('Action statistics require the new format')
    validator=ActionStreamValidator(manifest.input,manifest.native_binary_sha256,_research_native_sha256=_research_native_sha256)
    return _reduce_action_statistics(manifest,chunks,validator)


def _reduce_action_statistics(manifest,chunks,validator):
    """Internal shared math; research callers must supply their pinned validator."""
    effort=PhysicalEffortAccumulator(manifest.input.players);reducer=_ActionAccumulator(manifest.input.players,manifest.ledger)
    for chunk in chunks:
        validator.append(chunk)
        for row in chunk.samples:effort.add(row)
        watermark=min([chunk.samples[-1][1],*(raw.actual_time_ms for raw,_,_ in validator.pending.values())])
        reducer.add_chunk(chunk,watermark)
    validator.finish(manifest)
    result=reducer.finish(manifest.duration_ms,2)
    return ActionStatisticsSummary(trace_hash=manifest.trace_hash,input_hash=manifest.input.input_hash,score=manifest.score,
        duration_ms=manifest.duration_ms,effective_ms=sum(p.effective_ms for p in manifest.periods),periods=manifest.periods,
        ledger=manifest.ledger,players=effort.finish(),**result)
