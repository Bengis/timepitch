import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRetroRenderer } from './retro';
import type { PitchRenderInput } from './types';
import { drawRetro } from '../retroCanvas';

vi.mock('../retroCanvas', () => ({ atlasUrl: '/test-atlas.svg', drawRetro: vi.fn() }));
let images: HTMLImageElement[];
beforeEach(() => {
  vi.clearAllMocks(); images = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.stubGlobal('Image', function () { const image = document.createElement('img'); images.push(image); return image; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function input(): PitchRenderInput {
  const frame = { clock_ms: 1500, period: 1, score: { home: 0, away: 0 }, carrier: null, possession: null,
    ball: { x: 60, y: 35 }, players: [{ key: 'home:p', name: 'Player', side: 'home' as const, role: 'MID' as const, x: 20, y: 20 }] };
  Object.freeze(frame.players[0]); Object.freeze(frame.players); Object.freeze(frame.ball); Object.freeze(frame.score); Object.freeze(frame);
  return { frame, previous: frame, restarting: false, selectedPlayerKey: null, camera: 'overview', appearance: 'daylight', detail: 'standard', labels: { home: 'Home', away: 'Away', clock: '01:30', goal: 'Goal' } };
}

it('retro_projection_matches_existing_scene without changing source positions', () => {
  const canvas = document.createElement('canvas'), value = input(), before = JSON.stringify(value);
  const renderer = createRetroRenderer(canvas, value, vi.fn());
  const projection = renderer.update(value);
  expect(projection.viewport).toEqual({ width: 384, height: 256 });
  expect(projection.projectFieldPoint(52.5, 34)).toEqual({ x: 192, y: 128 });
  const p = projection.projectFieldPoint(20, 20)!;
  expect(p.x).toBeCloseTo(102.1470588235294); expect(p.y).toBeCloseTo(89.29411764705883);
  expect(projection.projectFieldPoint(NaN, 20)).toBeNull();
  expect(projection.projectFieldPoint(-1000, 20)).toBeNull();
  expect(renderer.pickPlayer({ x: 102, y: 81 })).toBe('home:p');
  renderer.resize({ width: 768, height: 512 }, 2);
  expect(canvas.width).toBe(384); expect(canvas.height).toBe(256);
  expect(JSON.stringify(value)).toBe(before); renderer.dispose();
});

it('keeps the projection paired with the frame and camera actually drawn', () => {
  const value = input(), renderer = createRetroRenderer(document.createElement('canvas'), value, vi.fn());
  const overview = renderer.update(value);
  const follow = renderer.update({ ...value, camera: 'follow' });
  expect(follow.projectFieldPoint(20, 20)).toBeNull();
  expect(overview.projectFieldPoint(20, 20)).not.toBeNull();
  expect(renderer.pickPlayer({ x: 102, y: 81 })).toBeNull();
  expect(vi.mocked(drawRetro).mock.calls.at(-1)![5]).toEqual(value.labels); renderer.dispose();
});

it('loads art, preserves fallback markers on failure, and fences late callbacks after disposal', () => {
  const canvas = document.createElement('canvas'), failure = vi.fn(), renderer = createRetroRenderer(canvas, input(), failure);
  expect(canvas.dataset.spriteStatus).toBe('loading');
  images[0].dispatchEvent(new Event('load'));
  expect(canvas.dataset.spriteStatus).toBe('ready');
  expect(vi.mocked(drawRetro).mock.calls.at(-1)![3]).toBe(images[0]);
  const lateLoad = images[0].onload!, lateError = images[0].onerror!;
  renderer.dispose(); renderer.dispose(); vi.mocked(drawRetro).mockClear();
  lateLoad.call(images[0], new Event('load')); lateError.call(images[0], new Event('error'));
  renderer.update(input()); renderer.resize({ width: 200, height: 100 }, 1);
  expect(drawRetro).not.toHaveBeenCalled(); expect(renderer.pickPlayer({ x: 102, y: 81 })).toBeNull();
  expect(images[0].onload).toBeNull(); expect(images[0].onerror).toBeNull(); expect(failure).not.toHaveBeenCalled();
  const fallbackCanvas = document.createElement('canvas'), fallback = createRetroRenderer(fallbackCanvas, input(), failure);
  images[1].dispatchEvent(new Event('error'));
  expect(fallbackCanvas.dataset.spriteStatus).toBe('fallback'); expect(failure).toHaveBeenCalledWith('assets');
  expect(vi.mocked(drawRetro).mock.calls.at(-1)![3]).toBeNull(); fallback.dispose();
});
