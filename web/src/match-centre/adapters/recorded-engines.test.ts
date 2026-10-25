import { describe, expect, it } from 'vitest';
import { ENGINE_PROFILES } from './recorded-replay';
import { normalizeRecording, RECORDED_ENGINE_IDS, type RecordedEngineId } from './recorded-track';
import { rawRecording } from './recorded-fixtures';

const track = (engine: RecordedEngineId, raw = rawRecording(engine)) => normalizeRecording(raw, ENGINE_PROFILES[engine]);

describe('recorded engine tracks', () => {
  for (const engine of RECORDED_ENGINE_IDS) it(`${engine}: 22 players with one catalogue key per slot, two periods, units and clock`, () => {
    const raw = rawRecording(engine), before = JSON.stringify(raw), t = track(engine, raw);
    expect(t.players).toHaveLength(22);
    for (const side of ['home', 'away'] as const)
      expect(t.players.filter(p => p.side === side).map(p => [p.slot, p.sourceKey])).toEqual(Array.from({ length: 11 }, (_, slot) =>
        [slot, `epldata:2015:${side === 'home' ? 'chelsea' : 'swansea'}:P${slot}`]));
    expect(t.periodStarts).toEqual([{ period: 1, index: 0 }, { period: 2, index: 4 }]);
    expect(t).toMatchObject({ intervalMs: 100, sampleCount: 8, durationMs: 700, units: { space: 'grf-normalised', metresPerUnit: { x: 54.4, y: 83.6 } } });
    expect(t.sample(5).matchMs).toBe(raw.samples[5].match_time_ms);
    expect(t.goals.map(g => [g.sampleIndex, g.side, g.score])).toEqual([[2, 'home', [1, 0]]]);
    expect(JSON.stringify(raw)).toBe(before);
  });
  it('ball height: metres for GRF and open-football, absent (never 0 invented) for TouchLines', () => {
    expect(track('grf').sample(1).ballZ).toBe(1.5);
    expect(track('open-football').sample(1).ballZ).toBe(1.5);
    expect(track('touchlines').units.ballHeight).toBe('absent');
    expect(track('touchlines').sample(1).ballZ).toBeNull();
  });
  it('scorers come from native records where the engine has them; GRF experimental-1 has none', () => {
    expect(track('grf').goals[0].scorer).toBeNull();
    expect(track('touchlines').goals[0].scorer).toMatchObject({ side: 'home', slot: 9, nativeId: '10' });
    expect(track('open-football').goals[0].scorer).toMatchObject({ side: 'home', slot: 10, nativeId: '110' });
  });
  it('TouchLines half-time samples stay in period 1 and the 2nd half starts at secondHalf', () => {
    const t = track('touchlines');
    expect([0, 1, 2, 3, 4, 7].map(i => t.sample(i).period)).toEqual([1, 1, 1, 1, 2, 2]);
  });
  it('rejects broken shapes instead of drawing them', () => {
    const broken: [RecordedEngineId, (r: ReturnType<typeof rawRecording>) => void, RegExp][] = [
      ['grf', r => { (r.samples[3].home_xy as unknown[]).pop(); }, /11 players/],
      ['grf', r => { (r.samples[3].ball_xyz as number[])[2] = Number.NaN; }, /ball\.z/],
      ['open-football', r => { r.samples[5].period = 1; }, /back to period/],
      ['touchlines', r => { r.samples[6].score = [3, 0]; }, /score jumps/],
      ['touchlines', r => { ((r.input as { config: { home_players: string[] } }).config.home_players)[4] = 'epldata:2015:chelsea:OTHER'; }, /identity_mismatch/],
      ['open-football', r => { ((r.input as { players: { slot: number }[] }).players)[3].slot = 2; }, /slots 0\.\.10/],
      ['grf', r => { (r.grf_physical as { goals: unknown[] }).goals = []; }, /identity_mismatch/],
      ['touchlines', r => { r.samples[2].tl_match_phase = 'extraTime'; }, /tl_match_phase/],
    ];
    for (const [engine, mutate, message] of broken) { const raw = rawRecording(engine); mutate(raw); expect(() => track(engine, raw)).toThrow(message); }
  });
});
