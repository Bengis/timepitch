// TP241: narración junto al campo. Arriba, en grande, lo último que ha pasado; debajo, lo anterior (lo más reciente
// primero). Cada frase lleva el minuto y, al pulsarla, la reproducción vuelve a esa jugada.
import { useMemo } from 'react';
import { useLanguage } from '../../i18n';
import type { EventView } from '../session';
import { eventMinute, Panel, type TimelineContext } from '../analysis/RecordedAnalysisViews';
import { narrate, type NarrationLine } from './narration';
import './narration.css';

const TEXT = {
  es: { title: 'Narración', empty: 'El partido aún no ha empezado.', seek: (m: string) => `Ver la jugada del ${m}` },
  en: { title: 'Commentary', empty: 'The match has not started yet.', seek: (m: string) => `Watch the play at ${m}` },
} as const;
/** Frases visibles en la lista: suficientes para seguir el partido sin cargar la columna. */
const SHOWN = 40;

export function NarrationPanel({ ctx, events, untilMs, keepers, onSeek }: { ctx: TimelineContext; events: readonly EventView[]; untilMs: number;
  keepers: ReadonlySet<string>; onSeek: (ms: number) => void }) {
  const { locale } = useLanguage(), lang = locale === 'es' ? 'es' : 'en', t = TEXT[lang];
  const all = useMemo(() => narrate(events, { locale: lang, keepers, name: id => ctx.player(id)?.name ?? null,
    teams: { home: ctx.teams.home.name, away: ctx.teams.away.name } }), [events, lang, keepers, ctx]);
  const shown = useMemo(() => all.filter(l => l.atMs <= untilMs).slice(-SHOWN).reverse(), [all, untilMs]);
  const line = (l: NarrationLine, now: boolean) => {
    const minute = l.kind === 'mark' && l.source.kind === 'halftime' ? '' : eventMinute(l.source, ctx.source), team = l.side ? ctx.teams[l.side] : null;
    return <li key={l.id} className={`tp-narr-line${now ? ' is-now' : ''}`} data-kind={l.kind}>
      <button type="button" onClick={() => onSeek(Math.max(0, l.atMs - 3000))} aria-label={`${t.seek(minute || l.text)}: ${l.text}`}>
        <span className="tp-narr-side" style={team ? { background: team.colour } : undefined} />
        <span className="tp-narr-min">{minute}</span>
        <span className="tp-narr-tx">{l.text}</span>
      </button>
    </li>;
  };
  return <Panel title={t.title} engine={ctx.engineLabel} className="tp-narration">
    {shown.length === 0 ? <p className="tpa-empty">{t.empty}</p> :
      <ol className="tp-narr" aria-live="polite" aria-relevant="additions">{shown.map((l, i) => line(l, i === 0))}</ol>}
  </Panel>;
}
