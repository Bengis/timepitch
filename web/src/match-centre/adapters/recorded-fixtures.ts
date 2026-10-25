// Grabaciones mínimas con la forma real de `.local/freeplay` (TP193): 8 muestras, dos partes y un gol local.
import type { RecordedEngineId } from './recorded-track';
import type { RecordedReplayEntry } from './recorded-replay';

type Raw = Record<string, unknown> & { samples: Record<string, unknown>[] };
const sides = ['home', 'away'] as const;
const key = (side: string, slot: number) => `epldata:2015:${side === 'home' ? 'chelsea' : 'swansea'}:P${slot}`;
const xy = (side: string, i: number) => Array.from({ length: 11 }, (_, slot) => [(side === 'home' ? -0.5 : 0.5) + i * 0.001, -0.3 + slot * 0.06]);
const VERSION: Record<RecordedEngineId, string> = { grf: 'grf-2.10.2-activity-1', touchlines: 'touchlines-5c5c71a-freeplay', 'open-football': 'open-football-bfb2273-harness' };
const PHASES = ['firstHalf', 'firstHalf', 'firstHalf', 'halfTime', 'secondHalf', 'secondHalf', 'secondHalf', 'matchEnd'];

export function rawRecording(engine: RecordedEngineId): Raw {
  const players = sides.flatMap(side => Array.from({ length: 11 }, (_, slot) => ({
    id: `${side}:${key(side, slot)}`, side, slot, source_key: key(side, slot), name: `${side} ${slot}`, role: slot === 0 ? 'GK' : 'MID',
    ...(engine === 'touchlines' ? { touchlines_engine_id: (side === 'home' ? 1 : 201) + slot } : {}),
    ...(engine === 'open-football' ? { native_ids: [String((side === 'home' ? 100 : 200) + slot)] } : {}),
  })));
  const config: Record<string, unknown> = { home_key: 'chelsea:2015', away_key: 'swansea:2015', home_formation: '4-4-2', away_formation: '4-4-2', seed: 42 };
  if (engine !== 'open-football') { config.home_players = players.slice(0, 11).map(p => p.source_key); config.away_players = players.slice(11).map(p => p.source_key); }
  const samples = Array.from({ length: 8 }, (_, i) => {
    const period = i < 4 ? 1 : 2;
    const matchMs = engine === 'open-football' ? i * 100 : period === 1 ? Math.min(i, 3) * 100 : 2700000 + (i - 4) * 100;
    const s: Record<string, unknown> = { index: i, engine_step: i, physics_ms: i * 100, match_time_ms: matchMs, score: i >= 2 ? [1, 0] : [0, 0],
      owner_team: i === 1 ? 0 : -1, owner_slot: i === 1 ? 9 : -1, game_mode: 0, home_xy: xy('home', i), away_xy: xy('away', i),
      ball_xyz: [0.01 * i, 0, engine === 'touchlines' ? 0 : i === 1 ? 1.5 : 0.11] };
    if (engine === 'touchlines') Object.assign(s, { tl_match_time_s: matchMs / 1000, tl_match_phase: PHASES[i], tl_ball_state: 'loose' });
    else Object.assign(s, { period, home_active: Array(11).fill(true), away_active: Array(11).fill(true) });
    return s;
  });
  const raw: Raw = { schema_version: 'grf-experimental-1', engine_version: VERSION[engine], synthetic: true, synthetic_notice: `SYNTHETIC: ${engine} fixture`,
    input: { config, dataset_version: 'sha256:fixture', home_name: 'Chelsea 2015/16', away_name: 'Swansea City 2015/16', players },
    native_binary_sha256: 'ab'.repeat(32), observation_interval_ms: 100, metres_per_unit: { x: 54.4, y: 83.6 }, duration_ms: 700, samples,
    trace_hash: `${engine === 'grf' ? '7d' : engine === 'touchlines' ? '76' : '8e'}`.repeat(32) };
  if (engine === 'grf') raw.grf_physical = { goals: [{ sample_index: 2, score: [1, 0], match_time_ms: 200 }] };
  if (engine === 'touchlines') raw.touchlines = { upstream: 'https://github.com/brenosss/touchlines', commit: '5c5c71a8a2fb9a02591445cf9114229a4b218253', licence: 'AGPL-3.0-or-later',
    physical_clock: true, events: [{ tick: 1, type: 'shot', player: 10 }, { tick: 2, type: 'goalScored', team: 'A', scorerId: 10 }] };
  if (engine === 'open-football') raw.open_football = { upstream: 'https://github.com/ZOXEXIVO/open-football', commit: 'bfb2273053aab5825b5f58e9f588211c2d7794cf', licence: 'Apache-2.0',
    goals: [{ match_time_ms: 150, scorer_id: '110', side: 'home' }] };
  return raw;
}

export const bytesOf = (raw: unknown) => new TextEncoder().encode(JSON.stringify(raw));
export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function entryFor(engine: RecordedEngineId, raw: Raw = rawRecording(engine), bytes = bytesOf(raw)): Promise<RecordedReplayEntry> {
  return { id: `${engine}-chelsea-swansea-42`, engine, engine_version: raw.engine_version as string, schema_version: 'grf-experimental-1',
    file: `chelsea-2015_swansea-2015_42/${engine}.json`, encoding: 'identity', bytes: bytes.byteLength, sha256: await sha256(bytes),
    trace_hash: raw.trace_hash as string, seed: 42, synthetic: true, calibration: 'fixture', home_key: 'chelsea:2015', away_key: 'swansea:2015' };
}

// Sidecar `recorded-events-1` (TP202) para la grabación mínima: solo lo que cada motor graba de verdad.
type Ev = { t_ms: number; sample_index: number; kind: string; side: string | null; slot: number | null; native: string; extra?: Record<string, unknown> };
const EVENTS: Record<RecordedEngineId, Ev[]> = {
  grf: [
    { t_ms: 50, sample_index: 0, kind: 'pass', side: 'home', slot: 9, native: 'touch:short_pass', extra: { subtype: 'short_pass' } },
    { t_ms: 100, sample_index: 1, kind: 'shot', side: 'home', slot: 7, native: 'touch:shot', extra: { outcome: null } },
    { t_ms: 200, sample_index: 2, kind: 'goal', side: 'home', slot: 7, native: 'goal:goal', extra: { credited_side: 'home', score: [1, 0] } },
    { t_ms: 250, sample_index: 2, kind: 'kickoff', side: 'away', slot: 9, native: 'decision:kickoff:prepared', extra: { incident_id: 3, awarded_side: 'away' } },
    { t_ms: 300, sample_index: 3, kind: 'foul', side: 'away', slot: 4, native: 'decision:foul:accepted', extra: { stages: ['accepted', 'sanctioned'], incident_id: 4, awarded_side: 'home', victim_side: 'home', victim_slot: 9 } },
    { t_ms: 400, sample_index: 4, kind: 'halftime', side: null, slot: null, native: 'samples.period' },
    { t_ms: 410, sample_index: 4, kind: 'kickoff', side: 'away', slot: 9, native: 'decision:kickoff:prepared', extra: { incident_id: 5, awarded_side: 'away' } },
    { t_ms: 500, sample_index: 5, kind: 'offside', side: 'away', slot: 10, native: 'decision:offside:awarded', extra: { incident_id: 6, awarded_side: 'home' } },
    { t_ms: 600, sample_index: 6, kind: 'corner', side: 'home', slot: 8, native: 'decision:corner:prepared', extra: { incident_id: 7, awarded_side: 'home' } },
    { t_ms: 700, sample_index: 7, kind: 'fulltime', side: null, slot: null, native: 'samples.last' },
  ],
  touchlines: [
    { t_ms: 0, sample_index: 0, kind: 'kickoff', side: 'home', slot: 9, native: 'samples.game_mode=1' },
    { t_ms: 50, sample_index: 0, kind: 'pass', side: 'home', slot: 9, native: 'passAttempted', extra: { to_slot: 10 } },
    { t_ms: 100, sample_index: 1, kind: 'shot', side: 'home', slot: 9, native: 'shot', extra: { xg: 0.2, outcome: 'saved', resolved_t_ms: 150 } },
    { t_ms: 150, sample_index: 1, kind: 'shot_on_target', side: 'home', slot: 9, native: 'shotResolved', extra: { outcome: 'saved' } },
    { t_ms: 150, sample_index: 1, kind: 'save', side: 'away', slot: 0, native: 'shotResolved', extra: { shooter_slot: 9 } },
    { t_ms: 180, sample_index: 1, kind: 'shot', side: 'home', slot: 9, native: 'shot', extra: { xg: 0.4, outcome: 'goal', resolved_t_ms: 200 } },
    { t_ms: 200, sample_index: 2, kind: 'goal', side: 'home', slot: 9, native: 'goalScored', extra: { assist_slot: null } },
    { t_ms: 300, sample_index: 3, kind: 'shot', side: 'away', slot: 10, native: 'shot', extra: { xg: 0.1, outcome: 'off_target', resolved_t_ms: 350 } },
    { t_ms: 400, sample_index: 4, kind: 'halftime', side: null, slot: null, native: 'samples.period' },
    { t_ms: 500, sample_index: 5, kind: 'offside', side: 'home', slot: 10, native: 'offsideCalled' },
    { t_ms: 500, sample_index: 5, kind: 'free_kick', side: 'away', slot: 0, native: 'samples.game_mode=3', extra: { reason: 'offside' } },
    { t_ms: 600, sample_index: 6, kind: 'possession_change', side: 'away', slot: 5, native: 'tackle' },
    { t_ms: 700, sample_index: 7, kind: 'fulltime', side: null, slot: null, native: 'samples.last' },
  ],
  'open-football': [
    { t_ms: 10, sample_index: 0, kind: 'kickoff', side: 'home', slot: 10, native: 'player:PassTo' },
    { t_ms: 10, sample_index: 0, kind: 'pass', side: 'home', slot: 10, native: 'player:PassTo', extra: { to_slot: 9, reason: 'KICK_OFF' } },
    { t_ms: 120, sample_index: 1, kind: 'shot', side: 'home', slot: 10, native: 'player:Shoot', extra: { shot_type: 'LongShot', outcome: null } },
    { t_ms: 300, sample_index: 3, kind: 'foul', side: 'away', slot: 7, native: 'player:CommitFoul', extra: { severity: 'Normal', source: 'Holding' } },
    { t_ms: 400, sample_index: 4, kind: 'halftime', side: null, slot: null, native: 'samples.period' },
    { t_ms: 410, sample_index: 4, kind: 'kickoff', side: 'away', slot: 9, native: 'player:PassTo' },
    { t_ms: 500, sample_index: 5, kind: 'offside', side: 'away', slot: 10, native: 'player:Offside' },
    { t_ms: 600, sample_index: 6, kind: 'possession_change', side: 'home', slot: 4, native: 'ball:Intercepted' },
    { t_ms: 700, sample_index: 7, kind: 'fulltime', side: null, slot: null, native: 'samples.last' },
  ],
};

export function rawEvents(engine: RecordedEngineId, raw: Raw = rawRecording(engine)): Record<string, unknown> & { events: Record<string, unknown>[] } {
  const players = (raw.input as { players: { id: string; side: string; slot: number }[] }).players;
  const events = EVENTS[engine].map(e => {
    const s = raw.samples[e.sample_index], p = players.find(q => q.side === e.side && q.slot === e.slot);
    const xy = e.side && e.slot !== null ? (s[`${e.side}_xy`] as number[][])[e.slot] : (s.ball_xyz as number[]);
    return { t_ms: e.t_ms, sample_index: e.sample_index, period: e.sample_index < 4 ? 1 : 2, match_ms: s.match_time_ms, kind: e.kind, side: e.side,
      slot: e.slot, player_id: p?.id ?? null, x: xy[0], y: xy[1], native: e.native, ...(e.extra ? { extra: e.extra } : {}) };
  });
  return { schema: 'recorded-events-1', engine, engine_version: raw.engine_version, synthetic: true, notice: 'SIMULATED: fixture',
    recording: { id: `${engine}-chelsea-swansea-42`, file: `chelsea-2015_swansea-2015_42/${engine}.json`, sha256: 'cd'.repeat(32), trace_hash: raw.trace_hash, seed: 42 },
    time_basis: 'fixture', xy_basis: 'fixture', sources: [], counts: {}, not_exported: { 'touch:trap': 3 }, events };
}
/** Entrada del índice con su sidecar; `mutate` altera el sidecar antes de calcular bytes y hash. */
export async function eventsEntryFor(engine: RecordedEngineId, mutate: (events: ReturnType<typeof rawEvents>) => void = () => {}) {
  const entry = await entryFor(engine), events = rawEvents(engine);
  (events.recording as Record<string, unknown>).sha256 = entry.sha256;
  mutate(events);
  const bytes = bytesOf(events);
  return { events, bytes, entry: { ...entry, events: { file: entry.file.replace(/\.json$/, '.events.json'), encoding: 'identity' as const,
    bytes: bytes.byteLength, sha256: await sha256(bytes), schema: 'recorded-events-1' as const } } };
}
