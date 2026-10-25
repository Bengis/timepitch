import type { ReactNode } from 'react';
import { useLanguage } from '../i18n';
import type { CameraMode } from './retroScene';
import './pitch-hud.css';

// HUD de emisión sobre el campo (maqueta v1-2d: overlay-tl / overlay-tr). Solo presentación:
// no toca el renderizador; las pestañas reutilizan el estado de cámara de Pitch.
// En teléfono (TP223) todo va en una fila compacta: el rótulo deja solo el reloj a la vista (el texto sigue para lectores
// de pantalla y en `title`; el chip «movimiento sintético» lo dice) y las pestañas de cámara se mantienen.
const en = {
  camera: 'Camera', broadcast: 'Broadcast', tactical: 'Tactical',
  scene: 'Illustrative scene', note: 'Synthetic engine movement · not real tracking',
};
const es: typeof en = {
  camera: 'Cámara', broadcast: 'Emisión', tactical: 'Táctica',
  scene: 'Escena ilustrativa', note: 'Movimiento sintético del motor · no es seguimiento real',
};
export function usePitchHudText() { const { locale } = useLanguage(); return locale === 'es' ? es : en; }

// 'Cenital' no existe en el renderizador 3D (solo follow/overview): no se ofrece.
const CAMERA_TABS: readonly { mode: CameraMode; label: 'broadcast' | 'tactical' }[] = [
  { mode: 'follow', label: 'broadcast' }, { mode: 'overview', label: 'tactical' },
];

export function PitchHud({ topLeft, caption, camera }: {
  topLeft?: ReactNode;
  /** Reloj real mostrado y nota honesta opcional (por defecto: movimiento sintético del motor). */
  caption?: { clock: string; note?: string } | null;
  camera?: { value: CameraMode; onChange: (mode: CameraMode) => void } | null;
}) {
  const text = usePitchHudText();
  return <div className="pitch-hud-overlay">
    {(topLeft || caption) && <div className="pitch-hud-tl">
      {topLeft}
      {caption && <span className="pitch-hud-glass pitch-hud-caption" title={`${text.scene} · ${caption.note ?? text.note}`}>
        <span className="pitch-hud-caption-text">{text.scene} ·</span>{' '}<b className="num">{caption.clock}</b>{' '}
        <span className="pitch-hud-caption-text">· {caption.note ?? text.note}</span></span>}
    </div>}
    {camera && <div className="pitch-hud-tr pitch-hud-glass pitch-hud-camtabs" role="group" aria-label={text.camera}>
      {CAMERA_TABS.map(tab => <button key={tab.mode} type="button" aria-pressed={camera.value === tab.mode}
        className={camera.value === tab.mode ? 'on' : undefined} onClick={() => camera.onChange(tab.mode)}>{text[tab.label]}</button>)}
    </div>}
  </div>;
}

/** Píldora glass con el motor de movimiento (p. ej. «GRF / TouchLines»); se oculta en teléfonos. */
export function PitchHudEngine({ label }: { label: string }) {
  return <span className="pitch-hud-glass pitch-hud-engine">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 17c3-6 6 2 9-4s5-3 7-5" /><circle cx="4" cy="17" r="1.6" fill="currentColor" /><circle cx="20" cy="8" r="1.6" fill="currentColor" />
    </svg><b>{label}</b>
  </span>;
}
