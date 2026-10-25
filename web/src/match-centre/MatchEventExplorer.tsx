import { useEffect, useRef, useState } from 'react';
import type { EventView, PlayerView, SessionSnapshot } from './session';
import { matchTime, usePlayerText } from './player-messages';

type InspectableEvent = Omit<EventView, 'sourceIndex'> & { sourceIndex: number | null };
function EventRoute({ event }: { event: InspectableEvent }) {
  const t = usePlayerText();
  const d = event.details;
  const source = d.source && typeof d.source === 'object' ? d.source as Record<string, unknown> : d;
  const point = (v: unknown, scale = 1) => {
    if (!v || typeof v !== 'object') return null;
    const x = Array.isArray(v) ? v[0] : (v as { x?: unknown }).x, y = Array.isArray(v) ? v[1] : (v as { y?: unknown }).y;
    return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x: x / scale, y: y / scale } : null;
  };
  const start = point(source.canonical_location ?? source.location) ?? point(d.origin_mm, 1000);
  const end = point(source.canonical_end_location ?? source.end_location) ?? point(d.end_mm, 1000);
  if (!start || !end) return null;
  return <><svg className="unified-map" viewBox="0 0 105 68" role="img" aria-label={`${t.route}: ${start.x}, ${start.y} → ${end.x}, ${end.y}`}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="currentColor" strokeWidth="1" /><circle cx={start.x} cy={start.y} r="1.5" fill="none" stroke="currentColor" /><circle cx={end.x} cy={end.y} r="2" fill="currentColor" /></svg><p className="small-note">{t.routeNote}</p></>;
}

export function MatchEventExplorer({ snapshot, players, onSeek, onPlayer, onWindow, resolvedEvents = [], watchRequest }: {
  snapshot: SessionSnapshot; players: readonly PlayerView[]; onSeek: (ms: number) => void; onPlayer: (id: string) => void; onWindow: (period: number, from: number, to: number) => void; resolvedEvents?: readonly EventView[]; watchRequest?: {elapsedMs:number;token:number}|null;
}) {
  const t = usePlayerText();
  const [kind, setKind] = useState(''), [side, setSide] = useState(''), [actor, setActor] = useState(''), [page, setPage] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState<number | null>(null), [from, setFrom] = useState(0), [to, setTo] = useState(60);
  const [eventSet,setEventSet]=useState('source');
  const events=eventSet==='resolved'?resolvedEvents:snapshot.events;
  const window = eventSet==='source'?snapshot.eventWindow:undefined;
  const handledWatch=useRef<{token:number;focused:boolean;selected:boolean}|null>(null);
  useEffect(()=>{
    if(!watchRequest)return;
    if(handledWatch.current?.token!==watchRequest.token)handledWatch.current={token:watchRequest.token,focused:false,selected:false};
    const handled=handledWatch.current!;
    if(handled.selected)return;
    if(!handled.focused){document.querySelector<HTMLElement>('[data-unified-match-centre]:not([hidden]) [data-unified-events] h2')?.focus();handled.focused=true;}
    const event=[...events,...resolvedEvents].find(e=>e.elapsedMs===watchRequest.elapsedMs);
    if(event){handled.selected=true;setSelected(event.id);if(resolvedEvents.some(e=>e.id===event.id))setEventSet('resolved');setKind('');setSide('');setActor('');}
  },[watchRequest,events,resolvedEvents]);
  const filtered = events.filter(e => (!kind || e.kind === kind) && (!side || e.side === side) && (!actor || e.participantIds.includes(actor)));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pages - 1);
  const milestones = eventSet==='resolved'?[]:snapshot.milestones?.filter(e => e.elapsedMs !== null && e.elapsedMs <= snapshot.presentedCursor.elapsedMs && !snapshot.events.some(raw => raw.id === e.id)) ?? [];
  const chosen = [...events, ...milestones].find(e => e.id === selected);
  const chooseFilter = (change: () => void) => { change(); setPage(0); };
  const name = (id: string) => players.find(p => p.id === id)?.name ?? id;
  const entry = (e: InspectableEvent) => <li key={e.id}><button aria-pressed={chosen?.id === e.id} onClick={() => setSelected(e.id)}>{e.kind} · {t.phase} {e.period} · {matchTime(e.periodMs)}</button><small>{e.actorId ? name(e.actorId) : t.unknown} · {e.outcome ?? '—'}</small></li>;
  return <section className="unified-events" data-unified-events aria-label={t.events}><h2 tabIndex={-1}>{t.events}</h2>{!!resolvedEvents.length && <label>{t.eventSet}<select value={eventSet} onChange={e=>{setEventSet(e.target.value);setSelected(null);setKind('');setSide('');setActor('');setPage(0);}}><option value="source">{t.source}</option><option value="resolved">{t.resolvedActions} · {t.final}</option></select></label>}
    <div className="unified-filters"><label>{t.eventType}<select value={kind} onChange={e => chooseFilter(() => setKind(e.target.value))}><option value="">{t.all}</option>{[...new Set([...events.map(e => e.kind), ...(kind ? [kind] : [])])].map(k => <option key={k}>{k}</option>)}</select></label>
      <label>{t.team}<select value={side} onChange={e => chooseFilter(() => setSide(e.target.value))}><option value="">{t.all}</option><option value="home">{t.home}</option><option value="away">{t.away}</option></select></label>
      <label>{t.player}<select value={actor} onChange={e => chooseFilter(() => setActor(e.target.value))}><option value="">{t.all}</option>{[...new Set(events.flatMap(e => e.participantIds))].map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label></div>
    {window && <p className="small-note">{window.mode === 'manual' ? t.manual : t.cursor} · {t.phase} {window.period} · {matchTime(window.fromMs)}–{matchTime(window.toMs)} · {window.availability.status}</p>}
    {!!milestones.length && <section aria-label={t.milestones}><h3>{t.milestones}</h3><ol className="unified-event-list">{milestones.map(entry)}</ol></section>}
    <ol className="unified-event-list">{filtered.slice(currentPage * 20, currentPage * 20 + 20).map(entry)}</ol>{!filtered.length && <p>{t.empty}</p>}
    <div className="unified-pagination"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t.previous}</button><span>{currentPage + 1}/{pages} · {filtered.length} {t.records}</span><button disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>{t.next}</button></div>
    {chosen && <article className="unified-event-detail" aria-label={t.details}><h3>{chosen.kind} · {matchTime(chosen.periodMs)}</h3><p>{chosen.provenance} · {chosen.outcome ?? '—'}</p><p>{t.phase} {chosen.period} · {t.elapsed} {matchTime(chosen.elapsedMs)}</p>
      <button disabled={chosen.elapsedMs === null} onClick={() => { if (chosen.elapsedMs !== null) onSeek(chosen.elapsedMs); }}>{t.watch}</button>
      <div>{chosen.participantIds.map(id => <button key={id} onClick={() => onPlayer(id)}>{name(id)}</button>)}</div>
      <EventRoute event={chosen} /><p>{t.refs}: {chosen.refs.map(ref => <code key={ref}>{ref}</code>)}</p><details><summary>{t.details}</summary><pre>{JSON.stringify({ id: chosen.id, sourceIndex: chosen.sourceIndex, ...chosen.details }, null, 2)}</pre></details>
    </article>}
    <details><summary>{t.sourceWindow}</summary><form className="unified-filters" onSubmit={e => { e.preventDefault(); if (from >= 0 && to > from && to - from <= 60) onWindow(period ?? snapshot.presentedCursor.period, from * 1000, to * 1000); }}>
      <label>{t.source} · {t.phase}<select value={period ?? snapshot.presentedCursor.period} onChange={e => setPeriod(Number(e.target.value))}>{snapshot.descriptor.periods.map(p => <option key={p.period} value={p.period}>{p.period}</option>)}</select></label>
      <label>{t.from}<input type="number" min="0" value={from} onChange={e => setFrom(Number(e.target.value))} /></label><label>{t.to}<input type="number" min="0" value={to} onChange={e => setTo(Number(e.target.value))} /></label>
      <button disabled={from < 0 || to <= from || to - from > 60}>{t.browse}</button></form></details>
  </section>;
}
