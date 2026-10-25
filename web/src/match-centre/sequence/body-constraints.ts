import { validateBodyGeometry } from './body-geometry';
import { sampleBodyGeometry } from './body-kinematics';
import { classifyContacts } from './contact-semantics';
import { compileContactBall } from './contact-ball';
import type { BodyGeometry,PreparedBodyConstraints,SemanticSequence,BodyIssue,BodyPositionConstraint,BodyContactTarget,BodyPoseInput,PoseNode,SourceObservation,ContactBallPlan,BodyGeometrySample } from './contact-types';
import type { Point,SequenceSource } from './types';
// Shared authored conventions; extraction preserves the legacy branch exactly.
export function readBodyBoundaries(source:SequenceSource){
  const entry=source.frames.filter(f=>f.clock_ms===source.request.fromMs),exit=source.frames.filter(f=>f.clock_ms===source.request.toMs);
  const valid=entry.length===1&&exit.length===1&&entry[0].players.length===22&&new Set(entry[0].players.map(p=>p.key)).size===22
    &&exit[0].players.length===22&&new Set(exit[0].players.map(p=>p.key)).size===22
    &&exit[0].players.every(p=>entry[0].players.some(e=>e.key===p.key&&e.side===p.side));
  return {entry:entry[0],exit:exit[0],valid};
}
export function describeBodyObservation(o:SourceObservation,g:BodyGeometry,ball:ContactBallPlan):{pose:BodyPoseInput;surface:BodyContactTarget['surface']} {
    let template=g.actionTemplates.idle,heading=0,surface:BodyContactTarget['surface']='rightFoot';
    const e=o.metadata.event;
    if(o.physicalContactRequired){
      if(o.effector==='head'){template=g.actionTemplates.header;surface='head';}
      else if(o.effector==='rightHand'||o.effector==='leftHand'){
        surface=o.effector;template=g.actionTemplates[surface==='rightHand'?'rightHandSave':'leftHandSave'];
        const target=ball.sample(o.sourceAtMs);
        if(target)heading=Math.atan2(target.y-o.sourcePoint!.y,target.x-o.sourcePoint!.x)+(surface==='rightHand'?Math.PI/2:-Math.PI/2);
      }else{surface=o.effector==='leftFoot'?'leftFoot':'rightFoot';template=g.actionTemplates[surface];
        if(e.end)heading=Math.atan2(e.end.y-o.sourcePoint!.y,e.end.x-o.sourcePoint!.x);}
    }

  return {pose:{root:{x:0,y:0},heading,...template},surface};
}
export function describeBodyContactTarget(g:BodyGeometry,fk:Extract<BodyGeometrySample,{status:'available'}>,surface:BodyContactTarget['surface'],target:Point){
    const eff=fk.effectors[surface],centre={x:(eff.a.x+eff.b.x)/2,y:(eff.a.y+eff.b.y)/2,z:(eff.a.z+eff.b.z)/2};
    const z=surface==='head'||surface.endsWith('Hand')?centre.z+eff.radiusM+g.ballRadiusM:g.ballRadiusM;
    let offset={x:centre.x,y:centre.y};
    if(surface.endsWith('Foot')){
      const horizontal=Math.sqrt(Math.max(0,(eff.radiusM+g.ballRadiusM)**2-(z-centre.z)**2)),norm=Math.hypot(centre.x,centre.y);
      if(norm>0)offset={x:centre.x-centre.x/norm*horizontal,y:centre.y-centre.y/norm*horizontal};
    }
    const root={x:target.x-offset.x,y:target.y-offset.y};

  return {root,ball:{...target,z}};
}
export function prepareBodyConstraints(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry):PreparedBodyConstraints {
  const g=validateBodyGeometry(geometry),ball=compileContactBall(source,g),{fromMs,toMs}=source.request;
  const issues:BodyIssue[]=[...ball.issues],constraints:BodyPositionConstraint[]=[],contacts:BodyContactTarget[]=[],excludedSnapshots:PreparedBodyConstraints['excludedSnapshots'][number][]=[];
  const add=(code:string,actorId:string|null,eventId:string|null,atMs:number|null,refs:readonly string[]=[],detail?:string)=>issues.push({code,actorId,eventId,atMs,refs:[...refs],detail});
  const current=classifyContacts(source);
  if(semantics.sourceKey!==source.key||semantics.key!==current.key||semantics.issues.length||current.issues.length
    ||JSON.stringify(semantics.observations)!==JSON.stringify(current.observations)
    ||semantics.sourceDigest!==current.sourceDigest||semantics.evidenceDigest!==current.evidenceDigest)add('invalid_semantic_binding',null,null,null);
  const boundary=readBodyBoundaries(source),entry=boundary.entry?[boundary.entry]:[],exit=boundary.exit?[boundary.exit]:[];
  if(!boundary.valid)add('invalid_body_boundary',null,null,null);
  const posePlans=new Map<string,Map<number,BodyPoseInput>>(),checks=new Map<string,number>();
  for(const p of entry[0]?.players??[]){posePlans.set(p.key,new Map());checks.set(p.key,0);}
  const idle=(root:Point):BodyPoseInput=>({root:{...root},heading:0,...g.actionTemplates.idle});
  for(const o of current.observations){
    if(!o.actorId||!posePlans.has(o.actorId)||!o.sourcePoint)continue;
    const {pose,surface}=describeBodyObservation(o,g,ball),fk=sampleBodyGeometry(g,pose);
    checks.set(o.actorId,checks.get(o.actorId)!+1);
    if(fk.status!=='available'){add(fk.reason,o.actorId,o.eventId,o.sourceAtMs,o.refs);continue;}
    // Contact pose wins over a same-time non-contact observation; both source records survive.
    const plans=posePlans.get(o.actorId)!;
    if(o.physicalContactRequired||!plans.has(o.sourceAtMs))plans.set(o.sourceAtMs,pose);
    const c=fk.footprint[0]; // A declared conservative trunk branch, not a larger generic disk.
    constraints.push({actorId:o.actorId,atMs:o.sourceAtMs,region:{id:c.id,a:{x:o.sourcePoint.x-c.a.x,y:o.sourcePoint.y-c.a.y},b:{x:o.sourcePoint.x-c.b.x,y:o.sourcePoint.y-c.b.y},radiusM:c.radiusM},
      sourcePoint:{...o.sourcePoint},eventId:o.eventId,refs:[...o.refs],provenance:'recorded_event'});
    if(!o.physicalContactRequired)continue;
    const target=ball.sample(o.sourceAtMs);
    if(!target){add('ball_target_unavailable',o.actorId,o.eventId,o.sourceAtMs,o.refs);continue;}
    const {root,ball:contactBall}=describeBodyContactTarget(g,fk,surface,target);
    constraints.push({actorId:o.actorId,atMs:o.sourceAtMs,region:{id:'effector-target',a:root,b:root,radiusM:.08},sourcePoint:{...o.sourcePoint},eventId:o.eventId,refs:[...o.refs],provenance:'contact_surface'});
    contacts.push({observation:o,ball:contactBall,surface,surfaceProvenance:o.effector==='unknownSurface'?'illustrative_unknown_surface':'recorded',pose});
  }
  for(const snap of source.performanceEvidence?.snapshots??[])for(const row of snap.rows){
    if(row.status!=='usable'||!row.playerKey||!row.point){excludedSnapshots.push({eventId:snap.eventId,actorId:row.playerKey,reason:row.reason??'unusable_snapshot',point:row.point?{...row.point}:null});continue;}
    if(!posePlans.has(row.playerKey)){add('snapshot_identity_unavailable',row.playerKey,snap.eventId,snap.elapsedMs,row.refs);continue;}
    const pose=posePlans.get(row.playerKey)!.get(snap.elapsedMs)??idle({x:0,y:0}),fk=sampleBodyGeometry(g,pose);
    checks.set(row.playerKey,checks.get(row.playerKey)!+1);
    if(fk.status!=='available'){add(fk.reason,row.playerKey,snap.eventId,snap.elapsedMs,row.refs);continue;}
    posePlans.get(row.playerKey)!.set(snap.elapsedMs,pose);
    const c=fk.footprint[0];
    constraints.push({actorId:row.playerKey,atMs:snap.elapsedMs,region:{id:c.id,a:{x:row.point.x-c.a.x,y:row.point.y-c.a.y},b:{x:row.point.x-c.b.x,y:row.point.y-c.b.y},radiusM:c.radiusM},
      sourcePoint:{...row.point},eventId:snap.eventId,refs:[...row.refs],provenance:'recorded_snapshot'});
  }
  // A Carry endpoint stays a source marker at its existing alias, never a ball/root equality.
  for(const a of ball.anchors.filter(a=>a.kind==='Carry'&&a.presentationEndMs<=toMs)){
    const o=current.observations.find(o=>o.eventId===a.eventId);if(!o?.actorId)continue;
    constraints.push({actorId:o.actorId,atMs:a.presentationEndMs,region:{id:'trunk',a:{...a.end},b:{...a.end},radiusM:g.bodyVolumes.trunk},sourcePoint:{...a.end},eventId:o.eventId,refs:[...o.refs],provenance:'carry_endpoint'});
  }
  const actors:PreparedBodyConstraints['actors'][number][]=[];
  for(const p of entry[0]?.players??[]){
    const end=exit[0]?.players.find(e=>e.key===p.key);if(!end)continue;
    const initial:BodyPositionConstraint={actorId:p.key,atMs:fromMs,region:{id:'entry',a:{x:p.x,y:p.y},b:{x:p.x,y:p.y},radiusM:0},sourcePoint:{x:p.x,y:p.y},eventId:null,refs:[],provenance:'synthetic_entry'};
    const own=[initial,...constraints.filter(c=>c.actorId===p.key)],times=[...new Set([fromMs,toMs,...own.map(c=>c.atMs)])].sort((a,b)=>a-b);
    const nodes:PoseNode[]=times.map(t=>{const u=(t-fromMs)/(toMs-fromMs),root={x:p.x+(end.x-p.x)*u,y:p.y+(end.y-p.y)*u};
      const pose=posePlans.get(p.key)?.get(t)??idle(root);return {atMs:t,pose:{...pose,root}};});
    if(times.length>64)add('node_limit',p.key,null,null);
    actors.push({actorId:p.key,fromMs,toMs,entry:{x:p.x,y:p.y},exitPrior:{x:end.x,y:end.y},nodes,constraints:own,budget:{maxNodes:64,maxSweeps:10000,sweepsUsed:checks.get(p.key)??0}});
  }
  return {key:JSON.stringify([source.key,semantics.key,g.key,'body-constraints-1','trunk-branch','conditioned-body-solver-1']),sourceKey:source.key,semanticKey:semantics.key,geometry:g,
    fromMs,toMs,actors,constraints:actors.flatMap(a=>a.constraints),contacts,aliases:ball.aliases,excludedSnapshots,ball,issues};
}
