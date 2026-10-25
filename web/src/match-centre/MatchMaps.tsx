import { useState } from 'react';
import type { PlotView, TableCell } from './session';
import { usePlayerText } from './player-messages';
import { PitchLines } from './analysis/RecordedAnalysisViews';

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

function MatchPlot({ plot, onSeek, simple = false }: { plot: PlotView; onSeek: (ms: number) => void; simple?: boolean }) {
  const t = usePlayerText(), [query, setQuery] = useState(''), [team, setTeam] = useState(plot.kind === 'occupancy' ? String(plot.rows[0]?.side ?? plot.rows[0]?.team ?? '') : ''), [player, setPlayer] = useState(''), [phase, setPhase] = useState(plot.kind === 'occupancy' ? String(plot.rows[0]?.phase ?? plot.rows[0]?.period ?? '') : '');
  const teamKeys = ['side', 'team', 'team_key'], playerKeys = ['player', 'player_key', 'player_id', 'actor', 'actor_id', 'from', 'to', 'recipient_key', 'source_id', 'target_id'], phaseKeys = ['phase', 'period'];
  const values = (row: Readonly<Record<string, TableCell>>, keys: string[]) => keys.flatMap(key => row[key] == null ? [] : [String(row[key])]);
  const options = (keys: string[]) => [...new Set(plot.rows.flatMap(r => values(r, keys)))];
  const scopedTeam=team || (plot.kind==='occupancy'?options(teamKeys)[0]??'':''), scopedPhase=phase || (plot.kind==='occupancy'?options(phaseKeys)[0]??'':'');
  const matches = (row: Readonly<Record<string, TableCell>>, endpoints = false) => (!scopedTeam || values(row, teamKeys).includes(scopedTeam)) && (!scopedPhase || values(row, phaseKeys).includes(scopedPhase)) && (endpoints || ((!query || Object.values(row).join(' ').toLowerCase().includes(query.toLowerCase())) && (!player || values(row, playerKeys).includes(player))));
  const rows = plot.rows.filter(row => matches(row));
  const filtered = !!(query || scopedTeam || player || scopedPhase);
  const edges = plot.edges?.filter(e => !filtered || !!e.scope && matches(e.scope));
  const endpoints = new Set(edges?.flatMap(e => [e.from,e.to]));
  const geometry: PlotView = { ...plot, edges, nodeLayout:plot.nodeLayout??(plot.points?.length?'positions':'schematic'),
    points: plot.points?.filter(p => !filtered || (!!plot.edges?.length ? endpoints.has(p.id) && (!p.scope || matches(p.scope,true)) : !!p.scope && matches(p.scope))),
    cells: plot.cells?.filter(c => !filtered || !!c.scope && matches(c.scope)),
    series: plot.series?.map(series => ({...series,values:series.values.map(v => !filtered || !!v.scope && matches(v.scope) ? v : {...v,value:null})})),
  };
  const ambiguous = !!geometry.edges?.length && !!geometry.points && new Set(geometry.points.map(p=>p.id)).size !== geometry.points.length;
  const filters = <div className="unified-filters"><label>{t.plotFilter}<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>{([{ title: t.plotTeam, value: scopedTeam, set: setTeam, keys: teamKeys }, { title: t.plotPlayer, value: player, set: setPlayer, keys: playerKeys }, { title: t.plotPhase, value: scopedPhase, set: setPhase, keys: phaseKeys }]).map(filter => <label key={filter.title}>{filter.title}<select value={filter.value} onChange={e => filter.set(e.target.value)}><option value="" disabled={plot.kind==='occupancy' && (filter.keys===teamKeys || filter.keys===phaseKeys)}>{t.all}</option>{options(filter.keys).map(v => <option key={v}>{v}</option>)}</select></label>)}</div>;
  // TP239 (jueces: «Maps sin mapa»): en los simulados, título llano y el dibujo primero; filtros, tabla y definición, plegados.
  if (simple) {
    const drawable = !!(geometry.points?.length || geometry.edges?.length || geometry.cells?.length || geometry.series?.length);
    const graphic = plot.availability.status !== 'unavailable' && drawable ? <PlotGraphic plot={geometry} lines /> : null;
    return <article className="unified-plot unified-plot--simple" data-unified-plot data-plot-id={plot.id}><h3>{t.plotTitles[plot.id] ?? t.plotTitles[plot.kind] ?? plot.id.replaceAll('_', ' ')}</h3>
      {graphic ?? <p className="small-note">{t.mapEmpty}</p>}
      {ambiguous && <p>{t.ambiguousGraph}</p>}
      <details><summary>{t.asTable}</summary><p className="small-note">{plot.coordinateMeaning} · {plot.provenance}</p>{filters}
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

export function MatchMaps({ plots, onSeek, simple = false }: { plots: readonly PlotView[]; onSeek: (ms: number) => void; simple?: boolean }) {
  const t = usePlayerText();
  return <section className="unified-maps">{plots.map(plot => <MatchPlot key={plot.id} plot={plot} onSeek={onSeek} simple={simple} />)}{plots.length === 0 && <p>{t.empty}</p>}</section>;
}
