// Lista de bloqueo de Capitán Hane (TP234): lo que la interfaz NUNCA debe usar como nombre de movimiento ni como
// nombre del modo. No se importa en tiempo de ejecución; la recorre `blocklist.test.ts` contra TODAS las
// combinaciones de `moves.ts` y contra las etiquetas del modo. Documentado en docs/kb/anime-cut-ins.md.
// Los créditos y el README sí nombran «Captain Tsubasa» como inspiración: eso es atribución, no uso.

/** Títulos de la serie y sus adaptaciones (EN, ES, IT, FR, JP romaji). */
export const SERIES_TITLES: readonly string[] = [
  'Captain Tsubasa', 'Capitán Tsubasa', 'Kyaputen Tsubasa', 'Oliver y Benji', 'Super Campeones', 'Supercampeones',
  'Campeones', 'Holly e Benji', 'Olive et Tom', 'Die Tollen Fussballstars',
];
/** Supertiros y técnicas conocidas de la serie y de los juegos de Tecmo (EN, ES, JP romaji). */
export const MOVE_NAMES: readonly string[] = [
  // Tsubasa / Oliver
  'Drive Shot', 'Tiro con efecto', 'Tiro Drive', 'Doraibu Shuto', 'Doraibu Shoot', 'Drive Tiger', 'Cyclone', 'Ciclon',
  'Saikuron', 'Overhead Kick', 'Chilena', 'Banana Shot', 'Banana Shuto', 'Heel Lift', 'Sky Wing Shot',
  // Hyuga / Mark Lenders
  'Tiger Shot', 'Tiro del tigre', 'Disparo del tigre', 'Chut del tigre', 'Taiga Shotto', 'Taiga Shuto', 'Neo Tiger Shot',
  'Raiju Shot', 'Raiju Shuto', 'Tiro del rayo salvaje',
  // Tachibana / gemelos Derrick
  'Skylab Hurricane', 'Sukairabu Harikein', 'Sukairabu Hariken', 'Catapulta infernal', 'Catapulta', 'Twin Shot',
  'Tiro combinado', 'Tsuin Shuto', 'Ataque combinado',
  // otros jugadores
  'Eagle Shot', 'Tiro del aguila', 'Iguru Shotto', 'Razor Shot', 'Kamisori Shuto', 'Kamisori Tackle', 'Falcon Volley',
  'Hayabusa Volley', 'Hayabusa Bore', 'Fire Shot', 'Faiya Shotto', 'Mirage Shot', 'Golden Combi', 'Goruden Konbi',
  'Combinacion dorada', 'Jumping Volley', 'Dynamite Header', 'Clone Shot', 'Rolling Overhead',
];
/** Palabras distintivas de esos nombres: ni siquiera sueltas (el animal o el objeto delataría la copia). */
export const DISTINCTIVE_WORDS: readonly string[] = [
  'TIGER', 'TIGRE', 'TAIGA', 'EAGLE', 'AGUILA', 'FALCON', 'HALCON', 'HAYABUSA', 'CATAPULT', 'CATAPULTA', 'SKYLAB',
  'DRIVE', 'CYCLONE', 'CICLON', 'RAZOR', 'NAVAJA', 'KAMISORI', 'RAIJU', 'BANANA', 'MIRAGE', 'ESPEJISMO', 'TWIN',
  'GEMELO', 'GEMELA', 'COMBI', 'GOLDEN', 'DORADA', 'DORADO', 'HURRICANE', 'INFERNAL', 'TSUBASA',
];
/** Personajes (nombre original y doblajes). */
export const CHARACTER_NAMES: readonly string[] = [
  'Ozora', 'Oliver Atom', 'Oliver Hutton', 'Hyuga', 'Hyuuga', 'Mark Lenders', 'Steve Hyuga', 'Kojiro', 'Wakabayashi',
  'Benji Price', 'Genzo', 'Misaki', 'Tom Baker', 'Ben Becker', 'Tachibana', 'Derrick', 'Wakashimazu', 'Ed Warner',
  'Misugi', 'Julian Ross', 'Schneider', 'Roberto Hongo', 'Sedinho', 'Matsuyama', 'Philip Callahan', 'Nitta', 'Soda',
  'Ishizaki', 'Bruce Harper', 'Carlos Santana', 'Natureza', 'Juan Diaz',
];
/** Apodos de clubes y selecciones (en plural o como lema): ni marca ni apodo, solo lugares. */
export const TEAM_NICKNAMES: readonly string[] = [
  'Gunners', 'Citizens', 'Cityzens', 'Red Devils', 'Diablos Rojos', 'Toffees', 'Magpies', 'Saints', 'Hammers', 'Irons',
  'Wolves', 'Foxes', 'Spurs', 'Lilywhites', 'Blues', 'Reds', 'Villans', 'Eagles', 'Seagulls', 'Bees', 'Cherries',
  'Canaries', 'Owls', 'Blades', 'Terriers', 'Bantams', 'Swans', 'Bluebirds', 'Black Cats', 'Potters', 'Baggies',
  'Throstles', 'Clarets', 'Hornets', 'Royals', 'Rams', 'Tractor Boys', 'Pompey', 'Addicks', 'Trotters', 'Tigers',
  'Latics', 'Hatters', 'Cottagers', 'Tricky Trees', 'Sky Blues', 'Pensioners', 'Lions', 'Three Lions', 'Les Bleus',
  'Selecao', 'Canarinha', 'Oranje', 'Super Eagles', 'Black Stars', 'Elephants', 'Pharaohs', 'Desert Foxes',
  'Reggae Boyz', 'Indomitable', 'Teranga', 'Galacticos', 'Invincibles',
];
/** Lemas publicitarios o eslóganes ligados a jugadores reales. */
export const SLOGANS: readonly string[] = ['Va va voom', 'Vavavoom', 'Impossible is nothing', 'Just do it', 'Joga bonito'];

export const ALL_BLOCKED: readonly string[] = [...SERIES_TITLES, ...MOVE_NAMES, ...DISTINCTIVE_WORDS, ...CHARACTER_NAMES, ...TEAM_NICKNAMES, ...SLOGANS];

/** Mayúsculas, sin tildes, y cualquier cosa que no sea letra o cifra como un solo espacio. */
export function normalizeForBlocklist(text: string): string {
  return ` ${text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
}
/** Términos bloqueados que aparecen como palabras completas dentro de `text`. */
export function blockedTermsIn(text: string, terms: readonly string[] = ALL_BLOCKED): string[] {
  const hay = normalizeForBlocklist(text);
  return terms.filter(term => hay.includes(normalizeForBlocklist(term)));
}
