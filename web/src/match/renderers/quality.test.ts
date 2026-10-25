import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createFrameTimeMonitor, estimateSceneCost, QUALITY_TIERS, withinBudget } from './quality';

it('quality tiers follow the design budgets (spec §7)', () => {
  expect(QUALITY_TIERS.standard).toMatchObject({ maxDrawCalls: 160, maxTriangles: 350_000, maxTextureMiB: 64, shadowMapSize: 2048, maxPixelRatio: 1.5 });
  expect(QUALITY_TIERS.low).toMatchObject({ maxDrawCalls: 70, maxTriangles: 120_000, maxTextureMiB: 24, shadowMapSize: 1024, maxPixelRatio: 1.25, bloom: false });
});

it('estimates draw calls, triangles and texture bytes, skipping hidden objects', () => {
  const root = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); root.add(box); // 12 tris
  const multi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial()));
  root.add(multi); // 6 groups, 6 calls
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); hidden.visible = false; root.add(hidden);
  const invisibleMaterial = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false })); root.add(invisibleMaterial);
  const texture = new THREE.DataTexture(new Uint8Array(16 * 8 * 4), 16, 8);
  const textured = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture })); root.add(textured);
  const cost = estimateSceneCost(root);
  expect(cost).toEqual({ calls: 8, triangles: 26, textureBytes: 16 * 8 * 4 });
  expect(withinBudget(cost, 'low')).toBe(true);
  expect(withinBudget({ calls: 71, triangles: 10 }, 'low')).toBe(false);
  expect(withinBudget({ calls: 71, triangles: 10 }, 'standard')).toBe(true);
  expect(withinBudget({ calls: 10, triangles: 350_001 }, 'standard')).toBe(false);
});

it('auto quality drop: a 3 s window whose frames cost over 33 ms drops once and never comes back', () => {
  const monitor = createFrameTimeMonitor();
  let t = 0, drops = 0;
  for (let i = 0; i < 40; i++) { t += 16; if (monitor.sample(t, 6)) drops++; } // fluido
  expect(drops).toBe(0);
  for (let i = 0; i < 100; i++) { t += 40; if (monitor.sample(t, 38)) drops++; } // 4 s dibujando 38 ms por fotograma
  expect(drops).toBe(1); expect(monitor.dropped).toBe(true);
  for (let i = 0; i < 400; i++) { t += 10; if (monitor.sample(t, 2)) drops++; }
  expect(drops).toBe(1); expect(monitor.dropped).toBe(true);
});

it.each([[33.34, '60/120 Hz'], [34.72, '144 Hz'], [40, '75 Hz'], [41.67, '48 Hz']])(
  'the app publish cadence (%s ms, %s) with cheap frames never degrades', interval => {
    const monitor = createFrameTimeMonitor();
    let t = 0;
    for (let i = 0; i < 600; i++) { t += interval; expect(monitor.sample(t, 4)).toBe(false); } // 20 s sostenidos
    expect(monitor.dropped).toBe(false);
  });

it('auto quality drop also catches a browser stuck under 20 fps even when the measurable work is cheap', () => {
  const monitor = createFrameTimeMonitor();
  let t = 0, drops = 0;
  for (let i = 0; i < 100; i++) { t += 60; if (monitor.sample(t, 5)) drops++; } // 6 s a ~16 fps (GPU)
  expect(drops).toBe(1); expect(monitor.dropped).toBe(true);
});

it('counts the shadow pass when asked: each shadow caster is drawn again', () => {
  const root = new THREE.Group();
  const caster = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); caster.castShadow = true; root.add(caster);
  const receiver = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()); receiver.receiveShadow = true; root.add(receiver);
  expect(estimateSceneCost(root)).toMatchObject({ calls: 2, triangles: 14 });
  expect(estimateSceneCost(root, { shadowPass: true })).toMatchObject({ calls: 3, triangles: 26 });
});

it('auto quality drop ignores pauses, hidden tabs and short hitches', () => {
  const monitor = createFrameTimeMonitor();
  let t = 0;
  for (let i = 0; i < 60; i++) { t += i % 2 ? 2000 : 16; expect(monitor.sample(t)).toBe(false); } // pausa / pestaña oculta
  for (let i = 0; i < 20; i++) { t += 60; expect(monitor.sample(t, 55)).toBe(false); } // tirón de 1,2 s
  for (let i = 0; i < 200; i++) { t += 20; expect(monitor.sample(t, 5)).toBe(false); }
  expect(monitor.dropped).toBe(false);
  expect(monitor.sample(NaN)).toBe(false);
});
