"""Approved factual sentence families; the worker never supplies final prose."""
from .models import FactPack, ChronicleSelection, Locale

LABELS = {
    'en': {'goals':'goals', 'pass_received':'confirmed passes', 'recoveries':'recoveries', 'shots':'shots', 'team_possession_pct':'attributable team possession'},
    'es': {'goals':'goles', 'pass_received':'pases confirmados', 'recoveries':'recuperaciones', 'shots':'tiros', 'team_possession_pct':'posesión atribuible de equipo'},
}


def validate_selection(pack: FactPack, selection: ChronicleSelection) -> None:
    facts = {fact.id:fact for fact in pack.facts}
    if selection.headline.fact_ids != ['result']: raise ValueError('Headline requires result')
    used = {'result'}
    paragraphs_seen = set()
    for part in selection.paragraphs:
        if len(set(part.fact_ids)) != len(part.fact_ids) or any(id not in facts for id in part.fact_ids):
            raise ValueError('Unknown or duplicate fact')
        kinds = [facts[id].kind for id in part.fact_ids]
        if 'result' in kinds and (len(kinds) < 2 or any(k not in ('result','goal') for k in kinds)):
            raise ValueError('Result paragraph must be tied to recorded goals')
        if any(id in paragraphs_seen for id in part.fact_ids): raise ValueError('Repeated observation')
        for id in part.fact_ids:
            f = facts[id]
            if f.kind in ('actor_stat','team_compare'):
                if (f.metric_id not in LABELS['en'] or f.value is None or f.value < 0 or f.availability == 'unavailable' or
                    f.unit != ('percent' if f.metric_id == 'team_possession_pct' else 'count')):
                    raise ValueError('Unsupported statistical fact')
                if f.kind == 'actor_stat' and (not f.player_ids or f.value <= 0): raise ValueError('No attributable leader')
                if f.kind == 'team_compare' and (f.comparison_value is None or f.comparison_value < 0): raise ValueError('Incomplete comparison')
        paragraphs_seen.update(part.fact_ids); used.update(part.fact_ids)
    if len(used) > 4: raise ValueError('Too many observations')


def render_chronicle(pack: FactPack, selection: ChronicleSelection, locale: Locale) -> str:
    validate_selection(pack, selection)
    if locale not in LABELS: raise ValueError('Unsupported locale')
    es = locale == 'es'
    score = f'{pack.home_name} {pack.score[0]}–{pack.score[1]} {pack.away_name}'
    headline = score if selection.headline.variant == 0 else (('Resultado registrado: ' if es else 'Recorded result: ') + score)
    facts = {f.id:f for f in pack.facts}
    def number(value):
        text = f'{value:g}'
        return text.replace('.', ',') if es else text
    def sentence(f, variant):
        if f.kind == 'result': return ('El partido simulado terminó ' if es else 'The simulated match finished ') + score + '.'
        if f.kind == 'goal':
            actor = ', '.join(f.player_names) or ('autor sin resolver' if es else 'unresolved scorer')
            team = pack.home_name if f.side == 'home' else pack.away_name if f.side == 'away' else ('equipo sin resolver' if es else 'unresolved team')
            clock = f'{(f.time_ms or 0)//60000:02d}:{((f.time_ms or 0)//1000)%60:02d}'
            if f.own_goal: return f'{clock}: ' + (f'un autogol de {actor} benefició a {team}.' if es else f'an own goal by {actor} benefited {team}.')
            return (f'A los {clock}, {actor} figura como autor de un gol para {team}.' if variant == 0 else f'{team} registra un gol a los {clock}, con {actor} como autor.') if es else (
                f'At {clock}, {actor} is recorded as scoring for {team}.' if variant == 0 else f'{team} has a goal recorded at {clock}, attributed to {actor}.')
        if f.kind == 'actor_stat':
            names = ', '.join(f.player_names); label = LABELS[locale][f.metric_id]
            return (f'El máximo registrado de {label} fue {number(f.value)}, compartido por {names}.' if len(f.player_ids)>1 else f'{names} lideró el recuento registrado de {label}, con {number(f.value)}.') if es else (
                f'The recorded lead in {label}, {number(f.value)}, was shared by {names}.' if len(f.player_ids)>1 else f'{names} led the recorded {label} count with {number(f.value)}.')
        if f.kind == 'team_compare':
            unit = ' %' if f.unit == 'percent' else ''
            label = LABELS[locale][f.metric_id]
            return (f'En {label}, {pack.home_name} registró {number(f.value)}{unit} y {pack.away_name}, {number(f.comparison_value)}{unit}.' if es else
                f'For {label}, {pack.home_name} recorded {number(f.value)}{unit} and {pack.away_name} {number(f.comparison_value)}{unit}.')
        if f.kind == 'coverage':
            text = ('La crónica se limita a los hechos registrados de esta simulación.' if es else 'This chronicle is limited to the recorded facts of this simulation.')
            if not pack.coverage.events_complete: text += (' La cobertura de eventos es incompleta; los datos ausentes no equivalen a cero.' if es else ' Event coverage is incomplete; missing data is not zero.')
            if pack.full_time_ms is None: text += (' Este episodio antiguo no tiene reloj completo de partido.' if es else ' This older episode has no full match clock.')
            if pack.coverage.omitted_events: text += (' Solo se incluyen algunos eventos de gol.' if es else ' Only selected goal events are included.')
            return text
        raise ValueError('Unsupported fact')
    paragraphs = [' '.join(sentence(facts[id], part.variant) for id in part.fact_ids) for part in selection.paragraphs]
    # Coverage caveats are mandatory even if the model does not select their fact.
    if (not pack.coverage.events_complete or pack.full_time_ms is None or pack.coverage.omitted_events) and 'coverage' not in {id for p in selection.paragraphs for id in p.fact_ids}:
        paragraphs[-1] += ' ' + sentence(facts['coverage'], 0)
    return headline + '\n\n' + '\n\n'.join(paragraphs)
