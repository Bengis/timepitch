"""Read-only retrospective comparison. Values never change a simulation input."""
from typing import Literal
from .models import (HistoricalModel,HistoricalStatistics,ComparisonMetric,ComparisonValues,ComparisonRow,HistoricalComparison)


class SimulationMetricSnapshot(HistoricalModel):
    engine: Literal['timepitch','grf']
    simulation_id: str
    trace_hash: str
    home_key: str
    away_key: str
    home_formation: str
    away_formation: str
    home_players: list[str]
    away_players: list[str]
    seed: int
    engine_version: str
    metrics: dict[str,ComparisonMetric]


def simulation_snapshot(engine,id,record,*,grf_statistics=None):
    config=record.config if engine=='timepitch' else record.input.config
    metrics={}
    def metric(key,definition,values):metrics[key]=ComparisonMetric(definition=definition,home=values[0],away=values[1])
    if engine=='timepitch':
        if not record.events or record.events[-1].type!='fulltime':raise ValueError('Comparison replay is incomplete')
        from ..statistics.queries import statistics_until
        stats=getattr(record,'statistics',None) or statistics_until(record,5_400_000)
        metric('goals','final-goal-count',[getattr(record.metrics,s).goals for s in ('home','away')])
        metric('shots','timepitch-shot-events',[getattr(record.metrics,s).shots for s in ('home','away')])
        metric('completed_passes','timepitch-resolved-passes',[getattr(record.metrics,s).completed_passes for s in ('home','away')])
        metric('xg','timepitch-generative-xg',[stats.by_team.get(s,{}).get('simulated_xg').value if stats.by_team.get(s,{}).get('simulated_xg') else None for s in ('home','away')])
    else:
        if record.schema_version not in ('grf-experimental-2','grf-experimental-3'):
            raise ValueError('Unsupported comparison replay')
        if record.completion_reason!='full_time':raise ValueError('Comparison replay is incomplete')
        metric('goals','final-goal-count',record.samples[-1].score)
        for name,source,definition in [('shots','shots','grf-native-shot-actions'),('completed_passes','pass_received','grf-confirmed-receipts')]:
            metric(name,definition,[grf_statistics.by_team[s][source].value for s in ('home','away')])
    return SimulationMetricSnapshot(engine=engine,simulation_id=id,trace_hash=record.trace_hash,home_key=config.home_key,away_key=config.away_key,
        home_formation=config.home_formation,away_formation=config.away_formation,home_players=config.home_players,away_players=config.away_players,
        seed=config.seed,engine_version=record.engine_version,metrics=metrics)


def compare_match(historical:HistoricalStatistics,simulated:SimulationMetricSnapshot,*,team_keys:tuple[str,str]|None=None)->HistoricalComparison:
    rows=[]
    teams={t.team_key:t for t in historical.teams}
    keys=team_keys or tuple(t.team_key for t in historical.teams)
    for name,source,definition in [('goals','goals','final-goal-count'),('shots','shots','statsbomb-shot-events'),('xg','xg','statsbomb-shot-xg'),('completed_passes','passes_completed','statsbomb-pass-outcome')]:
        values=[]
        for i,side in enumerate(('home','away')):
            team=teams.get(keys[i]) if i<len(keys) else None
            value=(historical.score or {}).get(side) if name=='goals' else team.metrics[source].value if team and source in team.metrics else None
            if name=='goals' and historical.reconciliation!='matched':value=None
            values.append(value)
        recorded=ComparisonMetric(home=values[0],away=values[1],definition=definition)
        other=simulated.metrics.get(name,ComparisonMetric(home=None,away=None,definition='unavailable'))
        status='unavailable' if any(v is None for v in [recorded.home,recorded.away,other.home,other.away]) else 'comparable' if (
            name=='goals' and other.definition==definition or name=='shots' and other.definition=='timepitch-shot-events') else 'different_definition'
        delta=ComparisonValues(home=other.home-recorded.home,away=other.away-recorded.away) if status=='comparable' else None
        rows.append(ComparisonRow(metric=name,historical=recorded,simulated=other,status=status,delta=delta,reason=None if status=='comparable' else status))
    return HistoricalComparison(historical_match_id=historical.match_id,historical_dataset_version=historical.dataset_version,
        historical_reconciliation=historical.reconciliation,engine=simulated.engine,simulation_id=simulated.simulation_id,trace_hash=simulated.trace_hash,
        engine_version=simulated.engine_version,seed=simulated.seed,home_key=simulated.home_key,away_key=simulated.away_key,
        historical_formations={},simulated_formations={'home':simulated.home_formation,'away':simulated.away_formation},lineup_differences=[],issues=historical.issues,rows=rows)
