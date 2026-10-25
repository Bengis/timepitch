"""Deterministic event metrics; no interpolation, model calls or future context."""
from collections import defaultdict
from math import hypot
from .definitions import EVENT_METRICS, definitions, metric_value
from ..simulation.replay_models import StatisticsBundle, PlotPoint

SIDES = ('home', 'away')


def other(side): return 'away' if side == 'home' else 'home'


def attacking_xy(x_mm, y_mm, side, period):
    x, y = x_mm/1000, y_mm/1000
    return (x,y) if (side == 'home') == (period == 1) else (105-x,68-y)


def is_progressive(start, end):
    threshold = 30 if start[0] < 52.5 and end[0] < 52.5 else 15 if start[0] < 52.5 else 10
    return hypot(105-start[0],34-start[1])-hypot(105-end[0],34-end[1]) >= threshold-1e-9


def in_opponent_box(x, y): return 88.5 <= x <= 105 and 13.84 <= y <= 54.16


class EventStatistics:
    def __init__(self, initial_frame):
        self.initial = initial_frame
        self.players = {p.key:p for p in initial_frame.players}
        self.events, self.seen = [], {}

    def on_event(self, event):
        if event.id in self.seen:
            if self.seen[event.id] != event: raise ValueError('Conflicting statistics event ID')
            return
        if any(key not in self.players for key in event.participants): raise ValueError('Unknown statistics player')
        if self.events and event.t1_ms < self.events[-1].t1_ms: raise ValueError('Statistics events out of order')
        self.seen[event.id] = event
        self.events.append(event)

    def snapshot(self, end_ms):
        registry = {key:value for key,value in definitions().items() if key in EVENT_METRICS}
        counts, refs = defaultdict(float), defaultdict(list)
        plots = {'shots':[], 'xg':[], 'actions':[], 'pass_edges':[]}
        events = [e for e in self.events if e.t1_ms <= end_ms]
        owner, holder = self.initial.possession, self.initial.carrier
        candidates, open_loss = {}, {}
        sequences, current = {s:[] for s in SIDES}, None
        intervention_ids, recovery_ids, resolved_by_id = set(), set(), {}
        contextual = not events or all(e.context_available for e in events)

        def add(id, side, actor=None, value=1, evidence=()):
            if side not in SIDES: return
            for key in [side]+([actor] if actor in self.players else []):
                counts[key,id] += value
                refs[key,id].extend(evidence)

        def oriented(point, side, period): return attacking_xy(*point, side, period)

        def new_sequence(side,time,point,period,ids=()):
            return {'side':side,'start':time,'x':oriented(point,side,period)[0],
                    'passes':0,'ids':list(ids),'last':point,'period':period}

        def close_sequence(time, point, period):
            nonlocal current
            if current is not None:
                x = oriented(point,current['side'],period)[0]
                current.update(duration=max(0,time-current['start'])/1000, progress=x-current['x'])
                sequences[current['side']].append(current)
                current = None

        def control(side, actor, time, point, period, id):
            nonlocal owner, holder, current
            if side not in SIDES: return
            if owner != side:
                close_sequence(time,point,period)
                if owner in SIDES:
                    x = oriented(point,owner,period)[0]
                    if x < 52.5: add('own_half_losses',owner,holder,evidence=[id])
                    if x < 35: add('own_third_losses',owner,holder,evidence=[id])
                    open_loss[owner] = (time,id)
                if side in open_loss:
                    loss_time,loss_id = open_loss.pop(side)
                    add('recovery_episodes_completed',side,evidence=[loss_id,id])
                    add('_recovery_duration',side,value=(time-loss_time)/1000,evidence=[loss_id,id])
                    if time-loss_time < 5000: add('counterpress_recoveries_tp',side,evidence=[loss_id,id])
                candidates.clear()
                owner = side
                current = new_sequence(side,time,point,period,[id])
            holder = actor

        for event in events:
            resolved_by_id[event.id] = event
            kind,side = event.type,event.side
            actor = event.participants[0] if event.participants else None
            if kind in ('kickoff','restart','halftime','fulltime'):
                if event.context_available and event.end_mm is not None:
                    if kind != 'fulltime' and current is not None:
                        close_sequence(event.t1_ms,current['last'],current['period'])
                    else: close_sequence(event.t1_ms,event.end_mm,event.period)
                candidates.clear()
                if kind != 'fulltime': open_loss.clear()
                if side in SIDES:
                    owner,holder = side,actor
                    if event.context_available and event.end_mm is not None:
                        current = new_sequence(side,event.t1_ms,event.end_mm,event.period,[event.id])
                continue
            if kind == 'goal': add('_goals',side,actor,evidence=[event.id])
            if kind == 'shot':
                xg = event.evidence.get('simulated_xg')
                if isinstance(xg,(int,float)) and not isinstance(xg,bool) and 0 <= xg <= 1:
                    add('simulated_xg',side,actor,xg,[event.id])
                    add('simulated_xga',other(side),value=xg,evidence=[event.id])
                    add('_shots',side,actor,evidence=[event.id])
                    plots['xg'].append(PlotPoint(kind='xg',time_ms=event.t1_ms,side=side,
                        player_key=actor,event_id=event.id,value=counts[side,'simulated_xg']))
                    if event.context_available and event.origin_mm is not None:
                        x,y = oriented(event.origin_mm,side,event.period)
                        plots['shots'].append(PlotPoint(kind='shot',time_ms=event.t1_ms,side=side,
                            player_key=actor,event_id=event.id,x=x,y=y,value=xg))
            if not event.context_available or event.origin_mm is None or event.end_mm is None: continue
            origin, destination = oriented(event.origin_mm,side,event.period) if side else (0,0), oriented(event.end_mm,side,event.period) if side else (0,0)
            if side in SIDES and kind in ('pass','carry','shot'):
                control(side,actor,event.released_ms,event.origin_mm,event.period,event.id)
                if current is None:
                    initial_sequence = event.sequence_id == 0 and not any(sequences.values())
                    current = new_sequence(side,self.initial.clock_ms if initial_sequence else event.released_ms,
                        (round(self.initial.ball.x*1000),round(self.initial.ball.y*1000)) if initial_sequence else event.origin_mm,
                        self.initial.period if initial_sequence else event.period)
                current['ids'].append(event.id)
                current['last'],current['period'] = event.end_mm,event.period
            if side in SIDES and kind in ('pass','carry','shot','pressure','tackle','recovery'):
                plots['actions'].append(PlotPoint(kind='action',time_ms=event.t1_ms,side=side,
                    player_key=actor,event_id=event.id,x=origin[0],y=origin[1],value=1))
            if kind in ('pass','carry'):
                complete = event.outcome == 'complete'
                if is_progressive(origin,destination):
                    prefix = 'progressive_passes_' if kind == 'pass' else 'progressive_carries_'
                    add(prefix+'attempted',side,actor,evidence=[event.id])
                    if complete: add(prefix+'completed',side,actor,evidence=[event.id])
                if complete:
                    if origin[0] < 70 <= destination[0]: add('final_third_entries',side,actor,evidence=[event.id])
                    if not in_opponent_box(*origin) and in_opponent_box(*destination): add('box_entries',side,actor,evidence=[event.id])
                if kind == 'carry':
                    candidate = candidates.get(side)
                    if candidate and candidate['receiver'] == actor:
                        candidate['travel'] += hypot(destination[0]-origin[0],destination[1]-origin[1])
                        candidate['last'] = event.end_mm
                else:
                    candidates.pop(side,None)
                    if complete:
                        receiver = event.participants[-1]
                        current['passes'] += 1
                        holder = receiver
                        if origin[0] >= 70 and destination[0] >= 70: add('_tilt',side,evidence=[event.id])
                        if origin[0] <= 63 and destination[0] <= 63: add('_eligible_passes',side,evidence=[event.id])
                        candidates[side] = {'event':event,'receiver':receiver,'travel':0.,'last':event.end_mm}
                        plots['pass_edges'].append(PlotPoint(kind='pass_edge',time_ms=event.t1_ms,side=side,
                            player_key=actor,related_player_key=receiver,event_id=event.id,x=origin[0],y=origin[1],value=1))
                    elif event.outcome == 'intercepted':
                        winner = event.participants[-1]
                        rival = other(side)
                        if oriented(event.end_mm,rival,event.period)[0] >= 42:
                            intervention_ids.add(event.id)
                            add('_interventions',rival,evidence=[event.id])
                        control(rival,winner,event.t1_ms,event.end_mm,event.period,event.id)
            elif kind == 'shot':
                candidate = candidates.pop(side,None)
                if candidate and type(event.evidence.get('simulated_xg')) in (int,float) and 0 <= event.evidence['simulated_xg'] <= 1:
                    delivery = candidate['event']
                    carried = candidate['travel']+hypot(event.origin_mm[0]-candidate['last'][0],event.origin_mm[1]-candidate['last'][1])/1000
                    if (candidate['receiver'] == actor and delivery.sequence_id == event.sequence_id
                            and delivery.possession_id == event.possession_id
                            and 0 <= event.released_ms-delivery.t1_ms <= 5000 and carried <= 5):
                        ids = [delivery.id,event.id]
                        add('key_passes',side,delivery.participants[0],evidence=ids)
                        add('xg_assisted',side,delivery.participants[0],event.evidence['simulated_xg'],ids)
                close_sequence(event.released_ms,event.origin_mm,event.period)
            elif kind in ('recovery','save'):
                control(side,actor,event.t1_ms,event.end_mm,event.period,event.id)
                if kind == 'recovery':
                    cause = tuple(event.related_event_ids) or (event.id,)
                    if cause in recovery_ids: continue
                    recovery_ids.add(cause)
                    if destination[0] >= 70: add('high_recoveries',side,actor,evidence=[event.id])
                    for related in event.related_event_ids:
                        pressure = resolved_by_id.get(related)
                        if pressure and pressure.type == 'pressure' and pressure.side == side and pressure.t1_ms <= event.t1_ms:
                            add('pressure_linked_recoveries',side,pressure.participants[0],evidence=[related,event.id])
            elif kind in ('pressure','tackle'):
                if kind == 'pressure': add('pressure_attempts',side,actor,evidence=[event.id])
                elif event.outcome == 'won_ball':
                    if destination[0] >= 42 and event.id not in intervention_ids:
                        intervention_ids.add(event.id)
                        add('_interventions',side,evidence=[event.id])
                    control(side,actor,event.t1_ms,event.end_mm,event.period,event.id)
        if current is not None: close_sequence(end_ms,current['last'],current['period'])
        for side, (_,loss_id) in open_loss.items():
            counts[side,'recovery_episodes_open'] = 1
            refs[side,'recovery_episodes_open'] = [loss_id]

        def values(key, team):
            result = {}
            for id,definition in registry.items():
                if not team and definition.parameters['scope'] == 'team': continue
                value,denominator = counts[key,id],None
                evidence = refs[key,id]
                if id == 'simulated_xgd':
                    value = counts[key,'simulated_xg']-counts[key,'simulated_xga']
                    evidence = refs[key,'simulated_xg']+refs[key,'simulated_xga']
                elif id == 'simulated_xg_per_shot':
                    denominator = counts[key,'_shots']
                    value = counts[key,'simulated_xg']/denominator if denominator else None
                    evidence = refs[key,'simulated_xg']
                elif id == 'goals_minus_xg':
                    value = counts[key,'_goals']-counts[key,'simulated_xg']
                    evidence = refs[key,'_goals']+refs[key,'simulated_xg']
                elif id == 'field_tilt_tp':
                    denominator = sum(counts[s,'_tilt'] for s in SIDES)
                    value = 100*counts[key,'_tilt']/denominator if denominator else None
                    evidence = sum((refs[s,'_tilt'] for s in SIDES),[])
                elif id == 'passes_per_intervention_tp':
                    denominator = counts[key,'_interventions']
                    value = counts[other(key),'_eligible_passes']/denominator if denominator else None
                    evidence = refs[other(key),'_eligible_passes']+refs[key,'_interventions']
                elif id == 'recovery_time_s':
                    denominator = counts[key,'recovery_episodes_completed']
                    value = counts[key,'_recovery_duration']/denominator if denominator else None
                    evidence = refs[key,'_recovery_duration']
                elif id in ('sequence_duration_s','passes_per_sequence','sequence_progress_m','sequence_direct_speed_m_s'):
                    rows = sequences[key]
                    if id == 'sequence_direct_speed_m_s': rows = [r for r in rows if r['duration'] > 0]
                    denominator = len(rows)
                    field = {'sequence_duration_s':'duration','passes_per_sequence':'passes','sequence_progress_m':'progress'}.get(id)
                    value = sum(r[field] if field else r['progress']/r['duration'] for r in rows)/denominator if denominator else None
                    evidence = sum((r['ids'] for r in rows),[])
                reason = None
                if not contextual and id not in ('simulated_xg','simulated_xga','simulated_xgd','simulated_xg_per_shot','goals_minus_xg'):
                    value,reason = None,'legacy_no_context'
                result[id] = metric_value(definition,value,denominator=denominator,reason=reason,event_ids=evidence)
            return result
        return StatisticsBundle(end_ms=end_ms,definitions=registry,
            by_team={s:values(s,True) for s in SIDES},
            by_player={key:values(key,False) for key in self.players},plots=plots)
