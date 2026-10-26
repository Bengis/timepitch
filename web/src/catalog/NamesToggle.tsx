// TP259: interruptor de la liga ficticia, junto al de idioma. Cambiarlo guarda la preferencia y recarga la página.
import { useLanguage } from '../i18n';
import { namesMode, setNamesMode, type NamesMode } from './fictional';

const TEXT = {
  en: { group: 'Club and player names', fictional: 'Fictional league', real: 'Real names',
    hint: 'Fictional league: invented clubs and players with the same season statistics.' },
  es: { group: 'Nombres de clubes y jugadores', fictional: 'Liga ficticia', real: 'Nombres reales',
    hint: 'Liga ficticia: clubes y jugadores inventados con las mismas estadísticas de temporada.' },
} as const;

export function NamesToggle() {
  const { locale } = useLanguage();
  const t = TEXT[locale];
  const mode = namesMode();
  const pick = (next: NamesMode) => { if (next !== mode) setNamesMode(next); };
  return <div className="language-control names-toggle" role="group" aria-label={t.group} title={t.hint}>
    {(['fictional', 'real'] as const).map(value => <button key={value} type="button" className="names-option"
      aria-pressed={mode === value} onClick={() => pick(value)}>{t[value]}</button>)}
  </div>;
}
