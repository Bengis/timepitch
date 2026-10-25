import { prepareBodyConstraints } from './body-constraints';
import { solveBodyConstraints } from './body-solver';
import { sampleBodyGeometry } from './body-kinematics';
import { pointAt } from './curves';
import type { BodyGeometry,BodyContactCandidate,SemanticSequence,BodyPoseInput,BodyRootTrack,BodyContactSample,BodyGeometrySample,MetricPoint } from './contact-types';
import type { SequenceSource,Point } from './types';
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
function poseAt(track:BodyRootTrack,t:number):BodyPoseInput|null {
  const span=track.spans.find(s=>t>=s.fromMs&&t<=s.toMs);if(!span)return null;
  const exact=track.poseNodes.find(n=>n.atMs===t);if(exact)return {...exact.pose,root:pointAt(span,t)};
  const a=track.poseNodes.filter(n=>n.atMs<t).at(-1),b=track.poseNodes.find(n=>n.atMs>t);if(!a||!b)return null;
  const u=(t-a.atMs)/(b.atMs-a.atMs),names=[...new Set([...Object.keys(a.pose.angles),...Object.keys(b.pose.angles)])] as (keyof BodyPoseInput['angles'])[];
  const angles=Object.fromEntries(names.map(k=>[k,(a.pose.angles[k]??0)+((b.pose.angles[k]??0)-(a.pose.angles[k]??0))*u]));
  const delta=Math.atan2(Math.sin(b.pose.heading-a.pose.heading),Math.cos(b.pose.heading-a.pose.heading));
  const mode=a.pose.supportMode===b.pose.supportMode?a.pose.supportMode:'dive';
  return {root:pointAt(span,t),heading:a.pose.heading+delta*u,angles,supportMode:mode,
    supportingFeet:mode==='dive'?[]:a.pose.supportingFeet.filter(f=>b.pose.supportingFeet.includes(f))};
}
const segmentDistance=(p:MetricPoint,a:MetricPoint,b:MetricPoint)=>{
  const v={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},l=v.x*v.x+v.y*v.y+v.z*v.z,
    u=l?Math.max(0,Math.min(1,((p.x-a.x)*v.x+(p.y-a.y)*v.y+(p.z-a.z)*v.z)/l)):0;
  return Math.hypot(p.x-a.x-u*v.x,p.y-a.y-u*v.y,p.z-a.z-u*v.z);
};
/** Complete diagnostic or no tracks. No runtime integration/acceptance or clock state. */
export function compileBodyContactCandidate(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry):BodyContactCandidate {
  const prepared=prepareBodyConstraints(source,semantics,geometry),solved=solveBodyConstraints(prepared),issues=[...solved.issues],reports=solved.reports.map(r=>({...r}));
  const key=JSON.stringify([prepared.key,'diagnostic-body-candidate-1']),base={profile:'historical-body-contact-1' as const,key,
    sourceKey:source.key,geometryKey:prepared.geometry.key,semanticKey:semantics.key,issues,diagnostics:{prepared,reports}};
  const unavailable=():BodyContactCandidate=>({...base,status:'unavailable',sample:()=>null});
  if(solved.status!=='proposed')return unavailable();
  const add=(code:string,actorId:string,eventId:string|null,atMs:number,refs:readonly string[]=[],detail?:string)=>issues.push({code,actorId,eventId,atMs,refs:[...refs],detail});
  const nodeSamples=new Map<string,Map<number,Extract<BodyGeometrySample,{status:'available'}>>>();
  for(const track of solved.tracks){
    const report=reports.find(r=>r.actorId===track.actorId)!,samples=new Map<number,Extract<BodyGeometrySample,{status:'available'}>>();nodeSamples.set(track.actorId,samples);
    for(const node of track.poseNodes){
      if(report.sweepsUsed>=10000){add('iteration_limit',track.actorId,null,node.atMs);break;}report.sweepsUsed++;
      const sampled=sampleBodyGeometry(prepared.geometry,node.pose);
      if(sampled.status==='available')samples.set(node.atMs,sampled);else add(sampled.reason,track.actorId,null,node.atMs);
    }
    // A known failed planting cannot be handed off as a candidate. This is only
    // a necessary endpoint test; continuous certification still belongs to phase 3.
    for(let i=1;i<track.poseNodes.length;i++){
      const a=track.poseNodes[i-1],b=track.poseNodes[i],p=samples.get(a.atMs),q=samples.get(b.atMs);if(!p||!q)continue;
      for(const foot of a.pose.supportingFeet.filter(f=>b.pose.supportingFeet.includes(f))){
        const drift=distance(p.effectors[foot].a,q.effectors[foot].a);
        if(drift>.03+1e-8)add('stance_template_drift',track.actorId,null,b.atMs,[],`${foot}: ${drift} m > 0.03`);
      }
    }
  }
  for(const c of prepared.constraints){
    const body=nodeSamples.get(c.actorId)?.get(c.atMs);if(!body)continue;
    const root=body.pose.root,r=c.region,dx=r.b.x-r.a.x,dy=r.b.y-r.a.y,len=dx*dx+dy*dy,
      u=len?Math.max(0,Math.min(1,((root.x-r.a.x)*dx+(root.y-r.a.y)*dy)/len)):0;
    if(distance(root,{x:r.a.x+u*dx,y:r.a.y+u*dy})>r.radiusM+1e-7)add('binding_postcheck',c.actorId,c.eventId,c.atMs,c.refs);
  }
  for(const c of prepared.contacts){
    const o=c.observation,body=nodeSamples.get(o.actorId!)?.get(o.sourceAtMs);if(!body)continue;
    const surface=body.effectors[c.surface],error=Math.abs(segmentDistance(c.ball,surface.a,surface.b)-surface.radiusM-prepared.geometry.ballRadiusM);
    if(error>.08+1e-7)add('contact_postcheck',o.actorId!,o.eventId,o.sourceAtMs,o.refs,`${error} m`);
  }
  if(issues.length)return unavailable();
  const heights=new Map<number,number>();
  for(const a of prepared.ball.anchors){heights.set(a.fromMs,prepared.geometry.ballRadiusM);heights.set(a.presentationEndMs,prepared.geometry.ballRadiusM);}
  for(const c of prepared.contacts)heights.set(c.observation.sourceAtMs,c.ball.z);
  const h=[...heights].sort(([a],[b])=>a-b),g=prepared.geometry,
    reach=Math.max(Math.hypot(g.joints.shoulderY,g.joints.shoulderZ-g.joints.pelvisZ)+g.joints.upperArm+g.joints.forearm,
      Math.hypot(g.joints.hipY,0)+g.joints.thigh+g.joints.shin,g.joints.headZ-g.joints.pelvisZ),
    maxHeight=g.joints.pelvisZ+reach+Math.max(...Object.values(g.bodyVolumes))+g.ballRadiusM;
  if(h.some(([,z])=>!Number.isFinite(z)||z<g.ballRadiusM||z>maxHeight)){add('height_envelope','ball',null,prepared.fromMs);return unavailable();}
  const ballHeightKnots=h.map(([atMs,heightM])=>({atMs,heightM,provenance:'illustrative_contact_envelope' as const}));
  const actorIds=new Set(solved.tracks.map(t=>t.actorId)),playerCuts=source.cuts.filter(c=>c.entityIds==='all'||c.entityIds.some(id=>actorIds.has(id)))
    .map(c=>({fromMs:c.fromMs,toMs:c.toMs}));
  return {...base,status:'proposed',tracks:solved.tracks,ballHeightKnots,sample(t){
    if(!Number.isFinite(t)||t<prepared.fromMs||t>prepared.toMs)return null;
    if(playerCuts.some(c=>c.fromMs!==null&&c.toMs!==null&&t>=c.fromMs&&t<=c.toMs))return null;
    const actors:BodyContactSample['actors'][number][]=[];
    for(const track of solved.tracks){const pose=poseAt(track,t);if(!pose)return null;const body=sampleBodyGeometry(prepared.geometry,pose);if(body.status!=='available')return null;actors.push({actorId:track.actorId,body});}
    const xy=prepared.ball.sample(t);if(!xy)return null;
    const before=h.filter(([at])=>at<=t).at(-1),after=h.find(([at])=>at>=t);if(!before||!after)return null;
    const z=before[0]===after[0]?before[1]:before[1]+(after[1]-before[1])*(t-before[0])/(after[0]-before[0]);
    return {atMs:t,actors,ball:{...xy,z},ballProvenance:'recorded_xy_illustrative_height',bindings:prepared.constraints.filter(c=>c.atMs===t&&c.provenance!=='contact_surface').map(c=>{
      const root=actors.find(a=>a.actorId===c.actorId)!.body.pose.root,offset={x:root.x-c.sourcePoint.x,y:root.y-c.sourcePoint.y};
      return {eventId:c.eventId,actorId:c.actorId,sourcePoint:{...c.sourcePoint},root:{...root},offset,offsetM:Math.hypot(offset.x,offset.y)};
    })};
  }};
}
