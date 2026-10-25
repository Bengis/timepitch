"""One reproducible post-match reducer for the three GRF formats."""
from .statistics_models import GrfStatisticsSummary,GrfMetricDefinition,GrfMetric,GrfShapeStatistics,GrfCoverage
from .statistics_events import reduce_events,empty_events,EVENT_METRICS,SIDES
from .statistics_shape import reduce_shape


def build_grf_statistics(record)->GrfStatisticsSummary:
    modern=record.schema_version!='grf-experimental-1';events=record.schema_version=='grf-experimental-3'
    action=reduce_events(record) if events else empty_events(record,False)
    if modern:shape=reduce_shape(record)
    else:
        shape=GrfShapeStatistics(by_team={s:{name:GrfMetric(value=None,availability='unavailable',definition_id=name,
            reason='native_clock_not_recorded') for name in ('possession_pct','team_possession_pct','team_length_m','team_width_m')} for s in SIDES},
            positions=[],occupancy=[],team_shape=[],coverage=GrfCoverage(events_complete=False,
                native_clock_available=False,activity_verified=False,warnings=['native_clock_not_recorded','events_not_recorded']))
    if not events and 'events_not_recorded' not in shape.coverage.warnings:shape.coverage.warnings.append('events_not_recorded')
    if not events:
        for i,side in enumerate(SIDES):
            action.by_team[side]['goals']=GrfMetric(value=record.samples[-1].score[i],availability='measured',definition_id='goals')
    for side in SIDES:action.by_team[side].update(shape.by_team[side])
    definitions={name:GrfMetricDefinition(unit='count',description='Count of confirmed native events; unresolved identities remain explicit.') for name in EVENT_METRICS}
    definitions.update(
        confirmed_receipt_pct=GrfMetricDefinition(unit='percent',description='Confirmed teammate receptions / native pass attempts; unresolved outcomes are not failures.'),
        possession_pct=GrfMetricDefinition(unit='percent',description='Native ownership exposure / eligible internal time; free ball remains a third category.'),
        team_possession_pct=GrfMetricDefinition(unit='percent',description='Team-possession-1: native control plus intentional pass flights, divided by attributable eligible internal time. Flights stop on control change, contact, shot, goal, restart or discontinuity, and expire after 10 internal seconds; unknown time is excluded. Legacy records without events are unavailable.'),
        team_length_m=GrfMetricDefinition(unit='m',description='Time-weighted span of ten active outfield positions on a synthetic 105×68 m projection.'),
        team_width_m=GrfMetricDefinition(unit='m',description='Time-weighted width of ten active outfield positions; discontinuities excluded.'))
    definitions['assists'].description='Confirmed pass received by the scorer within 10 internal seconds before the linked shot, without rival contact, another passer or restart; no own goals.'
    definitions['fouls'].description='Distinct native foul incidents admitted by the referee, including played advantage; later stages do not add another foul.'
    return GrfStatisticsSummary(trace_hash=record.trace_hash,replay_version=record.schema_version,
        home_name=record.input.home_name,away_name=record.input.away_name,score=record.samples[-1].score,
        full_time_ms=record.samples[-1].match_time_ms if modern else None,
        halftime_ms=record.samples[record.halftime_sample_index].match_time_ms if modern else None,
        players=record.input.players,definitions=definitions,by_team=action.by_team,by_player=action.by_player,
        goals=action.goals,shots=action.shots,passes=action.passes,pass_edges=action.pass_edges,
        positions=shape.positions,occupancy=shape.occupancy,team_shape=shape.team_shape,coverage=shape.coverage)
