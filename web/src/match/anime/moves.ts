// Nombres de «supertiro» de Capitán Hane (TP234): ORIGINALES, deterministas por jugador y localizados (EN/ES).
// Tema por la nacionalidad deportiva de la ficha (la misma que muestra la ficha del jugador) y sabor por posición:
// delanteros con palabras de potencia o velocidad, porteros de muro o ala, defensas de escudo o ancla. Sin ficha ni
// nacionalidad cubierta: lista neutra. Las palabras son propias y genéricas (paisajes, fenómenos, oficios,
// mitología solo como palabra común: «Thor» sí, nada de cómics). Ninguna sale de un juego, serie, club, anuncio ni
// eslogan ligado a un jugador: lo vigila `blocklist.ts` con una prueba que recorre TODAS las combinaciones.
// El nombre es solo el grito del movimiento: nunca una frase ni una opinión atribuida al jugador real.
import type { Locale } from '../../i18n';

export type Gender = 'm' | 'f';
/** A = ataque (delantero), M = medio, D = defensa, K = portero. */
export type MoveRole = 'A' | 'M' | 'D' | 'K';
type Noun = Readonly<{ en: string; es: string; g: Gender; roles: string }>;
/** Calificativo: en inglés delante (`pre`, «NORTHERN HAMMER») o detrás (`post`, «THUNDER OF THOR»). */
type Tag = Readonly<{ pre?: string; post?: string; es: string | Readonly<{ m: string; f: string }> }>;
type Theme = Readonly<{ nouns: readonly Noun[]; tags: readonly Tag[] }>;

const n = (en: string, es: string, g: Gender, roles: string): Noun => ({ en, es, g, roles });
const adj = (pre: string, m: string, f = m): Tag => ({ pre, es: { m, f } });
const of = (post: string, es: string): Tag => ({ post, es });

export const THEMES = {
  nordic: { nouns: [n('THUNDER', 'TRUENO', 'm', 'A'), n('HAMMER', 'MARTILLO', 'm', 'AD'), n('STORM', 'TORMENTA', 'f', 'AM'),
    n('AURORA', 'AURORA', 'f', 'MK'), n('FJORD', 'FIORDO', 'm', 'DK'), n('GLACIER', 'GLACIAR', 'm', 'DK')],
    tags: [adj('NORTHERN', 'DEL NORTE'), of('OF THOR', 'DE THOR'), of('OF THE FJORDS', 'DE LOS FIORDOS'), adj('POLAR', 'POLAR')] },
  france: { nouns: [n('ARROW', 'FLECHA', 'f', 'A'), n('SILK', 'SEDA', 'f', 'AM'), n('MISTRAL', 'MISTRAL', 'm', 'AM'),
    n('BASTION', 'BASTIÓN', 'm', 'DK'), n('LANTERN', 'LINTERNA', 'f', 'MK')],
    tags: [adj('AZURE', 'AZUR'), of('OF PARIS', 'DE PARÍS'), of('OF THE SEINE', 'DEL SENA'), of('OF PROVENCE', 'DE PROVENZA')] },
  brazil: { nouns: [n('SAMBA', 'SAMBA', 'f', 'AM'), n('GOLD', 'ORO', 'm', 'AMK'), n('JAGUAR', 'JAGUAR', 'm', 'AD'),
    n('CAPOEIRA', 'CAPOEIRA', 'f', 'MD')],
    tags: [of('OF RIO', 'DE RÍO'), of('OF THE AMAZON', 'DEL AMAZONAS'), adj('TROPICAL', 'TROPICAL')] },
  england: { nouns: [n('OAK', 'ROBLE', 'm', 'DKM'), n('LION', 'LEÓN', 'm', 'AD'), n('CASTLE', 'CASTILLO', 'm', 'DK'),
    n('TIDE', 'MAREA', 'f', 'AM')],
    tags: [of('OF THE THAMES', 'DEL TÁMESIS'), of('OF DOVER', 'DE DOVER'), of('OF THE PENNINES', 'DE LOS PENINOS'), of('OF THE MOORS', 'DE LOS PÁRAMOS')] },
  celtic: { nouns: [n('STAG', 'CIERVO', 'm', 'AM'), n('GALE', 'VENDAVAL', 'm', 'A'), n('STONE', 'PIEDRA', 'f', 'DK'), n('MIST', 'BRUMA', 'f', 'MK')],
    tags: [of('OF THE HIGHLANDS', 'DE LAS TIERRAS ALTAS'), of('OF THE GLENS', 'DE LAS CAÑADAS'), of('OF SNOWDON', 'DEL SNOWDON')] },
  iberia: { nouns: [n('LYNX', 'LINCE', 'm', 'AM'), n('CARAVEL', 'CARABELA', 'f', 'M'), n('LIGHTHOUSE', 'FARO', 'm', 'DK'), n('SIROCCO', 'SIROCO', 'm', 'A')],
    tags: [adj('IBERIAN', 'IBÉRICO', 'IBÉRICA'), of('OF THE ATLANTIC', 'DEL ATLÁNTICO'), of('OF THE SIERRA', 'DE LA SIERRA')] },
  lowlands: { nouns: [n('WINDMILL', 'MOLINO', 'm', 'MA'), n('DYKE', 'DIQUE', 'm', 'DK'), n('GALE', 'VENDAVAL', 'm', 'A')],
    tags: [of('OF THE DELTA', 'DEL DELTA'), of('OF THE POLDERS', 'DE LOS PÓLDERES'), of('OF THE NORTH SEA', 'DEL MAR DEL NORTE')] },
  germanic: { nouns: [n('AVALANCHE', 'ALUD', 'm', 'AD'), n('GLACIER', 'GLACIAR', 'm', 'DK'), n('STEEL', 'ACERO', 'm', 'DM')],
    tags: [adj('ALPINE', 'ALPINO', 'ALPINA'), of('OF THE RHINE', 'DEL RIN'), of('OF THE BLACK FOREST', 'DE LA SELVA NEGRA')] },
  italy: { nouns: [n('VOLCANO', 'VOLCÁN', 'm', 'A'), n('MARBLE', 'MÁRMOL', 'm', 'DK'), n('MOSAIC', 'MOSAICO', 'm', 'M')],
    tags: [of('OF VESUVIUS', 'DEL VESUBIO'), of('OF THE TIBER', 'DEL TÍBER'), adj('VOLCANIC', 'VOLCÁNICO', 'VOLCÁNICA')] },
  latam: { nouns: [n('CONDOR', 'CÓNDOR', 'm', 'AK'), n('PAMPERO', 'PAMPERO', 'm', 'A'), n('TANGO', 'TANGO', 'm', 'M'), n('ANDES ROCK', 'ROCA ANDINA', 'f', 'DK')],
    tags: [of('OF THE ANDES', 'DE LOS ANDES'), of('OF THE PAMPAS', 'DE LA PAMPA'), of('OF THE RIVER PLATE', 'DEL RÍO DE LA PLATA')] },
  westAfrica: { nouns: [n('BAOBAB', 'BAOBAB', 'm', 'DK'), n('HARMATTAN', 'HARMATÁN', 'm', 'AM'), n('DRUM', 'TAMBOR', 'm', 'M'), n('LIGHTNING', 'RAYO', 'm', 'A')],
    tags: [of('OF THE NIGER', 'DEL NÍGER'), of('OF THE SAVANNAH', 'DE LA SABANA'), of('OF THE GULF', 'DEL GOLFO')] },
  northAfrica: { nouns: [n('SIROCCO', 'SIROCO', 'm', 'AM'), n('OASIS', 'OASIS', 'm', 'DK'), n('DUNE', 'DUNA', 'f', 'D')],
    tags: [of('OF THE NILE', 'DEL NILO'), of('OF THE SAHARA', 'DEL SÁHARA'), of('OF THE ATLAS', 'DEL ATLAS')] },
  caribbean: { nouns: [n('REEF', 'ARRECIFE', 'm', 'DK'), n('WAVE', 'OLA', 'f', 'AM'), n('TRADE WIND', 'ALISIO', 'm', 'A')],
    tags: [of('OF THE CARIBBEAN', 'DEL CARIBE'), adj('TROPICAL', 'TROPICAL')] },
  neutral: { nouns: [n('ORCA', 'ORCA', 'f', 'D'), n('TIDE', 'MAREA', 'f', 'M'), n('STORM', 'TORMENTA', 'f', 'A')],
    tags: [adj('ELECTRIC', 'ELÉCTRICO', 'ELÉCTRICA'), adj('SUPERSONIC', 'SUPERSÓNICO', 'SUPERSÓNICA'), adj('UNSTOPPABLE', 'IMPARABLE'),
      adj('MIDNIGHT', 'DE MEDIANOCHE'), adj('SPIRAL', 'EN ESPIRAL')] },
} as const satisfies Readonly<Record<string, Theme>>;
export type ThemeId = keyof typeof THEMES;

/** Sabor por posición, común a todos los temas. */
export const ROLE_NOUNS: Readonly<Record<MoveRole, readonly Noun[]>> = {
  A: [n('COMET', 'COMETA', 'm', 'A'), n('METEOR', 'METEORO', 'm', 'A'), n('LIGHTNING', 'RAYO', 'm', 'A')],
  M: [n('COMPASS', 'BRÚJULA', 'f', 'M'), n('ENGINE', 'MOTOR', 'm', 'M')],
  D: [n('SHIELD', 'ESCUDO', 'm', 'D'), n('ANCHOR', 'ANCLA', 'f', 'D'), n('RAMPART', 'BALUARTE', 'm', 'D')],
  K: [n('WALL', 'MURALLA', 'f', 'K'), n('WING', 'ALA', 'f', 'K'), n('FORTRESS', 'FORTALEZA', 'f', 'K')],
};

/** Nacionalidad deportiva de la ficha (nombre inglés de Wikidata) → tema. Lo no cubierto va a `neutral`. */
const NATIONS: Readonly<Record<string, ThemeId>> = {
  norway: 'nordic', sweden: 'nordic', denmark: 'nordic', iceland: 'nordic', finland: 'nordic', 'faroe islands': 'nordic',
  france: 'france', brazil: 'brazil', england: 'england', 'united kingdom': 'england',
  scotland: 'celtic', wales: 'celtic', ireland: 'celtic', 'republic of ireland': 'celtic', 'northern ireland': 'celtic',
  spain: 'iberia', portugal: 'iberia', netherlands: 'lowlands', belgium: 'lowlands',
  germany: 'germanic', austria: 'germanic', switzerland: 'germanic', italy: 'italy',
  argentina: 'latam', uruguay: 'latam', colombia: 'latam', ecuador: 'latam', chile: 'latam', paraguay: 'latam', peru: 'latam',
  mexico: 'latam', venezuela: 'latam', bolivia: 'latam',
  nigeria: 'westAfrica', ghana: 'westAfrica', 'ivory coast': 'westAfrica', "côte d'ivoire": 'westAfrica', senegal: 'westAfrica',
  cameroon: 'westAfrica', 'burkina faso': 'westAfrica', 'the gambia': 'westAfrica', gambia: 'westAfrica', mali: 'westAfrica',
  guinea: 'westAfrica', togo: 'westAfrica', 'sierra leone': 'westAfrica', liberia: 'westAfrica',
  egypt: 'northAfrica', algeria: 'northAfrica', morocco: 'northAfrica', tunisia: 'northAfrica', libya: 'northAfrica',
  jamaica: 'caribbean', 'trinidad and tobago': 'caribbean', 'curaçao': 'caribbean', barbados: 'caribbean', haiti: 'caribbean',
};
/** «Brazil / Portugal» → la primera, que es la que muestra la ficha delante. */
export function themeFor(nation: string | null | undefined): ThemeId {
  const first = (nation ?? '').split('/')[0].trim().toLowerCase();
  return Object.hasOwn(NATIONS, first) ? NATIONS[first] : 'neutral';
}
/** Posición de la ficha (`FW`/`MF`/`DF`/`GK`) o rol del motor (`GK`, `DEF`, `forward`…); desconocida → `null`. */
export function roleFor(position: string | null | undefined): MoveRole | null {
  const p = (position ?? '').trim().toLowerCase();
  if (/^(gk|goalkeeper|keeper|portero|por)$/.test(p)) return 'K';
  if (/^(df|def|defender|defensa|cb|lb|rb|lcb|rcb|lwb|rwb|sw)$/.test(p)) return 'D';
  if (/^(mf|mid|midfielder|medio|centrocampista|cm|dm|am|cdm|cam|lm|rm)$/.test(p)) return 'M';
  if (/^(fw|fwd|forward|delantero|st|cf|lw|rw|ss|striker|winger)$/.test(p)) return 'A';
  return null;
}

/** FNV-1a de 32 bits: estable entre navegadores y Node, sin dependencias. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export type MoveIdentity = Readonly<{
  /** QID revisado si hay ficha (mismo movimiento en cualquier partido o motor); si no, la clave del jugador. */
  seedKey: string;
  nation?: string | null;
  position?: string | null;
}>;
type Pick = Readonly<{ noun: Noun; tag: Tag }>;

/** Bolsa de sustantivos: los del tema que encajan con la posición (con doble peso) + los de la posición. */
function nounPool(theme: ThemeId, role: MoveRole | null): Noun[] {
  const own = (THEMES[theme].nouns as readonly Noun[]).filter(x => role === null || x.roles.includes(role));
  const roleNouns = role ? ROLE_NOUNS[role] : [...ROLE_NOUNS.A, ...ROLE_NOUNS.M, ...ROLE_NOUNS.D, ...ROLE_NOUNS.K];
  return [...own, ...own, ...roleNouns];
}
function pick(identity: MoveIdentity): Pick {
  const theme = themeFor(identity.nation), role = roleFor(identity.position);
  const nouns = nounPool(theme, role), tags = THEMES[theme].tags as readonly Tag[];
  const h = hashKey(identity.seedKey);
  return { noun: nouns[h % nouns.length], tag: tags[(h >>> 11) % tags.length] };
}
function render({ noun, tag }: Pick, locale: Locale): string {
  if (locale === 'es') return `${noun.es} ${typeof tag.es === 'string' ? tag.es : tag.es[noun.g]}`;
  return tag.pre ? `${tag.pre} ${noun.en}` : `${noun.en} ${tag.post}`;
}
export function moveNameFor(identity: MoveIdentity, locale: Locale): string { return render(pick(identity), locale); }

/** Todos los nombres posibles en un idioma (para la prueba de la lista de bloqueo y la doc). */
export function allMoveNames(locale: Locale): string[] {
  const out = new Set<string>();
  for (const theme of Object.keys(THEMES) as ThemeId[])
    for (const role of ['A', 'M', 'D', 'K', null] as const)
      for (const noun of nounPool(theme, role)) for (const tag of THEMES[theme].tags as readonly Tag[]) out.add(render({ noun, tag }, locale));
  return [...out];
}
/** Todas las palabras sueltas de las listas (EN y ES). */
export function allMoveWords(): string[] {
  const nouns = [...Object.values(THEMES).flatMap(t => t.nouns as readonly Noun[]), ...Object.values(ROLE_NOUNS).flat()];
  const tags = Object.values(THEMES).flatMap(t => t.tags as readonly Tag[]);
  return [...nouns.flatMap(x => [x.en, x.es]), ...tags.flatMap(t => [t.pre ?? t.post ?? '', ...(typeof t.es === 'string' ? [t.es] : [t.es.m, t.es.f])])];
}
