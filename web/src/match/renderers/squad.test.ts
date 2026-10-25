import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GENERIC_APPEARANCE, type KitSpec } from '../../presentation/types';
import { BONE_NAMES, characterParts, createCharacterRig } from './character';
import { createKitMaterials, createNumberAtlas } from './kit-texture';
import { createSquadArt, type SquadMember } from './squad';
import type { DetailLevel } from './types';

const KIT: KitSpec = { shirt: '#c8102e', sleeves: { left: '#c8102e', right: '#c8102e' }, shorts: '#ffffff', socks: '#c8102e',
  trim: '#ffffff', number: '#ffffff', collar: 'crew', pattern: { body: 'plain', sleeves: 'plain', shorts: 'plain', socks: 'plain' },
  source: { kind: 'generic', licence: 'n/a' } };

function squad(count: number, detail: DetailLevel = 'standard') {
  const kit = createKitMaterials(KIT, detail), atlas = createNumberAtlas('#ffffff', '#000000');
  const members: SquadMember[] = Array.from({ length: count }, (_, i) => {
    const rig = createCharacterRig({ appearance: GENERIC_APPEARANCE, detail, contactShadow: false });
    rig.root.position.set(10 + i * 8, 0, 20);
    return { rig, build: 1, parts: characterParts({ keeper: false, appearance: GENERIC_APPEARANCE, numberUv: atlas.uvFor(String(i + 1)), detail }) };
  });
  const scene = new THREE.Scene(), art = createSquadArt('squad-home', members, kit, atlas);
  scene.add(art.root); for (const m of members) scene.add(m.rig.root);
  return { scene, art, members, kit, atlas };
}

describe('createSquadArt', () => {
  it.each([['standard', 7], ['low', 6]] as const)('draws a whole %s team with at most %i meshes', (detail, max) => {
    const { art, members, kit, atlas } = squad(11, detail);
    expect(art.meshes.length).toBeLessThanOrEqual(max);
    expect(art.skeleton.bones).toHaveLength(11 * BONE_NAMES.length);
    art.dispose(); for (const m of members) m.rig.dispose(); kit.dispose(); atlas.dispose();
  });

  it('each member is skinned to its own bones at its own pitch position', () => {
    const { scene, art, members, kit, atlas } = squad(3);
    const shirt = art.meshes.find(m => m.name === 'squad-home-shirt')!, index = shirt.geometry.getAttribute('skinIndex');
    const at = (vertex: number) => { scene.updateMatrixWorld(true); shirt.skeleton.update(); return shirt.getVertexPosition(vertex, new THREE.Vector3()).clone(); };
    for (let member = 0; member < 3; member++) {
      const spine = member * BONE_NAMES.length + BONE_NAMES.indexOf('spine');
      const vertex = [...Array(index.count).keys()].find(i => index.getX(i) === spine)!;
      expect(Math.abs(at(vertex).x - (10 + member * 8))).toBeLessThan(.6); // torso sobre su raíz, no en el origen
    }
    const leftLeg = BONE_NAMES.length + BONE_NAMES.indexOf('leftLeg'), shorts = art.meshes.find(m => m.name === 'squad-home-shorts')!;
    const legIndex = shorts.geometry.getAttribute('skinIndex'), vertex = [...Array(legIndex.count).keys()].find(i => legIndex.getX(i) === leftLeg)!;
    const sample = () => { scene.updateMatrixWorld(true); shorts.skeleton.update(); return shorts.getVertexPosition(vertex, new THREE.Vector3()).clone(); };
    const rest = sample(); members[1].rig.leftLeg.rotation.x = -1; const kicked = sample();
    expect(kicked.distanceTo(rest)).toBeGreaterThan(.05);
    members[0].rig.leftLeg.rotation.x = -1; expect(sample().distanceTo(kicked)).toBe(0); // otro jugador no le afecta
    art.dispose(); for (const m of members) m.rig.dispose(); kit.dispose(); atlas.dispose();
  });

  it('dispose frees its own geometry and materials, never the team kit or atlas', () => {
    const { art, members, kit, atlas } = squad(2);
    const shared = [kit.shirt, kit.sleeves, kit.shorts, kit.socks, kit.skinTrim].map(m => vi.spyOn(m, 'dispose'));
    const atlasSpy = vi.spyOn(atlas.texture, 'dispose'), own = art.meshes.map(m => vi.spyOn(m.geometry, 'dispose'));
    art.dispose(); art.dispose();
    for (const spy of shared) expect(spy).not.toHaveBeenCalled();
    expect(atlasSpy).not.toHaveBeenCalled();
    for (const spy of own) expect(spy).toHaveBeenCalledTimes(1);
    expect(art.root.parent).toBeNull();
    for (const m of members) m.rig.dispose(); kit.dispose(); atlas.dispose();
  });
});
