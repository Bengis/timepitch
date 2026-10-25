import type { SceneFrame } from '../match/retroScene';
import type { MotionInterval } from './session';

// Altura del balón solo si ambos extremos la graban (GRF, open-football); si falta en uno, no se interpola ni se inventa.
function height(a: object, b: object, lerp: (a: number, b: number) => number): { z?: number } {
  const za = (a as { z?: unknown }).z, zb = (b as { z?: unknown }).z;
  return typeof za === 'number' && Number.isFinite(za) && typeof zb === 'number' && Number.isFinite(zb) ? { z: lerp(za, zb) } : {};
}

export function sampleInterval(interval: MotionInterval, timeMs: number): SceneFrame {
  const { before, after, fromMs, toMs } = interval;
  const domain=interval.interpolation??{fromMs,toMs};
  const valid = Number.isFinite(domain.fromMs) && Number.isFinite(domain.toMs) && domain.toMs > domain.fromMs;
  const time = Number.isFinite(timeMs) ? timeMs : fromMs;
  const ratio = valid ? Math.max(0, Math.min(1, (time - domain.fromMs) / (domain.toMs - domain.fromMs))) : 0;
  const continuous = valid && after !== null && before.period === after.period;
  const next = new Map(after?.players.map(player => [player.key, player]) ?? []);
  const counts = (players: SceneFrame['players']) => {
    const result = new Map<string, number>();
    for (const player of players) result.set(player.key, (result.get(player.key) ?? 0) + 1);
    return result;
  };
  const beforeCounts = counts(before.players), afterCounts = counts(after?.players ?? []);
  const lerp = (a: number, b: number) => a + (b - a) * ratio;
  return {
    ...before, clock_ms: time,
    score: before.score ? { ...before.score } : null,
    players: before.players.map(player => {
      const end = next.get(player.key);
      return continuous && interval.continuousPlayers.has(player.key) && end && end.side === player.side
        && beforeCounts.get(player.key) === 1 && afterCounts.get(player.key) === 1
        ? { ...player, x: lerp(player.x, end.x), y: lerp(player.y, end.y) } : { ...player };
    }),
    ball: before.ball === null ? null
      : continuous && interval.continuousBall
        ? after.ball === null ? null : { x: lerp(before.ball.x, after.ball.x), y: lerp(before.ball.y, after.ball.y), ...height(before.ball, after.ball, lerp) }
        : { ...before.ball },
  };
}
