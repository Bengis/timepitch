import { useLanguage } from '../i18n';
import { defineTexts } from '../i18n-catalog';
const en = {
  match: 'Match', summary: 'Summary', players: 'Players', maps: 'Maps', effort: 'Effort', data: 'Data',
  back: 'Back', download: 'Export replay', play: 'Play', pause: 'Pause', replay: 'Replay', speed: 'Speed', phase: 'Phase', position: 'Match position', matchClock: 'Match clock', playbackTime: 'Playback',
  reveal: 'Reveal final analysis', revealed: 'Final analysis revealed', final: 'Final · independent of playback', cursor: 'At statistics cutoff',
  synthetic: 'Synthetic movement', anchors: 'Recorded anchors', cuts: 'Discontinuities', historical: 'Recorded events · synthetic tracking, not measured player movement',
  simulated: 'Simulated match · recorded engine output', movement: 'Movement', missing: 'Unavailable', loading: 'Loading', buffering: 'Buffering — playback is waiting for data', retry: 'Retry data read',
  events: 'Events', eventType: 'Event type', all: 'All', team: 'Team', player: 'Player', home: 'Home', away: 'Away', unknown: 'Unknown',
  watch: 'Watch event', refs: 'Source references', details: 'Details', previous: 'Previous', next: 'Next', empty: 'No data at this cursor',
  sourceWindow: 'Browse source window', from: 'From (seconds in phase)', to: 'To (seconds in phase)', browse: 'Read window (up to 60 s)', manual: 'Manual source window · independent of playback',
  metric: 'Metric', value: 'Value', subject: 'Subject', definition: 'Definition', provenance: 'Provenance', availability: 'Availability', search: 'Filter metrics',
  group: 'Metric group', detail: 'Player detail', close: 'Close player detail', role: 'Recorded role', jersey: 'Shirt number', intervals: 'Participation intervals', attributes: 'Estimated input attributes',
  tracking: 'No measured tracking — historical distance, speed and effort are unavailable.', scope: 'Scope', coordinate: 'Coordinates', equivalent: 'Equivalent data table',
  plotFilter: 'Filter map rows', plotTeam: 'Map team', plotPlayer: 'Map player', plotPhase: 'Map phase',
  source: 'Source', sourceKinds: { recorded: 'Engine recording', grf: 'GRF simulation', timepitch: 'TimePitch simulation', historical: 'Historical data' } as Record<string, string>, clock: 'Source clock', elapsed: 'Playback elapsed', native: 'Recorded observations', layers: 'Additional layers',
  off: 'Local window explanations are unavailable for this source.', comparison: 'Compare with an existing owned simulation',
  standouts: 'Notable performances', finalResult: 'Final result', noMotion: 'Movement is unavailable; source facts remain accessible.',
  noClock: 'Source clock unavailable', records: 'records', page: 'Page', error: 'Could not read data. Retry explicitly.',
  route: 'Recorded action route', routeNote: 'Source action endpoints in canonical metres; this is not continuous tracking.',
  milestones: 'Reached milestones', ambiguousGraph: 'Node positions are ambiguous across phases. All source links and positions remain in the equivalent data table.', schematic: 'Schematic node layout',
  analysisScope:'Analysis scope', eventSet:'Event set', resolvedActions:'Resolved actions',
  explicitExplanation: 'Explanations require an explicit request; playback never generates them.',
  screens: { broadcast: 'Live broadcast', card: 'Player card', lineups: 'Line-ups' }, analysisGroup: 'Analysis',
  pickPlayer: 'Choose a player on the pitch, in the timeline or in the line-ups to open their card.',
  // TP239: textos de la pantalla del partido en lenguaje llano.
  newMatch: 'New match', simulatedWith: (engine: string) => `Fictional match · ${engine}`,
  technical: 'Technical details', allMetrics: 'All metrics (technical)', teamStats: 'Match stats',
  noStatsYet: 'No stats yet: they fill in as the match is played.', mapEmpty: 'Nothing to draw yet at this point of the match.', asTable: 'View as table',
  plotTitles: { shots: 'Shot map', xg: 'xG through the match', actions: 'Action map', pass_network: 'Passing network', occupancy: 'Heat map', occupancy_1: 'Heat map · 1st half', occupancy_2: 'Heat map · 2nd half', effort: 'Effort', average_positions: 'Average positions', team_shape: 'Team shape' } as Record<string, string>,
};
type Text = { [K in keyof typeof en]: (typeof en)[K] };
const es: Text = {
  match: 'Partido', summary: 'Resumen', players: 'Jugadores', maps: 'Mapas', effort: 'Esfuerzo', data: 'Datos',
  back: 'Volver', download: 'Exportar reproducción', play: 'Reproducir', pause: 'Pausar', replay: 'Repetir', speed: 'Velocidad', phase: 'Fase', position: 'Posición del partido', matchClock: 'Reloj del partido', playbackTime: 'Reproducción',
  reveal: 'Mostrar análisis final', revealed: 'Análisis final visible', final: 'Final · independiente de la reproducción', cursor: 'Corte de las estadísticas',
  synthetic: 'Movimiento sintético', anchors: 'Anclajes registrados', cuts: 'Discontinuidades', historical: 'Eventos registrados · tracking sintético, sin movimiento medido de los jugadores',
  simulated: 'Partido simulado · salida registrada del motor', movement: 'Movimiento', missing: 'No disponible', loading: 'Cargando', buffering: 'Esperando datos — reproducción en pausa', retry: 'Reintentar lectura de datos',
  events: 'Eventos', eventType: 'Tipo de evento', all: 'Todos', team: 'Equipo', player: 'Jugador', home: 'Local', away: 'Visitante', unknown: 'Desconocido',
  watch: 'Ver jugada', refs: 'Referencias de origen', details: 'Detalles', previous: 'Anterior', next: 'Siguiente', empty: 'Sin datos en este instante',
  sourceWindow: 'Explorar intervalo de la fuente', from: 'Desde (segundos de la fase)', to: 'Hasta (segundos de la fase)', browse: 'Leer intervalo (hasta 60 s)', manual: 'Intervalo manual · independiente de la reproducción',
  metric: 'Métrica', value: 'Valor', subject: 'Sujeto', definition: 'Definición', provenance: 'Procedencia', availability: 'Disponibilidad', search: 'Filtrar métricas',
  group: 'Grupo de métricas', detail: 'Ficha de jugador', close: 'Cerrar ficha de jugador', role: 'Posición registrada', jersey: 'Dorsal', intervals: 'Intervalos de participación', attributes: 'Atributos de entrada estimados',
  tracking: 'Sin tracking medido — distancia, velocidad y esfuerzo históricos no disponibles.', scope: 'Ámbito', coordinate: 'Coordenadas', equivalent: 'Tabla de datos equivalente',
  plotFilter: 'Filtrar filas del mapa', plotTeam: 'Equipo del mapa', plotPlayer: 'Jugador del mapa', plotPhase: 'Fase del mapa',
  source: 'Fuente', sourceKinds: { recorded: 'Grabación del motor', grf: 'Simulación GRF', timepitch: 'Simulación TimePitch', historical: 'Datos históricos' }, clock: 'Reloj de la fuente', elapsed: 'Tiempo de reproducción', native: 'Observaciones registradas', layers: 'Capas adicionales',
  off: 'Las explicaciones locales por ventanas no están disponibles para esta fuente.', comparison: 'Comparar con una simulación propia existente',
  standouts: 'Actuaciones destacadas', finalResult: 'Resultado final', noMotion: 'Movimiento no disponible; los datos registrados siguen accesibles.',
  noClock: 'Reloj de la fuente no disponible', records: 'registros', page: 'Página', error: 'No se han podido leer los datos. Reintenta expresamente.',
  route: 'Trayectoria registrada de la acción', routeNote: 'Extremos de la acción en metros canónicos; no es tracking continuo.',
  milestones: 'Hitos alcanzados', ambiguousGraph: 'Las posiciones de los nodos son ambiguas entre fases. Los enlaces y posiciones originales se conservan en la tabla equivalente.', schematic: 'Distribución esquemática de nodos',
  analysisScope:'Ámbito del análisis', eventSet:'Conjunto de eventos', resolvedActions:'Acciones resueltas',
  explicitExplanation: 'Las explicaciones requieren una solicitud explícita; reproducir nunca las genera.',
  screens: { broadcast: 'Emisión en directo', card: 'Ficha de jugador', lineups: 'Alineaciones' }, analysisGroup: 'Análisis',
  pickPlayer: 'Elige un jugador en el campo, la cronología o las alineaciones para abrir su ficha.',
  newMatch: 'Nuevo partido', simulatedWith: (engine: string) => `Partido ficticio · ${engine}`,
  technical: 'Detalles técnicos', allMetrics: 'Todas las métricas (técnico)', teamStats: 'Estadísticas del partido',
  noStatsYet: 'Aún no hay estadísticas: se van llenando según avanza el partido.', mapEmpty: 'Todavía no hay nada que dibujar en este momento del partido.', asTable: 'Ver como tabla',
  plotTitles: { shots: 'Mapa de tiros', xg: 'xG a lo largo del partido', actions: 'Mapa de acciones', pass_network: 'Red de pases', occupancy: 'Mapa de calor', occupancy_1: 'Mapa de calor · 1.ª parte', occupancy_2: 'Mapa de calor · 2.ª parte', effort: 'Esfuerzo', average_positions: 'Posiciones medias', team_shape: 'Forma del equipo' } as Record<string, string>,
};
const TEXTS = defineTexts('player', { en, es });
export const usePlayerText = () => TEXTS(useLanguage().locale);
export function matchTime(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
