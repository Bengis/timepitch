// Textos del rótulo de anuncios y del marcador de emisión (EN por defecto, ES).
import { useLanguage } from '../i18n';
import type { AnnouncementKind } from '../match-centre/announcements/announcements';

type Titles = Readonly<Record<AnnouncementKind, string>>;

const en = {
  titles: {
    goal: 'GOAL', own_goal: 'OWN GOAL', penalty: 'PENALTY', shot_saved: 'SAVE', shot_blocked: 'BLOCKED',
    shot_off_target: 'OFF TARGET', yellow: 'YELLOW CARD', second_yellow: 'SECOND YELLOW', red: 'SENT OFF',
    substitution: 'SUBSTITUTION', foul: 'FOUL', offside: 'OFFSIDE', corner: 'CORNER',
    half_time: 'HALF-TIME', full_time: 'FULL TIME', kick_off: 'KICK-OFF',
  } as Titles,
  ownGoal: 'own goal', shotBy: (team: string) => `Shot by ${team}`, saved: 'saved',
  on: 'On', off: 'Off', minute: 'Minute',
  historicalEvent: 'Historical event · StatsBomb', syntheticAnimation: 'Synthetic animation',
  simulated: 'Simulated', engineEvent: 'Engine event',
  scoreboard: 'Scoreboard', unknownScore: 'score unknown',
  half: (period: number) => period === 1 ? '1st half' : period === 2 ? '2nd half' : period === 3 ? 'Extra time 1' : period === 4 ? 'Extra time 2' : `Period ${period}`,
  fullTime: 'Full time', live: 'Live',
  reds: (n: number) => n === 1 ? '1 red card' : `${n} red cards`,
  estimatedKits: 'Estimated kit colours', estimatedKitsNote: 'Kit choice estimated to avoid a colour clash',
  noCrest: 'Crest unavailable',
};
export type PresentationMessages = typeof en;

const es: PresentationMessages = {
  titles: {
    goal: 'GOL', own_goal: 'GOL EN PROPIA', penalty: 'PENALTI', shot_saved: 'PARADA', shot_blocked: 'BLOQUEADO',
    shot_off_target: 'FUERA', yellow: 'AMARILLA', second_yellow: 'SEGUNDA AMARILLA', red: 'EXPULSIÓN',
    substitution: 'CAMBIO', foul: 'FALTA', offside: 'FUERA DE JUEGO', corner: 'CÓRNER',
    half_time: 'DESCANSO', full_time: 'FINAL', kick_off: 'SAQUE INICIAL',
  },
  ownGoal: 'en propia puerta', shotBy: (team: string) => `Tiro de ${team}`, saved: 'atajado',
  on: 'Entra', off: 'Sale', minute: 'Minuto',
  historicalEvent: 'Evento histórico · StatsBomb', syntheticAnimation: 'Animación sintética',
  simulated: 'Simulado', engineEvent: 'Acontecimiento del motor',
  scoreboard: 'Marcador', unknownScore: 'marcador desconocido',
  half: (period: number) => period === 1 ? '1.ª parte' : period === 2 ? '2.ª parte' : period === 3 ? '1.ª prórroga' : period === 4 ? '2.ª prórroga' : `Periodo ${period}`,
  fullTime: 'Final', live: 'En directo',
  reds: (n: number) => n === 1 ? '1 tarjeta roja' : `${n} tarjetas rojas`,
  estimatedKits: 'Colores estimados', estimatedKitsNote: 'Equipación elegida por estimación para evitar un choque de colores',
  noCrest: 'Escudo no disponible',
};

export function usePresentationText(): PresentationMessages {
  const { locale } = useLanguage();
  return locale === 'es' ? es : en;
}
