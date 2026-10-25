// Muñeco 3D diminuto que se rasteriza a pixel art indexado (TP219). Unidades = píxeles del sprite. Mundo: X este,
// Y norte (lejos de la cámara), Z arriba. Proyección oblicua: pantalla_x = X, pantalla_arriba = Z + K·Y (K = 0,5),
// como las vistas cenitales «altas» de los 90: el jugador se ve de cuerpo entero y el fondo del campo sube.
import { INDEX, RAMP_ROLES, SHIRT_BITS, type RampRole } from '../../src/match/renderers/sensible/palette.ts';

export type V3 = [number, number, number];
export type M3 = [number, number, number, number, number, number, number, number, number]; // filas

export const K = 0.5;
const deg = Math.PI / 180;
export const rad = (d: number) => d * deg;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mul = (A: M3, B: M3): M3 => {
  const r = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return r;
};
export const ap = (M: M3, v: V3): V3 => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const apT = (M: M3, v: V3): V3 => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
export const rotX = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
export const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---------- Materiales ----------

/** base + tono·stride = índice de paleta. */
export type Mat = Readonly<{ base: number; stride: number; flat?: boolean;
  /** Oscurece el tono (rizos). */ bias?: number;
  /** Marca libre por píxel que el generador lee después (dorso o pecho para el dorsal). */ tag?: number }>;
export const ramp = (role: RampRole): Mat => ({ base: RAMP_ROLES[role], stride: 1 });
export const shirt = (bits: number): Mat => ({ base: INDEX.shirt + bits, stride: 16 });
export const fixed = (index: number): Mat => ({ base: index, stride: 0, flat: true });

type Hit = { t: number; n: V3; p: V3 };
export type Prim = Readonly<{
  part: number;
  hit(o: V3, d: V3): Hit | null;
  mat(p: V3, n: V3): Mat;
}>;

export function sphere(part: number, c: V3, r: number, mat: (local: V3, n: V3) => Mat, frame: M3 = I3): Prim {
  return {
    part,
    hit(o, d) {
      const oc = sub(o, c), b = dot(oc, d), cc = dot(oc, oc) - r * r, h = b * b - cc;
      if (h < 0) return null;
      const t = -b - Math.sqrt(h), p = add(o, scale(d, t));
      return { t, p, n: norm(sub(p, c)) };
    },
    mat(p, n) { return mat(apT(frame, scale(sub(p, c), 1 / r)), n); },
  };
}

export function ellipsoid(part: number, c: V3, radii: V3, frame: M3, mat: (local: V3, n: V3) => Mat): Prim {
  return {
    part,
    hit(o, d) {
      const lo = apT(frame, sub(o, c)), ld = apT(frame, d);
      const so: V3 = [lo[0] / radii[0], lo[1] / radii[1], lo[2] / radii[2]], sd: V3 = [ld[0] / radii[0], ld[1] / radii[1], ld[2] / radii[2]];
      const a = dot(sd, sd), b = dot(so, sd), cc = dot(so, so) - 1, h = b * b - a * cc;
      if (h < 0) return null;
      const t = (-b - Math.sqrt(h)) / a, p = add(o, scale(d, t));
      const lp = apT(frame, sub(p, c));
      const ln: V3 = [lp[0] / radii[0] ** 2, lp[1] / radii[1] ** 2, lp[2] / radii[2] ** 2];
      return { t, p, n: norm(ap(frame, ln)) };
    },
    mat(p, n) { const lp = apT(frame, sub(p, c)); return mat([lp[0] / radii[0], lp[1] / radii[1], lp[2] / radii[2]], n); },
  };
}

/** Cápsula a→b de radio r; `mat` recibe la fracción u∈[0,1] a lo largo del eje. */
export function capsule(part: number, a: V3, b: V3, r: number, mat: (u: number, n: V3) => Mat): Prim {
  const ba = sub(b, a), baba = dot(ba, ba);
  return {
    part,
    hit(ro, rd) {
      const oa = sub(ro, a), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
      const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
      let t = -1;
      if (A > 1e-9) {
        const h = B * B - A * C;
        if (h < 0) return null;
        t = (-B - Math.sqrt(h)) / A;
        const y = baoa + t * bard;
        if (!(y > 0 && y < baba)) t = -1;
      }
      if (t < 0) {
        let best = -1;
        for (const cap of [a, b]) {
          const oc = sub(ro, cap), bb = dot(rd, oc), cc = dot(oc, oc) - r * r, h = bb * bb - cc;
          if (h > 0) { const tt = -bb - Math.sqrt(h); if (best < 0 || tt < best) best = tt; }
        }
        if (best < 0) return null;
        t = best;
      }
      const p = add(ro, scale(rd, t));
      const u = Math.max(0, Math.min(1, dot(sub(p, a), ba) / baba));
      return { t, p, n: norm(sub(p, add(a, scale(ba, u)))) };
    },
    mat(p, n) { const u = Math.max(0, Math.min(1, dot(sub(p, a), ba) / baba)); return mat(u, n); },
  };
}

// ---------- Rasterizado ----------

export const LIGHT: V3 = norm([-0.6, -0.5, 0.75]);
export type Raster = Readonly<{ w: number; h: number; ax: number; ay: number; idx: Uint8Array; tag?: Uint8Array }>;
export type RasterOptions = Readonly<{ size?: number; ax?: number; ay?: number; ss?: number; coverage?: number;
  hi?: number; lo?: number; outline?: boolean; selout?: number }>;

/**
 * Lanza rayos ortográficos oblicuos con supermuestreo, decide material y tono por moda, añade «selout» (el píxel que
 * queda detrás de una pieza más cercana pasa a su tono de sombra) y el contorno exterior de 1 px.
 */
export function rasterize(prims: readonly Prim[], opt: RasterOptions = {}): Raster {
  const size = opt.size ?? 48, ax = opt.ax ?? 24, ay = opt.ay ?? 36, ss = opt.ss ?? 4;
  const need = opt.coverage ?? 0.3, hi = opt.hi ?? 0.66, lo = opt.lo ?? 0.06;
  const dir = norm([0, 1, -K]);
  const n = size * size;
  const matOf: (Mat | null)[] = new Array(n).fill(null), tone = new Uint8Array(n), depth = new Float32Array(n).fill(Infinity), part = new Int16Array(n).fill(-1);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const votes = new Map<string, { m: Mat; tone: number; count: number; t: number; part: number; centre: number }>();
    let hits = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const X = px - ax + (sx + .5) / ss, U = ay - (py + (sy + .5) / ss);
      const o: V3 = [X, -200, U + K * 200];
      let best: Hit | null = null, bp: Prim | null = null;
      for (const pr of prims) { const h = pr.hit(o, dir); if (h && h.t > 0 && (!best || h.t < best.t)) { best = h; bp = pr; } }
      if (!best || !bp) continue;
      hits++;
      const m = bp.mat(best.p, best.n);
      const l = dot(best.n, LIGHT);
      const tn = m.flat ? 0 : Math.min(2, (l > hi ? 0 : l > lo ? 1 : 2) + (m.bias ?? 0));
      const key = `${m.base}:${m.stride}:${tn}`;
      const centre = Math.abs(sx - (ss - 1) / 2) + Math.abs(sy - (ss - 1) / 2);
      const v = votes.get(key);
      if (v) { v.count++; v.t = Math.min(v.t, best.t); v.centre = Math.min(v.centre, centre); }
      else votes.set(key, { m, tone: tn, count: 1, t: best.t, part: bp.part, centre });
    }
    if (hits < need * ss * ss) continue;
    let win: { m: Mat; tone: number; count: number; t: number; part: number; centre: number } | null = null;
    for (const v of votes.values()) if (!win || v.count > win.count || (v.count === win.count && v.centre < win.centre)) win = v;
    if (!win) continue;
    const i = py * size + px;
    matOf[i] = win.m; tone[i] = win.tone; depth[i] = win.t; part[i] = win.part;
  }
  // Selout: un píxel tapado parcialmente por una pieza bastante más cercana se oscurece (lee la superposición).
  const selout = opt.selout ?? 1.6;
  const tone2 = tone.slice();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x; const m = matOf[i];
    if (!m || m.flat) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const j = yy * size + xx;
      if (matOf[j] && part[j] !== part[i] && depth[i] - depth[j] > selout) { tone2[i] = 2; break; }
    }
  }
  const idx = new Uint8Array(n), tag = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const m = matOf[i]; if (m) { idx[i] = m.base + tone2[i] * m.stride; tag[i] = m.tag ?? 0; } }
  if (opt.outline !== false) addOutline(idx, size, size);
  return { w: size, h: size, ax, ay, idx, tag };
}

export function addOutline(idx: Uint8Array, w: number, h: number) {
  const src = idx.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (src[i] !== 0) continue;
    const solid = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && src[yy * w + xx] !== 0 && src[yy * w + xx] !== INDEX.shadow;
    if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1)) idx[i] = INDEX.outline;
  }
}

export { SHIRT_BITS, add, sub, scale, norm, dot };
