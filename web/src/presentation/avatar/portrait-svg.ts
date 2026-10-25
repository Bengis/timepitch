// G05 · Retrato SVG estilizado (busto paramétrico), portado de `portraitBody`/`avatar`/`medallion` de la maqueta
// aprobada (.local/mockup/index.html l.498–585). Avatar estilizado propio, no un retrato ni una foto: el aspecto
// llega de `AppearanceParams` (asignado a mano en la demo o `GENERIC_APPEARANCE`) y la ropa de `KitSpec`.
// Cambios respecto a la maqueta:
//  - Todos los `id` llevan `idPrefix` y no hay referencias a `defs` globales (la maqueta usaba `url(#shade)` y un
//    contador global), así que varios retratos conviven en la misma página sin choques.
//  - Mandíbula, cejas, sonrisa, orejas y nariz quedan en valores neutros fijos: la maqueta los sorteaba con un hash
//    de equipo y dorsal, y la regla del proyecto es no derivar aspecto de nombres ni hashes.
//  - Se añade el tupé (`quiff`), que la maqueta solo tenía en 3D, y el cuello polo.
//  - Colores y textos se validan/escapan: la cadena se inyecta como HTML.
import { GENERIC_APPEARANCE, type AppearanceParams, type HairStyle, type KitSpec } from '../types';
import { EYE_COLOURS, HAIR_COLOURS, HAIR_STYLES, HEX_COLOUR, SKIN_TONES, mixHex, shadeHex } from './palette';

export type PortraitShape = 'bust' | 'medallion';

export type PortraitSvgInput = Readonly<{
  appearance: AppearanceParams;
  kit: KitSpec;
  number: string | null;
  /** Prefijo único por retrato (p. ej. de `useId`); se sanea a `[A-Za-z0-9_-]`. */
  idPrefix: string;
  shape?: PortraitShape;
}>;

/** Equipación neutra para jugadores sin equipación conocida (gris, sin colores de club). */
export const NEUTRAL_KIT: KitSpec = Object.freeze({
  shirt: '#5b6470', sleeves: Object.freeze({ left: '#5b6470', right: '#5b6470' }), shorts: '#3a4048', socks: '#3a4048',
  trim: '#d9dde3', number: '#ffffff', collar: 'crew',
  pattern: Object.freeze({ body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' }),
  source: Object.freeze({ kind: 'generic', licence: 'TimePitch' }),
});

const own = <T extends object>(table: T, key: unknown): key is keyof T =>
  typeof key === 'string' && Object.hasOwn(table, key);
const colour = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX_COLOUR.test(value) ? value : fallback;
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const safePrefix = (p: string) => {
  const s = p.replace(/[^A-Za-z0-9_-]/g, '');
  return /^[A-Za-z]/.test(s) ? s : `p${s}`;
};

const TOP = 44, CY = 157;
const JAW = 0, BROW = 0, SMILE = 1, EAR = 1, NOSE = 1; // neutros fijos (ver cabecera)

function hairFront(style: HairStyle, t: number): string {
  switch (style) {
    case 'buzz': case 'shaved': return `M60 100C56 ${t + 16} 76 ${t - 2} 100 ${t - 2}C124 ${t - 2} 144 ${t + 16} 140 100C138 88 134 80 128 76C116 71 84 71 72 76C66 80 62 88 60 100Z`;
    case 'crop': return `M58 102C51 ${t + 12} 74 ${t - 8} 100 ${t - 8}C126 ${t - 8} 149 ${t + 12} 142 102C140 88 136 80 131 75C122 77 112 71 100 72C88 71 78 77 69 75C64 80 60 90 58 102Z`;
    case 'short': return `M57 102C50 ${t + 10} 74 ${t - 10} 100 ${t - 10}C128 ${t - 10} 150 ${t + 10} 143 102C141 90 138 82 133 78L126 82L120 75L112 81L104 74L96 80L88 74L80 81L72 76L66 80C62 86 59 94 57 102Z`;
    case 'side': return `M57 100C50 ${t + 8} 74 ${t - 12} 102 ${t - 12}C132 ${t - 12} 152 ${t + 12} 143 100C141 86 137 78 132 74C118 70 104 65 92 71C80 74 70 74 66 80C61 86 59 92 57 100Z`;
    case 'slick': return `M57 102C48 ${t + 6} 70 ${t - 18} 102 ${t - 18}C134 ${t - 18} 152 ${t + 8} 143 102C141 86 138 76 132 70C120 63 84 62 70 70C63 76 59 88 57 102Z`;
    // Tupé: laterales cortos como `crop` y un volumen delantero levantado hacia la derecha.
    case 'quiff': return `M58 102C52 ${t + 14} 66 ${t - 4} 84 ${t - 12}C96 ${t - 30} 128 ${t - 30} 138 ${t - 10}C147 ${t + 6} 146 ${t + 30} 142 102C140 88 136 80 131 75C122 77 112 71 100 72C88 71 78 77 69 75C64 80 60 90 58 102Z`;
    case 'tied': return `M59 100C54 ${t + 14} 74 ${t - 4} 100 ${t - 4}C126 ${t - 4} 146 ${t + 14} 141 100C139 84 135 74 128 68C116 62 84 62 72 68C65 74 61 86 59 100Z`;
    case 'long': return `M57 106C50 ${t + 10} 74 ${t - 10} 100 ${t - 10}C126 ${t - 10} 150 ${t + 10} 143 106C138 84 128 70 104 66Q100 72 96 66C72 70 62 84 57 106Z`;
    case 'curly': return `M58 100C52 ${t + 12} 74 ${t - 6} 100 ${t - 6}C126 ${t - 6} 148 ${t + 12} 142 100C140 86 134 78 126 75C116 72 84 72 74 75C66 78 60 86 58 100Z`;
  }
}

function curls(): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 11; i++) {
    const a = Math.PI * (1.04 + .92 * i / 11);
    out.push([Number((100 + 46 * Math.cos(a)).toFixed(1)), Number((88 + 46 * Math.sin(a)).toFixed(1))]);
  }
  for (const p of [[84, 48], [100, 42], [116, 48], [72, 60], [128, 60], [92, 56], [108, 56]] as const) out.push([p[0], p[1]]);
  return out;
}

const BEARD_OPACITY = { stubble: [.24, .2], light: [.5, .45], full: [.92, .95] } as const;

type Parts = Readonly<{ defs: string; body: string }>;

function portraitParts(input: PortraitSvgInput, id: string): Parts {
  const a = input.appearance;
  const style: HairStyle = HAIR_STYLES.includes(a.hairStyle) ? a.hairStyle : GENERIC_APPEARANCE.hairStyle;
  const skin = own(SKIN_TONES, a.skin) ? SKIN_TONES[a.skin] : SKIN_TONES[GENERIC_APPEARANCE.skin];
  const hc = own(HAIR_COLOURS, a.hairColour) ? HAIR_COLOURS[a.hairColour] : HAIR_COLOURS[GENERIC_APPEARANCE.hairColour];
  const eyeC = own(EYE_COLOURS, a.eyes) ? EYE_COLOURS[a.eyes] : EYE_COLOURS[GENERIC_APPEARANCE.eyes];
  const beardLevel = own(BEARD_OPACITY, a.beard) ? a.beard : null;
  const k = input.kit;
  const sh = colour(k.shirt, NEUTRAL_KIT.shirt), trim = colour(k.trim, NEUTRAL_KIT.trim);
  const num = colour(k.number, NEUTRAL_KIT.number);

  const skD = shadeHex(skin, -30), skDD = shadeHex(skin, -58), skL = shadeHex(skin, 20);
  const hcL = shadeHex(hc, hc === HAIR_COLOURS.black ? 42 : 36);
  const browC = shadeHex(hc, hc === HAIR_COLOURS.blond || hc === HAIR_COLOURS.dkblond ? -40 : -4);
  const top = TOP, cy = CY, jx = 126 + JAW * 1.8;
  const face = `M60 98C60 60 78 ${top} 100 ${top}C122 ${top} 140 60 140 98C140 120 ${jx + 8} ${cy - 22} ${jx} ${cy - 10}C${jx - 8} ${cy} 110 ${cy + 2} 100 ${cy + 2}C90 ${cy + 2} ${208 - jx} ${cy} ${200 - jx} ${cy - 10}C${192 - jx} ${cy - 22} 60 120 60 98Z`;

  const collarKind = k.collar === 'v' ? 'v' : k.collar === 'polo' ? 'polo' : 'crew';
  const collar = collarKind === 'v'
    ? `<g data-part="collar" data-collar="v"><path d="M78 162L100 190L122 162" stroke="${trim}" stroke-width="6" fill="${shadeHex(skin, -40)}" stroke-linejoin="round"/><path d="M76 161L64 177L88 180Z M124 161L136 177L112 180Z" fill="${sh}" stroke="${trim}" stroke-width="2.4" stroke-linejoin="round"/></g>`
    : `<path data-part="collar" data-collar="${collarKind}" d="M80 164Q100 186 120 164" stroke="${trim}" stroke-width="7" fill="none" stroke-linecap="round"/>`
      + (collarKind === 'polo' ? `<path d="M80 164L72 180L94 178Z M120 164L128 180L106 178Z" fill="${sh}" stroke="${trim}" stroke-width="2.4" stroke-linejoin="round"/>` : '');

  // pelo detrás de la cabeza
  let back = '';
  if (style === 'tied') back = `<circle cx="100" cy="${top - 2}" r="15" fill="${hc}"/><circle cx="100" cy="${top - 2}" r="15" fill="url(#${id}h)" opacity=".5"/><path d="M90 ${top - 8}q10-8 20 0" stroke="${hcL}" stroke-width="2.4" fill="none" opacity=".5"/>`;
  if (style === 'long') back = `<path d="M54 96C46 50 74 30 100 30C126 30 154 50 146 96C150 128 150 156 140 174L124 168C130 150 138 120 136 100L64 100C62 120 70 150 76 168L60 174C50 156 50 128 54 96Z" fill="${shadeHex(hc, -8)}"/>`;
  const hairBack = back ? `<g data-part="hair-back">${back}</g>` : '';

  // barba
  let beard = '';
  if (beardLevel) {
    const [body, moustache] = BEARD_OPACITY[beardLevel];
    const bp = `M61 104C61 ${cy - 4} 82 ${cy + 6} 100 ${cy + 6}C118 ${cy + 6} 139 ${cy - 4} 139 104C136 122 129 132 119 135C113 132 106 131 100 131C94 131 87 132 81 135C71 132 64 122 61 104Z`;
    const must = 'M85 137Q100 129 115 137Q108 140.5 100 138.5Q92 140.5 85 137Z';
    beard = `<g data-part="beard" data-level="${beardLevel}" opacity="${body}"><g clip-path="url(#${id}fc)"><path d="${bp}" fill="${hc}"/></g>`
      + `<path d="${must}" fill="${hc}" opacity="${Math.min(1, moustache / body).toFixed(2)}"/>`
      + (beardLevel === 'full' ? `<path d="M70 132q30 26 60 0" stroke="${hcL}" stroke-width="1.6" fill="none" opacity=".27"/>` : '')
      + '</g>';
  }

  // ojos, cejas, nariz, boca
  const ey = 107;
  const eye = (cx: number) => `<ellipse cx="${cx}" cy="${ey}" rx="7.4" ry="4.5" fill="#f6f0e8"/><circle cx="${cx + .6}" cy="${ey + .3}" r="3.8" fill="${eyeC}"/><circle cx="${cx + .6}" cy="${ey + .3}" r="1.8" fill="#0b0807"/><circle cx="${cx + 1.9}" cy="${ey - 1.1}" r="1.1" fill="#fff" opacity=".9"/><path d="M${cx - 7.8} ${ey - .2}Q${cx} ${ey - 7} ${cx + 7.8} ${ey - .4}" stroke="${skDD}" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M${cx - 6} ${ey + 4.6}Q${cx} ${ey + 6.6} ${cx + 6} ${ey + 4.4}" stroke="${skD}" stroke-width="1.2" fill="none" opacity=".55"/>`;
  const bt = BROW * 1.3;
  const brows = `<path d="M71 96Q81 ${89 - bt * .4} 92 ${93 + bt}" stroke="${browC}" stroke-width="4.6" stroke-linecap="round" fill="none"/><path d="M129 96Q119 ${89 - bt * .4} 108 ${93 + bt}" stroke="${browC}" stroke-width="4.6" stroke-linecap="round" fill="none"/>`;
  const nw = NOSE;
  const nose = `<path d="M102 108C101 117 ${98 - nw} 123 ${96 - nw} 126" stroke="${skD}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".75"/><path d="M103 110L103 121" stroke="${skL}" stroke-width="2.4" opacity=".4" stroke-linecap="round"/><ellipse cx="100" cy="129" rx="${7.5 + nw}" ry="3.6" fill="${skD}" opacity=".28"/><path d="M${93 - nw} 127.5Q100 133.5 ${107 + nw} 127.5" stroke="${skDD}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".65"/>`;
  const mouth = `<path d="M88 142Q100 ${142.5 + SMILE * 1.4} 112 142" stroke="${mixHex(skDD, '#7a2f34', .35)}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M92 145.5Q100 149.5 108 145.5" stroke="${mixHex(skin, '#b0555a', .25)}" stroke-width="2.8" fill="none" stroke-linecap="round" opacity=".7"/>`;

  // pelo delantero
  const hf = hairFront(style, top);
  const curlPts = style === 'curly' ? curls() : [];
  const curlFill = curlPts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12.5"/>`).join('');
  const curlLines = curlPts.map(([x, y]) => `<path d="M${(x - 6).toFixed(1)} ${(y - 3).toFixed(1)}q6-6 12 0"/>`).join('');
  const hairOpacity = style === 'shaved' ? .3 : style === 'buzz' ? .82 : 1;
  const hair = `<g data-part="hair" data-hair="${style}">`
    + `<g clip-path="url(#${id}hd)"><path d="${hf}" transform="translate(0 4)" fill="#000" opacity=".16"/></g>`
    + `<g opacity="${hairOpacity}"><path d="${hf}" fill="${hc}"/>${curlFill ? `<g fill="${hc}">${curlFill}</g>` : ''}<path d="${hf}" fill="url(#${id}h)" opacity=".55"/></g>`
    + (style === 'shaved' || style === 'buzz' ? '' : `<path d="M74 ${top + 8}Q100 ${top - 8} 126 ${top + 8}" stroke="${hcL}" stroke-width="3.2" fill="none" opacity=".33" stroke-linecap="round"/>`)
    + (style === 'slick' || style === 'tied' ? `<path d="M80 ${top + 14}Q96 ${top - 6} 120 ${top - 2}M88 ${top + 22}Q104 ${top} 128 ${top + 6}" stroke="${hcL}" stroke-width="1.8" fill="none" opacity=".35"/>` : '')
    + (style === 'side' ? `<path d="M88 ${top - 8}Q85 ${top + 8} 90 ${top + 24}" stroke="${shadeHex(hc, -30)}" stroke-width="2" fill="none" opacity=".7"/>` : '')
    + (style === 'quiff' ? `<path d="M86 ${top - 8}Q104 ${top - 26} 134 ${top - 10}M94 ${top}Q110 ${top - 16} 136 ${top - 2}" stroke="${hcL}" stroke-width="2" fill="none" opacity=".4" stroke-linecap="round"/>` : '')
    + (curlLines ? `<g fill="none" stroke="${hcL}" stroke-width="1.6" opacity=".35">${curlLines}</g>` : '')
    + '</g><!--/hair-->';

  const numberText = input.number === null || input.number === ''
    ? ''
    : `<text data-part="number" x="138" y="214" font-family="Bahnschrift,Arial Narrow,sans-serif" font-weight="700" font-size="22" fill="${num}" text-anchor="middle" opacity=".95">${escapeXml(input.number)}</text>`;

  const defs = `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${shadeHex(sh, -44)}"/><stop offset=".42" stop-color="${sh}"/><stop offset=".78" stop-color="${shadeHex(sh, -12)}"/><stop offset="1" stop-color="${shadeHex(sh, -38)}"/></linearGradient>`
    + `<radialGradient id="${id}f" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="${skL}"/><stop offset=".55" stop-color="${skin}"/><stop offset="1" stop-color="${shadeHex(skin, -18)}"/></radialGradient>`
    + `<linearGradient id="${id}x" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".06"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".26"/></linearGradient>`
    + `<linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>`
    + `<clipPath id="${id}fc"><path d="${face}"/></clipPath><clipPath id="${id}hd"><path d="${face}"/></clipPath>`;

  const body = hairBack
    + `<path d="M84 ${cy - 30}L84 172Q100 184 116 172L116 ${cy - 30}Z" fill="${skD}"/>`
    + `<path d="M84 ${cy - 16}Q100 ${cy + 12} 116 ${cy - 16}L116 ${cy - 2}Q100 ${cy + 18} 84 ${cy - 2}Z" fill="${skDD}" opacity=".35"/>`
    + `<path data-part="shirt" d="M4 232C6 198 26 182 58 174L84 164Q100 176 116 164L142 174C174 182 194 198 196 232Z" fill="url(#${id}s)"/>`
    + `<path d="M58 174Q72 198 64 232M142 174Q128 198 136 232" stroke="${trim}" stroke-width="3" fill="none" opacity=".45"/>`
    + `<path d="M40 206Q52 218 48 232M160 206Q148 218 152 232" stroke="${shadeHex(sh, -36)}" stroke-width="3" fill="none" opacity=".35"/>`
    + collar
    + `<path d="M60 192h14v9c0 5-4 8-7 9-3-1-7-4-7-9z" fill="${trim}" opacity=".85"/>`
    + numberText
    + `<ellipse cx="59" cy="107" rx="${8 + EAR}" ry="13" fill="${skin}"/><path d="M60 100Q54 107 60 115" stroke="${skD}" stroke-width="2" fill="none"/>`
    + `<ellipse cx="141" cy="107" rx="${8 + EAR}" ry="13" fill="${shadeHex(skin, -10)}"/><path d="M140 100Q146 107 140 115" stroke="${skDD}" stroke-width="2" fill="none" opacity=".7"/>`
    + `<path d="${face}" fill="url(#${id}f)"/><path d="${face}" fill="url(#${id}x)"/>`
    + '<ellipse cx="78" cy="124" rx="9" ry="6" fill="#d0606a" opacity=".07"/><ellipse cx="122" cy="124" rx="9" ry="6" fill="#d0606a" opacity=".07"/>'
    + beard + eye(82) + eye(118) + brows + nose + mouth + hair;
  return { defs, body };
}

/**
 * Cadena `<svg>` del avatar estilizado. Función pura: misma entrada → mismo SVG. `bust` es el busto de la ficha
 * (viewBox 200×232); `medallion`, el medallón redondo de alineaciones y selectores.
 * El SVG va `aria-hidden`: el nombre accesible y el aviso los pone el contenedor (`<Portrait>`).
 */
export function portraitSvg(input: PortraitSvgInput): string {
  const id = safePrefix(input.idPrefix);
  const { defs, body } = portraitParts(input, id);
  if ((input.shape ?? 'bust') === 'bust') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 232" aria-hidden="true" focusable="false"><defs>${defs}</defs>${body}</svg>`;
  }
  const sh = colour(input.kit.shirt, NEUTRAL_KIT.shirt), trim = colour(input.kit.trim, NEUTRAL_KIT.trim);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="26 30 148 148" aria-hidden="true" focusable="false"><defs>${defs}`
    + `<radialGradient id="${id}bg" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="${shadeHex(sh, 40)}"/><stop offset="1" stop-color="${shadeHex(sh, -60)}"/></radialGradient>`
    + `<clipPath id="${id}c"><circle cx="100" cy="104" r="72"/></clipPath></defs>`
    + `<circle cx="100" cy="104" r="72" fill="url(#${id}bg)"/><g clip-path="url(#${id}c)">${body}</g>`
    + `<circle cx="100" cy="104" r="71" fill="none" stroke="${trim}" stroke-width="4" opacity=".9"/></svg>`;
}
