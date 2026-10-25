import { classifyContacts } from './contact-semantics';
import { fieldPoint } from './curves';
import type { BodyIssue,SemanticSequence,SourceObservation } from './contact-types';
import type { PerformanceSnapshotRow } from './performance-evidence';
import type { SequenceSource } from './types';

export type RootObservationBinding=Readonly<{
  observation:SourceObservation;
  disposition:'body_localisation'|'ball_contact'|'ball_control'|'arrival_context'|'context_only'|'unsupported';
  localisation:'finite_actor_context'|'not_anatomically_localised';
}>;
export type RootSnapshotBinding=Readonly<{eventId:string;atMs:number;row:PerformanceSnapshotRow}>;
export type RootBindingPlan=Readonly<{
  version:'root-observation-bindings-1';key:string;sourceKey:string;semanticKey:string;sourceStamp:string;
  status:'ready'|'unavailable';observations:readonly RootObservationBinding[];snapshots:readonly RootSnapshotBinding[];
  excludedSnapshots:readonly Readonly<{eventId:string;atMs:number;row:PerformanceSnapshotRow;reason:string}>[];
  issues:readonly BodyIssue[];
}>;
/** Owned immutable diagnostic values, never freeze caller/source state. */
export function sealRootValue<T>(value:T):T {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(sealRootValue);Object.freeze(value);}return value;
}
export function copyRootValue<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
export function rootBindingStamp(source:SequenceSource):string {
  return JSON.stringify([source.key,source.rawDigest,source.request,source.cuts,
    source.frames.filter(f=>f.clock_ms===source.request.fromMs||f.clock_ms===source.request.toMs),source.performanceEvidence]);
}
/** Preserve every observation; change only its anatomical interpretation. */
export function classifyRootBindings(source:SequenceSource,semantics:SemanticSequence):RootBindingPlan {
  const current=classifyContacts(source),issues:BodyIssue[]=[],snapshots:RootSnapshotBinding[]=[],excludedSnapshots:RootBindingPlan['excludedSnapshots'][number][]=[];
  const add=(code:string,eventId:string|null=null,atMs:number|null=null,actorId:string|null=null,refs:readonly string[]=[])=>issues.push({code,eventId,atMs,actorId,refs:[...refs]});
  if(current.issues.length||JSON.stringify(current)!==JSON.stringify(semantics))add('invalid_root_semantic_binding');
  const observations:RootObservationBinding[]=current.observations.map(observation=>{
    const context=['save','block','recovery_observation','contest','shot_context','no_touch'].includes(observation.role);
    const disposition:RootObservationBinding['disposition']=observation.physicalContactRequired?'ball_contact':
      observation.role==='control_interval'?'ball_control':observation.role==='arrival_observation'?'arrival_context':
      ['recovery_observation','contest'].includes(observation.role)?'body_localisation':
      ['shot_context','no_touch'].includes(observation.role)?'context_only':'unsupported';
    if(disposition==='unsupported')add('unsupported_root_observation',observation.eventId,observation.sourceAtMs,observation.actorId,observation.refs);
    return {observation,disposition,localisation:context?'finite_actor_context':'not_anatomically_localised'};
  });
  const people=new Set(source.frames.find(f=>f.clock_ms===source.request.fromMs)?.players.map(p=>p.key));
  const seen=new Set<string>();
  for(const snap of source.performanceEvidence?.snapshots??[]){
    const event=source.events.find(e=>e.id===snap.eventId);
    if(!event||snap.period!==source.request.period||snap.elapsedMs!==event.elapsedMs||snap.periodMs!==event.periodMs)
      add('invalid_root_snapshot_event',snap.eventId,snap.elapsedMs);
    for(const row of snap.rows){
      if(row.status!=='usable'){
        excludedSnapshots.push({eventId:snap.eventId,atMs:snap.elapsedMs,row:copyRootValue(row),reason:row.reason??'unusable_snapshot'});continue;
      }
      const id=JSON.stringify([snap.eventId,row.playerKey]);
      if(!row.playerKey||!people.has(row.playerKey)||!fieldPoint(row.point)||seen.has(id))add('invalid_root_snapshot_row',snap.eventId,snap.elapsedMs,row.playerKey,row.refs);
      seen.add(id);snapshots.push({eventId:snap.eventId,atMs:snap.elapsedMs,row:copyRootValue(row)});
    }
  }
  const content={version:'root-observation-bindings-1' as const,sourceKey:source.key,semanticKey:current.key,sourceStamp:rootBindingStamp(source),
    observations,snapshots,excludedSnapshots,issues};
  return sealRootValue({...content,status:issues.length?'unavailable':'ready',key:JSON.stringify(content)});
}
