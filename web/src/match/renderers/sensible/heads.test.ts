import { describe, expect, it } from 'vitest';
import { HAIR_STYLES } from '../../../presentation/avatar/palette';
import atlasJson from './atlas.json';
import {
  CARD_HEX, HAIR_FEATURE, HEAD_STYLES, HEAD_ZONES, HAIR_HEX, INDEX, NUMBER_FONT, PREVIEW_KIT, REFEREE_KITS, SKIN_HEX, buildPaletteLUT,
  colourDistance, PITCH_GRASS, headIndex, headSignature, hexToRgb, lightness, numberStyle, ramp, refereeKitFor, sleeveIndex, zoneClass, type SensibleKit,
} from './palette';
import { playerLook } from './looks';

const atlas = atlasJson as unknown as {
  frames: Record<string, { x: number; y: number; w: number; h: number }>; animations: Record<string, { frames: number; official?: string }>;
  heads: { zones: number[] }; numbers: Record<string, number[]>; directions: string[];
};
const rgbAt = (lut: Uint8ClampedArray, i: number) => Array.from(lut.slice(i * 4, i * 4 + 3));
const plain = (shirt: string, extra: Partial<SensibleKit> = {}): SensibleKit =>
  ({ shirt, sleeves: { left: shirt, right: shirt }, shorts: '#ffffff', socks: shirt, trim: '#ffffff', pattern: { body: 'plain' }, ...extra });
const look = { skin: SKIN_HEX.s4, hair: HAIR_HEX.black, boots: '#111111' };
const zoneAt = (l: [number, number, number]) => HEAD_ZONES.indexOf(headSignature(l));

describe('peinados y barba por paleta (TP222)', () => {
  it('los 10 peinados del avatar tienen zona; el atlas se generó con las mismas zonas que calcula la app', () => {
    expect([...HEAD_STYLES].sort()).toEqual([...HAIR_STYLES].sort());
    expect(atlas.heads.zones).toEqual(HEAD_ZONES);
    expect(HEAD_BASE_END()).toBeLessThan(INDEX.sleeve);
  });
  it('la coronilla es pelo salvo rapado al cero (que se pinta mezclado con la piel en looks.ts); la cara nunca', () => {
    const crown = zoneAt([0, -.2, .97]), face = zoneAt([0, .97, .2]);
    for (const s of HEAD_STYLES) expect(zoneClass(crown, s, 'none'), s).toBe('hair');
    for (const s of HEAD_STYLES) expect(zoneClass(face, s, 'full'), s).toBe('skin');
  });
  it('melena y moño bajan por la nuca; el corte al uno no', () => {
    const nape = zoneAt([0, -.75, -.66]);
    expect(zoneClass(nape, 'long', 'none')).toBe('hair');
    expect(zoneClass(nape, 'crop', 'none')).toBe('skin');
  });
  it('la barba pinta el mentón con más pelo cuanto más poblada; la sombra no llega a las mejillas', () => {
    const chin = zoneAt([0, .8, -.6]), cheek = zoneAt([.7, .45, -.3]);
    const colour = (beard: 'none' | 'stubble' | 'light' | 'full', z: number) => rgbAt(buildPaletteLUT(PREVIEW_KIT, { ...look, beard }), headIndex(z, 1));
    expect(colour('none', chin)).toEqual(hexToRgb(SKIN_HEX.s4));
    const L = (c: number[]) => c[0] + c[1] + c[2];
    expect(L(colour('stubble', chin))).toBeLessThan(L(colour('none', chin)));
    expect(L(colour('full', chin))).toBeLessThan(L(colour('light', chin)));
    expect(zoneClass(cheek, 'crop', 'stubble')).toBe('skin');
    expect(zoneClass(cheek, 'crop', 'full')).toBe('beard');
  });
  it('cada capa de pelo que sobresale corresponde a un fotograma del cuerpo y a un peinado con ese rasgo', () => {
    const features = new Set(Object.values(HAIR_FEATURE));
    const layers = Object.keys(atlas.frames).filter(k => k.startsWith('hair.'));
    expect(layers.length).toBeGreaterThan(100);
    for (const k of layers) {
      const [, feature, ...rest] = k.split('.');
      expect(features.has(feature as never), k).toBe(true);
      expect(atlas.frames[`player.${rest.join('.')}`], k).toBeDefined();
    }
    for (const f of features) for (const d of atlas.directions) expect(atlas.frames[`hair.${f}.run.${d}.0`] ?? atlas.frames[`hair.${f}.run.${d}.1`], `${f} ${d}`).toBeDefined();
  });
  it('el aspecto del jugador lleva peinado, barba y capa', () => {
    const cast = { kits: null, players: new Map([['h5', { number: '5', appearance: { skin: 's6', hairStyle: 'curly', hairColour: 'black', beard: 'full', eyes: 'br', boots: '#111111', build: 1 } }]]) };
    const l = playerLook({ key: 'h5', side: 'home', role: 'DEF' }, cast as never);
    expect(l.look.hairStyle).toBe('curly'); expect(l.look.beard).toBe('full'); expect(l.feature).toBe('curly');
    expect(playerLook({ key: 'x', side: 'home', role: 'DEF' }, cast as never).feature).toBeNull();
  });
});

describe('dorsales (TP222)', () => {
  it('cifras de 3×5 del 0 al 9, todas distintas', () => {
    const glyphs = Object.values(NUMBER_FONT);
    expect(Object.keys(NUMBER_FONT)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(new Set(glyphs).size).toBe(10);
    for (const g of glyphs) expect(g).toMatch(/^[01]{15}$/);
  });
  it('de espaldas (N, NE, NW) hay zona de dorsal; de lado, no', () => {
    for (const d of ['N', 'NE', 'NW']) expect(atlas.numbers[`idle.${d}.0`]?.[0], d).toBe(1);
    expect(atlas.numbers['idle.S.0']?.[0]).toBe(2);
    expect(atlas.numbers['idle.E.0']).toBeUndefined();
    for (const [k, a] of Object.entries(atlas.numbers)) { expect(a[3], k).toBeGreaterThanOrEqual(3); expect(a[4], k).toBeGreaterThanOrEqual(3); }
  });
  it('el color del dorsal contrasta con la camiseta; con rayas lleva placa', () => {
    const same = numberStyle(plain('#f4f4f4', { number: '#ffffff' }));
    expect(Math.abs(lightness(same.fill) - lightness('#f4f4f4'))).toBeGreaterThanOrEqual(.3);
    expect(numberStyle(plain('#c8102e', { number: '#ffffff' })).fill).toBe('#ffffff');
    expect(numberStyle(plain('#161616', { trim: '#f2f2f2', pattern: { body: 'stripes' } })).plate).toBe(ramp('#161616', true)[1]);
    expect(numberStyle(plain('#c8102e')).plate).toBeNull();
  });
});

describe('árbitros y mangas (TP222)', () => {
  it('equipación de árbitro: la que más se separa de los dos equipos', () => {
    expect(refereeKitFor(plain('#c8102e'), plain('#1d4fd6'))).toBe(REFEREE_KITS[0]);
    expect(refereeKitFor(plain('#111111'), plain('#f4f4f4'))).not.toBe(REFEREE_KITS[0]);
    // Pulido 2 (demo Arsenal 2003 – City 2024): rojo, celeste y porteros amarillo y negro. Antes salía verde azulado,
    // que apenas se separa del césped; ahora ninguna opción se acerca al césped y sale la violeta.
    expect(refereeKitFor(plain('#dd0000'), plain('#98c6eb'), plain('#f5d20a'), plain('#111111')).shirt).toBe('#7046c8');
    for (const k of REFEREE_KITS) expect(colourDistance(k.shirt, PITCH_GRASS)).toBeGreaterThan(.25);
  });
  it('tarjeta amarilla por defecto y roja si se pide', () => {
    expect(rgbAt(buildPaletteLUT(REFEREE_KITS[0], look), INDEX.card)).toEqual(hexToRgb(CARD_HEX.yellow));
    expect(rgbAt(buildPaletteLUT(REFEREE_KITS[0], { ...look, card: CARD_HEX.red }), INDEX.card)).toEqual(hexToRgb(CARD_HEX.red));
  });
  it('animaciones de árbitro y asistentes en 8 direcciones', () => {
    for (const name of ['ref-whistle', 'ref-card', 'ar-idle', 'ar-run', 'ar-flag']) {
      expect(atlas.animations[name]?.official, name).toBeDefined();
      for (const d of atlas.directions) for (let f = 0; f < atlas.animations[name].frames; f++) expect(atlas.frames[`player.${name}.${d}.${f}`], `${name}.${d}.${f}`).toBeDefined();
    }
  });
  it('mangas con rayas o aros: el bit del patrón pinta el ribete; lisas, su color', () => {
    const striped = buildPaletteLUT(plain('#1d4fd6', { pattern: { body: 'stripes', sleeves: 'stripes' } }), look);
    expect(rgbAt(striped, sleeveIndex(0, 1, 1))).toEqual(hexToRgb(ramp('#ffffff', true)[1]));
    expect(rgbAt(striped, sleeveIndex(0, 1, 2))).toEqual(hexToRgb('#1d4fd6'));
    const flat = buildPaletteLUT(plain('#1d4fd6'), look);
    expect(rgbAt(flat, sleeveIndex(1, 1, 1))).toEqual(hexToRgb('#1d4fd6'));
  });
});

function HEAD_BASE_END() { return headIndex(HEAD_ZONES.length - 1, 2); }
