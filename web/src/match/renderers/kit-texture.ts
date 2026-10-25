import * as THREE from 'three';
import type { KitSpec, PatternFamily } from '../../presentation/types';
import type { DetailLevel } from './types';

// Equipaciones y dorsales del 3D. Patrones procedurales propios (familias de spec §3.2), sin imágenes de Commons;
// dígitos en canvas 2D cuando existe (como `numberTexture` de la maqueta) y, si no, una fuente de mapa de bits propia.

export type KitMaterials = Readonly<{
  shirt: THREE.Material; sleeves: THREE.Material; shorts: THREE.Material; socks: THREE.Material;
  /** Ribete (cuello y puños) en el color `trim` de la equipación. */
  skinTrim: THREE.Material;
  dispose(): void;
}>;

export type NumberAtlas = Readonly<{
  texture: THREE.Texture;
  uvFor(number: string): { u: number; v: number; w: number; h: number } | null;
  dispose(): void;
}>;

function rgb(css: string): [number, number, number] {
  const hex = new THREE.Color().setStyle(css).getHex(THREE.SRGBColorSpace);
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function accentAt(family: PatternFamily, x: number, y: number, size: number): boolean {
  const band = Math.max(1, Math.floor(size / 8));
  switch (family) {
    case 'stripes': return Math.floor(x / band) % 2 === 1;
    case 'hoops': return Math.floor(y / band) % 2 === 1;
    case 'halves': return x >= size / 2;
    case 'sash': return Math.abs(x - y) < size / 6;
    case 'pinstripes': return x % band === Math.floor(band / 2);
    case 'side_panels': return x < band || x >= size - band;
    default: return false; // 'plain' y 'unknown' (se dibuja liso: «patrón simplificado»).
  }
}

/** RGBA `size`×`size` del patrón; pura y determinista. `unknown` es idéntico a `plain`. */
export function patternPixels(family: PatternFamily, base: string, accent: string, size: number): Uint8Array {
  const a = rgb(base), b = rgb(accent), out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = accentAt(family, x, y, size) ? b : a, i = (y * size + x) * 4;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
  return out;
}

const textured = (family: PatternFamily) => family !== 'plain' && family !== 'unknown';

export function createKitMaterials(kit: KitSpec, detail: DetailLevel): KitMaterials {
  const size = detail === 'low' ? 32 : 64;
  const textures: THREE.Texture[] = [];
  function zone(colour: string, family: PatternFamily): THREE.MeshStandardMaterial {
    if (!textured(family)) return new THREE.MeshStandardMaterial({ color: colour, roughness: .6, metalness: 0 });
    const map = new THREE.DataTexture(patternPixels(family, colour, kit.trim, size), size, size);
    map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearFilter; map.needsUpdate = true;
    textures.push(map);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: .6, metalness: 0 });
  }
  const shirt = zone(kit.shirt, kit.pattern.body);
  // Un solo material de mangas por equipo: se usa la izquierda (las asimétricas son raras).
  const sleeves = zone(kit.sleeves.left, kit.pattern.sleeves);
  const shorts = zone(kit.shorts, kit.pattern.shorts);
  const socks = zone(kit.socks, kit.pattern.socks);
  const skinTrim = zone(kit.trim, 'plain');
  let disposed = false;
  return {
    shirt, sleeves, shorts, socks, skinTrim,
    dispose() {
      if (disposed) return; disposed = true;
      for (const texture of textures) texture.dispose();
      for (const material of [shirt, sleeves, shorts, socks, skinTrim]) material.dispose();
    },
  };
}

const COLS = 10, ROWS = 10;
const VALID_NUMBER = /^(?:0|[1-9]\d?)$/;

// Fuente 3×5 propia para el respaldo sin canvas.
const GLYPHS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try { return canvas.getContext('2d'); } catch { return null; }
}

function canvasAtlas(fg: string, trim: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cell = 96, canvas = document.createElement('canvas');
  canvas.width = COLS * cell; canvas.height = ROWS * cell;
  const g = context2d(canvas);
  if (!g) return null;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.font = '700 64px Bahnschrift, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = trim; g.fillStyle = fg;
  for (let n = 0; n < 100; n++) {
    const x = (n % COLS + .5) * cell, y = (Math.floor(n / COLS) + .55) * cell;
    g.strokeText(String(n), x, y); g.fillText(String(n), x, y);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function bitmapAtlas(fg: string, trim: string): THREE.DataTexture {
  const cell = 32, scale = 4, width = COLS * cell, height = ROWS * cell;
  const data = new Uint8Array(width * height * 4), ink = new Uint8Array(width * height);
  // `ink` en coordenadas de imagen (fila 0 arriba): 1 = cifra, 2 = ribete.
  for (let n = 0; n < 100; n++) {
    const digits = String(n), glyphW = 3 * scale, gap = scale;
    const totalW = digits.length * glyphW + (digits.length - 1) * gap;
    const x0 = (n % COLS) * cell + Math.floor((cell - totalW) / 2), y0 = Math.floor(n / COLS) * cell + Math.floor((cell - 5 * scale) / 2);
    [...digits].forEach((d, k) => {
      const glyph = GLYPHS[Number(d)];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (glyph[gy * 3 + gx] === '1')
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++)
          ink[(y0 + gy * scale + sy) * width + x0 + k * (glyphW + gap) + gx * scale + sx] = 1;
    });
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (ink[y * width + x]) continue;
    for (let dy = -1; dy <= 1 && !ink[y * width + x]; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < height && xx >= 0 && xx < width && ink[yy * width + xx] === 1) { ink[y * width + x] = 2; break; }
    }
  }
  const f = rgb(fg), t = rgb(trim);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const kind = ink[y * width + x];
    if (!kind) continue;
    const c = kind === 1 ? f : t, i = ((height - 1 - y) * width + x) * 4; // DataTexture: fila 0 = v 0 (abajo).
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

/** Atlas 10×10 con los dorsales 0–99 de un equipo; una textura por equipo, no por jugador. */
export function createNumberAtlas(fg: string, trim: string): NumberAtlas {
  const texture = canvasAtlas(fg, trim) ?? bitmapAtlas(fg, trim);
  let disposed = false;
  return {
    texture,
    uvFor(number) {
      if (!VALID_NUMBER.test(number)) return null;
      const n = Number(number), col = n % COLS, row = Math.floor(n / COLS);
      return { u: col / COLS, v: 1 - (row + 1) / ROWS, w: 1 / COLS, h: 1 / ROWS };
    },
    dispose() { if (disposed) return; disposed = true; texture.dispose(); },
  };
}
