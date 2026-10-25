// Índice y carga de partidos grabados (TP193, G18). Cada grabación queda atada a su motor, versión, semilla,
// `trace_hash` y SHA-256 de los bytes servidos; lo desconocido se rechaza con su motivo, nunca se adivina.
import { readVerified, sha256Hex } from './recorded-bytes';
import { eventsRef, type RecordedEventsRef } from './recorded-events';
import { GRF_PROFILE } from './recorded-grf';
import { OPEN_FOOTBALL_PROFILE } from './open-football';
import { TOUCHLINES_PROFILE } from './touchlines';
import trackedIndex from './recorded-replays.index.json';
import { fail, normalizeRecording, obj, RecordingError, RECORDED_SCHEMA, type EngineProfile, type RecordedEngineId, type RecordedTrack, type RecordingErrorCode } from './recorded-track';

export const RECORDED_INDEX_SCHEMA = 'timepitch-recorded-replays-1';
export const ENGINE_PROFILES: Readonly<Record<RecordedEngineId, EngineProfile>> = {
  grf: GRF_PROFILE, touchlines: TOUCHLINES_PROFILE, 'open-football': OPEN_FOOTBALL_PROFILE,
};
const isEngine = (v: unknown): v is RecordedEngineId => typeof v === 'string' && Object.hasOwn(ENGINE_PROFILES, v);

export type RecordedReplayEntry = Readonly<{
  id: string; engine: RecordedEngineId; engine_version: string; schema_version: typeof RECORDED_SCHEMA;
  /** Ruta relativa a la raíz de grabaciones; la decide el despliegue (ver case TP193). */
  file: string; encoding: 'identity' | 'gzip'; bytes: number;
  /** SHA-256 de los bytes tal como se sirven (comprimidos si `encoding` es gzip). */
  sha256: string;
  /** Identidad del motor: GRF y open-football hashean su grabación nativa; TouchLines, su JSON sin este campo. */
  trace_hash: string; seed: number; synthetic: true; calibration: string; home_key: string; away_key: string;
  /** Sidecar opcional `recorded-events-1` con los acontecimientos que grabó el motor (TP202); sin él, gol/descanso/final. */
  events?: RecordedEventsRef;
}>;
export type RejectedEntry = Readonly<{ id: string; engine: string; code: RecordingErrorCode }>;
export type RecordedReplayIndex = Readonly<{ recordings: readonly RecordedReplayEntry[]; rejected: readonly RejectedEntry[] }>;

const HEX64 = /^[0-9a-f]{64}$/;
function entry(value: unknown): RecordedReplayEntry {
  const e = obj(value, 'index entry');
  if (!isEngine(e.engine)) fail('unknown_engine', `engine ${String(e.engine)} is not supported`);
  const engine = e.engine as RecordedEngineId;
  if (typeof e.engine_version !== 'string' || !ENGINE_PROFILES[engine].versions.includes(e.engine_version))
    fail('unsupported_version', `${engine} version ${String(e.engine_version)} is not registered`);
  if (e.schema_version !== RECORDED_SCHEMA) fail('unsupported_schema', `schema ${String(e.schema_version)}`);
  if (e.synthetic !== true) fail('not_synthetic', 'entry must be synthetic');
  const ok = typeof e.id === 'string' && e.id.length > 0 && typeof e.file === 'string' && /^[\w./-]+$/.test(e.file) && !e.file.includes('..')
    && (e.encoding === 'identity' || e.encoding === 'gzip') && Number.isInteger(e.bytes) && (e.bytes as number) > 0
    && typeof e.sha256 === 'string' && HEX64.test(e.sha256) && typeof e.trace_hash === 'string' && HEX64.test(e.trace_hash)
    && Number.isInteger(e.seed) && typeof e.calibration === 'string' && typeof e.home_key === 'string' && typeof e.away_key === 'string';
  if (!ok) fail('invalid_recording', `index entry ${String(e.id)} is malformed`);
  if (e.events !== undefined) eventsRef(e.events);
  return e as unknown as RecordedReplayEntry;
}

/** Valida el índice; las entradas rechazadas se devuelven con su motivo para mostrarlas como «no disponible». */
export function parseReplayIndex(value: unknown): RecordedReplayIndex {
  const index = obj(value, 'index');
  if (index.schema !== RECORDED_INDEX_SCHEMA) fail('unsupported_schema', `index schema ${String(index.schema)}`);
  if (!Array.isArray(index.recordings)) fail('invalid_recording', 'index.recordings is not an array');
  const recordings: RecordedReplayEntry[] = [], rejected: RejectedEntry[] = [];
  for (const item of index.recordings as unknown[]) {
    try { recordings.push(entry(item)); }
    catch (error) {
      if (!(error instanceof RecordingError)) throw error;
      const raw = (item ?? {}) as Record<string, unknown>;
      rejected.push({ id: String(raw.id ?? '?'), engine: String(raw.engine ?? '?'), code: error.code });
    }
  }
  return { recordings, rejected };
}

export { sha256Hex };

/** Comprueba que el JSON es la grabación indexada y la normaliza con el perfil de su motor. */
export function validateRecording(raw: unknown, e: RecordedReplayEntry): RecordedTrack {
  const r = obj(raw, 'recording');
  if (r.engine_version !== e.engine_version) fail('unsupported_version', `file version ${String(r.engine_version)} is not indexed ${e.engine_version}`);
  const profile = isEngine(e.engine) ? ENGINE_PROFILES[e.engine] : fail('unknown_engine', String(e.engine));
  const track = normalizeRecording(raw, profile);
  if (track.traceHash !== e.trace_hash) fail('identity_mismatch', 'trace_hash differs from the index');
  if (track.seed !== e.seed || track.home.key !== e.home_key || track.away.key !== e.away_key) fail('identity_mismatch', 'seed or teams differ from the index');
  return track;
}
/** Índice versionado (decisión del 22-oct): las `.json.gz` viven fuera de git y se sirven como estáticos. */
export const TRACKED_REPLAY_INDEX: RecordedReplayIndex = parseReplayIndex(trackedIndex);
/** Raíz de las grabaciones servidas; se cambia en el build con `VITE_TIMEPITCH_REPLAYS_BASE`. */
export const DEFAULT_REPLAYS_BASE = '/replays/';
export const replaysBase = (): string => import.meta.env.VITE_TIMEPITCH_REPLAYS_BASE || DEFAULT_REPLAYS_BASE;

/** URL de una grabación: raíz (absoluta o relativa al origen) + ruta relativa del índice, ya validada por `entry`. */
export function replayUrl(file: string, base: string = replaysBase()): string {
  if (!/^[\w./-]+$/.test(file) || file.includes('..') || file.startsWith('/')) fail('invalid_recording', `file ${file} is not a relative index path`);
  return `${base.endsWith('/') ? base : `${base}/`}${file}`;
}

/** Lector HTTP para `loadRecordedReplay`. El servidor debe entregar los bytes `.json.gz` tal cual (sin `Content-Encoding`):
 *  el SHA-256 del índice es el de esos bytes y la descompresión la hace `decode`. */
export function httpReplayReader(base: string = replaysBase(), fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
  return async (file: string, signal: AbortSignal): Promise<ArrayBuffer> => {
    const response = await fetchImpl(replayUrl(file, base), { signal, credentials: 'omit' });
    if (!response.ok) throw new RecordingError('unavailable', `${file}: HTTP ${response.status}`);
    return response.arrayBuffer();
  };
}

/** Lee los bytes, verifica tamaño y SHA-256, decodifica y valida. `read` recibe la ruta relativa del índice. */
export async function loadRecordedReplay(e: RecordedReplayEntry, read: (file: string, signal: AbortSignal) => Promise<ArrayBuffer>, signal: AbortSignal): Promise<RecordedTrack> {
  return validateRecording(await readVerified(e, read, signal), e);
}
