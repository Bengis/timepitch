import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GENERIC_APPEARANCE, type AppearanceParams, type KitSpec } from '../../presentation/types';
import {
  CHARACTER_BUDGET, HAIR_STYLES, SKIN_TONES, applyCharacterPose, characterParts, characterRenderCost, characterScale,
  createCharacterArt, deriveCharacterPose, type CharacterArt,
} from './character';
import { createKitMaterials, createNumberAtlas } from './kit-texture';
import { applyPlayerPose, derivePlayerPose } from './poses';
import type { DetailLevel, PitchRenderInput } from './types';

const SOURCE = { kind: 'hand_assigned', licence: 'n/a' } as const;
const KIT: KitSpec = {
  shirt: '#1d4fbf', sleeves: { left: '#1d4fbf', right: '#1d4fbf' }, shorts: '#1d4fbf', socks: '#ffffff',
  trim: '#ffffff', number: '#ffffff', collar: 'crew',
  pattern: { body: 'stripes', sleeves: 'plain', shorts: 'plain', socks: 'plain' }, source: SOURCE,
};
const LOOK: AppearanceParams = {
  skin: 's6', hairStyle: 'curly', hairColour: 'black', beard: 'full', eyes: 'dk', boots: '#ff2f7a', build: 1.05, heightCm: 188,
};

function art(over: Partial<Parameters<typeof createCharacterArt>[0]> = {}, detail: DetailLevel = 'standard') {
  const kit = createKitMaterials(KIT, detail), atlas = createNumberAtlas('#ffffff', '#1d4fbf');
  const character = createCharacterArt({ side: 'home', keeper: false, appearance: LOOK, kit, atlas, number: '10', detail, ...over });
  return { character, kit, atlas };
}

describe('characterScale', () => {
  it('is 1 at 183 cm or unknown, linear, bounded to [0.9, 1.1]', () => {
    expect(characterScale(null)).toBe(1); expect(characterScale(183)).toBe(1); expect(characterScale(Number.NaN)).toBe(1);
    expect(characterScale(192.15)).toBeCloseTo(1.05);
    for (const h of [140, 165, 205, 230]) { expect(characterScale(h)).toBeGreaterThanOrEqual(.9); expect(characterScale(h)).toBeLessThanOrEqual(1.1); }
    expect(characterScale(165)).toBeLessThan(characterScale(183)); expect(characterScale(205)).toBe(1.1);
  });
});

describe('characterParts (pure appearance → geometry mapping)', () => {
  const spec = (over: Partial<Parameters<typeof characterParts>[0]> = {}) =>
    characterParts({ keeper: false, appearance: LOOK, numberUv: { u: .1, v: .2, w: .1, h: .1 }, detail: 'standard', ...over });

  it('maps the ten mock-up hair styles to distinct hair sets', () => {
    expect(HAIR_STYLES).toHaveLength(10);
    const signatures = HAIR_STYLES.map(hairStyle => JSON.stringify(spec({ appearance: { ...LOOK, hairStyle } })
      .filter(p => p.name.startsWith('hair')).map(p => [p.shape, p.position, p.scale, p.rotation, p.colour])));
    expect(new Set(signatures).size).toBe(10);
  });

  it('uses the skin palette and the hair colour for a full beard; generic look has no beard', () => {
    const parts = spec();
    expect(parts.find(p => p.name === 'skull')!.colour).toBe(SKIN_TONES.s6);
    expect(parts.find(p => p.name === 'beard')!.colour).toBe(parts.find(p => p.name === 'hair-cap')!.colour);
    expect(parts.find(p => p.name === 'boot-left')!.colour).toBe('#ff2f7a');
    expect(characterParts({ keeper: false, appearance: GENERIC_APPEARANCE, numberUv: null, detail: 'standard' })
      .some(p => p.name === 'beard')).toBe(false);
  });

  it('falls back to neutral values for corrupt appearance data instead of throwing', () => {
    const bad = { ...LOOK, skin: 'zz', hairStyle: 'mohawk', hairColour: 'green', boots: 'not a colour', build: Number.NaN } as unknown as AppearanceParams;
    const parts = spec({ appearance: bad });
    expect(parts.find(p => p.name === 'skull')!.colour).toBe(SKIN_TONES.s4);
    expect(parts.find(p => p.name === 'boot-left')!.colour).toBe('#111111');
    expect(parts.every(p => [...p.position, ...(p.scale ?? [])].every(Number.isFinite))).toBe(true);
  });

  it('keeper gets gloves and long sleeves; outfield gets bare hands', () => {
    const keeper = spec({ keeper: true }), outfield = spec();
    expect(keeper.filter(p => p.name.startsWith('glove'))).toHaveLength(2);
    expect(outfield.some(p => p.name.startsWith('glove'))).toBe(false);
    expect(keeper.find(p => p.name === 'forearm-left')!.slot).toBe('sleeves');
    expect(spec({ keeper: true, detail: 'low' }).find(p => p.name === 'forearm-left')!.slot).toBe('shirt');
    expect(outfield.find(p => p.name === 'forearm-left')!.slot).toBe('look');
  });

  it('prints the number only when the atlas has it; low drops trim and fine facial parts', () => {
    expect(spec({ numberUv: null }).some(p => p.slot === 'number')).toBe(false);
    const low = spec({ detail: 'low' });
    expect(low.some(p => p.slot === 'trim')).toBe(false);
    expect(low.some(p => p.name.startsWith('eye') || p.name === 'nose')).toBe(false);
    expect(low.filter(p => p.slot === 'number')).toHaveLength(1);
  });
});

describe('createCharacterArt', () => {
  it('exposes every PlayerArt joint and accepts the existing pose driver', () => {
    const { character, kit, atlas } = art();
    for (const key of ['root', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftElbow', 'rightElbow',
      'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'selection'] as const) expect(character[key]).toBeInstanceOf(THREE.Object3D);
    character.root.position.set(24, 0, 22);
    const pose = derivePlayerPose(input(), 'home:p')!;
    expect(() => applyPlayerPose(character, pose)).not.toThrow();
    expect(character.root.position.toArray()).toEqual([24, 0, 22]);
    expect(character.leftKnee.rotation.x).toBe(pose.limbs.leftLeg.bend);
    character.dispose(); kit.dispose(); atlas.dispose();
  });

  it('skins the body so vertices follow the joints', () => {
    const { character, kit, atlas } = art();
    const look = character.meshes.find(m => m.name === 'character-look')!;
    const ankle = character.skeleton.bones.indexOf(character.leftAnkle as unknown as THREE.Bone);
    const index = look.geometry.getAttribute('skinIndex'), vertex = [...Array(index.count).keys()].find(i => index.getX(i) === ankle)!;
    const at = () => { character.root.updateMatrixWorld(true); look.skeleton.update(); return look.getVertexPosition(vertex, new THREE.Vector3()).clone(); };
    const rest = at(); character.leftLeg.rotation.x = -.9; const kicked = at();
    expect(kicked.distanceTo(rest)).toBeGreaterThan(.2);
    character.dispose(); kit.dispose(); atlas.dispose();
  });

  it('keeper art has gloves; number null builds no number mesh', () => {
    const keeper = art({ keeper: true }), blank = art({ number: null });
    const colours = keeper.character.meshes.find(m => m.name === 'character-look')!.geometry.getAttribute('color');
    expect(colours).toBeDefined();
    expect(characterParts({ keeper: true, appearance: LOOK, numberUv: null, detail: 'standard' }).some(p => p.name === 'glove-left')).toBe(true);
    expect(blank.character.meshes.some(m => m.name === 'character-number')).toBe(false);
    expect(keeper.character.meshes.some(m => m.name === 'character-number')).toBe(true);
    for (const x of [keeper, blank]) { x.character.dispose(); x.kit.dispose(); x.atlas.dispose(); }
  });

  it('maps the back number to its atlas cell', () => {
    const { character, kit, atlas } = art({ number: '7' });
    const cell = atlas.uvFor('7')!, uv = character.meshes.find(m => m.name === 'character-number')!.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(cell.u - 1e-6); expect(uv.getX(i)).toBeLessThanOrEqual(cell.u + cell.w + 1e-6);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(cell.v - 1e-6); expect(uv.getY(i)).toBeLessThanOrEqual(cell.v + cell.h + 1e-6);
    }
    character.dispose(); kit.dispose(); atlas.dispose();
  });

  it.each([['standard', CHARACTER_BUDGET.standard], ['low', CHARACTER_BUDGET.low]] as const)(
    'worst-case %s character stays within its mesh and triangle budget', (detail, budget) => {
      expect(budget.meshes).toBeLessThanOrEqual(detail === 'low' ? 6 : 14);
      for (const keeper of [false, true]) for (const hairStyle of HAIR_STYLES) {
        const { character, kit, atlas } = art({ keeper, appearance: { ...LOOK, hairStyle } }, detail);
        const cost = characterRenderCost(character);
        expect(cost.meshes).toBeLessThanOrEqual(budget.meshes); expect(cost.triangles).toBeLessThanOrEqual(budget.triangles);
        character.dispose(); kit.dispose(); atlas.dispose();
      }
    });

  it('dispose frees its own resources but never the team kit materials or the atlas', () => {
    const { character, kit, atlas } = art();
    const shared = [kit.shirt, kit.sleeves, kit.shorts, kit.socks, kit.skinTrim].map(m => vi.spyOn(m, 'dispose'));
    const atlasSpy = vi.spyOn(atlas.texture, 'dispose');
    const own = character.meshes.map(m => vi.spyOn(m.geometry, 'dispose'));
    const scene = new THREE.Scene(); scene.add(character.root);
    character.dispose(); character.dispose();
    for (const spy of shared) expect(spy).not.toHaveBeenCalled();
    expect(atlasSpy).not.toHaveBeenCalled();
    for (const spy of own) expect(spy).toHaveBeenCalledTimes(1);
    expect(character.root.parent).toBeNull();
    kit.dispose(); atlas.dispose();
  });
});

describe('character poses (synthetic, seek-safe)', () => {
  it('replays identically for the same frame and keeps the root untouched', () => {
    const value = input(), first = deriveCharacterPose(value, 'home:p', false)!;
    deriveCharacterPose({ ...value, frame: { ...value.frame, clock_ms: 9000 } }, 'home:p', false);
    expect(deriveCharacterPose(value, 'home:p', false)).toEqual(first);
    const { character, kit, atlas } = art(); character.root.position.set(24, 0, 22);
    applyCharacterPose(character, first);
    expect(character.root.position.toArray()).toEqual([24, 0, 22]);
    expect(character.spine.rotation.x).toBe(first.spineLean);
    character.dispose(); kit.dispose(); atlas.dispose();
  });

  it('leans more with speed and is idle when standing', () => {
    const slow = deriveCharacterPose(input(.2), 'home:p', false)!, fast = deriveCharacterPose(input(.6), 'home:p', false)!;
    expect(slow.stance).toBe('run'); expect(fast.stance).toBe('run');
    expect(fast.speed).toBeGreaterThan(slow.speed); expect(fast.spineLean).toBeGreaterThan(slow.spineLean);
    const still = deriveCharacterPose(input(0), 'home:p', false)!;
    expect(still.stance).toBe('idle'); expect(still.speed).toBe(0);
  });

  it('a slow keeper near the ball takes the ready stance facing it; far away it does not', () => {
    const near = deriveCharacterPose(input(0), 'home:p', true)!;
    expect(near.stance).toBe('keeper-ready'); expect(near.bodyOffsetY).toBeLessThan(0);
    expect(near.limbs.leftLeg.bend!).toBeGreaterThan(.5);
    const far = deriveCharacterPose(input(0, { x: 90, y: 34 }), 'home:p', true)!;
    expect(far.stance).toBe('idle');
  });

  it('keeps the kick from a pass cue', () => {
    const value = input(.5);
    const pose = deriveCharacterPose({ ...value, cue: { type: 'pass', participants: ['home:p'], t1_ms: 1400, bodyPart: 'right_foot' } }, 'home:p', false)!;
    expect(pose.stance).toBe('kick'); expect(pose.limbs.rightLeg.x).toBeLessThan(0);
  });
});

function input(step = .5, ball: { x: number; y: number } = { x: 30, y: 25 }): PitchRenderInput {
  const players = [{ key: 'home:p', name: 'P', side: 'home' as const, role: 'MID' as const, x: 24, y: 22 }];
  const frame = { clock_ms: 1500, period: 1, score: { home: 0, away: 0 }, carrier: null, possession: null, ball, players };
  const value: PitchRenderInput = { frame, previous: { ...frame, clock_ms: 1400, players: players.map(p => ({ ...p, x: p.x - step })) },
    restarting: false, selectedPlayerKey: null, camera: 'overview', appearance: 'daylight', detail: 'standard',
    labels: { home: 'H', away: 'A', clock: '00:01', goal: 'Goal' } };
  function freeze(object: object) { Object.freeze(object); for (const child of Object.values(object)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child); }
  freeze(value); return value;
}

// Compile-time: CharacterArt must stay assignable to the PlayerArt the renderer stores.
export const assignable = (value: CharacterArt): import('./three-art').PlayerArt => value;
