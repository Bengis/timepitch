// Contrato común de «movimiento grabado» (TP193, G18): GRF, TouchLines y open-football exportan la misma forma
// `grf-experimental-1`; aquí se valida y se normaliza sin copiar las ~56 000 muestras. El renderizador no ve el motor.

export type RecordedEngineId = 'grf' | 'touchlines' | 'open-football';
export const RECORDED_ENGINE_IDS: readonly RecordedEngineId[] = ['grf', 'touchlines', 'open-football'];
export const RECORDED_SCHEMA = 'grf-experimental-1';

export type RecordingErrorCode = 'unknown_engine' | 'unsupported_version' | 'unsupported_schema' | 'hash_mismatch'
  | 'size_mismatch' | 'identity_mismatch' | 'not_synthetic' | 'invalid_recording' | 'decode_failed' | 'unavailable';
export class RecordingError extends Error {
  constructor(readonly code: RecordingErrorCode, message: string) { super(`${code}: ${message}`); this.name = 'RecordingError'; }
}
export const fail = (code: RecordingErrorCode, message: string): never => { throw new RecordingError(code, message); };

export type Side = 'home' | 'away';
export type XY = readonly [number, number];
export type PlayerRole = 'GK' | 'DEF' | 'MID' | 'FWD';
export type RecordedPlayer = Readonly<{ id: string; side: Side; slot: number; sourceKey: string; name: string; role: PlayerRole; nativeId: string | null }>;
export type RecordedSample = Readonly<{
  matchMs: number; period: number; score: readonly [number, number]; owner: Readonly<{ side: Side; slot: number }> | null;
  mode: number | null; home: readonly XY[]; away: readonly XY[];
  homeActive: readonly boolean[] | null; awayActive: readonly boolean[] | null;
  ball: XY; /** Metros sobre el césped si el motor la graba; `null` si no la tiene (TouchLines). Nunca se inventa. */
  ballZ: number | null;
}>;
export type RecordedGoal = Readonly<{ sampleIndex: number; side: Side; score: readonly [number, number]; scorer: RecordedPlayer | null }>;
export type RecordedTeam = Readonly<{ key: string; name: string; formation: string | null }>;
export type RecordedTrack = Readonly<{
  engine: RecordedEngineId; engineVersion: string; schemaVersion: string; traceHash: string; seed: number;
  synthetic: true; notice: string; datasetVersion: string; nativeBinarySha256: string | null;
  home: RecordedTeam; away: RecordedTeam; players: readonly RecordedPlayer[];
  /** Una muestra cada `intervalMs`; el tiempo transcurrido de la muestra i es i·intervalMs. */
  intervalMs: number; sampleCount: number; durationMs: number;
  /** Muestras iniciales del export descartadas porque el motor aún no había grabado a ningún jugador (TP212:
   *  open-football graba su primer tick a 30 ms y la muestra de 0 ms los marca a todos inactivos). La muestra 0 de
   *  la pista es la primera con jugadores; los tiempos del sidecar se alinean con `alignRecordedEvent`. */
  leadingSamples: number;
  /** Primera muestra de cada parte, en orden. */
  periodStarts: readonly Readonly<{ period: number; index: number }>[];
  /** Espacio normalizado de GRF: x ∈ [-1,1] (portería a portería), y ∈ [-0,42, 0,42]; se dibuja en 105×68 m. */
  units: Readonly<{ space: 'grf-normalised'; metresPerUnit: Readonly<{ x: number; y: number }>; ballHeight: 'metres' | 'absent' }>;
  goals: readonly RecordedGoal[];
  upstream: Readonly<{ url: string; commit: string | null; licence: string }> | null;
  sample(index: number): RecordedSample;
}>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const obj = (v: unknown, what: string): Obj => isObj(v) ? v : fail('invalid_recording', `${what} is not an object`);
export const str = (v: unknown, what: string): string => typeof v === 'string' && v.length > 0 ? v : fail('invalid_recording', `${what} is not a string`);
export const num = (v: unknown, what: string): number => typeof v === 'number' && Number.isFinite(v) ? v : fail('invalid_recording', `${what} is not a finite number`);
export const arr = (v: unknown, what: string): unknown[] => Array.isArray(v) ? v : fail('invalid_recording', `${what} is not an array`);
const ROLES: readonly PlayerRole[] = ['GK', 'DEF', 'MID', 'FWD'];
const optStr = (v: unknown) => typeof v === 'string' && v.length > 0 ? v : null;

/** Lo que cambia entre motores; el resto del contrato es común. */
export type EngineProfile = Readonly<{
  engine: RecordedEngineId;
  versions: readonly string[];
  ballHeight: 'metres' | 'absent';
  /** Parte de la muestra cruda (GRF/open-football la graban; TouchLines la deriva de su fase). */
  period(sample: Obj, index: number): number;
  /** Lista de catálogo por puesto si el export la trae en `input.config`. */
  configPlayers: boolean;
  nativeId(player: Obj): string | null;
  /** Autor de cada gol a partir de los registros nativos del motor; `null` si el motor no lo graba. */
  scorers(raw: Obj, goals: readonly Omit<RecordedGoal, 'scorer'>[], players: readonly RecordedPlayer[]): readonly (RecordedPlayer | null)[];
  upstream(raw: Obj): RecordedTrack['upstream'];
}>;

const xyList = (v: unknown, what: string): void => {
  const list = arr(v, what);
  if (list.length !== 11) fail('invalid_recording', `${what} must hold 11 players`);
  list.forEach((p, i) => { const xy = arr(p, `${what}[${i}]`); num(xy[0], `${what}[${i}].x`); num(xy[1], `${what}[${i}].y`); });
};
const flags = (v: unknown, what: string): void => {
  if (v === undefined) return;
  const list = arr(v, what);
  if (list.length !== 11 || list.some(x => typeof x !== 'boolean')) fail('invalid_recording', `${what} must hold 11 booleans`);
};
const score = (v: unknown, what: string): [number, number] => {
  const s = arr(v, what);
  if (s.length !== 2) fail('invalid_recording', `${what} must be [home, away]`);
  return [num(s[0], `${what}[0]`), num(s[1], `${what}[1]`)];
};

/** Valida la forma común y devuelve la pista normalizada con lectura perezosa de muestras. */
export function normalizeRecording(rawValue: unknown, profile: EngineProfile): RecordedTrack {
  const raw = obj(rawValue, 'recording');
  if (raw.schema_version !== RECORDED_SCHEMA) fail('unsupported_schema', `schema ${String(raw.schema_version)} is not ${RECORDED_SCHEMA}`);
  const engineVersion = str(raw.engine_version, 'engine_version');
  if (!profile.versions.includes(engineVersion)) fail('unsupported_version', `${profile.engine} version ${engineVersion} is not registered`);
  if (raw.synthetic !== true) fail('not_synthetic', 'free-play recordings must declare synthetic: true');
  const input = obj(raw.input, 'input'), config = obj(input.config, 'input.config');
  const intervalMs = num(raw.observation_interval_ms, 'observation_interval_ms');
  if (intervalMs !== 100) fail('invalid_recording', `observation_interval_ms ${intervalMs} is not 100`);
  const mpu = obj(raw.metres_per_unit, 'metres_per_unit');
  let samples = arr(raw.samples, 'samples');
  if (samples.length < 2) fail('invalid_recording', 'a recording needs at least two samples');

  const players: RecordedPlayer[] = arr(input.players, 'input.players').map((p, i) => {
    const o = obj(p, `players[${i}]`), side = o.side === 'home' || o.side === 'away' ? o.side : fail('invalid_recording', `players[${i}].side`);
    const slot = num(o.slot, `players[${i}].slot`);
    if (!Number.isInteger(slot) || slot < 0 || slot > 10) fail('invalid_recording', `players[${i}].slot out of range`);
    return { id: str(o.id, `players[${i}].id`), side, slot, sourceKey: str(o.source_key, `players[${i}].source_key`),
      name: str(o.name, `players[${i}].name`), role: ROLES.includes(o.role as PlayerRole) ? o.role as PlayerRole : fail('invalid_recording', `players[${i}].role ${String(o.role)}`),
      nativeId: profile.nativeId(o) };
  });
  for (const side of ['home', 'away'] as const) {
    const slots = players.filter(p => p.side === side).map(p => p.slot).sort((a, b) => a - b);
    if (slots.join() !== '0,1,2,3,4,5,6,7,8,9,10') fail('invalid_recording', `${side} must have slots 0..10 exactly once`);
    if (profile.configPlayers) {
      const keys = arr(config[`${side}_players`], `config.${side}_players`);
      for (const p of players.filter(q => q.side === side))
        if (keys[p.slot] !== p.sourceKey) fail('identity_mismatch', `${side} slot ${p.slot} catalogue key differs from input.config`);
    }
  }
  if (new Set(players.map(p => p.id)).size !== players.length) fail('invalid_recording', 'player ids must be unique');

  const at = new Map(players.map(p => [`${p.side}:${p.slot}`, p]));
  // Una sola pasada de validación; las muestras se leen después sin copiarlas (≈56 000 × 22 posiciones).
  const allPeriods = new Uint8Array(samples.length);
  let lastPeriod = 0;
  samples.forEach((value, i) => {
    const s = obj(value, `samples[${i}]`);
    if (s.index !== undefined && s.index !== i) fail('invalid_recording', `samples[${i}].index is ${String(s.index)}`);
    const period = profile.period(s, i);
    if (period < lastPeriod) fail('invalid_recording', `samples[${i}] goes back to period ${period}`);
    lastPeriod = period;
    allPeriods[i] = period;
    num(s.match_time_ms, `samples[${i}].match_time_ms`); score(s.score, `samples[${i}].score`);
    num(s.owner_team, `samples[${i}].owner_team`); num(s.owner_slot, `samples[${i}].owner_slot`);
    xyList(s.home_xy, `samples[${i}].home_xy`); xyList(s.away_xy, `samples[${i}].away_xy`);
    flags(s.home_active, `samples[${i}].home_active`); flags(s.away_active, `samples[${i}].away_active`);
    const ball = arr(s.ball_xyz, `samples[${i}].ball_xyz`);
    num(ball[0], `samples[${i}].ball.x`); num(ball[1], `samples[${i}].ball.y`);
    if (profile.ballHeight === 'metres') num(ball[2], `samples[${i}].ball.z`);
  });
  // Sin ningún jugador grabado no hay nada que dibujar salvo el balón: la reproducción empieza en la primera muestra
  // con jugadores. No se inventan posiciones ni se reactivan los marcados inactivos; con alguno activo no se recorta.
  const nobody = (s: Obj) => Array.isArray(s.home_active) && Array.isArray(s.away_active)
    && !(s.home_active as boolean[]).some(Boolean) && !(s.away_active as boolean[]).some(Boolean);
  let leadingSamples = 0;
  while (leadingSamples < samples.length - 2 && nobody(samples[leadingSamples] as Obj)) leadingSamples++;
  if (leadingSamples) samples = samples.slice(leadingSamples);
  const periods = allPeriods.subarray(leadingSamples), periodStarts: { period: number; index: number }[] = [];
  periods.forEach((period, i) => { if (i === 0 || period !== periods[i - 1]) periodStarts.push({ period, index: i }); });
  const read = (index: number): RecordedSample => {
    const i = Math.max(0, Math.min(samples.length - 1, Math.floor(index))), s = samples[i] as Obj, ball = s.ball_xyz as number[];
    const ownerSide: Side | null = s.owner_team === 0 ? 'home' : s.owner_team === 1 ? 'away' : null, ownerSlot = s.owner_slot as number;
    return {
      matchMs: s.match_time_ms as number, period: periods[i], score: s.score as [number, number],
      owner: ownerSide && at.has(`${ownerSide}:${ownerSlot}`) ? { side: ownerSide, slot: ownerSlot } : null,
      mode: typeof s.game_mode === 'number' ? s.game_mode : null,
      home: s.home_xy as XY[], away: s.away_xy as XY[],
      homeActive: (s.home_active as boolean[] | undefined) ?? null, awayActive: (s.away_active as boolean[] | undefined) ?? null,
      ball: [ball[0], ball[1]], ballZ: profile.ballHeight === 'metres' ? Math.max(0, ball[2]) : null,
    };
  };

  const goalsBare: Omit<RecordedGoal, 'scorer'>[] = [];
  for (let i = 1; i < samples.length; i++) {
    const [h0, a0] = (samples[i - 1] as Obj).score as number[], [h1, a1] = (samples[i] as Obj).score as number[];
    if (h1 === h0 && a1 === a0) continue;
    if (h1 < h0 || a1 < a0 || h1 + a1 - h0 - a0 !== 1) fail('invalid_recording', `samples[${i}] score jumps from ${h0}-${a0} to ${h1}-${a1}`);
    goalsBare.push({ sampleIndex: i, side: h1 > h0 ? 'home' : 'away', score: [h1, a1] });
  }
  const scorers = profile.scorers(raw, goalsBare, players);
  const team = (side: Side): RecordedTeam => ({ key: str(config[`${side}_key`], `config.${side}_key`),
    name: str(input[`${side}_name`], `input.${side}_name`), formation: optStr(config[`${side}_formation`]) });

  return {
    engine: profile.engine, engineVersion, schemaVersion: RECORDED_SCHEMA, traceHash: str(raw.trace_hash, 'trace_hash'),
    seed: num(config.seed, 'config.seed'), synthetic: true, notice: str(raw.synthetic_notice, 'synthetic_notice'),
    datasetVersion: str(input.dataset_version, 'input.dataset_version'), nativeBinarySha256: optStr(raw.native_binary_sha256),
    home: team('home'), away: team('away'), players, intervalMs, sampleCount: samples.length, leadingSamples,
    durationMs: (samples.length - 1) * intervalMs, periodStarts,
    units: { space: 'grf-normalised', metresPerUnit: { x: num(mpu.x, 'metres_per_unit.x'), y: num(mpu.y, 'metres_per_unit.y') }, ballHeight: profile.ballHeight },
    goals: goalsBare.map((g, k) => ({ ...g, scorer: scorers[k] ?? null })),
    upstream: profile.upstream(raw),
    sample: read,
  };
}
