// Sidecar de acontecimientos grabados por cada motor (`recorded-events-1`, TP202). Lo genera
// `scripts/export_recorded_events.py` sin volver a ejecutar motores: solo traduce lo que el motor registró
// (eventos nativos o estado de las muestras) y deja fuera, contado, todo lo demás. Opcional: sin sidecar, la
// sesión grabada se comporta como antes (gol, descanso y final).
import { readVerified } from './recorded-bytes';
import type { RecordedReplayEntry } from './recorded-replay';
import { arr, fail, num, obj, str, type RecordedEngineId, type RecordedTrack, type Side } from './recorded-track';

export const RECORDED_EVENTS_SCHEMA = 'recorded-events-1';
export const RECORDED_EVENT_KINDS = ['kickoff', 'pass', 'shot', 'shot_on_target', 'save', 'goal', 'own_goal', 'foul', 'card_yellow', 'card_red',
  'offside', 'corner', 'free_kick', 'throw_in', 'penalty', 'substitution', 'possession_change', 'halftime', 'fulltime'] as const;
export type RecordedEventKind = typeof RECORDED_EVENT_KINDS[number];

export type RecordedEvent = Readonly<{
  /** Tiempo transcurrido de la grabación (muestra i = i·100 ms). */
  tMs: number; sampleIndex: number; period: number; matchMs: number; kind: RecordedEventKind;
  side: Side | null; slot: number | null; playerId: string | null;
  /** Espacio normalizado de la grabación (ver `xy_basis` del sidecar). */
  x: number; y: number;
  /** Nombre del registro nativo del que sale (p. ej. `player:CommitFoul`, `decision:foul:accepted`, `samples.game_mode=5`). */
  native: string; extra: Readonly<Record<string, unknown>>;
}>;
export type RecordedEvents = Readonly<{
  engine: RecordedEngineId; traceHash: string; recordingSha256: string; notice: string;
  counts: Readonly<Record<string, number>>; notExported: Readonly<Record<string, number>>;
  events: readonly RecordedEvent[];
}>;
export type RecordedEventsRef = Readonly<{ file: string; encoding: 'identity' | 'gzip'; bytes: number; sha256: string; schema: typeof RECORDED_EVENTS_SCHEMA }>;

const HEX64 = /^[0-9a-f]{64}$/;
const isKind = (v: unknown): v is RecordedEventKind => typeof v === 'string' && (RECORDED_EVENT_KINDS as readonly string[]).includes(v);
const counts = (v: unknown, what: string): Record<string, number> =>
  Object.fromEntries(Object.entries(v === undefined ? {} : obj(v, what)).map(([k, n]) => [k, num(n, `${what}.${k}`)]));

/** Valida el descriptor `events` de una entrada del índice (llamado desde `parseReplayIndex`). */
export function eventsRef(value: unknown): RecordedEventsRef {
  const e = obj(value, 'events');
  if (e.schema !== RECORDED_EVENTS_SCHEMA) fail('unsupported_schema', `events schema ${String(e.schema)}`);
  const ok = typeof e.file === 'string' && /^[\w./-]+$/.test(e.file) && !e.file.includes('..') && !e.file.startsWith('/')
    && (e.encoding === 'identity' || e.encoding === 'gzip') && Number.isInteger(e.bytes) && (e.bytes as number) > 0
    && typeof e.sha256 === 'string' && HEX64.test(e.sha256);
  if (!ok) fail('invalid_recording', 'events descriptor is malformed');
  return e as unknown as RecordedEventsRef;
}

/** Comprueba que el sidecar es de la grabación indexada (motor, `trace_hash`, SHA-256 servido) y lo normaliza. */
export function parseRecordedEvents(raw: unknown, entry: RecordedReplayEntry): RecordedEvents {
  const r = obj(raw, 'events sidecar');
  if (r.schema !== RECORDED_EVENTS_SCHEMA) fail('unsupported_schema', `events schema ${String(r.schema)} is not ${RECORDED_EVENTS_SCHEMA}`);
  if (r.synthetic !== true) fail('not_synthetic', 'events sidecar must declare synthetic: true');
  const rec = obj(r.recording, 'events.recording');
  if (r.engine !== entry.engine || r.engine_version !== entry.engine_version) fail('identity_mismatch', `events of ${String(r.engine)} ${String(r.engine_version)}, recording is ${entry.engine} ${entry.engine_version}`);
  if (rec.trace_hash !== entry.trace_hash || rec.sha256 !== entry.sha256) fail('identity_mismatch', 'events sidecar belongs to another recording');
  let last = -Infinity;
  const events = arr(r.events, 'events.events').map((value, i): RecordedEvent => {
    const e = obj(value, `events[${i}]`), what = `events[${i}]`;
    const tMs = num(e.t_ms, `${what}.t_ms`), sampleIndex = num(e.sample_index, `${what}.sample_index`);
    if (tMs < 0 || tMs < last || !Number.isInteger(sampleIndex) || sampleIndex < 0) fail('invalid_recording', `${what} time or sample out of order`);
    last = tMs;
    if (!isKind(e.kind)) fail('invalid_recording', `${what}.kind ${String(e.kind)} is not a recorded-events-1 kind`);
    const side = e.side === null ? null : e.side === 'home' || e.side === 'away' ? e.side : fail('invalid_recording', `${what}.side ${String(e.side)}`);
    const slot = e.slot === null || e.slot === undefined ? null : num(e.slot, `${what}.slot`);
    if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot > 10 || side === null)) fail('invalid_recording', `${what}.slot out of range`);
    const playerId = e.player_id === null || e.player_id === undefined ? null : str(e.player_id, `${what}.player_id`);
    return { tMs, sampleIndex, period: num(e.period, `${what}.period`), matchMs: num(e.match_ms, `${what}.match_ms`), kind: e.kind as RecordedEventKind,
      side, slot, playerId, x: num(e.x, `${what}.x`), y: num(e.y, `${what}.y`), native: str(e.native, `${what}.native`),
      extra: e.extra === undefined ? {} : obj(e.extra, `${what}.extra`) };
  });
  return { engine: entry.engine, traceHash: entry.trace_hash, recordingSha256: entry.sha256, notice: str(r.notice, 'events.notice'),
    counts: counts(r.counts, 'events.counts'), notExported: counts(r.not_exported, 'events.not_exported'), events };
}

/** El sidecar cuenta muestras y tiempo desde la muestra 0 del export; la pista puede empezar después (TP212,
 *  `leadingSamples`). Lo anterior al inicio de la pista se presenta en su primera muestra. */
export function alignRecordedEvent(e: RecordedEvent, track: Pick<RecordedTrack, 'leadingSamples' | 'intervalMs'>): RecordedEvent {
  if (!track.leadingSamples) return e;
  return { ...e, sampleIndex: Math.max(0, e.sampleIndex - track.leadingSamples), tMs: Math.max(0, e.tMs - track.leadingSamples * track.intervalMs) };
}

/** `null` si la entrada no trae sidecar (no se lee nada). Verifica tamaño y SHA-256 igual que la grabación. */
export async function loadRecordedEvents(e: RecordedReplayEntry, read: (file: string, signal: AbortSignal) => Promise<ArrayBuffer>, signal: AbortSignal): Promise<RecordedEvents | null> {
  if (!e.events) return null;
  return parseRecordedEvents(await readVerified(e.events, read, signal), e);
}
