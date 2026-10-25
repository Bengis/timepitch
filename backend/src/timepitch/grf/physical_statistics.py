"""Streaming native-metre effort; excluded geometry is never extrapolated."""
from collections import defaultdict
from typing import Iterable
from .physical_models import (PhysicalManifest,PhysicalChunk,PhysicalStatisticsSummary,
    PhysicalActionCount,PhysicalPassEdge,ActivityManifest,ActivityChunk,
    ACTIVITY_NATIVE_SHA256,PHYSICAL_NATIVE_SHA256)
from .physical_codec import make_chunk_ref,manifest_hash,validate_pair,validate_rows
from .codec import grf_input_hash
from .physical_effort import PhysicalEffortAccumulator


def build_physical_statistics(manifest:PhysicalManifest,chunks:Iterable[PhysicalChunk])->PhysicalStatisticsSummary:
    activity=isinstance(manifest,ActivityManifest)
    if (manifest.trace_hash!=manifest_hash(manifest) or manifest.input.input_hash!=grf_input_hash(manifest.input) or
        manifest.native_binary_sha256!=(ACTIVITY_NATIVE_SHA256 if activity else PHYSICAL_NATIVE_SHA256)):
        raise ValueError('Physical statistics identity mismatch')
    people={(0 if p.side=='home' else 1,p.slot):p for p in manifest.input.players}
    if set(people)!={(side,slot) for side in (0,1) for slot in range(11)} or len({p.id for p in people.values()})!=22:
        raise ValueError('Physical statistics participant mismatch')
    effort=PhysicalEffortAccumulator(manifest.input.players)
    actions={(side,period):PhysicalActionCount(side=side,period=period) for side in ('home','away') for period in (1,2)}
    edges=defaultdict(list);pending=None;previous=None;blocks=0;event_count=0;last_event_time=-1
    for chunk in chunks:
        if (blocks>=len(manifest.chunks) or chunk.index!=blocks or make_chunk_ref(chunk)!=manifest.chunks[blocks] or
            isinstance(chunk,ActivityChunk)!=activity):raise ValueError('Physical statistics block mismatch')
        validate_rows(chunk.samples)
        events=defaultdict(list)
        for event in chunk.events:
            if (event.seq!=event_count or not chunk.samples[0][0]<=event.sample_index<=chunk.samples[-1][0] or
                event.actual_time_ms<last_event_time):raise ValueError('Physical statistics event mismatch')
            events[event.sample_index].append(event);event_count+=1;last_event_time=event.actual_time_ms
        for row in chunk.samples:
            if previous is not None:
                validate_pair(previous,row)
            effort.add(row)
            # Cancel evidence across restarts, periods, missing geometry or stale flight.
            if pending and (not row[5] or row[6] or row[7] or row[2]!=pending.phase or
                row[1]-pending.actual_time_ms>10000 or (previous is not None and row[19]!=previous[19])):pending=None
            for event in events[row[0]]:
                if event.actual_time_ms>row[1] or event.phase!=row[2]:raise ValueError('Physical event clock mismatch')
                if event.type!='touch':continue
                if (event.actor_team,event.player) not in people:raise ValueError('Unknown physical contact actor')
                side='home' if event.actor_team==0 else 'away';a=actions[(side,event.phase)]
                if pending and (event.actor_team!=pending.actor_team or
                    (event.player==pending.player and event.seq!=pending.seq)):pending=None
                if event.kind in ('short_pass','long_pass','high_pass'):
                    a.pass_contacts+=1
                    source_active=row[21+(event.actor_team*11+event.player)*6+4]
                    pending=event if source_active and row[5] and not row[6] and not row[7] else None
                elif event.kind=='shot':a.shot_contacts+=1;pending=None
                else:a.other_contacts+=1
            if pending and row[13]!=-1:
                team,slot=int(row[13]),int(row[14])
                if team!=pending.actor_team:pending=None
                elif slot!=pending.player:
                    source=people[(team,pending.player)];target=people[(team,slot)]
                    # Both endpoints must be active; the native owner is direct control.
                    if row[21+(team*11+slot)*6+4] and row[21+(team*11+pending.player)*6+4]:
                        edges[(source.side,pending.phase,source.id,target.id)].append(dict(event_seq=pending.seq,
                            released_physics_ms=pending.actual_time_ms,received_physics_ms=int(row[1])))
                    pending=None
            previous=row
        blocks+=1
    if blocks!=len(manifest.chunks):raise ValueError('Incomplete physical statistics stream')
    players=effort.finish()
    pass_edges=[PhysicalPassEdge(side=side,period=period,source_id=source,target_id=target,count=len(evidence),evidence=evidence)
                for (side,period,source,target),evidence in sorted(edges.items())]
    return PhysicalStatisticsSummary(trace_hash=manifest.trace_hash,input_hash=manifest.input.input_hash,score=manifest.score,duration_ms=manifest.duration_ms,
        effective_ms=sum(p.effective_ms for p in manifest.periods),periods=manifest.periods,ledger=manifest.ledger,players=players,
        actions=list(actions.values()),pass_edges=pass_edges)
