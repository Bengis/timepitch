import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createLighting } from './lighting';

// jsdom has no WebGL: a plain object stands in for the renderer settings the lighting rig owns.
function fakeDevice() {
  return { shadowMap: { enabled: false, type: THREE.BasicShadowMap }, toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1, outputColorSpace: THREE.LinearSRGBColorSpace } as unknown as THREE.WebGLRenderer;
}
function lights(scene: THREE.Scene) {
  const list: THREE.Light[] = []; scene.traverse(object => { if (object instanceof THREE.Light) list.push(object); }); return list;
}
const shadowCasters = (scene: THREE.Scene) => lights(scene).filter(light => light.castShadow) as THREE.DirectionalLight[];

it('floodlights on low keep a single 1024 shadow and no environment map', () => {
  const scene = new THREE.Scene(), device = fakeDevice(), rig = createLighting(scene, device);
  rig.apply('floodlights', 'low');
  const casters = shadowCasters(scene);
  expect(casters).toHaveLength(1); expect(casters[0].shadow.mapSize.x).toBe(1024); expect(casters[0].shadow.mapSize.y).toBe(1024);
  expect(device.shadowMap.enabled).toBe(true); expect(device.shadowMap.type).toBe(THREE.PCFShadowMap);
  expect(scene.environment).toBeNull();
  rig.dispose();
});

it('standard uses one 2048 shadow, ACES tone mapping and a night or day sky', () => {
  const scene = new THREE.Scene(), device = fakeDevice(), rig = createLighting(scene, device);
  rig.apply('floodlights', 'standard');
  expect(shadowCasters(scene)).toHaveLength(1); expect(shadowCasters(scene)[0].shadow.mapSize.x).toBe(2048);
  expect(device.toneMapping).toBe(THREE.ACESFilmicToneMapping); expect(device.outputColorSpace).toBe(THREE.SRGBColorSpace);
  const night = (scene.background as THREE.Color).getHSL({ h: 0, s: 0, l: 0 }).l, sky = scene.background;
  expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
  rig.apply('daylight', 'standard');
  const day = (scene.background as THREE.Color).getHSL({ h: 0, s: 0, l: 0 }).l;
  expect(day).toBeGreaterThan(night);
  expect(scene.background).toBe(sky); // se reutiliza el mismo Color en cada fotograma
  expect(device.toneMappingExposure).toBeGreaterThan(0);
  // Every light aims at the centre spot of the 105x68 field.
  for (const light of lights(scene)) if (light instanceof THREE.DirectionalLight) expect(light.target.position.toArray()).toEqual([52.5, 0, 34]);
  rig.dispose();
});

it('changing tier reallocates the shadow map and dispose removes the rig', () => {
  const scene = new THREE.Scene(), rig = createLighting(scene, fakeDevice());
  rig.apply('floodlights', 'standard');
  const caster = shadowCasters(scene)[0];
  const stale = new THREE.WebGLRenderTarget(4, 4); caster.shadow.map = stale;
  rig.apply('floodlights', 'low');
  expect(caster.shadow.map).toBeNull(); expect(caster.shadow.mapSize.x).toBe(1024);
  rig.apply('floodlights', 'low'); // same tier: nothing to reallocate
  rig.dispose(); rig.dispose();
  expect(lights(scene)).toHaveLength(0);
  expect(scene.fog).toBeNull(); expect(scene.background).toBeNull(); expect(scene.environment).toBeNull();
});
