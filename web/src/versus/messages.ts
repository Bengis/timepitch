// TP213 · Textos EN/ES de la pantalla VERSUS.
import { useLanguage } from '../i18n';
import { showPlayer } from '../catalog/fictional';

const ordinalEn = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const en = {
  region: 'Team select', home: 'Home', away: 'Away', vs: 'VS',
  change: (side: string) => `Change ${side.toLowerCase()} team`, choosing: 'Choosing',
  historical: 'Historical', estimated: 'Estimated', simulated: 'Simulated', fictional: 'Fictional',
  position: 'Position', points: 'Points', played: 'Played', record: 'W-D-L', goalsFor: 'Goals for', goalsAgainst: 'Goals against', goalDiff: 'Goal diff.',
  ordinal: (n: number, shared: boolean) => `${shared ? '=' : ''}${ordinalEn(n)}`, ofTeams: (n: number) => `of ${n}`,
  seasonSource: (src: string) => `Season by results · ${src}. 3 points per win, with official points deductions applied.`,
  deductionShort: (n: number) => `−${n} deducted`,
  deductionNote: (n: number, raw: number, reason: string) => `${n}-point deduction (${raw} points by results). ${reason}`,
  deductionSource: 'Deduction source',
  recordLoading: 'Loading season record…', recordFailed: 'Season record unavailable.',
  kit: (label: string) => `Kit ${label}`, kitSource: 'Kit source',
  star: 'Star player', starRule: 'Most goals + assists in the season (tiebreak: goals, minutes).',
  starRuleFpl: 'Most goals + assists (Fantasy definition) in the season (tiebreak: goals, minutes).',
  starFallback: 'Nobody scored or assisted: player with most minutes.',
  starUnavailable: 'Squad unavailable: no star player shown.',
  number: 'No.', nationality: 'Nationality', noCard: 'No player card', genericAvatar: 'Generic avatar',
  handAssigned: 'Unsourced features · assigned by hand',
  goals: 'Goals', assists: 'Assists', assistsFpl: 'Assists (FPL)', appearances: 'Apps', minutes: 'Minutes',
  GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward', unknownRole: 'Position not recorded',
  rivalry: 'Rivalry', rivalryRange: (from: string, to: string) => `Premier League ${from}–${to}`,
  meetings: (n: number) => `${n} ${n === 1 ? 'meeting' : 'meetings'}`, wins: (name: string) => `${name} wins`, draws: 'Draws',
  goals2: 'Goals', biggestWin: (name: string) => `${name}'s biggest win`, lastMeeting: 'Last meeting', none: 'None',
  neverMet: 'These clubs never met in the Premier League between 1992/93 and 2025/26.',
  h2hLoading: 'Loading head-to-head…', h2hFailed: 'Head-to-head unavailable.',
  crossEra: (a: string, b: string) => `Fictional cross-era match: ${a} against ${b}. The head-to-head is real between the clubs, not between these squads.`,
  sameSeason: (s: string) => 'Same season: both squads really played each other in ' + s + '.',
  ownHistory: 'A classic from its own history', ownHistoryNote: (club: string) => `${club} against itself, two seasons apart: a fictional match. Both season records are real.`,
  aiReport: 'Watch a sample match with its report written by AI',
  aiReportNote: 'Written after the match by AI agents on Azure AI Foundry',
  swap: 'Swap home and away', random: 'Random match',
  // TP248: las dos elecciones del partido, a la vista.
  engineTitle: 'Engine', graphicsTitle: 'Graphics', grfLabel: 'Realistic · 90 minutes', grfHint: 'Google Research Football',
  touchlinesLabel: 'Quick · arcade', touchlinesHint: 'TouchLines', retroLabel: 'Retro 16-bit', retroHint: 'Classic console look',
  threeLabel: '3D', threeHint: 'TV camera',
  sources: 'Source', play: 'Play match', playNext: 'Simulates now. Engine and line-ups: Advanced options below.',
  playWaiting: 'Choose both teams to continue.',
  pick: 'Choose a team', pickFor: (side: string) => `Choosing the ${side.toLowerCase()} team`,
  search: 'Search club or season', searchPlaceholder: 'Arsenal, Leicester, 2003…', era: 'Era', club: 'Club', allClubs: 'All clubs',
  season: 'Season', allSeasons: 'All seasons',
  eras: { all: 'All', '1990s': '1992–99', '2000s': '2000s', '2010s': '2010s', '2020s': '2020s' } as Record<string, string>,
  quick: 'Shortcuts', quickNote: 'Shortcuts only: the full catalogue is always available below.',
  results: (n: number, total: number) => `${n} of ${total} team-seasons`, noResults: 'No team-season matches these filters.',
  more: (n: number) => `Show more (${n} left)`, selected: 'selected',
  options: 'Tactics', moreDetails: 'More details', detailsNote: 'Historical data unless marked Estimated; each team lists its sources.',
  demoKicker: 'Featured demo', demoTitle: `${showPlayer('Thierry Henry')} vs ${showPlayer('Erling Haaland')}`, demoOpen: 'Watch the demo',
  prepare: 'Line-ups and seed', prepareNote: 'Play match uses them as set here.',
  // TP225: pantalla compacta; las tarjetas abren el selector.
  changeTeam: 'Change team', chooseTeam: 'Choose team', goalsForAgainst: 'GF-GA', pts: 'pts', kitShort: 'Kit',
  sourcesMore: 'Sources', seeMore: 'See more', seeLess: 'See less', close: 'Close',
  crossEraShort: 'Fictional cross-era match', sameSeasonShort: (s: string) => `Real meeting · ${s}`,
  pickKeys: 'Enter picks the first result · Esc closes', assistsCard: 'Assists',
};

type Text = { [K in keyof typeof en]: (typeof en)[K] };

const es: Text = {
  region: 'Selección de equipos', home: 'Local', away: 'Visitante', vs: 'VS',
  change: (side: string) => `Cambiar equipo ${side.toLowerCase()}`, choosing: 'Eligiendo',
  historical: 'Histórico', estimated: 'Estimado', simulated: 'Simulado', fictional: 'Ficticio',
  position: 'Posición', points: 'Puntos', played: 'Partidos', record: 'G-E-P', goalsFor: 'Goles a favor', goalsAgainst: 'Goles en contra', goalDiff: 'Diferencia',
  ordinal: (n: number, shared: boolean) => `${shared ? '=' : ''}${n}.º`, ofTeams: (n: number) => `de ${n}`,
  seasonSource: (src: string) => `Temporada según resultados · ${src}. 3 puntos por victoria, con las sanciones de puntos oficiales aplicadas.`,
  deductionShort: (n: number) => `−${n} sanción`,
  deductionNote: (n: number, raw: number, reason: string) => `Sanción de ${n} puntos (${raw} puntos por resultados). ${reason}`,
  deductionSource: 'Fuente de la sanción',
  recordLoading: 'Cargando balance de la temporada…', recordFailed: 'Balance de la temporada no disponible.',
  kit: (label: string) => `Equipación ${label}`, kitSource: 'Fuente de la equipación',
  star: 'Estrella', starRule: 'Más goles + asistencias de la temporada (desempate: goles, minutos).',
  starRuleFpl: 'Más goles + asistencias (definición Fantasy) de la temporada (desempate: goles, minutos).',
  starFallback: 'Nadie marcó ni asistió: jugador con más minutos.',
  starUnavailable: 'Plantilla no disponible: sin estrella.',
  number: 'Dorsal', nationality: 'Nacionalidad', noCard: 'Sin ficha', genericAvatar: 'Avatar genérico',
  handAssigned: 'Rasgos sin fuente · asignados a mano',
  goals: 'Goles', assists: 'Asistencias', assistsFpl: 'Asist. (FPL)', appearances: 'PJ', minutes: 'Minutos',
  GK: 'Portero', DEF: 'Defensa', MID: 'Centrocampista', FWD: 'Delantero', unknownRole: 'Posición sin registrar',
  rivalry: 'Rivalidad', rivalryRange: (from: string, to: string) => `Premier League ${from}–${to}`,
  meetings: (n: number) => `${n} ${n === 1 ? 'partido' : 'partidos'}`, wins: (name: string) => `Victorias ${name}`, draws: 'Empates',
  goals2: 'Goles', biggestWin: (name: string) => `Mayor victoria de ${name}`, lastMeeting: 'Último enfrentamiento', none: 'Ninguna',
  neverMet: 'Estos clubes no se enfrentaron en la Premier League entre 1992/93 y 2025/26.',
  h2hLoading: 'Cargando cara a cara…', h2hFailed: 'Cara a cara no disponible.',
  crossEra: (a: string, b: string) => `Partido ficticio entre épocas: ${a} contra ${b}. El historial es real entre los clubes, no entre estas plantillas.`,
  sameSeason: (s: string) => `Misma temporada: estas dos plantillas se enfrentaron de verdad en ${s}.`,
  ownHistory: 'Clásico de su propia historia', ownHistoryNote: (club: string) => `${club} contra sí mismo, en dos temporadas distintas: partido ficticio. Los dos balances son reales.`,
  aiReport: 'Ver un partido de ejemplo con su crónica escrita por IA',
  aiReportNote: 'La escriben agentes de IA en Azure AI Foundry, después del partido',
  swap: 'Cambiar local y visitante', random: 'Partido al azar',
  engineTitle: 'Motor', graphicsTitle: 'Gráficos', grfLabel: 'Realista · 90 minutos', grfHint: 'Google Research Football',
  touchlinesLabel: 'Rápido · arcade', touchlinesHint: 'TouchLines', retroLabel: 'Retro 16 bits', retroHint: 'Estilo de consola clásica',
  threeLabel: '3D', threeHint: 'Cámara de televisión',
  sources: 'Fuente', play: 'Jugar partido', playNext: 'Simula ya. Motor y alineaciones: Opciones avanzadas, abajo.',
  playWaiting: 'Elige los dos equipos para continuar.',
  pick: 'Elige equipo', pickFor: (side: string) => `Eligiendo equipo ${side.toLowerCase()}`,
  search: 'Buscar club o temporada', searchPlaceholder: 'Arsenal, Leicester, 2003…', era: 'Época', club: 'Club', allClubs: 'Todos los clubes',
  season: 'Temporada', allSeasons: 'Todas las temporadas',
  eras: { all: 'Todas', '1990s': '1992–99', '2000s': 'Años 2000', '2010s': 'Años 2010', '2020s': 'Años 2020' },
  quick: 'Atajos', quickNote: 'Solo atajos: el catálogo completo está siempre disponible debajo.',
  results: (n: number, total: number) => `${n} de ${total} equipos-temporada`, noResults: 'Ningún equipo-temporada coincide con estos filtros.',
  more: (n: number) => `Mostrar más (quedan ${n})`, selected: 'elegido',
  options: 'Táctica', moreDetails: 'Más detalles', detailsNote: 'Datos históricos salvo los marcados como Estimado; cada equipo indica sus fuentes.',
  demoKicker: 'Demo destacada', demoTitle: `${showPlayer('Thierry Henry')} contra ${showPlayer('Erling Haaland')}`, demoOpen: 'Ver la demo',
  prepare: 'Alineaciones y semilla', prepareNote: '«Jugar partido» las usa tal como estén aquí.',
  changeTeam: 'Cambiar equipo', chooseTeam: 'Elegir equipo', goalsForAgainst: 'GF-GC', pts: 'pts', kitShort: 'Equipación',
  sourcesMore: 'Fuentes', seeMore: 'Ver más', seeLess: 'Ver menos', close: 'Cerrar',
  crossEraShort: 'Partido ficticio entre épocas', sameSeasonShort: (s: string) => `Se enfrentaron de verdad · ${s}`,
  pickKeys: 'Intro elige el primero · Esc cierra', assistsCard: 'Asist.',
};

export type VersusText = Text;
export function useVersusText(): VersusText {
  const { locale } = useLanguage();
  return locale === 'es' ? es : en;
}

/** Nombre legible de las fuentes de resultados. */
export function resultsSourceName(source: string): string {
  return source === 'football-data' ? 'Football-Data.co.uk' : source === 'footballcsv' ? 'footballcsv' : source;
}
