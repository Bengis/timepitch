import type { Point } from './types';

export type Knot = Readonly<{atMs:number;point:Point;refs?:readonly string[]}>;
export type CurveSpan = Readonly<{fromMs:number;toMs:number;x:readonly number[];y:readonly number[];refs:readonly string[]}>;
export type CurveIssue = Readonly<{fromMs:number;toMs:number;reasons:readonly string[];refs:readonly string[]}>;
const value = (p:readonly number[],u:number) => p.reduceRight((sum,c)=>sum*u+c,0);
const derivative = (p:readonly number[]) => p.slice(1).map((c,i)=>c*(i+1));
const square = (p:readonly number[]) => {const out=Array(p.length*2-1).fill(0) as number[];p.forEach((a,i)=>p.forEach((b,j)=>{out[i+j]+=a*b;}));return out;};
const sum = (a:readonly number[],b:readonly number[]) => Array.from({length:Math.max(a.length,b.length)},(_,i)=>(a[i]??0)+(b[i]??0));
export const fieldPoint = (p:Point|null|undefined):p is Point => !!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=105&&p.y>=0&&p.y<=68;

// Isolate roots by derivative critical points, then bisect monotone intervals.
// Checking derivative roots also retains repeated/tangent roots without sign changes.
export function rootsInUnitInterval(coefficients:readonly number[]):number[] {
  const scale=Math.max(...coefficients.map(Math.abs),1),p=[...coefficients];
  while(p.length>1&&Math.abs(p.at(-1)!)<=1e-12*scale)p.pop();
  if(p.length<=1)return [];
  const boundaries=[0,...rootsInUnitInterval(derivative(p)),1],roots:number[]=[];
  for(const u of boundaries)if(Math.abs(value(p,u))<=1e-10*scale)roots.push(u);
  for(let i=1;i<boundaries.length;i++){
    let lo=boundaries[i-1],hi=boundaries[i],a=value(p,lo);const b=value(p,hi);
    if(a*b>=0)continue;
    for(let n=0;n<60;n++){const mid=(lo+hi)/2,c=value(p,mid);if(a*c<=0)hi=mid;else{lo=mid;a=c;}}
    roots.push((lo+hi)/2);
  }
  return roots.sort((a,b)=>a-b).filter((u,i,list)=>i===0||Math.abs(u-list[i-1])>1e-8);
}
export function hermiteSpan(a:Knot,b:Knot,v0:Point,v1:Point):CurveSpan {
  const seconds=(b.atMs-a.atMs)/1000;
  const coefficients=(key:'x'|'y')=>{const delta=b.point[key]-a.point[key];return [a.point[key],seconds*v0[key],3*delta-seconds*(2*v0[key]+v1[key]),-2*delta+seconds*(v0[key]+v1[key])];};
  return {fromMs:a.atMs,toMs:b.atMs,x:coefficients('x'),y:coefficients('y'),refs:[...new Set([...a.refs??[],...b.refs??[]])]};
}
export function pointAt(span:CurveSpan,time:number):Point {
  if(time<span.fromMs||time>span.toMs||!Number.isFinite(time)||span.toMs<=span.fromMs)throw new RangeError('Curve outside domain');
  const u=(time-span.fromMs)/(span.toMs-span.fromMs);return {x:value(span.x,u),y:value(span.y,u)};
}
export function velocityAt(span:CurveSpan,time:number):Point {
  const seconds=(span.toMs-span.fromMs)/1000,u=(time-span.fromMs)/(span.toMs-span.fromMs);
  return {x:value(derivative(span.x),u)/seconds,y:value(derivative(span.y),u)/seconds};
}
export function inspectSpan(span:CurveSpan) {
  const seconds=(span.toMs-span.fromMs)/1000,reasons:string[]=[];
  if(!Number.isFinite(seconds)||seconds<=0||[...span.x,...span.y].some(v=>!Number.isFinite(v)))return {maxSpeed:Infinity,maxAcceleration:Infinity,reasons:['invalid_curve']};
  const vx=derivative(span.x).map(c=>c/seconds),vy=derivative(span.y).map(c=>c/seconds);
  const ax=derivative(vx).map(c=>c/seconds),ay=derivative(vy).map(c=>c/seconds);
  const speed2=sum(square(vx),square(vy)),acceleration2=sum(square(ax),square(ay));
  const maximum=(p:readonly number[])=>Math.sqrt(Math.max(0,...[0,1,...rootsInUnitInterval(derivative(p))].map(u=>value(p,u))));
  const maxSpeed=maximum(speed2),maxAcceleration=maximum(acceleration2);
  if(maxSpeed>9+1e-8)reasons.push('speed_limit');if(maxAcceleration>4+1e-8)reasons.push('acceleration_limit');
  for(const [p,extent] of [[span.x,105],[span.y,68]] as const){
    if([0,1,...rootsInUnitInterval(derivative(p))].some(u=>value(p,u)<-1e-8||value(p,u)>extent+1e-8))reasons.push('field_bounds');
  }
  return {maxSpeed,maxAcceleration,reasons:[...new Set(reasons)]};
}
// Legacy per-axis estimate: V1 uses it unchanged; the joint solver uses only a soft prior.
export function preferredTangents(knots:readonly Knot[]):readonly Point[] {
  if(knots.length<2)return knots.map(()=>({x:0,y:0}));
  const secants=knots.slice(1).map((b,i)=>{const a=knots[i],h=(b.atMs-a.atMs)/1000;return {h,x:(b.point.x-a.point.x)/h,y:(b.point.y-a.point.y)/h};});
  return knots.map((_,i)=>{
    const a=secants[i-1],b=secants[i];
    const component=(key:'x'|'y')=>{
      if(!a||!b)return (a??b)[key];
      if(a[key]*b[key]<=0)return 0;
      const w1=2*b.h+a.h,w2=b.h+2*a.h;
      return Math.sign(a[key])*Math.min(Math.abs((w1+w2)/(w1/a[key]+w2/b[key])),3*Math.min(Math.abs(a[key]),Math.abs(b[key])));
    };
    const v={x:component('x'),y:component('y')},speed=Math.hypot(v.x,v.y);
    return speed>9?{x:v.x*9/speed,y:v.y*9/speed}:v;
  });
}
export function compileActorCurve(input:readonly Knot[]):{spans:readonly CurveSpan[];issues:readonly CurveIssue[]} {
  const knots:Knot[]=[],issues:CurveIssue[]=[];
  for(const k of [...input].sort((a,b)=>a.atMs-b.atMs)){
    if(!Number.isFinite(k.atMs)||!fieldPoint(k.point)){issues.push({fromMs:k.atMs,toMs:k.atMs,reasons:['invalid_anchor'],refs:k.refs??[]});continue;}
    const prior=knots.at(-1);
    if(prior?.atMs===k.atMs){
      if(Math.hypot(prior.point.x-k.point.x,prior.point.y-k.point.y)>1e-6)issues.push({fromMs:k.atMs,toMs:k.atMs,reasons:['contradictory_anchor'],refs:[...prior.refs??[],...k.refs??[]]});
      else knots[knots.length-1]={...prior,refs:[...new Set([...prior.refs??[],...k.refs??[]])]};
    }else knots.push(k);
  }
  if(knots.length<2)return {spans:[],issues:issues.length?issues:[{fromMs:knots[0]?.atMs??0,toMs:knots[0]?.atMs??0,reasons:['insufficient_anchors'],refs:[]}]};
  const velocities=preferredTangents(knots);
  const spans=knots.slice(1).map((b,i)=>{
    const a=knots[i],span=hermiteSpan(a,b,velocities[i],velocities[i+1]),proof=inspectSpan(span);
    const end=pointAt(span,b.atMs);
    if(Math.hypot(end.x-b.point.x,end.y-b.point.y)>1e-6)proof.reasons.push('endpoint_mismatch');
    if(proof.reasons.length)issues.push({fromMs:a.atMs,toMs:b.atMs,reasons:proof.reasons,refs:span.refs});return span;
  });
  // A conflicting knot invalidates both neighbours, not just a zero-width instant.
  for(const issue of [...issues])if(issue.reasons.includes('contradictory_anchor')||issue.reasons.includes('invalid_anchor')){
    const neighbouring=spans.filter(s=>s.fromMs<=issue.fromMs&&s.toMs>=issue.fromMs);
    for(const s of neighbouring)issues.push({...issue,fromMs:s.fromMs,toMs:s.toMs});
  }
  return {spans,issues};
}
