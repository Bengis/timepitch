// TP249 («Reveal final analysis» apagado junto a «Final analysis revealed», un desplegable «Analysis scope» y
// un «Full match» suelto): un solo control en el armazón de emisión. Antes de revelar, «Hasta el 63'» y el botón que
// enseña el final; después, dos botones «Hasta el 63'» / «Partido completo»; al acabar el partido, solo «Partido completo».
import { usePlayerText } from './player-messages';
import { useAnalysisText } from './analysis/messages';
import { useLanguage } from '../i18n';

const HINT = { en: 'Shows the final score and the stats of the whole match.', es: 'Enseña el resultado final y las estadísticas de todo el partido.' } as const;

export function AnalysisScopeBar({ revealed, final, ended, clock, compact = false, onReveal, onScope }: {
  revealed: boolean; final: boolean; ended: boolean;
  /** Reloj del partido en el punto de la reproducción («63'»). */
  clock: string;
  /** Columna lateral: sin el rótulo del instante antes de revelar (ya lo dice el marcador). */
  compact?: boolean;
  onReveal: () => void; onScope: (scope: 'cursor' | 'final') => void;
}) {
  const t = usePlayerText(), ta = useAnalysisText(), { locale } = useLanguage();
  if (ended) return <div className="tp-scope-bar" data-scope-bar><span className="tp-scope-now" role="status">{ta.final}</span></div>;
  if (!revealed) return <div className="tp-scope-bar" data-scope-bar>
    {!compact && <span className="tp-scope-now">{ta.upTo(clock)}</span>}
    <button type="button" className="tp-scope-reveal" title={HINT[locale === 'es' ? 'es' : 'en']} onClick={onReveal}>{t.reveal}</button>
  </div>;
  return <div className="tp-scope-bar" data-scope-bar>
    <div className="tpa-seg" role="group" aria-label={t.analysisScope}>
      <button type="button" aria-pressed={!final} onClick={() => onScope('cursor')}>{ta.upTo(clock)}</button>
      <button type="button" aria-pressed={final} onClick={() => onScope('final')}>{ta.final}</button>
    </div>
  </div>;
}
