import { describe, expect, it } from 'vitest';
import type { EventView, MatchSource } from '../session';
import {
  buildAnnouncements, initialAnnouncer, minuteLabel, RECORDED_ENGINE_KINDS, SOURCE_KINDS, stepAnnouncer,
  type Announcement, type AnnouncementKind,
} from './announcements';

let seq = 0;
function ev(source: MatchSource, kind: string, elapsedMs: number, over: Partial<EventView> = {}): EventView {
  const raw = over.refs?.[0] ?? `e${++seq}`;
  return {
    id: `${source}:${raw}`, sourceIndex: seq, kind, period: elapsedMs >= 2_700_000 ? 2 : 1,
    periodMs: elapsedMs >= 2_700_000 ? elapsedMs - 2_700_000 : elapsedMs, elapsedMs,
    side: 'home', actorId: `${source}:p1`, participantIds: [`${source}:p1`], outcome: null,
    provenance: source === 'historical' ? 'source_recorded' : source === 'grf' ? 'native_observed' : 'simulated',
    refs: [raw], details: {}, ...over,
  };
}
const kinds = (list: readonly Announcement[]) => list.map(a => a.kind);

describe('TimePitch simulation source', () => {
  it('announces one goal for shot+goal, with running score and simulated provenance', () => {
    const shot = ev('timepitch', 'shot', 600_000, { refs: ['s1'], outcome: 'goal' });
    const goal = ev('timepitch', 'goal', 600_000, { refs: ['g1'], outcome: 'scored', details: { evidence: { shot_id: 's1' } } });
    const [a, ...rest] = buildAnnouncements('timepitch', [shot, goal]);
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ kind: 'goal', side: 'home', primaryPlayerId: 'timepitch:p1', scoreAfter: { home: 1, away: 0 },
      provenance: 'simulated', minuteLabel: "11'", atMs: 600_000 });
  });

  it('merges shot+save into shot_saved with the keeper as secondary player', () => {
    const shot = ev('timepitch', 'shot', 900_000, { refs: ['s2'], outcome: 'saved' });
    const save = ev('timepitch', 'save', 900_000, { refs: ['v2'], side: 'away', actorId: 'timepitch:gk', outcome: 'saved', details: { evidence: { shot_id: 's2' } } });
    const list = buildAnnouncements('timepitch', [shot, save]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'shot_saved', primaryPlayerId: 'timepitch:p1', secondaryPlayerId: 'timepitch:gk', side: 'home' });
  });

  it('maps off-target shots and ignores open-play noise and post-goal restarts', () => {
    const list = buildAnnouncements('timepitch', ['pass', 'carry', 'pressure', 'tackle', 'recovery', 'restart']
      .map((k, i) => ev('timepitch', k, 1000 * (i + 10))).concat(ev('timepitch', 'shot', 20_000, { outcome: 'off_target' })));
    expect(kinds(list)).toEqual(['shot_off_target']);
  });

  it('never announces kinds the engine does not emit, even if such events appear', () => {
    const list = buildAnnouncements('timepitch', [
      ev('timepitch', 'Foul Committed', 1000, { details: { foul_committed: { card: { name: 'Red Card' } } } }),
      ev('timepitch', 'Substitution', 2000), ev('timepitch', 'foul', 3000), ev('timepitch', 'corner', 4000),
    ]);
    expect(list).toEqual([]);
    for (const k of ['yellow', 'second_yellow', 'red', 'substitution', 'foul', 'offside', 'corner', 'penalty', 'own_goal', 'shot_blocked'] as AnnouncementKind[])
      expect(SOURCE_KINDS.timepitch.has(k)).toBe(false);
  });

  it('announces kick-off once per period, half-time and full-time', () => {
    const list = buildAnnouncements('timepitch', [
      ev('timepitch', 'kickoff', 0), ev('timepitch', 'kickoff', 300_000),
      ev('timepitch', 'halftime', 2_700_000, { side: null, actorId: null, period: 1, periodMs: 2_700_000 }),
      ev('timepitch', 'kickoff', 2_700_000, { side: 'away' }),
      ev('timepitch', 'fulltime', 5_400_000, { side: null, actorId: null }),
    ]);
    expect(kinds(list)).toEqual(['kick_off', 'half_time', 'kick_off', 'full_time']);
    expect(list[1].minuteLabel).toBe("45'");
  });
});

describe('GRF source', () => {
  const grf = (kind: string, ms: number, details: Record<string, unknown>, over: Partial<EventView> = {}) =>
    ev('grf', kind, ms, { details: { type: 'decision', ...details }, ...over });

  it('announces one foul per incident with the offending side', () => {
    const list = buildAnnouncements('grf', [
      grf('foul', 10_000, { stage: 'accepted', incident_id: 4, actor_team: 1, team: 0 }, { side: 'home', actorId: 'grf:a7' }),
      grf('foul', 10_500, { stage: 'sanctioned', incident_id: 4, actor_team: 1, team: 0 }, { side: 'home', actorId: 'grf:a7' }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'foul', side: 'away', primaryPlayerId: 'grf:a7', provenance: 'simulated' });
  });

  it('merges a foul followed by a penalty into one penalty for the fouled side', () => {
    const list = buildAnnouncements('grf', [
      grf('foul', 30_000, { stage: 'accepted', incident_id: 5, actor_team: 1, team: 0 }, { side: 'home', actorId: 'grf:a4' }),
      grf('penalty', 33_000, { stage: 'prepared', incident_id: 6, actor_team: 0, team: 0 }, { side: 'home', actorId: 'grf:h9' }),
    ]);
    expect(kinds(list)).toEqual(['penalty']);
    expect(list[0]).toMatchObject({ side: 'home', primaryPlayerId: 'grf:h9', secondaryPlayerId: 'grf:a4' });
  });

  it('announces own goals for the credited side and keeps the running score', () => {
    const list = buildAnnouncements('grf', [
      ev('grf', 'goal', 50_000, { side: 'away', outcome: 'goal', details: { type: 'goal' } }),
      ev('grf', 'goal', 60_000, { side: 'away', actorId: 'grf:h3', outcome: 'own_goal', details: { type: 'goal', own_goal: true } }),
    ]);
    expect(kinds(list)).toEqual(['goal', 'own_goal']);
    expect(list[1]).toMatchObject({ side: 'away', primaryPlayerId: 'grf:h3', scoreAfter: { home: 0, away: 2 } });
  });

  it('maps corners, offsides and match end; ignores other restarts and touches', () => {
    const list = buildAnnouncements('grf', [
      grf('kickoff', 0, { stage: 'prepared', incident_id: 1 }),
      grf('goal_kick', 1000, { stage: 'prepared', incident_id: 2 }), grf('free_kick', 2000, { stage: 'prepared', incident_id: 3 }),
      grf('throw_in', 3000, { stage: 'prepared', incident_id: 4 }), ev('grf', 'shot', 4000, { details: { type: 'touch' } }),
      grf('corner', 5000, { stage: 'prepared', incident_id: 7 }), grf('offside', 6000, { stage: 'awarded', incident_id: 8, actor_team: 1, team: 0 }),
      ev('grf', 'episode_end', 9000, { side: null, actorId: null }),
    ]);
    expect(kinds(list)).toEqual(['kick_off', 'corner', 'offside', 'full_time']);
    expect(list[2].side).toBe('away');
  });

  it('emits at most one full_time when GRF reports both fulltime and episode_end', () => {
    const list = buildAnnouncements('grf', [
      ev('grf', 'fulltime', 5_400_000, { side: null, actorId: null }),
      ev('grf', 'episode_end', 5_400_500, { side: null, actorId: null }),
    ]);
    expect(kinds(list)).toEqual(['full_time']);
  });

  it('uses the absolute GRF match clock for minute labels', () => {
    const [a] = buildAnnouncements('grf', [ev('grf', 'goal', 1000, { period: 2, periodMs: 3_000_000, outcome: 'goal', details: { type: 'goal' } })]);
    expect(a.minuteLabel).toBe("51'");
  });
});

describe('historical StatsBomb source', () => {
  const shot = (ms: number, outcome: string, over: Partial<EventView> = {}) =>
    ev('historical', 'Shot', ms, { outcome, details: { shot: { outcome: { name: outcome }, type: { name: 'Open Play' } } }, ...over });

  it('maps shot outcomes and attaches the keeper of a nearby save', () => {
    const list = buildAnnouncements('historical', [
      shot(60_000, 'Goal'), shot(120_000, 'Saved'),
      ev('historical', 'Goal Keeper', 120_500, { side: 'away', actorId: 'historical:gk', details: { goalkeeper: { type: { name: 'Shot Saved' } } } }),
      shot(180_000, 'Blocked'), shot(240_000, 'Off T'), shot(300_000, 'Wayward'),
    ], { baseScore: { home: 0, away: 0 } });
    expect(kinds(list)).toEqual(['goal', 'shot_saved', 'shot_blocked', 'shot_off_target', 'shot_off_target']);
    expect(list[0].scoreAfter).toEqual({ home: 1, away: 0 });
    expect(list[1].secondaryPlayerId).toBe('historical:gk');
    expect(list[0].provenance).toBe('historical');
  });

  it('omits scoreAfter when the starting score of the window is unknown', () => {
    expect(buildAnnouncements('historical', [shot(60_000, 'Goal')])[0].scoreAfter).toBeUndefined();
  });

  it('turns carded fouls into card announcements instead of plain fouls', () => {
    const list = buildAnnouncements('historical', [
      ev('historical', 'Foul Committed', 1000, { details: { foul_committed: {} } }),
      ev('historical', 'Foul Committed', 2000, { details: { foul_committed: { card: { name: 'Yellow Card' } } } }),
      ev('historical', 'Bad Behaviour', 3000, { details: { bad_behaviour: { card: { name: 'Second Yellow' } } } }),
      ev('historical', 'Foul Committed', 4000, { details: { foul_committed: { card: { name: 'Red Card' } } } }),
    ]);
    expect(kinds(list)).toEqual(['foul', 'yellow', 'second_yellow', 'red']);
  });

  it('turns a penalty foul into a penalty for the other side', () => {
    const list = buildAnnouncements('historical', [ev('historical', 'Foul Committed', 1000, { side: 'away', details: { foul_committed: { penalty: true } } })]);
    expect(list[0]).toMatchObject({ kind: 'penalty', side: 'home' });
  });

  it('maps offsides, corners, substitutions and own goals', () => {
    const list = buildAnnouncements('historical', [
      ev('historical', 'Pass', 1000, { outcome: 'Pass Offside', details: { pass: { outcome: { name: 'Pass Offside' } } } }),
      ev('historical', 'Offside', 1200),
      ev('historical', 'Pass', 5000, { side: 'away', details: { pass: { type: { name: 'Corner' } } } }),
      ev('historical', 'Pass', 6000, { details: { pass: { type: { name: 'Throw-in' } } } }),
      ev('historical', 'Substitution', 7000, { actorId: 'historical:off', participantIds: ['historical:off', 'historical:on'] }),
      ev('historical', 'Own Goal Against', 8000, { side: 'away', actorId: 'historical:og' }),
      ev('historical', 'Own Goal For', 8000, { side: 'home', actorId: null }),
    ], { baseScore: { home: 2, away: 1 } });
    expect(kinds(list)).toEqual(['offside', 'corner', 'substitution', 'own_goal']);
    expect(list[1].side).toBe('away');
    expect(list[2]).toMatchObject({ primaryPlayerId: 'historical:on', secondaryPlayerId: 'historical:off' });
    expect(list[3]).toMatchObject({ side: 'home', primaryPlayerId: 'historical:og', scoreAfter: { home: 3, away: 1 } });
  });

  it('collapses per-team period markers; the last period end is full time', () => {
    const marker = (kind: string, period: number, periodMs: number, side: 'home' | 'away', at: number) =>
      ev('historical', kind, at, { period, periodMs, side, actorId: null });
    const list = buildAnnouncements('historical', [
      marker('Half Start', 1, 0, 'home', 0), marker('Half Start', 1, 0, 'away', 0),
      marker('Half End', 1, 2_820_000, 'home', 2_820_000), marker('Half End', 1, 2_820_000, 'away', 2_820_000),
      marker('Half Start', 2, 0, 'home', 2_820_000), marker('Half Start', 2, 0, 'away', 2_820_000),
      marker('Half End', 2, 2_880_000, 'home', 5_700_000), marker('Half End', 2, 2_880_000, 'away', 5_700_000),
    ]);
    expect(kinds(list)).toEqual(['kick_off', 'half_time', 'kick_off', 'full_time']);
    expect(list.map(a => a.side)).toEqual([null, null, null, null]);
    expect(list[1].minuteLabel).toBe("45+2'");
    expect(list[3].minuteLabel).toBe("90+3'");
    expect(buildAnnouncements('historical', [marker('Half End', 2, 2_900_000, 'home', 5_720_000)], { lastPeriod: 4 })[0].kind).toBe('half_time');
  });

  it('skips events without a known match time', () => {
    expect(buildAnnouncements('historical', [shot(0, 'Goal', { elapsedMs: null })])).toEqual([]);
  });
});

describe('queue shape', () => {
  it('orders by time and keeps ids stable when more events arrive', () => {
    const a = ev('timepitch', 'shot', 5000, { refs: ['x1'], outcome: 'off_target' });
    const b = ev('timepitch', 'shot', 2000, { refs: ['x2'], outcome: 'off_target' });
    const first = buildAnnouncements('timepitch', [a, b]);
    expect(first.map(x => x.atMs)).toEqual([2000, 5000]);
    const second = buildAnnouncements('timepitch', [a, b, ev('timepitch', 'shot', 9000, { outcome: 'off_target' })]);
    expect(second.slice(0, 2).map(x => x.id)).toEqual(first.map(x => x.id));
    expect(new Set(second.map(x => x.id)).size).toBe(3);
  });

  it('ranks priorities and minimum display times', () => {
    const [goal] = buildAnnouncements('timepitch', [ev('timepitch', 'goal', 1000)]);
    const [miss] = buildAnnouncements('timepitch', [ev('timepitch', 'shot', 1000, { outcome: 'off_target' })]);
    expect(goal.priority).toBeGreaterThan(miss.priority);
    expect(goal.durationMs).toBeGreaterThan(miss.durationMs);
    expect(miss.durationMs).toBeGreaterThanOrEqual(2000);
  });

  it('formats minute labels per period with added time', () => {
    expect(minuteLabel('historical', 1, 0)).toBe("1'");
    expect(minuteLabel('historical', 2, 59_000)).toBe("46'");
    expect(minuteLabel('timepitch', 3, 0)).toBe("91'");
  });
});

describe('announcer scheduling', () => {
  const list = buildAnnouncements('timepitch', [
    ev('timepitch', 'shot', 10_000, { refs: ['m1'], outcome: 'off_target' }),
    ev('timepitch', 'goal', 11_000, { refs: ['g9'] }),
    ev('timepitch', 'shot', 40_000, { refs: ['m2'], outcome: 'off_target' }),
    ev('timepitch', 'shot', 41_000, { refs: ['m3'], outcome: 'off_target' }),
    ev('timepitch', 'goal', 50_000, { refs: ['g10'] }),
  ]);
  const goal1 = list.find(a => a.atMs === 11_000)!, miss1 = list.find(a => a.atMs === 10_000)!;

  it('shows events as playback reaches them and holds each for its minimum time', () => {
    let s = stepAnnouncer(initialAnnouncer(), list, { cursorMs: 0, wallMs: 0 });
    expect(s.current).toBeNull();
    s = stepAnnouncer(s, list, { cursorMs: 10_000, wallMs: 10_000 });
    expect(s.current?.announcement.id).toBe(miss1.id);
    s = stepAnnouncer(s, list, { cursorMs: 11_000, wallMs: 11_000 });
    expect(s.current?.announcement.id).toBe(miss1.id);
    s = stepAnnouncer(s, list, { cursorMs: 10_000 + miss1.durationMs, wallMs: 10_000 + miss1.durationMs });
    expect(s.current?.announcement.id).toBe(goal1.id);
    s = stepAnnouncer(s, list, { cursorMs: 30_000, wallMs: 30_000 });
    expect(s.current).toBeNull();
  });

  it('prefers higher priority among pending items and drops stale minor ones', () => {
    let s = stepAnnouncer(initialAnnouncer(), list, { cursorMs: 39_000, wallMs: 0, seek: true });
    s = stepAnnouncer(s, list, { cursorMs: 40_000, wallMs: 1000 });
    expect(s.current?.announcement.atMs).toBe(40_000);
    // While the first miss is held, a second miss and then a goal arrive: the goal wins the next slot.
    s = stepAnnouncer(s, list, { cursorMs: 41_000, wallMs: 1500 });
    s = stepAnnouncer(s, list, { cursorMs: 50_000, wallMs: 2000 });
    s = stepAnnouncer(s, list, { cursorMs: 50_100, wallMs: 1000 + 10_000 });
    expect(s.current?.announcement.atMs).toBe(50_000);
    s = stepAnnouncer(s, list, { cursorMs: 60_000, wallMs: 1000 + 30_000 });
    expect(s.current).toBeNull();
    expect(s.pending).toEqual([]);
  });

  it('on a forward seek shows only the latest high-priority announcement skipped', () => {
    let s = stepAnnouncer(initialAnnouncer(), list, { cursorMs: 0, wallMs: 0 });
    s = stepAnnouncer(s, list, { cursorMs: 55_000, wallMs: 100, seek: true });
    expect(s.current?.announcement.atMs).toBe(50_000);
    expect(s.pending).toEqual([]);
    s = stepAnnouncer(s, list, { cursorMs: 55_000, wallMs: 100 + 60_000 });
    expect(s.current).toBeNull();
  });

  it('treats a backwards jump as a seek and announces nothing until play passes events again', () => {
    let s = stepAnnouncer(initialAnnouncer(), list, { cursorMs: 55_000, wallMs: 0, seek: true });
    s = stepAnnouncer(s, list, { cursorMs: 5000, wallMs: 100 });
    expect(s.current).toBeNull();
    s = stepAnnouncer(s, list, { cursorMs: 10_000, wallMs: 200 });
    expect(s.current?.announcement.id).toBe(miss1.id);
  });
});

describe('recorded engine source (TP202: per-engine kinds from the events sidecar)', () => {
  const rec = (engine: string, kind: string, elapsedMs: number, over: Partial<EventView> = {}) =>
    ev('recorded', kind, elapsedMs, { provenance: 'native_observed', ...over, details: { engine, ...over.details } });
  it('drops kinds the engine never records, even if such events appear', () => {
    for (const engine of ['grf', 'touchlines', 'open-football'] as const) {
      const list = buildAnnouncements('recorded', [rec(engine, 'card_yellow', 1000), rec(engine, 'card_red', 2000), rec(engine, 'substitution', 3000)]);
      expect(list).toEqual([]);
    }
    expect(buildAnnouncements('recorded', [rec('touchlines', 'foul', 1000)])).toEqual([]);
    expect(buildAnnouncements('recorded', [rec('open-football', 'corner', 1000, { details: { period_start: false } })])).toEqual([]);
    expect(RECORDED_ENGINE_KINDS['open-football'].has('shot_saved')).toBe(false);
    expect(RECORDED_ENGINE_KINDS.grf.has('shot_off_target')).toBe(false);
  });
  it('touchlines: saved shot names shooter and keeper at the save; off target at the shot', () => {
    const shot = rec('touchlines', 'shot', 10_000, { outcome: 'saved', refs: ['s1'], details: { resolved_t_ms: 10_500 } });
    const save = rec('touchlines', 'save', 10_500, { side: 'away', actorId: 'recorded:gk', refs: ['v1'] });
    const miss = rec('touchlines', 'shot', 20_000, { outcome: 'off_target', refs: ['s2'] });
    const list = buildAnnouncements('recorded', [shot, save, miss]);
    expect(list.map(a => [a.kind, a.atMs, a.side, a.primaryPlayerId, a.secondaryPlayerId ?? null])).toEqual([
      ['shot_saved', 10_500, 'home', 'recorded:p1', 'recorded:gk'], ['shot_off_target', 20_000, 'home', 'recorded:p1', null]]);
    expect(list.every(a => a.provenance === 'simulated')).toBe(true);
  });
  it('kick-off only at the start of a period; fouls and offsides name the offending side, corners the awarded side', () => {
    const list = buildAnnouncements('recorded', [
      rec('grf', 'kickoff', 400_000, { details: { period_start: false } }), rec('grf', 'kickoff', 2_700_000, { details: { period_start: true } }),
      rec('grf', 'foul', 2_800_000, { side: 'away' }), rec('grf', 'offside', 2_900_000, { side: 'home' }), rec('grf', 'corner', 3_000_000, { side: 'away' }),
    ]);
    expect(list.map(a => [a.kind, a.side])).toEqual([['kick_off', null], ['foul', 'away'], ['offside', 'home'], ['corner', 'away']]);
  });
  it('without an engine only the baseline (goal, own goal, half time, full time) is allowed', () => {
    const list = buildAnnouncements('recorded', [ev('recorded', 'foul', 1000), ev('recorded', 'goal', 2000), ev('recorded', 'halftime', 3000, { side: null, actorId: null })]);
    expect(list.map(a => a.kind)).toEqual(['goal', 'half_time']);
  });
});
