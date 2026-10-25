from .models import ValidationResult
from .tools import project_statistics
from ..simulation.replay import frame_at
from ..simulation.metrics import metrics_until


def validate_analysis(analysis, record, window):
    errors = []
    if not 0<=window.end_ms<=5400000 or window.end_ms%250:return ValidationResult(accepted=False,errors=['invalid_window'])
    if analysis.window_id != window.id or analysis.revision != window.revision or window.revision!=record.trace_hash: errors.append('stale_revision')
    if analysis.score != window.score or window.score!=frame_at(record,window.end_ms).score: errors.append('false_score')
    refs = set(analysis.event_ids)
    if not refs <= set(window.event_ids): errors.append('unknown_event')
    events = [e for e in record.events if e.id in refs]
    if len(events)!=len(refs) or any(e.t1_ms>window.end_ms for e in events):errors.append('future_or_unknown_event')
    if analysis.category in ('chance_quality_edge','territory_edge','distance_leader'):
        actual=project_statistics(record,window.end_ms)
        supported=[f for f in actual.facts if f.category==analysis.category and f.metric_id==analysis.metric_id
                   and f.side==analysis.side and f.player_key==analysis.metric_player_key]
        if len(supported)!=1:errors.append('unsupported_metric')
        else:
            fact=supported[0]
            supplied=[f for f in (window.statistics.facts if window.statistics else []) if f.id==fact.id]
            if (window.statistics is None or window.statistics.end_ms!=window.end_ms
                    or len(supplied)!=1 or supplied[0]!=fact):errors.append('altered_metric_fact')
            if analysis.event_ids!=fact.event_ids or analysis.sample_ranges!=fact.sample_ranges:errors.append('false_metric_evidence')
            if analysis.player_keys!=([fact.player_key] if fact.player_key else []):errors.append('foreign_player')
        return ValidationResult(accepted=not errors,errors=errors)
    if not refs:errors.append('unknown_event')
    if analysis.metric_id is not None or analysis.metric_player_key is not None or analysis.sample_ranges:errors.append('unvalidated_metric')
    participants = {key for e in events for key in e.participants}
    if not set(analysis.player_keys) <= participants: errors.append('foreign_player')
    if analysis.category in ('goal', 'shot', 'pressure'):
        if analysis.side is None or not any(e.type == analysis.category and e.side == analysis.side for e in events):
            errors.append('unsupported_claim')
    elif analysis.category == 'possession_edge':
        side = analysis.side
        actual=metrics_until(record,window.end_ms)
        total = actual.home.possession_ms + actual.away.possession_ms
        if side is None or total <= 0 or getattr(actual, side).possession_ms / total < .55:
            errors.append('unsupported_claim')
    elif analysis.side is not None: errors.append('overview_has_no_side')
    return ValidationResult(accepted=not errors, errors=errors)


def validate_explanation(explanation, analysis, record, window):
    result = validate_analysis(analysis, record, window)
    for field in ('window_id','revision','category','side','event_ids','player_keys','score','metric_id','metric_player_key','sample_ranges'):
        if getattr(explanation, field) != getattr(analysis, field): result.errors.append('narration_changed_' + field)
    result.accepted = not result.errors
    return result
