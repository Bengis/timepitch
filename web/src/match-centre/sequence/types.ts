import type { SceneFrame } from '../../match/retroScene';
import type { SessionIdentity, SessionSnapshot } from '../session';
import type { SequenceDepiction } from './depiction';
import type { PerformanceEvidence } from './performance-evidence';

export type Point = Readonly<{ x: number; y: number }>;
export type SequenceRequest = Readonly<{ id: 'ayew-equaliser-1'; period: 1; fromMs: 1684024; toMs: 1697850 }>;
export type SequenceEvent = Readonly<{
  id: string; refs: readonly string[]; sourceIndex: number; period: number; periodMs: number; elapsedMs: number;
  kind: string; actorId: string | null; side: 'home' | 'away' | null; recipientId: string | null;
  relatedIds: readonly string[]; assistedShotId: string | null; possessionId: number | null;
  durationMs: number | null; start: Point | null; end: Point | null; outcome: string | null;
  bodyPart: 'head' | 'left_foot' | 'right_foot' | null; xg: number | null;
}>;
export type SequenceSource = Readonly<{
  key: string; identity: SessionIdentity; motionRevision: string; rawDigest: string; request: SequenceRequest;
  events: readonly SequenceEvent[]; frames: readonly SceneFrame[]; cuts: NonNullable<SessionSnapshot['layers']>['cuts'];
  performanceEvidence?: PerformanceEvidence;
}>;
export type PlayMoment = Readonly<{
  id: string; atMs: number; evidenceIds: readonly string[]; actorIds: readonly string[];
  title: string; explanation: string; shotXg: number | null;
}>;
export type PlaybackPolicy = Readonly<{
  id: 'ayew-equaliser-1' | 'halftime-check-1' | 'match-highlights-1'; fromMs: number; toMs: number; speeds: readonly number[];
  pauseAt: readonly Readonly<{ atMs: number; endingPeriod: number }>[];
  /** Optional source windows: play footage at 1× and cut the gaps. */
  windows?: readonly Readonly<{fromMs:number;toMs:number}>[];
}>;
export type PlaybackStop = { kind: 'clip-end'; atMs: number } | { kind: 'halftime'; atMs: number; endingPeriod: number };
export type ClockView = Readonly<{ state: 'playing' | 'halftime' | 'fulltime' | 'unavailable'; period: number; text: string }>;
export type SequencePresentation = Readonly<
  {kind:'actions';source:SequenceSource;depiction:SequenceDepiction;policy:PlaybackPolicy}
  | {kind:'boundary-check';policy:PlaybackPolicy}
>;
