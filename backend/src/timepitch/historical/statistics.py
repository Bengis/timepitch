"""Deterministic, cutoff-bound StatsBomb event analysis, independent of any motion."""
from collections import defaultdict
from collections.abc import Sequence
import math

from .clock import build_clock, orient_event
from .models import (HistoricalActionPoint, HistoricalChange, HistoricalEvent, HistoricalGoal,
                     HistoricalMatch, HistoricalMetric, HistoricalPassEdge, HistoricalPlayerStatistics,
                     HistoricalStatistics, HistoricalTeamStatistics, PeriodPoint)
from .participation import build_participation, card_name, event_point, nested_key

COUNT_METRICS = ('goals','own_goals','shots','passes_attempted','passes_completed','passes_unknown',
                 'pressures','yellow_cards','second_yellows','red_cards','substitutions')
UNAVAILABLE = {'possession_pct':'No measured possession supplied; overlapping durations are not possession',
               'distance_m':'No measured tracking', 'defensive_line_height_m':'No measured tracking'}


def _goals(events, match):
    goals, issues, handled = [], [], set()
    own = {e.id:e for e in events if e.type in ('Own Goal For','Own Goal Against') and e.period != 5}
    teams={match.home_team.key,match.away_team.key}
    for e in events:
        if e.id in handled or e.period==5:
            continue
        if e.team_key not in teams:
            if e.id in own or e.type=='Shot' and e.details.get('shot',{}).get('outcome',{}).get('name')=='Goal':
                issues.append('unattributed_goal:'+e.id)
            continue
        if e.type=='Shot' and e.details.get('shot',{}).get('outcome',{}).get('name')=='Goal':
            goals.append(HistoricalGoal(at=event_point(e),team_key=e.team_key,kind='regular',
                                         player_key=e.player_key,event_ids=[e.id]))
        elif e.id in own:
            beneficiary=e.team_key if e.type=='Own Goal For' else next((t for t in teams if t!=e.team_key),None)
            pairs=[p for p in own.values() if p.id!=e.id and p.type!=e.type and
                   (p.id in e.related_events or e.id in p.related_events) and
                   p.period==e.period and p.period_ms==e.period_ms and p.team_key!=e.team_key]
            pair=pairs[0] if len(pairs)==1 and pairs[0].id not in handled else None
            refs=[e.id]+([pair.id] if pair else [])
            handled.update(refs)
            against=e if e.type=='Own Goal Against' else pair
            goals.append(HistoricalGoal(at=event_point(e),team_key=beneficiary,kind='own_goal',
                own_goal_player_key=against.player_key if against else None,event_ids=refs))
            if len(pairs)>1:
                issues.append('ambiguous_own_goal_pair')
    stamps=defaultdict(list)
    for goal in goals:
        if goal.kind=='own_goal':
            stamps[(goal.team_key,goal.at.period,goal.at.period_ms)].append(goal)
    if any(len(v)>1 for v in stamps.values()):
        issues.append('unresolved_own_goal_pair')
    return goals,issues


def reduce_statistics(match: HistoricalMatch, events: Sequence[HistoricalEvent], cutoff: PeriodPoint) -> HistoricalStatistics:
    clock=build_clock(events)
    available=bool(events) and match.status!='excluded' and match.event_count==len(events)
    if events:
        clock.validate_point(cutoff)
    elif cutoff.period!=1 or cutoff.period_ms!=0:
        raise ValueError('Invalid historical cutoff: missing events')
    rows=sorted((e for e in events if (e.period,e.period_ms)<=(cutoff.period,cutoff.period_ms)),
                key=lambda e:(e.period,e.period_ms,e.source_index))
    visible_ids={e.id for e in rows}
    issues=list(clock.issues)
    source_issues=[f'{issue}:{e.id}' for e in rows for issue in e.issues]
    issues.extend(source_issues)
    # Appearance intervals are constructed once from the record, then clipped to
    # the cursor. Future exits cannot shorten earlier minutes or expose exit refs.
    participation=build_participation(match,events)
    participation_issues=[i.code for i in participation.incidents
                          if i.at is None or (i.at.period,i.at.period_ms)<=(cutoff.period,cutoff.period_ms)]
    issues.extend(participation_issues)
    goals,goal_issues=_goals(rows,match)
    issues.extend(goal_issues)
    team_keys=(match.home_team.key,match.away_team.key)
    evidence=defaultdict(lambda:defaultdict(list))
    unassigned=defaultdict(lambda:defaultdict(list))
    shot_values=defaultdict(list)
    network=defaultdict(list)
    cards,substitutions,action_map=[],[],[]
    def add(metric, e, *, player=None, team=None, refs=None):
        team=e.team_key if team is None else team
        player=e.player_key if player is None else player
        for entity in (team,player):
            if entity is not None:
                evidence[entity][metric].append(refs if refs is not None else [e.id])
        if team not in team_keys:
            for entity in team_keys:
                unassigned[entity][metric].append(e.id)
    for goal in goals:
        evidence[goal.team_key]['goals'].append(goal.event_ids)
        actor=goal.player_key if goal.kind=='regular' else goal.own_goal_player_key
        if actor:
            evidence[actor]['goals' if goal.kind=='regular' else 'own_goals'].append(goal.event_ids)
        if goal.kind=='own_goal':
            defending=next(t for t in team_keys if t!=goal.team_key)
            evidence[defending]['own_goals'].append(goal.event_ids)
    for e in rows:
        if e.period==5:
            issues.append('shootout_excluded_from_match_statistics')
            continue
        if e.type=='Shot':
            add('shots',e)
            if e.team_key not in team_keys:
                for entity in team_keys:
                    unassigned[entity]['xg'].append(e.id)
                    if e.details.get('shot',{}).get('outcome',{}).get('name')=='Goal':
                        unassigned[entity]['goals'].append(e.id)
                if e.player_key and e.details.get('shot',{}).get('outcome',{}).get('name')=='Goal':
                    evidence[e.player_key]['goals'].append([e.id])
            value=e.details.get('shot',{}).get('statsbomb_xg')
            value=value if type(value) in (int,float) and math.isfinite(value) and 0<=value<=1 else None
            for entity in (e.team_key,e.player_key):
                if entity:
                    shot_values[entity].append((e.id,value))
        elif e.type=='Pass':
            add('passes_attempted',e)
            detail=e.details.get('pass',{})
            outcome=detail.get('outcome')
            if 'pass' not in e.details:
                add('passes_unknown',e)
                issues.append('missing_pass_detail:'+e.id)
            elif outcome is None:
                add('passes_completed',e)
                recipient=nested_key(detail.get('recipient'))
                if e.player_key and recipient and participation.teams.get(recipient)==e.team_key:
                    network[(e.team_key,e.player_key,recipient)].append(e.id)
            elif isinstance(outcome,dict) and outcome.get('name') in ('Incomplete','Injury Clearance','Out','Pass Offside'):
                pass
            else:
                add('passes_unknown',e)
        elif e.type=='Pressure':
            add('pressures',e)
        elif e.type=='Substitution':
            add('substitutions',e)
            substitutions.append(HistoricalChange(at=event_point(e),team_key=e.team_key,player_key=e.player_key,
                replacement_key=nested_key(e.details.get('substitution',{}).get('replacement')),event_ids=[e.id]))
        elif e.type in ('Own Goal For','Own Goal Against') and e.team_key not in team_keys:
            for entity in team_keys:
                unassigned[entity]['goals'].append(e.id)
                unassigned[entity]['own_goals'].append(e.id)
        card=card_name(e)
        if card:
            cards.append(HistoricalChange(at=event_point(e),team_key=e.team_key,player_key=e.player_key,
                                          card=card,event_ids=[e.id]))
            metric={'Yellow Card':'yellow_cards','Second Yellow':'second_yellows','Red Card':'red_cards'}.get(card)
            if metric:
                add(metric,e)
        if e.type in ('Shot','Pass','Carry','Pressure','Interception','Ball Recovery'):
            oriented=orient_event(match,e)
            if oriented.canonical_location and e.team_key in team_keys:
                action_map.append(HistoricalActionPoint(event_id=e.id,type=e.type,team_key=e.team_key,
                    player_key=e.player_key,location=oriented.canonical_location,end_location=oriented.canonical_end_location))

    def metrics(entity):
        result={name:HistoricalMetric(value=len(evidence[entity][name]) if available and not unassigned[entity][name] else None,
                    provenance='derived_from_events' if available and not unassigned[entity][name] else 'unavailable',
                    event_ids=sorted({ref for refs in evidence[entity][name] for ref in refs} | set(unassigned[entity][name])),
                    observed_value=len(evidence[entity][name]) if available and unassigned[entity][name] else None,
                    missing_count=len(unassigned[entity][name]),
                    reason='Unattributed source events' if unassigned[entity][name] else
                           None if available else 'Event source unavailable or incomplete') for name in COUNT_METRICS}
        values=shot_values[entity]
        missing=sum(v is None for _,v in values)+len(unassigned[entity]['xg'])
        observed=sum(v for _,v in values if v is not None)
        result['xg']=HistoricalMetric(value=observed if available and missing==0 else None,
            observed_value=observed if available else None,missing_count=missing,
            provenance='derived_from_events' if available and missing==0 else 'unavailable',
            variant='statsbomb-shot-xg',event_ids=sorted({ref for ref,_ in values}|set(unassigned[entity]['xg'])),
            reason='Missing or invalid provider shot xG' if missing else None if available else 'Event source unavailable')
        if any(issue in ('ambiguous_own_goal_pair','unresolved_own_goal_pair') for issue in goal_issues):
            affected=[]
            if entity in team_keys and any(g.kind=='own_goal' and g.team_key==entity for g in goals):
                affected.append('goals')
            if any(g.kind=='own_goal' and (g.own_goal_player_key==entity or entity in team_keys and g.team_key!=entity) for g in goals):
                affected.append('own_goals')
            for name in affected:
                result[name]=result[name].model_copy(update={'value':None,'provenance':'unavailable',
                    'observed_value':result[name].value,'reason':'Ambiguous own-goal pairing'})
        for name,reason in UNAVAILABLE.items():
            result[name]=HistoricalMetric(value=None,provenance='unavailable',reason=reason)
        return result

    active={p.key for p in participation.active_players(cutoff.period,cutoff.period_ms)} if clock.periods else set()
    player_stats=[]
    for player in participation.players:
        values=metrics(player.key)
        played=participation.played_ms(player.key,cutoff) if available else None
        refs=sorted({ref for i in participation.intervals if i.player_key==player.key for ref in i.event_ids if ref in visible_ids})
        values['played_ms']=HistoricalMetric(value=played,provenance='derived_from_events' if played is not None else 'unavailable',
                                             event_ids=refs,reason=None if played is not None else 'Uncertain appearance or period extent')
        player_stats.append(HistoricalPlayerStatistics(player_key=player.key,team_key=participation.teams[player.key],
                                                       active=player.key in active,metrics=values))
    score={'home':len(evidence[team_keys[0]]['goals']),'away':len(evidence[team_keys[1]]['goals'])} if available and not goal_issues else None
    final=bool(clock.periods) and cutoff.period==clock.periods[-1].period and cutoff.period_ms==clock.periods[-1].duration_ms
    reconciliation='unavailable' if score is None else 'not_final'
    if score is not None and final:
        reconciliation='matched' if score==match.final_score else 'mismatch'
        if reconciliation=='mismatch':
            issues.append('calendar_score_mismatch')
    try:
        playback=clock.to_playback_ms(cutoff.period,cutoff.period_ms)
    except ValueError:
        playback=None
    display=(f'{ {1:0,2:45,3:90,4:105,5:120}[cutoff.period]+cutoff.period_ms//60000:02}:'
             f'{cutoff.period_ms//1000%60:02}')
    return HistoricalStatistics(match_id=match.id,cutoff=cutoff,display_clock=display,playback_ms=playback,
        score=score,reconciliation=reconciliation,
        clock_status='unavailable' if not clock.periods else 'partial' if clock.issues else 'ready',
        participation_status='unavailable' if not available or not participation.players else 'partial' if participation_issues else 'ready',
        summary_reconciled=reconciliation=='matched' and not clock.issues and not participation_issues and not source_issues,
        teams=[HistoricalTeamStatistics(team_key=k,metrics=metrics(k)) for k in team_keys],players=player_stats,
        goals=goals,substitutions=substitutions,cards=cards,
        formations=[f for f in participation.formations if (f.at.period,f.at.period_ms)<=(cutoff.period,cutoff.period_ms)],
        pass_network=[HistoricalPassEdge(team_key=k[0],player_key=k[1],recipient_key=k[2],count=len(refs),event_ids=refs)
                      for k,refs in sorted(network.items())],action_map=action_map,issues=sorted(set(issues)))
