import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from './session';
import { MatchMetricTable } from './MatchMetricTable';
import { usePlayerText } from './player-messages';

/** Lista técnica de jugadores. Con `collapsible` (bajo las alineaciones) va plegada en un `<details>` titulado `summary`. */
export function MatchPlayers({ players, onSelect, collapsible = false, summary }: { players: readonly PlayerView[]; onSelect: (id: string) => void; collapsible?: boolean; summary?: string }) {
  const t = usePlayerText(); const [side, setSide] = useState(''), [search, setSearch] = useState('');
  const visible = players.filter(p => (!side || p.side === side) && `${p.name ?? ''} ${p.id}`.toLowerCase().includes(search.toLowerCase()));
  const body = <section><div className="unified-filters"><label>{t.player}<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><label>{t.team}<select value={side} onChange={e => setSide(e.target.value)}><option value="">{t.all}</option><option value="home">{t.home}</option><option value="away">{t.away}</option></select></label></div>
    <div className="unified-table"><table><caption>{t.players}</caption><thead><tr><th>{t.player}</th><th>{t.team}</th><th>{t.role}</th><th>{t.jersey}</th></tr></thead><tbody>{visible.map(p => <tr key={p.id}><th scope="row"><button onClick={() => onSelect(p.id)}>{p.name ?? p.id}</button></th><td>{p.side ? t[p.side] : t.unknown}</td><td>{p.role.value ?? '—'}</td><td>{p.jersey.value ?? '—'}</td></tr>)}</tbody></table></div>
    <MatchMetricTable metrics={visible.flatMap(p => p.metrics)} names={Object.fromEntries(players.map(p => [p.id, p.name ?? p.id]))} />
  </section>;
  return collapsible ? <details className="tp-lu-tech"><summary>{summary ?? t.players}</summary>{body}</details> : body;
}

export function MatchPlayerDetail({ player, revealed, onClose }: { player: PlayerView; revealed: boolean; onClose: () => void }) {
  const t = usePlayerText(), close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, centre = close.current?.closest('.unified-centre');
    close.current?.focus();
    return () => {
      if (centre?.hasAttribute('hidden')) return;
      if (previous?.isConnected && !previous.closest('[hidden],details:not([open])')) previous.focus();
      else centre?.querySelector<HTMLElement>('[role=tab][aria-selected=true], [data-unified-transport] button:not(:disabled)')?.focus();
    };
  }, []);
  return <aside className="unified-player-detail" role="dialog" aria-label={t.detail} aria-modal="false" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <header><h2>{player.name ?? player.id}</h2><button ref={close} aria-label={t.close} onClick={onClose}>×</button></header><p><code>{player.id}</code> · {player.availability.status} {player.availability.reason}</p>
    <dl><dt>{t.role}</dt><dd>{player.role.value ?? t.missing} · {player.role.provenance}</dd><dt>{t.jersey}</dt><dd>{player.jersey.value ?? t.missing} · {player.jersey.provenance}</dd><dt>{t.intervals}</dt><dd>{player.intervals.value ? JSON.stringify(player.intervals.value) : t.missing} · {player.intervals.provenance}</dd></dl>
    <p>{t.refs}: {player.sourceRefs.join(', ')}</p><MatchMetricTable metrics={player.metrics} /><MatchMetricTable metrics={player.estimatedAttributes} title={t.attributes} />
    {player.details && <details><summary>{t.details}</summary><pre>{JSON.stringify(player.details, null, 2)}</pre></details>}{revealed && player.finalDetails && <details><summary>{t.final}</summary><pre>{JSON.stringify(player.finalDetails, null, 2)}</pre></details>}
  </aside>;
}
