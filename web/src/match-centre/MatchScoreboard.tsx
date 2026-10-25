import type { SessionSnapshot } from './session';
import { matchTime, usePlayerText } from './player-messages';
import type { ClockView } from './sequence/types';
import { BroadcastScorebug } from '../presentation/BroadcastScorebug';
import type { CrestRef, MatchKits } from '../presentation/types';

const NO_CREST: CrestRef = { src: '', kind: 'none', source: null };

/** Marcador del Match Centre (G17): marcador de emisión a lo ancho (maqueta v1-2d) + una línea discreta con
 *  temporada/formación de cada lado y la procedencia del marcador («Fuente», desplegable; nunca se pierde). */
export function MatchScoreboard({ snapshot, elapsedMs, clock, crests, kits = null, reds = { home: 0, away: 0 } }: {
  snapshot: SessionSnapshot; elapsedMs: number; clock?: ClockView;
  /** Escudos resueltos (HD → HFK → ninguno); si no hay, el de la fuente (`crestUrl`). */
  crests?: { home: CrestRef; away: CrestRef };
  kits?: MatchKits | null; reds?: { home: number; away: number };
}) {
  const t = usePlayerText(), { descriptor: d, facts } = snapshot;
  const crest = (side: 'home' | 'away'): CrestRef => {
    const resolved = crests?.[side];
    if (resolved && resolved.kind !== 'none') return resolved;
    return d[side].crestUrl ? { src: d[side].crestUrl!, kind: 'hfk', source: null } : NO_CREST;
  };
  const period = clock?.period ?? (snapshot.presentedCursor.period || null);
  const meta = (side: 'home' | 'away') => [d[side].season, d[side].formation].filter(Boolean).join(' · ');
  return <header className="unified-scoreboard" data-unified-scoreboard>
    <BroadcastScorebug home={{ name: d.home.name }} away={{ name: d.away.name }} score={facts.score.value}
      clock={clock?.text ?? matchTime(snapshot.clockMs)} clockLabel={t.matchClock} period={period} finished={clock?.state === 'fulltime'}
      reds={reds} crests={{ home: crest('home'), away: crest('away') }} kits={kits} />
    <div className="unified-score-meta tp-sb-meta">
      <small>{meta('home')}</small>
      {!clock && <span className="tp-sb-elapsed">{t.elapsed}: {matchTime(elapsedMs)}</span>}
      <details className="unified-score-source"><summary>{t.source} · {t.sourceKinds[d.identity.source] ?? d.identity.source}</summary><p>{facts.score.provenance} · {facts.score.refs.join(', ')}</p><p>{d.identity.id} · {d.identity.revision}</p><p>{t.clock}: {snapshot.clockMs === null ? t.noClock : matchTime(snapshot.clockMs)}</p></details>
      <small>{meta('away')}</small>
    </div>
  </header>;
}
