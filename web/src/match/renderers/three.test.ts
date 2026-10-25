import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CHARACTER_VISUAL_SCALE, createThreeRenderer, renderBudget, SIDE_KITS } from './three';
import { estimateSceneCost, QUALITY_TIERS } from './quality';
import { BROADCAST_TILT_DEG } from './camera';
import { deriveCharacterPose } from './character';
import { GENERIC_APPEARANCE, type CastEntry, type KitSpec, type MatchCast } from '../../presentation/types';
import type { PitchRenderer, PitchRenderInput } from './types';
import { derivePlayerPose } from './poses';

const gpu = vi.hoisted(() => ({ instances: [] as {
  render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>; setPixelRatio: ReturnType<typeof vi.fn>;
  forceContextLoss: ReturnType<typeof vi.fn>;
  shadowMap: { enabled: boolean; type: number };
  info: { render: { calls: number; triangles: number }; memory: { textures: number } };
}[], fail: false }));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    render = vi.fn(); dispose = vi.fn(); setSize = vi.fn(); setPixelRatio = vi.fn();
    forceContextLoss = vi.fn(); getContext = () => ({ isContextLost: () => false });
    shadowMap = { enabled: false, type: 0 };
    info = { render: { calls: 0, triangles: 0 }, memory: { textures: 0 } };
    constructor() { if (gpu.fail) throw new Error('No WebGL'); gpu.instances.push(this); }
  } };
});
const live: PitchRenderer[] = [];
it.each([[942,440,710],[356,237.328125,320]])('overview uses the available pitch area at %sx%s without cutting the field', (width,height,minWidth)=>{
  const value=input(),before=JSON.stringify(value),{renderer}=setup(value);
  renderer.resize({width,height},1);const projection=renderer.update(value);
  const points=[...[-3,108].flatMap(x=>[0,68].map(y=>projection.projectFieldPoint(x,y)))];
  expect(points.every(Boolean)).toBe(true);
  const corners=[0,105].flatMap(x=>[0,68].map(y=>projection.projectFieldPoint(x,y)!));
  expect(Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x))).toBeGreaterThanOrEqual(minWidth);
  expect(JSON.stringify(value)).toBe(before);
});
it('team-batched stylized bodies keep source roots, selection and picking anchored',()=>{
  const value=input(),before=JSON.stringify(value),{renderer,drawn}=setup(value);
  renderer.resize({width:942,height:440},1);const projection=renderer.update(value);
  const player=drawn().scene.getObjectByName('player:home:p')!;
  expect(player.scale.x).toBeCloseTo(CHARACTER_VISUAL_SCALE);
  // Tamaño visible real: la caja de los vértices ya deformados por el esqueleto del lote, no solo la escala de la raíz.
  const squad = drawn().scene.getObjectByName('squad-home')!, body = new THREE.Box3();
  squad.traverse(o => { if (o instanceof THREE.SkinnedMesh) body.union(new THREE.Box3().setFromObject(o, true)); });
  const size = body.getSize(new THREE.Vector3()), centre = body.getCenter(new THREE.Vector3());
  expect(size.y).toBeGreaterThan(1.9); expect(size.y).toBeLessThan(2.5); expect(body.min.y).toBeGreaterThan(-.05);
  expect(centre.x).toBeCloseTo(24, 0); expect(centre.z).toBeCloseTo(22, 0);
  expect(drawn().scene.getObjectByName('squad-home-shirt')).toBeInstanceOf(THREE.SkinnedMesh);
  expect(player.position.toArray()).toEqual([24,0,22]);
  expect(renderer.pickPlayer(projection.projectFieldPoint(24,22)!)).toBe('home:p');
  expect(JSON.stringify(value)).toBe(before);
});
it('explicit field focus survives ball gaps and null focus uses overview without changing source roots',()=>{
  const value=input(),{renderer,drawn}=setup(value);renderer.resize({width:900,height:600},1);
  const focused={...value,camera:'follow' as const,fieldFocus:{x:25,y:40},frame:{...value.frame,ball:null}};
  const first=renderer.update(focused).projectFieldPoint(25,40)!;
  expect(first.x).toBeCloseTo(450);expect(first.y).toBeCloseTo(300);
  renderer.update({...value,camera:'follow',fieldFocus:{x:75,y:10}});
  expect(renderer.update(focused).projectFieldPoint(25,40)).toEqual(first);
  const centre=renderer.update({...focused,fieldFocus:null}).projectFieldPoint(52.5,34)!;
  expect(centre.x).toBeCloseTo(450);expect(centre.y).toBeCloseTo(300);
  expect(drawn().scene.getObjectByName('player:home:p')!.position.toArray()).toEqual([24,0,22]);
});
beforeEach(() => { gpu.instances.length = 0; gpu.fail = false; });
afterEach(() => { for (const renderer of live.splice(0)) renderer.dispose(); vi.restoreAllMocks(); });
function input(): PitchRenderInput {
  const player = Object.freeze({ key: 'home:p', name: 'Player', side: 'home' as const, role: 'MID' as const, x: 24, y: 22 });
  const frame = Object.freeze({ clock_ms: 1500, period: 1, score: Object.freeze({ home: 0, away: 0 }), carrier: null,
    possession: null, ball: Object.freeze({ x: 60, y: 35 }), players: Object.freeze([player]) as unknown as typeof player[] });
  return Object.freeze({ frame, previous: frame, restarting: false, selectedPlayerKey: null, camera: 'overview',
    appearance: 'daylight', detail: 'standard', labels: { home: 'Home', away: 'Away', clock: '00:01', goal: 'Goal' } });
}
function setup(value = input()) {
  const canvas = document.createElement('canvas'), failure = vi.fn();
  const renderer = createThreeRenderer(canvas, value, failure); live.push(renderer);
  const device = gpu.instances.at(-1)!;
  const drawn = () => {
    const [scene, camera] = device.render.mock.calls.at(-1)! as [THREE.Scene, THREE.PerspectiveCamera];
    return { scene, camera };
  };
  return { canvas, failure, renderer, device, drawn };
}

it('three_projection_rejects_behind_camera and preserves old projection snapshots', () => {
  const value = input(), before = JSON.stringify(value), { renderer, drawn } = setup(value);
  renderer.resize({ width: 1000, height: 600 }, 1);
  const projection = renderer.update(value), centre = projection.projectFieldPoint(52.5, 34);
  expect(centre).not.toBeNull();
  expect(projection.projectFieldPoint(NaN, 10)).toBeNull();
  const { camera } = drawn();
  const direction = camera.getWorldDirection(new THREE.Vector3());
  expect(projection.projectFieldPoint(camera.position.x - direction.x * 10000, camera.position.z - direction.z * 10000)).toBeNull();
  renderer.resize({ width: 390, height: 844 }, 2);
  renderer.update({ ...value, camera: 'follow', selectedPlayerKey: 'home:p' });
  expect(projection.projectFieldPoint(52.5, 34)).toEqual(centre);
  expect(JSON.stringify(value)).toBe(before);
});

it('noncentral_pick_survives_resize_and_dpr with exact source roots', () => {
  const value = input(), { renderer, device, drawn } = setup(value);
  for (const [width, height, dpr] of [[1000, 600, 1], [390, 844, 1.5], [780, 500, 2]]) {
    renderer.resize({ width, height }, dpr);
    const projection = renderer.update(value), point = projection.projectFieldPoint(24, 22)!;
    expect(point).not.toBeNull();
    expect(renderer.pickPlayer(point)).toBe('home:p');
    expect(renderer.pickPlayer({ x: -1, y: 10 })).toBeNull();
    expect(device.setPixelRatio).toHaveBeenLastCalledWith(Math.min(dpr, 1.5));
    const root = drawn().scene.getObjectByName('player:home:p')!;
    expect(root.position.toArray()).toEqual([24, 0, 22]);
    for (const x of [-3, 108]) for (const y of [0, 68]) expect(projection.projectFieldPoint(x, y)).not.toBeNull();
  }
  for (const dpr of [NaN, Infinity, 0, -1]) {
    renderer.resize({ width: 500, height: 400 }, dpr); expect(device.setPixelRatio).toHaveBeenLastCalledWith(1);
  }
});

it('picking overlapping meshes resolves stable source keys rather than names or slots', () => {
  const value = input(), p = value.frame.players[0];
  const overlap = { ...value, frame: { ...value.frame, players: [{ ...p, key: 'away:z', side: 'away' as const }, p] } };
  const { renderer } = setup(overlap); renderer.resize({ width: 900, height: 600 }, 1);
  const point = renderer.update(overlap).projectFieldPoint(p.x, p.y)!;
  expect(renderer.pickPlayer(point)).toBe('away:z');
  renderer.update({ ...overlap, frame: { ...overlap.frame, players: [...overlap.frame.players].reverse() } });
  expect(renderer.pickPlayer(point)).toBe('away:z');
});

it('ball_null_removes_mesh and never derives altitude or attaches to a player', () => {
  const value = input(), { renderer, drawn } = setup(value);
  renderer.update(value);
  const ball = drawn().scene.getObjectByName('ball')!;
  expect(ball.position.toArray()).toEqual([60, .22, 35]);
  renderer.update({ ...value, frame: { ...value.frame, ball: null } });
  expect(drawn().scene.getObjectByName('ball')).toBeUndefined();
  renderer.update(value); expect(drawn().scene.getObjectByName('ball')!.position.toArray()).toEqual([60, .22, 35]);
});

it('focus falls back from active selection to known ball to centre; low detail bounds shadows', () => {
  const value = input(), { renderer, device, drawn } = setup(value);
  renderer.resize({ width: 900, height: 600 }, 1);
  const selected = renderer.update({ ...value, camera: 'follow', selectedPlayerKey: 'home:p' }).projectFieldPoint(24, 22)!;
  expect(selected.x).toBeCloseTo(450); expect(selected.y).toBeCloseTo(300);
  const ball = renderer.update({ ...value, camera: 'follow', selectedPlayerKey: 'removed' }).projectFieldPoint(60, 35)!;
  expect(ball.x).toBeCloseTo(450); expect(ball.y).toBeCloseTo(300);
  const centre = renderer.update({ ...value, frame: { ...value.frame, ball: null }, camera: 'follow' }).projectFieldPoint(52.5, 34)!;
  expect(centre.x).toBeCloseTo(450); expect(centre.y).toBeCloseTo(300);
  const light = drawn().scene.getObjectByName('key-light') as THREE.DirectionalLight;
  expect(light.shadow.mapSize.toArray()).toEqual([2048, 2048]); expect(device.shadowMap.enabled).toBe(true);
  renderer.update({ ...value, detail: 'low', appearance: 'floodlights' });
  expect(light.shadow.mapSize.toArray()).toEqual([1024, 1024]);
  const casting: THREE.Light[] = []; drawn().scene.traverse(o => { if (o instanceof THREE.Light && o.castShadow) casting.push(o); });
  expect(casting).toEqual([light]); // spec §7: una sola luz con sombra
});

it('resource_disposal_is_bounded after context loss, late updates and repeated dispose', () => {
  const { renderer, device, drawn, canvas, failure } = setup(); renderer.update(input());
  const owned = new Set<THREE.BufferGeometry | THREE.Material>();
  drawn().scene.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      owned.add(object.geometry); for (const m of Array.isArray(object.material) ? object.material : [object.material]) owned.add(m);
    }
  });
  const spies = [...owned].map(resource => vi.spyOn(resource, 'dispose'));
  const event = new Event('webglcontextlost', { cancelable: true }); canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true); expect(failure).toHaveBeenCalledExactlyOnceWith('context_lost');
  const calls = device.render.mock.calls.length;
  canvas.dispatchEvent(new Event('webglcontextlost')); renderer.update(input()); renderer.resize({ width: 400, height: 400 }, 1);
  expect(renderer.pickPlayer({ x: 200, y: 200 })).toBeNull(); renderer.dispose(); renderer.dispose();
  expect(failure).toHaveBeenCalledTimes(1); expect(device.render).toHaveBeenCalledTimes(calls); expect(device.dispose).toHaveBeenCalledTimes(1);
  expect(device.forceContextLoss).toHaveBeenCalledTimes(1);
  for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
});

it('updates the shadow projection to cover the field instead of the default small volume', () => {
  const { drawn } = setup();
  const light = drawn().scene.getObjectByName('key-light') as THREE.DirectionalLight;
  expect(light.shadow.camera.projectionMatrix.elements[0]).toBeLessThanOrEqual(2 / 105);
  expect(light.shadow.camera.projectionMatrix.elements[5]).toBeLessThanOrEqual(2 / 68);
});

it('initialization failure reports once without starting any clock', () => {
  gpu.fail = true; const failure = vi.fn();
  expect(() => createThreeRenderer(document.createElement('canvas'), input(), failure)).toThrow('No WebGL');
  expect(failure).toHaveBeenCalledExactlyOnceWith('initialization');
});

it('substitution_removes_old_player and applies poses to child visuals only', () => {
  const value = input(), previous = { ...value.frame, clock_ms: 1400, players: [{ ...value.frame.players[0], x: 23.5 }] };
  const running = { ...value, previous }, { renderer, drawn } = setup(running);
  const old = drawn().scene.getObjectByName('player:home:p')!;
  expect(old.position.toArray()).toEqual([24, 0, 22]);
  expect(old.children[0].rotation.y).toBe(derivePlayerPose(running, 'home:p')!.facing);
  const torso = drawn().scene.getObjectByName('squad-home-shirt') as THREE.Mesh, dispose = vi.spyOn(torso.geometry, 'dispose');
  const replacement = { ...running, frame: { ...running.frame, ball: null, players: [{ ...running.frame.players[0], key: 'home:sub', x: 26 }] } };
  renderer.update(replacement);
  expect(drawn().scene.getObjectByName('player:home:p')).toBeUndefined();
  expect(old.parent).toBeNull(); expect(dispose).toHaveBeenCalledTimes(1);
  expect(drawn().scene.getObjectByName('player:home:sub')!.position.toArray()).toEqual([26, 0, 22]);
  expect(drawn().scene.getObjectByName('ball')).toBeUndefined();
  renderer.update(running);
  const restored = drawn().scene.getObjectByName('player:home:p')!;
  expect(restored).not.toBe(old); expect(restored.position.toArray()).toEqual([24, 0, 22]);
  expect(restored.children[0].rotation.y).toBe(derivePlayerPose(running, 'home:p')!.facing);
});

/* ------------------------------------------------------------------ G09: cast, cámaras, cortes, presupuesto */

const kit = (shirt: string, number = '#ffffff'): KitSpec => ({ ...SIDE_KITS.home, shirt, sleeves: { left: shirt, right: shirt }, socks: shirt, number,
  source: { kind: 'wikipedia', licence: 'CC BY-SA 4.0' } });
const entry = (number: string | null, over: Partial<CastEntry['appearance']> = {}): CastEntry =>
  ({ number, displayName: null, appearance: { ...GENERIC_APPEARANCE, ...over }, appearanceSource: 'hand_assigned', record: null });
function castFor(players: [string, CastEntry][]): MatchCast {
  return { kits: { home: kit('#c8102e'), away: kit('#034694'), homeKeeper: kit('#1b1b1b'), awayKeeper: kit('#f5d000'), choice: 'source' },
    players: new Map(players) };
}
function squadInput(): PitchRenderInput {
  const base = input(), players: unknown[] = [];
  for (const side of ['home', 'away'] as const) for (let i = 0; i < 11; i++) players.push({ key: `${side}:${i}`, name: `${side} ${i}`, side,
    role: i === 0 ? 'GK' : 'MID', x: side === 'home' ? 8 + i * 4 : 97 - i * 4, y: 6 + i * 5.5 });
  const frame = { ...base.frame, players } as PitchRenderInput['frame'];
  return { ...base, frame, previous: frame };
}
const shirtColour = (scene: THREE.Scene, slot: string) =>
  ((scene.getObjectByName(`squad-${slot}-shirt`) as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString();

it('cast kits dress outfield players and keepers; without cast the side colours stay', () => {
  const value = squadInput(), { renderer, drawn } = setup(value);
  expect(shirtColour(drawn().scene, 'home')).toBe(SIDE_KITS.home.shirt.slice(1));
  renderer.update({ ...value, cast: castFor([['home:7', entry('7')], ['home:0', entry('1')]]) });
  const scene = drawn().scene;
  expect(shirtColour(scene, 'home')).toBe('c8102e'); expect(shirtColour(scene, 'homeKeeper')).toBe('1b1b1b');
  expect(shirtColour(scene, 'away')).toBe('034694'); expect(shirtColour(scene, 'awayKeeper')).toBe('f5d000');
  expect(scene.getObjectByName('squad-home-number')).toBeDefined(); // dorsal solo si el cast lo trae
  expect(scene.getObjectByName('squad-away-number')).toBeUndefined();
});

it('a new cast object does not recreate players unless their CastEntry changes', () => {
  const value = squadInput(), cast = castFor([['home:7', entry('7')], ['home:3', entry('3')]]), { renderer, drawn } = setup({ ...value, cast });
  const seven = drawn().scene.getObjectByName('player:home:7'), three = drawn().scene.getObjectByName('player:home:3');
  renderer.update({ ...value, cast: castFor([['home:7', entry('7')], ['home:3', entry('3')]]) });
  expect(drawn().scene.getObjectByName('player:home:7')).toBe(seven);
  renderer.update({ ...value, cast: castFor([['home:7', entry('7', { skin: 's7' })], ['home:3', entry('3')]]) });
  expect(drawn().scene.getObjectByName('player:home:7')).not.toBe(seven);
  expect(drawn().scene.getObjectByName('player:home:3')).toBe(three);
  expect(seven!.parent).toBeNull();
});

it('broadcast camera sits at about 22 degrees and keeps the ball in view; near is closer', () => {
  const value = { ...squadInput(), camera: 'follow' as const }, { renderer, drawn } = setup(value);
  renderer.resize({ width: 1280, height: 720 }, 1);
  const projection = renderer.update(value), { camera } = drawn();
  const direction = camera.getWorldDirection(new THREE.Vector3());
  expect(THREE.MathUtils.radToDeg(Math.asin(-direction.y))).toBeCloseTo(BROADCAST_TILT_DEG, 3);
  const ball = projection.projectFieldPoint(60, 35)!;
  expect(ball.x).toBeCloseTo(640); expect(ball.y).toBeCloseTo(360);
  const broadcastDistance = camera.position.distanceTo(new THREE.Vector3(60, 0, 35));
  renderer.update({ ...value, framing: 'near' });
  expect(drawn().camera.position.distanceTo(new THREE.Vector3(60, 0, 35))).toBeLessThan(broadcastDistance / 1.8);
  expect(renderer.update({ ...value, framing: 'near' }).projectFieldPoint(60, 35)).not.toBeNull();
});

it('a mass repositioning is a cut: nobody runs across the teleport', () => {
  const value = squadInput();
  // away:9 se mueve 0,4 m en 100 ms (correría); seis jugadores saltan 20 m a la vez (saque tras gol).
  const previous = { ...value.frame, clock_ms: 1400,
    players: value.frame.players.map((p, i) => i < 6 ? { ...p, x: p.x + 20 } : p.key === 'away:9' ? { ...p, x: p.x - .4 } : p) };
  const teleport = { ...value, previous };
  const { drawn } = setup(teleport);
  const leg = (drawn().scene.getObjectByName('player:away:9') as THREE.Group).getObjectByName('left-leg')!;
  const still = deriveCharacterPose({ ...teleport, restarting: true }, 'away:9', false)!;
  expect(leg.rotation.x).toBeCloseTo(still.limbs.leftLeg.x);
  expect(deriveCharacterPose(teleport, 'away:9', false)!.stance).toBe('run'); // sin el corte, correría
});

it('ball height is drawn only when the source provides it, with a ground shadow', () => {
  const value = input(), { renderer, drawn } = setup(value);
  renderer.update({ ...value, frame: { ...value.frame, ball: { x: 60, y: 35, z: 2 } as never } });
  const ball = drawn().scene.getObjectByName('ball')!;
  expect(ball.position.toArray()).toEqual([60, 2.22, 35]);
  const shadow = ball.getObjectByName('ball-contact')!;
  expect(ball.position.y + shadow.position.y).toBeCloseTo(.018);
  renderer.update(value); expect(ball.position.toArray()).toEqual([60, .22, 35]);
});

it.each(['standard', 'low'] as const)('a full 22-player %s frame, shadow pass included, stays within the draw-call and triangle budget', detail => {
  const value = { ...squadInput(), detail, cast: castFor(Array.from({ length: 11 }, (_, i) => [`home:${i}`, entry(String(i + 1))] as [string, CastEntry])) };
  const { drawn } = setup(value), cost = estimateSceneCost(drawn().scene, { shadowPass: true }), tier = QUALITY_TIERS[detail];
  expect(cost.calls).toBeLessThanOrEqual(tier.maxDrawCalls); expect(cost.triangles).toBeLessThanOrEqual(tier.maxTriangles);
  expect(cost.textureBytes).toBeLessThanOrEqual(tier.maxTextureMiB * 1024 * 1024);
});

it('renderBudget reports the last drawn frame from renderer.info and is cleared by its renderer dispose', () => {
  const other = setup().renderer, { renderer, device } = setup();
  device.render.mockImplementation(() => { device.info.render.calls = 57; device.info.render.triangles = 61_000; device.info.memory.textures = 9; });
  renderer.update(input());
  expect(renderBudget()).toEqual({ calls: 57, triangles: 61_000, textures: 9 });
  other.dispose(); expect(renderBudget().calls).toBe(57); // otra instancia no borra la cifra de esta
  renderer.dispose(); expect(renderBudget()).toEqual({ calls: 0, triangles: 0, textures: 0 });
});

it.each([33.34, 34.72])('the app publish cadence (%s ms) with cheap frames keeps standard quality', interval => {
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const value = input(), { renderer, canvas, device } = setup(value);
  device.render.mockImplementation(() => { clock += 4; });
  for (let i = 0; i < 300; i++) { clock += interval - 4; renderer.update({ ...value, frame: { ...value.frame, clock_ms: 1500 + i * 33 } }); }
  expect(canvas.dataset.quality).toBe('standard');
});

it('drops to low quality once after sustained slow frames and never comes back', () => {
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const value = input(), { renderer, canvas, device } = setup(value);
  expect(canvas.dataset.quality).toBe('standard');
  device.render.mockImplementation(() => { clock += 38; }); // cada fotograma cuesta 38 ms de dibujo
  for (let i = 0; i < 120; i++) { clock += 2; renderer.update({ ...value, frame: { ...value.frame, clock_ms: 1500 + i * 40 } }); }
  expect(canvas.dataset.quality).toBe('auto-low');
  device.render.mockImplementation(() => {});
  expect(device.setPixelRatio).toHaveBeenLastCalledWith(1);
  for (let i = 0; i < 400; i++) { clock += 8; renderer.update(value); }
  expect(canvas.dataset.quality).toBe('auto-low');
});
