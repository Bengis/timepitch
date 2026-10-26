"""Crew fallback report (crew-fallback-3): the same fixed selection as before, written as plain match prose.

The chronicle templates (``chronicles.render``) stay as they are for the older chronicle pipeline; this one only
reads better. Every number and name still comes straight from the fact pack, and the server rebuilds the text
byte for byte to check a published fallback.
"""
from ..chronicles.models import FactPack, Locale
from ..chronicles.render import validate_selection
from .agents import fallback_selection

STAT = {
    'en': {'goals': 'goals', 'pass_received': 'confirmed passes', 'recoveries': 'recoveries', 'shots': 'shots',
           'team_possession_pct': 'possession'},
    'es': {'goals': 'goles', 'pass_received': 'pases confirmados', 'recoveries': 'recuperaciones', 'shots': 'tiros',
           'team_possession_pct': 'posesión'},
}


def _and(names: list[str], es: bool) -> str:
    return names[0] if len(names) == 1 else ', '.join(names[:-1]) + (' y ' if es else ' and ') + names[-1]


def fact_sentence(pack: FactPack, f, locale: Locale) -> str:
    """One plain sentence for one recorded fact (not coverage): the fallback report and, since TP263, the facts-only
    answer to a question."""
    es = locale == 'es'
    home, away = pack.home_name, pack.away_name
    h, a = pack.score

    def number(value):
        text = f'{value:g}'
        return text.replace('.', ',') if es else text

    if f.kind == 'result':
        if pack.period == 'half_time':  # TP262
            return f'Al descanso: {home} {h}–{a} {away}.' if es else f'At half-time: {home} {h}–{a} {away}.'
        if h == a:
            return f'{home} y {away} empataron {h}–{a}.' if es else f'{home} and {away} drew {h}–{a}.'
        return f'El partido terminó {home} {h}–{a} {away}.' if es else f'The match finished {home} {h}–{a} {away}.'
    if f.kind == 'goal':
        actor = _and(list(f.player_names), es) if f.player_names else ('un jugador sin identificar' if es else 'an unidentified player')
        team = home if f.side == 'home' else away if f.side == 'away' else ('su equipo' if es else 'their side')
        clock = f'{(f.time_ms or 0) // 60000:02d}:{((f.time_ms or 0) // 1000) % 60:02d}'
        if f.own_goal:
            return f'{clock}: autogol de {actor} a favor de {team}.' if es else f'{clock}: an own goal by {actor} for {team}.'
        return f'{clock}: gol de {actor} para {team}.' if es else f'{clock}: {actor} scores for {team}.'
    if f.kind == 'actor_stat':
        label, value = STAT[locale][f.metric_id], number(f.value)
        names = _and(list(f.player_names), es)
        if len(f.player_ids) > 1:
            return f'{names} compartieron el máximo de {label}: {value} cada uno.' if es else f'{names} shared the most {label}, {value} each.'
        return f'{names} fue quien más {label} sumó: {value}.' if es else f'{names} had the most {label}: {value}.'
    if f.kind == 'team_compare':
        unit = ' %' if f.unit == 'percent' else ''
        label = STAT[locale][f.metric_id]
        label = label[0].upper() + label[1:]
        return f'{label}: {home} {number(f.value)}{unit}, {away} {number(f.comparison_value)}{unit}.'
    raise ValueError('Unsupported fact')


def crew_fallback_text(pack: FactPack, locale: Locale) -> str:
    selection = fallback_selection(pack)
    validate_selection(pack, selection)
    es = locale == 'es'
    home, away = pack.home_name, pack.away_name
    h, a = pack.score
    facts = {f.id: f for f in pack.facts}

    def sentence(f):
        if f.kind == 'coverage':
            return caveats() or ('Solo se recogen los hechos registrados de esta simulación.' if es else
                                 'Only the recorded facts of this simulation are included.')
        return fact_sentence(pack, f, locale)

    def caveats():
        out = []
        if not pack.coverage.events_complete:
            out.append('Faltan algunos eventos: un dato ausente no es un cero.' if es else 'Some events are missing: a missing figure is not a zero.')
        if pack.full_time_ms is None:
            out.append('Este partido no tiene reloj completo.' if es else 'This match has no full clock.')
        if pack.coverage.omitted_events:
            out.append('Solo se incluyen algunos goles.' if es else 'Only some goals are included.')
        return ' '.join(out)

    paragraphs = [' '.join(sentence(facts[i]) for i in part.fact_ids) for part in selection.paragraphs]
    used = {i for part in selection.paragraphs for i in part.fact_ids}
    if 'result' not in used:
        paragraphs.insert(0, sentence(facts['result']))
    if 'coverage' not in used and caveats():
        paragraphs[-1] += ' ' + caveats()
    return f'{home} {h}–{a} {away}' + '\n\n' + '\n\n'.join(paragraphs)
