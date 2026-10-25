import { describe, expect, it } from 'vitest';
import { sampleInterval } from './sampling';
import { syntheticSnapshot, syntheticFrame } from './unified-fixtures';

describe('one coordinate sampler', () => {
  it('lerps only coordinates; discrete score/owner/membership come from before, even at the right boundary', () => {
    const interval = syntheticSnapshot().interval!;
    interval.after = syntheticFrame({ clock_ms: 10_000, score: { home: 1, away: 0 }, possession: 'away', carrier: null,
      ball: { x: 30, y: 40 }, players: interval.after!.players });
    const mid = sampleInterval(interval, 5000);
    expect(mid.ball).toEqual({ x: 20, y: 30 }); expect(mid.players[0].x).toBe(20);
    expect(mid).toMatchObject({ clock_ms: 5000, score: { home: 0, away: 0 }, possession: 'home', carrier: 'test:home:1', period: 1 });
    expect(sampleInterval(interval, 10_000).score).toEqual({ home: 0, away: 0 });
  });
  it('does not extrapolate or mutate source endpoints', () => {
    const interval = syntheticSnapshot().interval!;
    const before = JSON.stringify(interval);
    expect(sampleInterval(interval, -100).ball).toEqual(interval.before.ball);
    expect(sampleInterval(interval, 20_000).ball).toEqual(interval.after!.ball);
    const sample = sampleInterval(interval, 5000); sample.players[0].x = 999; sample.score!.home = 99;
    expect(JSON.stringify(interval)).toBe(before);
  });
  it('keeps missing ball/endpoints unknown; null ball is valid motion data', () => {
    const interval = syntheticSnapshot().interval!;
    interval.before.ball = null; expect(sampleInterval(interval, 5000).ball).toBeNull();
    interval.before.ball = { x: 1, y: 2 }; interval.after!.ball = null;
    expect(sampleInterval(interval, 5000).ball).toBeNull();
    interval.after = null; expect(sampleInterval(interval, 5000).players).toEqual(interval.before.players);
  });
  it('cuts individual entities without freezing explicitly continuous teammates', () => {
    const interval = syntheticSnapshot().interval!;
    interval.continuousPlayers = new Set(['test:away:1']); interval.continuousBall = false;
    const sample = sampleInterval(interval, 5000);
    expect(sample.players[0].x).toBe(10); expect(sample.players[1].x).toBe(40);
    expect(sample.ball).toEqual(interval.before.ball);
  });
  it('never invents a new member or joins a missing player by position', () => {
    const interval = syntheticSnapshot().interval!;
    interval.after!.players[0].key = 'test:new';
    const sample = sampleInterval(interval, 5000);
    expect(sample.players.map(p => p.key)).toEqual(['test:home:1', 'test:away:1']);
    expect(sample.players[0].x).toBe(10); expect(sample.players[1].x).toBe(40);
  });
  it('period/all/zero-duration cuts do not interpolate', () => {
    const interval = syntheticSnapshot().interval!;
    interval.after!.period = 2;
    expect(sampleInterval(interval, 5000).players).toEqual(interval.before.players);
    interval.after!.period = 1; interval.continuousPlayers = new Set(); interval.continuousBall = false;
    expect(sampleInterval(interval, 5000).ball).toEqual(interval.before.ball);
    interval.continuousPlayers = new Set(['test:home:1']); interval.toMs = interval.fromMs;
    expect(sampleInterval(interval, 5000).players).toEqual(interval.before.players);
  });
  it('ambiguous duplicate keys cannot authorize interpolation', () => {
    const interval = syntheticSnapshot().interval!;
    interval.after!.players.push({ ...interval.after!.players[0], x: 99 });
    expect(sampleInterval(interval, 5000).players[0].x).toBe(10);
    interval.after!.players.pop(); interval.before.players.push({ ...interval.before.players[0], x: 50 });
    expect(sampleInterval(interval, 5000).players.map(p => p.x)).toEqual([10, 40, 50]);
  });
  it('a fact boundary inside two raw frames does not rescale their coordinate trajectory', () => {
    const interval = { ...syntheticSnapshot().interval!, fromMs:100, toMs:1000,
      interpolation:{fromMs:0,toMs:10000} };
    expect(sampleInterval(interval,500).players[0].x).toBe(11);
  });
});
