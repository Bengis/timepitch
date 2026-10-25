// Generador del atlas «Clásico 16 bits» (TP219). Uso (desde web/):
//   node scripts/sensible-art/generate.ts            → atlas + JSON en src/match/renderers/sensible/
//   node scripts/sensible-art/generate.ts --sheets   → además, hojas de contacto en ../.local/sensible/
// Determinista: mismas fuentes → mismos bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPalette, buildPaletteLUT, CARD_HEX, HAIR_FEATURE, HAIR_FEATURES, HAIR_HEX, HEAD_STYLES, HEAD_ZONES, NUMBER_FONT, PREVIEW_KIT,
  PREVIEW_LOOK, REFEREE_KIT, REFEREE_KITS, SKIN_HEX, numberStyle, hexToRgb, type BeardLevel, type HeadStyle, type SensibleKit, type SensibleLook,
} from '../../src/match/renderers/sensible/palette.ts';
import { buildPlayer, DIRECTIONS, TAG } from './body.ts';
import { GOALKEEPER, OFFICIALS, OUTFIELD, type Anim } from './poses.ts';
import { rasterize, type Raster } from './rig.ts';
import { ballSprites, shadowSprites } from './ball.ts';
import { environmentSprites, renderPitch, renderTiles } from './pitch.ts';
import { encodeIndexed, encodeRGBA } from './png.ts';
import { contactSheet, type SheetCell } from './sheet.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..', '..');
const OUT = resolve(WEB, 'src/match/renderers/sensible');
const SHEETS = resolve(WEB, '..', '.local/sensible');

type Sprite = Readonly<{ key: string; raster: Raster }>;
type Trimmed = Readonly<{ key: string; w: number; h: number; ax: number; ay: number; idx: Uint8Array }>;

function trim(key: string, r: Raster): Trimmed {
  let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.idx[y * r.w + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return { key, w: 1, h: 1, ax: 0, ay: 0, idx: new Uint8Array(1) };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, idx = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) idx.set(r.idx.subarray((y0 + y) * r.w + x0, (y0 + y) * r.w + x0 + w), y * w);
  return { key, w, h, ax: r.ax - x0, ay: r.ay - y0, idx };
}

/** Estantes ordenados por alto; 1 px de separación para que el filtrado no sangre entre celdas. */
function pack(items: readonly Trimmed[], width: number) {
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w || a.key.localeCompare(b.key));
  const place = new Map<string, { x: number; y: number }>();
  let x = 1, y = 1, shelf = 0;
  for (const it of order) {
    if (x + it.w + 1 > width) { x = 1; y += shelf + 1; shelf = 0; }
    place.set(it.key, { x, y }); x += it.w + 1; shelf = Math.max(shelf, it.h);
  }
  const height = 2 ** Math.ceil(Math.log2(y + shelf + 1));
  return { place, height };
}

/** Zona del dorsal: [cara (1 dorso, 2 pecho), x, y, ancho, alto] en px del sprite respecto al ancla. */
type NumberArea = [number, number, number, number, number];
function numberArea(r: Raster): NumberArea | null {
  for (const face of [TAG.back, TAG.front]) {
    let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x, v = r.idx[i];
      if (r.tag?.[i] !== face || v < 64 || v >= 112) continue;
      count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // Solo si se ve un trozo de camiseta razonable (al menos 3×3 y casi lleno): de perfil o tumbado no hay dorsal.
    if (count >= 8 && w >= 3 && h >= 3 && count >= .6 * w * h) return [face, x0 - r.ax, y0 - r.ay, w, h];
  }
  return null;
}

/**
 * Sprites de un juego de animaciones. Con `features`, además una capa por rasgo de pelo y fotograma: la diferencia
 * entre el muñeco con el rasgo y sin él (el resto del cuerpo como oclusor, así que un brazo delante tapa la melena).
 */
export function playerSprites(anims: readonly Anim[], prefix: string, features = false) {
  const out: Sprite[] = [], numbers: Record<string, NumberArea> = {};
  const opts = { size: 48, ax: 24, ay: 34 };
  for (const a of anims) for (const dir of DIRECTIONS) a.frames.forEach((pose, f) => {
    const id = `${a.name}.${dir}.${f}`;
    const base = rasterize(buildPlayer(dir, pose, a.outfit), opts);
    out.push({ key: `${prefix}.${id}`, raster: base });
    const area = numberArea(base); if (area) numbers[id] = area;
    if (features) for (const feature of HAIR_FEATURES) {
      const full = rasterize(buildPlayer(dir, pose, a.outfit, feature), opts), idx = new Uint8Array(full.idx.length);
      let any = false;
      for (let i = 0; i < idx.length; i++) if (full.idx[i] && full.idx[i] !== base.idx[i]) { idx[i] = full.idx[i]; any = true; }
      if (any) out.push({ key: `hair.${feature}.${id}`, raster: { ...base, idx, tag: undefined } });
    }
  });
  return { sprites: out, numbers };
}

/** Superpone una capa de pelo (mismo marco que el cuerpo) en el espacio de índices. */
function compose(base: Raster, overlay?: Raster): Raster {
  if (!overlay) return base;
  const idx = base.idx.slice();
  for (let i = 0; i < idx.length; i++) if (overlay.idx[i]) idx[i] = overlay.idx[i];
  return { ...base, idx };
}

function uniquePalette(lut: Uint8ClampedArray): [number, number, number, number][] {
  const seen = new Set<string>(), pal: [number, number, number, number][] = [];
  for (let i = 0; i < 256; i++) {
    let r = lut[i * 4], g = lut[i * 4 + 1], b = lut[i * 4 + 2]; const a = i === 0 ? 0 : 255;
    let k = 0;
    while (seen.has(`${r},${g},${b}`)) { k++; b = Math.max(0, Math.min(255, lut[i * 4 + 2] + (k % 2 ? 1 : -1) * Math.ceil(k / 2))); if (k > 40) { g = (g + 1) & 255; k = 0; } }
    seen.add(`${r},${g},${b}`); pal.push([r, g, b, a]);
  }
  return pal;
}

const hex = (c: readonly number[]) => `#${c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')}`;

// Kits de prueba para las hojas: claros, oscuros, con patrón y porteros (colores genéricos, no de un club concreto).
const SHEET_KITS: Readonly<Record<string, SensibleKit>> = {
  red: PREVIEW_KIT,
  'white-navy': { shirt: '#f6f6f2', sleeves: { left: '#f6f6f2', right: '#f6f6f2' }, shorts: '#1d2a5c', socks: '#f6f6f2', trim: '#1d2a5c', pattern: { body: 'plain' } },
  'sky-stripes': { shirt: '#7fb8e6', sleeves: { left: '#7fb8e6', right: '#7fb8e6' }, shorts: '#ffffff', socks: '#1d2a5c', trim: '#ffffff', pattern: { body: 'stripes' } },
  'black-white-stripes': { shirt: '#161616', sleeves: { left: '#161616', right: '#161616' }, shorts: '#161616', socks: '#161616', trim: '#f2f2f2', pattern: { body: 'stripes' } },
  'blue-hoops': { shirt: '#1b4fa0', sleeves: { left: '#1b4fa0', right: '#1b4fa0' }, shorts: '#ffffff', socks: '#ffffff', trim: '#ffffff', pattern: { body: 'hoops' } },
  'halves': { shirt: '#2a5bb8', sleeves: { left: '#2a5bb8', right: '#ffffff' }, shorts: '#ffffff', socks: '#2a5bb8', trim: '#ffffff', pattern: { body: 'halves' } },
  'claret-sky': { shirt: '#7a1e3a', sleeves: { left: '#8fc6ea', right: '#8fc6ea' }, shorts: '#ffffff', socks: '#7a1e3a', trim: '#8fc6ea', pattern: { body: 'plain' } },
  'yellow-gk': { shirt: '#f5d20a', sleeves: { left: '#f5d20a', right: '#f5d20a' }, shorts: '#111111', socks: '#f5d20a', trim: '#111111', pattern: { body: 'plain' } },
  'green-gk': { shirt: '#1e9e4a', sleeves: { left: '#1e9e4a', right: '#1e9e4a' }, shorts: '#111111', socks: '#1e9e4a', trim: '#e8e8e8', pattern: { body: 'plain' } },
  referee: REFEREE_KIT,
};
const LOOKS: readonly SensibleLook[] = [
  { skin: SKIN_HEX.s1, hair: HAIR_HEX.blond, boots: '#111111' }, { skin: SKIN_HEX.s3, hair: HAIR_HEX.dkbrown, boots: '#111111' },
  { skin: SKIN_HEX.s5, hair: HAIR_HEX.black, boots: '#f2f2f2' }, { skin: SKIN_HEX.s8, hair: HAIR_HEX.black, boots: '#111111' },
];

function main() {
  const sheets = process.argv.includes('--sheets');
  const players = playerSprites([...OUTFIELD, ...GOALKEEPER], 'player', true);
  const officials = playerSprites(OFFICIALS, 'player');
  const balls = ballSprites(), shadows = shadowSprites(), env = environmentSprites();
  const all = [...players.sprites, ...officials.sprites, ...balls, ...shadows, ...env.sprites];
  const numbers = { ...players.numbers, ...officials.numbers };
  const trimmed = all.map(s => trim(s.key, s.raster));
  const W = 1024, { place, height } = pack(trimmed, W);
  const atlas = new Uint8Array(W * height);
  const frames: Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number }> = {};
  for (const t of [...trimmed].sort((a, b) => a.key.localeCompare(b.key))) {
    const p = place.get(t.key)!;
    for (let y = 0; y < t.h; y++) atlas.set(t.idx.subarray(y * t.w, (y + 1) * t.w), (p.y + y) * W + p.x);
    frames[t.key] = { x: p.x, y: p.y, w: t.w, h: t.h, ax: t.ax, ay: t.ay };
  }
  const pal = uniquePalette(buildPaletteLUT(PREVIEW_KIT, PREVIEW_LOOK));
  const used = new Set(atlas);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'atlas.png'), encodeIndexed(W, height, atlas, pal));
  const anims = Object.fromEntries([...OUTFIELD, ...GOALKEEPER, ...OFFICIALS].map(a => [a.name, {
    frames: a.frames.length, fps: a.fps, loop: a.loop, keeper: !!a.outfit?.keeper, ...(a.outfit?.official ? { official: a.outfit.official } : {}), note: a.note,
  }]));
  const json = {
    format: 'timepitch-sensible-atlas', version: 2, case: 'TP219+TP222',
    licence: 'Arte original de TimePitch (generado por web/scripts/sensible-art). No contiene sprites, logotipos ni tipografías de terceros.',
    image: 'atlas.png', width: W, height,
    pixel: 'PNG indexado de 8 bits: el ÍNDICE de paleta es el dato. Recolorear con palette.ts (buildPaletteLUT).',
    indexColours: Object.fromEntries([...used].sort((a, b) => a - b).map(i => [i, hex(pal[i])])),
    directions: DIRECTIONS, frameKey: 'player.<anim>.<dir>.<frame> · hair.<rasgo>.<anim>.<dir>.<frame> · ball.<size>.<frame> · shadow.<name> · env.<name>[.<frame>]',
    heads: {
      note: 'Píxeles del cráneo = 112 + zona·3 + tono; cada zona es pelo/piel/barba según peinado (palette.ts → HEAD_ZONES). Lo que sobresale va en capas hair.<rasgo>.* con el mismo ancla que el cuerpo, pintadas encima.',
      zones: HEAD_ZONES, features: HAIR_FEATURE,
    },
    numbersNote: 'numbers[<anim>.<dir>.<frame>] = [cara 1 dorso / 2 pecho, x, y, ancho, alto] de la camiseta visible, en px del sprite respecto al ancla.',
    anchor: 'ax, ay = punto de apoyo en el suelo dentro del rectángulo (pies del jugador, centro del balón en el suelo).',
    animations: anims,
    ball: { sizes: { s: 'en el suelo (4 px)', m: 'a media altura (5 px)', l: 'alto (6 px)' }, frames: 4, note: 'Giro de 4 fotogramas que cierra el ciclo; invertir el orden para girar al revés.' },
    environment: env.meta,
    frames: '@frames', numbers: '@numbers',
  };
  // Una entrada por línea: miles de capas de pelo en formato bonito harían un JSON enorme.
  const lines = (o: Record<string, unknown>) => `{\n${Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n }`;
  const text = JSON.stringify(json, null, 1).replace('"@frames"', lines(frames)).replace('"@numbers"', lines(numbers));
  writeFileSync(resolve(OUT, 'atlas.json'), text + '\n');
  const pitch = renderPitch();
  writeFileSync(resolve(OUT, 'pitch.png'), encodeRGBA(pitch.w, pitch.h, pitch.rgba));
  writeFileSync(resolve(OUT, 'pitch.json'), JSON.stringify(pitch.meta, null, 1) + '\n');
  renderTiles(OUT);
  console.log(`atlas ${W}x${height}, ${trimmed.length} sprites; pitch ${pitch.w}x${pitch.h}`);

  if (!sheets) return;
  mkdirSync(SHEETS, { recursive: true });
  const raster = new Map(all.map(s => [s.key, s.raster]));
  const kitPairs: [string, string][] = [['red', 'white-navy'], ['black-white-stripes', 'sky-stripes']];
  for (const a of [...OUTFIELD, ...GOALKEEPER]) {
    const pair: [string, string][] = a.outfit?.keeper ? [['yellow-gk', 'green-gk']] : kitPairs;
    const rows: SheetCell[][] = [];
    for (const [ka, kb] of pair) for (let f = 0; f < a.frames.length; f++) {
      const row: SheetCell[] = [];
      for (const [k, kit] of [[ka, SHEET_KITS[ka]], [kb, SHEET_KITS[kb]]] as const) {
        const look = LOOKS[(f + (k === kb ? 2 : 0)) % LOOKS.length];
        const lut = buildPaletteLUT(kit, { ...look, gloves: '#f2f2f2' });
        for (const d of DIRECTIONS) row.push({ raster: raster.get(`player.${a.name}.${d}.${f}`)!, lut });
      }
      rows.push(row);
    }
    const s = contactSheet(rows, { zoom: 4 });
    writeFileSync(resolve(SHEETS, `sheet-${a.name}.png`), encodeRGBA(s.w, s.h, s.rgba));
  }
  // Muestrario de equipaciones: carrera S/E/N con todos los kits y tonos de piel.
  const kitRows: SheetCell[][] = Object.entries(SHEET_KITS).map(([, kit], i) => {
    const look = { ...LOOKS[i % LOOKS.length], gloves: '#f2f2f2' };
    return ['S', 'SE', 'E', 'N'].flatMap(d => [0, 2, 4].map(f => ({ raster: raster.get(`player.run.${d}.${f}`)!, lut: buildPaletteLUT(kit, look) })));
  });
  const ks = contactSheet(kitRows, { zoom: 4 });
  writeFileSync(resolve(SHEETS, 'sheet-kits.png'), encodeRGBA(ks.w, ks.h, ks.rgba));
  const skinRows: SheetCell[][] = [Object.values(SKIN_HEX).map((skin, i) => ({ raster: raster.get('player.idle.S.0')!, lut: buildPaletteLUT(PREVIEW_KIT, { skin, hair: Object.values(HAIR_HEX)[i % 6], boots: '#111111' }) })),
    Object.values(SKIN_HEX).map((skin, i) => ({ raster: raster.get('player.idle.N.0')!, lut: buildPaletteLUT(SHEET_KITS['white-navy'], { skin, hair: Object.values(HAIR_HEX)[(i + 3) % 6], boots: '#111111' }) }))];
  const ss = contactSheet(skinRows, { zoom: 6 });
  writeFileSync(resolve(SHEETS, 'sheet-skin-hair.png'), encodeRGBA(ss.w, ss.h, ss.rgba));
  const misc: SheetCell[][] = [[...balls, ...shadows].map(b => ({ raster: b.raster, lut: buildPaletteLUT(PREVIEW_KIT, PREVIEW_LOOK) }))];
  const ms = contactSheet(misc, { zoom: 8 });
  writeFileSync(resolve(SHEETS, 'sheet-ball.png'), encodeRGBA(ms.w, ms.h, ms.rgba));
  env.sheet(SHEETS);
  writeScene(pitch, raster);
  writeHeads(raster);
  writeOfficials(raster);
  writeNumbers(raster, numbers);
}

// ---------- Hojas nuevas (TP222) ----------

type Img = { w: number; h: number; rgba: Uint8ClampedArray };
function canvas(w: number, h: number, bg: [number, number, number] = [58, 120, 50]): Img {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255; }
  return { w, h, rgba };
}
function rect(img: Img, x: number, y: number, w: number, h: number, colour: string) {
  const c = hexToRgb(colour);
  for (let yy = Math.max(0, y); yy < Math.min(img.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(img.w, x + w); xx++) {
    const d = (yy * img.w + xx) * 4; img.rgba[d] = c[0]; img.rgba[d + 1] = c[1]; img.rgba[d + 2] = c[2];
  }
}
/** Pinta un sprite con su ancla en (x, y) de la hoja, ampliado `z` veces. */
function stamp(img: Img, r: Raster, lut: Uint8ClampedArray, x: number, y: number, z: number, clip?: readonly [number, number, number, number]) {
  const rgba = applyPalette(r.idx, lut);
  for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) {
    const s = (yy * r.w + xx) * 4, a = rgba[s + 3] / 255; if (!a) continue;
    for (let zy = 0; zy < z; zy++) for (let zx = 0; zx < z; zx++) {
      const X = x + (xx - r.ax) * z + zx, Y = y + (yy - r.ay) * z + zy; if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
      if (clip && (X < clip[0] || Y < clip[1] || X >= clip[2] || Y >= clip[3])) continue;
      const d = (Y * img.w + X) * 4; for (let k = 0; k < 3; k++) img.rgba[d + k] = Math.round(rgba[s + k] * a + img.rgba[d + k] * (1 - a));
    }
  }
}
/** Dorsal como lo pinta el renderer: cifras 3×5 a `f` px por píxel de letra, centradas en la zona de camiseta. */
function stampNumber(img: Img, area: readonly number[], kit: SensibleKit, value: string, x: number, y: number, z: number, f: number) {
  const { fill, plate } = numberStyle(kit);
  const w = value.length * 4 - 1, cx = x + (area[1] + area[3] / 2) * z, cy = y + (area[2] + area[4] / 2) * z;
  const left = Math.round(cx - w * f / 2), top = Math.round(cy - 5 * f / 2);
  if (plate) rect(img, left - f, top - f, (w + 2) * f, 7 * f, plate);
  [...value].forEach((d, i) => { const bits = NUMBER_FONT[d]; for (let k = 0; k < 15; k++) if (bits[k] === '1') rect(img, left + (i * 4 + k % 3) * f, top + Math.floor(k / 3) * f, f, f, fill); });
}
function save(name: string, img: Img) { writeFileSync(resolve(SHEETS, name), encodeRGBA(img.w, img.h, img.rgba)); }

const SKIN_ORDER = ['s1', 's3', 's5', 's8'] as const;
const HAIR_FOR: Readonly<Record<HeadStyle, keyof typeof HAIR_HEX>> = {
  buzz: 'brown', crop: 'dkbrown', short: 'blond', side: 'ltbrown', slick: 'black', quiff: 'dkblond', curly: 'black', long: 'brown', tied: 'dkbrown', shaved: 'black',
};
function mixHex(a: string, b: string, t: number) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return hex([0, 1, 2].map(i => Math.round(x[i] + (y[i] - x[i]) * t)));
}

/** Peinados × pieles (fila por peinado; S, SE, E, NE, N de cada piel), fila de barbas, y debajo a 1× y 2×. */
function writeHeads(raster: Map<string, Raster>) {
  const dirs = ['S', 'SE', 'E', 'NE', 'N'], z = 6, cw = 14 * z, ch = 13 * z, cols = dirs.length * SKIN_ORDER.length;
  const rows = HEAD_STYLES.length + 1, small = 130;
  const img = canvas(cols * cw + 16, rows * ch + 16 + small);
  const drawCell = (style: HeadStyle, beard: BeardLevel, skin: string, hairHex: string, dir: string, x: number, y: number, zoom: number, anim = 'idle', f = 0, clip?: readonly [number, number, number, number]) => {
    const feature = HAIR_FEATURE[style];
    const body = raster.get(`player.${anim}.${dir}.${f}`)!, over = feature ? raster.get(`hair.${feature}.${anim}.${dir}.${f}`) : undefined;
    const hair = style === 'shaved' ? mixHex(hairHex, skin, .7) : style === 'buzz' ? mixHex(hairHex, skin, .4) : hairHex;
    stamp(img, compose(body, over), buildPaletteLUT(SHEET_KITS['white-navy'], { skin, hair, boots: '#111111', hairStyle: style, beard }), x, y, zoom, clip);
  };
  const cell = (cx: number, top: number, w = cw): [number, number, number, number] => [cx - w / 2 + 2, top, cx + w / 2 - 2, top + ch - 4];
  // Celdas a 6× recortadas a cabeza y hombros (el ancla queda por debajo de la celda).
  HEAD_STYLES.forEach((style, r) => SKIN_ORDER.forEach((skin, s) => dirs.forEach((d, k) => {
    const cx = 8 + (s * dirs.length + k) * cw + cw / 2, top = 8 + r * ch;
    drawCell(style, 'none', SKIN_HEX[skin], HAIR_HEX[HAIR_FOR[style]], d, cx, top + 20 * z, z, 'idle', 0, cell(cx, top));
  })));
  (['none', 'stubble', 'light', 'full'] as const).forEach((beard, b) => SKIN_ORDER.forEach((skin, s) => {
    const cx = 8 + (b * SKIN_ORDER.length + s) * cw * 1.25 + cw / 2, top = 8 + HEAD_STYLES.length * ch;
    drawCell('crop', beard, SKIN_HEX[skin], HAIR_HEX.black, 'S', cx, top + 20 * z, z, 'idle', 0, cell(cx, top));
  }));
  // Tapa lo que asoma por debajo de cada fila de 6× (piernas) con el fondo: la hoja es de cabezas.
  // A tamaño real (1×, y 2× debajo): lo que de verdad se ve en el partido.
  const y1 = 8 + rows * ch + 8;
  rect(img, 0, y1 - 8, img.w, small + 8, '#3a7832');
  HEAD_STYLES.forEach((style, r) => ['S', 'E', 'N', 'SW'].forEach((d, k) => SKIN_ORDER.forEach((skin, s) => {
    const i = k * 4 + s;
    drawCell(style, 'none', SKIN_HEX[skin], HAIR_HEX[HAIR_FOR[style]], d, 14 + r * 160 + i * 9, y1 + 22, 1, 'run', (k + s) % 6);
    if (i < 8) drawCell(style, 'none', SKIN_HEX[skin], HAIR_HEX[HAIR_FOR[style]], d, 18 + r * 160 + i * 18, y1 + 80, 2, 'run', (k + s) % 6);
  })));
  save('sheet-heads.png', img);
}

/** Árbitro (equipación negra y la amarilla alternativa) y asistentes, 8 direcciones. */
function writeOfficials(raster: Map<string, Raster>) {
  const z = 4, cw = 22 * z, ch = 30 * z;
  const rowsSpec: [string, number, SensibleKit, SensibleLook][] = [];
  const refLook = (card: string = CARD_HEX.yellow): SensibleLook => ({ skin: SKIN_HEX.s3, hair: HAIR_HEX.dkbrown, boots: '#111111', hairStyle: 'crop', card });
  for (const kit of REFEREE_KITS.slice(0, 2)) {
    rowsSpec.push(['idle', 0, kit, refLook()], ['run', 1, kit, refLook()], ['ref-whistle', 0, kit, refLook()], ['ref-card', 1, kit, refLook(kit === REFEREE_KIT ? CARD_HEX.yellow : CARD_HEX.red)]);
  }
  const ar = REFEREE_KITS[0], arLook: SensibleLook = { skin: SKIN_HEX.s6, hair: HAIR_HEX.black, boots: '#111111', hairStyle: 'buzz' };
  rowsSpec.push(['ar-idle', 0, ar, arLook], ['ar-run', 1, ar, arLook], ['ar-run', 4, ar, arLook], ['ar-flag', 0, ar, arLook], ['ar-flag', 1, ar, arLook], ['ref-card', 0, ar, refLook()]);
  const img = canvas(DIRECTIONS.length * cw + 8, rowsSpec.length * ch + 8);
  rowsSpec.forEach(([anim, f, kit, look], r) => DIRECTIONS.forEach((d, k) => {
    stamp(img, raster.get(`player.${anim}.${d}.${f}`)!, buildPaletteLUT(kit, look), 4 + k * cw + cw / 2, 4 + r * ch + 24 * z, z);
  }));
  save('sheet-officials.png', img);
}

/** Cifras 0–99 a 3× y dorsales sobre espaldas y pechos tal como los pinta el renderer a escala 2 y 4. */
function writeNumbers(raster: Map<string, Raster>, numbers: Record<string, readonly number[]>) {
  const img = canvas(1000, 560, [40, 92, 38]);
  for (let n = 0; n < 100; n++) {
    const value = String(n), x = 10 + (n % 20) * 48, y = 10 + Math.floor(n / 20) * 26;
    rect(img, x - 3, y - 3, 7 * 3 + 6, 5 * 3 + 6, '#1c1430');
    [...value].forEach((d, i) => { const bits = NUMBER_FONT[d]; for (let k = 0; k < 15; k++) if (bits[k] === '1') rect(img, x + (i * 4 + k % 3) * 3, y + Math.floor(k / 3) * 3, 3, 3, '#fff6d8'); });
  }
  const kits = ['red', 'white-navy', 'black-white-stripes', 'blue-hoops', 'yellow-gk', 'claret-sky'] as const;
  const values = ['9', '14', '23', '1', '88', '7'];
  const dirs = ['N', 'NE', 'NW', 'S', 'SE', 'E'];
  for (const [zoom, f, y0, step] of [[2, 1, 170, 26], [4, 2, 300, 44]] as const) kits.forEach((name, i) => dirs.forEach((d, k) => {
    const kit = SHEET_KITS[name], key = `idle.${d}.0`;
    const n = i * dirs.length + k, perRow = zoom === 2 ? 36 : 22;
    const x = 24 + (n % perRow) * step, y = y0 + Math.floor(n / perRow) * (zoom === 2 ? 56 : 100) + 26 * zoom;
    stamp(img, raster.get(`player.${key}`)!, buildPaletteLUT(kit, LOOKS[i % LOOKS.length]), x, y, zoom);
    const area = numbers[key];
    // Delante, cifra pequeña y solo cuando el zoom deja sitio (escala ≥ 4, a 1 px de pantalla).
    if (area && (area[0] === 1 || zoom >= 4)) stampNumber(img, area, kit, values[i], x, y, zoom, area[0] === 1 ? f : 1);
  }));
  save('sheet-numbers.png', img);
}

/** Escena de prueba: área norte con 9 jugadores, portero, balón y portería, a 3×, para juzgar el conjunto. */
function writeScene(pitch: ReturnType<typeof renderPitch>, raster: Map<string, Raster>) {
  const { field, goals } = pitch.meta;
  const cx = goals.north.x, x0 = cx - 180, y0 = field.y - 60, w = 360, h = 230, z = 3;
  const img = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) img[(y * w + x) * 4 + k] = pitch.rgba[((y0 + y) * pitch.w + x0 + x) * 4 + k];
  const draw = (key: string, px: number, py: number, lut: Uint8ClampedArray) => {
    const r = raster.get(key)!; const rgba = buildRGBA(r, lut);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const s = (y * r.w + x) * 4, a = rgba[s + 3] / 255; if (!a) continue;
      const X = px - r.ax + x - x0, Y = py - r.ay + y - y0; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const d = (Y * w + X) * 4; for (let k = 0; k < 3; k++) img[d + k] = Math.round(rgba[s + k] * a + img[d + k] * (1 - a));
    }
  };
  const red = buildPaletteLUT(PREVIEW_KIT, LOOKS[1]), white = buildPaletteLUT(SHEET_KITS['white-navy'], LOOKS[2]);
  const gk = buildPaletteLUT(SHEET_KITS['green-gk'], { ...LOOKS[0], gloves: '#f2f2f2' });
  const gy = goals.north.y;
  const actors: [string, number, number, Uint8ClampedArray][] = [
    ['player.gk-dive-left-high.S.1', cx - 6, gy + 10, gk],
    ['player.shot.N.2', cx + 10, gy + 92, red], ['player.run.NW.1', cx + 40, gy + 70, red], ['player.sprint.N.3', cx - 60, gy + 110, red],
    ['player.slide.E.1', cx + 30, gy + 112, white], ['player.run.S.4', cx - 30, gy + 60, white], ['player.idle.SW.0', cx + 70, gy + 40, white],
    ['player.header.N.2', cx - 20, gy + 40, red], ['player.run.SE.2', cx - 90, gy + 80, white], ['player.celebrate.S.1', cx + 120, gy + 140, red],
  ];
  draw('env.goal-n-net', cx, gy, red);
  const shadowLut = red;
  for (const [, x, y] of actors) draw('shadow.player', x, y, shadowLut);
  draw('shadow.ball-m', cx - 2, gy + 30, red);
  for (const [k, x, y, l] of [...actors].sort((a, b) => a[2] - b[2])) { if (y > gy) draw('env.goal-n-frame', cx, gy, red); draw(k, x, y, l); }
  draw('ball.m.1', cx - 2, gy + 22, red);
  draw('env.flag.0', field.x, field.y, red); draw('env.flag.1', field.x + field.w, field.y, red);
  const out = new Uint8ClampedArray(w * z * h * z * 4);
  for (let y = 0; y < h * z; y++) for (let x = 0; x < w * z; x++) for (let k = 0; k < 4; k++) out[(y * w * z + x) * 4 + k] = img[(Math.floor(y / z) * w + Math.floor(x / z)) * 4 + k];
  writeFileSync(resolve(SHEETS, 'scene-north-box.png'), encodeRGBA(w * z, h * z, out));
}

function buildRGBA(r: Raster, lut: Uint8ClampedArray) { return applyPalette(r.idx, lut); }

main();
