// Composición SVG de una escena de Capitán Hane (TP234): fondo de líneas de velocidad y estallido radial, primer
// plano del protagonista, bocadillo con el nombre del movimiento y golpe final según el resultado GRABADO (gol,
// parada, fuera o robo). Todo generado aquí: sin imágenes, sin fuentes de terceros (rotulación de letters.ts; el
// nombre del jugador usa la fuente del sistema). Lienzo 1600 × 900 (o 900 × 1600 en vertical); la capa lo ajusta llenando la pantalla.
// Modos: `animated` (dos capas con clases que anima anime.css), `charge` / `outcome` (fotogramas fijos para las
// muestras PNG) y `card` (tarjeta fija para movimiento reducido).
import type { AbilityId } from './abilities';
import type { CutInKind } from './cutins';
import { letterPath, wrapWords } from './letters';
import { animePortrait, escapeXml, safeColour, safeId, type Figure } from './portrait';
import { mixHex, shadeHex } from '../../presentation/avatar/palette';
import type { SceneArt } from './hane-art';

export type SceneMode = 'animated' | 'charge' | 'outcome' | 'card';
/** Apaisada (escritorio, 1600 × 900) o vertical (teléfono, 900 × 1600): misma escena recolocada, nada recortado. */
export type SceneOrientation = 'landscape' | 'portrait';
export type CutInSpec = Readonly<{
  kind: CutInKind;
  /** Protagonista (tirador, goleador o defensa). `null`: el motor no grabó quién; solo se muestra el remate. */
  actor: Figure | null;
  /** Portero que para (solo `save`). */
  keeper: Figure | null;
  moveName: string | null;
  ability: AbilityId | null;
  keeperAbility: AbilityId | null;
  /** Pasador con «Pase del cielo» del pase grabado justo antes (rastro entre los dos). */
  skyPassFrom: Figure | null;
  /** Rótulo del golpe final ya traducido («GOAL!!», «¡GOL!»…). */
  outcomeText: string;
  /** Retratos generados ya cargados (TP235). Sin ellos (o `null`), el primer plano SVG de siempre. */
  art?: SceneArt;
}>;

const INK = '#140d12';
type Layout = Readonly<{
  W: number; H: number; burst: readonly [number, number]; portrait: readonly [number, number, number];
  bubble: readonly [number, number, number, number]; plate: readonly [number, number];
  trail: string; passer: readonly [number, number, number];
  centre: readonly [number, number]; art: string; caption: readonly [number, number, number, number];
  card: Readonly<{ box: string; x: number; y: number; size: number; max: number }>;
  /** Retrato generado: `null` = a sangre (todo el lienzo); si no, panel [x, y, ancho, alto, encuadre]. La carga recorta
   *  por la izquierda (el protagonista está en los dos tercios izquierdos); el desenlace se ve entero. */
  artPanel: Panel | null; outcomePanel: Panel | null;
  inset: readonly [number, number, number, number, number];
}>;
type Panel = readonly [number, number, number, number, string];
const LAYOUTS: Readonly<Record<SceneOrientation, Layout>> = {
  landscape: { W: 1600, H: 900, burst: [560, 470], portrait: [70, 70, 2], bubble: [1120, 330, 430, 190], plate: [80, 800],
    trail: 'M1560 60C1300 120 1000 160 760 300', passer: [1380, -40, 0.55], centre: [800, 450], art: '', caption: [800, 700, 150, 1300],
    card: { box: 'M980 640L1560 600L1540 860L960 880Z', x: 1260, y: 690, size: 110, max: 520 },
    artPanel: null, outcomePanel: null, inset: [1080, 40, 476, 272, -3] },
  portrait: { W: 900, H: 1600, burst: [450, 1000], portrait: [50, 640, 2], bubble: [450, 300, 370, 215], plate: [70, 1480],
    trail: 'M880 560C760 600 620 640 520 760', passer: [700, 470, 0.5], centre: [450, 800], art: 'translate(-130 320) scale(.72)', caption: [450, 1080, 170, 660],
    // Los móviles alargados (≈ 19,5:9) recortan unas 80 unidades por lado al llenar con `slice`: rótulos de 660 como mucho.
    card: { box: 'M60 560L850 540L840 760L50 780Z', x: 450, y: 600, size: 120, max: 640 },
    artPanel: [0, 600, 900, 840, 'xMinYMid slice'], outcomePanel: [0, 520, 900, 514, 'xMidYMid meet'], inset: [430, 1290, 430, 246, -3] },
};
const f = (v: number) => +v.toFixed(1);
/** Pseudoaleatorio determinista (xorshift) para líneas y rayos: misma escena, mismo dibujo. */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }
const seedOf = (text: string) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function burst(cx: number, cy: number, a: string, b: string, rays: number, seed: number, L: Layout): string {
  const r = rng(seed), out: string[] = [`<rect width="${L.W}" height="${L.H}" fill="${a}"/>`];
  for (let i = 0; i < rays; i++) {
    const t0 = (i / rays) * Math.PI * 2, t1 = t0 + (Math.PI * 2 / rays) * (0.35 + r() * 0.3), L = 1900;
    out.push(`<path d="M${cx} ${cy}L${f(cx + L * Math.cos(t0))} ${f(cy + L * Math.sin(t0))}L${f(cx + L * Math.cos(t1))} ${f(cy + L * Math.sin(t1))}Z" fill="${b}"/>`);
  }
  return out.join('');
}
function speedLines(cx: number, cy: number, n: number, seed: number, colour = '#ffffff'): string {
  const r = rng(seed), out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = r() * Math.PI * 2, inner = 330 + r() * 260, outer = 1200, w = 1.5 + r() * 5;
    const x0 = cx + inner * Math.cos(t), y0 = cy + inner * Math.sin(t), x1 = cx + outer * Math.cos(t + 0.012), y1 = cy + outer * Math.sin(t + 0.012), x2 = cx + outer * Math.cos(t - 0.012), y2 = cy + outer * Math.sin(t - 0.012);
    out.push(`<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}Z" fill="${colour}" opacity="${f(0.35 + r() * 0.5)}" stroke="${colour}" stroke-width="${f(w * 0.2)}"/>`);
  }
  return `<g class="ci-lines">${out.join('')}</g>`;
}
/** Escala y tamaño reales de un rótulo (alto de mayúscula `size`, limitado por `maxWidth`). */
function fit(text: string, size: number, maxWidth: number) {
  const { d, width } = letterPath(text), scale = Math.min(size / 6, width > 0 ? maxWidth / width : Infinity);
  return { d, width, scale };
}
/** Texto con la rotulación propia: trazo claro con contorno grueso, inclinado. `y` es la línea superior. */
export function lettering(text: string, x: number, y: number, size: number, fill = '#fff6c8', outline = INK, maxWidth = Infinity, fixedScale?: number): string {
  const m = fit(text, size, maxWidth), scale = fixedScale ?? m.scale;
  return `<g transform="translate(${f(x - m.width * scale / 2 + 0.6 * scale)} ${f(y)}) scale(${f(scale)}) skewX(-12)">`
    + `<path d="${m.d}" fill="none" stroke="${outline}" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter"/>`
    + `<path d="${m.d}" fill="none" stroke="${fill}" stroke-width="1.25" stroke-linecap="square" stroke-linejoin="miter"/></g>`;
}
/** Bocadillo de grito (borde en estrella) con el nombre del movimiento en una o dos líneas. */
function shoutBubble(name: string, [cx, cy, rx, ry]: Layout['bubble'], seed: number): string {
  const r = rng(seed), pts: string[] = [], n = 26;
  for (let i = 0; i < n * 2; i++) {
    const t = (i / (n * 2)) * Math.PI * 2, k = i % 2 ? 0.86 : 1.08 + r() * 0.1;
    pts.push(`${f(cx + rx * k * Math.cos(t))} ${f(cy + ry * k * Math.sin(t))}`);
  }
  const lines = wrapWords(name, 12).slice(0, 3), size = lines.length > 2 ? 72 : lines.length > 1 ? 96 : 116;
  // Una sola escala para todas las líneas (la que quepa en la más larga) y el bloque centrado en vertical.
  const scale = Math.min(...lines.map(line => fit(line, size, rx * 1.36).scale)), lineH = 6 * scale, gap = lineH * 0.32;
  const top = cy - (lines.length * lineH + (lines.length - 1) * gap) / 2 - 8;
  const text = lines.map((line, i) => lettering(line, cx, top + i * (lineH + gap), size, '#fff27a', INK, Infinity, scale)).join('');
  return `<g class="ci-bubble"><path d="M${pts.join('L')}Z" fill="#ffffff" stroke="${INK}" stroke-width="8" stroke-linejoin="miter"/>`
    + `<path d="M${f(cx - rx * 0.78)} ${f(cy + ry * 0.55)}L${f(cx - rx * 1.12)} ${f(cy + ry * 1.15)}L${f(cx - rx * 0.55)} ${f(cy + ry * 0.75)}Z" fill="#ffffff" stroke="${INK}" stroke-width="8"/>`
    + `<g class="ci-shout">${text}</g></g>`;
}
function namePlate(fig: Figure, x: number, y: number, colour: string): string {
  const label = `${fig.number && /^[0-9]{1,2}$/.test(fig.number) ? `${fig.number} · ` : ''}${fig.name}`.slice(0, 40);
  return `<g class="ci-plate"><path d="M${x} ${y}L${x + 640} ${y}L${x + 600} ${y + 74}L${x - 40} ${y + 74}Z" fill="${INK}" opacity=".88"/>`
    + `<path d="M${x - 40} ${y + 74}L${x + 600} ${y + 74}L${x + 596} ${y + 82}L${x - 44} ${y + 82}Z" fill="${colour}"/>`
    + `<text x="${x + 10}" y="${y + 52}" font-family="'Segoe UI', Arial, sans-serif" font-size="42" font-weight="800" font-style="italic" fill="#ffffff" letter-spacing="1">${escapeXml(label.toUpperCase())}</text></g>`;
}
function ball(cx: number, cy: number, r: number, deform: boolean): string {
  const body = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" stroke="${INK}" stroke-width="5"/>`
    + `<path d="M${cx} ${f(cy - r * 0.35)}L${f(cx + r * 0.34)} ${f(cy - r * 0.1)}L${f(cx + r * 0.21)} ${f(cy + r * 0.3)}L${f(cx - r * 0.21)} ${f(cy + r * 0.3)}L${f(cx - r * 0.34)} ${f(cy - r * 0.1)}Z" fill="${INK}"/>`
    + `<path d="M${cx} ${f(cy - r * 0.35)}L${cx} ${f(cy - r)}M${f(cx + r * 0.34)} ${f(cy - r * 0.1)}L${f(cx + r * 0.95)} ${f(cy - r * 0.3)}M${f(cx + r * 0.21)} ${f(cy + r * 0.3)}L${f(cx + r * 0.6)} ${f(cy + r * 0.8)}M${f(cx - r * 0.21)} ${f(cy + r * 0.3)}L${f(cx - r * 0.6)} ${f(cy + r * 0.8)}M${f(cx - r * 0.34)} ${f(cy - r * 0.1)}L${f(cx - r * 0.95)} ${f(cy - r * 0.3)}" stroke="${INK}" stroke-width="4"/>`
    + `<circle cx="${f(cx - r * 0.4)}" cy="${f(cy - r * 0.45)}" r="${f(r * 0.16)}" fill="#ffffff" opacity=".9"/>`;
  // «Tiro definitivo»: balón deformado por la potencia (solo dibujo; el tiro es el grabado).
  return deform ? `<g class="ci-ball ci-deform" transform="translate(${cx} ${cy}) scale(1.45 0.72) rotate(-12) translate(${-cx} ${-cy})">${body}</g>`
    + `<path d="M${f(cx - r * 4)} ${f(cy - r * 0.5)}L${f(cx - r * 1.4)} ${f(cy - r * 0.2)}M${f(cx - r * 4.4)} ${cy}L${f(cx - r * 1.5)} ${cy}M${f(cx - r * 4)} ${f(cy + r * 0.5)}L${f(cx - r * 1.4)} ${f(cy + r * 0.2)}" stroke="#ffe04a" stroke-width="10" stroke-linecap="round"/>`
    : `<g class="ci-ball">${body}</g>`;
}
function aura(colour: string): string {
  // Aura de «Tiro definitivo»: llamaradas alrededor del primer plano.
  const r = rng(7), flames: string[] = [];
  for (let i = 0; i < 18; i++) {
    const t = Math.PI * (0.95 + 1.1 * i / 17), base = 190, len = 90 + r() * 120;
    flames.push(`M${f(200 + base * Math.cos(t - 0.12))} ${f(220 + base * Math.sin(t - 0.12))}L${f(200 + (base + len) * Math.cos(t))} ${f(220 + (base + len) * Math.sin(t))}L${f(200 + base * Math.cos(t + 0.12))} ${f(220 + base * Math.sin(t + 0.12))}Z`);
  }
  return `<g class="ci-aura"><path d="${flames.join('')}" fill="${colour}" opacity=".85"/><path d="${flames.join('')}" fill="#fff6b0" opacity=".6" transform="translate(200 220) scale(.82) translate(-200 -220)"/></g>`;
}
function wings(): string {
  // «Muro»: alas de luz detrás del portero.
  const wing = (s: 1 | -1) => `<path d="M200 230C${200 + s * 120} 120 ${200 + s * 260} 60 ${200 + s * 380} 40C${200 + s * 330} 110 ${200 + s * 360} 150 ${200 + s * 300} 180C${200 + s * 350} 200 ${200 + s * 320} 240 ${200 + s * 260} 250C${200 + s * 290} 280 ${200 + s * 250} 300 ${200 + s * 200} 290Z" fill="#e8fbff" stroke="#8fe6ff" stroke-width="6" opacity=".88"/>`;
  return `<g class="ci-wings">${wing(1)}${wing(-1)}</g>`;
}
function shockwave(cx: number, cy: number): string {
  return `<g class="ci-shock">${[90, 150, 220].map((r, i) => `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.6}" ry="${r}" fill="none" stroke="#ffffff" stroke-width="${12 - i * 3}" opacity="${f(0.9 - i * 0.25)}"/>`).join('')}</g>`;
}
function placed(portrait: string, x: number, y: number, scale: number, rotate = 0, extra = ''): string {
  return `<g transform="translate(${x} ${y}) rotate(${rotate} 200 220) scale(${scale})">${extra}${portrait}</g>`;
}
function afterimages(portrait: string, x: number, y: number, scale: number): string {
  // «Sprint fantasma»: imágenes residuales detrás del protagonista.
  return `<g class="ci-after">${[3, 2, 1].map(i => `<g opacity="${f(0.16 + 0.1 * (3 - i))}">${placed(portrait, x - i * 110, y, scale)}</g>`).join('')}</g>`;
}

/** URL de un retrato generado: solo rutas propias del mismo origen (`/…/x.webp`; se escapan igualmente al escribirlas). */
const ART_URL = /^\/[A-Za-z0-9_./-]+\.webp$/;
export const safeArt = (url: string | null | undefined): string | null => typeof url === 'string' && ART_URL.test(url) && !url.includes('..') ? url : null;
/** Imagen generada a sangre (slice) o en un panel con marco de tinta. */
function artImage(url: string, L: Layout, panel: Layout['artPanel'], cls: string): string {
  const href = escapeXml(url);
  if (!panel) return `<g class="${cls}"><image href="${href}" x="0" y="0" width="${L.W}" height="${L.H}" preserveAspectRatio="xMidYMid slice"/></g>`;
  const [x, y, w, h, fit] = panel;
  return `<g class="${cls}"><rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" fill="${INK}"/>`
    + `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${fit}"/></g>`;
}
/** Viñeta de manga (portero batido o tirador que lamenta) sobre el desenlace. */
function insetPanel(url: string, [x, y, w, h, rot]: Layout['inset']): string {
  return `<g class="ci-inset" transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"><rect x="${x - 10}" y="${y - 10}" width="${w + 20}" height="${h + 20}" fill="#ffffff" stroke="${INK}" stroke-width="8"/>`
    + `<image href="${escapeXml(url)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></g>`;
}

function chargeLayer(spec: CutInSpec, id: string, team: string, seed: number, L: Layout): string {
  const actor = spec.actor!;
  const art = safeArt(spec.art?.charge);
  if (art) {
    // Retrato generado (TP235): la imagen sustituye al fondo y al primer plano SVG; líneas, bocadillo y placa encima.
    // Las habilidades (solo visuales) se siguen viendo: imágenes residuales de la propia imagen, aura o alas sobre el
    // jugador (dos tercios izquierdos) y la estela del «Pase del cielo».
    const bg = L.artPanel ? burst(L.burst[0], L.burst[1], shadeHex(team, -70), mixHex(team, '#ffffff', 0.2), 22, seed, L) : '';
    const [x, y, s] = L.portrait;
    const ghosts = spec.ability === 'phantom-sprint'
      ? `<g class="ci-after">${[2, 1].map(i => `<g opacity="${f(0.18 + 0.12 * (2 - i))}" transform="translate(${-i * 90} 0)">${artImage(art, L, L.artPanel, 'ci-ghost')}</g>`).join('')}</g>` : '';
    const effect = spec.ability === 'ultimate-shot' ? aura('#ff7a1a') : spec.ability === 'wall' ? wings() : '';
    const trail = spec.skyPassFrom
      ? `<g class="ci-trail"><path d="${L.trail}" fill="none" stroke="#bff3ff" stroke-width="26" stroke-linecap="round" opacity=".55"/><path d="${L.trail}" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-dasharray="40 18"/></g>` : '';
    return `<g class="ci-charge">${bg}${ghosts}${artImage(art, L, L.artPanel, 'ci-art')}<g opacity=".55">${speedLines(L.burst[0], L.burst[1], 36, seed + 1)}</g>`
      + (effect ? `<g opacity=".7">${placed('', x, y, s, -4, effect)}</g>` : '') + trail
      + (spec.moveName ? shoutBubble(spec.moveName, L.bubble, seed + 2) : '')
      + namePlate(actor, L.plate[0], L.plate[1], team) + `</g>`;
  }
  const p = animePortrait(actor, `${id}-a`, spec.kind === 'tackle' ? 'grit' : 'shout');
  const [x, y, s] = L.portrait, [bx, by] = L.burst;
  const bg = burst(bx, by, shadeHex(team, -70), mixHex(team, '#ffffff', 0.2), 22, seed, L) + speedLines(bx, by, 90, seed + 1);
  const trail = spec.skyPassFrom
    ? `<g class="ci-trail"><path d="${L.trail}" fill="none" stroke="#bff3ff" stroke-width="26" stroke-linecap="round" opacity=".55"/><path d="${L.trail}" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-dasharray="40 18"/>`
      + placed(animePortrait(spec.skyPassFrom, `${id}-p`, 'grit'), L.passer[0], L.passer[1], L.passer[2]) + `</g>` : '';
  const extra = spec.ability === 'ultimate-shot' ? aura('#ff7a1a') : spec.ability === 'wall' ? wings() : '';
  return `<g class="ci-charge">${bg}${trail}`
    + (spec.ability === 'phantom-sprint' ? afterimages(p, x, y, s) : '')
    + `<g class="ci-portrait">${placed(p, x, y, s, -4, extra)}</g>`
    + (spec.moveName ? shoutBubble(spec.moveName, L.bubble, seed + 2) : '')
    + namePlate(actor, L.plate[0], L.plate[1], team) + `</g>`;
}

function outcomeLayer(spec: CutInSpec, id: string, team: string, seed: number, L: Layout): string {
  const deform = spec.ability === 'ultimate-shot';
  const [cx, cy] = L.centre, [tx, ty, tsize, tmax] = L.caption;
  const bg = burst(cx, cy, '#0b0f1c', shadeHex(team, -20), 30, seed + 3, L) + speedLines(cx, cy, 70, seed + 4, '#fff6c8');
  const caption = lettering(spec.outcomeText, tx, ty, tsize, '#fff27a', INK, tmax);
  const picture = safeArt(spec.art?.outcome), inset = picture ? safeArt(spec.art?.inset) : null;
  if (picture) {
    // Retrato generado del desenlace (celebración, lamento o estirada) y, si hay, viñeta del rival; rótulo encima.
    const under = L.outcomePanel ? burst(cx, cy, '#0b0f1c', shadeHex(team, -20), 30, seed + 3, L) : '';
    // «Tiro definitivo»: el balón deformado sigue apareciendo junto al rótulo (solo dibujo; el tiro es el grabado).
    const power = deform && spec.kind !== 'save' ? `<g transform="translate(${f(tx + tmax * 0.42)} ${f(ty - 40)})">${ball(0, 0, 60, true)}</g>` : '';
    return `<g class="ci-out">${under}${artImage(picture, L, L.outcomePanel, 'ci-impact')}<g opacity=".5">${speedLines(cx, cy, 30, seed + 4, '#fff6c8')}</g>`
      + (inset ? insetPanel(inset, L.inset) : '') + power + `<g class="ci-caption">${caption}</g></g>`;
  }
  let art = '';
  if (spec.kind === 'goal') {
    // Red reventada: malla en perspectiva con un desgarro y el balón atravesándola.
    const grid: string[] = [];
    for (let i = 0; i <= 16; i++) grid.push(`M${200 + i * 75} 80Q${f(800 + (i - 8) * 60)} ${450} ${200 + i * 75} 640`);
    for (let j = 0; j <= 8; j++) grid.push(`M200 ${80 + j * 70}Q800 ${f(80 + j * 70 + (j - 4) * -30)} 1400 ${80 + j * 70}`);
    art = `<path d="${grid.join('')}" fill="none" stroke="#ffffff" stroke-width="4" opacity=".75"/>`
      + `<path d="M140 60L1460 60L1460 80L160 80L160 660L140 660Z" fill="#f4f6fb" stroke="${INK}" stroke-width="6"/><path d="M1440 80L1460 80L1460 660L1440 660Z" fill="#f4f6fb" stroke="${INK}" stroke-width="6"/>`
      + `<path d="M700 300L760 250L820 310L900 260L880 350L960 380L870 420L900 500L800 450L720 520L730 430L640 410L720 370Z" fill="#0b0f1c" stroke="#ffffff" stroke-width="6"/>`
      + ball(800, 380, 95, deform);
  } else if (spec.kind === 'save') {
    const k = spec.keeper;
    const sleeve = safeColour(k?.kit.shirt, '#222222');
    // Brazo estirado hacia el balón y guante con dedos: el portero «vuela» hacia la parada grabada.
    const glove = `<g class="ci-glove"><path d="M820 520C900 430 1020 340 1150 300" fill="none" stroke="${INK}" stroke-width="86" stroke-linecap="round"/>`
      + `<path d="M820 520C900 430 1020 340 1150 300" fill="none" stroke="${sleeve}" stroke-width="72" stroke-linecap="round"/>`
      + `<path d="M1130 250L1180 196Q1196 182 1206 198L1186 236L1236 186Q1252 174 1262 190L1222 246L1270 214Q1288 206 1292 224L1238 282L1278 270Q1296 268 1292 286L1230 330Q1180 360 1140 340Q1100 320 1110 280Z" fill="#fff27a" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/></g>`;
    const keeperArt = k ? placed(animePortrait(k, `${id}-k`, 'grit'), 300, 70, 1.55, -24, spec.keeperAbility === 'wall' ? wings() : '') : '';
    art = keeperArt + glove + `<g transform="translate(1340 230)">${ball(0, 0, 70, deform)}</g>`
      + `<path d="M1280 330L1500 470M1300 300L1540 380M1290 360L1450 540" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>`;
  } else if (spec.kind === 'miss') {
    // Portería a la izquierda del poste (larguero y red hacia dentro); el balón pasa por fuera, a la derecha.
    const net = Array.from({ length: 9 }, (_, i) => `M${120 + i * 120} 140L${80 + i * 120} 900`).join('') + Array.from({ length: 6 }, (_, j) => `M0 ${260 + j * 120}L1100 ${260 + j * 120}`).join('');
    art = `<path d="${net}" stroke="#ffffff" stroke-width="3" opacity=".35"/>`
      + `<path d="M0 120L1100 120L1100 140L0 140Z" fill="#f4f6fb" stroke="${INK}" stroke-width="6"/><path d="M1100 120L1160 120L1160 900L1100 900Z" fill="#f4f6fb" stroke="${INK}" stroke-width="8"/>`
      + `<path d="M260 640Q800 480 1300 300" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" opacity=".5" stroke-dasharray="70 30"/>`
      + `<g transform="translate(1300 300)">${ball(0, 0, 80, deform)}</g>`;
  } else {
    const a = spec.actor;
    art = (a ? placed(animePortrait(a, `${id}-t`, 'grit'), 320, 40, 1.6, 14) : '')
      + (spec.ability === 'shield' ? shockwave(1180, 420) : '')
      + `<path d="M1100 300L1150 360L1230 330L1200 410L1270 450L1180 460L1170 540L1120 470L1040 500L1080 430L1010 380L1100 380Z" fill="#fff27a" stroke="${INK}" stroke-width="6"/>`
      + `<g transform="translate(1180 420)">${ball(0, 0, 70, false)}</g>`;
  }
  // El dibujo del desenlace está pensado en 1600 × 900; en vertical se encoge al 72 % y se centra (el balón y el guante siguen dentro).
  return `<g class="ci-out">${bg}<g class="ci-impact"${L.art ? ` transform="${L.art}"` : ''}>${art}</g><g class="ci-caption">${caption}</g></g>`;
}

/** SVG completo de la escena (cadena; los textos se escapan y los colores se validan). */
export function cutInSvg(spec: CutInSpec, idPrefix: string, mode: SceneMode = 'animated', orientation: SceneOrientation = 'landscape'): string {
  const L = LAYOUTS[orientation], id = safeId(idPrefix), team = safeColour(spec.actor?.kit.shirt ?? spec.keeper?.kit.shirt, '#3d5afe');
  const seed = seedOf(`${spec.kind}|${spec.actor?.name ?? ''}|${spec.moveName ?? ''}`);
  const hasCharge = !!spec.actor;
  let body: string;
  if (mode === 'charge') body = hasCharge ? chargeLayer(spec, id, team, seed, L) : outcomeLayer(spec, id, team, seed, L);
  else if (mode === 'outcome') body = outcomeLayer(spec, id, team, seed, L);
  else if (mode === 'card') body = hasCharge
    ? chargeLayer(spec, id, team, seed, L) + `<g class="ci-card-caption"><path d="${L.card.box}" fill="${INK}" opacity=".9"/>${lettering(spec.outcomeText, L.card.x, L.card.y, L.card.size, '#fff27a', INK, L.card.max)}</g>`
    : outcomeLayer(spec, id, team, seed, L);
  else body = (hasCharge ? chargeLayer(spec, id, team, seed, L) : '') + outcomeLayer(spec, id, team, seed, L) + `<rect class="ci-flash" width="${L.W}" height="${L.H}" fill="#ffffff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.W} ${L.H}" preserveAspectRatio="xMidYMid slice" class="hane-cutin hane-${mode} hane-${orientation}${hasCharge ? '' : ' hane-no-charge'}" data-kind="${spec.kind}" aria-hidden="true" focusable="false">${body}</svg>`;
}
