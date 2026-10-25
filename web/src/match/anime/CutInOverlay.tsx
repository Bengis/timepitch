// Dibujo de una escena de Capitán Hane (TP234), cargado a demanda: el SVG generado (scene.ts) y la animación de
// anime.css. Movimiento reducido: tarjeta fija. Un clic o cualquier tecla la salta.
// TP238 («la escena anime es absurdamente grande»): ya no tapa la pantalla; ocupa solo el recuadro del campo
// (se monta dentro de `.pitch-surface`), que siempre es apaisado, así que va con la composición apaisada.
import { useEffect, useMemo } from 'react';
import { cutInSvg, type CutInSpec } from './scene';
import './anime.css';

let serial = 0;

export default function CutInOverlay({ spec, durationMs, reducedMotion, label, skipHint, description, onSkip }: {
  spec: CutInSpec; durationMs: number; reducedMotion: boolean; label: string; skipHint: string; description: string; onSkip: () => void;
}) {
  const svg = useMemo(() => cutInSvg(spec, `hane${++serial}`, reducedMotion ? 'card' : 'animated', 'landscape'), [spec, reducedMotion]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); onSkip(); };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onSkip]);
  return <div className={`hane-overlay${reducedMotion ? ' hane-reduced' : ''}`} role="dialog" aria-label={label} data-anime-cutin={spec.kind}
    style={{ ['--ci-dur' as string]: `${durationMs}ms` }} onClick={e => { e.stopPropagation(); onSkip(); }}>
    <div className="hane-stage" dangerouslySetInnerHTML={{ __html: svg }} />
    <p className="hane-sr" aria-live="assertive">{description}</p>
    <p className="hane-skip" aria-hidden="true">{skipHint}</p>
  </div>;
}
