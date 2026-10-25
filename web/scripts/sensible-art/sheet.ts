// Hojas de contacto: rejilla de fotogramas recoloreados y ampliados con vecino más cercano.
import { applyPalette } from '../../src/match/renderers/sensible/palette.ts';
import type { Raster } from './rig.ts';

export type SheetCell = Readonly<{ raster: Raster; lut: Uint8ClampedArray }>;

export function contactSheet(rows: readonly (readonly SheetCell[])[], opts: { zoom?: number; pad?: number; bg?: [number, number, number]; bg2?: [number, number, number] } = {}) {
  const zoom = opts.zoom ?? 4, pad = opts.pad ?? 3;
  // Celdas alineadas por el ancla (los fotogramas de una animación no «bailan»), recortadas a lo que se dibuja.
  const box = (r: Raster) => { let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.idx[y * r.w + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return x1 < 0 ? { l: 0, r: 0, t: 0, b: 0 } : { l: r.ax - x0, r: x1 - r.ax + 1, t: r.ay - y0, b: y1 - r.ay + 1 }; };
  const boxes = rows.flat().map(c => box(c.raster));
  const L = Math.max(...boxes.map(b => b.l)), R = Math.max(...boxes.map(b => b.r)), T = Math.max(...boxes.map(b => b.t)), B = Math.max(...boxes.map(b => b.b));
  const cw = L + R, ch = T + B;
  const cols = Math.max(...rows.map(r => r.length));
  const W = (cols * (cw + pad) + pad) * zoom, H = (rows.length * (ch + pad) + pad) * zoom;
  const out = new Uint8ClampedArray(W * H * 4);
  const bg = opts.bg ?? [58, 120, 50], bg2 = opts.bg2 ?? [50, 108, 44];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = Math.floor(y / (zoom * 16)) % 2 ? bg2 : bg, i = (y * W + x) * 4;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
  rows.forEach((row, ry) => row.forEach((cell, rx) => {
    const { raster, lut } = cell;
    const rgba = applyPalette(raster.idx, lut);
    const ox = pad + rx * (cw + pad) + L - raster.ax, oy = pad + ry * (ch + pad) + T - raster.ay;
    for (let y = 0; y < raster.h; y++) for (let x = 0; x < raster.w; x++) {
      if (ox + x < pad + rx * (cw + pad) || oy + y < pad + ry * (ch + pad) || ox + x >= pad + rx * (cw + pad) + cw || oy + y >= pad + ry * (ch + pad) + ch) continue;
      const s = (y * raster.w + x) * 4, a = rgba[s + 3] / 255;
      if (a === 0) continue;
      for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) {
        const d = (((oy + y) * zoom + zy) * W + (ox + x) * zoom + zx) * 4;
        for (let k = 0; k < 3; k++) out[d + k] = Math.round(rgba[s + k] * a + out[d + k] * (1 - a));
      }
    }
  }));
  return { w: W, h: H, rgba: out };
}
