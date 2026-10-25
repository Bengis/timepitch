"""Public metric definitions; TP variants do not claim provider equivalence."""
from ..simulation.replay_models import MetricDefinition, MetricValue

EVENT_METRICS = {
    'simulated_xg': ('xG', 'team/player', 'sum'),
    'simulated_xga': ('xG', 'team', 'sum'),
    'simulated_xgd': ('xG', 'team', 'difference'),
    'simulated_xg_per_shot': ('xG/shot', 'team/player', 'shots'),
    'goals_minus_xg': ('goals', 'team/player', 'difference'),
    'key_passes': ('count', 'team/player', 'sum'),
    'xg_assisted': ('xG', 'team/player', 'sum'),
    'progressive_passes_attempted': ('count', 'team/player', 'sum'),
    'progressive_passes_completed': ('count', 'team/player', 'sum'),
    'progressive_carries_attempted': ('count', 'team/player', 'sum'),
    'progressive_carries_completed': ('count', 'team/player', 'sum'),
    'final_third_entries': ('count', 'team/player', 'sum'),
    'box_entries': ('count', 'team/player', 'sum'),
    'field_tilt_tp': ('%', 'team', 'eligible_passes_both_sides'),
    'high_recoveries': ('count', 'team/player', 'sum'),
    'own_half_losses': ('count', 'team/player', 'sum'),
    'own_third_losses': ('count', 'team/player', 'sum'),
    'recovery_time_s': ('s', 'team', 'completed_episodes'),
    'recovery_episodes_completed': ('count', 'team', 'sum'),
    'recovery_episodes_open': ('count', 'team', 'sum'),
    'counterpress_recoveries_tp': ('count', 'team', 'sum'),
    'pressure_attempts': ('count', 'team/player', 'sum'),
    'pressure_linked_recoveries': ('count', 'team/player', 'sum'),
    'passes_per_intervention_tp': ('passes/intervention', 'team', 'unique_interventions'),
    'sequence_duration_s': ('s', 'team', 'sequences'),
    'passes_per_sequence': ('passes/sequence', 'team', 'sequences'),
    'sequence_progress_m': ('m', 'team', 'sequences'),
    'sequence_direct_speed_m_s': ('m/s', 'team', 'positive_duration_sequences'),
}

PHYSICAL_METRICS = {
    'distance_m':'m', 'distance_km_per90':'km/90', 'metres_per_minute':'m/min',
    'hsr_distance_m':'m', 'sprint_distance_m':'m', 'sprint_count':'count',
    'sprint_duration_s':'s', 'max_speed_kmh':'km/h', 'high_acceleration_count':'count',
    'high_deceleration_count':'count',
}
SHAPE_METRICS = ('defensive_line_height_m','def_mid_gap_m','mid_fwd_gap_m','team_length_m','team_width_m')


def definitions():
    result = {}
    for id, (unit, scope, denominator) in EVENT_METRICS.items():
        parameters = {'scope': scope, 'denominator': denominator, 'zero_denominator': 'unavailable',
                      'variant': 'timepitch_events'}
        if id.startswith('simulated_xg') or id in ('goals_minus_xg', 'xg_assisted'):
            parameters['variant'] = 'generative_probability_tp'
        if id in ('key_passes', 'xg_assisted'):
            parameters.update(max_delay_ms=5000, max_carry_m=5, same_sequence=True, first_shot_only=True)
        if id.startswith('progressive_'):
            parameters.update(own_half_m=30, crossing_m=15, opponent_half_m=10, distance='euclidean_to_goal')
        if id == 'field_tilt_tp': parameters.update(third_x_m=70, both_endpoints=True)
        if id == 'passes_per_intervention_tp':
            parameters.update(opponent_zone_x_max_m=63, both_pass_endpoints=True,
                              interventions='won_tackles_and_interceptions_only')
        if id == 'counterpress_recoveries_tp': parameters.update(strict_under_ms=5000, exclude_resets=True)
        if id.startswith('sequence_') or id == 'passes_per_sequence':
            parameters.update(shot_endpoint='release', passes='completed', include_open=True,
                              open_endpoint='last_resolved_action')
        result[id] = MetricDefinition(id=id, version='events-1', unit=unit,
            label_key='metrics.'+id, parameters=parameters)
    for id,unit in PHYSICAL_METRICS.items():
        result[id] = MetricDefinition(id=id,version='motion-1',unit=unit,label_key='metrics.'+id,
            parameters={'scope':'team/player','variant':'canonical_simulated_motion', 'reset_excluded':True,
                'hsr_min_kmh':20,'hsr_max_kmh':25,'sprint_strict_above_kmh':25,
                'episode_min_ms':1000,'acceleration_strict_m_s2':3,'filter':'none_causal_speed_magnitude',
                'threshold_distance_includes_short_bursts':True})
    for id in SHAPE_METRICS:
        for phase in ('all','in_possession','out_of_possession'):
            key=id if phase=='all' else id+'_'+phase
            result[key]=MetricDefinition(id=key,version='shape-1',unit='m',label_key='metrics.'+key,
                parameters={'scope':'team','variant':'role_geometry_tp','phase':phase,
                    'exclude_keeper':True,'time_weighting':'left_live_sample','exclude_reset_intervals':True})
    for zone in ('own','middle','opponent'):
        key='possession_'+zone+'_third_pct'
        result[key]=MetricDefinition(id=key,version='shape-1',unit='%',label_key='metrics.'+key,
            parameters={'scope':'team','denominator':'valid_possession_seconds','zone':zone,'third_length_m':35})
    return result


def metric_value(definition, value, *, denominator=None, reason=None, source='timepitch:events',
                 event_ids=(), sample_ranges=(), covered_minutes=None):
    if denominator == 0:
        value, reason = None, reason or 'zero_denominator'
    return MetricValue(value=round(value, 10) if value is not None else None, unit=definition.unit,
        origin='simulated', status='unavailable' if value is None else 'available', reason=reason,
        source=source, definition_version=definition.version, denominator=denominator,
        covered_minutes=covered_minutes, event_ids=list(dict.fromkeys(event_ids)), sample_ranges=list(sample_ranges))
