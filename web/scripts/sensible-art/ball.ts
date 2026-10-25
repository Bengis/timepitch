// Balón (3 tamaños × 4 fotogramas de giro) y sombras de suelo (TP219). Pintado píxel a píxel sobre una esfera con
// los 12 pentágonos de un balón clásico; el giro de 18° por fotograma cierra el ciclo (simetría de 72°).
import { INDEX } from '../../src/match/renderers/sensible/palette.ts';
import { addOutline, type Raster } from './rig.ts';

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO: [number, number, number][] = [];
for (const a of [-1, 1]) for (const b of [-PHI, PHI]) ICO.push([0, a, b], [a, b, 0], [b, 0, a]);
const ICO_N = ICO.map(v => { const l = Math.hypot(...v); return v.map(c => c / l) as [number, number, number]; });
// Se lleva un vértice (eje de 5 pliegues) al eje X de pantalla y se gira alrededor de él: el balón rueda hacia
// arriba/abajo y 4 × 18° = 72° cierra el ciclo. Un pequeño giro previo evita que el patrón quede simétrico.
const X: [number, number, number] = [1, 0, 0];
function align(v: [number, number, number]) {
  const a = ICO_N[0], k = [a[1] * X[2] - a[2] * X[1], a[2] * X[0] - a[0] * X[2], a[0] * X[1] - a[1] * X[0]];
  const l = Math.hypot(...k), ang = Math.acos(a[0]);
  return rotateAbout(v, k.map(c => c / l) as [number, number, number], ang);
}

function rotateAbout(v: [number, number, number], k: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d * (1 - c)) as [number, number, number];
}

export const BALL_SIZES = { s: 4, m: 5, l: 6 } as const;

export function ballRaster(d: number, frame: number): Raster {
  const pad = 1, w = d + pad * 2, idx = new Uint8Array(w * w), r = d / 2;
  const centres = ICO_N.map(c => rotateAbout(align(c), X, .35));
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const nx = (x + .5 - r) / r, ny = -(y + .5 - r) / r, q = nx * nx + ny * ny;
    if (q > (d <= 4 ? 1.05 : .98)) continue;
    const n: [number, number, number] = [nx, ny, Math.sqrt(Math.max(0, 1 - q))];
    const p = rotateAbout(n, X, -frame * Math.PI / 10);
    const near = Math.max(...centres.map(c => c[0] * p[0] + c[1] * p[1] + c[2] * p[2]));
    const light = -.55 * nx + .55 * ny + .62 * n[2];
    // TP220 pulido: a 4–6 px los paneles casi negros convertían el balón en un dado o una calavera y, en movimiento,
    // en una mancha gris. Ahora el balón es blanco y redondo: en el pequeño el giro se marca con un píxel gris claro;
    // en el mediano, con gris claro, y en el grande, con paneles de un gris oscuro (nunca el negro del contorno).
    const panel = near > (d <= 4 ? .985 : .975);
    let i: number;
    if (panel) i = d <= 5 ? INDEX.ballLight : INDEX.ballPanel;
    else i = light > -.2 ? INDEX.ballWhite : INDEX.ballLight;
    idx[(y + pad) * w + x + pad] = i;
  }
  addOutline(idx, w, w);
  return { w, h: w, ax: pad + Math.floor(r), ay: pad + Math.floor(r), idx };
}

export function ballSprites() {
  const out: { key: string; raster: Raster }[] = [];
  for (const [name, d] of Object.entries(BALL_SIZES)) for (let f = 0; f < 4; f++) out.push({ key: `ball.${name}.${f}`, raster: ballRaster(d, f) });
  return out;
}

function ellipse(rx: number, ry: number): Raster {
  const w = Math.ceil(rx * 2) + 2, h = Math.ceil(ry * 2) + 2, idx = new Uint8Array(w * h), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry;
    if (dx * dx + dy * dy <= 1) idx[y * w + x] = INDEX.shadow;
  }
  return { w, h, ax: Math.floor(cx), ay: Math.floor(cy), idx };
}

/** Sombras planas (índice `shadow`, el renderer las pinta translúcidas). `long` sirve para planchas y estiradas. */
export function shadowSprites() {
  return [
    { key: 'shadow.player', raster: ellipse(4.5, 1.9) },
    { key: 'shadow.long', raster: ellipse(8, 2.2) },
    { key: 'shadow.ball-s', raster: ellipse(2.2, 1.1) },
    { key: 'shadow.ball-m', raster: ellipse(2.6, 1.3) },
    { key: 'shadow.ball-l', raster: ellipse(3, 1.5) },
  ];
}
