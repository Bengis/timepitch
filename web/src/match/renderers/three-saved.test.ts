import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createThreeRenderer } from './three';
import { createGrfSession } from '../../match-centre/adapters/grf';
import { createTimePitchSession } from '../../match-centre/adapters/timepitch';
import { createHistoricalSession } from '../../match-centre/adapters/historical';
import { sampleInterval } from '../../match-centre/sampling';
import type { SceneFrame } from '../retroScene';

const draw = vi.hoisted(() => ({ scene: null as THREE.Scene | null }));
vi.mock('three', async original => ({ ...await original<typeof import('three')>(), WebGLRenderer: class {
  shadowMap = { enabled: false, type: 0 }; render(scene: THREE.Scene) { draw.scene = scene; }
  setSize() {} setPixelRatio() {} dispose() {} forceContextLoss() {} getContext() { return { isContextLost: () => false }; }
} }));
const manifestPath = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env.TIMEPITCH_PITCH_ACCEPTANCE_MANIFEST;

it.runIf(Boolean(manifestPath))('all saved-source roots equal recorded coordinates exactly and source data stay unchanged', async () => {
  const moduleName = 'node:fs', fs = await import(/* @vite-ignore */ moduleName) as { readFileSync(path: string, encoding: 'utf8'): string };
  const read = (path: string) => JSON.parse(fs.readFileSync(path, 'utf8')), manifest = read(manifestPath!);
  function check(frame: SceneFrame, expected: { key: string; x: number; y: number }[]) {
    const before = JSON.stringify(frame);
    const renderer = createThreeRenderer(document.createElement('canvas'), { frame, previous: frame, restarting: false,
      selectedPlayerKey: null, camera: 'overview', appearance: 'daylight', detail: 'standard', labels: { home: 'H', away: 'A', clock: '', goal: 'Goal' } }, reason => { throw new Error(reason); });
    try {
      expect(frame.players.map(p => p.key)).toEqual(expected.map(p => p.key));
      for (const player of frame.players) {
        const root = draw.scene!.getObjectByName(`player:${player.key}`)!;
        expect(root.position.toArray()).toEqual([player.x, 0, player.y]);
        const original = expected.find(p => p.key === player.key)!;
        expect(root.position.x).toBeCloseTo(original.x, 10); expect(root.position.z).toBeCloseTo(original.y, 10);
      }
      const ball = draw.scene!.getObjectByName('ball');
      if (!frame.ball) expect(ball).toBeUndefined(); else expect(ball!.position.toArray()).toEqual([frame.ball.x, .22, frame.ball.y]);
      expect(JSON.stringify(frame)).toBe(before);
    } finally { renderer.dispose(); }
  }
  for (const source of ['grf', 'timepitch']) {
    const raw = read(manifest.sources[source].record), before = JSON.stringify(raw);
    const adapter = source === 'grf' ? createGrfSession(manifest.sources[source].id, raw) : createTimePitchSession(manifest.sources[source].id, raw);
    try {
      const rows = source === 'grf' ? raw.samples : raw.motion;
      for (const index of [0, 1, Math.floor(rows.length / 2), rows.length - 1]) {
        const row = rows[index], ms = source === 'grf' ? index * 100 : row[0];
        const expected = source === 'timepitch' ? raw.initial_frame.players.map((p: { key: string }, i: number) => ({ key: `timepitch:${p.key}`, x: row[10][2 * i] / 1000, y: row[10][2 * i + 1] / 1000 }))
          : raw.input.players.filter((p: { side: string; slot: number }) => (p.side === 'home' ? row.home_active : row.away_active)?.[p.slot] !== false).map((p: { id: string; side: string; slot: number }) => {
            const xy = (p.side === 'home' ? row.home_xy : row.away_xy)[p.slot]; return { key: `grf:${p.id}`, x: (xy[0] + 1) * 52.5, y: (xy[1] + .42) * 68 / .84 };
          });
        check(sampleInterval(adapter.resolveFrame(ms).interval!, ms), expected);
      }
    } finally { adapter.dispose(); }
    expect(JSON.stringify(raw)).toBe(before);
  }
  const captured = read(manifest.sources.historical.capture), before = JSON.stringify(captured);
  const adapter = createHistoricalSession(manifest.sources.historical.id, captured.manifest.dataset_version, { readers: {
    capabilities: async () => ({ two_modes_ui: true, reconstruction_enabled: true, dataset_state: 'ready', dataset_version: captured.manifest.dataset_version, publication_status: 'blocked_pending_permission' }),
    match: async () => captured.match, manifest: async () => captured.manifest,
    segment: async (_id, period, index) => captured.segments.find((s: { period: number; index: number }) => s.period === period && s.index === index),
    events: async () => [], statistics: async () => captured.final,
  } });
  try {
    for (const row of captured.segments[0].frames.slice(0, 3)) {
      await adapter.ensure(row.period_ms, new AbortController().signal);
      const expected = row.players.map(([index, x, y]: number[]) => ({ key: `historical:${captured.manifest.roster.find((p: { index: number }) => p.index === index).key}`, x, y }));
      check(sampleInterval(adapter.snapshot().interval!, row.period_ms), expected);
    }
  } finally { adapter.dispose(); }
  expect(JSON.stringify(captured)).toBe(before);
});
