import { describe, expect, it } from 'vitest';
import { analyseUntil, prepareRecordedAnalysis, RECORDED_STAT_CAPABILITIES, HSR_MPS } from './recorded-analysis';
import type { RecordedEngineId, RecordedPlayer, RecordedSample, RecordedTrack, Side, XY } from '../adapters/recorded-track';
import type { EventView } from '../session';
import type { RecordedEvent } from '../adapters/recorded-events';

// Pista sintética mínima: 1 m = 1/50 unidades en x e y (mpu 50) para leer distancias a mano.
type Spec = {
  engine?: RecordedEngineId; samples: number; half?: number;
  pos?: (i: number, side: Side, slot: number) => XY; owner?: (i: number) => { side: Side; slot: number } | null; ball?: (i: number) => XY;
  active?: (i: number, side: Side, slot: number) => boolean;
};
const MPU = 50;
function track(spec: Spec): RecordedTrack {
  const half = spec.half ?? Math.floor(spec.samples / 2);
  const players: RecordedPlayer[] = (['home', 'away'] as const).flatMap(side => Array.from({ length: 11 }, (_, slot) => ({
    id: `${side}:${slot}`, side, slot, sourceKey: `${side}${slot}`, name: `${side} ${slot}`, role: slot === 0 ? 'GK' as const : 'MID' as const, nativeId: null })));
  // Por defecto: el local defiende x<0 en la 1.ª parte y x>0 en la 2.ª (cambio de campo).
  const flip = (i: number) => i >= half ? -1 : 1;
  const pos = spec.pos ?? ((i, side, slot) => [flip(i) * (side === 'home' ? -1 : 1) * (slot === 0 ? 0.9 : 0.2), (slot - 5) * 0.05] as XY);
  const sample = (index: number): RecordedSample => {
    const i = Math.max(0, Math.min(spec.samples - 1, Math.floor(index)));
    const period = i >= half ? 2 : 1;
    return { matchMs: period === 1 ? i * 100 : 2700000 + (i - half) * 100, period, score: [0, 0], owner: spec.owner?.(i) ?? null, mode: 0,
      home: Array.from({ length: 11 }, (_, s) => pos(i, 'home', s)), away: Array.from({ length: 11 }, (_, s) => pos(i, 'away', s)),
      homeActive: spec.active ? Array.from({ length: 11 }, (_, s) => spec.active!(i, 'home', s)) : null,
      awayActive: spec.active ? Array.from({ length: 11 }, (_, s) => spec.active!(i, 'away', s)) : null,
      ball: spec.ball?.(i) ?? [0, 0], ballZ: null };
  };
  return { engine: spec.engine ?? 'touchlines', engineVersion: 'x', schemaVersion: 'grf-experimental-1', traceHash: 'h', seed: 1, synthetic: true, notice: 'SYNTHETIC',
    datasetVersion: 'd', nativeBinarySha256: null, home: { key: 'a:2003', name: 'A', formation: null }, away: { key: 'b:2024', name: 'B', formation: null },
    players, intervalMs: 100, sampleCount: spec.samples, leadingSamples: 0, durationMs: (spec.samples - 1) * 100,
    periodStarts: [{ period: 1, index: 0 }, { period: 2, index: half }],
    units: { space: 'grf-normalised', metresPerUnit: { x: MPU, y: MPU }, ballHeight: 'absent' }, goals: [], upstream: null, sample };
}
const ev = (over: Partial<EventView> & Pick<EventView, 'kind' | 'elapsedMs'>): EventView => ({ id: `${over.kind}:${over.elapsedMs}:${Math.random()}`, sourceIndex: 0, period: 1,
  periodMs: over.elapsedMs ?? 0, side: null, actorId: null, participantIds: [], outcome: null, provenance: 'native_observed', refs: [], details: {}, ...over });
const pass = (tMs: number, side: Side, slot: number, to: number | null): RecordedEvent => ({ tMs, sampleIndex: tMs / 100, period: 1, matchMs: tMs, kind: 'pass', side, slot,
  playerId: null, x: 0, y: 0, native: 'passAttempted', extra: to === null ? {} : { to_slot: to } });

describe('possession', () => {
  it('uses the recorded owner and credits a loose ball to the last owner', () => {
    // 0–9 local, 10–29 suelto (sigue local), 30–39 visitante → 30 local / 10 visitante.
    const t = track({ samples: 40, half: 40, owner: i => i < 10 ? { side: 'home', slot: 5 } : i >= 30 ? { side: 'away', slot: 5 } : null });
    const a = analyseUntil(prepareRecordedAnalysis({ track: t, events: [], passes: [] }), t.durationMs);
    expect(a.possession.basis).toBe('recorded_owner');
    expect(a.possession.home).toBeCloseTo(0.75, 5);
    expect(a.possession.away).toBeCloseTo(0.25, 5);
  });

  it('falls back to the nearest player within 2 m only when the engine never records an owner', () => {
    // Balón encima del 9 visitante (0.2, 0.2) durante toda la grabación.
    const t = track({ samples: 20, half: 20, ball: () => [0.2, 0.2] });
    const a = analyseUntil(prepareRecordedAnalysis({ track: t, events: [], passes: [] }), t.durationMs);
    expect(a.possession.basis).toBe('nearest_player');
    expect(a.possession.away).toBe(1);
  });

  it('is unavailable before anyone has the ball', () => {
    const t = track({ samples: 20, half: 20, owner: i => i >= 15 ? { side: 'home', slot: 1 } : null });
    const a = analyseUntil(prepareRecordedAnalysis({ track: t, events: [], passes: [] }), 1000);
    expect(a.possession.home).toBeNull();
    expect(a.possession.away).toBeNull();
  });
});

describe('territory and attacking frame', () => {
  it('derives each half’s direction from the goalkeepers and normalises shots to attack left→right', () => {
    const t = track({ samples: 100, half: 50, ball: i => [i < 50 ? 0.5 : -0.5, 0] });
    const m = prepareRecordedAnalysis({ track: t, events: [
      ev({ kind: 'shot', elapsedMs: 1000, side: 'home', details: { x: 0.8, y: 0.1 } }),
      ev({ kind: 'shot', elapsedMs: 6000, period: 2, side: 'home', details: { x: -0.8, y: -0.1 } }),
    ], passes: [] });
    const a = analyseUntil(m, t.durationMs);
    // El balón siempre está en campo rival del local (x>0 en la 1.ª, x<0 en la 2.ª).
    expect(a.territory.home).toBe(1);
    expect(a.shots.map(s => [Math.round(s.x), Math.round(s.y)])).toEqual([[95, 42], [95, 42]]);
  });
});

describe('distance and high-speed running', () => {
  it('sums one-second displacements, counts ≥5.5 m/s as high speed and skips relocations', () => {
    // Local 5: 6 m/s durante 10 s, luego quieto; en el segundo 15 salta 40 m (recolocación).
    const x = (i: number) => { const s = i / 10; return s <= 10 ? s * 6 : s < 15 ? 60 : 100; };
    const t = track({ samples: 201, half: 201, pos: (i, side, slot) => side === 'home' && slot === 5 ? [x(i) / MPU, 0] : [side === 'home' ? -0.9 : 0.9, slot * 0.01] });
    const a = analyseUntil(prepareRecordedAnalysis({ track: t, events: [], passes: [] }), t.durationMs);
    const p = a.players.find(q => q.side === 'home' && q.slot === 5)!;
    expect(HSR_MPS).toBe(5.5);
    expect(p.distanceM).toBeCloseTo(60, 5);
    expect(p.hsrM).toBeCloseTo(60, 5);
    expect(a.teams.home.distanceM).toBeCloseTo(60, 5);
    const early = analyseUntil(prepareRecordedAnalysis({ track: t, events: [], passes: [] }), 5000);
    expect(early.players.find(q => q.side === 'home' && q.slot === 5)!.distanceM).toBeCloseTo(30, 5);
  });

  it('ignores players the engine marks inactive', () => {
    const t = track({ samples: 31, half: 31, pos: (i, side, slot) => [side === 'home' && slot === 3 ? i / 10 * 3 / MPU : 0, slot * 0.01],
      active: (i, side, slot) => !(side === 'home' && slot === 3 && i > 10) });
    const a = analyseUntil(prepareRecordedAnalysis({ track: t, events: [], passes: [] }), t.durationMs);
    expect(a.players.find(q => q.side === 'home' && q.slot === 3)!.distanceM).toBeCloseTo(3, 5);
  });
});

describe('recorded events', () => {
  const t = track({ samples: 6001, half: 3000 });
  const events = [
    ev({ kind: 'shot', elapsedMs: 10000, side: 'home', actorId: 'touchlines:home:9', outcome: 'saved', details: { x: 0.8, y: 0, xg: 0.2 } }),
    ev({ kind: 'save', elapsedMs: 10500, side: 'away', actorId: 'touchlines:away:0' }),
    ev({ kind: 'shot', elapsedMs: 20000, side: 'home', actorId: 'touchlines:home:9', outcome: 'goal', details: { x: 0.85, y: 0, xg: 0.4 } }),
    ev({ kind: 'goal', elapsedMs: 20500, side: 'home', actorId: 'touchlines:home:9', outcome: 'goal' }),
    ev({ kind: 'shot', elapsedMs: 400000, period: 2, side: 'away', actorId: 'touchlines:away:10', outcome: 'off_target', details: { x: -0.7, y: 0, xg: 0.1 } }),
    ev({ kind: 'offside', elapsedMs: 410000, period: 2, side: 'away' }),
    ev({ kind: 'goal', elapsedMs: 500000, period: 2, side: 'home', actorId: 'touchlines:away:4', outcome: 'own_goal' }),
  ];
  const m = prepareRecordedAnalysis({ track: t, events, passes: [pass(1000, 'home', 9, 10), pass(2000, 'home', 9, 10), pass(3000, 'home', 10, 9), pass(4000, 'away', 4, null)] });

  it('counts shots, on target, saves and engine xG per team and player', () => {
    const a = analyseUntil(m, t.durationMs);
    expect(a.teams.home).toMatchObject({ goals: 2, shots: 2, shotsOnTarget: 2, saves: 0, passes: 3, offsides: 0 });
    expect(a.teams.home.xg).toBeCloseTo(0.6, 5);
    expect(a.teams.away).toMatchObject({ goals: 0, shots: 1, shotsOnTarget: 0, saves: 1, offsides: 1, cards: null, fouls: null });
    const henry = a.players.find(p => p.id === 'touchlines:home:9')!;
    expect(henry).toMatchObject({ goals: 1, shots: 2, shotsOnTarget: 2, passes: 2 });
    // El autogol suma al equipo acreditado, no al jugador.
    expect(a.players.find(p => p.id === 'touchlines:away:4')!.goals).toBe(0);
  });

  it('stops at the cursor', () => {
    const a = analyseUntil(m, 15000);
    expect(a.teams.home).toMatchObject({ goals: 0, shots: 1 });
    expect(a.shots).toHaveLength(1);
  });

  it('builds 5-minute momentum windows per half with shots and possession', () => {
    const a = analyseUntil(m, t.durationMs);
    expect(a.momentum.map(w => w.label)).toEqual(["0'–5'", "45'–50'"]);
    expect(a.momentum[0].shots).toEqual({ home: 2, away: 0 });
    expect(a.momentum[1].shots).toEqual({ home: 0, away: 1 });
  });

  it('builds the pass network from recorded receivers only', () => {
    const a = analyseUntil(m, t.durationMs);
    expect(a.passNetwork?.home.edges).toEqual([{ from: 'touchlines:home:9', to: 'touchlines:home:10', count: 2 }, { from: 'touchlines:home:10', to: 'touchlines:home:9', count: 1 }]);
    expect(a.passNetwork?.away.edges).toEqual([]);
  });

  it('leaves what an engine does not record as null, never zero', () => {
    const g = prepareRecordedAnalysis({ track: track({ samples: 20, half: 10, engine: 'grf' }), events: [ev({ kind: 'shot', elapsedMs: 100, side: 'home', details: { x: 0.8, y: 0 } })], passes: [pass(100, 'home', 2, null)] });
    const a = analyseUntil(g, 1900);
    expect(a.teams.home).toMatchObject({ shots: 1, shotsOnTarget: null, saves: null, xg: null, fouls: 0, corners: 0, cards: null, passes: 1 });
    expect(a.passNetwork).toBeNull();
    expect(RECORDED_STAT_CAPABILITIES['open-football']).toMatchObject({ fouls: true, corners: false, xg: false, cards: false });
  });
});

describe('positions', () => {
  it('heat maps hold one count per counted second and average positions are in the attacking frame', () => {
    const t = track({ samples: 101, half: 50 });
    const a = analyseUntil(prepareRecordedAnalysis({ track: t, events: [], passes: [] }), t.durationMs);
    const gk = a.players.find(p => p.side === 'home' && p.slot === 0)!;
    expect(gk.heat.reduce((s, n) => s + n, 0)).toBe(11);
    // El portero local siempre defiende: x pequeña en el marco de ataque, en ambas partes.
    expect(gk.average!.x).toBeLessThan(10);
    expect(a.teams.home.shape.all?.depth).toBeGreaterThanOrEqual(0);
  });
});

// Grabaciones servidas (`.local/replays-dist`, sin versionar): el análisis de la demo 43 cuadra con el marcador grabado.
const dist = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env.TIMEPITCH_RECORDED_REPLAY_DIST;
it.runIf(Boolean(dist))('analyses the three demo recordings consistently with their samples', async () => {
  const fsName = 'node:fs';
  const fs = await import(/* @vite-ignore */ fsName) as { readFileSync: (p: string) => Uint8Array<ArrayBuffer> };
  const { TRACKED_REPLAY_INDEX, loadRecordedReplay } = await import('../adapters/recorded-replay');
  const { loadRecordedEvents } = await import('../adapters/recorded-events');
  const { createRecordedSession } = await import('../adapters/recorded-session');
  const read = async (file: string) => fs.readFileSync(`${dist}/${file}`).slice().buffer;
  for (const entry of TRACKED_REPLAY_INDEX.recordings.filter(e => e.seed === 43)) {
    const signal = new AbortController().signal;
    const t = await loadRecordedReplay(entry, read, signal), recorded = await loadRecordedEvents(entry, read, signal);
    const session = createRecordedSession(entry.id, t, recorded);
    const started = performance.now();
    const model = prepareRecordedAnalysis({ track: t, events: session.resolveFrame(t.durationMs).events, passes: recorded?.events.filter(e => e.kind === 'pass') ?? [] });
    const prepared = performance.now() - started;
    const a = analyseUntil(model, t.durationMs), q = performance.now() - started - prepared;
    const last = t.sample(t.sampleCount - 1).score;
    expect([a.teams.home.goals, a.teams.away.goals]).toEqual([last[0], last[1]]);
    expect(a.possession.home! + a.possession.away!).toBeCloseTo(1, 6);
    for (const p of a.players) expect(p.distanceM / Math.max(1, p.seconds)).toBeLessThan(10);
    console.info(entry.id, JSON.stringify({ prepMs: Math.round(prepared), queryMs: Math.round(q), possession: a.possession, territory: a.territory, tilt: a.fieldTilt,
      home: { ...a.teams.home, distanceM: Math.round(a.teams.home.distanceM), hsrM: Math.round(a.teams.home.hsrM) },
      away: { ...a.teams.away, distanceM: Math.round(a.teams.away.distanceM), hsrM: Math.round(a.teams.away.hsrM) },
      topRunner: a.players.reduce((b, p) => p.distanceM > b.distanceM ? p : b).distanceM, windows: a.momentum.length, net: a.passNetwork?.home.edges.length ?? null }));
    session.dispose();
  }
}, 300000);
