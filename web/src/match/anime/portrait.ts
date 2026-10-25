// Primer plano anime de Capitán Hane (TP234), generado por código como SVG a partir de los rasgos del avatar
// estilizado que ya tiene el jugador (peinado, color de pelo, tono de piel, ojos, barba) y de su equipación y dorsal.
// Ojos grandes, pelo agitado por el viento y sombreado plano «cel». Sin imágenes ni trazos copiados de ninguna
// serie: formas paramétricas propias. El dorsal solo si se conoce (nunca se inventa). Lienzo de 400 × 400.
import { GENERIC_APPEARANCE, type AppearanceParams, type HairStyle, type KitSpec } from '../../presentation/types';
import { EYE_COLOURS, HAIR_COLOURS, HEX_COLOUR, SKIN_TONES, mixHex, shadeHex } from '../../presentation/avatar/palette';
import { letterPath } from './letters';

export type Figure = Readonly<{ appearance: AppearanceParams; kit: KitSpec; number: string | null; name: string }>;
export type PortraitMood = 'shout' | 'grit';

const INK = '#140d12';
const own = <T extends object>(table: T, key: unknown): key is keyof T => typeof key === 'string' && Object.hasOwn(table, key);
export const safeColour = (value: unknown, fallback: string) => typeof value === 'string' && HEX_COLOUR.test(value) ? value : fallback;
export const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export const safeId = (p: string) => { const s = p.replace(/[^A-Za-z0-9_-]/g, ''); return /^[A-Za-z]/.test(s) ? s : `a${s}`; };
const f = (v: number) => +v.toFixed(1);

type HairSpec = Readonly<{ spikes: number; len: number; sweep: number; bangs: number; bangDepth: number; flow?: 'long' | 'tail'; quiff?: boolean; curly?: boolean; cap?: number }>;
const HAIR: Readonly<Record<HairStyle, HairSpec>> = {
  shaved: { spikes: 0, len: 0, sweep: 0, bangs: 0, bangDepth: 0, cap: 0.22 },
  buzz: { spikes: 0, len: 0, sweep: 0, bangs: 0, bangDepth: 0, cap: 1 },
  crop: { spikes: 9, len: 22, sweep: 0.28, bangs: 5, bangDepth: 18 },
  short: { spikes: 11, len: 32, sweep: 0.36, bangs: 6, bangDepth: 30 },
  side: { spikes: 8, len: 28, sweep: 0.62, bangs: 4, bangDepth: 34 },
  slick: { spikes: 7, len: 20, sweep: 0.95, bangs: 0, bangDepth: 0 },
  quiff: { spikes: 7, len: 24, sweep: 0.4, bangs: 3, bangDepth: 14, quiff: true },
  curly: { spikes: 13, len: 16, sweep: 0.1, bangs: 6, bangDepth: 16, curly: true },
  tied: { spikes: 8, len: 20, sweep: 0.85, bangs: 2, bangDepth: 22, flow: 'tail' },
  long: { spikes: 10, len: 34, sweep: 0.5, bangs: 6, bangDepth: 38, flow: 'long' },
};
const CX = 200, CY = 175, R = 92;

/**
 * Pelo: un casquete por detrás del cráneo más mechones en punta, cada uno su propio triángulo, barridos por el viento
 * hacia la izquierda. Se pinta dos veces (trazo grueso debajo, relleno encima) para que solo se vea el contorno exterior.
 */
function hairBack(h: HairSpec): string {
  if (!h.spikes) return '';
  const at = (a: number, r: number) => `${f(CX + r * Math.cos(a))} ${f(CY + r * Math.sin(a))}`;
  const parts = [`M${at(Math.PI * 0.94, R - 2)}A${R + 10} ${R + 10} 0 0 1 ${at(Math.PI * 0.06, R - 2)}Z`];
  const a0 = Math.PI * 0.98, a1 = Math.PI * 2.02;
  for (let i = 0; i < h.spikes; i++) {
    const t0 = a0 + (a1 - a0) * i / h.spikes, t1 = a0 + (a1 - a0) * (i + 1) / h.spikes, mid = (t0 + t1) / 2, width = t1 - t0;
    const len = h.len * (0.8 + 0.45 * ((i * 7919) % 5) / 4) + (h.quiff && i === Math.floor(h.spikes * 0.62) ? 60 : 0);
    const tip = mid - Math.min(h.sweep * 0.45, width * 1.6);
    if (h.curly) { parts.push(`M${at(t0 - width * 0.2, R - 8)}Q${at(mid, R + len * 2.1)} ${at(t1 + width * 0.2, R - 8)}Z`); continue; }
    parts.push(`M${at(t0 - width * 0.35, R - 12)}L${at(tip, R + 6 + len)}L${at(t1 + width * 0.35, R - 12)}Z`);
  }
  if (h.flow === 'long') parts.push(`M${CX - 92} ${CY + 10}C${CX - 140} ${CY + 80} ${CX - 150} ${CY + 150} ${CX - 196} ${CY + 186}L${CX - 120} ${CY + 150}L${CX - 150} ${CY + 210}L${CX - 70} ${CY + 130}L${CX - 76} ${CY + 40}Z`,
    `M${CX + 92} ${CY + 10}C${CX + 104} ${CY + 80} ${CX + 92} ${CY + 130} ${CX + 70} ${CY + 160}L${CX + 66} ${CY + 60}Z`);
  if (h.flow === 'tail') parts.push(`M${CX - 60} ${CY - 74}C${CX - 130} ${CY - 116} ${CX - 170} ${CY - 66} ${CX - 196} ${CY - 98}C${CX - 180} ${CY - 44} ${CX - 140} ${CY - 34} ${CX - 196} ${CY + 2}C${CX - 130} ${CY - 8} ${CX - 100} ${CY - 30} ${CX - 64} ${CY - 40}Z`);
  return parts.join('');
}
/** Flequillo: puntas hacia abajo sobre la frente, también barridas. */
function bangs(h: HairSpec): string {
  if (!h.bangs) return '';
  const left = CX - 88, right = CX + 88, top = CY - 64, pts = [`M${left} ${CY - 10}`, `L${left + 4} ${top}`];
  for (let i = 0; i < h.bangs; i++) {
    const x0 = left + (right - left) * i / h.bangs, x1 = left + (right - left) * (i + 1) / h.bangs;
    const depth = h.bangDepth * (0.7 + 0.3 * ((i * 31) % 3) / 2);
    if (h.curly) { pts.push(`Q${f((x0 + x1) / 2)} ${f(top + depth * 1.6)} ${f(x1)} ${top}`); continue; }
    pts.push(`L${f(x0 + (x1 - x0) * (0.2 - h.sweep * 0.4))} ${f(top + depth + 10)}`, `L${f(x1)} ${top + 4}`);
  }
  pts.push(`L${right - 2} ${top - 4}`, `L${right} ${CY - 6}`, `C${right - 8} ${CY - 90} ${left + 8} ${CY - 90} ${left} ${CY - 10}Z`);
  return pts.join('');
}

function eye(cx: number, flip: 1 | -1, iris: string, id: string): string {
  const w = 34, white = `M${cx - w} ${f(204)}C${cx - w + 6} ${f(176)} ${cx + w - 6} ${f(170)} ${cx + w} ${f(196)}C${cx + w - 10} ${f(232)} ${cx - w + 10} ${f(236)} ${cx - w} ${f(204)}Z`;
  const ix = cx + flip * 5;
  return `<path d="${white}" fill="#fbfbff" stroke="${INK}" stroke-width="2"/>`
    + `<g clip-path="url(#${id})"><ellipse cx="${ix}" cy="205" rx="17" ry="24" fill="${iris}" stroke="${INK}" stroke-width="2"/>`
    + `<path d="M${ix - 17} 200C${ix - 12} 180 ${ix + 12} 180 ${ix + 17} 200Z" fill="${shadeHex(iris, -45)}"/>`
    + `<ellipse cx="${ix}" cy="207" rx="8" ry="12" fill="${INK}"/>`
    + `<circle cx="${ix - 6}" cy="196" r="5.5" fill="#fff"/><circle cx="${ix + 6}" cy="216" r="2.6" fill="#fff"/></g>`
    + `<path d="M${cx - w - 6} ${f(198)}C${cx - w + 8} ${f(170)} ${cx + w - 4} ${f(164)} ${cx + w + 6} ${f(190 + flip * 0)}L${cx + w - 2} ${f(198)}C${cx + w - 12} ${f(178)} ${cx - w + 10} ${f(180)} ${cx - w - 2} ${f(206)}Z" fill="${INK}"/>`;
}

/**
 * Primer plano (busto). `mood`: `shout` grita el movimiento con la boca abierta; `grit` aprieta los dientes.
 * `idPrefix` hace únicos los `id` internos (varios retratos en la misma página o SVG).
 */
export function animePortrait(fig: Figure, idPrefix: string, mood: PortraitMood = 'shout'): string {
  const id = safeId(idPrefix), a = fig.appearance ?? GENERIC_APPEARANCE;
  const skin = own(SKIN_TONES, a.skin) ? SKIN_TONES[a.skin] : SKIN_TONES[GENERIC_APPEARANCE.skin];
  const hairC = own(HAIR_COLOURS, a.hairColour) ? HAIR_COLOURS[a.hairColour] : HAIR_COLOURS[GENERIC_APPEARANCE.hairColour];
  const irisC = own(EYE_COLOURS, a.eyes) ? EYE_COLOURS[a.eyes] : EYE_COLOURS[GENERIC_APPEARANCE.eyes];
  const style: HairStyle = own(HAIR, a.hairStyle) ? a.hairStyle : GENERIC_APPEARANCE.hairStyle;
  const h = HAIR[style];
  const shirt = safeColour(fig.kit?.shirt, '#5b6470'), trim = safeColour(fig.kit?.trim, '#d9dde3'), numberC = safeColour(fig.kit?.number, '#ffffff');
  const shade = shadeHex(skin, -38), hairHi = mixHex(hairC, '#ffffff', hairC === HAIR_COLOURS.black ? 0.28 : 0.36), hairLo = shadeHex(hairC, -26);
  const head = `M108 170C108 92 292 92 292 170L287 224C279 264 240 300 200 310C160 300 121 264 113 224Z`;
  const clipEyes = `<clipPath id="${id}-el"><path d="M126 204C132 176 188 170 194 196C184 232 136 236 126 204Z"/></clipPath>`
    + `<clipPath id="${id}-er"><path d="M206 196C212 170 268 176 274 204C264 236 216 232 206 196Z"/></clipPath>`
    + `<clipPath id="${id}-torso"><path d="M14 470L24 400C34 336 112 316 168 314L232 314C288 316 366 336 376 400L386 470Z"/></clipPath>`;
  const pattern = fig.kit?.pattern?.body;
  const stripes = pattern === 'stripes' || pattern === 'pinstripes'
    ? [0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${40 + i * 50}" y="300" width="${pattern === 'pinstripes' ? 6 : 22}" height="180" fill="${trim}"/>`).join('')
    : pattern === 'hoops' ? [0, 1, 2, 3].map(i => `<rect x="0" y="${336 + i * 34}" width="400" height="15" fill="${trim}"/>`).join('')
    : pattern === 'halves' ? `<rect x="200" y="300" width="200" height="180" fill="${trim}"/>` : '';
  const num = fig.number && /^[0-9]{1,2}$/.test(fig.number) ? letterPath(fig.number) : null;
  const numberSvg = num ? `<g transform="translate(${f(262 - num.width * 2.4)} 326) scale(4.8) skewX(-6)"><path d="${num.d}" fill="none" stroke="${INK}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="${num.d}" fill="none" stroke="${numberC}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></g>` : '';
  const beardC = a.beard === 'full' ? hairC : a.beard === 'light' ? hairLo : null;
  const beard = a.beard === 'stubble'
    ? `<path d="M124 232C134 270 168 300 200 306C232 300 266 270 276 232C262 262 236 286 200 290C164 286 138 262 124 232Z" fill="${hairC}" opacity=".28"/>`
    : beardC ? `<path d="M118 222C124 268 164 304 200 312C236 304 276 268 282 222C268 256 250 270 230 278C218 272 182 272 170 278C150 270 132 256 118 222Z" fill="${beardC}" stroke="${INK}" stroke-width="2" opacity="${a.beard === 'full' ? 1 : .75}"/>` : '';
  const mouth = mood === 'shout'
    ? `<path d="M174 266Q200 258 226 266Q218 298 200 300Q182 298 174 266Z" fill="#5a1822" stroke="${INK}" stroke-width="2.5"/><path d="M178 268Q200 262 222 268L220 274Q200 269 180 274Z" fill="#fff"/><path d="M186 290Q200 284 214 290Q206 297 200 297Q193 297 186 290Z" fill="#c4505c"/>`
    : `<path d="M178 272Q200 266 222 272L219 284Q200 290 181 284Z" fill="#fff" stroke="${INK}" stroke-width="2.5"/><path d="M180 278L220 278M190 271L190 287M200 270L200 288M210 271L210 287" stroke="${INK}" stroke-width="1.4"/>`;
  const cap = h.cap ? `<path d="M110 162C112 94 288 94 290 162C268 128 240 116 200 116C160 116 132 128 110 162Z" fill="${hairC}" opacity="${h.cap}"/>` : '';
  const sheen = style === 'shaved' ? `<path d="M150 108C176 96 214 96 236 104C214 104 180 108 158 120Z" fill="#fff" opacity=".35"/>` : '';
  return `<g class="hane-portrait"><defs>${clipEyes}</defs>`
    + (h.spikes ? `<path d="${hairBack(h)}" fill="${INK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="${hairBack(h)}" fill="${hairC}"/>` : '')
    + `<path d="M14 470L24 400C34 336 112 316 168 314L232 314C288 316 366 336 376 400L386 470Z" fill="${shirt}" stroke="${INK}" stroke-width="3"/>`
    + `<g clip-path="url(#${id}-torso)">${stripes}<path d="M232 314C300 320 360 344 376 400L386 470L310 470C296 360 270 330 232 314Z" fill="${INK}" opacity=".22"/></g>`
    + `<path d="M170 290L170 330Q200 352 230 330L230 290Z" fill="${skin}" stroke="${INK}" stroke-width="3"/><path d="M200 318Q216 316 230 300L230 330Q214 342 200 338Z" fill="${shade}"/>`
    + (fig.kit?.collar === 'v' ? `<path d="M164 316L200 362L236 316" fill="none" stroke="${trim}" stroke-width="9"/>` : `<path d="M162 318Q200 350 238 318" fill="none" stroke="${trim}" stroke-width="9"/>`)
    + numberSvg
    + `<path d="M108 196C96 190 92 214 102 228C108 238 116 236 118 230Z" fill="${skin}" stroke="${INK}" stroke-width="3"/><path d="M292 196C304 190 308 214 298 228C292 238 284 236 282 230Z" fill="${shade}" stroke="${INK}" stroke-width="3"/>`
    + `<path d="${head}" fill="${skin}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`
    + `<path d="M236 112C278 134 296 184 286 226C276 266 244 296 204 308C236 272 256 226 236 112Z" fill="${shade}"/>`
    + cap + sheen + beard
    + `<path d="M120 172L188 184L186 194L124 182Z" fill="${hairLo}" stroke="${INK}" stroke-width="2"/><path d="M280 172L212 184L214 194L276 182Z" fill="${hairLo}" stroke="${INK}" stroke-width="2"/>`
    + eye(160, 1, irisC, `${id}-el`) + eye(240, -1, irisC, `${id}-er`)
    + `<path d="M204 222L194 250L208 252" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    + mouth
    + (h.spikes ? `<path d="${bangs(h)}" fill="${hairC}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` : '')
    + (h.spikes ? `<path d="M140 104C166 92 206 92 236 100C210 104 172 110 150 122Z" fill="${hairHi}" opacity=".85"/>` : '')
    + `</g>`;
}
