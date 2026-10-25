// Rotulación propia de Capitán Hane (TP234): letras dibujadas por código como trazos sobre una rejilla de 4 × 6
// (mayúsculas, cifras, ¡!, tildes y eñe). Sin ficheros de fuente ni fuentes de terceros: las mismas formas en
// cualquier navegador y en las muestras PNG. Se pintan como `path` SVG con trazo grueso y contorno.
type Stroke = readonly (readonly [number, number])[];

const O: Stroke = [[1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0]];
const P: Stroke = [[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.5], [3, 3.5], [0, 3.5]];
const GLYPHS: Readonly<Record<string, readonly Stroke[]>> = {
  A: [[[0, 6], [0, 2], [2, 0], [4, 2], [4, 6]], [[0, 3.6], [4, 3.6]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[0, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  C: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
  D: [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  F: [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]],
  G: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.5], [2.2, 3.5]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 0], [3, 0]], [[2, 0], [2, 6]], [[1, 6], [3, 6]]],
  J: [[[4, 0], [4, 5], [3, 6], [1, 6], [0, 5]]],
  K: [[[0, 0], [0, 6]], [[4, 0], [0, 3.6]], [[1.4, 2.5], [4, 6]]],
  L: [[[0, 0], [0, 6], [4, 6]]],
  M: [[[0, 6], [0, 0], [2, 3], [4, 0], [4, 6]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  O: [O],
  P: [P],
  Q: [O, [[2.4, 4.4], [4.4, 6.4]]],
  R: [P, [[2, 3.5], [4, 6]]],
  S: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 2], [1, 3], [3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [[[0, 0], [0, 5], [1, 6], [3, 6], [4, 5], [4, 0]]],
  V: [[[0, 0], [2, 6], [4, 0]]],
  W: [[[0, 0], [1, 6], [2, 3], [3, 6], [4, 0]]],
  X: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]],
  Y: [[[0, 0], [2, 3], [4, 0]], [[2, 3], [2, 6]]],
  Z: [[[0, 0], [4, 0], [0, 6], [4, 6]]],
  '0': [O, [[3.5, 0.8], [0.5, 5.2]]],
  '1': [[[1, 1], [2, 0], [2, 6]], [[1, 6], [3, 6]]],
  '2': [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [0, 6], [4, 6]]],
  '3': [[[0, 0], [4, 0], [2, 2.5], [3, 2.5], [4, 3.5], [4, 5], [3, 6], [1, 6], [0, 5]]],
  '4': [[[3, 6], [3, 0], [0, 4], [4, 4]]],
  '5': [[[4, 0], [0, 0], [0, 2.5], [3, 2.5], [4, 3.5], [4, 5], [3, 6], [0, 6]]],
  '6': [[[3.5, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
  '7': [[[0, 0], [4, 0], [1.5, 6]]],
  '8': [[[1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3]]],
  '9': [[[0.5, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0], [0, 1], [0, 2], [1, 3], [4, 3]]],
  '!': [[[0.6, 0], [0.6, 4]], [[0.6, 5.5], [0.6, 6]]],
  '¡': [[[0.6, 0], [0.6, 0.5]], [[0.6, 2], [0.6, 6]]],
  '-': [[[0.5, 3], [3.5, 3]]],
  '.': [[[0.6, 5.5], [0.6, 6]]],
  "'": [[[0.8, 0], [0.4, 1.6]]],
};
/** Diacríticos (tras descomponer con NFD) dibujados sobre la letra base. */
const MARKS: Readonly<Record<string, readonly Stroke[]>> = {
  '́': [[[1.6, -0.9], [2.8, -2.1]]],
  '̃': [[[0.4, -1], [1.3, -1.9], [2.7, -1.1], [3.6, -2]]],
  '̈': [[[1, -1.4], [1.2, -1.4]], [[2.8, -1.4], [3, -1.4]]],
};
export const LETTER_ADVANCE = 5.6;
export const SPACE_ADVANCE = 3.4;
/** Signos estrechos: avance corto. */
const NARROW = new Set(['!', '¡', '.', "'"]);
const NARROW_ADVANCE = 2.8;

/** Caracteres que la rotulación sabe dibujar (los demás se omiten). */
export function canDraw(ch: string): boolean {
  const [base, ...marks] = ch.normalize('NFD');
  return ch === ' ' || (Object.hasOwn(GLYPHS, base.toUpperCase()) && marks.every(m => Object.hasOwn(MARKS, m)));
}

/** Trazos de un texto en unidades de rejilla (alto de mayúscula 6) y su ancho. */
export function letterPath(text: string): { d: string; width: number } {
  let x = 0;
  const parts: string[] = [];
  const draw = (strokes: readonly Stroke[], dx: number) => {
    for (const s of strokes) parts.push(s.map(([px, py], i) => `${i ? 'L' : 'M'}${+(px + dx).toFixed(2)} ${py}`).join(''));
  };
  for (const ch of [...text.toUpperCase()]) {
    if (ch === ' ') { x += SPACE_ADVANCE; continue; }
    const [base, ...marks] = ch.normalize('NFD');
    const glyph = GLYPHS[base];
    if (!glyph) continue;
    draw(glyph, x);
    for (const m of marks) if (MARKS[m]) draw(MARKS[m], x);
    x += NARROW.has(base) ? NARROW_ADVANCE : LETTER_ADVANCE;
  }
  return { d: parts.join(''), width: Math.max(0, x - 1.6) };
}

/** Parte un texto en líneas de como mucho `max` caracteres por palabras. */
export function wrapWords(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= max) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word);
  }
  return lines;
}
