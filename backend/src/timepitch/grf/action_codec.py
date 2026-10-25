"""Incremental admission of action evidence, with no native execution or retained replay rows."""
import hashlib
import re
from bisect import bisect_left,bisect_right
from .action_models import ActionInput, ActionChunk, ActionManifest, ActionChunkRef, ACTION_NATIVE_SHA256, SUPPORTED_ACTION_NATIVE_SHA256S
from .physical_codec import encode_chunk, validate_pair, manifest_hash
from .physical_wire import (canonical, pack_samples, MAX_EVENTS, MAX_SAMPLES, MAX_TOTAL_COMPRESSED,
    MAX_TOTAL_EXPANDED, MAX_MANIFEST, MAX_COMPRESSED, MAX_EXPANDED, CAUSES)
from .physical_clock import ClockState, ClockObservation, advance_clock
from .codec import grf_input_hash, ATTRIBUTES, ROLES


def make_action_chunk_ref(chunk,raw=None):
    logical=canonical(chunk.model_dump(mode='json'))
    expanded=canonical(pack_samples(chunk.model_dump(mode='json')))
    raw=encode_chunk(chunk) if raw is None else raw
    if len(expanded)>MAX_EXPANDED or len(raw)>MAX_COMPRESSED:raise ValueError('Action block budget')
    return ActionChunkRef(index=chunk.index,samples=len(chunk.samples),events=len(chunk.events),
        semantic_events=len(chunk.semantic_events),physics_start=int(chunk.samples[0][1]),physics_end=int(chunk.samples[-1][1]),
        compressed_bytes=len(raw),expanded_bytes=len(expanded),sha256=hashlib.sha256(logical).hexdigest())


class ActionStreamValidator:
    """Prefixes are evidence only. Only finish() can admit a complete match.

    Keeps the previous row, chunk refs and bounded unresolved contact metadata,
    release identities and retention state, never previous sample blocks.
    """
    def __init__(self,request:ActionInput,native_sha256:str,*,_research_native_sha256:str|None=None):
        self.request=ActionInput.model_validate(request.model_dump(mode='json'))
        self.native_sha256=native_sha256
        admitted=native_sha256 in SUPPORTED_ACTION_NATIVE_SHA256S
        if _research_native_sha256 is not None:
            admitted=(isinstance(native_sha256,str) and re.fullmatch('[0-9a-f]{64}',native_sha256) is not None
                and native_sha256==_research_native_sha256)
        if not admitted or request.input_hash!=grf_input_hash(request):
            raise ValueError('Action input or native mismatch')
        identities={(p.side,p.slot) for p in request.players}
        if identities!={(side,slot) for side in ('home','away') for slot in range(11)} or len({p.id for p in request.players})!=22:
            raise ValueError('Invalid action participants')
        for p in request.players:
            if (p.id!=f'{p.side}:{p.source_key}' or p.source_key!=getattr(request.config,p.side+'_players')[p.slot] or
                p.native_role!=ROLES[p.role] or set(p.attributes)!=ATTRIBUTES or set(p.provenance)!=ATTRIBUTES):
                raise ValueError('Action catalogue mismatch')
        self.previous=None;self.clock=ClockState();self.refs=[]
        self.raw_count=0;self.semantic_count=0;self.sample_count=0
        self.compressed=0;self.expanded=0;self.last_raw_time=-1;self.last_semantic_time=-1
        self.pending={};self.release_keys=set();self.retainer=None;self.last_release=None;self.finished=False
        self.last_semantic_raw_seq=-1
        self.restart_history={1:[(0,0,'none')],2:[(0,0,'none')]}
        self.restart_identities={};self.semantic_contexts=[]

    def _validate_restart_contexts(self):
        timelines={p:sorted(history,key=lambda value:value[0]) for p,history in self.restart_history.items()}
        starts={p:[value[0] for value in history] for p,history in timelines.items()}
        for time,period,identity,cause in self.semantic_contexts:
            right=bisect_right(starts[period],time);left=bisect_left(starts[period],time)
            # A contact may itself trigger a referee update in the same ms.
            # Snapshots cannot distinguish the order of those two hooks.
            candidates=timelines[period][max(0,left-1):right]
            if (identity,cause) not in [value[1:] for value in candidates]:
                raise ValueError('Semantic restart context contradicts chronology')

    def append(self,chunk:ActionChunk)->None:
        if self.finished:raise ValueError('Action stream already finished')
        if not isinstance(chunk,ActionChunk):raise ValueError('Mixed action versions')
        chunk=ActionChunk.model_validate(chunk.model_dump(mode='json'))
        if chunk.index!=len(self.refs):raise ValueError('Action block sequence')
        if self.raw_count+self.semantic_count+len(chunk.events)+len(chunk.semantic_events)>MAX_EVENTS:
            raise ValueError('Combined event budget')
        ref=make_action_chunk_ref(chunk)
        self.compressed+=ref.compressed_bytes;self.expanded+=ref.expanded_bytes
        if self.compressed>MAX_TOTAL_COMPRESSED or self.expanded>MAX_TOTAL_EXPANDED:raise ValueError('Action stream budget')
        captures={}
        for row in chunk.samples:
            previous=self.previous
            if previous is None:
                if row[:5]!=[0,0,1,0,0] or row[15:17]!=[0,0]:raise ValueError('Invalid initial action state')
            else:validate_pair(previous,row)
            period=int(row[2]);identity=int(row[8]);cause=CAUSES[int(row[10])];start=int(row[11])
            context=(identity,cause,start)
            before=(int(previous[8]),CAUSES[int(previous[10])],int(previous[11])) if previous is not None and previous[2]==period else (0,'none',0)
            if identity:
                known=self.restart_identities.setdefault(identity,(cause,start))
                if known!=(cause,start):raise ValueError('Action restart identity changed')
            if context!=before:
                self.restart_history[period].append((start if identity else int(row[1]),identity,cause))
            self._clock_step(row)
            if self.clock.period_elapsed_ms!=row[3]:raise ValueError('Action clock policy mismatch')
            captures[int(row[0])]=(int(previous[1]) if previous is not None else 0,int(row[1]),int(row[2]),
                int(previous[2]) if previous is not None else int(row[2]))
            self.previous=row;self.sample_count+=1
        if self.sample_count>MAX_SAMPLES:raise ValueError('Action sample budget')
        retained=[]
        for raw,role in zip(chunk.events,chunk.contact_roles):
            capture=captures.get(raw.sample_index)
            if (raw.seq!=self.raw_count or capture is None or raw.actual_time_ms<self.last_raw_time or
                not capture[0]<=raw.actual_time_ms<=capture[1] or raw.phase!=capture[2]):
                raise ValueError('Invalid action raw sequence/time')
            if (raw.type=='touch')!=(role!=0):raise ValueError('Contact role/type mismatch')
            if role:
                if raw.actor_team not in (0,1) or raw.player<0 or raw.team!=raw.actor_team:raise ValueError('Invalid contact actor')
                if role==1:retained.append(raw)
                else:self.pending[raw.seq]=(raw,role,capture)
            self.last_raw_time=raw.actual_time_ms;self.raw_count+=1
        episodes=[]
        if self.retainer is not None:episodes.append([*self.retainer,None])
        for event in chunk.semantic_events:
            if event.seq!=self.semantic_count or event.physics_ms<self.last_semantic_time:raise ValueError('Invalid semantic sequence/time')
            contact=self.pending.get(event.raw_event_seq) if event.raw_event_seq is not None else None
            capture=captures.get(event.sample_index) if contact is None else contact[2]
            # SetMatchPhase closes the old retainer before changing phase. Its
            # reset end can be drained at the zero-duration halftime sample.
            halftime_end=bool(capture is not None and event.kind=='retention_end' and
                event.retention_end_reason=='reset' and event.raw_event_seq is None and
                event.phase==1 and capture[2:]==(2,1) and capture[0]==capture[1]==event.physics_ms)
            if capture is None or not capture[0]<=event.physics_ms<=capture[1] or (event.phase!=capture[2] and not halftime_end):
                raise ValueError('Semantic event outside capture interval')
            self.semantic_contexts.append((event.physics_ms,event.phase,event.restart_id,event.restart_kind))
            actor=(event.actor_team,event.slot)
            if event.kind in ('retention_start','retention_end'):
                if event.raw_event_seq is not None or event.release_key is not None or event.origin!='unknown':raise ValueError('Invalid retention evidence')
                if event.kind=='retention_start':
                    if self.retainer is not None or event.intent!='control' or event.retention_end_reason is not None:raise ValueError('Invalid retention start')
                    self.retainer=(*actor,event.phase,event.physics_ms)
                    episodes.append([*self.retainer,None])
                else:
                    if (self.retainer is None or self.retainer[:2]!=actor or self.retainer[2]!=event.phase or
                        event.intent!='unknown' or event.retention_end_reason is None):raise ValueError('Invalid retention end')
                    if event.retention_end_reason=='released' and self.last_release!=(*actor,event.physics_ms):raise ValueError('Retention release evidence missing')
                    episodes[-1][-1]=event.physics_ms;self.retainer=None
            else:
                if contact is None:raise ValueError('Missing raw contact reference')
                if event.raw_event_seq<=self.last_semantic_raw_seq:raise ValueError('Semantic raw contact order changed')
                self.last_semantic_raw_seq=event.raw_event_seq
                raw,role,_=contact
                if (role!={'release':2,'control':3,'deflection':4,'accidental':5,'unknown_contact':6}[event.kind] or
                    (event.actor_team,event.slot,event.animation_id,event.physics_ms,event.phase,event.sample_index)!=
                    (raw.actor_team,raw.player,raw.action_id,raw.actual_time_ms,raw.phase,raw.sample_index) or event.retention_end_reason is not None):
                    raise ValueError('Crossed semantic contact evidence')
                if event.kind=='release':
                    expected={'unknown':'unknown','open_play_pass':'pass','open_play_shot':'shot','emergency_clearance':'clearance',
                        'set_piece_pass':'pass','set_piece_shot':'shot','retainer_distribution':'pass'}[event.origin]
                    key=event.release_key
                    if key is None or key[:3]!=(event.actor_team,event.slot,event.animation_id) or key in self.release_keys or event.intent!=expected:
                        raise ValueError('Invalid or duplicate release identity/intent')
                    self.release_keys.add(key);self.last_release=(*actor,event.physics_ms)
                elif event.release_key is not None or event.origin!='unknown' or event.intent!=('control' if event.kind=='control' else 'unknown'):
                    raise ValueError('Invalid contact intention')
                del self.pending[event.raw_event_seq]
            self.last_semantic_time=event.physics_ms;self.semantic_count+=1
        for raw in retained:
            if not any((raw.actor_team,raw.player,raw.phase)==tuple(e[:3]) and e[3]<=raw.actual_time_ms and
                (e[4] is None or raw.actual_time_ms<=e[4]) for e in episodes):raise ValueError('Retained contact outside retention')
        self._validate_restart_contexts()
        self.refs.append(ref)

    def finish(self,manifest:ActionManifest)->None:
        manifest=self._parse_manifest(manifest)
        if (self.finished or manifest.input!=self.request or manifest.input.input_hash!=grf_input_hash(manifest.input) or
            manifest.native_binary_sha256!=self.native_sha256 or manifest.trace_hash!=manifest_hash(manifest)):
            raise ValueError('Action input, trace or native mismatch')
        reads={(r.side,r.slot,r.attribute):r.base for r in manifest.attribute_readbacks}
        if len(reads)!=66 or any(abs(reads.get((p.side,p.slot,k),-1)-v)>1e-5 for p in self.request.players for k,v in p.attributes.items()):
            raise ValueError('Action attribute/readback mismatch')
        if (not self.refs or self.refs!=manifest.chunks or self.pending or not self.clock.finished or
            (self.raw_count,self.semantic_count)!=(manifest.raw_event_count,manifest.semantic_event_count) or
            self.previous[1]!=manifest.duration_ms or self.previous[15:17]!=list(manifest.score) or
            list(self.clock.periods)!=[p.model_dump() for p in manifest.periods] or
            [r.__dict__ for r in self.clock.ledger]!=[r.model_dump() for r in manifest.ledger]):raise ValueError('Incomplete action match')
        if len(canonical(manifest.model_dump(mode='json')))>MAX_MANIFEST:raise ValueError('Oversized action manifest')
        self._validate_completion(manifest)
        self.finished=True

    def _clock_step(self,row):
        self.clock=advance_clock(self.clock,ClockObservation(physics_ms=int(row[1]),period=int(row[2]),effective_ms=int(row[4]),
            in_play=bool(row[5]),restart_id=int(row[8]),restart_active=bool(row[9]),restart_cause=CAUSES[int(row[10])],
            restart_start_ms=int(row[11]),pending_penalty=bool(row[12]),discontinuity=bool(row[7])))

    def _parse_manifest(self,manifest):
        return ActionManifest.model_validate(manifest.model_dump(mode='json'))

    def _validate_completion(self,manifest):
        pass


def validate_action_manifest(manifest,chunks,expected=None)->None:
    validator=ActionStreamValidator(expected or manifest.input,manifest.native_binary_sha256)
    for chunk in chunks:validator.append(chunk)
    validator.finish(manifest)
