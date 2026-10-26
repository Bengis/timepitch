// TP239 (jueces: «las pestañas de análisis parecen el Excel del programador»): estadísticas del partido simulado como
// en una retransmisión: una fila por dato, local a la izquierda, visitante a la derecha y barra comparada. Solo métricas
// de equipo con nombre en lenguaje llano y con valor en los dos equipos; el resto sigue en la tabla técnica plegada.
import type { EventView, MetricView } from './session';
import { defineTexts, definePairs, intlTag, isLocale } from '../i18n-catalog';
import { metricLabel } from '../match/statistics/messages';
import { useLanguage } from '../i18n';
import { usePlayerText } from './player-messages';
import { StatBar } from './analysis/RecordedAnalysisViews';

type Side = 'home' | 'away';
export type ComparisonTeam = Readonly<{ id: string; abbr: string; colour: string }>;
export type ComparisonRow = Readonly<{ id: string; label: string; home: number; away: number; unit: string }>;

/** Solo estadísticas de retransmisión, en su orden; las de analista (xGA, diferencias, «TP», progresivas, forma del
 *  equipo…) quedan en la tabla técnica. */
const ORDER = ['goals', 'possession_pct', 'possession', 'shots', 'shots_on_target', 'simulated_xg', 'xg', 'saves', 'passes', 'completed_passes', 'passes_completed', 'tackles', 'box_entries', 'corners', 'fouls'];

// TP249 («POSSESSION PCT», y en español salía «GOALS»): nombres de retransmisión en los dos idiomas; el resto,
// con el nombre del catálogo de métricas.
const LABELS = definePairs('broadcast-stats', {
  goals: ['Goals', 'Goles'], possession_pct: ['Possession', 'Posesión'], possession: ['Possession', 'Posesión'], shots: ['Shots', 'Tiros'],
  shots_on_target: ['Shots on target', 'Tiros a puerta'], simulated_xg: ['Expected goals (xG)', 'Goles esperados (xG)'], xg: ['Expected goals (xG)', 'Goles esperados (xG)'],
  saves: ['Saves', 'Paradas'], passes: ['Passes', 'Pases'], completed_passes: ['Completed passes', 'Pases completados'], passes_completed: ['Completed passes', 'Pases completados'],
  tackles: ['Tackles', 'Entradas'], box_entries: ['Box entries', 'Entradas al área'], corners: ['Corners', 'Córners'], fouls: ['Fouls', 'Faltas'],
});
const label = (id: string, locale: string) => (isLocale(locale) ? LABELS(locale, id) : undefined) ?? metricLabel(id, locale);
const POSSESSION = new Set(['possession_pct', 'possession']);
/** Unidad pegada al número: «%» en vez de «percent»; los recuentos, sin unidad. */
const unitText = (unit: string) => unit === 'percent' || unit === '%' ? '%' : !unit || ['count', 'goals', 'xG', 'xg'].includes(unit) ? '' : ` ${unit}`;

/**
 * TP249: la posesión que graba el motor no suma 100 (el balón suelto no es de nadie: 29,65 frente a 31,14). En la
 * retransmisión se da el reparto entre los dos equipos, en enteros que suman 100; la nota del panel lo explica.
 */
export function possessionShare(home: number, away: number): { home: number; away: number } | null {
  const total = Math.abs(home) + Math.abs(away);
  if (!total) return null;
  const h = Math.round(Math.abs(home) / total * 100);
  return { home: h, away: 100 - h };
}

/**
 * Recuentos de lo ya ocurrido para cuando el motor solo da las métricas al final: goles del marcador; tiros, tiros a
 * puerta y paradas de los eventos grabados hasta el cursor. Tiros a puerta solo si el motor graba el resultado del tiro.
 */
export function countedRows(events: readonly EventView[], score: Readonly<{ home: number; away: number }> | null, locale: string): ComparisonRow[] {
  const out: ComparisonRow[] = [], count = (pick: (e: EventView) => boolean) => ({ home: events.filter(e => e.side === 'home' && pick(e)).length, away: events.filter(e => e.side === 'away' && pick(e)).length });
  const row = (id: string, v: { home: number; away: number }) => out.push({ id, label: label(id, locale), home: v.home, away: v.away, unit: '' });
  if (score) row('goals', score);
  const shots = events.filter(e => e.kind === 'shot');
  if (shots.length) {
    row('shots', count(e => e.kind === 'shot'));
    if (shots.some(e => e.outcome)) row('shots_on_target', count(e => e.kind === 'shot' && (e.outcome === 'saved' || e.outcome === 'goal')));
  }
  if (events.some(e => e.kind === 'save')) row('saves', count(e => e.kind === 'save'));
  return out;
}

export function comparisonRows(metrics: readonly MetricView[], teams: Readonly<Record<Side, ComparisonTeam>>, locale: string, limit = 10, counted: readonly ComparisonRow[] = []): ComparisonRow[] {
  const sideOf = (id: string): Side | null => id === teams.home.id || id === 'home' ? 'home' : id === teams.away.id || id === 'away' ? 'away' : null;
  const pairs = new Map<string, Partial<Record<Side, MetricView>>>();
  for (const m of metrics) {
    if (m.subject?.kind !== 'team' || m.value === null || m.availability.status !== 'available') continue;
    const side = sideOf(m.subject.id); if (!side) continue;
    const key = `${m.id}|${m.definition}|${m.unit}`, pair = pairs.get(key) ?? {};
    if (!pair[side]) pair[side] = m;
    pairs.set(key, pair);
  }
  const rows: ComparisonRow[] = [];
  for (const pair of pairs.values()) {
    if (!pair.home || !pair.away || !ORDER.includes(pair.home.id)) continue;
    // Posesión con dos ids (possession_pct y possession): una sola fila.
    if (rows.some(r => r.id === pair.home!.id || POSSESSION.has(r.id) && POSSESSION.has(pair.home!.id))) continue;
    const share = POSSESSION.has(pair.home.id) ? possessionShare(pair.home.value!, pair.away.value!) : null;
    if (POSSESSION.has(pair.home.id) && !share) continue;
    rows.push({ id: pair.home.id, label: label(pair.home.id, locale), home: share?.home ?? pair.home.value!, away: share?.away ?? pair.away.value!,
      unit: share ? '%' : unitText(pair.home.unit) });
  }
  for (const extra of counted) if (!rows.some(r => r.id === extra.id)) rows.push(extra);
  const rank = (id: string) => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i; };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r.id) - rank(b.r.id) || a.i - b.i).slice(0, limit).map(x => x.r);
}

export function TeamComparison({ metrics, teams, events = [], score = null }: { metrics: readonly MetricView[]; teams: Readonly<Record<Side, ComparisonTeam>>;
  events?: readonly EventView[]; score?: Readonly<{ home: number; away: number }> | null }) {
  const t = usePlayerText(), { locale } = useLanguage();
  const rows = comparisonRows(metrics, teams, locale, 10, countedRows(events, score, locale));
  const n = (v: number, id: string) => new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: /xg/.test(id) ? 2 : 1 }).format(v);
  return <section className="tpa-panel tp-team-stats" aria-label={t.teamStats} data-team-comparison>
    <header className="tpa-panel-h"><h3>{t.teamStats}</h3></header>
    <div className="tpa-teams" aria-hidden="true"><b style={{ borderColor: teams.home.colour }}>{teams.home.abbr}</b><b style={{ borderColor: teams.away.colour }}>{teams.away.abbr}</b></div>
    {rows.length === 0 ? <p className="tpa-empty">{t.noStatsYet}</p> : <div className="tpa-stats">{rows.map(r => {
      // TP249: el que va por delante en el dato, en blanco; el otro, atenuado (como en la tele).
      const lead = Math.abs(r.home) === Math.abs(r.away) ? null : Math.abs(r.home) > Math.abs(r.away) ? 'home' : 'away';
      return <div className="tpa-sr" key={r.id} data-stat={r.id}>
        <span className={`tpa-v${lead === 'away' ? ' tpa-trail' : ''}`}>{n(r.home, r.id)}{r.unit}</span>
        <span className="tpa-l"><span className="tpa-lt">{r.label}</span>
          <StatBar home={r.home} away={r.away} homeColour={teams.home.colour} awayColour={teams.away.colour} /></span>
        <span className={`tpa-v${lead === 'home' ? ' tpa-trail' : ''}`}>{n(r.away, r.id)}{r.unit}</span>
      </div>;
    })}</div>}
    {rows.some(r => POSSESSION.has(r.id)) && <p className="tpa-note">{SHARE_NOTE(locale).note}</p>}
  </section>;
}

const SHARE_NOTE = defineTexts('team-comparison', { en: { note: 'Possession: share of the time either team had the ball (loose balls are left out, so the two add up to 100%).' }, es: { note: 'Posesión: reparto del tiempo en que algún equipo tenía el balón (sin contar el balón suelto, por eso suman 100 %).' } });
