"""Event-led identity/appearance intervals; formation records never change membership."""
from collections.abc import Sequence

from .clock import build_clock
from .models import (FormationChange, HistoricalEvent, HistoricalMatch, ParticipationIncident,
                     ParticipationInterval, ParticipationTimeline, PeriodPoint)


def event_point(event: HistoricalEvent) -> PeriodPoint:
    return PeriodPoint(period=event.period, period_ms=event.period_ms)


def card_name(event: HistoricalEvent) -> str | None:
    for field in ('bad_behaviour','foul_committed'):
        detail = event.details.get(field)
        card = detail.get('card') if isinstance(detail,dict) else None
        if isinstance(card,dict) and isinstance(card.get('name'),str):
            return card['name']
    return None


def nested_key(value) -> str | None:
    return f"statsbomb:{value['id']}" if isinstance(value,dict) and type(value.get('id')) is int and value['id'] > 0 else None


def build_participation(match: HistoricalMatch, events: Sequence[HistoricalEvent]) -> ParticipationTimeline:
    clock = build_clock(events)
    players = [p.model_copy(update={'positions':[], 'cards':[]}) for lineup in match.lineups for p in lineup.players]
    teams = {p.key:lineup.team_key for lineup in match.lineups for p in lineup.players}
    active, intervals, incidents, formations, dismissed, temporary = {}, [], [], [], set(), set()

    def issue(code, event=None):
        incidents.append(ParticipationIncident(code=code, at=event_point(event) if event else None,
                                              event_ids=[event.id] if event else []))

    def enter(key, team, at, refs):
        active[key]=(team,at,refs)

    def leave(key, event):
        team, start, refs=active.pop(key)
        intervals.append(ParticipationInterval(player_key=key,team_key=team,start=start,
                                               end=event_point(event),event_ids=refs+[event.id]))

    ordered=sorted(events,key=lambda e:(e.period,e.period_ms,e.source_index))
    for team in (match.home_team.key,match.away_team.key):
        starts=[e for e in ordered if e.type=='Starting XI' and e.team_key==team]
        lineup=starts[0].details.get('tactics',{}).get('lineup',[]) if len(starts)==1 else []
        keys=[nested_key(x.get('player')) for x in lineup if isinstance(x,dict)]
        if (len(keys)!=11 or len(set(keys))!=11 or any(teams.get(k)!=team for k in keys)
                or starts[0].period!=1 or starts[0].period_ms!=0):
            issue('unknown_starting_xi_team:'+team)
            for player_key in teams:
                if teams[player_key]==team:
                    issue('unknown_starting_xi:'+player_key)
            continue
        for key in keys:
            enter(key,team,PeriodPoint(period=1,period_ms=0),[starts[0].id])

    for event in ordered:
        key,team,at=event.player_key,event.team_key,event_point(event)
        if event.type in ('Starting XI','Tactical Shift'):
            if team not in (match.home_team.key,match.away_team.key):
                issue('unattributed_formation',event)
                continue
            detail=event.details.get('tactics',{})
            keys=[nested_key(x.get('player')) for x in detail.get('lineup',[]) if isinstance(x,dict)]
            formations.append(FormationChange(team_key=team,at=at,formation=detail.get('formation'),
                                               player_keys=[k for k in keys if k],event_id=event.id))
            if event.type=='Tactical Shift':
                for k in keys:
                    if k not in active:
                        issue('inactive_tactical_player:'+str(k),event)
        elif event.type=='Substitution':
            replacement=nested_key(event.details.get('substitution',{}).get('replacement'))
            if (key not in active and key not in temporary or teams.get(key)!=team or
                    teams.get(replacement)!=team or replacement in active or replacement in dismissed):
                issue('invalid_substitution:'+str(key),event)
                if key in active and teams.get(key)==team:
                    leave(key,event)
                    dismissed.add(key)
                continue
            if key in active:
                leave(key,event)
            temporary.discard(key)
            dismissed.add(key)  # cannot return as a Player On
            enter(replacement,team,at,[event.id])
        elif event.type=='Player Off':
            if key in active:
                leave(key,event)
                if event.details.get('player_off',{}).get('permanent') is True:
                    dismissed.add(key)
                else:
                    temporary.add(key)
            else:
                issue('inactive_player_off:'+str(key),event)
        elif event.type=='Player On':
            if key in temporary and key not in dismissed and teams.get(key)==team:
                temporary.remove(key)
                enter(key,team,at,[event.id])
            else:
                issue('unresolved_player_on:'+str(key),event)
        if card_name(event) in ('Red Card','Second Yellow'):
            if key in active:
                leave(key,event)
            elif key not in temporary:
                # A bench card is recorded, but never removes another participant.
                issue('dismissal_outside_active:'+str(key),event)
            temporary.discard(key)
            dismissed.add(key)
    for key,(team,start,refs) in active.items():
        intervals.append(ParticipationInterval(player_key=key,team_key=team,start=start,event_ids=refs))
    entered={i.player_key for i in intervals}
    for lineup in match.lineups:
        for player in lineup.players:
            if player.positions and player.key not in entered:
                # A final lineup annotation does not provide an exact event time.
                issue('unresolved_lineup_entry:'+player.key)
            for position in player.positions:
                if not isinstance(position,dict):
                    issue('lineup_interval_conflict:'+player.key)
                    continue
                start_period,end_period=position.get('from_period'),position.get('to_period')
                if (type(start_period) is int and type(end_period) is int and
                        (end_period < start_period or end_period==start_period and
                         str(position.get('to','')) < str(position.get('from','')))):
                    issue('lineup_interval_conflict:'+player.key)
    return ParticipationTimeline(clock=clock,players=players,teams=teams,intervals=intervals,
                                 incidents=incidents,formations=formations)
