import type { PreparedActorConstraints } from './constraints';
import { fieldPoint, hermiteSpan, inspectSpan, pointAt, preferredTangents, velocityAt, type CurveSpan, type Knot } from './curves';
import type { Point } from './types';

export type SolverReport = Readonly<{
  status:'certified'|'not_converged'|'invalid_input'|'constraint_conflict';
  iterations:number;maxResidual:number|null;maxChange:number|null;maxSpeed:number|null;maxAcceleration:number|null;
  reasons:readonly string[];analyticCertificate:string|null;
}>;
export type SolvedActor = Readonly<{spans:readonly CurveSpan[];report:SolverReport}>;
type Term=Readonly<{index:number;scale:number}>;
type Constraint={terms:readonly Term[];offset:Point;radius:number|null;denominator:number;correction:Point[]};
const SPEED=9,ACCELERATION=4,MARGIN=1e-6,RESIDUAL=1e-7,CHANGE=1e-9;
const finite=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const zero=():Point=>({x:0,y:0});
function seal<T>(v:T):T {if(v&&typeof v==='object'){Object.values(v).forEach(seal);Object.freeze(v);}return v;}
function failure(status:SolverReport['status'],reason:string,iterations=0,maxResidual:number|null=null,maxChange:number|null=null,certificate:string|null=null):SolvedActor {
  return seal({spans:[],report:{status,iterations,maxResidual,maxChange,maxSpeed:null,maxAcceleration:null,reasons:[reason],analyticCertificate:certificate}});
}

// Necessary scalar bounds only. Solver exhaustion is never an impossibility certificate.
function analyticConflict(knots:readonly Knot[]):string|null {
  for(let i=1;i<knots.length;i++){
    const a=knots[i-1],b=knots[i],h=(b.atMs-a.atMs)/1000,d=Math.hypot(b.point.x-a.point.x,b.point.y-a.point.y);
    if(d>SPEED*h+2e-6)return `Fixed displacement ${d} m exceeds ${SPEED} m/s * ${h} s between ${a.atMs} and ${b.atMs}`;
  }
  for(let i=2;i<knots.length;i++){
    const a=knots[i-2],b=knots[i-1],c=knots[i],h=(b.atMs-a.atMs)/1000,t=(c.atMs-b.atMs)/1000;
    for(const axis of ['x','y'] as const)for(const sign of [1,-1]){
      const v=Math.min(SPEED,sign*(b.point[axis]-a.point[axis])/h+ACCELERATION*h/2),cap=(SPEED-v)/ACCELERATION;
      const distance=t<=cap?v*t+ACCELERATION*t*t/2:(v+SPEED)*cap/2+SPEED*(t-cap);
      if(sign*(c.point[axis]-b.point[axis])>distance+2e-6){
        return `Scalar ${axis} reachability: exit bound ${b.point[axis]+sign*distance}, requested ${c.point[axis]}; |v|<=${SPEED}, |a|<=${ACCELERATION}`;
      }
    }
  }
  return null;
}

function output(q:Constraint,variables:readonly Point[]):Point {
  return q.terms.reduce((p,t)=>({x:p.x+t.scale*variables[t.index].x,y:p.y+t.scale*variables[t.index].y}),{...q.offset});
}
function residual(q:Constraint,variables:readonly Point[]):number {
  const p=output(q,variables);
  return q.radius===null?Math.max(0,-p.x,p.x-105,-p.y,p.y-68):Math.max(0,Math.hypot(p.x,p.y)-q.radius);
}

/** Deterministic projection onto sufficient convex Hermite bounds; no source or engine side effects. */
export function solveActorConstraints(input:PreparedActorConstraints,options?:Readonly<{maxSweeps?:number}>):SolvedActor {
  const maxSweeps=options?.maxSweeps===undefined?10000:options.maxSweeps;
  if(!Number.isInteger(maxSweeps)||maxSweeps<1||maxSweeps>10000)return failure('invalid_input','invalid_iteration_cap');
  if(!input.actorId||!input.hardKnots.length||input.hardKnots.length+(input.softExit?1:0)>64)return failure('invalid_input','invalid_node_count');
  const knots:Knot[]=[];
  for(const k of [...input.hardKnots].sort((a,b)=>a.atMs-b.atMs)){
    if(!Number.isFinite(k.atMs)||k.atMs<0||!fieldPoint(k.point))return failure('invalid_input','invalid_anchor');
    const previous=knots.at(-1);
    if(previous?.atMs===k.atMs){
      if(Math.hypot(previous.point.x-k.point.x,previous.point.y-k.point.y)>1e-6)return failure('constraint_conflict','contradictory_anchor',0,null,null,'Different hard positions at the same instant');
      knots[knots.length-1]={...previous,refs:[...new Set([...previous.refs??[],...k.refs??[]])]};
    }else knots.push({atMs:k.atMs,point:{...k.point},refs:[...k.refs??[]]});
  }
  const fixedCount=knots.length,exit=input.softExit;
  if(exit){
    if(!Number.isFinite(exit.atMs)||exit.atMs<=knots.at(-1)!.atMs||!fieldPoint(exit.target))return failure('invalid_input','invalid_soft_exit');
    knots.push({atMs:exit.atMs,point:{...exit.target},refs:[]});
  }
  if(knots.length<2)return failure('invalid_input','insufficient_anchors');
  const witness=analyticConflict(knots.slice(0,fixedCount));
  if(witness)return failure('constraint_conflict','analytic_reachability',0,null,null,witness);

  // Each variable is a 2D velocity; the optional last one is exit position / the fixed 1s reference.
  const variables:Point[]=[...preferredTangents(knots)],positionIndex=knots.length;
  if(exit)variables.push({...exit.target});
  const constraints:Constraint[]=[];
  const add=(terms:readonly Term[],offset:Point,radius:number|null)=>constraints.push({terms,offset,radius,
    denominator:terms.reduce((sum,t)=>sum+t.scale*t.scale,0),correction:terms.map(zero)});
  for(let i=0;i<knots.length;i++)add([{index:i,scale:1}],zero(),SPEED-MARGIN);
  for(let i=0;i<knots.length-1;i++){
    const a=knots[i],b=knots[i+1],h=(b.atMs-a.atMs)/1000,free=!!exit&&i+1===knots.length-1;
    if(!Number.isFinite(h)||h<=0)return failure('invalid_input','invalid_span_duration');
    const p=free?zero():b.point,d={x:p.x-a.point.x,y:p.y-a.point.y};
    const terms=(u:number,v:number,pos:number):Term[]=>[{index:i,scale:u},{index:i+1,scale:v},...(free?[{index:positionIndex,scale:pos}]:[])];
    add(terms(-1,-1,3/h),{x:3*d.x/h,y:3*d.y/h},SPEED-MARGIN);
    add(terms(-4/h,-2/h,6/(h*h)),{x:6*d.x/(h*h),y:6*d.y/(h*h)},ACCELERATION-MARGIN);
    add(terms(2/h,4/h,-6/(h*h)),{x:-6*d.x/(h*h),y:-6*d.y/(h*h)},ACCELERATION-MARGIN);
    add([{index:i,scale:h/3}],a.point,null);
    add([{index:i+1,scale:-h/3},...(free?[{index:positionIndex,scale:1}]:[])],p,null);
  }
  if(exit)add([{index:positionIndex,scale:1}],zero(),null);
  if(variables.some(p=>!finite(p))||constraints.some(q=>!finite(q.offset)||!Number.isFinite(q.denominator)||q.denominator<=0||q.terms.some(t=>!Number.isFinite(t.scale))))return failure('invalid_input','non_finite_constraint');

  let maxResidual=0,maxChange=0,iterations=0,converged=false;
  for(iterations=1;iterations<=maxSweeps;iterations++){
    const before=variables.map(p=>({...p}));
    for(const q of constraints){
      const corrected=q.terms.map((t,j)=>({x:variables[t.index].x+q.correction[j].x,y:variables[t.index].y+q.correction[j].y}));
      const value=q.terms.reduce((p,t,j)=>({x:p.x+t.scale*corrected[j].x,y:p.y+t.scale*corrected[j].y}),{...q.offset});
      const norm=Math.hypot(value.x,value.y);
      const target=q.radius===null?{x:Math.max(0,Math.min(105,value.x)),y:Math.max(0,Math.min(68,value.y))}
        :norm>q.radius?{x:value.x*q.radius/norm,y:value.y*q.radius/norm}:value;
      const difference={x:value.x-target.x,y:value.y-target.y};
      q.terms.forEach((t,j)=>{
        const correction={x:t.scale*difference.x/q.denominator,y:t.scale*difference.y/q.denominator};
        variables[t.index]={x:corrected[j].x-correction.x,y:corrected[j].y-correction.y};q.correction[j]=correction;
      });
    }
    maxResidual=Math.max(...constraints.map(q=>residual(q,variables)));
    maxChange=Math.max(...variables.flatMap((p,i)=>[Math.abs(p.x-before[i].x),Math.abs(p.y-before[i].y)]));
    if(!Number.isFinite(maxResidual)||!Number.isFinite(maxChange))return failure('not_converged','non_finite_iteration',iterations);
    if(maxResidual<=RESIDUAL&&maxChange<=CHANGE){converged=true;break;}
  }
  if(!converged)return failure('not_converged','iteration_limit',maxSweeps,maxResidual,maxChange);

  const actual=knots.map((k,i)=>({...k,point:exit&&i===knots.length-1?variables[positionIndex]:k.point}));
  const spans=actual.slice(1).map((b,i)=>hermiteSpan(actual[i],b,variables[i],variables[i+1]));
  const proofs=spans.map(inspectSpan),reasons=proofs.flatMap(p=>p.reasons);
  for(let i=0;i<spans.length;i++){
    for(const k of [actual[i],actual[i+1]]){const p=pointAt(spans[i],k.atMs);if(Math.hypot(p.x-k.point.x,p.y-k.point.y)>1e-6)reasons.push('endpoint_mismatch');}
    if(i){const t=spans[i].fromMs,a=velocityAt(spans[i-1],t),b=velocityAt(spans[i],t);if(Math.hypot(a.x-b.x,a.y-b.y)>1e-7)reasons.push('velocity_discontinuity');}
  }
  if(reasons.length)return failure('not_converged',`independent_verifier:${[...new Set(reasons)].join(',')}`,iterations,maxResidual,maxChange);
  return seal({spans,report:{status:'certified',iterations,maxResidual,maxChange,maxSpeed:Math.max(...proofs.map(p=>p.maxSpeed)),
    maxAcceleration:Math.max(...proofs.map(p=>p.maxAcceleration)),reasons:[],analyticCertificate:null}});
}
