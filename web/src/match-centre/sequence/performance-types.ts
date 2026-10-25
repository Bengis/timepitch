import type { CurveSpan } from './curves';
import type { SolverReport } from './constraint-solver';
import type { Point } from './types';

export type StagingIssue = Readonly<{
  code:string;blocking:boolean;actorIds:readonly string[];refs:readonly string[];
  atMs?:number;toMs?:number;detail?:string;
}>;
export type StagingConstraint = Readonly<{
  actorId:string;atMs:number;point:Point;radiusM:number;refs:readonly string[];
  provenance:'recorded_snapshot'|'recorded_action_envelope'|'recorded_event_root'|'synthetic_entry'|'synthetic_support'|'synthetic_cover';
}>;
export type StagingContact = Readonly<{
  eventId:string;actorId:string;atMs:number;kind:string;point:Point;relatedIds:readonly string[];refs:readonly string[];
}>;
export type StagingOffset = Readonly<{
  actorId:string;eventId:string;atMs:number;point:Point;root:Point;offsetM:number;provenance:'illustrative_contact_root';
}>;
export type StagingTrack = Readonly<{
  actorId:string;side:'home'|'away';provenance:'synthetic_constrained'|'synthetic_support'|'synthetic_cover';spans:readonly CurveSpan[];
}>;
export type StagingReport = Readonly<{
  accepted:boolean;maxSpeed:number|null;maxAcceleration:number|null;minClearanceM:number|null;issues:readonly StagingIssue[];
}>;
export type StagingSolverReport = SolverReport & Readonly<{
  reachabilityWitness?:Readonly<{fromMs:number;viaMs:number;toMs:number;minRequiredAcceleration:number;limit:4;refs:readonly string[]}>;
  failedBounds?:readonly Readonly<{
  kind:string;fromMs:number;toMs:number;residual:number;refs:readonly string[];
}>[]}>;
export type StagedSequence = Readonly<{
  version:'historical-staging-1';key:string;sourceKey:string;evidenceDigest:string;fromMs:number;toMs:number;
  actorIds:readonly string[];tracks:readonly StagingTrack[];constraints:readonly StagingConstraint[];
  contacts:readonly StagingContact[];offsets:readonly StagingOffset[];issues:readonly StagingIssue[];
  aliases:readonly Readonly<{eventId:string;sourceEndMs:number;presentationEndMs:number;deltaMs:number}>[];
  duelExceptions:readonly Readonly<{actorIds:readonly [string,string];fromMs:number;toMs:number;minM:number;refs:readonly string[]}>[];
  solvers:readonly Readonly<{actorId:string;report:StagingSolverReport}>[];
  sampleRoot(key:string,t:number):Point|null;
}>;
