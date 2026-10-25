// Cronología de la columna lateral según la maqueta v1-2d: por defecto solo hechos clave (goles, tarjetas, cambios,
// paradas, penaltis) con las marcas de descanso y final; «Ocasiones» añade los tiros y «Todo», faltas, córners y fueras de juego.
import type { TimelineFilter } from './presentation-rules';

const KEY_FACTS: ReadonlySet<string> = new Set(['goal', 'penalty', 'card_yellow', 'card_red', 'substitution', 'save']);
const PERIOD_MARKERS = ['halftime', 'fulltime'];
const KINDS: Record<TimelineFilter, ReadonlySet<string>> = {
  key: new Set([...KEY_FACTS, ...PERIOD_MARKERS]),
  chances: new Set([...KEY_FACTS, ...PERIOD_MARKERS, 'shot']),
  all: new Set([...KEY_FACTS, ...PERIOD_MARKERS, 'shot', 'foul', 'offside', 'corner']),
};

export const isKeyFact = (kind: string) => KEY_FACTS.has(kind);
export const timelineKinds = (filter: TimelineFilter) => KINDS[filter];

/** «Clave» si hay algún hecho clave; si no, «Ocasiones», porque «Clave» solo tendría el descanso y el final. */
export function initialTimelineFilter(events: readonly { kind: string }[]): TimelineFilter {
  return events.some(e => isKeyFact(e.kind)) ? 'key' : 'chances';
}
