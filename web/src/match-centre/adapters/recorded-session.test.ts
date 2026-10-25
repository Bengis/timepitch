import { describe, expect, it } from 'vitest';
import { createRecordedSession, RECORDED_SESSION_SOURCE, recordedCue } from './recorded-session';
import type { EventView } from '../session';
import { ENGINE_PROFILES } from './recorded-replay';
import { normalizeRecording, RECORDED_ENGINE_IDS, type RecordedEngineId } from './recorded-track';
import { eventsEntryFor, rawRecording } from './recorded-fixtures';
import { parseRecordedEvents } from './recorded-events';
import { sampleInterval } from '../sampling';
import { buildAnnouncements, RECORDED_ENGINE_KINDS, SOURCE_KINDS } from '../announcements/announcements';
import { ballHeight } from '../../match/renderers/camera';

const signal = () => new AbortController().signal;
const session = (engine: RecordedEngineId, raw = rawRecording(engine)) => createRecordedSession(`${engine}-fixture`, normalizeRecording(raw, ENGINE_PROFILES[engine]));

describe('recorded replay session', () => {
  for (const engine of RECORDED_ENGINE_IDS) it(`${engine}: frame keys are PlayerView ids whose sourceKey is the catalogue roster key`, async () => {
    const adapter = session(engine); await adapter.ensure(150, signal());
    const s = adapter.snapshot(), players = s.panels.players!.players, frame = sampleInterval(s.interval!, 150);
    expect(frame.players).toHaveLength(22);
    for (const p of frame.players) {
      const view = players.find(v => v.id === p.key)!;
      expect(view).toBeDefined(); expect(p.key.startsWith(`${engine}:`)).toBe(true);
      expect(view.details?.sourceKey).toMatch(/^epldata:2015:(chelsea|swansea):P\d+$/);
      expect(view.details?.teamKey).toBe(p.side === 'home' ? 'chelsea:2015' : 'swansea:2015');
    }
    expect(s.descriptor.identity).toEqual({ source: RECORDED_SESSION_SOURCE, id: `${engine}-fixture`, revision: rawRecording(engine).trace_hash });
    expect(s.descriptor.metadata).toMatchObject({ engine, seed: 42, synthetic: true, hash: rawRecording(engine).trace_hash });
    adapter.dispose();
  });
  it('the clock follows the recorded dt: sample i at i×100 ms elapsed, match clock from the recording', async () => {
    for (const engine of RECORDED_ENGINE_IDS) {
      const raw = rawRecording(engine), adapter = session(engine, raw);
      for (const i of [0, 3, 4, 7]) {
        await adapter.ensure(i * 100, signal()); const s = adapter.snapshot();
        expect(s.clockMs).toBe(raw.samples[i].match_time_ms); expect(s.presentedCursor.period).toBe(i < 4 ? 1 : 2);
      }
      expect(adapter.snapshot().descriptor.periods).toEqual([{ period: 1, startMs: 0, durationMs: 400 }, { period: 2, startMs: 400, durationMs: 300 }]);
      adapter.dispose();
    }
  });
  it('ball height reaches the renderer for GRF/open-football and is absent for TouchLines', async () => {
    for (const [engine, expected] of [['grf', 1.5], ['open-football', 1.5], ['touchlines', null]] as const) {
      const adapter = session(engine); await adapter.ensure(100, signal());
      const ball = sampleInterval(adapter.snapshot().interval!, 100).ball!;
      if (expected === null) { expect('z' in ball).toBe(false); expect(ballHeight(ball)).toBe(0); }
      else expect(ballHeight(ball)).toBe(expected);
      await adapter.ensure(50, signal());
      const mid = sampleInterval(adapter.snapshot().interval!, 50).ball as { z?: number };
      if (expected === null) expect(mid.z).toBeUndefined(); else expect(mid.z).toBeCloseTo((1.5 + 0.11) / 2, 10);
      adapter.dispose();
    }
  });
  it('emits only goal, halftime and fulltime, and every announcement it yields is allowed for its source', async () => {
    for (const engine of RECORDED_ENGINE_IDS) {
      const adapter = session(engine); await adapter.ensure(700, signal());
      const events = adapter.snapshot().events;
      expect(events.map(e => e.kind)).toEqual(['goal', 'halftime', 'fulltime']);
      expect(events[0]).toMatchObject({ side: 'home', elapsedMs: 200, provenance: 'native_observed' });
      for (const a of buildAnnouncements(RECORDED_SESSION_SOURCE, events)) expect(SOURCE_KINDS[RECORDED_SESSION_SOURCE].has(a.kind)).toBe(true);
      adapter.dispose();
    }
  });
  it('the scorer is named only when the engine recorded it', async () => {
    const actor = async (engine: RecordedEngineId) => { const a = session(engine); await a.ensure(700, signal()); const id = a.snapshot().events[0].actorId; a.dispose(); return id; };
    expect(await actor('grf')).toBeNull();
    expect(await actor('touchlines')).toBe('touchlines:home:epldata:2015:chelsea:P9');
    expect(await actor('open-football')).toBe('open-football:home:epldata:2015:chelsea:P10');
  });
  it('does not interpolate across a period change, a goal or a teleport; inactive members are not drawn', async () => {
    const raw = rawRecording('grf'); (raw.samples[5].home_xy as number[][])[3] = [0.9, 0.4]; (raw.samples[6].home_active as boolean[])[1] = false;
    const adapter = session('grf', raw);
    for (const ms of [150, 350, 450]) { await adapter.ensure(ms, signal()); expect(adapter.snapshot().interval!.continuousBall).toBe(false); }
    await adapter.ensure(50, signal()); expect(adapter.snapshot().interval!.continuousPlayers.size).toBe(22);
    await adapter.ensure(650, signal()); expect(adapter.snapshot().interval!.before.players.some(p => p.key.endsWith('chelsea:P1'))).toBe(false);
    adapter.dispose();
  });
  it('possession comes from the recorded owner; unknown owner stays unknown', async () => {
    const adapter = session('touchlines');
    await adapter.ensure(100, signal()); expect(adapter.snapshot().facts.carrierId.value).toBe('touchlines:home:epldata:2015:chelsea:P9');
    await adapter.ensure(300, signal()); expect(adapter.snapshot().facts.possession.value).toBeNull();
    adapter.dispose();
  });
});

describe('recorded replay session with the engine events sidecar (TP202)', () => {
  const withEvents = async (engine: RecordedEngineId) => {
    const raw = rawRecording(engine), { entry, events } = await eventsEntryFor(engine);
    const track = normalizeRecording(raw, ENGINE_PROFILES[engine]);
    return createRecordedSession(`${engine}-fixture`, track, parseRecordedEvents(events, entry));
  };
  const at = async (engine: RecordedEngineId, ms = 700) => { const a = await withEvents(engine); await a.ensure(ms, signal()); const s = a.snapshot(); a.dispose(); return s; };

  it('adds the recorded match events, never passes or possession changes, and only what the engine recorded', async () => {
    expect((await at('grf')).events.map(e => e.kind)).toEqual(['shot', 'goal', 'kickoff', 'foul', 'halftime', 'kickoff', 'offside', 'corner', 'fulltime']);
    expect((await at('touchlines')).events.map(e => e.kind)).toEqual(['kickoff', 'shot', 'save', 'shot', 'goal', 'shot', 'halftime', 'offside', 'free_kick', 'fulltime']);
    expect((await at('open-football')).events.map(e => e.kind)).toEqual(['kickoff', 'shot', 'goal', 'foul', 'halftime', 'kickoff', 'offside', 'fulltime']);
  });
  it('events carry actor, side, recorded time and simulated provenance; nothing after the cursor is visible', async () => {
    const foul = (await at('open-football')).events.find(e => e.kind === 'foul')!;
    expect(foul).toMatchObject({ elapsedMs: 300, sourceIndex: 3, period: 1, side: 'away', actorId: 'open-football:away:epldata:2015:swansea:P7',
      provenance: 'native_observed', details: { engine: 'open-football', native: 'player:CommitFoul', severity: 'Normal' } });
    expect((await at('touchlines', 250)).events.map(e => e.kind)).toEqual(['kickoff', 'shot', 'save', 'shot', 'goal']);
  });
  it('shot outcome only when the engine resolved it', async () => {
    expect((await at('touchlines')).events.filter(e => e.kind === 'shot').map(e => e.outcome)).toEqual(['saved', 'goal', 'off_target']);
    expect((await at('grf')).events.find(e => e.kind === 'shot')!.outcome).toBeNull();
  });
  it('kick-offs at a period start are marked; restarts after a goal are not', async () => {
    const kicks = (await at('grf')).events.filter(e => e.kind === 'kickoff').map(e => e.details.period_start);
    expect(kicks).toEqual([false, true]);
  });
  it('GRF goals get the scorer the engine recorded in its telemetry', async () => {
    expect((await at('grf')).events.find(e => e.kind === 'goal')!.actorId).toBe('grf:home:epldata:2015:chelsea:P7');
  });
  it('rejects a sidecar of another recording', async () => {
    const { entry, events } = await eventsEntryFor('grf');
    const other = normalizeRecording({ ...rawRecording('grf'), trace_hash: 'ff'.repeat(32) }, ENGINE_PROFILES.grf);
    expect(() => createRecordedSession('x', other, parseRecordedEvents(events, entry))).toThrow(/identity_mismatch/);
  });
  it('every announcement is allowed for its engine; touchlines announces saves and misses, GRF and open-football fouls and offsides', async () => {
    const kinds = async (engine: RecordedEngineId) => buildAnnouncements(RECORDED_SESSION_SOURCE, (await at(engine)).events).map(a => a.kind);
    expect(await kinds('touchlines')).toEqual(['kick_off', 'shot_saved', 'goal', 'shot_off_target', 'half_time', 'offside', 'full_time']);
    expect(await kinds('grf')).toEqual(['goal', 'foul', 'half_time', 'kick_off', 'offside', 'corner', 'full_time']);
    expect(await kinds('open-football')).toEqual(['kick_off', 'goal', 'foul', 'half_time', 'kick_off', 'offside', 'full_time']);
    for (const engine of RECORDED_ENGINE_IDS) for (const k of await kinds(engine)) expect(RECORDED_ENGINE_KINDS[engine].has(k)).toBe(true);
  });
});

// TP212: open-football graba su primer tick a 30 ms; la muestra de 0 ms del export lleva a los 22 «inactivos»
// y a 0:00 solo se veía el balón. Se descartan las muestras iniciales sin ningún jugador grabado, sin inventar posiciones.
describe('leading samples without any recorded player (TP212)', () => {
  const beforeFirstTick = () => {
    const raw = rawRecording('open-football');
    Object.assign(raw.samples[0], { home_active: Array(11).fill(false), away_active: Array(11).fill(false) });
    return raw;
  };
  it('the replay starts at the first sample with players: 22 drawn at 0:00, clock and goals from the recording', async () => {
    const raw = beforeFirstTick(), track = normalizeRecording(raw, ENGINE_PROFILES['open-football']);
    expect(track.leadingSamples).toBe(1);
    expect(track.sampleCount).toBe(7); expect(track.durationMs).toBe(600);
    expect(track.sample(0).matchMs).toBe(100); expect(track.sample(0).home).toBe(raw.samples[1].home_xy);
    expect(track.periodStarts).toEqual([{ period: 1, index: 0 }, { period: 2, index: 3 }]);
    expect(track.goals.map(g => g.sampleIndex)).toEqual([1]);
    const adapter = createRecordedSession('of-fixture', track); await adapter.ensure(0, signal());
    expect(sampleInterval(adapter.snapshot().interval!, 0).players).toHaveLength(22);
    adapter.dispose();
  });
  it('sidecar times move with the trimmed samples and never go below zero', async () => {
    const raw = beforeFirstTick(), { entry, events } = await eventsEntryFor('open-football');
    const adapter = createRecordedSession('of-fixture', normalizeRecording(raw, ENGINE_PROFILES['open-football']), parseRecordedEvents(events, entry));
    await adapter.ensure(600, signal());
    const byKind = (k: string) => adapter.snapshot().events.filter(e => e.kind === k);
    expect(byKind('kickoff').map(e => [e.elapsedMs, e.sourceIndex])).toEqual([[0, 0], [310, 3]]);
    expect(byKind('foul').map(e => [e.elapsedMs, e.sourceIndex])).toEqual([[200, 2]]);
    adapter.dispose();
  });
  it('keeps samples where only some players are inactive, and recordings that start with everyone on the pitch', () => {
    const partial = rawRecording('open-football'); (partial.samples[0].home_active as boolean[])[3] = false;
    expect(normalizeRecording(partial, ENGINE_PROFILES['open-football']).leadingSamples).toBe(0);
    for (const engine of RECORDED_ENGINE_IDS) expect(normalizeRecording(rawRecording(engine), ENGINE_PROFILES[engine])).toMatchObject({ leadingSamples: 0, sampleCount: 8 });
  });
});

describe('evento que ilustra el gráfico (recordedCue, TP222)', () => {
  const ev = (kind: string, elapsedMs: number, extra: Partial<EventView> = {}): EventView => ({ id: `${kind}:${elapsedMs}`, sourceIndex: elapsedMs / 100, kind,
    period: 1, periodMs: elapsedMs, elapsedMs, side: 'home', actorId: 'grf:h9', participantIds: ['grf:h9'], outcome: null, provenance: 'native_observed',
    refs: [], details: {}, ...extra });
  it('el tiro dura hasta el siguiente acontecimiento: el portero puede estirarse antes del gol (6:49, semilla 43)', () => {
    const shot = ev('shot', 408_870), goal = ev('goal', 409_500);
    expect(recordedCue([shot], 409_200)).toMatchObject({ type: 'shot', participants: ['grf:h9'], side: 'home', t1_ms: 408_870 });
    expect(recordedCue([shot, goal], 409_600)).toMatchObject({ type: 'goal', t1_ms: 409_500 });
    expect(recordedCue([shot, goal], 410_500)).toBeUndefined();
    expect(recordedCue([shot], 408_870 + 1500)).toBeUndefined();
  });
  it('tarjeta grabada con su color y fuera de juego con su sitio; uno anterior no reaparece', () => {
    expect(recordedCue([ev('card_red', 1000)], 2000)).toMatchObject({ type: 'card', card: 'red', participants: ['grf:h9'] });
    expect(recordedCue([ev('card_yellow', 1000)], 2000)).toMatchObject({ type: 'card', card: 'yellow' });
    expect(recordedCue([ev('offside', 1000, { details: { x: -.58096, y: .07519 } })], 1500)!.at!.x).toBeCloseTo(22, 0);
    expect(recordedCue([ev('card_yellow', 1000), ev('throw_in', 1500)], 2400)).toBeUndefined();
    expect(recordedCue([ev('throw_in', 1500)], 1600)).toMatchObject({ type: 'restart' });
    expect(recordedCue([ev('pass', 1500), ev('corner', 1600)], 1700)).toBeUndefined();
    expect(recordedCue([ev('foul', 1500, { actorId: null, participantIds: [] })], 1700)).toBeUndefined();
    expect(recordedCue([ev('kickoff', 0, { actorId: null, participantIds: [] })], 500)).toMatchObject({ type: 'kickoff', participants: [] });
  });
});
