import { describe, expect, it } from 'vitest';
import { GENERIC_APPEARANCE, type CastEntry, type KitSpec, type MatchCast } from '../../../presentation/types';
import { GENERIC_KITS, playerLook } from './looks';
import { HAIR_HEX, SKIN_HEX, buildPaletteLUT, hexToRgb, ramp, rampIndex, shirtIndex } from './palette';

const kit = (shirt: string, body: KitSpec['pattern']['body'] = 'plain', trim = '#ffffff'): KitSpec => ({
  shirt, sleeves: { left: shirt, right: shirt }, shorts: '#ffffff', socks: shirt, trim, number: '#ffffff', collar: 'crew',
  pattern: { body, sleeves: 'plain', shorts: 'plain', socks: 'plain' }, source: { kind: 'hand_assigned', licence: 'n/a' },
});
const entry = (appearance: Partial<CastEntry['appearance']>): CastEntry => ({
  number: '9', displayName: 'Nine', appearance: { ...GENERIC_APPEARANCE, ...appearance }, appearanceSource: 'hand_assigned', record: null,
});
const cast: MatchCast = {
  kits: { home: kit('#6cabdd'), away: kit('#000000', 'stripes', '#ffffff'), homeKeeper: kit('#f5c400'), awayKeeper: kit('#2fae5a'), choice: 'source' },
  players: new Map([['h9', entry({ skin: 's7', hairColour: 'blond' })], ['h4', entry({ skin: 's2', hairStyle: 'shaved', hairColour: 'black' })]]),
};
const rgb = (lut: Uint8ClampedArray, i: number) => Array.from(lut.slice(i * 4, i * 4 + 3));

describe('recoloreado por equipo y jugador (Retro 16 bits)', () => {
  it('cada lado y cada portero usa su equipación del reparto (ya resuelta contra choques)', () => {
    expect(playerLook({ key: 'h9', side: 'home', role: 'FWD' }, cast).kit).toBe(cast.kits.home);
    expect(playerLook({ key: 'a3', side: 'away', role: 'DEF' }, cast).kit).toBe(cast.kits.away);
    expect(playerLook({ key: 'h1', side: 'home', role: 'GK' }, cast).kit).toBe(cast.kits.homeKeeper);
    expect(playerLook({ key: 'a1', side: 'away', role: 'GK' }, cast).kit).toBe(cast.kits.awayKeeper);
  });
  it('la camiseta del sprite toma el color del equipo y el patrón pinta el ribete', () => {
    const home = buildPaletteLUT(playerLook({ key: 'h9', side: 'home', role: 'FWD' }, cast).kit, { skin: '#ffffff', hair: '#000000', boots: '#111111' });
    const away = buildPaletteLUT(playerLook({ key: 'a3', side: 'away', role: 'DEF' }, cast).kit, { skin: '#ffffff', hair: '#000000', boots: '#111111' });
    expect(rgb(home, shirtIndex(1, 0))).toEqual(hexToRgb('#6cabdd'));
    expect(rgb(away, shirtIndex(1, 0))).toEqual(hexToRgb(ramp('#000000', true)[1])); // negro levantado sobre el contorno
    expect(rgb(away, shirtIndex(1, 1))).not.toEqual(hexToRgb('#000000')); // raya en color de ribete
  });
  it('piel y pelo por jugador; rapado funde el pelo con la piel; sin registro, aspecto genérico', () => {
    const nine = playerLook({ key: 'h9', side: 'home', role: 'FWD' }, cast);
    expect(nine.look.skin).toBe(SKIN_HEX.s7); expect(nine.look.hair).toBe(HAIR_HEX.blond);
    const lut = buildPaletteLUT(nine.kit, nine.look);
    expect(rgb(lut, rampIndex('skin', 1))).toEqual(hexToRgb(SKIN_HEX.s7));
    const shaved = playerLook({ key: 'h4', side: 'home', role: 'DEF' }, cast);
    expect(shaved.look.hair).not.toBe(HAIR_HEX.black);
    const unknown = playerLook({ key: 'h2', side: 'home', role: 'DEF' }, cast);
    expect(unknown.look.skin).toBe(SKIN_HEX[GENERIC_APPEARANCE.skin]);
    expect(unknown.key).not.toBe(nine.key);
    expect(playerLook({ key: 'h3', side: 'home', role: 'MID' }, cast).key).toBe(unknown.key); // mismo aspecto, misma hoja
  });
  it('sin reparto: colores genéricos por lado', () => {
    expect(playerLook({ key: 'x', side: 'home', role: 'MID' }, null).kit).toBe(GENERIC_KITS.home);
    expect(playerLook({ key: 'y', side: 'away', role: 'GK' }, undefined).kit).toBe(GENERIC_KITS.awayKeeper);
  });
});
