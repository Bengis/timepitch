import type { SessionDescriptor } from '../session';
import type { PlaybackPolicy, SequenceRequest } from './types';

export const PILOT_MATCH = '3754078';
export const PILOT_REVISION = 'sha256:ab91d82f3c33e4ee103c9524d787663f50e138ae40caf05f82a5b4163c2d4bfe';
export const AYEW_SEQUENCE: SequenceRequest = Object.freeze({ id: 'ayew-equaliser-1', period: 1, fromMs: 1684024, toMs: 1697850 });
export const AYEW_POLICY: PlaybackPolicy = Object.freeze({ ...AYEW_SEQUENCE, speeds: Object.freeze([.5,1,2]), pauseAt: Object.freeze([]) });

export function validatePilot(d: SessionDescriptor, request: SequenceRequest): void {
  if (d.identity.source !== 'historical' || d.identity.id !== PILOT_MATCH || d.identity.revision !== PILOT_REVISION
    || request.id !== AYEW_SEQUENCE.id || request.period !== 1 || request.fromMs !== AYEW_SEQUENCE.fromMs || request.toMs !== AYEW_SEQUENCE.toMs
    || d.periods.find(p => p.period === 1)?.startMs !== 0 || (d.periods.find(p => p.period === 1)?.durationMs ?? 0) < request.toMs) {
    throw new Error('Sequence source/profile unavailable');
  }
}
export function halftimePolicy(d: SessionDescriptor): PlaybackPolicy {
  validatePilot(d,AYEW_SEQUENCE);
  const first = d.periods.find(p => p.period === 1), second = d.periods.find(p => p.period === 2);
  if (first?.durationMs !== 2880495 || second?.startMs !== first.durationMs || (second?.durationMs ?? 0) < 2000) throw new Error('Recorded boundary unavailable');
  return { id: 'halftime-check-1', fromMs: first.durationMs - 2000, toMs: first.durationMs + 2000,
    speeds: [.5,1,2], pauseAt: [{ atMs: first.durationMs, endingPeriod: 1 }] };
}
