import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ballHeight, ballVelocity, BROADCAST_TILT_DEG, cameraShot, framingFor, isMassReposition, walkoutShot, type CameraShot } from './camera';
import type { SceneFrame } from '../retroScene';

it('centres the entrance actors and opens the shot as the team line grows',()=>{
  const close=walkoutShot(frame(0,[['h',51.1,70],['a',53.9,70]]),16/9);
  const wide=walkoutShot(frame(0,[['h',35,63],['a',70,63]]),16/9);
  expect(close.target).toEqual([52.5,0,70]);
  expect(wide.target).toEqual([52.5,0,63]);
  expect(wide.fov).toBeGreaterThan(close.fov);
  expect(walkoutShot(frame(0,[]),16/9).fov).toBeGreaterThan(0);
});

function frame(clock: number, players: [string, number, number][], ball: { x: number; y: number } | null = { x: 50, y: 30 }, period = 1): SceneFrame {
  return { clock_ms: clock, period, score: { home: 0, away: 0 }, carrier: null, possession: null, ball,
    players: players.map(([key, x, y]) => ({ key, name: key, side: key.startsWith('h') ? 'home' : 'away', role: 'MID', x, y })) } as unknown as SceneFrame;
}

function tilt(shot: CameraShot) {
  const [px, py, pz] = shot.position, [tx, ty, tz] = shot.target;
  return THREE.MathUtils.radToDeg(Math.atan2(py - ty, Math.hypot(px - tx, pz - tz)));
}
function project(shot: CameraShot, aspect: number, x: number, z: number) {
  const camera = new THREE.PerspectiveCamera(shot.fov, aspect, .1, 2000);
  camera.position.set(...shot.position); camera.lookAt(...shot.target); camera.updateMatrixWorld(true);
  return new THREE.Vector3(x, 0, z).project(camera);
}

describe('framingFor', () => {
  it('maps follow to broadcast and overview to tactical; an explicit framing wins; null focus forces tactical', () => {
    expect(framingFor({ camera: 'follow' })).toBe('broadcast');
    expect(framingFor({ camera: 'overview' })).toBe('tactical');
    expect(framingFor({ camera: 'follow', framing: 'near' })).toBe('near');
    expect(framingFor({ camera: 'overview', framing: 'broadcast' })).toBe('broadcast');
    expect(framingFor({ camera: 'follow', framing: 'near', fieldFocus: null })).toBe('tactical');
    expect(framingFor({ camera: 'follow', fieldFocus: { x: NaN, y: 1 } })).toBe('tactical');
  });
});

describe('cameraShot', () => {
  it('broadcast is a low side gantry at about 22 degrees and 18 m that keeps the focus centred', () => {
    for (const focus of [{ x: 52.5, y: 34 }, { x: 8, y: 40 }, { x: 99, y: 3 }]) {
      const shot = cameraShot('broadcast', focus, 16 / 9, 0);
      expect(tilt(shot)).toBeCloseTo(BROADCAST_TILT_DEG, 5);
      expect(shot.position[1]).toBeCloseTo(18, 5);
      expect(shot.position[2]).toBeGreaterThan(focus.y); // grada de la cámara: lado z > 68 mirando hacia z decreciente
      const centre = project(shot, 16 / 9, focus.x, focus.y);
      expect(centre.x).toBeCloseTo(0, 5); expect(centre.y).toBeCloseTo(0, 5);
    }
  });
  it('near the camera-side touchline the frame stays on the pitch instead of showing a dark lower third', () => {
    // Borde inferior del encuadre sobre el suelo: como mucho 4 m fuera de la banda (z = 68), y el foco sigue a la vista.
    for (const framing of ['broadcast', 'near'] as const) for (const aspect of [16 / 9, 975 / 548, 390 / 219]) for (const y of [60, 66, 68]) {
      const focus = { x: 30, y }, shot = cameraShot(framing, focus, aspect, 0);
      const camera = new THREE.PerspectiveCamera(shot.fov, aspect, .1, 2000);
      camera.position.set(...shot.position); camera.lookAt(...shot.target); camera.updateMatrixWorld(true);
      const ray = new THREE.Vector3(0, -1, .5).unproject(camera).sub(camera.position).normalize();
      const bottomZ = shot.position[2] + ray.z * (shot.position[1] / -ray.y);
      expect(bottomZ).toBeLessThanOrEqual(68 + 4 + 1e-6);
      const p = project(shot, aspect, focus.x, focus.y);
      expect(Math.abs(p.x)).toBeLessThan(1); expect(p.y).toBeGreaterThan(-1); expect(p.y).toBeLessThan(1);
      expect(tilt(shot)).toBeCloseTo(BROADCAST_TILT_DEG, 5);
    }
  });
  it('mid-pitch and far-side shots are not moved by the touchline guard', () => {
    for (const y of [3, 20, 34]) expect(cameraShot('broadcast', { x: 52.5, y }, 16 / 9, 0).target).toEqual([52.5, 0, y]);
  });
  it('broadcast pans with the play: towards an end the gantry yaws instead of tracking along the touchline', () => {
    const left = cameraShot('broadcast', { x: 10, y: 34 }, 16 / 9, 0), right = cameraShot('broadcast', { x: 95, y: 34 }, 16 / 9, 0);
    expect(left.position[0]).toBeGreaterThan(10); expect(right.position[0]).toBeLessThan(95);
  });
  it('broadcast widens with ball speed and shows about 46 m at rest on a 16:9 screen', () => {
    const rest = cameraShot('broadcast', { x: 52.5, y: 34 }, 16 / 9, 0), fast = cameraShot('broadcast', { x: 52.5, y: 34 }, 16 / 9, 30);
    expect(fast.fov).toBeGreaterThan(rest.fov);
    const a = project(rest, 16 / 9, 52.5 - 23, 34), b = project(rest, 16 / 9, 52.5 + 23, 34);
    expect(b.x - a.x).toBeCloseTo(2, 1);
  });
  it('near is closer and tighter than broadcast with the same tilt', () => {
    const near = cameraShot('near', { x: 40, y: 30 }, 16 / 9, 0), broadcast = cameraShot('broadcast', { x: 40, y: 30 }, 16 / 9, 0);
    const distance = (s: CameraShot) => Math.hypot(...s.position.map((v, i) => v - s.target[i]));
    expect(distance(near)).toBeLessThan(distance(broadcast) / 1.8);
    expect(tilt(near)).toBeCloseTo(BROADCAST_TILT_DEG, 5);
    const a = project(near, 16 / 9, 40 - 12, 30), b = project(near, 16 / 9, 40 + 12, 30);
    expect(b.x - a.x).toBeCloseTo(2, 1);
  });
  it('tactical fits the whole pitch including goal backs for wide and portrait screens', () => {
    for (const aspect of [942 / 440, 356 / 237.328125, 390 / 844]) {
      const shot = cameraShot('tactical', { x: 10, y: 10 }, aspect, 0);
      expect(shot.target).toEqual([52.5, 0, 34]);
      for (const x of [-3, 108]) for (const z of [0, 68]) {
        const p = project(shot, aspect, x, z);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1); expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('is pure: the same inputs give the same shot (seek-safe, no smoothing state)', () => {
    expect(cameraShot('broadcast', { x: 30, y: 20 }, 1.5, 4)).toEqual(cameraShot('broadcast', { x: 30, y: 20 }, 1.5, 4));
  });
  it('fov stays within [8, 60] even on very narrow screens', () => {
    for (const framing of ['broadcast', 'near', 'tactical'] as const) for (const aspect of [.3, 1, 3]) {
      const { fov } = cameraShot(framing, { x: 52.5, y: 34 }, aspect, 0);
      expect(fov).toBeGreaterThanOrEqual(8); expect(fov).toBeLessThanOrEqual(60);
    }
  });
});

describe('motion helpers', () => {
  it('isMassReposition flags a restart where at least four players jump 3 m or more at once', () => {
    const before = frame(1000, [['h1', 10, 10], ['h2', 20, 10], ['a1', 30, 10], ['a2', 40, 10], ['a3', 50, 10]]);
    const three = frame(1100, [['h1', 14, 10], ['h2', 24, 10], ['a1', 34, 10], ['a2', 40.2, 10], ['a3', 50, 10]]);
    const four = frame(1100, [['h1', 14, 10], ['h2', 24, 10], ['a1', 34, 10], ['a2', 44, 10], ['a3', 50, 10]]);
    expect(isMassReposition(before, three)).toBe(false);
    expect(isMassReposition(before, four)).toBe(true);
    expect(isMassReposition(before, before)).toBe(false);
    expect(isMassReposition(before, { ...three, period: 2 })).toBe(true);
  });
  it('ballVelocity is m/s between frames and 0 across cuts, gaps or teleports', () => {
    const a = frame(1000, [], { x: 50, y: 30 }), b = frame(1100, [], { x: 51, y: 30 });
    expect(ballVelocity(b, a)).toEqual({ x: 10, y: 0 });
    expect(ballVelocity(b, b)).toEqual({ x: 0, y: 0 });
    expect(ballVelocity(frame(1100, [], { x: 70, y: 30 }), a)).toEqual({ x: 0, y: 0 });
    expect(ballVelocity(frame(1100, [], null), a)).toEqual({ x: 0, y: 0 });
    expect(ballVelocity(b, { ...a, period: 2 })).toEqual({ x: 0, y: 0 });
  });
  it('ballHeight uses a finite source height when present and never invents one', () => {
    expect(ballHeight({ x: 1, y: 2 })).toBe(0);
    expect(ballHeight({ x: 1, y: 2, z: 1.5 } as { x: number; y: number })).toBe(1.5);
    expect(ballHeight({ x: 1, y: 2, z: -3 } as { x: number; y: number })).toBe(0);
    expect(ballHeight({ x: 1, y: 2, z: 'high' } as unknown as { x: number; y: number })).toBe(0);
    expect(ballHeight(null)).toBe(0);
  });
});
