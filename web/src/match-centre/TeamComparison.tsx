// TP239 (jueces: «las pestañas de análisis parecen el Excel del programador»): estadísticas del partido simulado como
// en una retransmisión: una fila por dato, local a la izquierda, visitante a la derecha y barra comparada. Solo métricas
// de equipo con nombre en lenguaje llano y con valor en los dos equipos; el resto sigue en la tabla técnica plegada.
import type { EventView, MetricView } from './session';
import { metricLabel } from '../match/statistics/messages';
import { useLanguage } from '../i18n';
import { usePlayerText } from './player-messages';

type Side = 'home' | 'away';
export type ComparisonTeam = Readonly<{ id: string; abbr: string; colour: string }>;
export type ComparisonRow = Readonly<{ id: string; label: string; home: number; away: number; unit: string }>;

/** Solo estadísticas de retransmisión, en su orden; las de analista (xGA, diferencias, «TP», progresivas, forma del
 *  equipo…) quedan en la tabla técnica. */
const ORDER = ['goals', 'possession_pct', 'possession', 'shots', 'shots_on_target', 'simulated_xg', 'xg', 'saves', 'passes', 'completed_passes', 'passes_completed', 'tackles', 'box_entries', 'corners', 'fouls'];

/**
 * Recuentos de lo ya ocurrido para cuando el motor solo da las métricas al final: goles del marcador; tiros, tiros a
 * puerta y paradas de los eventos grabados hasta el cursor. Tiros a puerta solo si el motor graba el resultado del tiro.
 */
export function countedRows(events: readonly EventView[], score: Readonly<{ home: number; away: number }> | null, locale: string): ComparisonRow[] {
  const out: ComparisonRow[] = [], count = (pick: (e: EventView) => boolean) => ({ home: events.filter(e => e.side === 'home' && pick(e)).length, away: events.filter(e => e.side === 'away' && pick(e)).length });
  const row = (id: string, v: { home: number; away: number }) => out.push({ id, label: metricLabel(id, locale), home: v.home, away: v.away, unit: '' });
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
    const label = metricLabel(pair.home.id, locale);
    if (rows.some(r => r.id === pair.home!.id)) continue;
    rows.push({ id: pair.home.id, label, home: pair.home.value!, away: pair.away.value!, unit: pair.home.unit === 'count' ? '' : pair.home.unit });
  }
  for (const extra of counted) if (!rows.some(r => r.id === extra.id)) rows.push(extra);
  const rank = (id: string) => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i; };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r.id) - rank(b.r.id) || a.i - b.i).slice(0, limit).map(x => x.r);
}

export function TeamComparison({ metrics, teams, events = [], score = null }: { metrics: readonly MetricView[]; teams: Readonly<Record<Side, ComparisonTeam>>;
  events?: readonly EventView[]; score?: Readonly<{ home: number; away: number }> | null }) {
  const t = usePlayerText(), { locale } = useLanguage();
  const rows = comparisonRows(metrics, teams, locale, 10, countedRows(events, score, locale));
  const n = (v: number) => new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 2 }).format(v);
  return <section className="tpa-panel tp-team-stats" aria-label={t.teamStats} data-team-comparison>
    <header className="tpa-panel-h"><h3>{t.teamStats}</h3></header>
    <div className="tpa-teams" aria-hidden="true"><b style={{ borderColor: teams.home.colour }}>{teams.home.abbr}</b><b style={{ borderColor: teams.away.colour }}>{teams.away.abbr}</b></div>
    {rows.length === 0 ? <p className="tpa-empty">{t.noStatsYet}</p> : <div className="tpa-stats">{rows.map(r => {
      const total = Math.abs(r.home) + Math.abs(r.away);
      return <div className="tpa-sr" key={r.id} data-stat={r.id}>
        <span className="tpa-v">{n(r.home)}{r.unit && ` ${r.unit}`}</span>
        <span className="tpa-l"><span className="tpa-lt">{r.label}</span>
          <span className="tpa-bar" aria-hidden="true">{total ? <><i style={{ flex: Math.abs(r.home), background: teams.home.colour }} /><i style={{ flex: Math.abs(r.away), background: teams.away.colour }} /></> : <i style={{ flex: 1 }} />}</span></span>
        <span className="tpa-v">{n(r.away)}{r.unit && ` ${r.unit}`}</span>
      </div>;
    })}</div>}
  </section>;
}
