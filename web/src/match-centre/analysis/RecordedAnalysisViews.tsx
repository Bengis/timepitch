// Vistas del análisis de partidos grabados (TP203), según la maqueta aprobada (.local/mockup/v1-2d.html): columna
// lateral con Resumen y Cronología, y secciones de análisis (dominio, tiros, mapas, esfuerzo). Todo es simulado:
// cada panel lleva el chip «Simulado · <motor>» y lo que el motor no graba sale «No grabado», nunca 0.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EventView, MatchSource } from '../session';
import { minuteLabel } from '../announcements/announcements';
import { HEAT_COLS, HEAT_ROWS, type MatchAnalysis, type PlayerAnalysis, type TeamAnalysis } from './recorded-analysis';
import { useAnalysisText, type AnalysisText } from './messages';
import { useLanguage } from '../../i18n';
import { shownPossession, type TimelineFilter as Filter } from './presentation-rules';
import { initialTimelineFilter, timelineKinds } from './timeline-rules';

/** Números con la coma o el punto decimal del idioma. */
function useNumber() {
  const { locale } = useLanguage(), tag = locale === 'es' ? 'es-ES' : 'en-GB';
  return (v: number, digits = 1) => v.toLocaleString(tag, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
import './analysis.css';

type Side = 'home' | 'away';
export type AnalysisContext = {
  analysis: MatchAnalysis; engineLabel: string; source: MatchSource;
  teams: Record<Side, { name: string; abbr: string; colour: string }>;
  /** Dorsal y nombre del reparto (MatchCast) o de la fuente; nunca el dorsal de otro jugador. */
  player: (id: string | null) => { number: string | null; name: string } | null;
  onPlayer?: (id: string) => void;
};
/** TP239: la cronología no necesita el análisis grabado; los partidos simulados la usan con sus propios eventos. */
export type TimelineContext = Omit<AnalysisContext, 'analysis'>;

export function SimChip({ engine }: { engine: string }) {
  const t = useAnalysisText();
  return <span className="chip sim" data-provenance="simulated">{t.simulated} · {engine}</span>;
}

export function Panel({ title, engine, children, className = '', extra }: { title: string; engine: string; children: ReactNode; className?: string; extra?: ReactNode }) {
  return <section className={`tpa-panel ${className}`} aria-label={title}>
    <header className="tpa-panel-h"><h3>{title}</h3><SimChip engine={engine} />{extra}</header>
    {children}
  </section>;
}

const pct = (v: number | null) => v === null ? null : Math.round(v * 100);
const fixed = (v: number | null, d = 1) => v === null ? null : Number(v.toFixed(d));

/** `missing`: estadística que el motor no graba; la fila sale con «—» y lo dice en lugar de la barra. */
type Row = { id: string; label: string; home: number | null; away: number | null; unit?: string; missing?: string };
function StatRows({ rows, ctx, compact = false }: { rows: readonly Row[]; ctx: AnalysisContext; compact?: boolean }) {
  const n = useNumber();
  return <div className={compact ? 'tpa-stats tpa-statsmini' : 'tpa-stats'}>{rows.map(r => {
    const total = (r.home ?? 0) + (r.away ?? 0);
    return <div className="tpa-sr" key={r.id} data-stat={r.id}>
      <span className="tpa-v">{r.home === null ? '—' : n(r.home)}{r.home !== null && r.unit}</span>
      <span className="tpa-l"><span className="tpa-lt">{r.label}</span>
        {r.missing ? <small className="tpa-missing">{r.missing}</small>
          : <span className="tpa-bar" aria-hidden="true">{total ? <><i style={{ flex: r.home ?? 0, background: ctx.teams.home.colour }} /><i style={{ flex: r.away ?? 0, background: ctx.teams.away.colour }} /></> : <i style={{ flex: 1 }} />}</span>}</span>
      <span className="tpa-v">{r.away === null ? '—' : n(r.away)}{r.away !== null && r.unit}</span>
    </div>;
  })}</div>;
}

/** Estadísticas que el motor no graba: se nombran aparte en vez de mostrar 0. */
function NotRecorded({ team, t, engine, wide = false }: { team: TeamAnalysis; t: AnalysisText; engine: string; wide?: boolean }) {
  const missing = [team.shotsOnTarget === null && t.onTarget, team.saves === null && t.saves, team.xg === null && t.xg, team.fouls === null && t.fouls,
    team.corners === null && t.corners, t.cards].filter(Boolean) as string[];
  return <p className="tpa-note" data-not-recorded>{t.notRecordedBy(engine)}: {missing.join(' · ')}{wide ? '.' : ''}</p>;
}

function summaryRows(a: MatchAnalysis, t: AnalysisText, full: boolean): Row[] {
  const h = a.teams.home, w = a.teams.away, possession = shownPossession(a), rows: Row[] = [
    { id: 'goals', label: t.goals, home: h.goals, away: w.goals },
    { id: 'possession', label: t.possession, home: pct(possession.home), away: pct(possession.away), unit: '%' },
    { id: 'shots', label: t.shots, home: h.shots, away: w.shots },
  ];
  if (h.shotsOnTarget !== null) rows.push({ id: 'on_target', label: t.onTarget, home: h.shotsOnTarget, away: w.shotsOnTarget });
  if (h.xg !== null) rows.push({ id: 'xg', label: t.xg, home: fixed(h.xg), away: fixed(w.xg) });
  if (h.saves !== null) rows.push({ id: 'saves', label: t.saves, home: h.saves, away: w.saves });
  if (full) rows.push({ id: 'passes', label: t.passes, home: h.passes, away: w.passes },
    { id: 'territory', label: t.territory, home: pct(a.territory.home), away: pct(a.territory.away), unit: '%' },
    { id: 'tilt', label: t.tilt, home: pct(a.fieldTilt.home), away: pct(a.fieldTilt.away), unit: '%' });
  if (h.fouls !== null) rows.push({ id: 'fouls', label: t.fouls, home: h.fouls, away: w.fouls });
  if (h.corners !== null) rows.push({ id: 'corners', label: t.corners, home: h.corners, away: w.corners });
  rows.push({ id: 'offsides', label: t.offsides, home: h.offsides, away: w.offsides });
  if (full) rows.push({ id: 'distance', label: `${t.distance} (${t.km})`, home: fixed(h.distanceM / 1000), away: fixed(w.distanceM / 1000) },
    { id: 'hsr', label: `${t.hsr} (${t.km})`, home: fixed(h.hsrM / 1000), away: fixed(w.hsrM / 1000) },
    { id: 'width_in', label: `${t.width} · ${t.withBall} (${t.m})`, home: fixed(h.shape.inPossession?.width ?? null, 0), away: fixed(w.shape.inPossession?.width ?? null, 0) },
    { id: 'width_out', label: `${t.width} · ${t.withoutBall} (${t.m})`, home: fixed(h.shape.outOfPossession?.width ?? null, 0), away: fixed(w.shape.outOfPossession?.width ?? null, 0) },
    { id: 'depth_in', label: `${t.depth} · ${t.withBall} (${t.m})`, home: fixed(h.shape.inPossession?.depth ?? null, 0), away: fixed(w.shape.inPossession?.depth ?? null, 0) },
    { id: 'depth_out', label: `${t.depth} · ${t.withoutBall} (${t.m})`, home: fixed(h.shape.outOfPossession?.depth ?? null, 0), away: fixed(w.shape.outOfPossession?.depth ?? null, 0) });
  return rows;
}

function TeamsHead({ ctx }: { ctx: AnalysisContext }) {
  return <div className="tpa-teams" aria-hidden="true"><b style={{ borderColor: ctx.teams.home.colour }}>{ctx.teams.home.abbr}</b><b style={{ borderColor: ctx.teams.away.colour }}>{ctx.teams.away.abbr}</b></div>;
}

/** Filas del Resumen compacto (maqueta v1-2d .statsmini): goles, posesión, tiros a puerta (o tiros, si el motor no
 *  distingue los que van a puerta) y tarjetas, que ningún motor grabado registra: «—», nunca 0. */
function miniRows(a: MatchAnalysis, t: AnalysisText, engine: string): Row[] {
  const h = a.teams.home, w = a.teams.away, possession = shownPossession(a);
  return [
    { id: 'goals', label: t.goals, home: h.goals, away: w.goals },
    { id: 'possession', label: t.possession, home: pct(possession.home), away: pct(possession.away), unit: '%' },
    h.shotsOnTarget !== null ? { id: 'on_target', label: t.onTarget, home: h.shotsOnTarget, away: w.shotsOnTarget } : { id: 'shots', label: t.shots, home: h.shots, away: w.shots },
    { id: 'cards', label: t.cards, home: h.cards, away: w.cards, missing: t.notRecordedBy(engine) },
  ];
}

/** TP247: estadísticas del descanso y del final, sobre el campo: las del Resumen más pases y distancia recorrida. */
export function BreakStats({ ctx }: { ctx: AnalysisContext }) {
  const t = useAnalysisText(), a = ctx.analysis, h = a.teams.home, w = a.teams.away;
  const rows = [...summaryRows(a, t, false), { id: 'passes', label: t.passes, home: h.passes, away: w.passes },
    { id: 'distance', label: `${t.distance} (${t.km})`, home: fixed(h.distanceM / 1000), away: fixed(w.distanceM / 1000) }];
  return <div className="tpa-break-stats"><TeamsHead ctx={ctx} /><StatRows rows={rows} ctx={ctx} compact />
    <NotRecorded team={h} t={t} engine={ctx.engineLabel} /></div>;
}

/** Resumen compacto de la columna lateral. */
export function SummaryMini({ ctx }: { ctx: AnalysisContext }) {
  const t = useAnalysisText(), a = ctx.analysis, onTarget = a.teams.home.shotsOnTarget !== null;
  return <Panel title={t.summary} engine={ctx.engineLabel} className="tpa-summary">
    <StatRows rows={miniRows(a, t, ctx.engineLabel)} ctx={ctx} compact />
    <div className="tpa-sm-foot">{onTarget && <p className="tpa-note">{t.onTargetNote}</p>}<NotRecorded team={a.teams.home} t={t} engine={ctx.engineLabel} /></div>
  </Panel>;
}

// ---------- Cronología ----------
/** Iconos de la maqueta v1-2d (ICON): gol, gol en propia, parada, tarjetas, cambio, descanso y final. */
export function EventIcon({ kind }: { kind: string }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{
    kind === 'goal' ? <><circle cx="12" cy="12" r="9.5" fill="#fff" stroke="#111" strokeWidth="1.2" /><path d="M12 7.2l3.3 2.4-1.3 3.9h-4l-1.3-3.9z" fill="#111" />
      <path d="M12 7.2V3M15.3 9.6l3.9-1.3M14 13.5l2.5 3.4M10 13.5l-2.5 3.4M8.7 9.6L4.8 8.3" stroke="#111" strokeWidth="1.1" /></>
    : kind === 'own_goal' ? <><circle cx="12" cy="12" r="9.5" fill="#ff5a6e" stroke="#111" strokeWidth="1.2" /><path d="M12 7.2l3.3 2.4-1.3 3.9h-4l-1.3-3.9z" fill="#111" /></>
    : kind === 'save' ? <path d="M7 13V6.5a1.5 1.5 0 013 0V11M10 11V4.5a1.5 1.5 0 013 0V11M13 11V5.5a1.5 1.5 0 013 0V12M16 12V8.5a1.5 1.5 0 013 0V14c0 4-3 7-7 7h-1c-2.5 0-4-1.2-5.4-3.2L3.4 14a1.6 1.6 0 012.6-1.8L7 13.6" {...s} />
    : kind === 'halftime' ? <><circle cx="12" cy="13" r="8" {...s} /><path d="M12 9v4l3 2M9 2h6" {...s} /></>
    : kind === 'fulltime' ? <path d="M4 21V4M4 4h12l-2 4 2 4H4" {...s} />
    : kind === 'shot' ? <><circle cx="12" cy="12" r="8" {...s} /><circle cx="12" cy="12" r="3.5" {...s} /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" {...s} /></>
    : kind === 'card_yellow' || kind === 'card_red' ? <rect x="6.5" y="3" width="11" height="16" rx="1.8" fill={kind === 'card_red' ? '#ff3348' : '#ffd21f'} transform="rotate(8 12 11)" />
    : kind === 'foul' ? <><path d="M4 12a5 5 0 0 1 5-5h9l2 3-6 1v1a5 5 0 1 1-10 0z" {...s} /><circle cx="9" cy="12" r="1.4" fill="currentColor" /></>
    : kind === 'offside' ? <><path d="M6 21V3" {...s} /><path d="M6 4h11l-2.5 4L17 12H6" {...s} fill="currentColor" fillOpacity=".25" /></>
    : kind === 'corner' ? <><path d="M5 21V4" {...s} /><path d="M5 4l9 3.5L5 11" {...s} fill="currentColor" fillOpacity=".25" /><path d="M5 21a8 8 0 0 1 8-8" {...s} /></>
    : kind === 'penalty' ? <><circle cx="12" cy="15" r="2" fill="currentColor" /><path d="M4 9h16M4 9V4M20 9V4" {...s} /></>
    : kind === 'substitution' ? <><path d="M8 20V6M4 10l4-4 4 4" {...s} strokeWidth={2.2} stroke="#3ee08f" /><path d="M16 4v14M12 14l4 4 4-4" {...s} strokeWidth={2.2} stroke="#ff5a6e" /></>
    : <><circle cx="12" cy="12" r="8.5" {...s} /><path d="M12 7v5l3 2" {...s} /></>
  }</svg>;
}

export function eventMinute(e: EventView, source: MatchSource) {
  if (e.kind === 'halftime') return minuteLabel(source, Math.max(1, e.period - 1), e.periodMs, true);
  return minuteLabel(source, e.period, e.periodMs, e.kind === 'fulltime');
}

export function TimelinePanel({ ctx, events, untilMs, onSeek }: { ctx: TimelineContext; events: readonly EventView[]; untilMs: number; onSeek: (ms: number) => void }) {
  // Sin elección del usuario, el filtro sigue a la grabación: «Clave» si hay hechos clave, si no «Ocasiones».
  const t = useAnalysisText(), [chosen, setFilter] = useState<Filter | null>(null);
  const fallback = useMemo(() => initialTimelineFilter(events), [events]), filter = chosen ?? fallback;
  const list = useRef<HTMLOListElement>(null);
  const shown = useMemo(() => { const kinds = timelineKinds(filter);
    return events.filter(e => e.elapsedMs !== null && e.elapsedMs <= untilMs && kinds.has(e.kind)); }, [events, untilMs, filter]);
  const current = shown.at(-1)?.id ?? null;
  useEffect(() => {
    const ul = list.current, li = ul?.querySelector<HTMLElement>('[data-current]');
    if (ul && li) ul.scrollTop = li.offsetTop - ul.clientHeight + li.clientHeight + 8;
  }, [current]);
  const filters: [Filter, string][] = [['key', t.filterKey], ['chances', t.filterChances], ['all', t.filterAll]];
  // Maqueta: cabecera con título y chip; el filtro va aparte, como control secundario.
  return <Panel title={t.timeline} engine={ctx.engineLabel} className="tpa-timeline">
    <div className="tpa-seg" role="group" aria-label={t.timelineFilter}>{filters.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {shown.length === 0 ? <p className="tpa-empty">{t.emptyTimeline}</p> :
      <ol className="tpa-tl" ref={list}>{shown.map(e => {
        const marker = e.kind === 'halftime' || e.kind === 'fulltime', own = e.kind === 'goal' && e.outcome === 'own_goal';
        // TP239: el descanso no lleva minuto (en TimePitch su evento abre la 2.ª parte y salía «1'»); ya dice «Descanso».
        const kindLabel = t.kinds[own ? 'own_goal' : e.kind] ?? e.kind, minute = e.kind === 'halftime' ? '' : eventMinute(e, ctx.source);
        const who = ctx.player(e.actorId), team = e.side ? ctx.teams[e.side] : null;
        const outcome = e.kind === 'shot' && e.outcome ? t.outcomes[e.outcome] : null;
        // Maqueta: nombre en negrita y «EQUIPO · detalle» debajo; sin jugador, el hecho en negrita y el equipo debajo.
        const detail = [team?.abbr, who ? kindLabel : null, outcome].filter(Boolean).join(' · ');
        return <li key={e.id} className={`${marker ? 'tpa-mark' : ''} ${e.kind === 'goal' ? 'tpa-goal' : ''}`} data-kind={e.kind} data-current={e.id === current ? '' : undefined}>
          <button type="button" onClick={() => onSeek(Math.max(0, e.elapsedMs! - (marker ? 0 : 3000)))} aria-label={t.seekTo(kindLabel, minute)}>
            {team && <span className="tpa-sidebar" style={{ background: team.colour }} />}
            <span className="tpa-tm">{minute}</span>
            <span className="tpa-ic"><EventIcon kind={own ? 'own_goal' : e.kind} /></span>
            <span className="tpa-tx"><b>{who ? <><span className="tpa-no">{who.number ?? '—'}</span>{who.name}</> : kindLabel}</b>
              {detail && <small>{detail}</small>}</span>
          </button>
          {who && e.actorId && ctx.onPlayer && <button type="button" className="tpa-who" aria-label={t.openPlayer(who.name)} title={t.openPlayer(who.name)} onClick={() => ctx.onPlayer!(e.actorId!)} />}</li>;
      })}</ol>}
  </Panel>;
}

// ---------- Campo ----------
export function PitchLines() {
  return <g className="tpa-lines" fill="none">
    <rect x="0" y="0" width="105" height="68" /><path d="M52.5 0V68" /><circle cx="52.5" cy="34" r="9.15" />
    <rect x="0" y="13.84" width="16.5" height="40.32" /><rect x="88.5" y="13.84" width="16.5" height="40.32" />
    <rect x="0" y="24.84" width="5.5" height="18.32" /><rect x="99.5" y="24.84" width="5.5" height="18.32" />
  </g>;
}
const Arrow = ({ label }: { label: string }) => <text x="100" y="66" className="tpa-dir" textAnchor="end">{label} →</text>;

function ShotMap({ ctx }: { ctx: AnalysisContext }) {
  const t = useAnalysisText(), a = ctx.analysis;
  // Local ataca a la derecha y visitante a la izquierda (se refleja), para no superponerlos.
  const shots = a.shots.map(s => s.side === 'home' ? s : { ...s, x: 105 - s.x, y: 68 - s.y });
  return <Panel title={t.shotMap} engine={ctx.engineLabel}>
    <svg className="tpa-pitch" viewBox="-2 -2 109 72" role="img" aria-label={`${t.shotMap}: ${a.shots.length}`}><PitchLines />
      <text x="2" y="4" className="tpa-dir">← {ctx.teams.away.abbr}</text><text x="103" y="4" className="tpa-dir" textAnchor="end">{ctx.teams.home.abbr} →</text>
      {shots.map(s => { const colour = ctx.teams[s.side].colour, r = s.xg !== null ? 0.9 + Math.sqrt(Math.max(0, s.xg)) * 2 : 1.1;
        return <circle key={s.id} cx={s.x} cy={s.y} r={r} fill={s.outcome === 'goal' ? colour : 'none'} stroke={colour} strokeWidth={s.outcome === 'off_target' ? .3 : .55}
          strokeDasharray={s.outcome === 'off_target' ? '0.6 0.5' : undefined} data-outcome={s.outcome ?? 'unknown'}>
          <title>{ctx.player(s.playerId)?.name ?? ctx.teams[s.side].abbr}{s.outcome ? ` · ${t.outcomes[s.outcome] ?? s.outcome}` : ''}{s.xg !== null ? ` · xG ${s.xg.toFixed(2)}` : ''}</title></circle>; })}
    </svg>
    {a.shots.length === 0 ? <p className="tpa-empty">{t.noShots}</p> : <p className="tpa-note">{t.shotMapNote}{a.capabilities.xg ? ' ⌀ = xG' : ''}</p>}
  </Panel>;
}

function Momentum({ ctx, goals }: { ctx: AnalysisContext; goals: readonly EventView[] }) {
  const t = useAnalysisText(), w = ctx.analysis.momentum, n = Math.max(1, w.length), col = 100 / n;
  const maxShots = Math.max(1, ...w.map(x => Math.max(x.shots.home, x.shots.away)));
  return <Panel title={t.momentum} engine={ctx.engineLabel}>
    <svg className="tpa-momentum" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label={t.momentum}>
      <line x1="0" x2="100" y1="22" y2="22" className="tpa-axis" /><line x1="0" x2="100" y1="4" y2="4" className="tpa-axis tpa-faint" /><line x1="0" x2="100" y1="40" y2="40" className="tpa-axis tpa-faint" />
      {w.map((x, i) => {
        const p = x.possessionHome, hgt = p === null ? 0 : Math.min(1, Math.abs(p - .5) / .25) * 18, up = p !== null && p >= .5;
        const g = goals.filter(e => e.elapsedMs! >= x.fromMs && e.elapsedMs! < x.toMs);
        return <g key={x.fromMs}><title>{x.label} · {t.possession} {pct(p) ?? '—'}% · {t.shots} {x.shots.home}–{x.shots.away}</title>
          <rect x={i * col + col * .12} width={col * .76} y={up ? 22 - hgt : 22} height={Math.max(.3, hgt)} fill={up ? ctx.teams.home.colour : ctx.teams.away.colour} opacity=".85" />
          {Array.from({ length: x.shots.home }, (_, k) => <circle key={`h${k}`} cx={i * col + col / 2} cy={2.2 + k * (Math.min(1.6, 6 / maxShots))} r=".55" className="tpa-dot" />)}
          {Array.from({ length: x.shots.away }, (_, k) => <circle key={`a${k}`} cx={i * col + col / 2} cy={41.8 - k * (Math.min(1.6, 6 / maxShots))} r=".55" className="tpa-dot" />)}
          {g.map(e => <circle key={e.id} cx={i * col + col / 2} cy={e.side === 'home' ? 12 : 32} r="1.3" className="tpa-goaldot"><title>{t.kinds.goal}</title></circle>)}
        </g>;
      })}
    </svg>
    <div className="tpa-ylabels" aria-hidden="true"><span style={{ color: ctx.teams.home.colour }}>↑ {ctx.teams.home.abbr}</span><span style={{ color: ctx.teams.away.colour }}>↓ {ctx.teams.away.abbr}</span></div>
    <div className="tpa-xlabels">{w.map((x, i) => <span key={x.fromMs} style={{ left: `${(i + .5) * col}%` }}>{i % 2 === 0 || n <= 10 ? x.label.split('–')[0] : ''}</span>)}</div>
    <p className="tpa-note">{t.momentumNote}</p>
  </Panel>;
}

export function AnalysisSummarySection({ ctx, events }: { ctx: AnalysisContext; events: readonly EventView[] }) {
  const t = useAnalysisText(), a = ctx.analysis;
  return <div className="tpa-section" data-analysis-summary>
    <Panel title={t.teamStats} engine={ctx.engineLabel}><TeamsHead ctx={ctx} /><StatRows rows={summaryRows(a, t, true)} ctx={ctx} />
      <p className="tpa-note">{t.possessionBasis[a.possession.basis]} {t.territoryNote}</p><NotRecorded team={a.teams.home} t={t} engine={ctx.engineLabel} wide /></Panel>
    <div className="tpa-col"><Momentum ctx={ctx} goals={events.filter(e => e.kind === 'goal' && e.elapsedMs !== null && e.elapsedMs <= a.untilMs)} /><ShotMap ctx={ctx} /></div>
  </div>;
}

// ---------- Mapas ----------
function TeamShape({ ctx, side }: { ctx: AnalysisContext; side: Side }) {
  const t = useAnalysisText(), a = ctx.analysis, team = ctx.teams[side], net = a.passNetwork?.[side];
  const players = a.players.filter(p => p.side === side && p.average);
  const at = new Map(players.map(p => [p.id, p.average!]));
  const maxEdge = Math.max(1, ...(net?.edges.map(e => e.count) ?? [1]));
  const shape = a.teams[side].shape.all;
  return <figure className="tpa-shape" data-side={side}>
    <figcaption><b style={{ color: team.colour }}>{team.name}</b>{shape && <small> · {t.width} {Math.round(shape.width)} {t.m} · {t.depth} {Math.round(shape.depth)} {t.m}</small>}</figcaption>
    <svg className="tpa-pitch" viewBox="-2 -2 109 72" role="img" aria-label={`${t.averagePositions} · ${team.name}`}><PitchLines /><Arrow label={team.abbr} />
      {net?.edges.filter(e => e.count >= 2).map(e => { const p = at.get(e.from), q = at.get(e.to); return p && q &&
        <line key={`${e.from}>${e.to}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={team.colour} strokeOpacity=".55" strokeWidth={.25 + 1.6 * e.count / maxEdge} strokeLinecap="round"><title>{e.count}</title></line>; })}
      {players.map(p => { const who = ctx.player(p.id); return <g key={p.id} className="tpa-node" onClick={() => ctx.onPlayer?.(p.id)}>
        <circle cx={p.average!.x} cy={p.average!.y} r="2.6" fill={team.colour} stroke="#fff" strokeWidth=".35" />
        <text x={p.average!.x} y={p.average!.y + .95} textAnchor="middle" className="tpa-num">{who?.number ?? ''}</text>
        <title>{who?.name ?? p.name} · {t.passes} {p.passes}</title></g>; })}
    </svg>
  </figure>;
}

function HeatMap({ ctx, initial }: { ctx: AnalysisContext; initial: string | null }) {
  const t = useAnalysisText(), a = ctx.analysis;
  const options = a.players.filter(p => p.seconds > 0);
  const fallback = [...options].sort((x, y) => y.distanceM - x.distanceM)[0]?.id ?? '';
  // Elección del usuario; si no hay, el jugador seleccionado en el campo y, si no, el que más ha corrido hasta aquí.
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => { if (initial) setChosen(null); }, [initial]);
  const p = [chosen, initial, fallback].map(id => options.find(x => x.id === id)).find(Boolean) ?? options[0];
  const max = Math.max(1, ...(p?.heat ?? [1])), colour = p ? ctx.teams[p.side].colour : '#fff';
  const cw = 105 / HEAT_COLS, ch = 68 / HEAT_ROWS;
  return <Panel title={t.heatMap} engine={ctx.engineLabel}
    extra={<label className="tpa-select">{t.player}<select value={p?.id ?? ''} onChange={e => setChosen(e.target.value)}>
      {(['home', 'away'] as const).map(side => <optgroup key={side} label={ctx.teams[side].name}>{options.filter(x => x.side === side).map(x => { const who = ctx.player(x.id);
        return <option key={x.id} value={x.id}>{who?.number ? `${who.number} ` : ''}{who?.name ?? x.name}</option>; })}</optgroup>)}</select></label>}>
    <svg className="tpa-pitch" viewBox="-2 -2 109 72" role="img" aria-label={`${t.heatMap} · ${p ? ctx.player(p.id)?.name ?? p.name : ''}`}>
      {p?.heat.map((v, k) => v > 0 && <rect key={k} x={(k % HEAT_COLS) * cw} y={Math.floor(k / HEAT_COLS) * ch} width={cw} height={ch} fill={colour} opacity={.08 + .8 * v / max}><title>{v} s</title></rect>)}
      <PitchLines /><Arrow label={p ? ctx.teams[p.side].abbr : ''} />
    </svg>
    <p className="tpa-note">{t.heatNote}</p>
  </Panel>;
}

export function AnalysisMapsSection({ ctx, selected }: { ctx: AnalysisContext; selected: string | null }) {
  const t = useAnalysisText(), a = ctx.analysis;
  return <div className="tpa-section" data-analysis-maps>
    <Panel title={a.passNetwork ? `${t.averagePositions} · ${t.passNetwork}` : t.averagePositions} engine={ctx.engineLabel} className="tpa-wide">
      <div className="tpa-shapes"><TeamShape ctx={ctx} side="home" /><TeamShape ctx={ctx} side="away" /></div>
      <p className="tpa-note">{a.passNetwork ? t.passNetworkNote : t.noPassNetwork(ctx.engineLabel)}</p>
    </Panel>
    <HeatMap ctx={ctx} initial={selected} />
    <ShotMap ctx={ctx} />
  </div>;
}

// ---------- Esfuerzo ----------
export function AnalysisEffortSection({ ctx }: { ctx: AnalysisContext }) {
  const t = useAnalysisText(), a = ctx.analysis, n = useNumber();
  const rows = [...a.players].filter(p => p.seconds > 0).sort((x, y) => y.distanceM - x.distanceM);
  const name = (p: PlayerAnalysis) => ctx.player(p.id) ?? { number: null, name: p.name };
  return <div className="tpa-section" data-analysis-effort>
    <Panel title={t.effort} engine={ctx.engineLabel} className="tpa-wide">
      <div className="tpa-table"><table><thead><tr><th scope="col">#</th><th scope="col">{t.player}</th><th scope="col">{t.team}</th><th scope="col">{t.minutes}</th>
        <th scope="col">{t.distance} ({t.km})</th><th scope="col">{t.hsr} ({t.m})</th><th scope="col">{t.passes}</th><th scope="col">{t.shots}</th><th scope="col">{t.goals}</th>{a.capabilities.xg && <th scope="col">{t.xg}</th>}</tr></thead>
        <tbody>{rows.map(p => { const who = name(p); return <tr key={p.id} data-player={p.id}>
          <td className="tpa-no-cell">{who.number ?? '—'}</td>
          <td>{ctx.onPlayer ? <button type="button" className="tpa-link" onClick={() => ctx.onPlayer!(p.id)}>{who.name}</button> : who.name}</td>
          <td><span className="tpa-team-dot" style={{ background: ctx.teams[p.side].colour }} />{ctx.teams[p.side].abbr}</td>
          <td>{Math.round(p.seconds / 60)}</td><td>{n(p.distanceM / 1000, 2)}</td><td>{Math.round(p.hsrM)}</td>
          <td>{p.passes}</td><td>{p.shots}</td><td>{p.goals}</td>{a.capabilities.xg && <td>{n(p.xg ?? 0, 2)}</td>}</tr>; })}</tbody></table></div>
      <p className="tpa-note">{t.effortNote}</p>
    </Panel>
  </div>;
}
