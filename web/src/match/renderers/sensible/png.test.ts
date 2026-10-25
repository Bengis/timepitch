import { expect, it } from 'vitest';
import atlasJson from './atlas.json';
import { decodeIndexedPng, indicesFromRgba, unfilter } from './png';

it('deshace los cinco filtros de fila de PNG (1 byte por píxel)', () => {
  // Fila 0 sin filtro [10, 20], fila 1 «Sub» [+5, +5] → [5, 10], fila 2 «Up» [+1, +1] → [6, 11], fila 3 «Average», fila 4 «Paeth».
  const raw = new Uint8Array([0, 10, 20, 1, 5, 5, 2, 1, 1, 3, 3, 0, 4, 0, 0]);
  expect(Array.from(unfilter(raw, 2, 5))).toEqual([10, 20, 5, 10, 6, 11, 6, 8, 6, 8]);
  expect(() => unfilter(new Uint8Array([9, 0]), 1, 1)).toThrow();
});

it('lee los índices del atlas real (sin pasar por un lienzo)', async () => {
  const fsName = 'node:fs', zlibName = 'node:zlib';
  const fs = await import(/* @vite-ignore */ fsName) as { readFileSync(path: string): Uint8Array };
  const zlib = await import(/* @vite-ignore */ zlibName) as { inflateSync(data: Uint8Array): Uint8Array };
  const image = await decodeIndexedPng(new Uint8Array(fs.readFileSync('src/match/renderers/sensible/atlas.png')), async d => new Uint8Array(zlib.inflateSync(d)));
  expect(image.width).toBe(atlasJson.width); expect(image.height).toBe(atlasJson.height);
  const used = new Set(Object.keys(atlasJson.indexColours).map(Number));
  for (const value of new Set(image.indices)) expect(used.has(value), `índice ${value}`).toBe(true);
  const ball = (atlasJson.frames as Record<string, { x: number; y: number; w: number; h: number }>)['ball.s.0'];
  let opaque = 0;
  for (let y = ball.y; y < ball.y + ball.h; y++) for (let x = ball.x; x < ball.x + ball.w; x++) if (image.indices[y * image.width + x]) opaque++;
  expect(opaque).toBeGreaterThan(4);
});

it('vía de respaldo: colores únicos → índices; transparente → 0', () => {
  const rgba = new Uint8ClampedArray([0x14, 0x0c, 0x1c, 255, 1, 2, 3, 0, 0xfc, 0xfc, 0xf4, 255]);
  expect(Array.from(indicesFromRgba(rgba, atlasJson.indexColours))).toEqual([1, 0, 32]);
});
