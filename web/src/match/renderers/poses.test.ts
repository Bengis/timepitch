import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { applyPlayerPose, derivePlayerPose } from './poses';
import { createPlayerArt } from './three-art';
import type { PitchRenderInput } from './types';

it('header_and_left_foot_cues_preserve_roots',()=>{
  const value=input(),art=createPlayerArt('home',false);art.root.position.set(24,0,22);
  const root=art.root.position.toArray();
  const header=derivePlayerPose({...value,cue:{type:'shot',participants:['home:p'],t1_ms:1400,bodyPart:'head'}},'home:p')!;
  expect(header.action).toBe('header');expect(Math.abs(header.bodyLean)).toBeGreaterThan(0);expect(Math.abs(header.bodyLean)).toBeLessThanOrEqual(.15);
  expect(header.limbs.rightLeg.x).toBe(0);expect(header.limbs.leftLeg.x).toBe(0);
  const left=derivePlayerPose({...value,cue:{type:'shot',participants:['home:p'],t1_ms:1400,bodyPart:'left_foot'}},'home:p')!;
  expect(left.action).toBe('kick');expect(left.limbs.leftLeg.x).not.toBe(0);expect(left.limbs.rightLeg.x).toBe(0);
  for(const pose of [header,left,header]){applyPlayerPose(art,pose);expect(art.root.position.toArray()).toEqual(root);expect(art.body.rotation.x).toBe(pose.bodyLean);}
  expect(derivePlayerPose({...value,cue:{type:'shot',participants:['home:p'],t1_ms:1400,bodyPart:'head'}},'home:p')).toEqual(header);
  art.dispose();
});

function input(): PitchRenderInput {
  const players = [{ key: 'home:p', name: 'P', side: 'home' as const, role: 'MID' as const, x: 24, y: 22 },
    { key: 'away:q', name: 'Q', side: 'away' as const, role: 'DEF' as const, x: 25, y: 23 }];
  const frame = { clock_ms: 1500, period: 1, score: { home: 0, away: 0 }, carrier: null, possession: null,
    ball: { x: 24, y: 22 }, players };
  const value: PitchRenderInput = { frame, previous: { ...frame, clock_ms: 1400, players: players.map(p => ({ ...p, x: p.x - .5 })) },
    restarting: false, selectedPlayerKey: null, camera: 'overview', appearance: 'daylight', detail: 'standard',
    labels: { home: 'H', away: 'A', clock: '00:01', goal: 'Goal' } };
  function freeze(object: object) { Object.freeze(object); for (const child of Object.values(object)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child); }
  freeze(value); return value;
}

it('pose_replays_identically_after_seek with exact untouched roots and source', () => {
  const value = input(), before = JSON.stringify(value), first = derivePlayerPose(value, 'home:p')!;
  expect(first.action).toBe('run'); expect(first.facing).toBeCloseTo(Math.PI / 2);
  derivePlayerPose({ ...value, frame: { ...value.frame, clock_ms: 6000 } }, 'home:p');
  expect(derivePlayerPose(value, 'home:p')).toEqual(first);
  const art = createPlayerArt('home', false); art.root.position.set(24, 0, 22);
  const root = art.root.position.toArray();
  for (const pose of [first, derivePlayerPose({ ...value, previous: value.frame }, 'home:p')!, first]) {
    applyPlayerPose(art, pose); expect(art.root.position.toArray()).toEqual(root);
  }
  expect(art.body.rotation.y).toBe(first.facing);
  expect(art.leftLeg.rotation.x).toBe(first.limbs.leftLeg.x);
  expect(art.leftLeg.rotation.x).not.toBe(0);
  expect(art.leftLeg.rotation.x).not.toBe(art.rightLeg.rotation.x);
  expect(JSON.stringify(value)).toBe(before); art.dispose();
});

it('restart_and_zero_displacement_are_idle', () => {
  const value = input();
  const restart = { ...value, restarting: true, cue: { type: 'shot' as const, t1_ms: 1450, participants: ['home:p'] } };
  expect(derivePlayerPose(restart, 'home:p')?.action).toBe('idle');
  expect(derivePlayerPose({ ...value, previous: { ...value.frame, clock_ms: 1400 } }, 'home:p')?.action).toBe('idle');
  const art = createPlayerArt('home', false), root = art.root.position.toArray();
  applyPlayerPose(art, derivePlayerPose(value, 'home:p')!);
  applyPlayerPose(art, derivePlayerPose(restart, 'home:p')!);
  expect(art.leftLeg.rotation.x).toBe(0); expect(art.rightLeg.rotation.x).toBe(0);
  expect(art.root.position.toArray()).toEqual(root); art.dispose();
});

it('articulated recovery bends knees and elbows, resets after seeking, without moving source roots', () => {
  const value = input(), art = createPlayerArt('home', false), before = JSON.stringify(value);
  art.root.position.set(24, 0, 22);
  let bent = false;
  for (let ms = 1500; ms < 2400; ms += 25) {
    const pose = derivePlayerPose({ ...value, frame: { ...value.frame, clock_ms: ms }, previous: { ...value.previous, clock_ms: ms - 100 } }, 'home:p')!;
    applyPlayerPose(art, pose);
    const knee = art.root.getObjectByName('left-knee')!;
    expect(knee).toBeDefined();
    expect(knee.rotation.x).toBeGreaterThanOrEqual(0);
    expect(knee.rotation.x).toBeLessThanOrEqual(1.9);
    bent ||= knee.rotation.x > .2;
    art.root.updateMatrixWorld(true);
    const feet = [art.leftAnkle, art.rightAnkle].map(ankle => ankle.getWorldPosition(new Vector3()).y);
    expect(Math.min(...feet)).toBeGreaterThanOrEqual(.05 - 1e-8);
    expect(Math.max(...feet)).toBeLessThanOrEqual(.23);
    expect(art.root.position.toArray()).toEqual([24, 0, 22]);
  }
  expect(bent).toBe(true);
  const first = derivePlayerPose(value, 'home:p')!;
  applyPlayerPose(art, first);
  const angles = ['left-knee', 'right-knee', 'left-elbow', 'right-elbow'].map(name => art.root.getObjectByName(name)!.rotation.x);
  applyPlayerPose(art, derivePlayerPose({ ...value, restarting: true }, 'home:p')!);
  expect(art.root.getObjectByName('left-knee')!.rotation.x).toBe(0);
  applyPlayerPose(art, first);
  expect(['left-knee', 'right-knee', 'left-elbow', 'right-elbow'].map(name => art.root.getObjectByName(name)!.rotation.x)).toEqual(angles);
  expect(JSON.stringify(value)).toBe(before); art.dispose();
});

it('uses stable identity gait phases so teammates do not all run in step', () => {
  const value = input(), a = value.frame.players[0];
  const sameTeam = { ...value, frame: { ...value.frame, players: [a, { ...a, key: 'home:other', x: 28 }] },
    previous: { ...value.previous, players: [{ ...a, x: 23.5 }, { ...a, key: 'home:other', x: 27.5 }] } };
  const first = derivePlayerPose(sameTeam, a.key)!;
  expect(first.limbs.leftLeg.x).not.toBe(derivePlayerPose(sameTeam, 'home:other')!.limbs.leftLeg.x);
  expect(derivePlayerPose(sameTeam, a.key)).toEqual(first);
});

it.each([[1, 0], [3, Math.PI / 4], [5, Math.PI / 2], [6, -Math.PI / 3]])('a supporting boot stays planted at %s m/s facing %s radians', (speed, angle) => {
  const value = input(), art = createPlayerArt('home', false);
  art.root.scale.setScalar(1.35);
  let previous: Vector3[] | null = null, contacts = 0;
  for (let ms = 1500; ms < 2400; ms += 10) {
    const vx = speed * Math.sin(angle), vy = speed * Math.cos(angle);
    const x = 24 + (ms - 1500) / 1000 * vx, y = 22 + (ms - 1500) / 1000 * vy;
    const player = { ...value.frame.players[0], x, y };
    const moving = { ...value, frame: { ...value.frame, clock_ms: ms, players: [player] },
      previous: { ...value.previous, clock_ms: ms - 100, players: [{ ...player, x: x - .1 * vx, y: y - .1 * vy }] } };
    art.root.position.set(x, 0, y); applyPlayerPose(art, derivePlayerPose(moving, player.key)!); art.root.updateMatrixWorld(true);
    const feet = [art.leftAnkle, art.rightAnkle].map(ankle => ankle.getWorldPosition(new Vector3()));
    if (previous) for (let i = 0; i < feet.length; i++) {
      if (Math.abs(feet[i].y - .05 * 1.35) < 1e-8 && Math.abs(previous[i].y - .05 * 1.35) < 1e-8) {
        expect(feet[i].distanceTo(previous[i])).toBeLessThan(1e-7); contacts++;
      }
    }
    previous = feet;
  }
  expect(contacts).toBeGreaterThan(15); art.dispose();
});

it('cut_or_nonpositive_dt_does_not_sprint or blend across a discontinuity', () => {
  const value = input(), p = value.frame.players[0];
  const variants = [
    { ...value, previous: { ...value.previous, players: [{ ...p, x: p.x - 3 }] } },
    { ...value, previous: { ...value.previous, period: 2 } },
    { ...value, previous: { ...value.previous, clock_ms: value.frame.clock_ms } },
    { ...value, previous: { ...value.previous, clock_ms: value.frame.clock_ms + 100 } },
    { ...value, previous: { ...value.previous, players: [] } },
    { ...value, previous: { ...value.previous, players: [{ ...p, x: NaN }] } },
  ];
  for (const variant of variants) expect(derivePlayerPose(variant, p.key)?.action).toBe('idle');
});

it('known_actor_only_kicks within 250ms and never from a future cue', () => {
  const value = input();
  for (const type of ['pass', 'shot'] as const) {
    const kick = { ...value, cue: { type, participants: ['home:p'], t1_ms: 1450 } };
    expect(derivePlayerPose(kick, 'home:p')?.action).toBe('kick');
    expect(derivePlayerPose(kick, 'away:q')?.action).toBe('run');
    expect(derivePlayerPose({ ...kick, cue: { ...kick.cue, participants: [] } }, 'home:p')?.action).toBe('run');
    for (const t1_ms of [1250, 1600]) expect(derivePlayerPose({ ...kick, cue: { ...kick.cue, t1_ms } }, 'home:p')?.action).toBe('run');
    for (const t1_ms of [1500, 1251]) expect(derivePlayerPose({ ...kick, cue: { ...kick.cue, t1_ms } }, 'home:p')?.action).toBe('kick');
  }
});

it('future_goal_does_not_celebrate; only the known scoring side celebrates for 900ms', () => {
  const value = input(), goal = { type: 'goal' as const, participants: ['home:p'], t1_ms: 1500, side: 'home' as const };
  expect(derivePlayerPose({ ...value, cue: goal }, 'home:p')?.action).toBe('celebrate');
  expect(derivePlayerPose({ ...value, cue: goal }, 'away:q')?.action).toBe('run');
  for (const t1_ms of [1501, 600]) expect(derivePlayerPose({ ...value, cue: { ...goal, t1_ms } }, 'home:p')?.action).toBe('run');
  expect(derivePlayerPose({ ...value, cue: { ...goal, t1_ms: 601 } }, 'home:p')?.action).toBe('celebrate');
  expect(derivePlayerPose({ ...value, cue: { ...goal, side: null } }, 'home:p')?.action).toBe('run');
  const art = createPlayerArt('home', false); art.root.position.set(24, 0, 22);
  const root = art.root.position.clone();
  applyPlayerPose(art, derivePlayerPose({ ...value, cue: goal }, 'home:p')!);
  expect(Math.abs(art.leftArm.rotation.z)).toBeGreaterThan(2);
  expect(art.root.position.equals(root)).toBe(true);
  applyPlayerPose(art, derivePlayerPose(value, 'home:p')!);
  expect(Math.abs(art.leftArm.rotation.z)).toBeLessThan(.2); art.dispose();
});

it('absent player has no pose and nonfinite positions are not animated', () => {
  const value = input();
  expect(derivePlayerPose(value, 'missing')).toBeNull();
  expect(derivePlayerPose({ ...value, frame: { ...value.frame, players: [{ ...value.frame.players[0], x: NaN }] } }, 'home:p')).toBeNull();
});
