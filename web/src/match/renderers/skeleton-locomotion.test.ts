import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createSkeletonPlayers, type SkeletonLook, type SkeletonPlayers } from './skeleton-players';
import type { PitchRenderInput } from './types';

// Exercise the real mixer/bones without GLTF assets, network or a WebGL context.
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async () => {
  const T = await import('three');
  return { GLTFLoader: class {
    async loadAsync(url: string) {
      const scene = new T.Group();
      for (const name of ['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'upperarm_l', 'upperarm_r',
        'lowerarm_l', 'lowerarm_r', 'spine_01', 'spine_03', 'neck_01']) {
        const bone = new T.Bone(); bone.name = name; scene.add(bone);
      }
      const clips = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Crouch_Idle_Loop'];
      return { scene, animations: url.includes('animations') ? clips.map((name, index) => {
        const values = [-.3, .3, -.3].flatMap(angle => new T.Quaternion()
          .setFromAxisAngle(new T.Vector3(1, 0, 0), index === 0 ? 0 : angle * index).toArray());
        return new T.AnimationClip(name, 1, [new T.QuaternionKeyframeTrack('thigh_l.quaternion', [0, .5, 1], values)]);
      }) : [] };
    }
  } };
});

const LOOK: SkeletonLook = { shirt: '#f00', sleeves: '#f00', shorts: '#fff', socks: '#fff', numberColour: '#000',
  skin: '#a87652', hair: '#321', boots: '#111', number: '1', keeper: false, hairStyle: 'short', beard: 'none', height: 1, build: 1 };
function input(clock: number, x = 50, y = 30, previous = { clock: clock - 100, x, y }): PitchRenderInput {
  const frame = { clock_ms: clock, period: 1, ball: { x: 40, y: 20 }, possession: null, score: null,
    players: [{ key: 'h1', side: 'home', role: 'GK', x, y }] };
  return { frame, previous: { ...frame, clock_ms: previous.clock, players: [{ ...frame.players[0], x: previous.x, y: previous.y }] },
    restarting: false, selectedPlayerKey: null, camera: 'follow', appearance: 'daylight', detail: 'standard',
    labels: { home: 'Home', away: 'Away', clock: '', goal: '' } } as PitchRenderInput;
}

let actionSpy: MockInstance<THREE.AnimationMixer['clipAction']>;
const rigs: SkeletonPlayers[] = [];
beforeEach(() => { actionSpy = vi.spyOn(THREE.AnimationMixer.prototype, 'clipAction'); });
afterEach(() => { for (const rig of rigs.splice(0)) rig.dispose(); vi.restoreAllMocks(); });
async function rig(keeper = false) {
  const scene = new THREE.Scene(), players = createSkeletonPlayers(scene); rigs.push(players);
  await vi.waitFor(() => expect(players.ready).toBe(true));
  return {
    draw(frame: PitchRenderInput) { players.update(frame, () => ({ ...LOOK, keeper })); },
    root() { return scene.getObjectByName('skeleton:h1')!; },
    action(name: string) { return actionSpy.mock.results.map(result => result.value as THREE.AnimationAction)
      .find(action => action.getRoot() === this.root() && action.getClip().name === name)!; },
    pose() {
      const result: number[][] = [];
      this.root().traverse(object => result.push([...object.position.toArray(), ...object.quaternion.toArray()]));
      return result;
    },
  };
}

describe('skeletal locomotion clock', () => {
  it('preserves stride, facing and lean when the same moving frame is redrawn in pause/resize', async () => {
    const actor = await rig();
    actor.draw(input(1000));
    actor.draw(input(1100, 50.4, 30, { clock: 1000, x: 50, y: 30 }));
    const corner = input(1200, 50.4, 30.4, { clock: 1100, x: 50.4, y: 30 });
    actor.draw(corner);
    const pose = actor.pose(), stride = actor.action('Walk_Loop').time;
    for (let i = 0; i < 8; i++) actor.draw(corner);
    expect(actor.pose()).toEqual(pose);
    expect(actor.action('Walk_Loop').time).toBe(stride);
  });

  it('duplicate renders cannot alter the pose of the next new frame', async () => {
    const once = await rig(), redrawn = await rig();
    const start = input(1000), moving = input(1100, 50.3, 30, { clock: 1000, x: 50, y: 30 });
    for (const actor of [once, redrawn]) { actor.draw(start); actor.draw(moving); }
    for (let i = 0; i < 12; i++) redrawn.draw(moving);
    const next = input(1200, 50.3, 30.3, { clock: 1100, x: 50.3, y: 30 });
    for (const actor of [once, redrawn]) actor.draw(next);
    expect(redrawn.pose()).toEqual(once.pose());
  });

  it('uses the last drawn actor position and clock when previous is a repeated source sample', async () => {
    const normal = await rig(), repeatedPrevious = await rig();
    for (const actor of [normal, repeatedPrevious]) actor.draw(input(1000));
    normal.draw(input(1100, 50.2, 30, { clock: 1000, x: 50, y: 30 }));
    repeatedPrevious.draw(input(1100, 50.2, 30, { clock: 1100, x: 50.2, y: 30 }));
    expect(repeatedPrevious.pose()).toEqual(normal.pose());
    expect(repeatedPrevious.action('Walk_Loop').time).toBe(normal.action('Walk_Loop').time);
  });

  it.each(['restart', 'backward', 'gap', 'teleport', 'period', 'presentation'] as const)('resets stride and lean on %s', async kind => {
    const actor = await rig(), fresh = await rig();
    actor.draw(input(1000)); actor.draw(input(1100, 50.4, 30, { clock: 1000, x: 50, y: 30 }));
    let cut = input(kind === 'backward' ? 900 : kind === 'gap' ? 2200 : 1200,
      kind === 'teleport' ? 60 : 50.4, 30, { clock: 1100, x: 50.4, y: 30 });
    if (kind === 'restart') cut = { ...cut, restarting: true };
    if (kind === 'period') cut = { ...cut, frame: { ...cut.frame, period: 2 } };
    if (kind === 'presentation') cut = { ...cut, presentation: 'walkout' };
    actor.draw(cut); fresh.draw(cut);
    expect(actor.pose()).toEqual(fresh.pose());
    expect(actor.action('Walk_Loop').time).toBe(fresh.action('Walk_Loop').time);
    const pose = actor.pose(); actor.draw(cut); expect(actor.pose()).toEqual(pose);
  });
});

describe('walkout presentation locomotion', () => {
  it('walks upright even for the keeper, faces slow motion and ignores match gestures', async () => {
    const actor = await rig(true);
    actor.draw({ ...input(1000), presentation: 'walkout' });
    actor.draw({ ...input(1100, 50.06, 30, { clock: 1000, x: 50, y: 30 }), presentation: 'walkout',
      cue: { type: 'goal', side: 'home', participants: ['h1'], t1_ms: 1000 } });
    expect(actor.action('Walk_Loop').getEffectiveWeight()).toBe(1);
    expect(actor.action('Crouch_Idle_Loop').getEffectiveWeight()).toBe(0);
    expect(actor.action('Jump_Loop').getEffectiveWeight()).toBe(0);
    expect(actor.root().getObjectByName('upperarm_l')!.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.root().quaternion);
    expect(facing.x).toBeGreaterThan(.99);
  });

  it('advances the walking cycle by distance, then stands facing the camera side (+field y)', async () => {
    const actor = await rig(true);
    actor.draw({ ...input(1000), presentation: 'walkout' });
    const seed = actor.action('Walk_Loop').time;
    actor.draw({ ...input(1100, 50.12, 30, { clock: 1000, x: 50, y: 30 }), presentation: 'walkout' });
    expect(actor.action('Walk_Loop').time).toBeCloseTo((seed + .12 / (1.3 * 1.12)) % 1, 10);
    actor.draw({ ...input(1200, 50.12, 30), presentation: 'walkout' });
    expect(actor.action('Idle_Loop').getEffectiveWeight()).toBe(1);
    expect(actor.action('Crouch_Idle_Loop').getEffectiveWeight()).toBe(0);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.root().quaternion);
    expect(facing.z).toBeGreaterThan(.99);
  });

  it('keeps the recorded source untouched and retains the keeper-ready pose outside presentation', async () => {
    const actor = await rig(true), frame = input(1000), original = JSON.stringify(frame);
    actor.draw(frame); actor.draw(frame);
    expect(JSON.stringify(frame)).toBe(original);
    expect(actor.action('Crouch_Idle_Loop').getEffectiveWeight()).toBeGreaterThan(.5);
  });
});
