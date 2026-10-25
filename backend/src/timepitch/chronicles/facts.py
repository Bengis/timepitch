"""Read-only adapters. Each engine retains its own metric definitions and clock."""
import math
from collections import Counter
from ..simulation.replay import ReplayRecord, frame_at
from ..grf.models import GrfReplay, GrfFullMatchReplay, GrfStatisticsReplay, GrfRecord
from ..grf.statistics_models import GrfStatisticsSummary
from .models import FactPack, ChronicleFact, EventDescriptor, Coverage, fact_pack_hash


def _assemble(engine, trace, dataset, home, away, score, full_time, coverage, goals, players, metrics, team_metrics):
    facts = [ChronicleFact(id='result', kind='result'), ChronicleFact(id='coverage', kind='coverage')]
    descriptors = []
    coverage.omitted_events = max(0, len(goals) - 8)
    for ref, side, actor, own_goal, time in goals[:8]:
        player = players.get(actor)
        facts.append(ChronicleFact(id='goal:' + ref, kind='goal', side=side, player_ids=[actor] if player else [],
            player_names=[player] if player else [], own_goal=own_goal, time_ms=time, event_refs=[ref], value=1., unit='count'))
        descriptors.append(EventDescriptor(id=ref, type='goal', time_ms=time, side=side))
    for metric in ('goals', 'pass_received', 'recoveries'):
        eligible = [(key, values.get(metric)) for key, values in metrics.items() if key in players]
        eligible = [(key, value) for key, value in eligible if value is not None and math.isfinite(value) and value > 0]
        if not eligible: continue
        highest = max(value for _, value in eligible)
        ids = sorted(key for key, value in eligible if value == highest)
        if len(ids) > 3: continue  # Never choose one tied identity by array order.
        facts.append(ChronicleFact(id='leader:' + metric, kind='actor_stat', player_ids=ids,
            player_names=[players[key] for key in ids], metric_id=metric, value=float(highest), unit='count'))
    for metric, unit in (('shots', 'count'), ('pass_received', 'count'), ('recoveries', 'count'), ('team_possession_pct', 'percent')):
        values = [team_metrics.get(s, {}).get(metric) for s in ('home', 'away')]
        if any(v is None or not math.isfinite(v) or v < 0 for v in values) or values[0] == values[1]: continue
        if unit == 'percent' and any(v > 100 for v in values): continue
        if len(facts) >= 16: break
        facts.append(ChronicleFact(id='comparison:' + metric, kind='team_compare', side='home', metric_id=metric,
            value=float(values[0]), comparison_value=float(values[1]), unit=unit, availability='derived'))
    return FactPack(engine=engine, trace_hash=trace, dataset_version=dataset, home_name=home, away_name=away,
        score=list(score), full_time_ms=full_time, coverage=coverage, facts=facts, events=descriptors)


def from_grf(record: GrfRecord, summary: GrfStatisticsSummary) -> FactPack:
    if not isinstance(record, (GrfReplay, GrfFullMatchReplay, GrfStatisticsReplay)):
        raise ValueError('Unsupported GRF replay')
    if (summary.trace_hash != record.trace_hash or summary.replay_version != record.schema_version or
        summary.score != record.samples[-1].score or summary.home_name != record.input.home_name or
        summary.away_name != record.input.away_name or summary.players != record.input.players):
        raise ValueError('Statistics identity mismatch')
    expected_clock = None if record.schema_version == 'grf-experimental-1' else record.samples[-1].match_time_ms
    if summary.full_time_ms != expected_clock: raise ValueError('Statistics clock mismatch')
    players = {p.id:p.name for p in record.input.players}
    goals = [(f'grf:{g.seq}', g.side, g.actor_id, g.own_goal, g.match_time_ms) for g in sorted(summary.goals, key=lambda g:(g.match_time_ms,g.seq))]
    metrics = {id:{k:m.value for k,m in row.items() if m.availability == 'measured'} for id,row in summary.by_player.items()}
    team = {s:{k:m.value for k,m in row.items() if m.availability in ('measured','derived')} for s,row in summary.by_team.items()}
    return _assemble('grf', record.trace_hash, record.input.dataset_version, record.input.home_name, record.input.away_name,
        summary.score, expected_clock, Coverage(events_complete=summary.coverage.events_complete, native_clock=summary.coverage.native_clock_available,
            notes=summary.coverage.warnings[:8]), goals, players, metrics, team)


def from_timepitch(record: ReplayRecord) -> FactPack:
    if not any(e.type == 'fulltime' and e.t1_ms == 5400000 for e in record.events):
        raise ValueError('Finished canonical replay required')
    end = frame_at(record, 5400000)
    players = {p.key:p.name for p in record.initial_frame.players}
    sides = {p.key:p.side for p in record.initial_frame.players}
    goals, counts = [], {key:Counter() for key in players}
    team = {s:Counter() for s in ('home','away')}
    for event in record.events:
        if event.t1_ms > 5400000: continue
        actor = event.participants[0] if event.participants else None
        if event.type == 'goal':
            own = actor in sides and sides[actor] != event.side
            goals.append((event.id, event.side, actor, own, event.t1_ms))
        metric = {'goal':'goals','shot':'shots','recovery':'recoveries'}.get(event.type)
        if event.type == 'pass' and event.outcome == 'complete': metric = 'pass_received'
        if metric and event.side in team:
            team[event.side][metric] += 1
            # Both engines define pass_received as the passer's confirmed
            # completed pass, not a reception credited to its recipient.
            if actor in counts and sides[actor] == event.side: counts[actor][metric] += 1
    total = record.metrics.home.possession_ms + record.metrics.away.possession_ms
    if total > 0:
        for side in team: team[side]['team_possession_pct'] = getattr(record.metrics, side).possession_ms / total * 100
    return _assemble('timepitch', record.trace_hash, record.dataset_version, record.home_name, record.away_name,
        [end.score.home, end.score.away], 5400000, Coverage(events_complete=True,native_clock=True), goals, players, counts, team)
