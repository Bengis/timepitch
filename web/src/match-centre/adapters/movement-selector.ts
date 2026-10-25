// Modelo del selector «Movimiento: GRF / TouchLines / open-football» (TP193, G18). Independiente del selector de
// gráficos: cambia solo la grabación que mueve a los jugadores; partido y punto de reproducción se conservan.
// El control en pantalla lo monta G17.
import type { RecordedReplayEntry, RecordedReplayIndex } from './recorded-replay';
import { RECORDED_ENGINE_IDS, type RecordedEngineId, type RecordedTrack, type RecordingErrorCode } from './recorded-track';

export type MovementMatch = Readonly<{ home_key: string; away_key: string; seed: number }>;
export type MovementOption = Readonly<{
  engine: RecordedEngineId; label: string; status: 'available' | 'unavailable';
  reason: 'no_recording' | RecordingErrorCode | null; entry: RecordedReplayEntry | null;
}>;
/** Punto de reproducción independiente del motor: parte y tiempo de reloj dentro de ella. */
export type Playhead = Readonly<{ period: number; periodMs: number }>;
export type MovementState = Readonly<{ match: MovementMatch; engine: RecordedEngineId | null; playhead: Playhead | null }>;

export const ENGINE_LABELS: Readonly<Record<RecordedEngineId, string>> = { grf: 'GRF', touchlines: 'TouchLines', 'open-football': 'open-football' };
const TEXT = {
  es: { title: 'Movimiento', unavailable: 'no disponible', synthetic: 'Movimiento sintético' },
  en: { title: 'Movement', unavailable: 'not available', synthetic: 'Synthetic movement' },
} as const;
export const movementText = (language: 'es' | 'en') => TEXT[language];

const sameMatch = (e: { home_key: string; away_key: string; seed: number }, m: MovementMatch) =>
  e.home_key === m.home_key && e.away_key === m.away_key && e.seed === m.seed;

/** Una opción por motor, siempre en el mismo orden; sin grabación válida para el partido, «no disponible» con su motivo. */
export function movementOptions(index: RecordedReplayIndex | null, match: MovementMatch): MovementOption[] {
  return RECORDED_ENGINE_IDS.map(engine => {
    const entry = index?.recordings.find(e => e.engine === engine && sameMatch(e, match)) ?? null;
    if (entry) return { engine, label: ENGINE_LABELS[engine], status: 'available', reason: null, entry };
    const rejected = index?.rejected.find(r => r.engine === engine);
    return { engine, label: ENGINE_LABELS[engine], status: 'unavailable', reason: rejected?.code ?? 'no_recording', entry: null };
  });
}

/** Cambiar a un motor no disponible no cambia nada y lo dice; el partido y el punto de reproducción se mantienen. */
export function selectMovement(state: MovementState, options: readonly MovementOption[], engine: RecordedEngineId): { state: MovementState; notice: 'unavailable' | null } {
  const option = options.find(o => o.engine === engine);
  if (!option || option.status !== 'available') return { state, notice: 'unavailable' };
  return { state: engine === state.engine ? state : { ...state, engine }, notice: null };
}

const indexAt = (track: RecordedTrack, elapsedMs: number) => Math.max(0, Math.min(track.sampleCount - 1, Math.floor(elapsedMs / track.intervalMs)));

export function playheadAt(track: RecordedTrack, elapsedMs: number): Playhead {
  const s = track.sample(indexAt(track, elapsedMs)), start = track.periodStarts.find(p => p.period === s.period)!;
  return { period: s.period, periodMs: s.matchMs - track.sample(start.index).matchMs };
}

/** Primer instante de `track` con el mismo reloj dentro de la parte; si la parte es más corta, su final. */
export function elapsedForPlayhead(track: RecordedTrack, playhead: Playhead): number {
  const k = track.periodStarts.findIndex(p => p.period === playhead.period);
  if (k < 0) return playhead.period < track.periodStarts[0].period ? 0 : track.durationMs;
  const first = track.periodStarts[k].index, last = (track.periodStarts[k + 1]?.index ?? track.sampleCount) - 1;
  const target = track.sample(first).matchMs + Math.max(0, playhead.periodMs);
  let lo = first, hi = last;
  if (track.sample(last).matchMs < target) return last * track.intervalMs;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (track.sample(mid).matchMs >= target) hi = mid; else lo = mid + 1; }
  return lo * track.intervalMs;
}
