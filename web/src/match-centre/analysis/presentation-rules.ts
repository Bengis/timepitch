// TP205 · Reglas puras de presentación del análisis grabado.
import type { MatchAnalysis } from './recorded-analysis';

/** La posesión se muestra «—» hasta el primer minuto: en el 0:00 solo hay milisegundos con dueño (100 % / 0 %). */
export const POSSESSION_MIN_MS = 60_000;

export function shownPossession(a: Pick<MatchAnalysis, 'untilMs' | 'possession'>): { home: number | null; away: number | null } {
  if (a.untilMs < POSSESSION_MIN_MS) return { home: null, away: null };
  return { home: a.possession.home, away: a.possession.away };
}

export type TimelineFilter = 'key' | 'chances' | 'all';

/** «Clave» si la grabación tiene goles; si no (p. ej. open-football 0-0), «Ocasiones», porque «Clave» solo tendría el descanso. */
export function defaultTimelineFilter(events: readonly { kind: string }[]): TimelineFilter {
  return events.some(e => e.kind === 'goal') ? 'key' : 'chances';
}
