import { validateBodyGeometry } from './body-geometry';
import { sampleBodyGeometry } from './body-kinematics';
import { compileContactBall } from './contact-ball';
import { readBodyBoundaries,describeBodyObservation,describeBodyContactTarget } from './body-constraints';
import { classifyRootBindings,copyRootValue,sealRootValue } from './root-observation-bindings';
import type { RootBindingPlan } from './root-observation-bindings';
import { RootWorkLedger,rootIntervalMath as m,isValidRootRegion,rootOrientation } from './root-feasibility';
import type { RootRegion,RootTimedRegion } from './root-feasibility';
import { fieldPoint,pointAt } from './curves';
import type { Point,SequenceSource } from './types';
import type { BodyGeometry,BodyPoseInput,BodyGeometrySample,BodyRootTrack,BodyIssue,ContactBallPlan,Effector,GroundCapsule,MetricCapsule,MetricPoint,PoseNode,SemanticSequence,SourceObservation } from './contact-types';

const VERSION='root-contact-domains-1' as const;
const UNKNOWN_SURFACES=['head','trunk','leftThigh','rightThigh','leftShin','rightShin','leftFoot','rightFoot'];
type Available=Extract<BodyGeometrySample,{status:'available'}>;
type Template=keyof BodyGeometry['actionTemplates'];
export type RootContactBranch=Readonly<{id:string;poseKey:string;template:Template;pose:BodyPoseInput;surfaceId:string;outerRegion:GroundCapsule}>;
export type RootContactDomain=Readonly<{
  observation:SourceObservation;ball:MetricPoint;ballProvenance:'recorded_xy_illustrative_height';branches:readonly RootContactBranch[];
  originalBranchId:string|null;originalRootSurrogate:GroundCapsule;region:RootRegion;
}>;
type Localisation=Readonly<{actorId:string;atMs:number;eventId:string;point:Point;refs:readonly string[];provenance:'recorded_snapshot'|'recorded_event'}>;
type Control=Readonly<{actorId:string;eventId:string;fromMs:number;toMs:number;start:Point;end:Point;reachM:number;refs:readonly string[]}>;
type Group=Readonly<{actorId:string;atMs:number;poses:readonly BodyPoseInput[]}>;
type Actor=Readonly<{actorId:string;fromMs:number;toMs:number;entry:Point;exitPrior:Point;nodes:readonly PoseNode[];bindings:readonly RootTimedRegion[];postCheckReserve:number}>;
export type RootDomainPlan=Readonly<{
  status:'ready'|'unavailable';version:typeof VERSION;key:string;domainKey:typeof VERSION;sourceKey:string;semanticKey:string;
  bindingPlan:RootBindingPlan;geometry:BodyGeometry;ball:ContactBallPlan;actors:readonly Actor[];
  contacts:readonly RootContactDomain[];localisations:readonly Localisation[];controls:readonly Control[];groups:readonly Group[];issues:readonly BodyIssue[];
}>;
export type RootNodeWitnessReport=Readonly<{status:'witnessed'|'unresolved';planKey:string;issues:readonly BodyIssue[];
  witnesses:readonly Readonly<{actorId:string;atMs:number;poseKey:string;contactEventIds:readonly string[]}>[];bodyAccepted:false}>;
const registrations=new WeakMap<RootDomainPlan,ReadonlyMap<string,RootWorkLedger>>();
/** Read-only authority check for downstream computational preparation. */
export function hasRootDomainWorkBinding(plan:RootDomainPlan,ledgers:ReadonlyMap<string,RootWorkLedger>):boolean {
  const original=registrations.get(plan);
  return !!original&&plan.status==='ready'&&plan.actors.every(actor=>ledgers.get(actor.actorId)===original.get(actor.actorId));
}
const p=m.point,add=m.add,sub=m.subtract,mul=m.multiply,div=m.divide;
const normUpper=(x:number,y:number)=>m.sqrt({lo:0,hi:add(mul(p(x),p(x)),mul(p(y),p(y))).hi}).hi;
const poseKey=(pose:BodyPoseInput)=>JSON.stringify([pose.heading,pose.angles,pose.supportMode,pose.supportingFeet]);
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

function reflect(marker:Point,c:GroundCapsule,radiusM=c.radiusM):GroundCapsule {
  const ax=sub(p(marker.x),p(c.a.x)),ay=sub(p(marker.y),p(c.a.y)),bx=sub(p(marker.x),p(c.b.x)),by=sub(p(marker.y),p(c.b.y));
  const a={x:marker.x-c.a.x,y:marker.y-c.a.y},b={x:marker.x-c.b.x,y:marker.y-c.b.y};
  const error=Math.max(normUpper(Math.max(a.x-ax.lo,ax.hi-a.x),Math.max(a.y-ay.lo,ay.hi-a.y)),
    normUpper(Math.max(b.x-bx.lo,bx.hi-b.x),Math.max(b.y-by.lo,by.hi-b.y)));
  return {id:c.id,a,b,radiusM:add(p(radiusM),p(error)).hi};
}
/** Necessary XY capsule only; penetration exclusion still requires the true surface. */
export function contactOuterCapsule(ball:MetricPoint,ballRadius:number,surface:MetricCapsule):GroundCapsule|null {
  if(![ball.x,ball.y,ball.z,ballRadius,surface.radiusM,surface.a.x,surface.a.y,surface.a.z,surface.b.x,surface.b.y,surface.b.z].every(Number.isFinite)
    ||ballRadius<=0||surface.radiusM<=0)throw new Error('Invalid finite contact');
  const low=Math.min(surface.a.z,surface.b.z),high=Math.max(surface.a.z,surface.b.z);
  const gap=ball.z<low?sub(p(low),p(ball.z)):ball.z>high?sub(p(ball.z),p(high)):p(0);
  const outer=add(add(p(surface.radiusM),p(ballRadius)),p(.08));
  if(gap.lo>outer.hi)return null;
  const square=sub(mul(outer,outer),mul(gap,gap));
  const radius=m.sqrt({lo:0,hi:Math.max(0,square.hi)}).hi;
  return reflect(ball,{id:surface.id,a:surface.a,b:surface.b,radiusM:radius});
}
/** Hull of outward interval corners encloses the sixteen support halfplanes. */
export function encloseRootCapsules(capsules:readonly GroundCapsule[]):RootRegion {
  if(!capsules.length||capsules.some(c=>!isValidRootRegion({kind:'capsule',...c})))throw new Error('Invalid contact domain');
  const planes=Array.from({length:16},(_,k)=>{
    const n={x:Math.cos(k*Math.PI/8),y:Math.sin(k*Math.PI/8)},length=normUpper(n.x,n.y);
    const support=(c:GroundCapsule)=>add(p(Math.max(add(mul(p(n.x),p(c.a.x)),mul(p(n.y),p(c.a.y))).hi,
      add(mul(p(n.x),p(c.b.x)),mul(p(n.y),p(c.b.y))).hi)),mul(p(c.radiusM),p(length))).hi;
    return {n,h:Math.max(...capsules.map(support))};
  });
  const corners:Point[]=[];
  for(let i=0;i<planes.length;i++){
    const a=planes[i],b=planes[(i+1)%planes.length],det=sub(mul(p(a.n.x),p(b.n.y)),mul(p(a.n.y),p(b.n.x)));
    const x=div(sub(mul(p(a.h),p(b.n.y)),mul(p(a.n.y),p(b.h))),det),y=div(sub(mul(p(a.n.x),p(b.h)),mul(p(a.h),p(b.n.x))),det);
    for(const xx of [x.lo,x.hi])for(const yy of [y.lo,y.hi])corners.push({x:xx,y:yy});
  }
  const points=corners.sort((a,b)=>a.x-b.x||a.y-b.y).filter((v,i,a)=>i===0||v.x!==a[i-1].x||v.y!==a[i-1].y);
  const half=(v:readonly Point[])=>{const out:Point[]=[];for(const x of v){while(out.length>1&&rootOrientation(out.at(-2)!,out.at(-1)!,x)<=0n)out.pop();out.push(x);}return out;};
  const region:RootRegion={kind:'polygon',vertices:[...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)]};
  if(!isValidRootRegion(region))throw new Error('Uncertifiable convex contact domain');return region;
}
export function contactSurfaceErrorM(ball:MetricPoint,ballRadius:number,surface:MetricCapsule,expected:Effector):number|null {
  if(![ball.x,ball.y,ball.z,ballRadius,surface.radiusM,surface.a.x,surface.a.y,surface.a.z,surface.b.x,surface.b.y,surface.b.z].every(Number.isFinite)
    ||ballRadius<=0||surface.radiusM<=0)return null;
  if(expected==='unknownSurface'?!UNKNOWN_SURFACES.includes(surface.id):surface.id!==expected)return null;
  const dx=surface.b.x-surface.a.x,dy=surface.b.y-surface.a.y,dz=surface.b.z-surface.a.z,l=dx*dx+dy*dy+dz*dz;
  const u=l?Math.max(0,Math.min(1,((ball.x-surface.a.x)*dx+(ball.y-surface.a.y)*dy+(ball.z-surface.a.z)*dz)/l)):0;
  const error=Math.abs(Math.hypot(ball.x-surface.a.x-u*dx,ball.y-surface.a.y-u*dy,ball.z-surface.a.z-u*dz)-surface.radiusM-ballRadius);
  return Number.isFinite(error)?error:null;
}
function controlReach(g:BodyGeometry):number {
  const j=g.joints,shoulder=sub(p(j.shoulderZ),p(j.pelvisZ)),head=sub(p(j.headZ),p(j.pelvisZ));
  const arm=add(add(p(normUpper(j.shoulderY,Math.max(Math.abs(shoulder.lo),Math.abs(shoulder.hi)))),p(j.upperArm)),p(j.forearm));
  const leg=add(add(add(p(j.hipY),p(j.thigh)),p(j.shin)),p(.12));
  return add(add(p(Math.max(arm.hi,leg.hi,Math.abs(head.lo),Math.abs(head.hi))),p(Math.max(...Object.values(g.bodyVolumes)))),p(g.ballRadiusM)).hi;
}

/** Preparation only. No root solver, source rewrite or accepted body sample. */
export function buildRootContactDomains(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry,bindingPlan:RootBindingPlan,
  ledgers:ReadonlyMap<string,RootWorkLedger>):RootDomainPlan {
  const g=validateBodyGeometry(geometry),ball=compileContactBall(source,g),fresh=classifyRootBindings(source,semantics),boundary=readBodyBoundaries(source);
  const issues:BodyIssue[]=[...ball.issues,...fresh.issues],contacts:RootContactDomain[]=[],localisations:Localisation[]=[],controls:Control[]=[],groups:Group[]=[],actors:Actor[]=[];
  const addIssue=(code:string,actorId:string|null=null,atMs:number|null=null,eventId:string|null=null,refs:readonly string[]=[])=>issues.push({code,actorId,atMs,eventId,refs:[...refs]});
  if(bindingPlan.status!=='ready'||fresh.key!==bindingPlan.key||JSON.stringify(fresh)!==JSON.stringify(bindingPlan))addIssue('invalid_root_binding_plan');
  if(!boundary.valid||g.ballRadiusM!==.11)addIssue('invalid_root_boundary_or_ball_geometry');
  const people=boundary.entry?.players??[];
  if(people.some(a=>!(ledgers.get(a.key) instanceof RootWorkLedger))||new Set(people.map(a=>ledgers.get(a.key))).size!==people.length)addIssue('invalid_actor_ledgers');
  const charge=(actorId:string,stage:'preparation'|'fk',atMs:number)=>{
    if(!ledgers.get(actorId)?.charge(stage,1)){addIssue('iteration_limit',actorId,atMs);return false;}return true;
  };
  const bindingLists=new Map<string,RootTimedRegion[]>(),times=new Map<string,Set<number>>();
  const bind=(actorId:string,atMs:number,region:RootRegion,provenance:string,refs:readonly string[])=>{
    const list=bindingLists.get(actorId)!;list.push({id:`${actorId}:${atMs}:${list.length}`,actorId,atMs,region,provenance,refs:[...refs],policyKey:VERSION});times.get(actorId)!.add(atMs);
  };
  const finish=():RootDomainPlan=>{
    const content={version:VERSION,domainKey:VERSION,sourceKey:source.key,semanticKey:semantics.key,bindingPlan:fresh,geometry:g,ball,
      actors,contacts,localisations,controls,groups,issues};
    const plan:RootDomainPlan=sealRootValue({...content,status:issues.length?'unavailable':'ready',key:JSON.stringify(content)});
    registrations.set(plan,new Map(ledgers));return plan;
  };
  if(issues.length)return finish();
  for(const person of people){
    bindingLists.set(person.key,[]);times.set(person.key,new Set([source.request.fromMs,source.request.toMs]));
    if(charge(person.key,'preparation',source.request.fromMs))bind(person.key,source.request.fromMs,
      {kind:'capsule',id:'entry',a:{x:person.x,y:person.y},b:{x:person.x,y:person.y},radiusM:0},'synthetic_entry',[]);
  }
  for(const b of fresh.observations){
    const o=b.observation;if(!o.actorId||!times.has(o.actorId))continue;
    charge(o.actorId,'preparation',o.sourceAtMs);times.get(o.actorId)!.add(o.sourceAtMs);
    if(b.localisation==='finite_actor_context')localisations.push({actorId:o.actorId,atMs:o.sourceAtMs,eventId:o.eventId,point:{...o.sourcePoint!},refs:[...o.refs],provenance:'recorded_event'});
  }
  for(const snapshot of fresh.snapshots){
    const actorId=snapshot.row.playerKey!;charge(actorId,'preparation',snapshot.atMs);times.get(actorId)!.add(snapshot.atMs);
    localisations.push({actorId,atMs:snapshot.atMs,eventId:snapshot.eventId,point:{...snapshot.row.point!},refs:[...snapshot.row.refs],provenance:'recorded_snapshot'});
  }
  const reach=controlReach(g);
  for(const a of ball.anchors.filter(a=>a.kind==='Carry')){
    const o=fresh.observations.find(b=>b.observation.eventId===a.eventId)!.observation;
    if(a.presentationEndMs>source.request.toMs){addIssue('unsupported_control_end',o.actorId,a.presentationEndMs,o.eventId,o.refs);continue;}
    const control={actorId:o.actorId!,eventId:o.eventId,fromMs:a.fromMs,toMs:a.presentationEndMs,start:a.start,end:a.end,reachM:reach,refs:[...o.refs]};controls.push(control);
    for(const [atMs,point] of [[control.fromMs,control.start],[control.toMs,control.end]] as const){
      charge(control.actorId,'preparation',atMs);bind(control.actorId,atMs,{kind:'capsule',id:'control-reach',a:{...point},b:{...point},radiusM:reach},'control_reach',o.refs);
    }
  }
  for(const person of people)for(const atMs of [...times.get(person.key)!].sort((a,b)=>a-b)){
    const observations=fresh.observations.filter(b=>b.observation.actorId===person.key&&b.observation.sourceAtMs===atMs),required=observations.filter(b=>b.observation.physicalContactRequired);
    const markers=localisations.filter(l=>l.actorId===person.key&&l.atMs===atMs),cache=new Map<string,{pose:BodyPoseInput;fk:Available}>();
    const sample=(pose:BodyPoseInput)=>{
      const key=poseKey(pose),old=cache.get(key);if(old)return old;
      if(!charge(person.key,'fk',atMs))return null;
      const result=sampleBodyGeometry(g,pose);if(result.status!=='available'){addIssue(result.reason,person.key,atMs);return null;}
      const value={pose,fk:result};cache.set(key,value);return value;
    };
    for(const binding of required){
      const o=binding.observation,xy=ball.sample(atMs);
      if(!xy){addIssue('ball_target_unavailable',person.key,atMs,o.eventId,o.refs);continue;}
      if(o.effector==='unknownSurface'&&o.role!=='block'){addIssue('unsupported_unknown_contact',person.key,atMs,o.eventId,o.refs);continue;}
      const original=describeBodyObservation(o,g,ball),base=sample(original.pose);if(!base)continue;
      const target=describeBodyContactTarget(g,base.fk,original.surface,xy),branches:RootContactBranch[]=[];
      if(target.ball.z<g.ballRadiusM||target.ball.z>g.joints.pelvisZ+reach){addIssue('height_envelope',person.key,atMs,o.eventId,o.refs);continue;}
      const templates:Template[]=o.effector==='unknownSurface'?['idle','leftFoot','rightFoot','header']:
        [o.effector==='head'?'header':o.effector==='rightHand'?'rightHandSave':o.effector==='leftHand'?'leftHandSave':o.effector==='leftFoot'?'leftFoot':'rightFoot'];
      for(const template of templates)for(let k=0;k<8;k++){
        const angle=original.pose.heading+k*Math.PI/4,heading=k===0?original.pose.heading:Math.atan2(Math.sin(angle),Math.cos(angle));
        const pose:BodyPoseInput={root:{x:0,y:0},heading,...g.actionTemplates[template]},value=sample(pose);if(!value)continue;
        const surfaces=o.effector==='unknownSurface'?value.fk.volumes.filter(v=>UNKNOWN_SURFACES.includes(v.id)):[value.fk.effectors[o.effector! as keyof Available['effectors']]];
        for(const surface of surfaces){
          const outerRegion=contactOuterCapsule(target.ball,g.ballRadiusM,surface);if(!outerRegion)continue;
          branches.push({id:`${o.eventId}:${template}:${k}:${surface.id}`,poseKey:poseKey(pose),template,pose,surfaceId:surface.id,outerRegion});
        }
      }
      if(!branches.length){addIssue('pose_domain_unresolved',person.key,atMs,o.eventId,o.refs);continue;}
      try{contacts.push({observation:o,ball:target.ball,ballProvenance:'recorded_xy_illustrative_height',branches,
        originalBranchId:branches.find(b=>b.poseKey===poseKey(original.pose)&&b.surfaceId===original.surface)?.id??null,
        originalRootSurrogate:{id:'old-root-surrogate',a:target.root,b:target.root,radiusM:.08},region:encloseRootCapsules(branches.map(b=>b.outerRegion))});
      }catch{addIssue('unresolved_contact_enclosure',person.key,atMs,o.eventId,o.refs);}
    }
    if(markers.length&&!cache.size)sample({root:{x:0,y:0},heading:0,...g.actionTemplates.idle});
    for(const marker of markers){
      try{const region=encloseRootCapsules([...cache.values()].map(v=>reflect(marker.point,v.fk.footprint[0])));
        bind(person.key,atMs,region,marker.provenance,marker.refs);
      }catch{addIssue('unresolved_localisation_enclosure',person.key,atMs,marker.eventId,marker.refs);}
    }
    for(const contact of contacts.filter(c=>c.observation.actorId===person.key&&c.observation.sourceAtMs===atMs))bind(person.key,atMs,contact.region,'contact_surface',contact.observation.refs);
    const atContacts=contacts.filter(c=>c.observation.sourceAtMs===atMs);
    if(atContacts.some(a=>atContacts.some(b=>distance(a.ball,b.ball)>1e-7||Math.abs(a.ball.z-b.ball.z)>1e-7)))addIssue('conflicting_ball_height_hypotheses',person.key,atMs);
    groups.push({actorId:person.key,atMs,poses:[...cache.values()].map(v=>v.pose)});
  }
  for(const person of people){
    const last=boundary.exit.players.find(p=>p.key===person.key)!,ordered=[...times.get(person.key)!].sort((a,b)=>a-b),bindings=bindingLists.get(person.key)!.sort((a,b)=>a.atMs-b.atMs);
    if(ordered.length>64){addIssue('node_limit',person.key);continue;}
    const nodes:PoseNode[]=ordered.map(atMs=>{const u=(atMs-source.request.fromMs)/(source.request.toMs-source.request.fromMs);
      return {atMs,pose:{root:{x:person.x+(last.x-person.x)*u,y:person.y+(last.y-person.y)*u},heading:0,...g.actionTemplates.idle}};});
    const own=groups.filter(group=>group.actorId===person.key),postCheckReserve=own.reduce((s,group)=>s+Math.max(1,group.poses.length),0);
    actors.push({actorId:person.key,fromMs:source.request.fromMs,toMs:source.request.toMs,entry:{x:person.x,y:person.y},exitPrior:{x:last.x,y:last.y},nodes,bindings,postCheckReserve});
  }
  return finish();
}

function capsuleDistance(point:Point,c:GroundCapsule):number {
  const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,length=dx*dx+dy*dy,u=length?Math.max(0,Math.min(1,((point.x-c.a.x)*dx+(point.y-c.a.y)*dy)/length)):0;
  return Math.hypot(point.x-c.a.x-u*dx,point.y-c.a.y-u*dy);
}
/** Recompute FK at supplied roots. This is only a node gate, never a body certificate. */
export function inspectRootNodeWitnesses(plan:RootDomainPlan,roots:readonly BodyRootTrack[],ledgers:ReadonlyMap<string,RootWorkLedger>):RootNodeWitnessReport {
  const issues:BodyIssue[]=[],witnesses:RootNodeWitnessReport['witnesses'][number][]=[];
  const add=(code:string,actorId:string|null=null,atMs:number|null=null)=>issues.push({code,actorId,atMs,eventId:null,refs:[]});
  const done=():RootNodeWitnessReport=>({status:issues.length?'unresolved':'witnessed',planKey:plan.key,issues,witnesses,bodyAccepted:false});
  const registered=registrations.get(plan);
  if(!registered||plan.status!=='ready'||roots.length!==plan.actors.length||new Set(roots.map(r=>r.actorId)).size!==roots.length
    ||plan.actors.some(a=>ledgers.get(a.actorId)!==registered.get(a.actorId)||!roots.some(r=>r.actorId===a.actorId))){add('invalid_root_witness_binding');return done();}
  for(const group of plan.groups){
    const track=roots.find(r=>r.actorId===group.actorId)!,span=track.spans.find(s=>s.fromMs<=group.atMs&&s.toMs>=group.atMs),ledger=ledgers.get(group.actorId)!;
    if(!span){add('missing_root_span',group.actorId,group.atMs);continue;}
    const root=pointAt(span,group.atMs);if(!fieldPoint(root)){add('invalid_root_point',group.actorId,group.atMs);continue;}
    const actor=plan.actors.find(a=>a.actorId===group.actorId)!;
    const entry=actor.bindings.find(b=>b.atMs===group.atMs&&b.provenance==='synthetic_entry');
    if(entry&&entry.region.kind==='capsule'&&distance(root,entry.region.a)>1e-7){add('entry_binding_failed',group.actorId,group.atMs);continue;}
    const markers=plan.localisations.filter(l=>l.actorId===group.actorId&&l.atMs===group.atMs),contacts=plan.contacts.filter(c=>c.observation.actorId===group.actorId&&c.observation.sourceAtMs===group.atMs);
    const controls=plan.controls.filter(c=>c.actorId===group.actorId&&(c.fromMs===group.atMs||c.toMs===group.atMs));
    if(controls.some(c=>distance(root,c.fromMs===group.atMs?c.start:c.end)>c.reachM+1e-7)){add('control_reach_failed',group.actorId,group.atMs);continue;}
    if(!contacts.length&&!markers.length){if(!ledger.charge('verification',1))add('iteration_limit',group.actorId,group.atMs);continue;}
    let found=false;
    for(const pose of group.poses){
      if(!ledger.charge('fk',1)){add('iteration_limit',group.actorId,group.atMs);break;}
      const fk=sampleBodyGeometry(plan.geometry,{...pose,root});if(fk.status!=='available')continue;
      if(markers.some(marker=>capsuleDistance(marker.point,fk.footprint[0])>fk.footprint[0].radiusM+1e-7))continue;
      const key=poseKey(pose);
      if(contacts.some(contact=>!contact.branches.some(branch=>{
        if(branch.poseKey!==key)return false;
        const surface=fk.volumes.find(v=>v.id===branch.surfaceId);if(!surface)return false;
        const error=contactSurfaceErrorM(contact.ball,plan.geometry.ballRadiusM,surface,contact.observation.effector);
        return error!==null&&error<=.08+1e-7;
      })))continue;
      found=true;witnesses.push({actorId:group.actorId,atMs:group.atMs,poseKey:key,contactEventIds:contacts.map(c=>c.observation.eventId)});break;
    }
    if(!found)add('pose_domain_unresolved',group.actorId,group.atMs);
  }
  return done();
}
