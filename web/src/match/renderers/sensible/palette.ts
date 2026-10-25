// Paleta indexada del estilo «Clásico 16 bits» (TP219). Arte propio de TimePitch: los sprites del atlas guardan un
// ÍNDICE por píxel (no un color) y esta tabla decide el color en tiempo de ejecución, de modo que una sola hoja de
// sprites sirve para cualquier equipación de temporada (camiseta, mangas, ribete, pantalón, medias), portero, árbitro,
// los 8 tonos de piel y los 6 colores de pelo. Pura y sin dependencias (la usan el generador en Node y el renderer).

export type Tone = 0 | 1 | 2; // 0 = luz, 1 = medio (color de la equipación), 2 = sombra

/** Roles con rampa de 3 tonos: índice = base + tono. */
export const RAMP_ROLES = Object.freeze({
  skin: 4, hair: 7, sleeveL: 10, sleeveR: 13, trim: 16, shorts: 19, socks: 22, boots: 25, gloves: 28,
} as const);
export type RampRole = keyof typeof RAMP_ROLES;

export const INDEX = Object.freeze({
  transparent: 0,
  /** Contorno exterior de 1 px. */
  outline: 1,
  /** Sombra de suelo (el renderer la pinta translúcida). */
  shadow: 2,
  /** Línea interior (separa brazo y torso, piernas cruzadas…). */
  inner: 3,
  ballWhite: 32, ballLight: 33, ballPanel: 34, ballPanelDark: 35,
  /** Escenario (fijos): banderín, red, postes y letra del marcador. */
  flag: 36, flagLight: 37, net: 38, netShade: 39, post: 40, postShade: 41, fontFill: 42, fontShade: 43,
  /** Tarjeta del árbitro (TP222): amarilla o roja según `look.card`. */
  card: 44,
  /** Camiseta: SHIRT + tono·16 + bits de zona (ver `SHIRT_BITS`). 64…111. */
  shirt: 64,
  /** Mangas con patrón (TP222): SLEEVE + lado·12 + tono·4 + bits (raya 1, aro 2). 208…231. */
  sleeve: 208,
});

/** Índice de un píxel de manga con patrón: lado 0 = izquierda, 1 = derecha. */
export const sleeveIndex = (side: 0 | 1, tone: Tone, bits: number) => INDEX.sleeve + side * 12 + tone * 4 + (bits & 3);

/**
 * Bits de zona de la camiseta. Cada píxel de camiseta lleva las cuatro marcas a la vez; el patrón de la temporada
 * elige qué bit pinta el color de acento (`trim`), así que rayas, aros, mitades y banda salen del mismo sprite.
 */
export const SHIRT_BITS = Object.freeze({ stripe: 1, hoop: 2, half: 4, sash: 8 } as const);

export const shirtIndex = (tone: Tone, bits: number) => INDEX.shirt + tone * 16 + (bits & 15);
export const rampIndex = (role: RampRole, tone: Tone) => RAMP_ROLES[role] + tone;

/** Colores fijos (no dependen de la equipación). */
export const FIXED_COLOURS = Object.freeze({
  outline: '#140c1c',
  inner: '#2a1c2e',
  shadow: '#0b1a0c',
  ballWhite: '#fcfcf4', ballLight: '#c4c8d4', ballPanel: '#30303c', ballPanelDark: '#14141c',
  flag: '#e2382a', flagLight: '#ffd23c', net: '#e6eaf0', netShade: '#9aa6b8', post: '#fbfbf6', postShade: '#aeb6c4',
  fontFill: '#fff6d8', fontShade: '#e8a838',
});

export const SKIN_HEX = Object.freeze({
  s1: '#f3d2b6', s2: '#e9c09f', s3: '#ddab86', s4: '#c8916a', s5: '#a8724d', s6: '#865437', s7: '#663f2a', s8: '#4c2e1f',
});
export const HAIR_HEX = Object.freeze({
  black: '#17110e', dkbrown: '#2d2018', brown: '#4f3526', ltbrown: '#7b5737', dkblond: '#a27d53', blond: '#c9a46a',
});

export type PatternFamily = 'plain' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'pinstripes' | 'side_panels' | 'unknown';

/** Subconjunto de `KitSpec` que necesita el estilo (se puede pasar un `KitSpec` tal cual). */
export type SensibleKit = Readonly<{
  shirt: string; sleeves: Readonly<{ left: string; right: string }>; shorts: string; socks: string; trim: string;
  /** Color del dorsal (`KitSpec.number`); si no contrasta con la camiseta se elige otro (`numberStyle`). */
  number?: string;
  pattern: Readonly<{ body: PatternFamily; sleeves?: PatternFamily }>;
}>;
/** `hairStyle`/`beard` (TP222) eligen qué zonas de la cabeza son pelo, piel o barba; `card`, el color de la tarjeta. */
export type SensibleLook = Readonly<{ skin: string; hair: string; boots: string; gloves?: string; hairStyle?: HeadStyle; beard?: BeardLevel; card?: string }>;

// ---------- Color: OKLab para rampas con desplazamiento de matiz ----------

type Rgb = [number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (c: Rgb) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const toLin = (c: number) => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const toSrgb = (c: number) => 255 * clamp01(c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055);

function oklab([r8, g8, b8]: Rgb): [number, number, number] {
  const r = toLin(r8), g = toLin(g8), b = toLin(b8);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3,
    s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [toSrgb(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s),
    toSrgb(-.0041960863 * l - .7034186147 * m + 1.707614701 * s)];
}

/** Luminosidad OKLab (0–1) de un color. */
export const lightness = (hex: string) => oklab(hexToRgb(hex))[0];

/** Mezcla lineal en sRGB (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map(i => x[i] + (y[i] - x[i]) * t) as Rgb);
}

/**
 * Rampa luz/medio/sombra a la manera del pixel art: la sombra baja la luminosidad y gira hacia azul-violeta, la luz
 * sube y gira hacia amarillo. Los blancos conservan el blanco como luz y los negros levantan la luz para que el
 * volumen se lea sobre el césped.
 */
export function ramp(hex: string, kit = false): [string, string, string] {
  const [L, a, b] = oklab(hexToRgb(hex));
  const C = Math.hypot(a, b);
  const shift = (dL: number, da: number, db: number, cScale: number): string => {
    const k = C > 1e-4 ? cScale : 1;
    return rgbToHex(fromOklab([clamp01(L + dL), a * k + da, b * k + db]));
  };
  if (L > .93) return ['#ffffff', shift(-.07, -.004, -.018, 1), shift(-.24, -.006, -.05, 1)];
  if (L < .36 && kit) {
    // TP220 pulido: un negro o un marino muy oscuro se fundía con el contorno (#140c1c, L ≈ .15) y el jugador quedaba
    // como una mancha. El tono medio sube hasta L ≥ .36 (sigue leyéndose negro/marino sobre el césped) y la sombra
    // queda por encima del contorno, así que la silueta separa del relleno.
    const lift = Math.max(0, .36 - L);
    return [shift(lift + .16, -.004, -.02, 1.1), lift > .005 ? shift(lift, 0, -.006, 1) : hex.toLowerCase(), shift(lift - .06, .002, -.012, 1)];
  }
  if (L < .3) return [shift(.17, -.004, -.02, 1.1), hex.toLowerCase(), shift(-.07, .002, -.012, 1)];
  const dark = Math.min(.19, L - .1);
  return [shift(.12, -.006, .028, .92), hex.toLowerCase(), shift(-dark, .008, -.04, 1.08)];
}

/** Qué bit de zona pinta el acento para cada patrón (`null` = liso). Pinstripes/side_panels → rayas/mitades. */
export function accentBit(pattern: PatternFamily): number | null {
  switch (pattern) {
    case 'stripes': case 'pinstripes': return SHIRT_BITS.stripe;
    case 'hoops': return SHIRT_BITS.hoop;
    case 'halves': case 'side_panels': return SHIRT_BITS.half;
    case 'sash': return SHIRT_BITS.sash;
    default: return null;
  }
}

/**
 * Tabla RGBA de 256 entradas (1024 bytes) para una equipación y un aspecto. El índice 0 es transparente; la sombra
 * de suelo lleva alfa 96. El resto de índices no usados quedan transparentes.
 */
const KIT_ROLES = new Set<RampRole>(['sleeveL', 'sleeveR', 'trim', 'shorts', 'socks']);

export function buildPaletteLUT(kit: SensibleKit, look: SensibleLook): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const put = (i: number, hex: string, alpha = 255) => {
    const [r, g, b] = hexToRgb(hex); lut[i * 4] = r; lut[i * 4 + 1] = g; lut[i * 4 + 2] = b; lut[i * 4 + 3] = alpha;
  };
  put(INDEX.outline, FIXED_COLOURS.outline); put(INDEX.inner, FIXED_COLOURS.inner); put(INDEX.shadow, FIXED_COLOURS.shadow, 96);
  put(INDEX.ballWhite, FIXED_COLOURS.ballWhite); put(INDEX.ballLight, FIXED_COLOURS.ballLight);
  put(INDEX.ballPanel, FIXED_COLOURS.ballPanel); put(INDEX.ballPanelDark, FIXED_COLOURS.ballPanelDark);
  for (const k of ['flag', 'flagLight', 'net', 'netShade', 'post', 'postShade', 'fontFill', 'fontShade'] as const) put(INDEX[k], FIXED_COLOURS[k]);
  const roles: Record<RampRole, string> = {
    skin: look.skin, hair: look.hair, sleeveL: kit.sleeves.left, sleeveR: kit.sleeves.right, trim: kit.trim,
    shorts: kit.shorts, socks: kit.socks, boots: look.boots, gloves: look.gloves ?? kit.trim,
  };
  for (const role of Object.keys(RAMP_ROLES) as RampRole[]) {
    const r = ramp(roles[role], KIT_ROLES.has(role));
    for (const t of [0, 1, 2] as Tone[]) put(rampIndex(role, t), r[t]);
  }
  const base = ramp(kit.shirt, true), accent = ramp(kit.trim, true), bit = accentBit(kit.pattern.body);
  for (const t of [0, 1, 2] as Tone[]) for (let bits = 0; bits < 16; bits++)
    put(shirtIndex(t, bits), bit !== null && (bits & bit) ? accent[t] : base[t]);
  // Mangas con patrón: solo rayas y aros tienen sentido en 2–3 px de manga (mitades o banda se quedan lisas).
  const sleeveBit = kit.pattern.sleeves === 'stripes' || kit.pattern.sleeves === 'pinstripes' ? SHIRT_BITS.stripe : kit.pattern.sleeves === 'hoops' ? SHIRT_BITS.hoop : 0;
  ([0, 1] as const).forEach(side => {
    const own = ramp(side ? kit.sleeves.right : kit.sleeves.left, true);
    for (const t of [0, 1, 2] as Tone[]) for (let bits = 0; bits < 4; bits++) put(sleeveIndex(side, t, bits), bits & sleeveBit ? accent[t] : own[t]);
  });
  // Cabeza: cada zona es pelo, piel o barba según el peinado (ver heads.ts).
  const style = look.hairStyle ?? 'crop', beard = look.beard ?? 'none';
  const hair = ramp(look.hair), skin = ramp(look.skin);
  // Engominado: la luz del pelo brilla más (es lo único que lo separa de un corto visto desde arriba).
  if (style === 'slick') hair[0] = mix(hair[0], '#ffffff', .28);
  const beardRamp = beard === 'none' ? skin : ramp(mix(look.skin, look.hair, BEARD_MIX[beard]));
  if (style === 'slick') put(rampIndex('hair', 0), hair[0]);
  HEAD_ZONES.forEach((_, z) => {
    const cls = zoneClass(z, style, beard), r = cls === 'hair' ? hair : cls === 'beard' ? beardRamp : skin;
    for (const t of [0, 1, 2] as Tone[]) put(headIndex(z, t), r[t]);
  });
  put(INDEX.card, look.card ?? CARD_HEX.yellow);
  return lut;
}

/** Tarjetas propias (amarilla y roja). */
export const CARD_HEX = Object.freeze({ yellow: '#ffd21c', red: '#e8202a' });

/**
 * Dorsal legible: el color del dorsal de la equipación si se separa al menos 0,3 de luminosidad (OKLab) de la
 * camiseta; si no, blanco sobre camiseta oscura o casi negro sobre clara. Con rayas, aros, mitades o banda se pone
 * una placa del color dominante detrás de las cifras (como en las camisetas reales), para que el patrón no las corte.
 */
export function numberStyle(kit: SensibleKit): Readonly<{ fill: string; plate: string | null }> {
  const shirtMid = ramp(kit.shirt, true)[1], L = lightness(shirtMid);
  const wanted = kit.number && /^#[0-9a-f]{6}$/i.test(kit.number) ? kit.number : kit.trim;
  const fill = Math.abs(lightness(wanted) - L) >= .3 ? wanted : L < .62 ? '#ffffff' : '#141018';
  const patterned = accentBit(kit.pattern.body) !== null;
  return { fill: fill.toLowerCase(), plate: patterned ? shirtMid : null };
}

/** Recolorea un búfer de índices (w·h) a RGBA con una tabla de `buildPaletteLUT`. */
export function applyPalette(indices: Uint8Array, lut: Uint8ClampedArray, out = new Uint8ClampedArray(indices.length * 4)) {
  for (let p = 0; p < indices.length; p++) {
    const i = indices[p] * 4, o = p * 4;
    out[o] = lut[i]; out[o + 1] = lut[i + 1]; out[o + 2] = lut[i + 2]; out[o + 3] = lut[i + 3];
  }
  return out;
}

/** Equipación del árbitro (propia: negro con ribete blanco). */
export const REFEREE_KIT: SensibleKit = Object.freeze({
  shirt: '#1b1b22', sleeves: { left: '#1b1b22', right: '#1b1b22' }, shorts: '#1b1b22', socks: '#1b1b22', trim: '#e8e8e8',
  pattern: { body: 'plain' as const },
});

/**
 * Equipaciones de árbitro propias (TP222): negra, amarilla y violeta, con ribete y pantalón propios. Se elige la que
 * más se separa (OKLab) de las camisetas del partido y del césped, como hace un árbitro de verdad cuando un equipo viste
 * de negro. (TP222, pulido 2: la verde azulada se cambió por violeta; sobre el césped apenas se distinguía.)
 */
export const REFEREE_KITS: readonly SensibleKit[] = Object.freeze([
  REFEREE_KIT,
  Object.freeze({ shirt: '#f2d21b', sleeves: { left: '#f2d21b', right: '#f2d21b' }, shorts: '#1b1b22', socks: '#1b1b22', trim: '#1b1b22', pattern: { body: 'plain' as const } }),
  Object.freeze({ shirt: '#7046c8', sleeves: { left: '#7046c8', right: '#7046c8' }, shorts: '#1b1b22', socks: '#7046c8', trim: '#1b1b22', pattern: { body: 'plain' as const } }),
]);
/** Tono medio del césped del estadio y de la Táctica: el árbitro también tiene que separarse de él. */
export const PITCH_GRASS = '#4a963c';

export function colourDistance(a: string, b: string): number {
  const x = oklab(hexToRgb(a)), y = oklab(hexToRgb(b));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function refereeKitFor(...teams: readonly SensibleKit[]): SensibleKit {
  let best = REFEREE_KITS[0], score = -1;
  for (const k of REFEREE_KITS) {
    const d = Math.min(colourDistance(k.shirt, PITCH_GRASS), ...teams.map(t => Math.min(colourDistance(k.shirt, t.shirt), colourDistance(k.shirt, t.trim) + .08)));
    if (d > score + 1e-9) { best = k; score = d; }
  }
  return best;
}

/** Cifras propias de 3×5 para dorsales (fila a fila, '1' = píxel). */
export const NUMBER_FONT: Readonly<Record<string, string>> = Object.freeze({
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001011001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
});

/** Colores de referencia con que se guarda el PNG del atlas (lo que se ve al abrirlo sin recolorear). */
export const PREVIEW_KIT: SensibleKit = Object.freeze({
  shirt: '#c8102e', sleeves: { left: '#c8102e', right: '#c8102e' }, shorts: '#f4f4f4', socks: '#c8102e', trim: '#f4f4f4',
  pattern: { body: 'plain' as const },
});
export const PREVIEW_LOOK: SensibleLook = Object.freeze({ skin: SKIN_HEX.s3, hair: HAIR_HEX.dkbrown, boots: '#111111', gloves: '#2fae5a' });

// ---------- Peinados y barba (TP222) ----------
// En este mismo fichero (sin imports) porque lo cargan tanto el generador en Node como la app: los dos calculan
// exactamente las mismas zonas.
//
// Idea: la cabeza mide 4×5 px. En vez de hornear diez cabezas por fotograma, cada píxel de la esfera de la cabeza
// guarda una ZONA (índice de paleta 112 + zona·3 + tono). La zona dice, para cada uno de los 10 peinados, si ese punto
// del cráneo es pelo o piel, y si cae en la zona de barba. La tabla de color de cada jugador (`buildPaletteLUT`) pinta
// la zona con pelo, piel o barba según su peinado: mismo sprite, cualquier peinado, en los 8 rumbos y en todas las
// poses, con la oclusión correcta (un brazo delante de la cabeza sigue delante).
//
// Lo que sobresale de la esfera (tupé, volumen rizado, melena y moño) no cabe en una paleta: va en capas
// `hair.<rasgo>.<anim>.<dir>.<frame>` que el renderer pinta encima del cuerpo (ver HAIR_FEATURE).

export const HEAD_STYLES = ['buzz', 'crop', 'short', 'side', 'slick', 'quiff', 'curly', 'long', 'tied', 'shaved'] as const;
export type HeadStyle = typeof HEAD_STYLES[number];
export type BeardLevel = 'none' | 'light' | 'stubble' | 'full';

/** Rasgo que sobresale del cráneo (capa aparte) para cada peinado. */
export const HAIR_FEATURE: Readonly<Partial<Record<HeadStyle, 'quiff' | 'curly' | 'long' | 'tied'>>> = Object.freeze({
  quiff: 'quiff', curly: 'curly', long: 'long', tied: 'tied',
});
export const HAIR_FEATURES = ['quiff', 'curly', 'long', 'tied'] as const;
export type HairFeature = typeof HAIR_FEATURES[number];

/** Primer índice de las zonas de cabeza; cada zona ocupa 3 (luz, medio, sombra). Caben 48 zonas (112…255). */
export const HEAD_BASE = 112;
export const HEAD_MAX_ZONES = 48;

type Line = Readonly<{ top: number; front: number; backY: number; nape: number; sides?: Readonly<{ x: number; z: number; y: number }> }>;
// Coordenadas locales de la cabeza sobre la esfera unidad: x a la derecha del jugador, y hacia la cara, z arriba.
// Línea del pelo: z > top + front·y (la frente queda más alta que las sienes y la nuca más baja). Con la cámara alta
// se ve sobre todo la coronilla, así que lo que distingue un peinado es dónde queda la frente, si baja por la nuca y
// si cubre las sienes; de frente se ven dos filas de cara.
const CROP: Line = { top: .1, front: .42, backY: .3, nape: -.48 };
const LINES: Readonly<Record<HeadStyle, Line>> = {
  shaved: CROP, buzz: CROP, crop: CROP, quiff: CROP,
  short: { top: .04, front: .3, backY: .25, nape: -.62, sides: { x: .74, z: -.3, y: .4 } },
  side: { top: .06, front: .3, backY: .25, nape: -.62, sides: { x: .74, z: -.3, y: .4 } },
  slick: { top: .2, front: .46, backY: .15, nape: -.74 },
  curly: { top: -.02, front: .3, backY: .05, nape: -.74, sides: { x: .66, z: -.45, y: .55 } },
  long: { top: .02, front: .34, backY: -.05, nape: -1, sides: { x: .6, z: -.85, y: .5 } },
  tied: { top: .12, front: .46, backY: .3, nape: -.58 },
};

export function isHair(style: HeadStyle, l: readonly number[]): boolean {
  const s = LINES[style];
  // Raya al lado: una línea de piel de 1 px que va de la frente a la coronilla, a la izquierda del jugador, y el
  // flequillo cae hacia su derecha.
  if (style === 'side' && Math.abs(l[0] + .36) < .11 && l[1] > -.2 && l[2] > .2) return false;
  const top = style === 'side' ? s.top + .12 - .3 * Math.max(0, Math.min(1, l[0] + .3)) : s.top;
  if (l[2] > top + s.front * l[1]) return true;
  if (l[1] < -s.backY && l[2] > s.nape) return true;
  return !!s.sides && Math.abs(l[0]) > s.sides.x && l[2] > s.sides.z && l[1] < s.sides.y;
}

/** 0 = sin barba, 1 = mentón y mandíbula, 2 = mejillas/patillas (solo con barba poblada o ligera). */
export function beardZone(l: readonly number[]): 0 | 1 | 2 {
  if (l[1] < .05) return 0;
  if (l[2] < -.42) return 1;
  if (l[2] < -.08 && Math.abs(l[0]) > .42) return 2;
  return 0;
}

/** Firma de un punto del cráneo: un bit de pelo por peinado (orden HEAD_STYLES) y la zona de barba en los bits 10–11. */
export function headSignature(l: readonly number[]): number {
  let sig = 0;
  HEAD_STYLES.forEach((style, i) => { if (isHair(style, l)) sig |= 1 << i; });
  return sig | (beardZone(l) << 10);
}

/** Zonas distintas que existen sobre la esfera (muestreo denso de Fibonacci, determinista y ordenado). */
export const HEAD_ZONES: readonly number[] = (() => {
  const seen = new Set<number>(), n = 24000, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - 2 * (i + .5) / n, r = Math.sqrt(1 - z * z), a = golden * i;
    seen.add(headSignature([r * Math.cos(a), r * Math.sin(a), z]));
  }
  const zones = [...seen].sort((a, b) => a - b);
  if (zones.length > HEAD_MAX_ZONES) throw new Error(`demasiadas zonas de cabeza: ${zones.length}`);
  return Object.freeze(zones);
})();

const ZONE_OF = new Map(HEAD_ZONES.map((sig, i) => [sig, i]));
const popcount = (v: number) => { let c = 0; while (v) { c += v & 1; v >>>= 1; } return c; };

/** Zona de una firma; si cae en una astilla que el muestreo no vio, la más parecida (determinista). */
export function zoneOf(sig: number): number {
  const z = ZONE_OF.get(sig);
  if (z !== undefined) return z;
  let best = 0, bestD = Infinity;
  HEAD_ZONES.forEach((s, i) => { const d = popcount(s ^ sig); if (d < bestD) { best = i; bestD = d; } });
  return best;
}

export const headIndex = (zone: number, tone: 0 | 1 | 2) => HEAD_BASE + zone * 3 + tone;

/** Qué se pinta en una zona para un peinado y una barba. */
export function zoneClass(zone: number, style: HeadStyle, beard: BeardLevel): 'hair' | 'skin' | 'beard' {
  const sig = HEAD_ZONES[zone];
  const i = HEAD_STYLES.indexOf(style);
  if (i >= 0 && sig & (1 << i)) return 'hair';
  const b = (sig >> 10) & 3;
  if (beard === 'none' || b === 0) return 'skin';
  if (b === 2 && beard === 'stubble') return 'skin'; // la sombra de barba no llega a las mejillas
  return 'beard';
}

/** Cuánto pelo hay en la barba (mezcla con la piel). A 1 px la sombra del retrato (≈ .24) no se vería: se sube. */
export const BEARD_MIX: Readonly<Record<Exclude<BeardLevel, 'none'>, number>> = Object.freeze({ stubble: .38, light: .58, full: .86 });

export const asHeadStyle = (value: unknown): HeadStyle => (HEAD_STYLES as readonly unknown[]).includes(value) ? value as HeadStyle : 'crop';
export const asBeard = (value: unknown): BeardLevel => value === 'light' || value === 'stubble' || value === 'full' ? value : 'none';
