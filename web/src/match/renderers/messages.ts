import { useLanguage } from '../../i18n';

const en = {
  graphics: 'Graphics', style3d: '3D · players in relief, TV camera', styleRetro16: '2D · classic 16-bit console look',
  // TP234: nombre del modo en UNA sola clave (cambiarlo es una línea). Guiño: hane (羽, pluma) frente a tsubasa (翼, alas).
  styleAnime: 'Captain Hane',
  animeFictional: 'Fictional dramatisation',
  animeIntro: 'Captain Hane: fictional dramatisation. Key moments the engine recorded get an anime scene; the result is always the recorded one. All art, move names and sounds are original TimePitch code.',
  animeIntroClose: 'Got it',
  animeScenes: 'Anime scenes', animeAll: 'All', animeGoals: 'Goals only', animeNone: 'None',
  animeHelp: 'Captain Hane: the match is drawn in Retro 16-bit. Recorded goals, shots with a recorded outcome and tackles that win the ball pause playback for a short anime scene (goals only above 5×, none above 20×). Click or press any key to skip. Move names are invented by TimePitch and are not quotes from any real player. Abilities only change how a scene looks, never what happened.',
  animeReady: 'Captain Hane ready (Retro 16-bit play with anime scenes).',
  fallbackRetro16: 'Retro 16-bit graphics unavailable on this device. Showing a simplified 2D view at the same match position.', retryRetro16: 'Retry Retro 16-bit',
  lighting: 'Lighting', daylight: 'Daylight', floodlights: 'Floodlights',
  detail: 'Detail', standard: 'Standard', low: 'Low', loading: 'Loading 3D graphics… The current view remains available.',
  ready: '3D graphics ready.', fallback: '3D graphics unavailable on this device. Showing a simplified 2D view at the same match position.',
  failed: 'Graphics unavailable. Match controls and analysis remain available.', retry: 'Retry 3D', loadingRetro16: 'Loading Retro 16-bit graphics… The current view remains available.', help: 'About the graphics',
  limitations: 'Illustrative kits and animations. The ball stays at pitch level because these frames have no validated altitude. Graphics do not change match events or positions.',
  retro16Ready: 'Retro 16-bit graphics ready. The referee and assistants are illustrative: the engine does not record them.',
  limitationsRetro16: 'Retro 16-bit: original TimePitch pixel art. Shirt numbers appear only for identified players (match source or reviewed player card); none is invented. The referee and assistants are placed by fixed rules from the recorded ball and players; they whistle, flag or show a card only for a recorded event. The Tactical view is its own pixel layer at whole-number scale.',
};
const es: typeof en = {
  graphics: 'Gráficos', style3d: '3D · jugadores en relieve, cámara de televisión', styleRetro16: '2D · estilo clásico de consola de 16 bits',
  styleAnime: 'Capitán Hane',
  animeFictional: 'Dramatización ficticia',
  animeIntro: 'Capitán Hane: dramatización ficticia. Los momentos clave que grabó el motor tienen escena anime; el resultado es siempre el grabado. Todo el arte, los nombres de los movimientos y los sonidos son código original de TimePitch.',
  animeIntroClose: 'Entendido',
  animeScenes: 'Escenas anime', animeAll: 'Todas', animeGoals: 'Solo goles', animeNone: 'Ninguna',
  animeHelp: 'Capitán Hane: el partido se dibuja en Retro 16 bits. Los goles grabados, los tiros con resultado grabado y las entradas que ganan el balón pausan la reproducción para una breve escena anime (por encima de 5× solo goles; por encima de 20×, ninguna). Un clic o cualquier tecla la salta. Los nombres de los movimientos los inventa TimePitch y no son frases de ningún jugador real. Las habilidades solo cambian cómo se ve una escena, nunca lo que pasó.',
  animeReady: 'Capitán Hane listo (juego Retro 16 bits con escenas anime).',
  fallbackRetro16: 'Gráficos Retro 16 bits no disponibles en este equipo. Mostrando una vista 2D simplificada en el mismo instante del partido.', retryRetro16: 'Reintentar Retro 16 bits',
  lighting: 'Iluminación', daylight: 'Día', floodlights: 'Focos',
  detail: 'Detalle', standard: 'Normal', low: 'Bajo', loading: 'Cargando gráficos 3D… La vista actual sigue disponible.',
  ready: 'Gráficos 3D listos.', fallback: 'Gráficos 3D no disponibles en este equipo. Mostrando una vista 2D simplificada en el mismo instante del partido.',
  failed: 'Gráficos no disponibles. Los controles y el análisis siguen disponibles.', retry: 'Reintentar 3D', loadingRetro16: 'Cargando gráficos Retro 16 bits… La vista actual sigue disponible.', help: 'Sobre los gráficos',
  limitations: 'Equipaciones y animaciones ilustrativas. El balón permanece sobre el campo porque estos frames no tienen altura validada. Los gráficos no cambian los eventos ni las posiciones del partido.',
  retro16Ready: 'Gráficos Retro 16 bits listos. Árbitro y asistentes son ilustrativos: el motor no los registra.',
  limitationsRetro16: 'Retro 16 bits: pixel art propio de TimePitch. Los dorsales solo salen en jugadores identificados (fuente del partido o ficha revisada); no se inventa ninguno. Árbitro y asistentes se colocan con reglas fijas a partir del balón y los jugadores grabados; pitan, levantan el banderín o enseñan tarjeta solo con un evento grabado. La vista Táctica es una capa propia en píxel a escala entera.',
};
/** Para pruebas (p. ej. la lista de bloqueo del nombre del modo, TP234). */
export const GRAPHICS_TEXT = { en, es } as const;
export function useGraphicsText() { return useLanguage().locale === 'es' ? es : en; }
