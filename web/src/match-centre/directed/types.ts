import type { PerformanceEvidence } from '../sequence/performance-evidence';
import type { PresentationAlias } from '../sequence/constraints';
import type { Point, SequenceEvent, SequenceSource } from '../sequence/types';

export type DirectedBackend = 'grf' | 'touchlines';
export type DirectedIssue = Readonly<{ code: string; refs: readonly string[] }>;
export type Unavailable = Readonly<{ status: 'unavailable'; issues: readonly DirectedIssue[] }>;
export type DirectedIdentity = Readonly<{
  sourceId: number; playerKey: string; teamKey: string; engineId: string; side: 'home' | 'away';
  activeIntervals: readonly Readonly<{ period: number; fromMs: number; toMs: number }>[];
}>;
export type DirectedCapabilityRow = Readonly<{
  id: string; state: 'source_inspected' | 'requires_extension' | 'unsupported' | 'unknown';
  finding: string; requiredChange: string | null;
  evidence: readonly Readonly<{ file: string; sha256: string; lines: readonly [number, number]; symbol: string }>[];
}>;
export type DirectedCapabilityReport = Readonly<{
  version: 'directed-engine-capabilities-1'; sourceDigest: string; evidenceDigest: string;
  inventory: Readonly<Record<string, Readonly<{ sha256: string } & Record<string, unknown>>>>;
  engines: readonly Readonly<{
    backend: DirectedBackend; revision: string; executionAvailable: false; measured: false;
    capabilities: readonly DirectedCapabilityRow[];
  }>[];
}>;
/** Caller supplies retained aliases; this layer never runs the constraint compiler. */
export type DirectedSource = SequenceSource & Readonly<{ aliases: readonly PresentationAlias[] }>;
export type DirectedPolicy = Readonly<{
  version: 'directed-physical-1'; playerSpeedMps: 9; playerAccelerationMps2: 4;
  ballGroundSpeedMps: 45; contactM: 0.08; stanceM: 0.03; rootClearanceM: 0.5;
}>;
export type DirectedRequestPayload = Readonly<{
  version: 'directed-request-1'; backend: DirectedBackend; backendRevision: string; executionAvailable: false;
  sourceKey: string; sourceDigest: string; evidenceDigest: string;
  sourceIdentity: SequenceSource['identity']; motionRevision: string; clip: SequenceSource['request'];
  events: readonly SequenceEvent[]; evidence: PerformanceEvidence; roster: readonly DirectedIdentity[];
  aliases: readonly PresentationAlias[]; cuts: SequenceSource['cuts']; policy: DirectedPolicy; capabilities: DirectedCapabilityReport;
  boundaryIssues: readonly DirectedIssue[];
}>;
export type DirectedRequest = DirectedRequestPayload & Readonly<{ requestDigest: string }>;
export type DirectedRequestResult = Readonly<{ status: 'request_ready'; request: DirectedRequest }> | Unavailable;

export type OptionalMotionValue<T> = Readonly<{
  value: T | null; provenance: 'engine_output' | 'view_inferred' | 'unavailable'; reason: string | null;
}>;
export type DirectedPlayerSample = Readonly<{
  playerKey: string; engineId: string; active: true; position: Point;
  velocity: OptionalMotionValue<Point>; direction: OptionalMotionValue<number>;
  pose: OptionalMotionValue<Readonly<Record<string, number>>>;
}>;
export type DirectedSample = Readonly<{
  period: number; sourceMs: number; physicalMs: number;
  players: readonly DirectedPlayerSample[];
  ball: Readonly<{ position: Point; height: OptionalMotionValue<number>; ownerId: string | null }>;
}>;
export type DirectedCandidate = Readonly<{
  version: 'directed-candidate-1'; requestDigest: string; backend: DirectedBackend;
  backendRevision: string; directorRevision: string; provenance: 'synthetic_motion';
  units: 'metres'; clock: Readonly<{ basis: 'physical_source_offset'; sourceStartMs: number; physicalStartMs: number; rate: 1 }>;
  receipt: Readonly<{ id: string; sha256: string }>;
  samples: readonly DirectedSample[];
  eventResults: readonly Readonly<{ eventId: string; actorId: string | null; recipientId: string | null; outcome: string | null; sourceMs: number }>[];
  checks: Readonly<Record<'root' | 'node' | 'body', Readonly<{ status: 'not_run' | 'blocked' | 'passed' | 'failed'; reason: string | null }>>>;
}>;
export type DirectedCandidateInspection = Readonly<{
  status: 'structurally_valid'; candidate: DirectedCandidate; acceptance: 'not_assessed';
}> | Unavailable;
