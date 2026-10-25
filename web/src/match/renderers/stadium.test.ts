import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { estimateSceneCost } from './quality';
import { createStadiumArt, crowdPixels, drawBitmapText, FACADE_TEXT, grassPixels, LED_SEGMENTS, LED_TEXT, ledPixels } from './stadium';

function meshes(root: THREE.Object3D) {
  const list: THREE.Mesh[] = []; root.traverse(object => { if (object instanceof THREE.Mesh) list.push(object); }); return list;
}
function resources(root: THREE.Object3D) {
  const owned = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  for (const mesh of meshes(root)) {
    owned.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      owned.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) owned.add(value);
    }
  }
  return [...owned];
}
function worldBox(object: THREE.Object3D) { return new THREE.Box3().setFromObject(object); }

it('field_geometry_is_105_by_68 in the same world coordinates as the current pitch', () => {
  const stadium = createStadiumArt('standard'); stadium.root.updateMatrixWorld(true);
  const surface = worldBox(stadium.root.getObjectByName('surface')!);
  expect(surface.max.x - surface.min.x).toBeCloseTo(105); expect(surface.max.z - surface.min.z).toBeCloseTo(68);
  expect(surface.min.x).toBeCloseTo(0); expect(surface.min.z).toBeCloseTo(0);
  // Markings: touchlines/goal lines are centred on the field edge (line width 0.12 m).
  const markings = worldBox(stadium.root.getObjectByName('markings')!);
  expect(markings.min.x).toBeCloseTo(-.06, 2); expect(markings.max.x).toBeCloseTo(105.06, 2);
  expect(markings.min.z).toBeCloseTo(-.06, 2); expect(markings.max.z).toBeCloseTo(68.06, 2);
  for (const [name, x] of [['goal-home', 0], ['goal-away', 105]] as const) {
    const goal = stadium.root.getObjectByName(name)!; expect(goal).toBeDefined();
    const frame = worldBox(goal.getObjectByName(`${name}-frame`)!);
    expect((frame.min.x + frame.max.x) / 2).toBeCloseTo(x, 1);
    expect(frame.min.z).toBeCloseTo(34 - 3.66 - .065, 2); expect(frame.max.z).toBeCloseTo(34 + 3.66 + .065, 2);
    expect(frame.max.y).toBeCloseTo(2.44 + .065, 2);
    const net = worldBox(goal.getObjectByName(`${name}-net`)!);
    expect(Math.sign((net.min.x + net.max.x) / 2 - x)).toBe(x === 0 ? -1 : 1); // the net sits behind the goal line
  }
  const flags = worldBox(stadium.root.getObjectByName('corner-poles')!);
  expect(flags.min.x).toBeCloseTo(-.02, 2); expect(flags.max.x).toBeCloseTo(105.02, 2);
  expect(stadium.root.getObjectByName('stands')).toBeDefined();
  stadium.dispose();
});

it('stays inside the mesh and draw-call share of each quality tier', () => {
  const standard = createStadiumArt('standard'), low = createStadiumArt('low');
  expect(meshes(standard.root).length).toBeLessThanOrEqual(70);
  expect(meshes(low.root).length).toBeLessThanOrEqual(25);
  const s = estimateSceneCost(standard.root), l = estimateSceneCost(low.root);
  // The stadium leaves most of the budget (160 / 70 calls) to the 22 players and the ball.
  expect(s.calls).toBeLessThanOrEqual(25); expect(l.calls).toBeLessThanOrEqual(20);
  expect(s.triangles).toBeLessThanOrEqual(30_000); expect(l.triangles).toBeLessThanOrEqual(15_000);
  expect(s.textureBytes).toBeLessThanOrEqual(16 * 2 ** 20); expect(l.textureBytes).toBeLessThanOrEqual(6 * 2 ** 20);
  expect(l.textureBytes).toBeLessThan(s.textureBytes);
  // Low drops the facade, upper-tier light strips and the grass relief maps; no animated crowd in either tier.
  expect(standard.root.getObjectByName('facade')).toBeDefined(); expect(low.root.getObjectByName('facade')).toBeUndefined();
  expect(low.root.getObjectByName('roof-lights')).toBeUndefined();
  const turf = (art: typeof low) => (art.root.getObjectByName('surface') as THREE.Mesh).material as THREE.MeshStandardMaterial;
  expect(turf(standard).bumpMap).toBeInstanceOf(THREE.Texture); expect(turf(low).bumpMap).toBeNull();
  for (const art of [standard, low]) expect(art.root.getObjectByName('crowd-animated')).toBeUndefined();
  standard.dispose(); low.dispose();
});

it('LED boards and facade only ever carry the neutral TIMEPITCH brand', () => {
  expect(LED_TEXT).toBe('TIMEPITCH'); expect(FACADE_TEXT).toBe(LED_TEXT);
  expect(LED_SEGMENTS.length).toBeGreaterThan(1);
  for (const segment of LED_SEGMENTS) expect(segment.text).toBe('TIMEPITCH');
  // The bitmap font only has the brand's glyphs: club, sponsor or stadium names cannot be drawn.
  const target = { data: new Uint8Array(200 * 20 * 4), width: 200, height: 20 };
  expect(() => drawBitmapText(target, 'TIMEPITCH', 100, 10, 1, [255, 255, 255])).not.toThrow();
  for (const forbidden of ['CHELSEA', 'STAMFORD BRIDGE', 'SWANSEA', 'BARCLAYS']) {
    expect(() => drawBitmapText(target, forbidden, 100, 10, 1, [255, 255, 255])).toThrow(/glyph/i);
  }
  const led = ledPixels('low');
  expect(led.width).toBe(1024); expect(led.height).toBe(32);
  // The text actually lands on the board: the first segment has foreground (white) pixels.
  let lit = 0; for (let x = 0; x < led.width / LED_SEGMENTS.length; x++) for (let y = 0; y < led.height; y++) if (led.data[(y * led.width + x) * 4] > 200) lit++;
  expect(lit).toBeGreaterThan(50);
});

it('procedural textures are deterministic, mown in stripes and in range', () => {
  const a = grassPixels('low'), b = grassPixels('low');
  expect(a.data).toEqual(b.data);
  expect(a.width).toBe(Math.round(122 * 5)); expect(a.height).toBe(Math.round(84 * 5));
  // Average green of two neighbouring stripes differs (mowing pattern), sampled on one row.
  const row = Math.floor(a.height / 3), stripe = a.width / 22;
  const meanGreen = (i: number) => { let sum = 0, n = 0; for (let x = Math.ceil(i * stripe) + 1; x < Math.floor((i + 1) * stripe) - 1; x++) { sum += a.data[(row * a.width + x) * 4 + 1]; n++; } return sum / n; };
  expect(Math.abs(meanGreen(4) - meanGreen(5))).toBeGreaterThan(8);
  const crowd = crowdPixels(11, ['#ff0000', '#00ff00'], 512);
  expect(crowd.width).toBe(512); expect(crowd.height).toBe(256);
  expect(crowdPixels(11, ['#ff0000', '#00ff00'], 512).data).toEqual(crowd.data);
  expect(() => crowdPixels(11, [], 512)).toThrow();
});

it('optional crowd colours change only the crowd and keep the brand rules', () => {
  const neutral = createStadiumArt('low'), coloured = createStadiumArt('low', { crowd: { home: ['#034694', '#ffffff'], away: ['#ffffff', '#111111'] } });
  const pixels = (art: typeof neutral, name: string) => (((art.root.getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardMaterial).map as THREE.DataTexture).image.data;
  expect(pixels(coloured, 'crowd-home')).not.toEqual(pixels(neutral, 'crowd-home'));
  expect(pixels(coloured, 'led-boards')).toEqual(pixels(neutral, 'led-boards'));
  neutral.dispose(); coloured.dispose();
});

it('setAnisotropy updates the grazing-angle textures and dispose releases everything once', () => {
  const stadium = createStadiumArt('standard');
  stadium.setAnisotropy(8);
  const turf = ((stadium.root.getObjectByName('surface') as THREE.Mesh).material as THREE.MeshStandardMaterial).map!;
  expect(turf.anisotropy).toBe(8);
  const spies = resources(stadium.root).map(resource => vi.spyOn(resource, 'dispose'));
  expect(spies.length).toBeGreaterThan(10);
  const parent = new THREE.Scene(); parent.add(stadium.root);
  stadium.dispose(); stadium.dispose();
  for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  expect(stadium.root.parent).toBeNull(); expect(stadium.root.children).toHaveLength(0);
});
