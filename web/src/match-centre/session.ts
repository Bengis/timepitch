import type { SceneFrame, VisualCue } from '../match/retroScene';
import type { ProvenanceKind } from '../historical/api';
import type { SequenceRequest, SequenceSource } from './sequence/types';
export type ViewProvenance = ProvenanceKind | 'simulated' | 'estimated' | 'native_observed';
export type SessionDemand = { playback: 'playing' | 'paused'; explicitSeek?: boolean; endingPeriod?: number };

/** `recorded`: partido grabado de un motor (GRF, TouchLines u open-football), servido como estático; el motor real
 *  va en `descriptor.metadata.engine` (TP193/G17). */
export type MatchSource = 'historical' | 'grf' | 'timepitch' | 'recorded';
export type MatchSection = 'match' | 'summary' | 'players' | 'maps' | 'effort' | 'data';
export type SessionIdentity = { readonly source: MatchSource; readonly id: string; readonly revision: string };
export type MatchCursor = { elapsedMs: number; period: number; periodMs: number };
export type Availability = { status: 'available' | 'partial' | 'unavailable'; reason: string | null };
export type SessionPeriod = { period: number; startMs: number | null; durationMs: number | null };
export type MotionInterval = {
  fromMs: number; toMs: number; before: SceneFrame; after: SceneFrame | null;
  continuousPlayers: ReadonlySet<string>; continuousBall: boolean;
  // Fact/visibility boundaries can split an interval without moving its raw endpoints.
  interpolation?: { fromMs:number; toMs:number };
};
export type EventView = {
  id: string; sourceIndex: number; kind: string; period: number; periodMs: number;
  elapsedMs: number | null; side: 'home' | 'away' | null; actorId: string | null;
  participantIds: readonly string[]; outcome: string | null; provenance: ViewProvenance;
  refs: readonly string[]; details: Readonly<Record<string, unknown>>;
};
export type MetricView = {
  id: string; definition: string; value: number | null; unit: string;
  provenance: ViewProvenance; availability: Availability; evidenceIds: readonly string[];
  subject?: { kind: 'team' | 'player' | 'match'; id: string };
  details?: Readonly<Record<string, unknown>>;
};
export type SampleView = {
  frame: SceneFrame; previous: SceneFrame; cue: VisualCue | undefined;
  restarting: boolean; clockMs: number | null; cursor: MatchCursor;
};
export type SessionTeam = { id: string; name: string; crestUrl: string | null; season?: string; formation?: string };
export type SessionDescriptor = {
  identity: SessionIdentity; home: SessionTeam; away: SessionTeam;
  periods: readonly SessionPeriod[]; durationMs: number | null;
  export: { href: string | null; availability: Availability };
  metadata?: Readonly<Record<string, unknown>>;
  capabilities: {
    sections: readonly MatchSection[]; playerDetails: boolean; events: boolean;
    layers: readonly string[];
  };
};
export type TableCell = string | number | boolean | null;
export type PlotScope = { scope?: Readonly<Record<string, TableCell>> };
export type PlotView = {
  id: string; kind: string; coordinateMeaning: string; definition: string;
  provenance: ViewProvenance; availability: Availability;
  details?: Readonly<Record<string, unknown>>;
  nodeLayout?: 'schematic'|'positions';
  points?: readonly (PlotScope & { id: string; x: number; y: number; value: number | null; refs: readonly string[] })[];
  edges?: readonly (PlotScope & { from: string; to: string; value: number | null })[];
  cells?: readonly (PlotScope & { x: number; y: number; width: number; height: number; value: number | null })[];
  series?: readonly { id: string; values: readonly (PlotScope & { elapsedMs: number; value: number | null })[] }[];
  columns: readonly string[]; rows: readonly Readonly<Record<string, TableCell>>[];
};
export type ProvenancedValue<T> = { value: T | null; provenance: ViewProvenance; refs: readonly string[] };
export type PlayerView = {
  id: string; sourceRefs: readonly string[]; name: string | null; side: 'home' | 'away' | null;
  role: ProvenancedValue<string>; jersey: ProvenancedValue<string>;
  intervals: ProvenancedValue<readonly { fromMs: number | null; toMs: number | null }[]>;
  estimatedAttributes: readonly MetricView[]; metrics: readonly MetricView[]; availability: Availability;
  details?: Readonly<Record<string, unknown>>;
  finalDetails?: Readonly<Record<string, unknown>>;
};
export type PanelData = {
  availability: Availability; scope: 'cursor' | 'final'; cutoff: MatchCursor | null;
  metrics: readonly MetricView[]; players: readonly PlayerView[]; playerDetails: readonly PlayerView[];
  plots: readonly PlotView[];
  actions?: readonly EventView[];
  standouts: readonly { id: string; playerIds: readonly string[]; criterion: string; evidenceIds: readonly string[]; availability: Availability }[];
  definitions: readonly { id: string; text: string; provenance: ViewProvenance; availability: Availability; details?: Readonly<Record<string, unknown>> }[];
  sourceDetails: readonly { id: string; value: TableCell; provenance: ViewProvenance; refs: readonly string[]; availability: Availability; details?: Readonly<Record<string, unknown>> }[];
  finalDetails?: Readonly<Record<string, unknown>>;
};
export type LoadState = 'ready' | 'buffering' | 'facts_only' | 'unavailable';
export type SessionSnapshot = {
  descriptor: SessionDescriptor; requestedCursor: MatchCursor; presentedCursor: MatchCursor;
  // Source facts remain usable even when there is no motion interval (facts_only).
  facts: {
    score: ProvenancedValue<{ home: number; away: number }>;
    possession: ProvenancedValue<'home' | 'away'>; carrierId: ProvenancedValue<string>;
  };
  interval: MotionInterval | null; previousInterval: MotionInterval | null;
  cue: VisualCue | undefined; clockMs: number | null; events: readonly EventView[];
  // Cumulative reducer milestones are separate from the bounded raw event window.
  milestones?: readonly (Omit<EventView,'sourceIndex'> & {sourceIndex:number|null})[];
  // TP238: touches (passes, possession changes) a recorded replay keeps out of `events` so the event list stays short.
  // Only the anime scenes read them, to deduce shot outcomes and balls won where the engine records neither.
  touches?: readonly EventView[];
  observations?: {availability:Availability;provenance:ViewProvenance;values:Readonly<Record<string,TableCell>>};
  panels: Partial<Record<MatchSection, PanelData>>;
  loadState: LoadState; reason: string | null; horizonMs: number;
  eventWindow?: { period: number; fromMs: number; toMs: number; mode: 'cursor' | 'manual'; availability: Availability };
  layers?: {
    anchors: readonly { id: string; eventId: string; entityId: string | null; elapsedMs: number | null; point: { x: number; y: number } | null; status: string; reason: string | null; refs: readonly string[]; details: Readonly<Record<string, unknown>> }[];
    cuts: readonly { id: string; fromMs: number | null; toMs: number | null; entityIds: 'all' | readonly string[]; reason: string; refs: readonly string[] }[];
  };
};

// Adapters expose source facts and raw intervals, never JSX, clocks or interpolated poses.
export interface MatchSessionAdapter {
  readonly identity: SessionIdentity;
  subscribe(listener: () => void): () => void;
  snapshot(): SessionSnapshot;
  ensure(cursorMs: number, signal: AbortSignal, demand?: SessionDemand): Promise<void>;
  loadPanel(section: MatchSection, cursorMs: number, final: boolean, signal: AbortSignal, demand?: SessionDemand): Promise<void>;
  loadPlayer(playerId: string, signal: AbortSignal): Promise<void>;
  loadEvents(period: number, fromMs: number, toMs: number, signal: AbortSignal): Promise<void>;
  loadSequence?(request: SequenceRequest, signal: AbortSignal): Promise<SequenceSource>;
  dispose(): void;
  retry?(cursorMs: number, signal: AbortSignal): Promise<void>;
}

export function identityKey(identity: SessionIdentity): string {
  return JSON.stringify([identity.source, identity.id, identity.revision]);
}

export function cursorAt(descriptor: SessionDescriptor, elapsedMs: number, endingPeriod?: number): MatchCursor {
  if (endingPeriod !== undefined) {
    const ends = descriptor.periods.filter(p => p.period === endingPeriod && p.startMs !== null && p.durationMs !== null && p.startMs+p.durationMs === elapsedMs);
    return ends.length === 1 ? {elapsedMs,period:endingPeriod,periodMs:ends[0].durationMs!} : {elapsedMs,period:0,periodMs:0};
  }
  // Unknown offsets are not guessed from nominal half lengths.
  const known = descriptor.periods.filter(p => p.startMs !== null && p.startMs <= elapsedMs);
  const period = known.reduce<SessionPeriod | null>((best, p) => !best || p.startMs! >= best.startMs! ? p : best, null);
  return period ? { elapsedMs, period: period.period, periodMs: elapsedMs - period.startMs! }
    : { elapsedMs, period: 0, periodMs: 0 };
}
