import { solveActorConstraints, type SolverReport } from './constraint-solver';
import { fieldPoint, hermiteSpan, inspectSpan, pointAt, preferredTangents, velocityAt, type Knot } from './curves';
import type { StagingConstraint, StagingSolverReport } from './performance-types';
import type { Point } from './types';

type Term={index:number;scale:number};
type Bound={terms:Term[];offset:Point;radius:number|null;correction:Point[];denominator:number;kind:string;fromMs:number;toMs:number;refs:readonly string[]};
type SolvedActor=Readonly<{spans:readonly ReturnType<typeof hermiteSpan>[];report:StagingSolverReport}>;
const zero=():Point=>({x:0,y:0});
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const fail=(status:SolverReport['status'],reason:string,iterations=0,maxResidual:number|null=null,maxChange:number|null=null):SolvedActor=>
  ({spans:[],report:{status,iterations,maxResidual,maxChange,maxSpeed:null,maxAcceleration:null,reasons:[reason],analyticCertificate:null}});

/** Positions inside action disks, exact snapshots, shared Hermite velocities.
 * Separate from V2: no change to its solver, coefficients, API or certificates.
 * Convex sufficient bounds use the derivative Bezier hull; exhaustion is NOT
 * an impossibility certificate. A continuous independent verifier is mandatory.
 */
export function solveStagingActor(actorId:string,input:readonly StagingConstraint[],exit:{atMs:number;target:Point}):SolvedActor {
  const at=[...new Set(input.map(c=>c.atMs))].sort((a,b)=>a-b);
  if(!at.length||at.length+(at.at(-1)===exit.atMs?0:1)>64)return fail('invalid_input','node_limit');
  if(input.some(c=>!fieldPoint(c.point)||!Number.isFinite(c.atMs)||!Number.isFinite(c.radiusM)||c.radiusM<0||c.radiusM>.65))return fail('invalid_input','invalid_node');
  // For |a|<=A, the means over two adjacent intervals obey
  // |vMean2-vMean1| <= A*(h+t)/2. Disks can reduce this difference
  // by at most ra/h + rb*(1/h+1/t) + rc/t (triangle inequality).
  // This necessary bound is independent of polynomial choice/solver convergence.
  const selected=at.map(t=>{const group=input.filter(c=>c.atMs===t);return group.find(c=>c.radiusM===0)??group[0];});
  for(let i=2;i<selected.length;i++){
    const [a,b,c]=selected.slice(i-2,i+1),h=(b.atMs-a.atMs)/1000,t=(c.atMs-b.atMs)/1000;
    if(h<=0||t<=0)return fail('invalid_input','invalid_duration');
    const u={x:(b.point.x-a.point.x)/h,y:(b.point.y-a.point.y)/h},v={x:(c.point.x-b.point.x)/t,y:(c.point.y-b.point.y)/t};
    const uncertainty=a.radiusM/h+b.radiusM*(1/h+1/t)+c.radiusM/t;
    const required=2*Math.max(0,distance(u,v)-uncertainty)/(h+t);
    if(required>4+1e-8){
      const failure=fail('constraint_conflict','analytic_disk_acceleration');
      return {...failure,report:{...failure.report,analyticCertificate:`Mean-velocity disk bound: acceleration >= ${required} m/s^2 > 4 between ${a.atMs}, ${b.atMs}, ${c.atMs}`,
        reachabilityWitness:{fromMs:a.atMs,viaMs:b.atMs,toMs:c.atMs,minRequiredAcceleration:required,limit:4,refs:[...new Set([a,b,c].flatMap(n=>n.refs))]}}};
    }
  }
  // A certificate from fixed constraints only is independent of root choices.
  const exact=input.filter(c=>c.radiusM===0).map(c=>({atMs:c.atMs,point:c.point,refs:c.refs}));
  if(exact.length>=2){
    const check=solveActorConstraints({actorId,hardKnots:exact,softExit:null},{maxSweeps:1});
    if(check.report.status==='constraint_conflict')return check;
  }
  if(at.at(-1)!==exit.atMs)at.push(exit.atMs);
  if(at.length<2||!fieldPoint(exit.target))return fail('invalid_input','invalid_exit');
  // A deterministic initial guess, not a softening of any recorded constraint.
  const knots:Knot[]=at.map(atMs=>{
    const own=input.filter(c=>c.atMs===atMs),fixed=own.find(c=>c.radiusM===0);
    const previous=[...exact].filter(k=>k.atMs<=atMs).sort((a,b)=>b.atMs-a.atMs)[0];
    const next=[...exact].filter(k=>k.atMs>=atMs).sort((a,b)=>a.atMs-b.atMs)[0];
    let point:Point=fixed?.point??(previous&&next&&previous.atMs!==next.atMs?
      {x:previous.point.x+(next.point.x-previous.point.x)*(atMs-previous.atMs)/(next.atMs-previous.atMs),y:previous.point.y+(next.point.y-previous.point.y)*(atMs-previous.atMs)/(next.atMs-previous.atMs)}:
      previous?.point??exit.target);
    if(!own.length)point=exit.target;
    for(let pass=0;pass<8;pass++)for(const c of own){const d=distance(point,c.point);if(d>c.radiusM)point=d===0?c.point:{x:c.point.x+(point.x-c.point.x)*c.radiusM/d,y:c.point.y+(point.y-c.point.y)*c.radiusM/d};}
    return {atMs,point:{...point},refs:own.flatMap(c=>c.refs)};
  });
  // Variables: n root velocities followed by n root positions (1s scale).
  const n=knots.length,variables:Point[]=[...preferredTangents(knots).map(p=>({...p})),...knots.map(k=>({...k.point}))],bounds:Bound[]=[];
  const add=(terms:Term[],offset:Point,radius:number|null,kind:string,fromMs:number,toMs=fromMs,refs:readonly string[]=[])=>
    bounds.push({terms,offset,radius,kind,fromMs,toMs,refs,correction:terms.map(zero),denominator:terms.reduce((v,t)=>v+t.scale*t.scale,0)});
  for(let i=0;i<n;i++){
    add([{index:i,scale:1}],zero(),9-1e-6,'speed_node',at[i]);add([{index:n+i,scale:1}],zero(),null,'field_node',at[i]);
    for(const c of input.filter(c=>c.atMs===at[i]))add([{index:n+i,scale:1}],{x:-c.point.x,y:-c.point.y},c.radiusM,c.provenance,at[i],at[i],c.refs);
  }
  for(let i=0;i<n-1;i++){
    const h=(at[i+1]-at[i])/1000;
    if(!Number.isFinite(h)||h<=0)return fail('invalid_input','invalid_duration');
    const relation=(a:number,b:number,p:number):Term[]=>[{index:i,scale:a},{index:i+1,scale:b},{index:n+i,scale:-p},{index:n+i+1,scale:p}];
    const refs=[...new Set([...knots[i].refs??[],...knots[i+1].refs??[]])];
    add(relation(-1,-1,3/h),zero(),9-1e-6,'speed_hull',at[i],at[i+1],refs);
    add(relation(-4/h,-2/h,6/(h*h)),zero(),4-1e-6,'acceleration_start',at[i],at[i+1],refs);
    add(relation(2/h,4/h,-6/(h*h)),zero(),4-1e-6,'acceleration_end',at[i],at[i+1],refs);
    add([{index:n+i,scale:1},{index:i,scale:h/3}],zero(),null,'field_control',at[i],at[i+1],refs);
    add([{index:n+i+1,scale:1},{index:i+1,scale:-h/3}],zero(),null,'field_control',at[i],at[i+1],refs);
  }
  const output=(b:Bound,points:readonly Point[])=>b.terms.reduce((p,t)=>({x:p.x+t.scale*points[t.index].x,y:p.y+t.scale*points[t.index].y}),{...b.offset});
  const residual=(b:Bound)=>{const p=output(b,variables);return b.radius===null?Math.max(0,-p.x,p.x-105,-p.y,p.y-68):Math.max(0,Math.hypot(p.x,p.y)-b.radius);};
  let maxResidual=0,maxChange=0,iteration=0;
  const maxSweeps=exact.length>=2?9999:10000;
  for(iteration=1;iteration<=maxSweeps;iteration++){
    const before=variables.map(p=>({...p}));
    for(const b of bounds){
      const corrected=b.terms.map((t,j)=>({x:variables[t.index].x+b.correction[j].x,y:variables[t.index].y+b.correction[j].y}));
      const p=b.terms.reduce((v,t,j)=>({x:v.x+t.scale*corrected[j].x,y:v.y+t.scale*corrected[j].y}),{...b.offset}),norm=Math.hypot(p.x,p.y);
      const target=b.radius===null?{x:Math.max(0,Math.min(105,p.x)),y:Math.max(0,Math.min(68,p.y))}:norm>b.radius?{x:p.x*b.radius/norm,y:p.y*b.radius/norm}:p;
      const d={x:p.x-target.x,y:p.y-target.y};
      b.terms.forEach((t,j)=>{const c={x:t.scale*d.x/b.denominator,y:t.scale*d.y/b.denominator};variables[t.index]={x:corrected[j].x-c.x,y:corrected[j].y-c.y};b.correction[j]=c;});
    }
    maxResidual=Math.max(...bounds.map(residual));maxChange=Math.max(...variables.map((p,i)=>distance(p,before[i])));
    if(!variables.every(finite)||!Number.isFinite(maxResidual)||!Number.isFinite(maxChange))return fail('not_converged','non_finite',iteration);
    if(maxResidual<=1e-7&&maxChange<=1e-9)break;
  }
  if(iteration>maxSweeps){
    const failedBounds=bounds.map(b=>({kind:b.kind,fromMs:b.fromMs,toMs:b.toMs,residual:residual(b),refs:[...b.refs]})).filter(b=>b.residual>1e-7).sort((a,b)=>b.residual-a.residual).slice(0,8);
    const failure=fail('not_converged','iteration_limit',maxSweeps,maxResidual,maxChange);
    return {...failure,report:{...failure.report,failedBounds}};
  }
  const actual=knots.map((k,i)=>({...k,point:variables[n+i]})),spans=actual.slice(1).map((k,i)=>hermiteSpan(actual[i],k,variables[i],variables[i+1]));
  const proofs=spans.map(inspectSpan),reasons=proofs.flatMap(p=>p.reasons);
  for(const c of input){const s=spans.find(s=>s.fromMs<=c.atMs&&s.toMs>=c.atMs);if(!s||distance(pointAt(s,c.atMs),c.point)>c.radiusM+1e-6)reasons.push('node_mismatch');}
  for(let i=1;i<spans.length;i++)if(distance(velocityAt(spans[i-1],spans[i].fromMs),velocityAt(spans[i],spans[i].fromMs))>1e-7)reasons.push('velocity_discontinuity');
  if(reasons.length)return fail('not_converged',`independent_verifier:${[...new Set(reasons)].join(',')}`,iteration,maxResidual,maxChange);
  return {spans,report:{status:'certified',iterations:iteration,maxResidual,maxChange,maxSpeed:Math.max(...proofs.map(p=>p.maxSpeed)),maxAcceleration:Math.max(...proofs.map(p=>p.maxAcceleration)),reasons:[],analyticCertificate:null}};
}
