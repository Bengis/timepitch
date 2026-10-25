// Vista «Táctica» del Retro 16 bits en píxel auténtico (TP222). Antes era el estadio entero reducido con suavizado
// (escala < 1, interpolado): dejaba de ser pixel art. Ahora es una capa propia de baja resolución —campo, fichas y
// balón— dibujada a `ppm` píxeles de arte por metro y ampliada a escala ENTERA sin suavizar. Pura y determinista: el
// mismo tamaño da la misma imagen; las posiciones son las grabadas, sin inventar nada.
import { NUMBER_FONT, numberStyle, type SensibleKit } from './palette';

const FIELD_LENGTH = 105, FIELD_WIDTH = 68;
/** Margen alrededor del campo (m): fondo de portería (2 m) más aire, y la franja de banda donde corren los asistentes. */
export const TACTICAL_MARGIN = Object.freeze({ length: 4, width: 3 });
/** Resoluciones posibles (px de arte por metro). Pares: el centro del campo cae en un píxel y todo es simétrico. */
export const TACTICAL_PPM = Object.freeze([2, 4, 6] as const);

export type TacticalLayout = Readonly<{
  /** Píxeles de arte por metro y píxeles de dispositivo por píxel de arte (entero). */
  ppm: number; scale: number;
  /** `true`: largo del campo en horizontal (pantallas apaisadas); `false`: vertical, portería x = 105 arriba. */
  landscape: boolean;
  /** Tamaño de la capa en píxeles de arte y su esquina en el lienzo (px de dispositivo). */
  w: number; h: number; ox: number; oy: number;
}>;

const span = (ppm: number) => ({ cx: (FIELD_LENGTH / 2 + TACTICAL_MARGIN.length) * ppm, cy: (FIELD_WIDTH / 2 + TACTICAL_MARGIN.width) * ppm });

/**
 * Orientación, resolución y escala de la vista táctica. Gira el campo a lo ancho en pantallas apaisadas. Busca que un
 * píxel del arte mida al menos 2 px CSS (`minScale`); entre las combinaciones que caben elige la que más ocupa y, a
 * igualdad, la de más detalle (fichas mayores, con dorsal de una cifra desde 4 px/m).
 */
export function tacticalLayout(deviceW: number, deviceH: number, dpr = 1): TacticalLayout {
  const W = Math.max(1, Math.round(deviceW)), H = Math.max(1, Math.round(deviceH));
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const across = FIELD_LENGTH + 2 * TACTICAL_MARGIN.length, deep = FIELD_WIDTH + 2 * TACTICAL_MARGIN.width;
  const fitL = Math.min(W / across, H / deep), fitP = Math.min(W / deep, H / across);
  const landscape = fitL >= fitP, fit = Math.max(fitL, fitP);
  // A igualdad de tamaño: con el píxel grueso garantizado, más detalle; si no cabe, el píxel más grueso posible.
  const pick = (minScale: number, detail: boolean) => {
    let best: { ppm: number; scale: number } | null = null;
    for (const ppm of TACTICAL_PPM) {
      const scale = Math.floor(fit / ppm + 1e-9);
      if (scale < minScale) continue;
      const size = ppm * scale, bestSize = best ? best.ppm * best.scale : -1;
      if (size > bestSize || (size === bestSize && detail)) best = { ppm, scale };
    }
    return best;
  };
  const chosen = pick(Math.max(1, Math.round(2 * ratio)), true) ?? pick(1, false) ?? { ppm: TACTICAL_PPM[0], scale: 1 };
  const { cx, cy } = span(chosen.ppm), lw = 2 * cx + 1, lh = 2 * cy + 1;
  const w = landscape ? lw : lh, h = landscape ? lh : lw;
  return { ...chosen, landscape, w, h, ox: Math.floor((W - w * chosen.scale) / 2), oy: Math.floor((H - h * chosen.scale) / 2) };
}

/** Campo (m) → píxel de arte de la capa (centro del píxel en coordenadas enteras). */
export function tacticalPoint(layout: TacticalLayout, x: number, y: number) {
  const { cx, cy } = span(layout.ppm), lx = cx + (x - FIELD_LENGTH / 2) * layout.ppm, ly = cy + (y - FIELD_WIDTH / 2) * layout.ppm;
  return layout.landscape ? { x: lx, y: ly } : { x: ly, y: 2 * cx - lx };
}
/** Píxel de arte → píxel de dispositivo (esquina superior izquierda del píxel). */
export function tacticalToDevice(layout: TacticalLayout, px: number, py: number) {
  return { x: layout.ox + px * layout.scale, y: layout.oy + py * layout.scale };
}

// ---------- Campo ----------

export const TACTICAL_COLOURS = Object.freeze({
  grassLight: [84, 160, 58], grassDark: [70, 142, 46], margin: [52, 112, 40], border: [20, 12, 28], line: [238, 244, 228],
  net: [154, 166, 184], post: [251, 251, 246],
} as const);
type RGB = readonly [number, number, number] | readonly number[];

/**
 * RGBA del campo táctico (orientación y tamaño de `layout`). Franjas de césped cada 5 m, líneas de 1 px, círculos con
 * el algoritmo del punto medio (sin antialiasing) y porterías. Todo es simétrico: se dibuja una mitad y se refleja.
 */
export function tacticalPitch(layout: Pick<TacticalLayout, 'ppm' | 'landscape'>): { width: number; height: number; data: Uint8ClampedArray } {
  const p = layout.ppm, { cx, cy } = span(p), W = 2 * cx + 1, H = 2 * cy + 1;
  const img = new Uint8ClampedArray(W * H * 4);
  const set = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
  };
  /** Punto en los cuatro cuadrantes (simetría respecto al centro del campo). */
  const set4 = (dx: number, dy: number, c: RGB) => { set(cx + dx, cy + dy, c); set(cx - dx, cy + dy, c); set(cx + dx, cy - dy, c); set(cx - dx, cy - dy, c); };
  const m = (metres: number) => Math.round(metres * p);
  const halfL = m(FIELD_LENGTH / 2), halfW = m(FIELD_WIDTH / 2);
  // Fondo y césped a franjas (5 m de largo cada una, simétricas desde el centro).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = Math.abs(x - cx) <= halfL && Math.abs(y - cy) <= halfW;
    const band = Math.floor((Math.abs(x - cx) + m(2.5)) / m(5)) % 2;
    set(x, y, inside ? (band ? TACTICAL_COLOURS.grassDark : TACTICAL_COLOURS.grassLight) : TACTICAL_COLOURS.margin);
  }
  for (let x = 0; x < W; x++) { set(x, 0, TACTICAL_COLOURS.border); set(x, H - 1, TACTICAL_COLOURS.border); }
  for (let y = 0; y < H; y++) { set(0, y, TACTICAL_COLOURS.border); set(W - 1, y, TACTICAL_COLOURS.border); }
  const L = TACTICAL_COLOURS.line;
  // Rectángulo (en distancias desde el centro), reflejado a las dos porterías.
  const box = (fromX: number, toX: number, halfY: number) => {
    for (let dx = fromX; dx <= toX; dx++) { set4(dx, halfY, L); }
    for (let dy = 0; dy <= halfY; dy++) { set4(fromX, dy, L); set4(toX, dy, L); }
  };
  box(0, halfL, halfW);                                   // bandas, líneas de meta y medio campo
  box(halfL - m(16.5), halfL, m(20.16));                  // áreas grandes
  box(halfL - m(5.5), halfL, m(9.16));                    // áreas pequeñas
  // Círculo por el punto medio, con filtro opcional (para los arcos del área).
  const circle = (ox: number, r: number, keep: (dx: number) => boolean) => {
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      for (const [a, b] of [[x, y], [y, x]]) { if (keep(ox + a)) set4(ox + a, b, L); if (keep(ox - a)) set4(ox - a, b, L); }
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  };
  circle(0, m(9.15), () => true);
  const spot = halfL - m(11);
  circle(spot, m(9.15), dx => dx < halfL - m(16.5));      // media luna: solo fuera del área
  set4(0, 0, L); set4(spot, 0, L);
  if (p >= 4) { set4(spot + 1, 0, L); set4(1, 0, L); set4(0, 1, L); }
  // Esquinas: cuarto de círculo de 1 m (a 2 px/m, un píxel hacia dentro).
  for (let k = 1; k <= Math.max(1, m(1)); k++) set4(halfL - k, halfW - Math.round(Math.sqrt(Math.max(0, m(1) ** 2 - k * k))), L);
  // Porterías: 7,32 m de boca y 2 m de fondo tras la línea; red rayada y postes.
  const mouth = m(3.66), depth = m(2);
  for (let dx = halfL + 1; dx <= halfL + depth; dx++) for (let dy = 0; dy <= mouth; dy++)
    set4(dx, dy, (dx + dy) % 2 ? TACTICAL_COLOURS.net : TACTICAL_COLOURS.margin);
  for (let dx = halfL; dx <= halfL + depth; dx++) set4(dx, mouth, TACTICAL_COLOURS.post);
  for (let dy = 0; dy <= mouth; dy++) set4(halfL + depth, dy, TACTICAL_COLOURS.post);
  if (layout.landscape) return { width: W, height: H, data: img };
  // Vertical: giro de 90° (portería x = 105 arriba, y = 68 a la derecha), como el seguimiento.
  const out = new Uint8ClampedArray(img.length);
  for (let ly = 0; ly < H; ly++) for (let lx = 0; lx < W; lx++) {
    const px = ly, py = W - 1 - lx, s = (ly * W + lx) * 4, d = (py * H + px) * 4;
    out[d] = img[s]; out[d + 1] = img[s + 1]; out[d + 2] = img[s + 2]; out[d + 3] = img[s + 3];
  }
  return { width: H, height: W, data: out };
}

// ---------- Fichas ----------

/** Diámetro (px de arte) de la ficha de un jugador según la resolución (impar). Desde 4 px/m mide 11 px: dos cifras
 *  de dorsal (7 px) caben con un píxel de camiseta a cada lado (con 9 px tocaban el contorno y no se leían). */
export const tokenSize = (ppm: number) => ppm <= 2 ? 5 : 2 * ppm + 3;
/** Rombo de los árbitros: cuatro píxeles menos que la ficha (3 px a 2 px/m). */
export const officialTokenSize = (ppm: number) => Math.max(3, tokenSize(ppm) - 4);

/**
 * Ficha de jugador en píxel: disco con contorno oscuro, camiseta arriba (con su raya o aro si la equipación lo tiene)
 * y pantalón en la fila de abajo. Devuelve una cuadrícula de colores (null = transparente).
 */
export function tokenPixels(kit: SensibleKit, d: number, outline = '#140c1c'): (string | null)[][] {
  const r = d / 2, rows: (string | null)[][] = [];
  const inside = (x: number, y: number) => Math.hypot(x + .5 - r, y + .5 - r) <= r + .15;
  const accent = kit.pattern.body !== 'plain' ? kit.trim : null;
  for (let y = 0; y < d; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < d; x++) {
      if (!inside(x, y)) { row.push(null); continue; }
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) { row.push(outline); continue; }
      const shorts = y >= d - 2 - (d >= 9 ? 1 : 0);
      if (shorts) { row.push(kit.shorts); continue; }
      const pattern = kit.pattern.body;
      const stripe = accent && ((pattern === 'stripes' || pattern === 'pinstripes') && x % 2 === 0 || pattern === 'hoops' && y % 2 === 0
        || pattern === 'halves' && x >= d / 2 || pattern === 'sash' && Math.abs(x - y) <= 0);
      row.push(stripe ? accent : kit.shirt);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Dorsal dentro de la ficha (letra 3×5 a 1 px de arte), solo si cabe con un píxel de camiseta alrededor (pegado al
 * contorno no se lee); si no, nada. En camisetas con rayas, aros, mitades o banda lleva placa del color de la camiseta
 * (`plate`: rectángulo [x, y, ancho, alto] dentro de la ficha), como en el seguimiento.
 */
export function tokenNumber(value: string | null | undefined, kit: SensibleKit, d: number): Readonly<{ fill: string; plate: readonly [number, number, number, number] | null; plateFill: string; pixels: readonly (readonly [number, number])[] }> | null {
  if (!value || !/^\d{1,2}$/.test(value)) return null;
  const width = value.length * 4 - 1;
  if (width > d - 4 || 5 > d - 4) return null;
  const left = Math.floor((d - width) / 2), top = Math.floor((d - 5) / 2), pixels: [number, number][] = [];
  [...value].forEach((c, i) => { const bits = NUMBER_FONT[c]; for (let k = 0; k < 15; k++) if (bits[k] === '1') pixels.push([left + i * 4 + k % 3, top + Math.floor(k / 3)]); });
  const patterned = numberStyle(kit).plate !== null;
  return { fill: numberStyle({ ...kit, pattern: { body: 'plain' } }).fill, plate: patterned ? [left - 1, top, width + 2, 5] : null, plateFill: kit.shirt, pixels };
}
