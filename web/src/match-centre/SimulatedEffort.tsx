// TP249 («son cutres»): Esfuerzo de los partidos simulados como un panel de retransmisión. Antes salía la tabla
// técnica con buscador y filas «Unavailable» (GRF y TouchLines no miden carrera) y «No data at this cursor» dos veces.
// Ahora: comparación de equipos y tabla de jugadores con lo que el motor sí mida; si no mide nada, se dice en una frase.
// La tabla técnica sigue plegada al final.
import type { ReactNode } from 'react';
import { defineTexts, intlTag } from '../i18n-catalog';
import type { MetricView, PlayerView } from './session';
import { Panel, StatBar, type TimelineContext } from './analysis/RecordedAnalysisViews';
import { useLanguage } from '../i18n';

const TEXT = defineTexts('effort', {
  en: { title: 'Physical effort', none: (engine: string) => `${engine} does not measure running in this match (distance, speed or sprints), so there is nothing to compare. Goals, shots and the rest of the match stats are in Summary.`,
    technical: 'All effort data (technical)', player: 'Player', team: 'Team', note: 'Simulated running, ordered by distance.',
    labels: { distance_m: 'Distance', hsr_distance_m: 'High-speed running', sprint_distance_m: 'Sprint distance', sprint_count: 'Sprints', max_speed_kmh: 'Top speed', metres_per_minute: 'Metres per minute' } as Record<string, string> },
  es: { title: 'Esfuerzo físico', none: (engine: string) => `${engine} no mide la carrera en este partido (distancia, velocidad ni esprints), así que no hay nada que comparar. Los goles, tiros y demás estadísticas están en Resumen.`,
    technical: 'Todos los datos de esfuerzo (técnico)', player: 'Jugador', team: 'Equipo', note: 'Carrera simulada, ordenada por distancia.',
    labels: { distance_m: 'Distancia', hsr_distance_m: 'Carrera a alta velocidad', sprint_distance_m: 'Distancia en esprint', sprint_count: 'Esprints', max_speed_kmh: 'Velocidad máxima', metres_per_minute: 'Metros por minuto' } as Record<string, string> },
});
const ORDER = ['distance_m', 'hsr_distance_m', 'sprint_distance_m', 'sprint_count', 'max_speed_kmh', 'metres_per_minute'];
/** Distancias en km; velocidad en km/h; recuentos sin unidad. */
const shown = (id: string, v: number) => id.endsWith('_m') ? { v: v / 1000, unit: ' km', digits: 1 } : id === 'max_speed_kmh' ? { v, unit: ' km/h', digits: 1 } : { v, unit: '', digits: 0 };

export function SimulatedEffort({ metrics, players, ctx, technical }: { metrics: readonly MetricView[]; players: readonly PlayerView[]; ctx: TimelineContext; technical: ReactNode }) {
  const { locale } = useLanguage(), x = TEXT(locale), tag = intlTag(locale);
  const usable = metrics.filter(m => ORDER.includes(m.id) && m.value !== null && m.availability.status === 'available');
  const num = (id: string, value: number) => { const s = shown(id, value); return `${s.v.toLocaleString(tag, { maximumFractionDigits: s.digits })}${s.unit}`; };
  const team = (id: string, side: 'home' | 'away') => usable.find(m => m.id === id && m.subject?.kind === 'team' && m.subject.id === side)?.value ?? null;
  const teamRows = ORDER.filter(id => team(id, 'home') !== null && team(id, 'away') !== null);
  const sideOf = new Map(players.map(p => [p.id, p.side]));
  const columns = ORDER.filter(id => usable.some(m => m.id === id && m.subject?.kind === 'player'));
  const value = (player: string, id: string) => usable.find(m => m.id === id && m.subject?.kind === 'player' && m.subject.id === player)?.value ?? null;
  const rows = [...new Set(usable.filter(m => m.subject?.kind === 'player').map(m => m.subject!.id))].sort((a, b) => (value(b, columns[0]) ?? 0) - (value(a, columns[0]) ?? 0));
  return <div className="tpa-section" data-simulated-effort>
    <Panel title={x.title} engine={ctx.engineLabel} className="tpa-wide">
      {!teamRows.length && !rows.length && <p className="tpa-empty">{x.none(ctx.engineLabel)}</p>}
      {teamRows.length > 0 && <div className="tpa-stats">{teamRows.map(id => { const h = team(id, 'home')!, a = team(id, 'away')!;
        return <div className="tpa-sr" key={id} data-stat={id}><span className={`tpa-v${a > h ? ' tpa-trail' : ''}`}>{num(id, h)}</span>
          <span className="tpa-l"><span className="tpa-lt">{x.labels[id]}</span><StatBar home={h} away={a} homeColour={ctx.teams.home.colour} awayColour={ctx.teams.away.colour} /></span>
          <span className={`tpa-v${h > a ? ' tpa-trail' : ''}`}>{num(id, a)}</span></div>; })}</div>}
      {rows.length > 0 && <div className="tpa-table"><table><thead><tr><th scope="col">#</th><th scope="col">{x.player}</th><th scope="col">{x.team}</th>{columns.map(id => <th key={id} scope="col">{x.labels[id]}</th>)}</tr></thead>
        <tbody>{rows.map(id => { const who = ctx.player(id), side = sideOf.get(id);
          return <tr key={id} data-player={id}><td className="tpa-no-cell">{who?.number ?? '—'}</td>
            <td>{ctx.onPlayer ? <button type="button" className="tpa-link" onClick={() => ctx.onPlayer!(id)}>{who?.name ?? id}</button> : who?.name ?? id}</td>
            <td>{side && <><span className="tpa-team-dot" style={{ background: ctx.teams[side].colour }} />{ctx.teams[side].abbr}</>}</td>
            {columns.map(c => { const v = value(id, c); return <td key={c}>{v === null ? '—' : num(c, v)}</td>; })}</tr>; })}</tbody></table></div>}
      {rows.length > 0 && <p className="tpa-note">{x.note}</p>}
    </Panel>
    <details className="tpa-log tpa-wide"><summary>{x.technical}</summary>{technical}</details>
  </div>;
}
