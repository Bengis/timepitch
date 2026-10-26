// TP247 (25-oct: «presentación de los equipos, primera parte, descanso con las estadísticas, segunda parte y
// el resultado final»): rótulos de las fases del partido sobre el campo. La salida lleva un rótulo inferior; el
// descanso y el final, una tarjeta con marcador, goleadores y las estadísticas hasta ese momento.
import type { ReactNode } from 'react';
import { defineTexts } from '../i18n-catalog';
import { useLanguage } from '../i18n';

export type MatchPhase = 'walkout' | 'halftime' | 'fulltime';
export type BreakScorer = Readonly<{ id: string; name: string; minute: string; ownGoal: boolean }>;

const TEXT = defineTexts('match-break', {
  en: { walkout: 'The teams walk out', skip: 'Skip to kick-off', halftime: 'Half-time', fulltime: 'Full-time', second: 'Start the second half',
    again: 'Watch again', close: 'Close', og: 'og', stats: 'Match statistics', report: 'Read the AI match report', motm: 'Player of the match' },
  es: { walkout: 'Salen los equipos', skip: 'Ir al saque inicial', halftime: 'Descanso', fulltime: 'Final del partido', second: 'Empezar la segunda parte',
    again: 'Ver otra vez', close: 'Cerrar', og: 'p.p.', stats: 'Estadísticas del partido', report: 'Leer la crónica IA', motm: 'Jugador del partido' },
});

export function MatchBreak({ phase, home, away, score, scorers, stats, onContinue, onReplay, onClose, onReport, best, lineups }: {
  phase: MatchPhase; home: string; away: string; score: Readonly<{ home: number; away: number }> | null;
  scorers?: Readonly<{ home: readonly BreakScorer[]; away: readonly BreakScorer[] }>; stats?: ReactNode;
  onContinue?: () => void; onReplay?: () => void; onClose?: () => void;
  /** TP250: final con la crónica IA a un clic y el jugador del partido. */
  onReport?: () => void; best?: Readonly<{ name: string; detail: string }> | null;
  /** TP250: alineaciones durante la salida de los equipos (dorsal y nombre, portero primero). */
  lineups?: Readonly<{ home: readonly string[]; away: readonly string[] }>;
}) {
  const { locale } = useLanguage(), t = TEXT(locale);
  if (phase === 'walkout') return <div className="tp-break tp-break-walkout" data-match-phase="walkout" role="status">
    <div className="tp-break-lower"><span className="tp-break-kicker">{t.walkout}</span><strong>{home}</strong><span className="tp-break-vs">v</span><strong>{away}</strong>
      {lineups && (lineups.home.length > 0 || lineups.away.length > 0) && <div className="tp-break-lineups">
        <ol>{lineups.home.map(p => <li key={p}>{p}</li>)}</ol><ol>{lineups.away.map(p => <li key={p}>{p}</li>)}</ol></div>}</div>
    {onContinue && <button type="button" className="tp-break-skip" onClick={onContinue}>{t.skip} ›</button>}
  </div>;
  // Como en la tele: una línea por goleador con todos sus minutos («Henry 27', 52'»).
  const list = (side: 'home' | 'away') => {
    const byName = new Map<string, string[]>();
    for (const s of scorers?.[side] ?? []) { const key = `${s.name}${s.ownGoal ? ` (${t.og})` : ''}`; byName.set(key, [...byName.get(key) ?? [], s.minute]); }
    return <ul className={`tp-break-scorers ${side}`}>{[...byName].map(([name, minutes]) => <li key={name}>{name} {minutes.join(', ')}</li>)}</ul>;
  };
  return <div className="tp-break tp-break-card-wrap" data-match-phase={phase}>
    <section className="tp-break-card" role="dialog" aria-label={t[phase]}>
      <p className="tp-break-kicker">{t[phase]}</p>
      <div className="tp-break-score">
        <span className="tp-break-team">{home}</span>
        <span className="tp-break-result num">{score ? `${score.home} – ${score.away}` : '–'}</span>
        <span className="tp-break-team">{away}</span>
      </div>
      {scorers && (scorers.home.length > 0 || scorers.away.length > 0) && <div className="tp-break-goals">{list('home')}{list('away')}</div>}
      {phase === 'fulltime' && best && <p className="tp-break-best"><span className="tp-break-kicker">{t.motm}</span><strong>{best.name}</strong> <span>{best.detail}</span></p>}
      {stats && <div className="tp-break-stats" aria-label={t.stats}>{stats}</div>}
      <div className="tp-break-actions">
        {phase === 'halftime' && onContinue && <button type="button" className="tp-break-primary" onClick={onContinue} autoFocus>{t.second} ▶</button>}
        {phase === 'fulltime' && onReplay && <button type="button" className="tp-break-primary" onClick={onReplay} autoFocus>{t.again}</button>}
        {phase === 'fulltime' && onReport && <button type="button" className="tp-break-report" onClick={onReport}>✦ {t.report}</button>}
        {phase === 'fulltime' && onClose && <button type="button" onClick={onClose}>{t.close}</button>}
      </div>
    </section>
  </div>;
}
