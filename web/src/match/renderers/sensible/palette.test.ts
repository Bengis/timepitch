import { describe, expect, it } from 'vitest';
import type { KitSpec } from '../../../presentation/types';
import { SKIN_TONES, HAIR_COLOURS } from '../../../presentation/avatar/palette';
import atlasJson from './atlas.json';
import {
  HAIR_HEX, INDEX, PREVIEW_KIT, PREVIEW_LOOK, REFEREE_KIT, SHIRT_BITS, SKIN_HEX, applyPalette, buildPaletteLUT, hexToRgb,
  ramp, rampIndex, shirtIndex,
} from './palette';

const rgbAt = (lut: Uint8ClampedArray, i: number) => Array.from(lut.slice(i * 4, i * 4 + 4));
const kit = (body: KitSpec['pattern']['body']): KitSpec => ({
  shirt: '#1034a6', sleeves: { left: '#1034a6', right: '#ffffff' }, shorts: '#ffffff', socks: '#1034a6', trim: '#ffffff', number: '#ffffff',
  collar: 'crew', pattern: { body, sleeves: 'plain', shorts: 'plain', socks: 'plain' }, source: { kind: 'hand_assigned', licence: 'n/a' },
});
const look = { skin: SKIN_HEX.s5, hair: HAIR_HEX.blond, boots: '#111111' };

describe('paleta Clásico 16 bits', () => {
  it('usa los mismos tonos de piel y pelo que el avatar', () => {
    expect(SKIN_HEX).toEqual(SKIN_TONES);
    expect(HAIR_HEX).toEqual(HAIR_COLOURS);
  });

  it('la rampa conserva el color de la equipación como tono medio y ordena luz > medio > sombra', () => {
    for (const hex of ['#c8102e', '#1034a6', '#f5d20a', '#7a1e3a', '#1e9e4a']) {
      const [hi, mid, sh] = ramp(hex);
      expect(mid).toBe(hex);
      const lum = (h: string) => hexToRgb(h).reduce((a, v) => a + v, 0);
      expect(lum(hi)).toBeGreaterThan(lum(mid));
      expect(lum(sh)).toBeLessThan(lum(mid));
    }
    expect(ramp('#ffffff')[0]).toBe('#ffffff');
    expect(ramp('#111111')[1]).toBe('#111111'); // pelo y botas negros no cambian
    const [blackHi, blackMid, blackShade] = ramp('#111111', true);
    const lum = (h: string) => hexToRgb(h).reduce((a, v) => a + v, 0);
    // El negro se levanta para no fundirse con el contorno: sigue siendo oscuro y gris, pero la sombra queda por encima.
    expect(lum(blackShade)).toBeGreaterThan(lum('#140c1c'));
    expect(lum(blackMid)).toBeGreaterThan(lum(blackShade));
    expect(lum(blackMid)).toBeLessThan(3 * 90);
    expect(lum(blackHi)).toBeGreaterThan(lum(blackMid));
  });

  it('el patrón decide qué bit de zona pinta el ribete', () => {
    const plain = buildPaletteLUT(kit('plain'), look), stripes = buildPaletteLUT(kit('stripes'), look), hoops = buildPaletteLUT(kit('hoops'), look);
    const base = [0x10, 0x34, 0xa6, 255], white = [...hexToRgb(ramp('#ffffff')[1]), 255];
    expect(rgbAt(plain, shirtIndex(1, SHIRT_BITS.stripe))).toEqual(base);
    expect(rgbAt(stripes, shirtIndex(1, SHIRT_BITS.stripe))).toEqual(white);
    expect(rgbAt(stripes, shirtIndex(1, SHIRT_BITS.hoop))).toEqual(base);
    expect(rgbAt(hoops, shirtIndex(1, SHIRT_BITS.hoop | SHIRT_BITS.half))).toEqual(white);
    expect(rgbAt(hoops, shirtIndex(1, 0))).toEqual(base);
  });

  it('mangas izquierda y derecha, piel y pelo salen de su rol', () => {
    const lut = buildPaletteLUT(kit('plain'), look);
    expect(rgbAt(lut, rampIndex('sleeveL', 1))).toEqual([0x10, 0x34, 0xa6, 255]);
    expect(rgbAt(lut, rampIndex('sleeveR', 0))).toEqual([255, 255, 255, 255]); // el blanco queda como luz
    expect(rgbAt(lut, rampIndex('skin', 1))).toEqual([...hexToRgb(SKIN_HEX.s5), 255]);
    expect(rgbAt(lut, rampIndex('hair', 1))).toEqual([...hexToRgb(HAIR_HEX.blond), 255]);
    expect(rgbAt(lut, INDEX.transparent)[3]).toBe(0);
    expect(rgbAt(lut, INDEX.shadow)[3]).toBeLessThan(255);
  });

  it('applyPalette convierte índices en RGBA', () => {
    const lut = buildPaletteLUT(REFEREE_KIT, look);
    const out = applyPalette(new Uint8Array([0, INDEX.outline, shirtIndex(1, 0)]), lut);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.slice(8, 12))).toEqual([...hexToRgb(ramp(REFEREE_KIT.shirt, true)[1]), 255]);
  });
});

type Frame = { x: number; y: number; w: number; h: number; ax: number; ay: number };
const atlas = atlasJson as unknown as {
  width: number; height: number; directions: string[]; indexColours: Record<string, string>;
  animations: Record<string, { frames: number }>; frames: Record<string, Frame>;
};

describe('atlas Clásico 16 bits', () => {
  it('el PNG indexado tiene las medidas del JSON', async () => {
    // node:fs por import dinámico (como app-theme-hero.test): tsc del proyecto no carga los tipos de Node.
    const moduleName = 'node:fs';
    const fs = await import(/* @vite-ignore */ moduleName) as { readFileSync(path: string): Uint8Array };
    const png = fs.readFileSync('src/match/renderers/sensible/atlas.png'); // cwd = web/
    const u32 = (o: number) => ((png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3]) >>> 0;
    expect(u32(16)).toBe(atlas.width);
    expect(u32(20)).toBe(atlas.height);
    expect(png[24]).toBe(8); // 8 bits
    expect(png[25]).toBe(3); // indexado
  });

  it('cada animación tiene sus fotogramas en las 8 direcciones', () => {
    expect(atlas.directions).toEqual(['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']);
    for (const [name, a] of Object.entries(atlas.animations)) for (const d of atlas.directions) for (let f = 0; f < a.frames; f++)
      expect(atlas.frames[`player.${name}.${d}.${f}`], `${name}.${d}.${f}`).toBeDefined();
    for (const name of ['idle', 'run', 'sprint', 'pass', 'shot', 'slide', 'header', 'throw', 'celebrate', 'kneeslide', 'fall',
      'gk-ready', 'gk-shuffle', 'gk-dive-left-high', 'gk-dive-left-low', 'gk-dive-right-high', 'gk-dive-right-low', 'gk-catch', 'gk-punt'])
      expect(atlas.animations[name], name).toBeDefined();
    for (const s of ['s', 'm', 'l']) for (let f = 0; f < 4; f++) expect(atlas.frames[`ball.${s}.${f}`]).toBeDefined();
  });

  it('los rectángulos caben en la imagen y no se solapan', () => {
    const rects = Object.values(atlas.frames);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.width); expect(r.y + r.h).toBeLessThanOrEqual(atlas.height);
    }
    const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].y < sorted[i].y + sorted[i].h; j++) {
      const a = sorted[i], b = sorted[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
  });

  it('todo índice usado en el atlas tiene color en cualquier equipación', () => {
    const lut = buildPaletteLUT(PREVIEW_KIT, PREVIEW_LOOK);
    for (const k of Object.keys(atlas.indexColours).map(Number)) if (k !== 0) expect(rgbAt(lut, k)[3], `índice ${k}`).toBeGreaterThan(0);
  });
});
