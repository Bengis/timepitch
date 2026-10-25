import type { PerformanceActionEvidence } from '../sequence/performance-evidence';
import type { PresentationAlias } from '../sequence/constraints';
import type { SequenceEvent } from '../sequence/types';
import type { DirectedBackend, DirectedCandidate, DirectedIssue, DirectedRequest, Unavailable } from './types';

export type Vector3 = Readonly<{x:number;y:number;z:number}>;
export type StatePrior<T> = Readonly<{
  value:T|null; provenance:'observed'|'inferred'|'unavailable'; refs:readonly string[]; reason:string|null;
}>;
export type DirectedExecutionProfile = Readonly<{
  version:'directed-profile-1'; backend:DirectedBackend; engineRevision:string; directorRevision:string;
  sourceInventorySha256:string; artifactSha256:string|null; sourceBindingPolicySha256:string;
  seed:number; transformId:string; clock:Readonly<{kind:'fixed_10ms'|'event_subdivision';maxStepMs:number}>;
  availableChannels:readonly ('positions'|'velocity'|'direction'|'height'|'pose'|'contacts'|'body_intervals')[];
  unsupported:readonly DirectedIssue[]; executionMode:'disabled';
}>;
export type DirectedInitialState = Readonly<{
  version:'directed-initial-1'; period:number; sourceMs:number; units:'metres';
  players:readonly Readonly<{playerKey:string;engineId:string;position:StatePrior<Vector3>;velocity:StatePrior<Vector3>;
    phase:StatePrior<string>;energy:StatePrior<number>;memory:StatePrior<Readonly<Record<string,unknown>>>}>[];
  ball:Readonly<{position:StatePrior<Vector3>;velocity:StatePrior<Vector3>;ownerId:StatePrior<string|null>}>;
  phase:StatePrior<string>;caches:StatePrior<Readonly<{revision:string;values:Readonly<Record<string,unknown>>}>>;
}>;
export type DirectedCommand = Readonly<{
  event:SequenceEvent;evidence:PerformanceActionEvidence|null;alias:PresentationAlias|null;
}>;
export type DirectedJob = Readonly<{
  version:'directed-job-1';request:DirectedRequest;requestPayloadUtf8:string;profile:DirectedExecutionProfile;
  initialState:DirectedInitialState;schedule:readonly DirectedCommand[];
}>;
export type DirectedJobResult = Readonly<{status:'prepared';job:DirectedJob}>|Unavailable;

export type ObservedDirectedEvent = Readonly<{
  eventId:string;period:number;sourceMs:number;physicalMs:number;
  actorId:string|null;engineActorId:string|null;recipientId:string|null;engineRecipientId:string|null;outcome:string|null;
}>;
export type DirectedContact = Readonly<{
  eventId:string;actorId:string;engineId:string;period:number;sourceMs:number;physicalMs:number;
  geometry:Readonly<{provenance:'engine_output'|'view_inferred';effector:string;effectorCentre:Vector3;
    effectorRadiusM:number;ballCentre:Vector3;ballRadiusM:number}>|null;
}>;
/** Raw interval data is retained, never accepted as a certificate by this foundation. */
export type DirectedEvidenceBundle = Readonly<{
  version:'directed-evidence-1';requestDigest:string;profile:DirectedExecutionProfile;candidate:DirectedCandidate|null;
  receipt:Readonly<{id:string;sha256:string}>;units:'metres';
  clock:Readonly<{sourceStartMs:number;physicalStartMs:number;rate:1}>;
  identities:readonly Readonly<{playerKey:string;engineId:string}>[];
  events:readonly ObservedDirectedEvent[];contacts:readonly DirectedContact[];
  intervalEvidence:Readonly<Record<'root'|'node'|'body',unknown|null>>;unavailable:readonly DirectedIssue[];
}>;
export type DirectedAudit = Readonly<{
  status:'failed'|'blocked';acceptance:'not_assessed';issues:readonly DirectedIssue[];
  checks:Readonly<Record<'root'|'node'|'body',Readonly<{status:'failed'|'blocked';reason:string}>>>;
  contacts:readonly Readonly<{eventId:string;surfaceErrorM:number|null;timeErrorMs:number}>[];
  observations:Readonly<{usable:number;diagnosedConflicts:readonly Readonly<{eventId:string;playerKey:string|null;refs:readonly string[]}>[];unresolved:number}>;
  boundaryIssues:readonly DirectedIssue[];
}>;
