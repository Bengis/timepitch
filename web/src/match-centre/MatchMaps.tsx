import { useState, type ReactNode } from 'react';
import type { PlotView, TableCell } from './session';
import { usePlayerText } from './player-messages';
import { PitchLines, SimChip, StatBar, type TimelineContext } from './analysis/RecordedAnalysisViews';
import { useLanguage } from '../i18n';

type Side = 'home' | 'away';
/** TP249: equipos (nombre, siglas y color) y jugadores para dibujar los mapas de los simulados como los de la demo. */
type MapsContext = Pick<TimelineContext, 'teams' | 'player' | 'engineLabel' | 'onPlayer'>;
const MAP_TEXT = {
  en: { half: (n: string) => n === '1' ? '1st half' : n === '2' ? '2nd half' : n, shots: (n: number) => `${n} shot${n === 1 ? '' : 's'}`, goals: (n: number) => `${n} goal${n === 1 ? '' : 's'}`,
    goalKey: 'Filled: goal', shotKey: 'Ring: other shot', shotNote: 'Each team attacks towards the side of its name. Dot: where the shot was taken.',
    length: 'Team length', width: 'Team width', positionsNote: 'Dots: average position of each player in that half. Lines: passes between them (thicker, more passes).',
    heatNote: 'Stronger squares: where the team spent more time.', team: 'Team', halfGroup: 'Half' },
  es: { half: (n: string) => n === '1' ? '1.ª parte' : n === '2' ? '2.ª parte' : n, shots: (n: number) => `${n} tiro${n === 1 ? '' : 's'}`, goals: (n: number) => `${n} gol${n === 1 ? '' : 'es'}`,
    goalKey: 'Relleno: gol', shotKey: 'Aro: otro tiro', shotNote: 'Cada equipo ataca hacia el lado de su nombre. Punto: dónde se tiró.',
    length: 'Longitud del equipo', width: 'Anchura del equipo', positionsNote: 'Puntos: posición media de cada jugador en esa parte. Líneas: pases entre ellos (más gruesa, más pases).',
    heatNote: 'Cuadros más intensos: donde más tiempo estuvo el equipo.', team: 'Equipo', halfGroup: 'Parte' },
};
const sideOf = (scope?: Readonly<Record<string, TableCell>>): Side | null => scope?.side === 'home' || scope?.side === 'away' ? scope.side : null;

export function MatchRecordTable({ columns, rows, title, onSeek }: { columns: readonly string[]; rows: readonly Readonly<Record<string, TableCell>>[]; title: string; onSeek?: (ms: number) => void }) {
  const t = usePlayerText(); const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(rows.length / 50) - 1), current = Math.min(page, last);
  return <><div className="unified-table"><table><caption>{title}</caption><thead><tr>{columns.map(c => <th key={c} scope="col">{c}</th>)}{onSeek && <th>{t.watch}</th>}</tr></thead><tbody>{rows.slice(current * 50, current * 50 + 50).map((row, i) => {
    // Source clock and period-local time are not elapsed replay positions.
    const time = row.elapsedMs ?? row.elapsed_ms ?? row.playback_ms ?? row.t1_ms;
    return <tr key={current * 50 + i}>{columns.map(c => <td key={c}>{row[c] == null ? '—' : String(row[c])}</td>)}{onSeek && <td><button disabled={typeof time !== 'number' || !Number.isFinite(time) || time < 0} onClick={() => { if (typeof time === 'number' && Number.isFinite(time) && time >= 0) onSeek(time); }}>{t.watch}</button></td>}</tr>;
  })}</tbody></table></div>{rows.length > 50 && <div className="unified-pagination"><button disabled={!current} onClick={() => setPage(current - 1)}>{t.previous}</button><span>{t.page} {current + 1}/{last + 1} · {rows.length} {t.records}</span><button disabled={current >= last} onClick={() => setPage(current + 1)}>{t.next}</button></div>}</>;
}

function PlotGraphic({ plot, lines = false }: { plot: PlotView; lines?: boolean }) {
  const edges = plot.edges ?? [], nodes = [...new Set(edges.flatMap(e => [e.from, e.to]))];
  const supplied = (plot.points ?? []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  // Native mean positions, if supplied, are authoritative. A missing endpoint
  // suppresses that link; only a wholly schematic network receives layout nodes.
  const schematic=plot.nodeLayout==='schematic'||(!plot.nodeLayout&&!supplied.length);
  const positions = !schematic ? new Map(supplied.map(p => [p.id, p])) : new Map(nodes.map((id, i) => [id, { x: 52.5 + 27 * Math.cos(i / nodes.length * Math.PI * 2), y: 34 + 25 * Math.sin(i / nodes.length * Math.PI * 2) }]));
  const series = plot.series ?? [], maxTime = Math.max(1, ...series.flatMap(s => s.values.map(v => v.elapsedMs))), maxValue = Math.max(1, ...series.flatMap(s => s.values.map(v => Math.abs(v.value ?? 0))));
  const hasGraphic = !!(plot.points?.length || edges.length || plot.cells?.length || series.length);
  if (!hasGraphic || edges.length > 0 && new Set(supplied.map(p => p.id)).size !== supplied.length) return null;
  return <svg className="unified-map" viewBox="0 0 105 68" role="img" aria-label={`${plot.id} · ${plot.coordinateMeaning}`}><rect x="0" y="0" width="105" height="68" fill="none" stroke="currentColor" strokeWidth=".3" />
    {/* TP239: líneas del campo (área, centro) para que el mapa se lea como un campo y no como un recuadro vacío. */}
    {lines && !series.length && <g opacity=".45"><PitchLines /></g>}
    {(plot.cells ?? []).map((c, i) => <rect key={i} x={c.x} y={c.y} width={c.width} height={c.height} fill="currentColor" opacity={c.value === null ? 0 : Math.min(.8, .1 + Math.log1p(Math.max(0, c.value)) / 8)}><title>{c.value ?? '—'}</title></rect>)}
    {edges.map((e, i) => { const a = positions.get(e.from), b = positions.get(e.to); return a && b && <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={Math.min(1.5, .2 + (e.value ?? 0) * .05)}><title>{e.from} → {e.to}: {e.value ?? '—'}</title></line>; })}
    {schematic && nodes.map(id => { const p = positions.get(id)!; return <g key={id}><circle cx={p.x} cy={p.y} r="1.5" fill="currentColor"><title>{id}</title></circle></g>; })}
    {supplied.map((p, i) => <circle key={`${p.id}/${i}`} cx={p.x} cy={p.y} r=".9" fill="currentColor"><title>{p.id} · {p.value ?? '—'} · {p.refs.join(', ')}</title></circle>)}
    {series.map(s => <g key={s.id}>{s.values.map((v, i) => {
      const old = s.values[i - 1];
      // Gaps remain gaps; never connect across null observations.
      return old && old.value !== null && v.value !== null ? <path key={i} d={`M${old.elapsedMs / maxTime * 105},${65 - old.value / maxValue * 60} H${v.elapsedMs / maxTime * 105} V${65 - v.value / maxValue * 60}`} stroke="currentColor" fill="none" strokeWidth=".6"><title>{s.id} · {v.elapsedMs} ms · {v.value}</title></path> : null;
    })}</g>)}
  </svg>;
}

function MatchPlot({ plot, onSeek, simple = false, ctx }: { plot: PlotView; onSeek: (ms: number) => void; simple?: boolean; ctx?: MapsContext }) {
  const { locale } = useLanguage(), x = MAP_TEXT[locale === 'es' ? 'es' : 'en'];
  // TP249: en los simulados, posiciones, red de pases y forma del equipo se ven por partes (los equipos cambian de campo).
  const phased = simple && ['occupancy', 'average_positions', 'pass_network', 'team_shape'].includes(plot.kind) && plot.rows.some(r => r.phase != null);
  const t = usePlayerText(), [query, setQuery] = useState(''), [team, setTeam] = useState(plot.kind === 'occupancy' ? String(plot.rows[0]?.side ?? plot.rows[0]?.team ?? '') : ''), [player, setPlayer] = useState(''), [phase, setPhase] = useState(plot.kind === 'occupancy' ? String(plot.rows[0]?.phase ?? plot.rows[0]?.period ?? '') : '');
  const teamKeys = ['side', 'team', 'team_key'], playerKeys = ['player', 'player_key', 'player_id', 'actor', 'actor_id', 'from', 'to', 'recipient_key', 'source_id', 'target_id'], phaseKeys = ['phase', 'period'];
  const values = (row: Readonly<Record<string, TableCell>>, keys: string[]) => keys.flatMap(key => row[key] == null ? [] : [String(row[key])]);
  const options = (keys: string[]) => [...new Set(plot.rows.flatMap(r => values(r, keys)))];
  // TP249: en los simulados, el mapa de calor empieza por el local.
  const firstTeam=simple&&options(teamKeys).includes('home')?'home':options(teamKeys)[0]??'';
  const scopedTeam=team || (plot.kind==='occupancy'?firstTeam:''), scopedPhase=phase || (plot.kind==='occupancy'||phased?options(phaseKeys)[0]??'':'');
  const matches = (row: Readonly<Record<string, TableCell>>, endpoints = false) => (!scopedTeam || values(row, teamKeys).includes(scopedTeam)) && (!scopedPhase || values(row, phaseKeys).includes(scopedPhase)) && (endpoints || ((!query || Object.values(row).join(' ').toLowerCase().includes(query.toLowerCase())) && (!player || values(row, playerKeys).includes(player))));
  const rows = plot.rows.filter(row => matches(row));
  const filtered = !!(query || scopedTeam || player || scopedPhase);
  const edges = plot.edges?.filter(e => !filtered || !!e.scope && matches(e.scope));
  const endpoints = new Set(edges?.flatMap(e => [e.from,e.to]));
  const geometry: PlotView = { ...plot, edges, nodeLayout:plot.nodeLayout??(plot.points?.length?'positions':'schematic'),
    // TP249: en los simulados por partes, todos los jugadores de esa parte, tengan o no pases dibujados.
    points: plot.points?.filter(p => !filtered || (!!plot.edges?.length && !phased ? endpoints.has(p.id) && (!p.scope || matches(p.scope,true)) : !!p.scope && matches(p.scope))),
    cells: plot.cells?.filter(c => !filtered || !!c.scope && matches(c.scope)),
    series: plot.series?.map(series => ({...series,values:series.values.map(v => !filtered || !!v.scope && matches(v.scope) ? v : {...v,value:null})})),
  };
  const ambiguous = !!geometry.edges?.length && !!geometry.points && new Set(geometry.points.map(p=>p.id)).size !== geometry.points.length;
  const filters = <div className="unified-filters"><label>{t.plotFilter}<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>{([{ title: t.plotTeam, value: scopedTeam, set: setTeam, keys: teamKeys }, { title: t.plotPlayer, value: player, set: setPlayer, keys: playerKeys }, { title: t.plotPhase, value: scopedPhase, set: setPhase, keys: phaseKeys }]).map(filter => <label key={filter.title}>{filter.title}<select value={filter.value} onChange={e => filter.set(e.target.value)}><option value="" disabled={plot.kind==='occupancy' && (filter.keys===teamKeys || filter.keys===phaseKeys) || phased && filter.keys===phaseKeys}>{t.all}</option>{options(filter.keys).map(v => <option key={v}>{v}</option>)}</select></label>)}</div>;
  // TP239 (jueces: «Maps sin mapa»): en los simulados, título llano y el dibujo primero; filtros, tabla y definición, plegados.
  if (simple) {
    const drawable = !!(geometry.points?.length || geometry.edges?.length || geometry.cells?.length || geometry.series?.length);
    const graphic = plot.availability.status !== 'unavailable' && (drawable || plot.kind === 'team_shape' && rows.length && ctx)
      ? ctx ? <SimpleGraphic plot={geometry} rows={rows} ctx={ctx} /> : <PlotGraphic plot={geometry} lines /> : null;
    // TP249: equipo y parte a la vista, encima del dibujo (antes, solo dentro de «Ver como tabla»).
    const seg = (label: string, value: string, set: (v: string) => void, choices: readonly [string, string][]) => choices.length > 1 &&
      <div className="tpa-seg" role="group" aria-label={label}>{choices.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}>{text}</button>)}</div>;
    const teamChoices = plot.kind === 'occupancy' && ctx ? (['home', 'away'] as const).filter(v => options(teamKeys).includes(v)).map(v => [v, ctx.teams[v].abbr] as [string, string]) : [];
    const phaseChoices = phased ? options(phaseKeys).map(v => [v, x.half(v)] as [string, string]) : [];
    const title = t.plotTitles[plot.id] ?? t.plotTitles[plot.kind] ?? plot.id.replaceAll('_', ' ');
    return <article className="unified-plot unified-plot--simple tpa-panel" data-unified-plot data-plot-id={plot.id}>
      <header className="tpa-panel-h"><h3>{title}</h3>{ctx && <SimChip engine={ctx.engineLabel} />}
        {seg(x.team, scopedTeam, setTeam, teamChoices)}{seg(x.halfGroup, scopedPhase, setPhase, phaseChoices)}</header>
      {graphic ?? <p className="tpa-empty">{t.mapEmpty}</p>}
      {ambiguous && <p className="tpa-note">{t.ambiguousGraph}</p>}
      <details className="tpa-log"><summary>{t.asTable}</summary><p className="small-note">{plot.coordinateMeaning} · {plot.provenance}</p>{filters}
        <MatchRecordTable columns={plot.columns} rows={rows} title={t.equivalent} onSeek={onSeek} /><p>{plot.definition}</p></details>
    </article>;
  }
  return <article className="unified-plot" data-unified-plot data-plot-id={plot.id}><h3>{plot.id}</h3><p>{plot.coordinateMeaning}</p><p className="small-note">{plot.kind} · {plot.provenance} · {plot.availability.status} {plot.availability.reason}</p>
    {filters}
    {plot.availability.status !== 'unavailable' && <PlotGraphic plot={geometry} />}
    {ambiguous && <p>{t.ambiguousGraph}</p>}
    {plot.kind === 'pass_network' && !plot.points?.length && <p className="small-note">{t.coordinate}: {t.schematic} · {plot.coordinateMeaning}</p>}
    <MatchRecordTable columns={plot.columns} rows={rows} title={t.equivalent} onSeek={onSeek} /><details><summary>{t.definition}</summary><p>{plot.definition}</p>{plot.details && <pre>{JSON.stringify(plot.details, null, 2)}</pre>}</details>
  </article>;
}

export function MatchMaps({ plots, onSeek, simple = false, ctx }: { plots: readonly PlotView[]; onSeek: (ms: number) => void; simple?: boolean; ctx?: MapsContext | null }) {
  const t = usePlayerText();
  // TP249: la red de pases ya lleva las posiciones medias; en los simulados no se repite el mismo campo dos veces.
  const network = plots.some(p => p.kind === 'pass_network' && p.points?.length && p.edges?.length);
  const shown = simple && network ? plots.filter(p => p.kind !== 'average_positions') : plots;
  return <section className={`unified-maps${simple ? ' tp-maps-simple' : ''}`}>{shown.map(plot => <MatchPlot key={plot.id} plot={plot} onSeek={onSeek} simple={simple} ctx={ctx ?? undefined} />)}{plots.length === 0 && (simple ? <p className="tpa-empty">{t.mapEmpty}</p> : <p>{t.empty}</p>)}</section>;
}

/**
 * TP249 (el mapa de tiros era «un campo pequeño dentro de una caja enorme», sin colores ni leyenda): mapas de
 * los simulados con el mismo campo verde de la demo, los colores de cada equipo y leyenda.
 */
function SimpleGraphic({ plot, rows, ctx }: { plot: PlotView; rows: readonly Readonly<Record<string, TableCell>>[]; ctx: MapsContext }) {
  const { locale } = useLanguage(), x = MAP_TEXT[locale === 'es' ? 'es' : 'en'], teams = ctx.teams;
  const colour = (scope?: Readonly<Record<string, TableCell>>) => { const side = sideOf(scope); return side ? teams[side].colour : 'currentColor'; };
  const pitch = (body: ReactNode, label: string, arrows = false) => <svg className="tpa-pitch" viewBox="-2 -2 109 72" role="img" aria-label={label}><PitchLines />
    {arrows && <><text x="2" y="4" className="tpa-dir">← {teams.away.abbr}</text><text x="103" y="4" className="tpa-dir" textAnchor="end">{teams.home.abbr} →</text></>}{body}</svg>;
  if (plot.kind === 'shots') {
    // Local hacia la derecha y visitante hacia la izquierda en las dos partes: se refleja cada grupo (equipo y parte)
    // que tire hacia la otra portería, como el mapa de tiros de la demo.
    const points = plot.points ?? [], groups = new Map<string, number[]>();
    for (const p of points) { const key = `${sideOf(p.scope)}|${p.scope?.phase ?? ''}`; groups.set(key, [...groups.get(key) ?? [], p.x]); }
    const flip = (p: typeof points[number]) => { const side = sideOf(p.scope), xs = groups.get(`${side}|${p.scope?.phase ?? ''}`) ?? [];
      const right = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length) > 52.5; return side !== null && (side === 'home') !== right; };
    const known = points.some(p => p.scope?.outcome != null), goal = (p: typeof points[number]) => p.scope?.outcome === 'goal';
    const who = (p: typeof points[number]) => { const side = sideOf(p.scope); return ctx.player(String(p.scope?.actor_id ?? p.scope?.player_key ?? ''))?.name ?? (side ? teams[side].abbr : p.id); };
    return <>{pitch(points.map((p, i) => { const f = flip(p), c = colour(p.scope);
      return <circle key={`${p.id}/${i}`} cx={f ? 105 - p.x : p.x} cy={f ? 68 - p.y : p.y} r={goal(p) ? 1.5 : 1.2} fill={goal(p) ? c : 'rgba(0,0,0,.25)'} stroke={c} strokeWidth=".55" data-outcome={String(p.scope?.outcome ?? 'unknown')}>
        <title>{who(p)}{p.scope?.outcome ? ` · ${String(p.scope.outcome)}` : ''}</title></circle>; }), `${plot.id}: ${points.length}`, true)}
      <ul className="tp-map-legend">{(['home', 'away'] as const).map(side => { const mine = points.filter(p => sideOf(p.scope) === side);
        return <li key={side}><i style={{ background: teams[side].colour }} /><b>{teams[side].abbr}</b> {x.shots(mine.length)}{known ? ` · ${x.goals(mine.filter(goal).length)}` : ''}</li>; })}
        {known && <li className="tp-map-key"><i className="tp-key-goal" />{x.goalKey}</li>}{known && <li className="tp-map-key"><i className="tp-key-shot" />{x.shotKey}</li>}</ul>
      <p className="tpa-note">{x.shotNote}</p></>;
  }
  if (plot.kind === 'average_positions' || plot.kind === 'pass_network') {
    const points = plot.points ?? [], at = new Map(points.map(p => [p.id, p])), max = Math.max(1, ...(plot.edges ?? []).map(e => e.value ?? 0));
    return <>{pitch(<>
      {(plot.edges ?? []).map((e, i) => { const a = at.get(e.from), b = at.get(e.to); return a && b && (e.value ?? 0) >= 2 &&
        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colour(e.scope)} strokeOpacity=".55" strokeWidth={.25 + 1.4 * (e.value ?? 0) / max} strokeLinecap="round"><title>{e.value}</title></line>; })}
      {points.map(p => { const one = ctx.player(p.id); return <g key={p.id} className="tpa-node" onClick={() => ctx.onPlayer?.(p.id)}>
        <circle cx={p.x} cy={p.y} r="2.4" fill={colour(p.scope)} stroke="#fff" strokeWidth=".35" />
        <text x={p.x} y={p.y + .9} textAnchor="middle" className="tpa-num">{one?.number ?? ''}</text><title>{one?.name ?? p.id}</title></g>; })}
    </>, plot.id)}
      <ul className="tp-map-legend">{(['home', 'away'] as const).map(side => <li key={side}><i style={{ background: teams[side].colour }} /><b>{teams[side].abbr}</b> {teams[side].name}</li>)}</ul>
      <p className="tpa-note">{x.positionsNote}</p></>;
  }
  if (plot.kind === 'occupancy') {
    const cells = plot.cells ?? [], max = Math.max(1, ...cells.map(c => c.value ?? 0));
    return <>{pitch(<>{cells.map((c, i) => (c.value ?? 0) > 0 && <rect key={i} x={c.x} y={c.y} width={c.width} height={c.height} fill={colour(c.scope)} opacity={.1 + .75 * (c.value ?? 0) / max}><title>{c.value}</title></rect>)}<PitchLines /></>, plot.id)}
      <p className="tpa-note">{x.heatNote}</p></>;
  }
  if (plot.kind === 'team_shape') {
    // Forma del equipo: longitud y anchura medias en la parte elegida, comparadas como las estadísticas.
    const pick = (side: Side, key: string) => { const v = rows.find(row => row.side === side)?.[key]; return typeof v === 'number' ? Math.round(v) : null; };
    return <div className="tpa-stats">{([['length_m', x.length], ['width_m', x.width]] as const).map(([key, label]) => { const h = pick('home', key), a = pick('away', key);
      return <div className="tpa-sr" key={key} data-stat={key}><span className="tpa-v">{h ?? '—'}{h !== null && ' m'}</span>
        <span className="tpa-l"><span className="tpa-lt">{label}</span><StatBar home={h} away={a} homeColour={teams.home.colour} awayColour={teams.away.colour} /></span>
        <span className="tpa-v">{a ?? '—'}{a !== null && ' m'}</span></div>; })}</div>;
  }
  return <PlotGraphic plot={plot} lines />;
}
