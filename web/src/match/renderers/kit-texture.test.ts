import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KitSpec, PatternFamily } from '../../presentation/types';
import { createKitMaterials, createNumberAtlas, patternPixels } from './kit-texture';

const BASE = '#1034a6', ACCENT = '#ffffff';
const rgba = (px: Uint8Array, size: number, x: number, y: number) => Array.from(px.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
const blue = [0x10, 0x34, 0xa6, 255], white = [255, 255, 255, 255];

function kit(body: PatternFamily = 'stripes', socks: PatternFamily = 'hoops'): KitSpec {
  return {
    shirt: BASE, sleeves: { left: BASE, right: BASE }, shorts: '#ffffff', socks: '#1034a6', trim: ACCENT, number: '#ffffff',
    collar: 'crew', pattern: { body, sleeves: 'plain', shorts: 'plain', socks },
    source: { kind: 'hand_assigned', licence: 'n/a' },
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('patternPixels', () => {
  it('stripes alternate base/accent columns and are constant down each column', () => {
    const px = patternPixels('stripes', BASE, ACCENT, 64);
    expect(px).toBeInstanceOf(Uint8Array);
    expect(px.length).toBe(64 * 64 * 4);
    const columns = new Set<string>();
    for (let x = 0; x < 64; x++) {
      const top = rgba(px, 64, x, 0);
      for (let y = 1; y < 64; y++) expect(rgba(px, 64, x, y)).toEqual(top);
      columns.add(JSON.stringify(top));
    }
    expect(columns).toEqual(new Set([JSON.stringify(blue), JSON.stringify(white)]));
    expect(rgba(px, 64, 0, 0)).toEqual(blue);
    let changes = 0;
    for (let x = 1; x < 64; x++) if (rgba(px, 64, x, 0)[0] !== rgba(px, 64, x - 1, 0)[0]) changes++;
    expect(changes).toBeGreaterThanOrEqual(3);
  });

  it('hoops alternate rows and are constant along each row', () => {
    const px = patternPixels('hoops', BASE, ACCENT, 64);
    const rows = new Set<string>();
    for (let y = 0; y < 64; y++) {
      const left = rgba(px, 64, 0, y);
      for (let x = 1; x < 64; x++) expect(rgba(px, 64, x, y)).toEqual(left);
      rows.add(JSON.stringify(left));
    }
    expect(rows.size).toBe(2);
  });

  it('plain is uniform base colour and unknown draws exactly as plain', () => {
    const plain = patternPixels('plain', BASE, ACCENT, 32);
    for (let i = 0; i < 32 * 32; i++) expect(Array.from(plain.slice(i * 4, i * 4 + 4))).toEqual(blue);
    expect(patternPixels('unknown', BASE, ACCENT, 32)).toEqual(plain);
  });

  it('every family is deterministic, opaque and uses only base and accent', () => {
    const families: PatternFamily[] = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'pinstripes', 'side_panels', 'unknown'];
    for (const family of families) {
      const a = patternPixels(family, BASE, ACCENT, 32);
      expect(patternPixels(family, BASE, ACCENT, 32)).toEqual(a);
      for (let i = 0; i < 32 * 32; i++) {
        const value = JSON.stringify(Array.from(a.slice(i * 4, i * 4 + 4)));
        expect([JSON.stringify(blue), JSON.stringify(white)]).toContain(value);
      }
      if (family !== 'plain' && family !== 'unknown') expect(a.some((v, i) => i % 4 === 0 && v === 255)).toBe(true);
    }
  });
});

describe('createNumberAtlas', () => {
  it('gives distinct in-range rectangles for 7 and 77 and null for invalid numbers', () => {
    const atlas = createNumberAtlas('#ffffff', '#1034a6');
    expect(atlas.texture).toBeInstanceOf(THREE.DataTexture); // jsdom real, sin canvas: respaldo sin lanzar
    const seven = atlas.uvFor('7'), seventySeven = atlas.uvFor('77');
    for (const r of [seven, seventySeven, atlas.uvFor('0'), atlas.uvFor('99')]) {
      expect(r).not.toBeNull();
      expect(r!.u).toBeGreaterThanOrEqual(0); expect(r!.v).toBeGreaterThanOrEqual(0);
      expect(r!.w).toBeGreaterThan(0); expect(r!.h).toBeGreaterThan(0);
      expect(r!.u + r!.w).toBeLessThanOrEqual(1 + 1e-9); expect(r!.v + r!.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(seven).not.toEqual(seventySeven);
    for (const bad of ['100', '', '-1', 'A', '7a', '1.5']) expect(atlas.uvFor(bad)).toBeNull();
    atlas.dispose();
  });

  it('assigns non-overlapping cells to all numbers 0–99', () => {
    const atlas = createNumberAtlas('#ffffff', '#000000');
    const seen = new Set<string>();
    for (let n = 0; n < 100; n++) {
      const r = atlas.uvFor(String(n))!;
      seen.add(`${r.u.toFixed(4)},${r.v.toFixed(4)}`);
    }
    expect(seen.size).toBe(100);
    atlas.dispose();
  });

  it('falls back to a DataTexture without a 2D context (jsdom) and does not throw', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const atlas = createNumberAtlas('#ffffff', '#000000');
    expect(atlas.texture).toBeInstanceOf(THREE.DataTexture);
    const data = (atlas.texture as THREE.DataTexture).image.data as Uint8Array;
    expect(data.some(v => v === 255)).toBe(true);
    atlas.dispose();
  });

  it('uses a canvas texture when a 2D context exists', () => {
    const ctx = { font: '', textAlign: '', textBaseline: '', lineWidth: 0, strokeStyle: '', fillStyle: '', clearRect: vi.fn(), strokeText: vi.fn(), fillText: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const atlas = createNumberAtlas('#ffffff', '#000000');
    expect(atlas.texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(ctx.fillText).toHaveBeenCalledTimes(100);
    expect(ctx.fillText).toHaveBeenCalledWith('77', expect.any(Number), expect.any(Number));
    atlas.dispose();
  });

  it('dispose releases the atlas texture once', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const spy = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const atlas = createNumberAtlas('#ffffff', '#000000');
    atlas.dispose(); atlas.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts[0]).toBe(atlas.texture);
  });
});

describe('createKitMaterials', () => {
  it('builds one material per zone, patterned zones textured and plain zones coloured', () => {
    const mats = createKitMaterials(kit('stripes', 'hoops'), 'standard');
    for (const m of [mats.shirt, mats.sleeves, mats.shorts, mats.socks, mats.skinTrim]) expect(m).toBeInstanceOf(THREE.Material);
    const shirt = mats.shirt as THREE.MeshStandardMaterial, shorts = mats.shorts as THREE.MeshStandardMaterial;
    expect(shirt.map).toBeInstanceOf(THREE.DataTexture);
    expect((mats.socks as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.DataTexture);
    expect(shorts.map).toBeNull();
    expect(shorts.color.getHexString()).toBe('ffffff');
    expect((mats.skinTrim as THREE.MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    mats.dispose();
  });

  it('unknown patterns are drawn plain (no texture) and low detail uses smaller textures', () => {
    const unknown = createKitMaterials(kit('unknown', 'plain'), 'standard');
    expect((unknown.shirt as THREE.MeshStandardMaterial).map).toBeNull();
    expect((unknown.shirt as THREE.MeshStandardMaterial).color.getHexString()).toBe('1034a6');
    unknown.dispose();
    const std = createKitMaterials(kit(), 'standard'), low = createKitMaterials(kit(), 'low');
    const width = (m: THREE.Material) => ((m as THREE.MeshStandardMaterial).map as THREE.DataTexture).image.width;
    expect(width(low.shirt)).toBeLessThan(width(std.shirt));
    std.dispose(); low.dispose();
  });

  it('dispose releases every material and texture exactly once', () => {
    const textureSpy = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const materialSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    const mats = createKitMaterials(kit('stripes', 'hoops'), 'standard');
    const textures = [mats.shirt, mats.sleeves, mats.shorts, mats.socks, mats.skinTrim]
      .map(m => (m as THREE.MeshStandardMaterial).map).filter((t): t is THREE.Texture => t !== null);
    expect(textures.length).toBe(2);
    mats.dispose(); mats.dispose();
    expect(new Set(textureSpy.mock.contexts)).toEqual(new Set(textures));
    expect(textureSpy).toHaveBeenCalledTimes(2);
    expect(new Set(materialSpy.mock.contexts)).toEqual(new Set([mats.shirt, mats.sleeves, mats.shorts, mats.socks, mats.skinTrim]));
    expect(materialSpy).toHaveBeenCalledTimes(5);
  });
});
