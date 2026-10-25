import { fieldPoint,hermiteSpan,inspectSpan,preferredTangents } from './curves';
import type { Point } from './types';
import type { BodyActorInput,BodySolverReport,BodyRootTrack,GroundCapsule,PoseNode } from './contact-types';
import { RootWorkLedger,isValidRootRegion } from './root-feasibility';
import type { RootRegion } from './root-feasibility';

export type RootProjectionPolicy='legacy-inner-1'|'physical-1'|'physical-refined-1';
export type RootProjectionInput=Readonly<{
  actorId:string;fromMs:number;toMs:number;entry:Point;exitPrior:Point;nodes:readonly PoseNode[];
  constraints:readonly Readonly<{atMs:number;region:RootRegion;provenance:string}>[];
  postCheckReserve:number;
}>;
type Limits=Readonly<{speedMps:number;accelerationMps2:number}>;
const PHYSICAL:Limits=Object.freeze({speedMps:9,accelerationMps2:4});
const POLICIES:Readonly<Record<RootProjectionPolicy,Limits>>=Object.freeze({
  'legacy-inner-1':Object.freeze({speedMps:9-1e-6,accelerationMps2:4-1e-6}), 'physical-1':PHYSICAL,
  'physical-refined-1':PHYSICAL,
});
type FinalNode=Readonly<{atMs:number;root:Point;velocity:Point}>;
type SweepSummary=Readonly<{solverSweeps:number;targetMaxResidual:number;physicalMaxResidual:number;maxChange:number}>;
export type RootResidualFamilies=Readonly<{speedMps:number;accelerationMps2:number;fieldM:number;bindingM:number}>;
export type RootCurveIssue=Readonly<{fromMs:number;toMs:number;reasons:readonly string[];maxSpeed:number;maxAcceleration:number}>;
export type RootProjectionDiagnostics=Readonly<{finalNodes:readonly FinalNode[]|null;lastSweeps:readonly SweepSummary[];
  residualFamilies?:RootResidualFamilies|null;curveIssues?:readonly RootCurveIssue[];curveCheckStatus?:'not_run'|'passed'|'failed'}>;
const FAMILY_TOLERANCES:RootResidualFamilies=Object.freeze({speedMps:1e-9,accelerationMps2:1e-9,fieldM:1e-9,bindingM:1e-7});
export function isRefinedRootStopSatisfied(families:RootResidualFamilies,maxChange:number):boolean {
  return !!families&&Object.entries(FAMILY_TOLERANCES).every(([key,limit])=>{
    const value=families[key as keyof RootResidualFamilies];return Number.isFinite(value)&&value>=0&&value<=limit;
  })&&Number.isFinite(maxChange)&&maxChange>=0&&maxChange<=1e-9;
}
const emptyRefinedDiagnostics=()=>({residualFamilies:null,curveIssues:[] as RootCurveIssue[],curveCheckStatus:'not_run' as const});
export type RootProjectionResult=Readonly<{
  policy:RootProjectionPolicy;searchTargets:Limits|null;physicalLimits:Limits;reason:string;report:BodySolverReport;
  metrics:Readonly<{targetMaxResidual:number|null;physicalMaxResidual:number|null}>;diagnostics:RootProjectionDiagnostics;
}> & (Readonly<{status:'proposed';track:BodyRootTrack}>|Readonly<{status:'not_converged'|'invalid_input'|'exhausted';track?:never}>);
type Region=GroundCapsule|RootRegion;
type CoreActor=Omit<BodyActorInput,'constraints'> & Readonly<{constraints:readonly Readonly<{atMs:number;region:Region;provenance:string}>[]}>;
type CoreResult={track?:BodyRootTrack;report:BodySolverReport;reason:string;diagnostics:RootProjectionDiagnostics;physicalMaxResidual:number|null};
type Term={index:number;scale:number};
type Bound={terms:Term[];offset:Point;radius:number|null;region?:Region;kind:string;fromMs:number;toMs:number;corrections:Point[];denominator:number};
const zero=():Point=>({x:0,y:0}),distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const plus=(a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y});
const polygon=(r:Region):r is Extract<RootRegion,{kind:'polygon'}>=>'kind' in r&&r.kind==='polygon';
function representableRegion(region:RootRegion):boolean {
  if(!isValidRootRegion(region))return false;
  if(region.kind==='polygon')return true;
  const dx=region.b.x-region.a.x,dy=region.b.y-region.a.y,length=dx*dx+dy*dy;
  // Finite coordinates alone do not guarantee a representable projection.
  // An overflowing numerator/denominator must not turn a constraint into p=>p.
  return [dx,dy,length,...[0,105].flatMap(x=>[0,68].map(y=>(x-region.a.x)*dx+(y-region.a.y)*dy))].every(Number.isFinite);
}

/** Internal legacy adapter: no new diagnostics leak into BodySolveResult. */
export function projectLegacyBodyActor(actor:BodyActorInput):Pick<CoreResult,'track'|'report'|'reason'> {
  const r=solveActor(actor,'legacy-inner-1');
  return {...(r.track?{track:r.track}:{}),report:r.report,reason:r.reason};
}
/** Opt-in diagnostic only; scalar old reports cannot serve as inputs. */
export function projectRootActor(input:RootProjectionInput,ledger:RootWorkLedger,policy:RootProjectionPolicy):RootProjectionResult {
  const limits=POLICIES[policy];
  const invalid=(reason:string):RootProjectionResult=>({status:'invalid_input',policy,searchTargets:limits??null,physicalLimits:PHYSICAL,reason,
    report:{actorId:input?.actorId??'',status:'invalid_input',sweepsUsed:ledger instanceof RootWorkLedger?ledger.consumed:0,solverSweeps:0,
      maxResidual:null,maxChange:null,nodes:Array.isArray(input?.nodes)?input.nodes.length:0,fixedPositionCount:0,positionScaleM:1,velocityScaleMps:1,witnesses:[]},
    metrics:{targetMaxResidual:null,physicalMaxResidual:null},diagnostics:{finalNodes:null,lastSweeps:[],...(policy==='physical-refined-1'?emptyRefinedDiagnostics():{})}});
  if(!Object.hasOwn(POLICIES,policy)||!(ledger instanceof RootWorkLedger)||!input||typeof input.actorId!=='string'||!input.actorId
    ||!Array.isArray(input.nodes)||input.nodes.length<2||input.nodes.length>64||!Array.isArray(input.constraints)
    ||!Number.isSafeInteger(input.postCheckReserve)||input.postCheckReserve<0||input.postCheckReserve>9998)return invalid('invalid_projection_input_or_policy');
  try {
    if(input.nodes.some(n=>!Number.isSafeInteger(n.atMs)||!fieldPoint(n.pose?.root))
      ||input.constraints.some(c=>!representableRegion(c.region)||!Number.isSafeInteger(c.atMs)||typeof c.provenance!=='string'))return invalid('invalid_projection_region_or_node');
  }catch{return invalid('invalid_projection_region_or_node');}
  const actor:CoreActor={...input,budget:{maxNodes:64,maxSweeps:10000,sweepsUsed:ledger.consumed}};
  const r=solveActor(actor,policy,ledger,input.postCheckReserve),base={policy,searchTargets:limits,physicalLimits:PHYSICAL,reason:r.reason,report:r.report,
    metrics:{targetMaxResidual:r.report.maxResidual,physicalMaxResidual:r.physicalMaxResidual},diagnostics:r.diagnostics};
  if(r.track)return {...base,status:'proposed',track:r.track};
  return {...base,status:r.report.status==='invalid_input'?'invalid_input':r.reason==='iteration_limit'&&r.report.solverSweeps===0?'exhausted':'not_converged'};
}
function solveActor(actor:CoreActor,policy:RootProjectionPolicy,ledger?:RootWorkLedger,postCheckReserve=0):CoreResult {
  const limits=POLICIES[policy],reserve=1+postCheckReserve,refined=policy==='physical-refined-1';
  let residualFamilies:RootResidualFamilies|null=null,curveCheckStatus:'not_run'|'passed'|'failed'='not_run';
  const curveIssues:RootCurveIssue[]=[];
  const extraDiagnostics=()=>refined?{residualFamilies,curveIssues:[...curveIssues],curveCheckStatus}:{};
  let physicalMaxResidual:number|null=null;const lastSweeps:SweepSummary[]=[];
  let capture:()=>RootProjectionDiagnostics=()=>({finalNodes:null,lastSweeps:[...lastSweeps],...extraDiagnostics()});
  const nodes=actor.nodes,n=nodes.length,remaining=10000-actor.budget.sweepsUsed;
  let used=actor.budget.sweepsUsed,solverSweeps=0,maxResidual:number|null=null,maxChange:number|null=null;
  const gaps=nodes.slice(1).map((b,i)=>(b.atMs-nodes[i].atMs)/1000),timeScale=Math.min(.5,...gaps),positionScale=Math.max(1,9*timeScale),velocityScale=positionScale/timeScale;
  const fixed=new Map<number,Point>();
  const report=(status:BodySolverReport['status'],witnesses:BodySolverReport['witnesses']=[]):BodySolverReport=>({actorId:actor.actorId,status,
    sweepsUsed:used,solverSweeps,maxResidual,maxChange,nodes:n,fixedPositionCount:fixed.size,positionScaleM:positionScale,velocityScaleMps:velocityScale,witnesses});
  const fail=(reason:string,status:BodySolverReport['status']='invalid_input',w:BodySolverReport['witnesses']=[])=>({report:report(status,w),reason,diagnostics:capture(),physicalMaxResidual});
  if(n<2||n>64||actor.budget.maxNodes!==64||actor.budget.maxSweeps!==10000||!Number.isInteger(used)||used<0||used>10000
    ||gaps.some(h=>!Number.isFinite(h)||h<=0)||nodes[0].atMs!==actor.fromMs||nodes.at(-1)!.atMs!==actor.toMs
    ||!fieldPoint(actor.entry)||!fieldPoint(actor.exitPrior))return fail('invalid_nodes_or_budget');
  if(remaining<reserve+1)return fail('iteration_limit','not_converged');
  for(const c of actor.constraints){
    const i=nodes.findIndex(n=>n.atMs===c.atMs),r=c.region;
    if(i<0)return fail('invalid_constraint');
    if(polygon(r)){if(!isValidRootRegion(r))return fail('invalid_constraint');continue;}
    if(![r.a.x,r.a.y,r.b.x,r.b.y,r.radiusM].every(Number.isFinite)||r.radiusM<0)return fail('invalid_constraint');
    if(r.radiusM===0&&distance(r.a,r.b)<1e-12){
      const previous=fixed.get(i);if(previous&&distance(previous,r.a)>1e-12)return fail('conflicting_fixed_nodes');
      fixed.set(i,{...r.a});
    }
  }
  if(!fixed.has(0)||distance(fixed.get(0)!,actor.entry)>1e-12)return fail('missing_fixed_entry');
  const origin=actor.entry,positions=nodes.map((node,i)=>fixed.get(i)??node.pose.root),preferred=preferredTangents(nodes.map((node,i)=>({atMs:node.atMs,point:positions[i]})));
  const variables:Point[]=preferred.map(v=>({x:v.x/velocityScale,y:v.y/velocityScale})),scales:number[]=nodes.map(()=>velocityScale),indices:number[]=[];
  for(let i=0;i<n;i++){
    indices[i]=fixed.has(i)?-1:variables.length;
    if(!fixed.has(i)){variables.push({x:(positions[i].x-origin.x)/positionScale,y:(positions[i].y-origin.y)/positionScale});scales.push(positionScale);}
  }
  capture=()=>{
    const finalNodes=nodes.map((node,i)=>({atMs:node.atMs,root:{...(fixed.get(i)??{x:origin.x+variables[indices[i]].x*positionScale,y:origin.y+variables[indices[i]].y*positionScale})},
      velocity:{x:variables[i].x*velocityScale,y:variables[i].y*velocityScale}}));
    return {finalNodes:finalNodes.every(n=>[n.root.x,n.root.y,n.velocity.x,n.velocity.y].every(Number.isFinite))?finalNodes:null,lastSweeps:[...lastSweeps],...extraDiagnostics()};
  };
  const bounds:Bound[]=[];
  const add=(v:readonly [number,number][],p:readonly [number,number][],radius:number|null,kind:string,fromMs:number,toMs=fromMs,region?:Region)=>{
    const terms:Term[]=v.map(([index,scale])=>({index,scale:scale*velocityScale}));let offset=zero();
    for(const [i,scale] of p){const f=fixed.get(i);if(f)offset=plus(offset,{x:scale*f.x,y:scale*f.y});
      else {offset=plus(offset,{x:scale*origin.x,y:scale*origin.y});terms.push({index:indices[i],scale:scale*positionScale});}}
    bounds.push({terms,offset,radius,region,kind,fromMs,toMs,corrections:terms.map(zero),denominator:terms.reduce((s,t)=>s+t.scale*t.scale,0)});
  };
  for(let i=0;i<n;i++){
    add([[i,1]],[],limits.speedMps,'speed_node',nodes[i].atMs);add([],[[i,1]],null,'field_node',nodes[i].atMs);
    for(const c of actor.constraints.filter(c=>c.atMs===nodes[i].atMs))if(polygon(c.region)||c.region.radiusM!==0||distance(c.region.a,c.region.b)>1e-12)
      add([],[[i,1]],polygon(c.region)?null:c.region.radiusM,c.provenance,c.atMs,c.atMs,c.region);
  }
  for(let i=0;i<n-1;i++){
    const h=gaps[i],a=nodes[i].atMs,b=nodes[i+1].atMs;
    add([[i,-1],[i+1,-1]],[[i,-3/h],[i+1,3/h]],limits.speedMps,'speed_hull',a,b);
    add([[i,-4/h],[i+1,-2/h]],[[i,-6/h**2],[i+1,6/h**2]],limits.accelerationMps2,'acceleration_start',a,b);
    add([[i,2/h],[i+1,4/h]],[[i,6/h**2],[i+1,-6/h**2]],limits.accelerationMps2,'acceleration_end',a,b);
    add([[i,h/3]],[[i,1]],null,'field_control',a,b);add([[i+1,-h/3]],[[i+1,1]],null,'field_control',a,b);
  }
  const output=(bound:Bound,values=variables)=>bound.terms.reduce((p,t)=>({x:p.x+t.scale*values[t.index].x,y:p.y+t.scale*values[t.index].y}),{...bound.offset});
  const target=(b:Bound,p:Point,physical=false):Point=>{
    if(b.region&&polygon(b.region))return projectPolygon(b.region.vertices,p);
    if(b.region){const c=b.region as GroundCapsule,dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,len=dx*dx+dy*dy,
      u=len?Math.max(0,Math.min(1,((p.x-c.a.x)*dx+(p.y-c.a.y)*dy)/len)):0,
      q={x:c.a.x+u*dx,y:c.a.y+u*dy},d=distance(p,q);return d>c.radiusM?{x:q.x+(p.x-q.x)*c.radiusM/d,y:q.y+(p.y-q.y)*c.radiusM/d}:p;}
    if(b.radius===null)return {x:Math.max(0,Math.min(105,p.x)),y:Math.max(0,Math.min(68,p.y))};
    const radius=physical?(b.kind.startsWith('speed_')?9:b.kind.startsWith('acceleration_')?4:b.radius):b.radius;
    const d=Math.hypot(p.x,p.y);return d>radius?{x:p.x*radius/d,y:p.y*radius/d}:p;
  };
  const residual=(b:Bound)=>{const p=output(b);return distance(p,target(b,p));};
  // Region provenance is arbitrary: a binding named speed_* is still a binding.
  const family=(b:Bound):keyof RootResidualFamilies=>b.region?'bindingM':b.radius===null?'fieldM':b.kind.startsWith('speed_')?'speedMps':'accelerationMps2';
  let converged=false;
  while(used<10000-reserve){
    const before=variables.map(p=>({...p}));
    if(ledger&&!ledger.charge('solver',1))return fail('iteration_limit','not_converged');
    used++;solverSweeps++;
    for(const b of bounds){
      if(b.denominator===0)continue;
      const corrected=b.terms.map((t,i)=>plus(variables[t.index],b.corrections[i]));
      const p=b.terms.reduce((a,t,i)=>({x:a.x+t.scale*corrected[i].x,y:a.y+t.scale*corrected[i].y}),{...b.offset}),q=target(b,p),delta={x:p.x-q.x,y:p.y-q.y};
      b.terms.forEach((t,i)=>{const correction={x:t.scale*delta.x/b.denominator,y:t.scale*delta.y/b.denominator};
        variables[t.index]={x:corrected[i].x-correction.x,y:corrected[i].y-correction.y};b.corrections[i]=correction;});
    }
    const residuals=bounds.map(residual);
    maxResidual=Math.max(0,...residuals);maxChange=Math.max(0,...variables.map((p,i)=>distance(p,before[i])*scales[i]));
    if(refined){
      const values={speedMps:0,accelerationMps2:0,fieldM:0,bindingM:0};
      bounds.forEach((b,i)=>{const key=family(b);values[key]=Math.max(values[key],residuals[i]);});
      residualFamilies=values;
    }
    if(ledger){
      physicalMaxResidual=Math.max(0,...bounds.map(b=>{const p=output(b);return distance(p,target(b,p,true));}));
      lastSweeps.push({solverSweeps,targetMaxResidual:maxResidual,physicalMaxResidual,maxChange});
      if(lastSweeps.length>8)lastSweeps.shift();
    }
    if(!Number.isFinite(maxResidual)||!Number.isFinite(maxChange))return fail('non_finite','not_converged');
    if(refined?isRefinedRootStopSatisfied(residualFamilies!,maxChange):maxResidual<=1e-7&&maxChange<=1e-9){converged=true;break;}
  }
  if(!converged){
    const w=bounds.map(b=>({kind:b.kind,fromMs:b.fromMs,toMs:b.toMs,residual:residual(b),limit:refined?FAMILY_TOLERANCES[family(b)]:1e-7}))
      .filter(w=>w.residual>w.limit).sort((a,b)=>b.residual-a.residual).slice(0,8).map(({limit:_,...w})=>w);
    return fail('iteration_limit','not_converged',w);
  }
  if(ledger&&!ledger.charge('verification',1))return fail('iteration_limit','not_converged');
  used++; // root-curve postcheck shares the same budget, never a fresh subsolve.
  const roots=nodes.map((node,i)=>({atMs:node.atMs,point:fixed.get(i)??{x:origin.x+variables[indices[i]].x*positionScale,y:origin.y+variables[indices[i]].y*positionScale}}));
  const velocity=(i:number)=>({x:variables[i].x*velocityScale,y:variables[i].y*velocityScale});
  const spans=roots.slice(1).map((b,i)=>hermiteSpan(roots[i],b,velocity(i),velocity(i+1)));
  if(refined){
    for(const span of spans){
      const inspection=inspectSpan(span);
      if(inspection.reasons.length)curveIssues.push({fromMs:span.fromMs,toMs:span.toMs,reasons:[...inspection.reasons],maxSpeed:inspection.maxSpeed,maxAcceleration:inspection.maxAcceleration});
    }
    curveCheckStatus=curveIssues.length?'failed':'passed';
    if(curveIssues.length)return fail('root_curve_postcheck','not_converged');
  }else if(spans.some(s=>inspectSpan(s).reasons.length))return fail('root_curve_postcheck','not_converged');
  return {track:{actorId:actor.actorId,spans,poseNodes:nodes.map((node,i)=>({...node,pose:{...node.pose,root:{...roots[i].point}}}))},report:report('proposed'),reason:'',diagnostics:capture(),physicalMaxResidual};
}

function projectPolygon(vertices:readonly Point[],p:Point):Point {
  let inside=true,best:Point={...p},bestDistance=Infinity;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length],dx=b.x-a.x,dy=b.y-a.y;
    if(dx*(p.y-a.y)-dy*(p.x-a.x)<0)inside=false;
    const length=dx*dx+dy*dy,u=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
    const q={x:a.x+u*dx,y:a.y+u*dy},d=distance(p,q);
    if(d<bestDistance){bestDistance=d;best=q;}
  }
  return inside?p:best;
}
