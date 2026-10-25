import type { SessionPeriod } from './session';

/** Destinos de «evento anterior/siguiente» entre las marcas de la barra (por su instante de salto). */
export function transportTargets(marks: readonly { seekMs: number }[], currentMs: number): { previous: number | null; next: number | null } {
  let previous: number | null = null, next: number | null = null;
  for (const { seekMs } of marks) {
    // Margen: si acabamos de saltar a una marca, «anterior» va a la de antes y no se queda en la misma.
    if (seekMs < currentMs - 1000 && (previous === null || seekMs > previous)) previous = seekMs;
    if (seekMs > currentMs + 500 && (next === null || seekMs < next)) next = seekMs;
  }
  return { previous, next };
}

/** Salto de ±10 s acotado a la duración conocida; sin duración no hay salto. */
export function stepTarget(currentMs: number, deltaMs: number, durationMs: number | null): number | null {
  return durationMs === null ? null : Math.max(0, Math.min(durationMs, currentMs + deltaMs));
}

/** Descanso = inicio registrado de la segunda parte; si la fuente no lo trae, no se dibuja. */
export function halftimeMs(periods: readonly SessionPeriod[], durationMs: number | null): number | null {
  const second = periods.find(p => p.period === 2)?.startMs ?? null;
  return durationMs !== null && second !== null && second > 0 && second < durationMs ? second : null;
}
