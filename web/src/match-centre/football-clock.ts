import { cursorAt, type SessionSnapshot } from './session';
import type { ClockView, PlaybackStop } from './sequence/types';

const mmss = (ms: number) => `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
export function clockFor(s: SessionSnapshot, stop: PlaybackStop|null, locale: 'en'|'es'): ClockView {
  const cursor = s.presentedCursor;
  const unavailable: ClockView = {state:'unavailable',period:cursor.period,text:locale === 'es' ? 'Reloj no disponible' : 'Clock unavailable'};
  if (s.clockMs === null || !Number.isFinite(s.clockMs) || s.clockMs < 0 || cursor.period <= 0) return unavailable;
  if (stop?.kind === 'halftime') {
    const end = cursorAt(s.descriptor,stop.atMs,stop.endingPeriod);
    if (!end.period || end.period !== cursor.period || cursor.elapsedMs !== stop.atMs) return unavailable;
    return {state:'halftime',period:end.period,text:locale === 'es' ? 'Descanso' : 'Half-time'};
  }
  const full = s.descriptor.durationMs !== null && cursor.elapsedMs === s.descriptor.durationMs;
  if (s.descriptor.identity.source !== 'historical') return {state:full ? 'fulltime' : 'playing',period:cursor.period,text:mmss(s.clockMs)};
  if (s.descriptor.metadata?.clockBasis !== 'source_period_local' || ![1,2].includes(cursor.period)
    || cursorAt(s.descriptor,cursor.elapsedMs,cursor.period === 1 && s.descriptor.periods[0]?.durationMs === cursor.periodMs ? 1 : undefined).period !== cursor.period) return unavailable;
  const base = cursor.period === 1 ? 0 : 45;
  const text = s.clockMs >= 2700000 ? `${base+45}+${mmss(s.clockMs-2700000)}` : mmss(base*60000+s.clockMs);
  return {state:full ? 'fulltime' : 'playing',period:cursor.period,text};
}
