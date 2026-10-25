import type { PerformanceActionEvidence } from './performance-evidence';
import type { Point, SequenceEvent } from './types';
import type { CurveSpan } from './curves';
import type { PresentationAlias } from './constraints';

export type SemanticRole = 'strike' | 'control_interval' | 'save' | 'block'
  | 'recovery_observation' | 'arrival_observation' | 'contest' | 'shot_context' | 'no_touch' | 'unsupported';
export type Effector = 'leftFoot' | 'rightFoot' | 'leftHand' | 'rightHand' | 'head' | 'unknownSurface' | null;
export type SemanticIssue = Readonly<{
  code: string; eventId: string | null; refs: readonly string[]; blocking: true;
}>;
export type SourceObservation = Readonly<{
  eventId: string; actorId: string | null; kind: string; role: SemanticRole; sourceIndex: number;
  sourceAtMs: number; sourcePoint: Point | null; relatedIds: readonly string[]; refs: readonly string[];
  effector: Effector; physicalContactRequired: boolean;
  // Original normalized and supplementary records, not guessed body/ball positions.
  metadata: Readonly<{ event: SequenceEvent; action: PerformanceActionEvidence | null }>;
}>;
export type SemanticSequence = Readonly<{
  version: 'sequence-contact-semantics-1'; key: string; sourceKey: string;
  sourceDigest: string; evidenceDigest: string | null;
  observations: readonly SourceObservation[]; issues: readonly SemanticIssue[];
}>;

export type MetricPoint = Readonly<{x:number;y:number;z:number}>;
export type JointAngle = 'bodyPitch'|'bodyRoll'|'headPitch'|'leftArmPitch'|'rightArmPitch'
  |'leftArmSpread'|'rightArmSpread'|'leftElbow'|'rightElbow'|'leftHip'|'rightHip'|'leftKnee'|'rightKnee';
export type SupportMode = 'grounded'|'dive'|'airborne';
export type Foot = 'leftFoot'|'rightFoot';
export type BodyPoseInput = Readonly<{
  root:Point;heading:number;angles:Readonly<Partial<Record<JointAngle,number>>>;
  supportMode:SupportMode;supportingFeet:readonly Foot[];
}>;
export type BodyGeometry = Readonly<{
  version:'diagnostic-body-1';key:string;revision:string;units:'metres-radians';ballRadiusM:number;
  provenance:string;
  joints:Readonly<{upperArm:number;forearm:number;thigh:number;shin:number;shoulderY:number;shoulderZ:number;
    hipY:number;pelvisZ:number;headZ:number}>;
  jointLimits:Readonly<Record<JointAngle,readonly [number,number]>>;
  bodyVolumes:Readonly<{trunk:number;head:number;upperArm:number;forearm:number;thigh:number;shin:number;foot:number;hand:number}>;
  localisationPolicy:Readonly<{revision:string;components:readonly ['trunk','support_feet'];diveProjection:'trunk_ground_projection';airborneProjection:null}>;
  actionTemplates:Readonly<Record<'idle'|'leftFoot'|'rightFoot'|'header'|'rightHandSave'|'leftHandSave',
    Readonly<{supportMode:SupportMode;supportingFeet:readonly Foot[];angles:BodyPoseInput['angles'];illustrative:true}>>>;
}>;
export type MetricCapsule = Readonly<{id:string;a:MetricPoint;b:MetricPoint;radiusM:number}>;
export type GroundCapsule = Readonly<{id:string;a:Point;b:Point;radiusM:number}>;
export type BodyPose = BodyPoseInput & Readonly<{joints:Readonly<Record<string,MetricPoint>>;illustrative:true}>;
export type BodyGeometrySample = Readonly<
  {status:'available';pose:BodyPose;effectors:Readonly<Record<Exclude<Effector,'unknownSurface'|null>,MetricCapsule>>;
    footprint:readonly GroundCapsule[];volumes:readonly MetricCapsule[]}
  |{status:'unsupported';reason:string}
>;
export type BodyIssue = Readonly<{code:string;actorId:string|null;eventId:string|null;atMs:number|null;refs:readonly string[];detail?:string}>;
export type BallXYSpan = Readonly<{fromMs:number;toMs:number;start:Point;end:Point;refs:readonly string[]}>;
export type ContactBallPlan = Readonly<{
  key:string;sourceKey:string;geometryKey:string;fromMs:number;toMs:number;aliases:readonly PresentationAlias[];
  anchors:readonly Readonly<{eventId:string;kind:string;fromMs:number;sourceEndMs:number;presentationEndMs:number;start:Point;end:Point}>[];
  spans:readonly BallXYSpan[];issues:readonly BodyIssue[];rawHeights:readonly Readonly<{eventId:string;value:number|null;unit:'unverified'}>[];
  sample(t:number):Point|null;
}>;
export type PoseNode = Readonly<{atMs:number;pose:BodyPoseInput}>;
export type BodyPositionConstraint = Readonly<{
  actorId:string;atMs:number;region:GroundCapsule;sourcePoint:Point;eventId:string|null;refs:readonly string[];
  provenance:'synthetic_entry'|'recorded_event'|'recorded_snapshot'|'contact_surface'|'carry_endpoint';
}>;
export type BodyContactTarget = Readonly<{
  observation:SourceObservation;ball:MetricPoint;surface:Exclude<Effector,'unknownSurface'|null>;
  surfaceProvenance:'recorded'|'illustrative_unknown_surface';pose:BodyPoseInput;
}>;
export type BodyActorInput = Readonly<{
  actorId:string;fromMs:number;toMs:number;entry:Point;exitPrior:Point;nodes:readonly PoseNode[];
  constraints:readonly BodyPositionConstraint[];budget:Readonly<{maxNodes:64;maxSweeps:10000;sweepsUsed:number}>;
}>;
export type PreparedBodyConstraints = Readonly<{
  key:string;sourceKey:string;semanticKey:string;geometry:BodyGeometry;fromMs:number;toMs:number;
  actors:readonly BodyActorInput[];constraints:readonly BodyPositionConstraint[];contacts:readonly BodyContactTarget[];
  aliases:readonly PresentationAlias[];excludedSnapshots:readonly Readonly<{eventId:string;actorId:string|null;reason:string;point:Point|null}>[];
  ball:ContactBallPlan;issues:readonly BodyIssue[];
}>;
export type BodyRootTrack = Readonly<{actorId:string;spans:readonly CurveSpan[];poseNodes:readonly PoseNode[]}>;
export type BodySolverReport = Readonly<{
  actorId:string;status:'proposed'|'not_converged'|'invalid_input';sweepsUsed:number;solverSweeps:number;
  maxResidual:number|null;maxChange:number|null;nodes:number;fixedPositionCount:number;positionScaleM:number;velocityScaleMps:number;
  witnesses:readonly Readonly<{kind:string;fromMs:number;toMs:number;residual:number}>[];
}>;
export type BodySolveResult = Readonly<{status:'proposed'|'unavailable';tracks:readonly BodyRootTrack[];reports:readonly BodySolverReport[];issues:readonly BodyIssue[]}>;
export type BodyContactSample = Readonly<{atMs:number;actors:readonly Readonly<{actorId:string;body:Extract<BodyGeometrySample,{status:'available'}>}>[];
  ballProvenance:'recorded_xy_illustrative_height';
  ball:MetricPoint|null;bindings:readonly Readonly<{eventId:string|null;actorId:string;sourcePoint:Point;root:Point;offset:Point;offsetM:number}>[]}>;
type CandidateBase = Readonly<{profile:'historical-body-contact-1';key:string;sourceKey:string;geometryKey:string;semanticKey:string;
  issues:readonly BodyIssue[];diagnostics:Readonly<{prepared:PreparedBodyConstraints;reports:readonly BodySolverReport[]}>;
  sample(t:number):BodyContactSample|null}>;
export type BodyContactCandidate = CandidateBase & Readonly<
  {status:'proposed';tracks:readonly BodyRootTrack[];
    ballHeightKnots:readonly Readonly<{atMs:number;heightM:number;provenance:'illustrative_contact_envelope'}>[]}|{status:'unavailable'}
>;
