"""Extract observations without inventing receipt events or movement times."""
from collections.abc import Sequence

from ..historical.clock import orient_event
from ..historical.models import HistoricalEvent,HistoricalMatch,ParticipationTimeline
from ..historical.participation import nested_key
from .models import AnchorSet,EventAnchor,MotionCut,MotionPlayer,MotionRole

BALL_TYPES={'Pass','Shot','Carry','Ball Receipt*','Ball Receipt','Ball Recovery','Interception',
            'Dribble','Clearance','Miscontrol','Dispossessed','Own Goal For','Own Goal Against'}
RESTARTS={'Corner','Free Kick','Goal Kick','Kick Off','Throw-in'}


def cut(period,start,end,entity,reason,refs=()):
    return MotionCut(id=f'{period}:{start}:{end}:{entity}:{reason}',period=period,from_ms=start,to_ms=end,
                     entity_key=entity,reason=reason,event_ids=list(refs))


def extract_anchors(match: HistoricalMatch,events: Sequence[HistoricalEvent],participation: ParticipationTimeline) -> AnchorSet:
    result,resets,roles=[],[],[]
    extents={p.period:p.duration_ms for p in participation.clock.periods}
    roster=[MotionPlayer(index=i,key=p.key,team_key=participation.teams[p.key]) for i,p in enumerate(participation.players)]
    for event in sorted(events,key=lambda e:(e.period,e.period_ms,e.source_index)):
        e=orient_event(match,event)
        duration=extents.get(e.period)
        inside=duration is not None and 0<=e.period_ms<=duration and e.period<=4
        active={p.key for p in participation.active_players(e.period,e.period_ms)} if inside else set()
        def anchor(entity,suffix,point,ms,reason=None):
            state='placed'
            if not inside or ms is not None and duration is not None and ms>duration:
                state,reason='conflict','outside_recorded_period'
            elif reason or ms is None or point is None:
                state,reason='insufficient',reason or 'missing_usable_location'
            elif entity!='ball' and entity not in active:
                state,reason='conflict','inactive_actor'
            result.append(EventAnchor(id=e.id+':'+suffix,event_id=e.id,source_index=e.source_index,
                period=e.period,period_ms=ms,entity_key=entity,location=point,status=state,reason=reason))
        if e.player_key and (e.location_source is not None or e.type in BALL_TYPES or e.type=='Pressure'):
            anchor(e.player_key,'actor',e.canonical_location,e.period_ms)
        if e.type in BALL_TYPES:
            anchor('ball','ball:origin',e.canonical_location,e.period_ms)
            if e.end_location_source is not None:
                at=e.period_ms+round(e.duration*1000) if e.duration is not None else None
                anchor('ball','ball:end',e.canonical_end_location,at,
                       'missing_usable_duration' if e.duration is None else None)
        if e.type=='Half Start':
            resets.append(cut(e.period,e.period_ms,e.period_ms,'all','period_start',[e.id]))
        detail=e.details.get('pass',{})
        restart=detail.get('type',{}).get('name') if isinstance(detail.get('type'),dict) else None
        if e.type=='Pass' and restart in RESTARTS:
            resets.append(cut(e.period,e.period_ms,e.period_ms,'all' if restart=='Kick Off' else 'ball',
                              'kickoff' if restart=='Kick Off' else 'recorded_restart',[e.id]))
        tactics=e.details.get('tactics',{})
        if e.type in ('Starting XI','Tactical Shift'):
            for row in tactics.get('lineup',[]):
                key=nested_key(row.get('player'))
                position=row.get('position',{}).get('id')
                if key and type(position) is int and (e.type=='Starting XI' or key in active):
                    roles.append(MotionRole(period=e.period,period_ms=e.period_ms,player_key=key,
                                            team_key=e.team_key,position_id=position))
        if e.type=='Substitution':
            replacement=nested_key(e.details.get('substitution',{}).get('replacement'))
            previous=next((r for r in reversed(roles) if r.player_key==e.player_key),None)
            if replacement and previous:
                roles.append(MotionRole(period=e.period,period_ms=e.period_ms,player_key=replacement,
                                        team_key=previous.team_key,position_id=previous.position_id))
    # Coalesce coincident referee records as cuts, preserving their references.
    merged={}
    for reset in resets:
        if reset.id in merged:
            reset=reset.model_copy(update={'event_ids':sorted(set(reset.event_ids+merged[reset.id].event_ids))})
        merged[reset.id]=reset
    return AnchorSet(items=result,resets=list(merged.values()),roles=roles,roster=roster,
                     source_event_count=len(events),issues=sorted(set(match.issues+participation.issues+participation.clock.issues)))
