import { useId, useMemo } from 'react';
import { useLanguage } from '../../i18n';
import { GENERIC_APPEARANCE, type AppearanceParams, type KitSpec } from '../types';
import { NEUTRAL_KIT, portraitSvg } from './portrait-svg';
import './portrait.css';

const TEXT = {
  en: { notice: 'Stylised avatar, not a portrait', handAssigned: 'Unsourced features · assigned by hand', generic: 'Generic avatar' },
  es: { notice: 'Avatar estilizado, no es un retrato', handAssigned: 'Rasgos sin fuente · asignados a mano', generic: 'Avatar genérico' },
} as const;

export type PortraitProps = Readonly<{
  /** `null`/ausente → `GENERIC_APPEARANCE` (mismo aspecto neutro para todo jugador sin registro). */
  appearance?: AppearanceParams | null;
  /** Procedencia del aspecto; sin `appearance` se trata siempre como genérico. */
  appearanceSource?: 'hand_assigned' | 'generic';
  /** `null`/ausente → equipación neutra gris. */
  kit?: KitSpec | null;
  /** Dorsal de la fuente; `null` no dibuja dorsal (nunca se inventa). */
  number: string | null;
  size?: 'card' | 'medallion';
  /** Nombre del jugador para el nombre accesible. */
  label?: string;
  /** `false` omite el pie «Rasgos sin fuente» cuando quien lo usa ya muestra ese aviso en su propio chip. */
  note?: boolean;
}>;

/** Avatar estilizado (G05): busto para la ficha o medallón para alineaciones, con aviso accesible fijo. */
export function Portrait({ appearance, appearanceSource, kit, number, size = 'card', label, note = true }: PortraitProps) {
  const { locale } = useLanguage();
  const t = TEXT[locale === 'es' ? 'es' : 'en'];
  const prefix = `pt${useId()}`;
  const look = appearance ?? GENERIC_APPEARANCE;
  const generic = !appearance || appearanceSource !== 'hand_assigned';
  const svg = useMemo(() => portraitSvg({
    appearance: look, kit: kit ?? NEUTRAL_KIT, number, idPrefix: prefix, shape: size === 'medallion' ? 'medallion' : 'bust',
  }), [look, kit, number, prefix, size]);
  const ariaLabel = label ? `${label} · ${t.notice}` : t.notice;
  const title = generic ? t.generic : (size === 'medallion' ? t.handAssigned : undefined);
  return (
    <figure className={`tp-portrait tp-portrait--${size}`} data-appearance={generic ? 'generic' : 'hand_assigned'}>
      <div className="tp-portrait-art" role="img" aria-label={ariaLabel} title={title}
        dangerouslySetInnerHTML={{ __html: svg }} />
      {note && !generic && size === 'card' && <figcaption className="tp-portrait-note">{t.handAssigned}</figcaption>}
    </figure>
  );
}
