import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DetailLevel } from './types';

// Estadio de retransmisión portado de la maqueta aprobada (`.local/mockup/stadium3d.js`, 22-oct): césped segado en
// franjas con textura procedural, líneas, porterías con red, banderines, gradas con público, cubiertas, tiras de
// focos y vallas LED. Todo es arte propio generado en código (sin imágenes ni fuentes externas), determinista y
// fusionado por material para gastar pocas llamadas de dibujo. Las vallas y la fachada solo llevan la marca
// TimePitch: ni clubes, ni patrocinadores, ni nombres de estadios reales.
//
// Se construye en coordenadas centradas (como la maqueta) y la raíz se desplaza al sistema de la app:
// x 0..105 (porterías local/visitante en x=0/105), z 0..68; la cámara mira hacia z decreciente.

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
const HL = PITCH_LENGTH / 2, HW = PITCH_WIDTH / 2;
/** Superficie de hierba texturizada (campo + zona de banda), en metros. */
const AREA_L = 122, AREA_W = 84;
const LINE_HALF_WIDTH = .06;

export const LED_TEXT = 'TIMEPITCH' as const;
export const FACADE_TEXT = LED_TEXT;
export const LED_SEGMENTS: readonly Readonly<{ background: string; foreground: string; text: typeof LED_TEXT }>[] = Object.freeze([
  { background: '#0a1a3a', foreground: '#ffffff', text: LED_TEXT },
  { background: '#c9ff3c', foreground: '#0a0f1a', text: LED_TEXT },
  { background: '#0b4fb3', foreground: '#ffffff', text: LED_TEXT },
  { background: '#101418', foreground: '#34d6b5', text: LED_TEXT },
  { background: '#f4f4f1', foreground: '#0b1a33', text: LED_TEXT },
  { background: '#5b2bd6', foreground: '#ffffff', text: LED_TEXT },
]);

/** Paletas neutras por defecto (sin colores de club). `crowd` en las opciones permite teñir cada fondo. */
const NEUTRAL_CROWD = Object.freeze({
  home: ['#24324d', '#f2f4f8', '#3b5c99', '#1f2a3d', '#a33a3a', '#d8b23a', '#5c6370'],
  away: ['#f3f3f0', '#2b2b2b', '#c9ccd2', '#1f3b2c', '#7a2b3a', '#3a4f7a'],
});
const CROWD_SKINS = ['#f0c8a8', '#e2b08c', '#c98f68', '#9c6a48', '#6b4630', '#f3d2b6'];

export type StadiumOptions = Readonly<{ crowd?: Readonly<{ home?: readonly string[]; away?: readonly string[] }> }>;
export type StadiumArt = Readonly<{ root: THREE.Group; setAnisotropy(level: number): void; dispose(): void }>;

/* ------------------------------------------------------------------ píxeles procedurales (puros) */

export type Pixels = { data: Uint8Array; width: number; height: number };
type Rgb = readonly [number, number, number];

/** Generador determinista (mismo que la maqueta). */
export function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
}
const clampByte = (v: number) => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
function rgb(css: string): Rgb {
  const hex = new THREE.Color().setStyle(css).getHex(THREE.SRGBColorSpace);
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
function blank(width: number, height: number, fill: Rgb, alpha = 255): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([fill[0], fill[1], fill[2], alpha], i * 4);
  return { data, width, height };
}
/** Escribe en coordenadas de lienzo (y hacia abajo); la fila 0 de un DataTexture es la inferior (v = 0). */
function put(target: Pixels, x: number, y: number, c: Rgb, alpha = 1) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const i = ((target.height - 1 - y) * target.width + x) * 4, d = target.data;
  d[i] = clampByte(d[i] + (c[0] - d[i]) * alpha); d[i + 1] = clampByte(d[i + 1] + (c[1] - d[i + 1]) * alpha);
  d[i + 2] = clampByte(d[i + 2] + (c[2] - d[i + 2]) * alpha);
}
function fillRect(target: Pixels, x: number, y: number, w: number, h: number, c: Rgb, alpha = 1) {
  const x0 = Math.round(x), y0 = Math.round(y), x1 = Math.round(x + w), y1 = Math.round(y + h);
  for (let yy = y0; yy < Math.max(y1, y0 + 1); yy++) for (let xx = x0; xx < Math.max(x1, x0 + 1); xx++) put(target, xx, yy, c, alpha);
}
function fillDisc(target: Pixels, cx: number, cy: number, r: number, c: Rgb) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r) put(target, x, y, c);
  }
}

// Fuente de mapa de bits 5×7 con SOLO los glifos de la marca: no se puede escribir otro texto en vallas o fachada.
const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
});

/** Dibuja `text` centrado en (cx, cy) con píxeles de `scale`. Lanza si falta un glifo (solo existe la marca). */
export function drawBitmapText(target: Pixels, text: string, cx: number, cy: number, scale: number, colour: Rgb) {
  const glyphs = [...text].map(ch => {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`No bitmap glyph for "${ch}": boards only carry the TimePitch brand`);
    return glyph;
  });
  const width = (glyphs.length * 6 - 1) * scale, x0 = Math.round(cx - width / 2), y0 = Math.round(cy - 7 * scale / 2);
  glyphs.forEach((glyph, index) => glyph.forEach((row, gy) => [...row].forEach((bit, gx) => {
    if (bit === '1') fillRect(target, x0 + (index * 6 + gx) * scale, y0 + gy * scale, scale, scale, colour);
  })));
}

/** Césped de la maqueta (`grassCanvas`): franjas de siega, cruce suave, desgaste en áreas y ruido. Sin líneas. */
export function grassPixels(detail: DetailLevel): Pixels {
  const ppm = detail === 'low' ? 5 : 8, width = Math.round(AREA_L * ppm), height = Math.round(AREA_W * ppm);
  const out = blank(width, height, [0, 0, 0]), d = out.data, random = seededRandom(7);
  const light: Rgb = [0x3a, 0x82, 0x37], dark: Rgb = [0x2f, 0x6f, 0x2d], stripes = 22, cross = 14;
  const wear: readonly (readonly [number, number, number, number])[] = [
    [-HL + 3, 0, 5, .22], [HL - 3, 0, 5, .22], [-HL + 11, 0, 3, .12], [HL - 11, 0, 3, .12], [0, 0, 4, .08]];
  const GX = 48, GY = 34, grid = Array.from({ length: (GX + 1) * (GY + 1) }, () => random() - .5);
  for (let y = 0; y < height; y++) {
    const mz = y / ppm - AREA_W / 2, fy = y / height * GY, iy = Math.min(GY - 1, fy | 0), ty = fy - iy;
    const crossLight = Math.floor((mz + AREA_W / 2) / (AREA_W / cross)) % 2 === 1;
    for (let x = 0; x < width; x++) {
      const mx = x / ppm - AREA_L / 2;
      const base = Math.floor((mx + AREA_L / 2) / (AREA_L / stripes)) % 2 ? dark : light;
      let r = base[0], g = base[1], b = base[2];
      if (crossLight) { r += (255 - r) * .035; g += (255 - g) * .035; b += (255 - b) * .035; }
      for (const [wx, wz, radius, alpha] of wear) {
        const dist = Math.hypot(mx - wx, mz - wz);
        if (dist < radius) { const a = alpha * (1 - dist / radius); r += (150 - r) * a; g += (140 - g) * a; b += (80 - b) * a; }
      }
      const fx = x / width * GX, ix = Math.min(GX - 1, fx | 0), tx = fx - ix;
      const a = grid[iy * (GX + 1) + ix], bb = grid[iy * (GX + 1) + ix + 1], c = grid[(iy + 1) * (GX + 1) + ix], dd = grid[(iy + 1) * (GX + 1) + ix + 1];
      const low = (a + (bb - a) * tx) * (1 - ty) + (c + (dd - c) * tx) * ty;
      const noise = (random() - .5) * 26 + low * 22, i = (y * width + x) * 4;
      d[i] = clampByte(r + noise * .7); d[i + 1] = clampByte(g + noise); d[i + 2] = clampByte(b + noise * .45); d[i + 3] = 255;
    }
  }
  return out;
}

/** Ruido gris para rugosidad y relieve del césped (`noiseCanvas`). */
export function noisePixels(): Pixels {
  const out = blank(256, 256, [0, 0, 0]), random = seededRandom(3);
  for (let i = 0; i < 256 * 256; i++) { const v = 110 + random() * 120 | 0; out.data.set([v, v, v, 255], i * 4); }
  return out;
}

/** Público en gradas (`crowdCanvas`): filas de asientos con aficionados; `width` 1024 (standard) o 512 (low). */
export function crowdPixels(seed: number, palette: readonly string[], width: number): Pixels {
  if (!palette.length) throw new Error('crowd palette needs at least one colour');
  const colours = palette.map(rgb), skins = CROWD_SKINS.map(rgb), s = width / 1024, random = seededRandom(seed);
  const out = blank(width, width / 2, rgb('#0b1220')), seats = rgb('#1c2433');
  for (let row = 0; row < 32; row++) {
    const y = row * 16 * s;
    fillRect(out, 0, y + 11 * s, width, 5 * s, seats);
    for (let x = 2 * s; x < width; x += (7 + random() * 3) * s) {
      if (random() < .07) continue; // asiento vacío
      const colour = colours[random() * colours.length | 0];
      fillRect(out, x, y + 6 * s, 5 * s, 7 * s, colour);
      fillDisc(out, x + 2.5 * s, y + 4.2 * s, 2.3 * s, skins[random() * skins.length | 0]);
      if (random() < .08) { fillRect(out, x - s, y - 3 * s, 2 * s, 6 * s, colour); fillRect(out, x + 5 * s, y - 3 * s, 2 * s, 6 * s, colour); }
    }
  }
  return out;
}

function bandWithBrand(width: number, height: number, segments: readonly Readonly<{ background: string; foreground: string; text: typeof LED_TEXT }>[], scale: number, scanlines: boolean): Pixels {
  const out = blank(width, height, [0, 0, 0]), w = width / segments.length;
  segments.forEach((segment, index) => {
    fillRect(out, index * w, 0, w, height, rgb(segment.background));
    for (let y = 0; y < height; y++) { // brillo arriba, sombra abajo
      const t = y / (height - 1), light = t < .5 ? .18 * (1 - t * 2) : 0, shade = t > .5 ? .2 * (t - .5) * 2 : 0;
      if (light) fillRect(out, index * w, y, w, 1, [255, 255, 255], light);
      if (shade) fillRect(out, index * w, y, w, 1, [0, 0, 0], shade);
    }
    drawBitmapText(out, segment.text, index * w + w / 2, height / 2 + 1, scale, rgb(segment.foreground));
  });
  if (scanlines) for (let y = 0; y < height; y += 3) fillRect(out, 0, y, width, 1, [0, 0, 0], .22);
  return out;
}

/** Vallas LED (`ledCanvas`): segmentos de color, todos con la marca TimePitch y rejilla de píxeles. */
export function ledPixels(detail: DetailLevel): Pixels {
  return detail === 'low' ? bandWithBrand(1024, 32, LED_SEGMENTS, 3, true) : bandWithBrand(2048, 64, LED_SEGMENTS, 5, true);
}

/** Fachada entre anfiteatros (`facadeCanvas`), con la marca neutra en lugar del nombre de un estadio real. */
export function facadePixels(): Pixels {
  const band = { background: '#0a2c6b', foreground: '#e8eefc', text: FACADE_TEXT } as const;
  return bandWithBrand(2048, 64, [band, band, band, band], 5, false);
}

/** Malla de la red (`netCanvas`): rombo blanco sobre transparente. */
export function netPixels(): Pixels {
  const out = blank(64, 64, [255, 255, 255], 0);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const distance = Math.abs(Math.abs(x + .5 - 32) + Math.abs(y + .5 - 32) - 32);
    if (distance < 1.6) out.data[(y * 64 + x) * 4 + 3] = Math.round(255 * .85);
  }
  return out;
}

/* ------------------------------------------------------------------ geometría */

type V3 = readonly [number, number, number];

function texture(pixels: Pixels, repeat: boolean): THREE.DataTexture {
  const map = new THREE.DataTexture(pixels.data, pixels.width, pixels.height);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
  if (repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true; return map;
}

/** Cuadrilátero indexado (p0..p3 en sentido antihorario) con UV explícitas; compatible con `mergeGeometries`. */
function quad(p: readonly [V3, V3, V3, V3], uv: readonly [number, number][]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals(); return geometry;
}
const repeatUv = (ru: number, rv: number): [number, number][] => [[0, 0], [ru, 0], [ru, rv], [0, rv]];

function placed(geometry: THREE.BufferGeometry, position: V3, rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], quaternion?: THREE.Quaternion) {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
    quaternion ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
  return geometry.clone().applyMatrix4(matrix);
}

type MeshFlags = { cast?: boolean; receive?: boolean };
function fused(parent: THREE.Object3D, name: string, parts: THREE.BufferGeometry[], material: THREE.Material, flags: MeshFlags = {}) {
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (parts.length > 1) for (const part of parts) part.dispose();
  if (!geometry) throw new Error(`stadium: could not merge ${name}`);
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  mesh.castShadow = !!flags.cast; mesh.receiveShadow = !!flags.receive; parent.add(mesh); return mesh;
}

/** Líneas del campo como una sola malla (más nítidas que pintadas en textura a cualquier distancia). */
function markingsGeometry() {
  const positions: number[] = [], indices: number[] = [], y = .025;
  const strip = (points: readonly (readonly [number, number])[]) => {
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i], length = Math.hypot(bx - ax, bz - az);
      if (!length) continue;
      const nx = -(bz - az) / length * LINE_HALF_WIDTH, nz = (bx - ax) / length * LINE_HALF_WIDTH, base = positions.length / 3;
      positions.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx - nx, y, bz - nz, bx + nx, y, bz + nz);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // Las esquinas del rectángulo se prolongan medio ancho de línea para cerrar sin muescas.
  const e = LINE_HALF_WIDTH;
  strip([[-HL - e, -HW], [HL + e, -HW]]); strip([[-HL - e, HW], [HL + e, HW]]);
  strip([[-HL, -HW - e], [-HL, HW + e]]); strip([[HL, -HW - e], [HL, HW + e]]);
  strip([[0, -HW], [0, HW]]);
  const arc = (cx: number, cz: number, r: number, from: number, to: number, steps: number) =>
    strip(Array.from({ length: steps + 1 }, (_, i) => { const a = from + (to - from) * i / steps; return [cx + r * Math.cos(a), cz + r * Math.sin(a)] as const; }));
  arc(0, 0, 9.15, 0, Math.PI * 2, 64);
  const spot = (cx: number, r: number) => {
    const centre = positions.length / 3; positions.push(cx, y, 0);
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; positions.push(cx + r * Math.cos(a), y, r * Math.sin(a)); }
    for (let i = 1; i <= 16; i++) indices.push(centre, centre + i + 1, centre + i);
  };
  spot(0, .16);
  for (const s of [-1, 1]) {
    const gx = s * HL;
    const box = (depth: number, half: number) => strip([[gx, -half], [gx - s * depth, -half], [gx - s * depth, half], [gx, half]]);
    box(16.5, 20.16); box(5.5, 9.16);
    const px = gx - s * 11, a = Math.acos(5.5 / 9.15);
    spot(px, .14);
    if (s < 0) arc(px, 0, 9.15, -a, a, 24); else arc(px, 0, 9.15, Math.PI - a, Math.PI + a, 24);
    for (const t of [-1, 1]) { const a0 = Math.atan2(-t, -s); arc(gx, t * HW, 1, a0 - Math.PI / 4, a0 + Math.PI / 4, 8); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function goal(root: THREE.Object3D, name: 'goal-home' | 'goal-away', s: -1 | 1, materials: { white: THREE.Material; grey: THREE.Material; net: THREE.Material }) {
  const group = new THREE.Group(); group.name = name; root.add(group);
  const gx = s * HL, bx = gx + s * 2.1, tx = gx + s * 1;
  const post = new THREE.CylinderGeometry(.065, .065, 2.44, 12), bar = new THREE.CylinderGeometry(.065, .065, 7.32 + .13, 12);
  fused(group, `${name}-frame`, [placed(post, [gx, 1.22, -3.66]), placed(post, [gx, 1.22, 3.66]), placed(bar, [gx, 2.44, 0], [Math.PI / 2, 0, 0])],
    materials.white, { cast: true });
  const support = new THREE.CylinderGeometry(.025, .025, 1, 6), up = new THREE.Vector3(0, 1, 0);
  fused(group, `${name}-supports`, [-3.66, 3.66].map(z => {
    const top = new THREE.Vector3(tx, 2.38, z), foot = new THREE.Vector3(bx, 0, z);
    const middle = top.clone().add(foot).multiplyScalar(.5);
    return placed(support, [middle.x, middle.y, middle.z], undefined, [1, top.distanceTo(foot), 1],
      new THREE.Quaternion().setFromUnitVectors(up, foot.clone().sub(top).normalize()));
  }), materials.grey);
  post.dispose(); bar.dispose(); support.dispose();
  const sides = [-3.66, 3.66].map(z => quad([[gx, 0, z], [bx, 0, z], [tx, 2.44, z], [gx, 2.44, z]], [[0, 0], [7, 0], [3, 8], [0, 8]]));
  fused(group, `${name}-net`, [
    quad([[tx, 2.44, -3.66], [tx, 2.44, 3.66], [bx, 0, 3.66], [bx, 0, -3.66]], repeatUv(24, 8)),   // fondo
    quad([[gx, 2.44, -3.66], [gx, 2.44, 3.66], [tx, 2.44, 3.66], [tx, 2.44, -3.66]], repeatUv(3, 24)), // techo
    ...sides,
  ], materials.net);
}

/* ------------------------------------------------------------------ estadio */

export function createStadiumArt(detail: DetailLevel, options: StadiumOptions = {}): StadiumArt {
  const standard = detail === 'standard';
  const root = new THREE.Group(); root.name = 'stadium';
  root.position.set(HL, 0, HW); // del sistema centrado de la maqueta al de la app
  const repeatable: THREE.Texture[] = [];

  /* césped: una textura para campo y zona exterior (más oscura), como la maqueta */
  const grass = texture(grassPixels(detail), false); repeatable.push(grass);
  const noise = standard ? texture(noisePixels(), true) : null;
  if (noise) { noise.colorSpace = THREE.NoColorSpace; noise.repeat.set(70, 48); }
  const turfMaterial = (tint: string) => new THREE.MeshStandardMaterial({ map: grass, color: tint, roughness: .93,
    roughnessMap: noise, bumpMap: noise, bumpScale: noise ? .9 : 1, envMapIntensity: .2 });
  const surround = new THREE.PlaneGeometry(260, 200).rotateX(-Math.PI / 2).translate(0, -.06, 0);
  fused(root, 'surround', [surround], new THREE.MeshStandardMaterial({ color: '#16301a', roughness: 1 }), { receive: true });
  fused(root, 'runoff', [new THREE.PlaneGeometry(AREA_L, AREA_W).rotateX(-Math.PI / 2).translate(0, -.025, 0)], turfMaterial('#d6ddd6'), { receive: true });
  const field = new THREE.PlaneGeometry(PITCH_LENGTH, PITCH_WIDTH), uv = field.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) { // la superficie de juego toma su recorte exacto de la misma textura
    uv.setXY(i, (AREA_L - PITCH_LENGTH) / 2 / AREA_L + uv.getX(i) * PITCH_LENGTH / AREA_L,
      (AREA_W - PITCH_WIDTH) / 2 / AREA_W + uv.getY(i) * PITCH_WIDTH / AREA_W);
  }
  fused(root, 'surface', [field.rotateX(-Math.PI / 2)], turfMaterial('#ffffff'), { receive: true });
  fused(root, 'markings', [markingsGeometry()], new THREE.MeshStandardMaterial({ color: '#f2f5ee', roughness: .9 }), { receive: true });

  /* porterías y banderines */
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .3, emissive: '#222222', envMapIntensity: .6 });
  const grey = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: .5 });
  const netMap = texture(netPixels(), true); netMap.colorSpace = THREE.SRGBColorSpace; repeatable.push(netMap);
  const net = new THREE.MeshStandardMaterial({ map: netMap, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: .9, alphaTest: .02 });
  goal(root, 'goal-home', -1, { white, grey, net }); goal(root, 'goal-away', 1, { white, grey, net });
  const pole = new THREE.CylinderGeometry(.02, .02, 1.5, 6), flag = new THREE.PlaneGeometry(.45, .32);
  const corners = [-1, 1].flatMap(sx => [-1, 1].map(sz => [sx, sz] as const));
  fused(root, 'corner-poles', corners.map(([sx, sz]) => placed(pole, [sx * HL, .75, sz * HW])), white, { cast: true });
  fused(root, 'corner-flags', corners.map(([sx, sz]) => placed(flag, [sx * HL - .23 * sx, 1.33, sz * HW])),
    new THREE.MeshStandardMaterial({ color: '#ffd21f', side: THREE.DoubleSide, roughness: .7 }), { cast: true });
  pole.dispose(); flag.dispose();

  /* gradas: fondo (dos anfiteatros) y dos fondos laterales; sin grada en el lado de la cámara */
  const stands = new THREE.Group(); stands.name = 'stands'; root.add(stands);
  const crowdWidth = standard ? 1024 : 512;
  const crowdTexture = (seed: number, palette: readonly string[]) => texture(crowdPixels(seed, palette, crowdWidth), true);
  const crowdHome = crowdTexture(11, options.crowd?.home ?? NEUTRAL_CROWD.home);
  const crowdAway = crowdTexture(99, options.crowd?.away ?? NEUTRAL_CROWD.away);
  const crowdMaterial = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, color: '#c4c9d4', roughness: 1,
    emissive: '#ffffff', emissiveMap: map, emissiveIntensity: .1, side: THREE.DoubleSide });
  const homeTiers = [quad([[-85, 1.6, -40], [85, 1.6, -40], [85, 17, -60], [-85, 17, -60]], repeatUv(2.7, .95))];
  if (standard) homeTiers.push(quad([[-85, 20, -63], [85, 20, -63], [85, 34, -80], [-85, 34, -80]], repeatUv(2.7, .8)));
  const awayTiers: THREE.BufferGeometry[] = [];
  const structure: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [], strips: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, at: V3, rotation?: V3) => { const g = new THREE.BoxGeometry(w, h, d); const p = placed(g, at, rotation); g.dispose(); return p; };
  structure.push(box(170, 1.7, .4, [0, .85, -40]));
  roofs.push(box(180, 1.2, 30, [0, 37, -72]), box(180, 2.2, .6, [0, 36, -57]));
  if (standard) for (let i = -8; i <= 8; i++) strips.push(box(3.2, .7, .2, [i * 10, 35.4, -56.6]));
  for (const s of [-1, 1] as const) {
    const x = (outward: number) => s * (HL + 8 + outward); // fondo detrás de cada portería, sin escalas negativas
    const lower = quad([[x(0), 1.6, -60], [x(0), 1.6, 60], [x(20), 17, 60], [x(20), 17, -60]], repeatUv(2, .95));
    (s < 0 ? homeTiers : awayTiers).push(lower);
    if (standard) (s < 0 ? homeTiers : awayTiers).push(quad([[x(23), 20, -60], [x(23), 20, 60], [x(40), 34, 60], [x(40), 34, -60]], repeatUv(2, .8)));
    roofs.push(box(30, 1.2, 130, [x(34), 37, 0]), box(.6, 2.2, 130, [x(19.5), 36, 0]));
    if (standard) for (let i = -6; i <= 6; i++) strips.push(box(.2, .7, 3.2, [x(19.1), 35.4, i * 10]));
    structure.push(box(.4, 1.7, 120, [x(0), .85, 0]), box(24, 30, 24, [s * (HL + 22), 15, -52], [0, s * .6, 0]));
  }
  fused(stands, 'crowd-home', homeTiers, crowdMaterial(crowdHome));
  fused(stands, 'crowd-away', awayTiers, crowdMaterial(crowdAway));
  const dark = new THREE.MeshStandardMaterial({ color: '#0d1320', roughness: .9 });
  fused(stands, 'stand-structure', structure, dark);
  fused(stands, 'roofs', roofs, new THREE.MeshStandardMaterial({ color: '#141a24', roughness: .8, metalness: .2 }));
  if (strips.length) {
    const glow = new THREE.MeshBasicMaterial({ color: '#fff4dc' }); glow.color.multiplyScalar(5.5); // HDR: lo comprime el tone mapping
    fused(stands, 'roof-lights', strips, glow);
  }
  if (standard) {
    const facadeMap = texture(facadePixels(), true);
    fused(stands, 'facade', [new THREE.PlaneGeometry(170, 3).translate(0, 18.5, -61.5)], new THREE.MeshStandardMaterial({
      map: facadeMap, emissive: '#ffffff', emissiveMap: facadeMap, emissiveIntensity: .35, roughness: .8 }));
  }

  /* vallas LED: cuerpo oscuro (proyecta sombra) + panel emisivo fusionado */
  const ledMap = texture(ledPixels(detail), true); repeatable.push(ledMap);
  const boardBodies: THREE.BufferGeometry[] = [], panels: THREE.BufferGeometry[] = [];
  const panel = (length: number, repeat: number, at: V3, yaw: number) => {
    const plane = new THREE.PlaneGeometry(length, .95), uvs = plane.getAttribute('uv');
    for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * repeat);
    const front = new THREE.Vector3(0, 0, .101).applyEuler(new THREE.Euler(0, yaw, 0));
    panels.push(placed(plane, [at[0] + front.x, at[1], at[2] + front.z], [0, yaw, 0])); plane.dispose();
    boardBodies.push(box(length, .95, .2, at, [0, yaw, 0]));
  };
  panel(118, 2.4, [0, .48, -HW - 3.4], 0);
  for (const s of [-1, 1]) for (const z of [-19, 19]) panel(26, 1.3, [s * (HL + 4.2), .48, z], -s * Math.PI / 2);
  fused(root, 'led-bodies', boardBodies, dark, { cast: true, receive: true });
  fused(root, 'led-boards', panels, new THREE.MeshStandardMaterial({ color: '#000000', map: ledMap, emissive: '#ffffff',
    emissiveMap: ledMap, emissiveIntensity: 1.25, roughness: .4 }));

  let disposed = false;
  return {
    root,
    setAnisotropy(level: number) {
      if (disposed || !Number.isFinite(level) || level < 1) return;
      for (const map of repeatable) if (map.anisotropy !== level) { map.anisotropy = level; map.needsUpdate = true; }
    },
    dispose() {
      if (disposed) return; disposed = true;
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      for (const material of materials) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const map of textures) map.dispose();
      root.removeFromParent(); root.clear();
    },
  };
}
