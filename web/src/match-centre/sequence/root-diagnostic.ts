import type { SequenceSource } from './types';
import type { BodyGeometry,SemanticSequence,BodyRootTrack,BodyIssue } from './contact-types';
import { readBodyBoundaries } from './body-constraints';
import { classifyRootBindings,sealRootValue } from './root-observation-bindings';
import type { RootBindingPlan } from './root-observation-bindings';
import { buildRootContactDomains,inspectRootNodeWitnesses } from './root-contact-domains';
import type { RootDomainPlan,RootNodeWitnessReport } from './root-contact-domains';
import { RootWorkLedger,inspectRootFeasibility } from './root-feasibility';
import type { RootFeasibilityReport,RootWorkStage } from './root-feasibility';
import { projectRootActor } from './root-projection';
import type { RootProjectionResult } from './root-projection';
import { buildRefinedRootGrid } from './root-time-grid';
import type { RefinedRootGridPlan } from './root-time-grid';

const PROFILE='historical-root-diagnostic-2' as const;
const POLICY='physical-1' as const;
const REFINED_PROFILE='historical-root-diagnostic-3' as const;
const REFINED_POLICY='physical-refined-1' as const;
type ActorReport=Readonly<{
  actorId:string;preflight:RootFeasibilityReport|null;
  projection:Omit<RootProjectionResult,'track'>|null;
  work:Readonly<{cap:10000;consumed:number;byStage:Readonly<Partial<Record<RootWorkStage,number>>>}>;
}>;
type SupportDiagnostic=Readonly<{actorId:string;sameLocalFootTranslationM:number;stanceLimitM:.03;
  meaning:'counterfactual_unchanged_local_foot_offset_not_measured_gait'}>;
type DiagnosticCommon=Readonly<{
  key:string;reason:string;sourceKey:string|null;semanticKey:string|null;geometryKey:string|null;
  bindingKey:string|null;domainKey:string|null;bodyAcceptance:'blocked';
  preparationStatus:'ready'|'unavailable'|'not_run';issues:readonly BodyIssue[];
  observations:RootBindingPlan['observations'];excludedSnapshots:RootBindingPlan['excludedSnapshots'];
  inventory:Readonly<{actorCount:number;contacts:number;snapshots:number;aliases:number;maxNodes:number;branches:readonly number[]}>;
  actors:readonly ActorReport[];nodeWitnesses:RootNodeWitnessReport|Readonly<{status:'not_run';reason:string}>;
  supportDiagnostics:readonly SupportDiagnostic[];downstreamBlockers:readonly string[];
}>;
type DiagnosticOutcome=Readonly<{status:'roots_proposed';roots:readonly BodyRootTrack[]}>|Readonly<{status:'unavailable';roots?:never}>;
export type RootDiagnosticResult=DiagnosticCommon & Readonly<{profile:typeof PROFILE;policy:typeof POLICY}> & DiagnosticOutcome;
export type RefinedRootDiagnosticResult=DiagnosticCommon & Readonly<{profile:typeof REFINED_PROFILE;policy:typeof REFINED_POLICY;grid:RefinedRootGridPlan|null}> & DiagnosticOutcome;

/** Offline root diagnostic only. Never returns a product sampler or body candidate. */
export function compileRootDiagnostic(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry):RootDiagnosticResult {
  return compileDiagnostic(source,semantics,geometry,false);
}
/** Explicit experimental wrapper; never accepts caller-supplied grids or warm starts. */
export function compileRefinedRootDiagnostic(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry):RefinedRootDiagnosticResult {
  return compileDiagnostic(source,semantics,geometry,true);
}
function compileDiagnostic(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry,refined:false):RootDiagnosticResult;
function compileDiagnostic(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry,refined:true):RefinedRootDiagnosticResult;
function compileDiagnostic(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry,refined:boolean):RootDiagnosticResult|RefinedRootDiagnosticResult {
  const ledgers=new Map<string,RootWorkLedger>(),reports:Omit<ActorReport,'work'>[]=[],roots:BodyRootTrack[]=[];
  let plan:RootDomainPlan|null=null,binding:RootBindingPlan|null=null;
  let grid:RefinedRootGridPlan|null=null,sourceStamp:string|null=null;
  let nodeWitnesses:RootDiagnosticResult['nodeWitnesses']={status:'not_run',reason:'preparation_not_ready'};
  const finish=(reason:string,proposed=false):RootDiagnosticResult|RefinedRootDiagnosticResult=>{
    const supportDiagnostics:SupportDiagnostic[]=reports.flatMap(r=>{
      const nodes=r.projection?.diagnostics.finalNodes;if(!nodes?.length)return [];
      const a=nodes[0].root,b=nodes.at(-1)!.root;
      return [{actorId:r.actorId,sameLocalFootTranslationM:Math.hypot(b.x-a.x,b.y-a.y),stanceLimitM:.03,
        meaning:'counterfactual_unchanged_local_foot_offset_not_measured_gait' as const}];
    });
    const base={profile:PROFILE,key:JSON.stringify(refined?[REFINED_PROFILE,REFINED_POLICY,plan?.key??null,binding?.key??null,geometry?.key??null,grid?.key??null]:
      [PROFILE,POLICY,plan?.key??null,binding?.key??null,geometry?.key??null]),reason,
      sourceKey:source?.key??null,semanticKey:semantics?.key??null,geometryKey:geometry?.key??null,bindingKey:binding?.key??null,domainKey:plan?.key??null,
      policy:POLICY,bodyAcceptance:'blocked' as const,preparationStatus:plan?.status??'not_run' as const,issues:refined?[...plan?.issues??[],...grid?.issues??[]]:plan?.issues??[],
      observations:binding?.observations??[],excludedSnapshots:binding?.excludedSnapshots??[],
      inventory:{actorCount:plan?.actors.length??0,contacts:plan?.contacts.length??0,snapshots:binding?.snapshots.length??0,
        aliases:plan?.ball.aliases.length??0,maxNodes:Math.max(0,...(refined?grid?.actors:plan?.actors)?.map(a=>a.nodes.length)??[]),branches:plan?.contacts.map(c=>c.branches.length)??[]},
      actors:[...ledgers].map(([actorId,work])=>({...reports.find(r=>r.actorId===actorId)??{actorId,preflight:null,projection:null},
        work:{cap:10000 as const,consumed:work.consumed,byStage:work.byStage}})),nodeWitnesses,supportDiagnostics,
      downstreamBlockers:['neutral_pose_is_not_locomotion','planted_foot_drift_not_certified','continuous_contact_and_control_not_verified',
        'collective_body_clearance_not_verified','independent_continuous_body_verifier_not_run']};
    const result=proposed?{...base,status:'roots_proposed' as const,roots}:{...base,status:'unavailable' as const};
    return sealRootValue(refined?{...result,profile:REFINED_PROFILE,policy:REFINED_POLICY,grid}:result);
  };
  if(!source||typeof source.key!=='string'||!source.identity||!source.request||!Array.isArray(source.frames)||!Array.isArray(source.events)
    ||!Array.isArray(source.cuts)||!semantics||!geometry)return finish('invalid_source_input');
  try {
    const boundary=readBodyBoundaries(source);if(!boundary.valid)return finish('invalid_source_input');
    if(refined)sourceStamp=JSON.stringify(source);
    for(const actor of boundary.entry.players)ledgers.set(actor.key,new RootWorkLedger());
    binding=classifyRootBindings(source,semantics);
    plan=buildRootContactDomains(source,semantics,geometry,binding,ledgers);
  }catch{return finish('invalid_preparation_input');}
  if(plan.status!=='ready'||plan.actors.length!==22)return finish('preparation_unavailable');
  if(refined){
    grid=buildRefinedRootGrid(plan,ledgers);
    if(grid.status!=='ready')return finish('grid_unavailable');
    if(JSON.stringify(source)!==sourceStamp)return finish('source_identity_changed');
  }
  // One fixed order and one projection per eligible actor; no branch or policy retry.
  for(const actor of plan.actors){
    const ledger=ledgers.get(actor.actorId)!;
    const preflight=inspectRootFeasibility({actorId:actor.actorId,domainKey:plan.key,scope:'finite_catalogue_necessary_root_regions',
      // Inspector binds every region to this exact content key, not only the compiler revision.
      physicalAccelerationMps2:4,regions:actor.bindings.map(region=>({...region,policyKey:plan!.key}))},ledger);
    let projection:ActorReport['projection']=null;
    if(preflight.status==='not_excluded'){
      const input={...actor,...(refined?{nodes:grid!.actors.find(a=>a.actorId===actor.actorId)!.nodes}:{}),constraints:actor.bindings};
      const result=projectRootActor(input,ledger,refined?REFINED_POLICY:POLICY);
      const {track,...report}=result;projection=report;
      if(result.status==='proposed'&&track)roots.push(track);
    }
    reports.push({actorId:actor.actorId,preflight,projection});
  }
  if(refined&&JSON.stringify(source)!==sourceStamp)return finish('source_identity_changed');
  if(roots.length!==22){nodeWitnesses={status:'not_run',reason:'incomplete_root_set'};return finish('root_set_unavailable');}
  nodeWitnesses=inspectRootNodeWitnesses(plan,roots,ledgers);
  if(refined&&JSON.stringify(source)!==sourceStamp)return finish('source_identity_changed');
  if(nodeWitnesses.status!=='witnessed')return finish('node_witnesses_unresolved');
  return finish('root_and_node_gates_passed_body_blocked',true);
}
