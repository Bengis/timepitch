// Campo vertical, estadio y piezas del escenario del estilo «Clásico 16 bits» (TP219). Arte propio: césped con
// franjas de corte, líneas de 2 px, vallas con lemas inventados, grada con público y porterías con red en rombos.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPaletteLUT, FIXED_COLOURS, INDEX, PREVIEW_KIT, PREVIEW_LOOK, hexToRgb } from '../../src/match/renderers/sensible/palette.ts';
import { drawText, GLYPHS } from './font.ts';
import { addOutline, type Raster } from './rig.ts';
import { encodeRGBA } from './png.ts';
import { contactSheet } from './sheet.ts';

export const PX_PER_M = 8;
const PW = 68 * PX_PER_M, PL = 105 * PX_PER_M;
const RUN_SIDE = 24, RUN_END = 40, BOARD_SIDE = 8, BOARD_END = 12, WALL = 3, CROWD = 56;
const OX = RUN_SIDE + BOARD_SIDE + WALL + CROWD, OY = RUN_END + BOARD_END + WALL + CROWD;
const W = PW + OX * 2, H = PL + OY * 2;
/** Altura de la portería en pantalla (2,44 m estilizados para que el jugador de 16 px quepa con holgura). */
const GOAL_H = 20, GOAL_W = Math.round(7.32 * PX_PER_M), NET_D = 2 * PX_PER_M, NET_BACK_H = 12;

type C = [number, number, number];
const GRASS_LIGHT: C = [84, 160, 58], GRASS_DARK: C = [70, 142, 46], LINE: C = [238, 244, 228];

/** Ruido determinista (mismo resultado en cada ejecución). */
function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const shade = (c: C, k: number): C => c.map(v => Math.max(0, Math.min(255, Math.round(v * k)))) as C;

class Img {
  rgba: Uint8ClampedArray; w: number; h: number;
  constructor(w: number, h: number) { this.w = w; this.h = h; this.rgba = new Uint8ClampedArray(w * h * 4); }
  set(x: number, y: number, c: C, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (a === 255) { this.rgba[i] = c[0]; this.rgba[i + 1] = c[1]; this.rgba[i + 2] = c[2]; this.rgba[i + 3] = 255; return; }
    const t = a / 255;
    for (let k = 0; k < 3; k++) this.rgba[i + k] = Math.round(c[k] * t + this.rgba[i + k] * (1 - t));
    this.rgba[i + 3] = 255;
  }
  rect(x: number, y: number, w: number, h: number, c: C) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  blit(src: Img, dx: number, dy: number) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4; if (src.rgba[i + 3]) this.set(dx + x, dy + y, [src.rgba[i], src.rgba[i + 1], src.rgba[i + 2]]);
    }
  }
}

// ---------- Piezas (también se exportan como teselas sueltas) ----------

function grassTile(stripe: 0 | 1, w = 16, h = 16, x0 = 0, y0 = 0): Img {
  const img = new Img(w, h), base = stripe ? GRASS_DARK : GRASS_LIGHT;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = hash(x + x0, y + y0, 1);
    // Briznas: puntos sueltos un tono arriba/abajo, con un ligero sesgo vertical (corte del césped).
    const c = r < .035 ? shade(base, 1.09) : r < .07 ? shade(base, .91) : hash(x + x0, Math.floor((y + y0) / 2), 2) < .03 ? shade(base, .95) : base;
    img.set(x, y, c);
  }
  return img;
}

const CROWD_SHIRTS: C[] = [[200, 40, 46], [200, 40, 46], [40, 80, 170], [40, 80, 170], [236, 236, 230], [250, 200, 40], [30, 30, 36], [90, 160, 220], [120, 40, 70], [60, 140, 70]];
const CROWD_SKIN: C[] = [[243, 210, 182], [221, 171, 134], [200, 145, 106], [168, 114, 77], [134, 84, 55], [102, 63, 42]];
const STAND: C = [62, 64, 74], STAND_STEP: C = [44, 46, 54], SEAT: C = [92, 96, 110];

/** Grada: filas de 6 px; cada aficionado es cabeza 2×2 + cuerpo 3×2. `cheer` levanta brazos y cabezas 1 px. */
function crowdTile(w: number, h: number, seed: number, cheer = false): Img {
  const img = new Img(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(x, y, y % 6 === 5 ? STAND_STEP : STAND);
  for (let row = 0; row * 6 < h; row++) for (let col = 0; col * 4 < w; col++) {
    const r = hash(col, row, seed), x = col * 4 + (row % 2 ? 2 : 0), y = row * 6;
    if (r < .1) { img.rect(x, y + 3, 3, 2, SEAT); continue; }
    const up = cheer && hash(col, row, seed + 7) < .55 ? 1 : 0;
    const shirt = CROWD_SHIRTS[Math.floor(hash(col, row, seed + 1) * CROWD_SHIRTS.length)];
    const skin = CROWD_SKIN[Math.floor(hash(col, row, seed + 2) * CROWD_SKIN.length)];
    img.rect(x, y + 3 - up, 3, 2, shirt); img.set(x, y + 3 - up, shade(shirt, 1.15));
    img.rect(x, y + 1 - up, 2, 2, skin); img.set(x + 1, y + 2 - up, shade(skin, .82));
    if (hash(col, row, seed + 3) < .5) img.rect(x, y + 1 - up, 2, 1, shade(skin, .45)); // pelo
    if (up) { img.set(x - 1, y - 1, skin); img.set(x + 3, y - 1, skin); img.set(x - 1, y, shirt); img.set(x + 3, y, shirt); }
  }
  return img;
}

const BOARD_DESIGNS: { text: string; bg: C; fg: C; edge: C }[] = [
  { text: 'TIMEPITCH', bg: [20, 40, 120], fg: [255, 214, 60], edge: [255, 255, 255] },
  { text: '16 BITS', bg: [200, 30, 40], fg: [255, 255, 255], edge: [255, 214, 60] },
  { text: 'RETRO CUP', bg: [255, 214, 60], fg: [20, 20, 30], edge: [200, 30, 40] },
  { text: 'GOL!', bg: [30, 140, 70], fg: [255, 255, 255], edge: [20, 20, 30] },
];

/** Valla del fondo vista de frente (52×12): borde superior claro, lema con la letra propia. */
function boardFront(d: typeof BOARD_DESIGNS[number], w = 80): Img {
  const img = new Img(w, BOARD_END);
  img.rect(0, 0, w, BOARD_END, d.bg); img.rect(0, 0, w, 1, d.edge); img.rect(0, BOARD_END - 1, w, 1, shade(d.bg, .55));
  // Lema con la letra 5×7 sin engordar (6 px de avance), centrado y con sombra de 1 px.
  const tw = d.text.length * 6 - 1, x0 = Math.floor((w - tw) / 2);
  [...d.text].forEach((ch, n) => (GLYPHS[ch] ?? GLYPHS[' ']).forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '#') return;
    img.set(x0 + n * 6 + x + 1, y + 3, shade(d.bg, .55)); img.set(x0 + n * 6 + x, y + 2, d.fg);
  })));
  return img;
}
function boardBack(w = 80): Img {
  const img = new Img(w, BOARD_END);
  img.rect(0, 0, w, BOARD_END, [70, 72, 80]); img.rect(0, 0, w, 1, [130, 134, 144]);
  for (let x = 6; x < w; x += 16) img.rect(x, 2, 2, BOARD_END - 3, [52, 54, 60]);
  return img;
}
/** Valla lateral vista desde arriba (8 de ancho): canto claro y bloques de color por anunciante. */
function boardSide(d: typeof BOARD_DESIGNS[number], h = 48, mirror = false): Img {
  const img = new Img(BOARD_SIDE, h);
  img.rect(0, 0, BOARD_SIDE, h, d.bg);
  img.rect(mirror ? BOARD_SIDE - 2 : 0, 0, 2, h, d.edge);
  for (let y = 6; y < h - 6; y += 4) img.rect(mirror ? 1 : 3, y, 4, 2, d.fg);
  img.rect(0, 0, BOARD_SIDE, 1, shade(d.bg, .6));
  return img;
}

// ---------- Campo completo ----------

export function renderPitch() {
  const img = new Img(W, H);
  const grassL = grassTile(0, W, H), grassD = grassTile(1, W, H);
  const band = 42; // 105 m / 20 franjas = 5,25 m
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const stripe = Math.floor((y - OY + band * 40) / band) % 2;
    const src = stripe ? grassD : grassL, i = (y * W + x) * 4;
    img.set(x, y, [src.rgba[i], src.rgba[i + 1], src.rgba[i + 2]]);
  }
  const m = (v: number) => v * PX_PER_M;
  const line = (x: number, y: number, w: number, h: number) => img.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), LINE);
  const X = (mx: number) => OX + m(mx), Y = (my: number) => OY + m(my); // my desde la línea de fondo norte
  // Banda y fondo (2 px hacia dentro del rectángulo de juego).
  line(X(0), Y(0), PW, 2); line(X(0), Y(105) - 2, PW, 2); line(X(0), Y(0), 2, PL); line(X(68) - 2, Y(0), 2, PL);
  line(X(0), Y(52.5) - 1, PW, 2);
  const ring = (cx: number, cy: number, r: number, keep: (x: number, y: number) => boolean) => {
    for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      const d = Math.hypot(x + .5 - cx, y + .5 - cy);
      if (d <= r && d > r - 2 && keep(x, y)) img.set(x, y, LINE);
    }
  };
  const disc = (cx: number, cy: number, r: number) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x + .5 - cx, y + .5 - cy) <= r) img.set(x, y, LINE); };
  ring(X(34), Y(52.5), m(9.15), () => true); disc(X(34), Y(52.5), 1.6);
  for (const end of [0, 1] as const) {
    const gy = end ? Y(105) : Y(0), dir = end ? -1 : 1; // dir: hacia el centro del campo
    const box = (wm: number, dm: number) => {
      const x0 = X(34 - wm / 2), x1 = X(34 + wm / 2), y1 = gy + dir * m(dm);
      line(x0, Math.min(gy, y1), 2, Math.abs(y1 - gy)); line(x1 - 2, Math.min(gy, y1), 2, Math.abs(y1 - gy));
      line(x0, end ? y1 : y1 - 2, x1 - x0, 2);
    };
    box(40.32, 16.5); box(18.32, 5.5);
    const spotY = gy + dir * m(11);
    disc(X(34), spotY, 1.6);
    const edge = gy + dir * m(16.5);
    ring(X(34), spotY, m(9.15), (_x, y) => (end ? y < edge - 2 : y >= edge + 2));
    // Suelo bajo la red, algo más oscuro (sombra de la red).
    const ny0 = end ? gy : gy - NET_D;
    for (let y = ny0; y < ny0 + NET_D; y++) for (let x = X(34) - GOAL_W / 2; x < X(34) + GOAL_W / 2; x++) {
      if ((x + y) % 2 === 0) img.set(x, y, [0, 0, 0], 26);
    }
  }
  for (const [cx, cy] of [[X(0), Y(0)], [X(68), Y(0)], [X(0), Y(105)], [X(68), Y(105)]] as const) {
    ring(cx, cy, m(1) + 1, (x, y) => x >= X(0) && x < X(68) && y >= Y(0) && y < Y(105));
  }
  // Vallas.
  const boardsN = OY - RUN_END - BOARD_END, boardsS = OY + PL + RUN_END;
  for (let x = OX - RUN_SIDE, k = 0; x < OX + PW + RUN_SIDE; x += 80, k++) {
    img.blit(boardFront(BOARD_DESIGNS[k % 4]), x, boardsN);
    img.blit(boardBack(), x, boardsS);
  }
  const bx0 = OX - RUN_SIDE - BOARD_SIDE, bx1 = OX + PW + RUN_SIDE;
  for (let y = OY - RUN_END, k = 0; y < OY + PL + RUN_END; y += 48, k++) {
    img.blit(boardSide(BOARD_DESIGNS[(k + 1) % 4]), bx0, y);
    img.blit(boardSide(BOARD_DESIGNS[(k + 3) % 4], 48, true), bx1, y);
  }
  // Muro de grada y público alrededor.
  const WALL_C: C = [138, 142, 150], WALL_D: C = [96, 100, 108];
  const crowd = crowdTile(W, H, 11);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inner = x >= bx0 - WALL && x < bx1 + BOARD_SIDE + WALL && y >= boardsN - WALL && y < boardsS + BOARD_END + WALL;
    const inBoards = x >= bx0 && x < bx1 + BOARD_SIDE && y >= boardsN && y < boardsS + BOARD_END;
    if (!inner) { const i = (y * W + x) * 4; img.set(x, y, [crowd.rgba[i], crowd.rgba[i + 1], crowd.rgba[i + 2]]); }
    else if (!inBoards) img.set(x, y, (y >= boardsS + BOARD_END || x >= bx1 + BOARD_SIDE) ? WALL_D : WALL_C);
  }
  const meta = {
    image: 'pitch.png', width: W, height: H, pxPerMetre: PX_PER_M, case: 'TP219',
    orientation: 'Vertical: la portería «norte» arriba. Las líneas ocupan 2 px hacia dentro del rectángulo de juego.',
    field: { x: OX, y: OY, w: PW, h: PL, note: 'Rectángulo de juego (68 × 105 m). px = x + ancho_m·8, py = y + (105 − largo_m)·8 si el largo se mide desde la portería sur.' },
    goals: {
      north: { x: OX + PW / 2, y: OY, sprites: { net: 'env.goal-n-net', frame: 'env.goal-n-frame' }, depthSort: 'net antes que todo; frame ordenado en la línea de gol' },
      south: { x: OX + PW / 2, y: OY + PL, sprites: { frame: 'env.goal-s-frame', net: 'env.goal-s-net' }, depthSort: 'frame ordenado en la línea de gol; net ordenado 2 m por detrás (encima del portero)' },
    },
    corners: [[OX, OY], [OX + PW, OY], [OX, OY + PL], [OX + PW, OY + PL]],
    goalHeightPx: GOAL_H, goalWidthPx: GOAL_W,
  };
  return { w: W, h: H, rgba: img.rgba, meta };
}

// ---------- Sprites indexados del escenario (atlas) ----------

function goal(north: boolean, layer: 'net' | 'frame'): Raster {
  const w = GOAL_W + 8, h = GOAL_H + NET_D + NET_BACK_H + 6, ax = Math.floor(w / 2);
  const ay = north ? GOAL_H + NET_D + 4 : GOAL_H + 3; // línea de gol dentro del rectángulo
  const idx = new Uint8Array(w * h);
  const put = (x: number, y: number, i: number) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) idx[y * w + x] = i; };
  const left = ax - Math.floor(GOAL_W / 2), right = left + GOAL_W - 1;
  const mesh = (x: number, y: number) => ((x + y) % 4 === 0 || (x - y + 400) % 4 === 0);
  // Proyección: pantalla_y = línea − Y·8 − Z·(GOAL_H/2,44); Y hacia fuera del campo (+ al norte para la norte).
  const sy = (yOut: number, z: number) => ay - (north ? yOut : -yOut) - z;
  if (layer === 'net') {
    // Red trasera, techo y laterales (tramas de rombos); la trasera es más oscura (más lejos de la luz).
    for (let x = left; x <= right; x++) {
      const yb0 = sy(NET_D, 0), yb1 = sy(NET_D, NET_BACK_H);
      for (let y = Math.min(yb0, yb1); y <= Math.max(yb0, yb1); y++) if (mesh(x, y)) put(x, y, INDEX.netShade);
      const yr0 = sy(0, GOAL_H), yr1 = sy(NET_D, NET_BACK_H);
      for (let y = Math.min(yr0, yr1); y <= Math.max(yr0, yr1); y++) if (mesh(x, y)) put(x, y, INDEX.net);
      put(x, yb1, INDEX.net); if (!north) put(x, yb0, INDEX.netShade);
    }
    for (const x of [left, right]) {
      for (let t = 0; t <= NET_D; t++) {
        const top = sy(t, GOAL_H + (NET_BACK_H - GOAL_H) * t / NET_D), bot = sy(t, 0);
        for (let y = Math.min(top, bot); y <= Math.max(top, bot); y++) if (mesh(x + (north ? 0 : t), y + t)) put(x, y, INDEX.netShade);
        put(x, top, INDEX.net);
      }
    }
  } else {
    // Postes (2 px, cara iluminada a la izquierda) y larguero.
    for (const x of [left - 1, right]) for (let z = 0; z <= GOAL_H; z++) { put(x, sy(0, z), INDEX.post); put(x + 1, sy(0, z), INDEX.postShade); }
    for (let x = left - 1; x <= right + 1; x++) { put(x, sy(0, GOAL_H), INDEX.post); put(x, sy(0, GOAL_H) + 1, INDEX.postShade); }
  }
  if (layer === 'frame') addOutline(idx, w, h);
  return { w, h, ax, ay, idx };
}

function cornerFlag(frame: number): Raster {
  const w = 10, h = 16, ax = 2, ay = 14, idx = new Uint8Array(w * h);
  for (let y = 2; y <= ay; y++) idx[y * w + ax] = y % 4 === 0 ? INDEX.postShade : INDEX.post;
  const shape = frame === 0 ? ['###.', '####', '##..'] : ['##..', '####', '###.'];
  shape.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') idx[(2 + j) * w + ax + 1 + i] = (i + j) % 2 ? INDEX.flagLight : INDEX.flag; }));
  addOutline(idx, w, h);
  return { w, h, ax, ay, idx };
}

export function environmentSprites() {
  const sprites: { key: string; raster: Raster }[] = [
    { key: 'env.goal-n-net', raster: goal(true, 'net') }, { key: 'env.goal-n-frame', raster: goal(true, 'frame') },
    { key: 'env.goal-s-net', raster: goal(false, 'net') }, { key: 'env.goal-s-frame', raster: goal(false, 'frame') },
    { key: 'env.flag.0', raster: cornerFlag(0) }, { key: 'env.flag.1', raster: cornerFlag(1) },
  ];
  const chars = Object.keys(GLYPHS).filter(c => c !== ' ');
  for (const ch of chars) {
    const t = drawText(ch, INDEX.fontFill, INDEX.fontShade, INDEX.outline);
    const name = /[A-Z0-9]/.test(ch) ? ch : `u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    sprites.push({ key: `env.font.${name}`, raster: { w: t.w - 0, h: t.h, ax: 0, ay: 0, idx: t.idx } });
  }
  const meta = {
    goals: 'env.goal-{n,s}-{net,frame}: ancla = centro de la línea de gol. Pintar con las reglas de pitch.json → goals.',
    flags: 'env.flag.{0,1}: banderín de córner (2 fotogramas, 4 fps); ancla = pie del mástil.',
    font: 'env.font.<CHAR>: letra propia 5×7 engordada; avance 8 px; signos con su código: u003a «:», u002d «-», u002e «.», u0021 «!», u0027 «\'», u002f «/».',
    tiles: 'tiles.png + tiles.json: césped claro/oscuro, vallas, grada (2 fotogramas para celebrar) y muro.',
  };
  return {
    sprites, meta,
    sheet(dir: string) {
      const lut = buildPaletteLUT(PREVIEW_KIT, PREVIEW_LOOK);
      const s = contactSheet([sprites.slice(0, 6).map(sp => ({ raster: sp.raster, lut }))], { zoom: 4 });
      writeFileSync(resolve(dir, 'sheet-env.png'), encodeRGBA(s.w, s.h, s.rgba));
      const text = drawText('TIMEPITCH 2-1 45:00', INDEX.fontFill, INDEX.fontShade, INDEX.outline);
      const f = contactSheet([[{ raster: { ...text, ax: 0, ay: 0 }, lut }]], { zoom: 4, bg: [20, 24, 40], bg2: [20, 24, 40] });
      writeFileSync(resolve(dir, 'sheet-font.png'), encodeRGBA(f.w, f.h, f.rgba));
    },
  };
}

/** Teselas RGBA sueltas para quien prefiera componer el estadio por piezas. */
export function renderTiles(outDir: string) {
  const parts: [string, Img][] = [
    ['grass-light', grassTile(0)], ['grass-dark', grassTile(1)],
    ...BOARD_DESIGNS.map((d, i) => [`board-front-${i}`, boardFront(d)] as [string, Img]), ['board-back', boardBack()],
    ...BOARD_DESIGNS.map((d, i) => [`board-side-${i}`, boardSide(d)] as [string, Img]),
    ['crowd-0', crowdTile(32, 24, 5)], ['crowd-1', crowdTile(32, 24, 5, true)],
  ];
  const wall = new Img(32, WALL); wall.rect(0, 0, 32, WALL, [138, 142, 150]); wall.rect(0, WALL - 1, 32, 1, [96, 100, 108]);
  parts.push(['stand-wall', wall]);
  const TW = 256; let x = 0, y = 0, row = 0; const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [name, im] of parts) { if (x + im.w > TW) { x = 0; y += row + 1; row = 0; } rects[name] = { x, y, w: im.w, h: im.h }; x += im.w + 1; row = Math.max(row, im.h); }
  const out = new Img(TW, y + row);
  for (const [name, im] of parts) out.blit(im, rects[name].x, rects[name].y);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'tiles.png'), encodeRGBA(out.w, out.h, out.rgba));
  writeFileSync(resolve(outDir, 'tiles.json'), JSON.stringify({ image: 'tiles.png', case: 'TP219', tiles: rects }, null, 1) + '\n');
}

export { FIXED_COLOURS, hexToRgb };
