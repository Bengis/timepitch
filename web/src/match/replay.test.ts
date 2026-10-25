import { describe, it, expect } from 'vitest';
import { sampleFrame, ReplayController } from './replay';
import type { MatchRecord, RenderFrame, MatchEvent } from '../api';
import type { MatchRecordV2, MotionSample } from '../api';

const frame = (clock: number, ballX: number, goals = 0): RenderFrame => ({
  clock_ms: clock, ball: { x: ballX, y: 34 }, carrier: null, period: clock >= 2700000 ? 2 : 1,
  possession: 'home', score: { home: goals, away: 0 },
  players: Array.from({ length: 22 }, (_, i) => ({ key: `p${i}`, name: `Player ${i}`, role: i % 11 === 0 ? 'GK' : 'MID', side: i < 11 ? 'home' : 'away', x: 20 + i, y: 20 })),
});
const event = (id: string, start: number, end: number, type: MatchEvent['type'], ball: number, score = 0): MatchEvent => ({
  id, t0_ms: start, t1_ms: end, type, side: 'home', participants: ['p1'], outcome: type === 'shot' ? 'goal' : 'complete',
  evidence: {}, frame_after: frame(end, ball, score),
});
const record: MatchRecord = {
  config: { home_key: 'a:2003', away_key: 'b:2017', home_players: [], away_players: [], home_formation: '4-4-2', away_formation: '4-4-2', home_tactic: 'balanced', away_tactic: 'balanced', seed: 42 }, seed: 42,
  engine_version: 'engine-1', rules_version: 'rules-1', ratings_version: 'ratings-1',
  dataset_version: 'fixture', home_name: 'Example A', away_name: 'Example B', trace_hash: 'unchanged',
  initial_frame: frame(0, 52.5), events: [event('pass', 0, 2000, 'pass', 60), event('shot', 2000, 4000, 'shot', 105),
    event('goal', 4000, 4000, 'goal', 105, 1), event('half', 2700000, 2700000, 'halftime', 52.5, 1),
    event('end', 5400000, 5400000, 'fulltime', 52.5, 1)], metrics: {
      home: { goals: 1, shots: 1, shots_on_target: 1, saves: 0, passes: 1, completed_passes: 1, pressures: 0, tackles: 0, possession_ms: 5400000 },
      away: { goals: 0, shots: 0, shots_on_target: 0, saves: 0, passes: 0, completed_passes: 0, pressures: 0, tackles: 0, possession_ms: 0 },
    },
};

describe('recorded replay', () => {
  it('interpolates the actual frame endpoints and counts simultaneous goals only when resolved', () => {
    expect(sampleFrame(record, 1000).ball.x).toBe(56.25);
    expect(sampleFrame(record, 3999).score.home).toBe(0);
    expect(sampleFrame(record, 4000).score.home).toBe(1);
    expect(sampleFrame(record, 2700000).period).toBe(2);
  });

  it('pause, seek and speed do not mutate the source or reroll the result', () => {
    let now = 0;
    const before = JSON.stringify(record);
    const controller = new ReplayController(record, () => now); controller.setSpeed(60);
    controller.play(); now = 1000;
    expect(controller.currentTime()).toBe(60000);
    controller.pause(); now = 2000;
    expect(controller.currentTime()).toBe(60000);
    controller.setSpeed(5); controller.play(); now = 3000;
    expect(controller.currentTime()).toBe(65000);
    controller.seek(5400000);
    expect(sampleFrame(record, controller.currentTime()).score.home).toBe(1);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('a suspended tab resumes from elapsed time and clamps once at full time', () => {
    let now = 0;
    const controller = new ReplayController(record, () => now); controller.setSpeed(60);
    controller.play(); now = 500000;
    expect(controller.currentTime()).toBe(5400000);
    expect(controller.isPlaying).toBe(false);
    expect(controller.currentTime()).toBe(5400000);
  });
});

function compactSample(time: number, shift = 0, reset = 0, period = 1, goals = 0): MotionSample {
  const xy = record.initial_frame.players.flatMap(p => [(p.x+shift)*1000, p.y*1000]);
  return [time, period, goals, 0, 0, 1, reset ? 2 : 0, reset, xy[2], xy[3], xy];
}

const compact: MatchRecordV2 = {
  ...record, format_version: 2, engine_version: 'engine-2', rules_version: 'rules-2', ratings_version: 'ratings-1', metrics_version: 'basic-2',
  events: [], motion: [compactSample(0, 0, 1), compactSample(250, 1), compactSample(500, 2, 0, 1, 1),
    compactSample(500, -10, 3, 1, 1), compactSample(750, -9, 0, 1, 1), compactSample(1800000, -9, 0, 1, 1),
    compactSample(2700000, -9, 0, 1, 1), compactSample(2700000, 10, 2, 2, 1),
    compactSample(2700250, 11, 0, 2, 1), compactSample(5400000, 11, 0, 2, 2)],
};

describe('compact recorded motion', () => {
  it('interpolates mm samples, resolves duplicate instants and never runs through a reset', () => {
    expect(sampleFrame(compact, 125).players[0].x).toBe(20.5);
    expect(sampleFrame(compact, 499).players[0].x).toBeCloseTo(21.996);
    expect(sampleFrame(compact, 500).players[0].x).toBe(10);
    expect(sampleFrame(compact, 2700000).period).toBe(2);
    expect(sampleFrame(compact, 2700000).players[0].x).toBe(30);
    expect(sampleFrame(compact, 1800000).score).toEqual({ home: 1, away: 0 });
    expect(sampleFrame(compact, 499).score.home).toBe(0);
  });

  it('keeps the source and exact frame across pause, speed changes and seeking back from final', () => {
    const before = JSON.stringify(compact);
    const expected = sampleFrame(compact, 1800000);
    let now = 0;
    const clock = new ReplayController(compact, () => now);
    clock.seek(1800000);
    for (const speed of [1, 5, 20, 60, 120]) {
      clock.setSpeed(speed); clock.play(); now += 100; clock.pause();
      clock.seek(1800000);
      expect(sampleFrame(compact, clock.currentTime())).toEqual(expected);
    }
    clock.seek(5400000); clock.seek(1800000);
    expect(sampleFrame(compact, clock.currentTime()).score.home).toBe(1);
    expect(JSON.stringify(compact)).toBe(before);
  });
});
