import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createBallArt, createPlayerArt } from './three-art';

function resources(root: THREE.Object3D) {
  const owned = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      owned.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        owned.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) owned.add(value);
      }
    }
  });
  return [...owned];
}

it('owns articulated original player art and distinct illustrative kits', () => {
  const home = createPlayerArt('home', false), away = createPlayerArt('away', false), keeper = createPlayerArt('home', true);
  for (const art of [home, away, keeper]) {
    expect(art.root.getObjectByName('head')).toBeInstanceOf(THREE.Mesh);
    for (const joint of [art.leftArm, art.rightArm, art.leftLeg, art.rightLeg]) expect(joint.parent).toBe(art.body);
    expect(art.selection.visible).toBe(false);
  }
  const color = (art: typeof home) => ((art.root.getObjectByName('torso') as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex();
  expect(new Set([color(home), color(away), color(keeper)]).size).toBe(3);
  home.dispose(); away.dispose(); keeper.dispose();
});

it('resource_disposal_is_bounded even when meshes share geometries and materials', () => {
  for (const art of [createPlayerArt('home', false), createBallArt(.22)]) {
    const spies = resources(art.root).map(resource => vi.spyOn(resource, 'dispose'));
    expect(spies.length).toBeGreaterThan(2);
    art.dispose(); art.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  }
});
