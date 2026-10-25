import type { GroundCapsule } from './contact-types';
import type { Point } from './types';

export type RootInterval = Readonly<{lo:number;hi:number}>;
export type RootRegion = (GroundCapsule & Readonly<{kind:'capsule'}>)
  | Readonly<{kind:'polygon';vertices:readonly Point[]}>;
export type RootTimedRegion = Readonly<{
  id:string;actorId:string;atMs:number;region:RootRegion;refs:readonly string[];provenance:string;policyKey:string;
}>;
export type RootFeasibilityInput = Readonly<{
  actorId:string;domainKey:string;scope:string;physicalAccelerationMps2:4;regions:readonly RootTimedRegion[];
}>;
export type RootFeasibilityWitness = Readonly<{
  actorId:string;domainKey:string;scope:string;bindingIds:readonly string[];timesMs:readonly number[];
  refs:readonly (readonly string[])[];provenances:readonly string[];direction:Point;
  directionalDifference:RootInterval;accelerationLowerBoundMps2:number;physicalAccelerationMps2:4;
}>;
export type RootFeasibilityReport = Readonly<{
  status:'necessary_conflict'|'not_excluded'|'invalid_input'|'exhausted';actorId:string;domainKey:string;scope:string;
  inspectedTriples:number;inconclusiveTriples:number;witness?:RootFeasibilityWitness;reason?:string;
}>;
export type RootWorkStage = 'preparation'|'preflight'|'fk'|'solver'|'verification';

/** One actor's ledger, shared by preparation, branches, projection and checks. */
export class RootWorkLedger {
  readonly #cap=10000;
  #consumed=0;
  #stages:Partial<Record<RootWorkStage,number>>={};
  get cap(){return this.#cap;}
  get consumed(){return this.#consumed;}
  get byStage():Readonly<Partial<Record<RootWorkStage,number>>>{return Object.freeze({...this.#stages});}
  charge(stage:RootWorkStage,units:number):boolean {
    if(!['preparation','preflight','fk','solver','verification'].includes(stage)
      ||!Number.isSafeInteger(units)||units<=0||units>this.cap-this.#consumed)return false;
    this.#consumed+=units;this.#stages[stage]=(this.#stages[stage]??0)+units;return true;
  }
}

const bits=new DataView(new ArrayBuffer(8));
function adjacent(value:number,up:boolean):number {
  if(value===0)return up?Number.MIN_VALUE:-Number.MIN_VALUE;
  bits.setFloat64(0,value);const word=bits.getBigUint64(0);
  bits.setBigUint64(0,word+((value>0)===up?1n:-1n));return bits.getFloat64(0);
}
function interval(lo:number,hi:number):RootInterval {
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo>hi)throw new RangeError('Nonfinite or invalid root interval');
  return {lo,hi};
}
const point=(value:number)=>interval(value,value);
const outward=(lo:number,hi:number)=>interval(adjacent(lo,false),adjacent(hi,true));
const add=(a:RootInterval,b:RootInterval)=>outward(a.lo+b.lo,a.hi+b.hi);
const subtract=(a:RootInterval,b:RootInterval)=>outward(a.lo-b.hi,a.hi-b.lo);
function multiply(a:RootInterval,b:RootInterval):RootInterval {
  const products=[a.lo*b.lo,a.lo*b.hi,a.hi*b.lo,a.hi*b.hi];
  return outward(Math.min(...products),Math.max(...products));
}
function divide(a:RootInterval,b:RootInterval):RootInterval {
  if(b.lo<=0&&b.hi>=0)throw new RangeError('Root interval divisor contains zero');
  return multiply(a,outward(1/b.hi,1/b.lo));
}
function sqrt(a:RootInterval):RootInterval {
  if(a.lo<0)throw new RangeError('Negative root interval');
  const value=outward(Math.sqrt(a.lo),Math.sqrt(a.hi));
  return {lo:Math.max(0,value.lo),hi:value.hi};
}
/** IEEE-754 outward bounds; overflow/division ambiguity is never a conflict proof. */
export const rootIntervalMath=Object.freeze({point,add,subtract,multiply,divide,sqrt});
const dot=(n:Point,p:Point)=>add(multiply(point(n.x),point(p.x)),multiply(point(n.y),point(p.y)));
function norm(n:Point):RootInterval {
  const squared=add(multiply(point(n.x),point(n.x)),multiply(point(n.y),point(n.y)));
  return sqrt({lo:Math.max(0,squared.lo),hi:squared.hi});
}
function support(region:RootRegion,n:Point,length:RootInterval):RootInterval {
  const vertices=region.kind==='capsule'?[region.a,region.b]:region.vertices;
  const projections=vertices.map(p=>dot(n,p));
  const range=interval(Math.min(...projections.map(p=>p.lo)),Math.max(...projections.map(p=>p.hi)));
  if(region.kind==='polygon')return range;
  const radius=multiply(point(region.radiusM),length);
  return interval(subtract(point(range.lo),radius).lo,add(point(range.hi),radius).hi);
}
function finitePoint(p:Point):boolean{return !!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);}
// Exact binary64 orientation canonicalises interval-vertex rectangles without
// deleting a genuine outward vertex or retaining redundant collinear vertices.
const view=new DataView(new ArrayBuffer(8));
function dyadic(x:number):{n:bigint;e:number}{
  view.setFloat64(0,x);const bits=view.getBigUint64(0),exponent=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);
  return {n:(bits>>63n?-1n:1n)*(exponent?(1n<<52n)|fraction:fraction),e:exponent?exponent-1075:-1074};
}
export function rootOrientation(a:Point,b:Point,c:Point):bigint {
  const values=[a.x,a.y,b.x,b.y,c.x,c.y].map(dyadic),e=Math.min(...values.map(v=>v.e));
  const [ax,ay,bx,by,cx,cy]=values.map(v=>v.n<<BigInt(v.e-e));return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
}
function validRegion(region:RootRegion):boolean {
  if(!region)return false;
  if(region.kind==='capsule')return typeof region.id==='string'&&region.id.length>0
    &&finitePoint(region.a)&&finitePoint(region.b)&&Number.isFinite(region.radiusM)&&region.radiusM>=0;
  if(region.kind!=='polygon'||!Array.isArray(region.vertices)||region.vertices.length<3||!region.vertices.every(finitePoint))return false;
  // Every other vertex must be provably left of every CCW edge. This also
  // rejects self-intersections. Redundant/uncertain collinear vertices fail closed.
  const v=region.vertices;
  for(let i=0;i<v.length;i++){
    const a=v[i],b=v[(i+1)%v.length];
    const dx=subtract(point(b.x),point(a.x)),dy=subtract(point(b.y),point(a.y));
    for(let j=0;j<v.length;j++)if(j!==i&&j!==(i+1)%v.length){
      const cross=subtract(multiply(dx,subtract(point(v[j].y),point(a.y))),multiply(dy,subtract(point(v[j].x),point(a.x))));
      if(cross.lo<=0&&rootOrientation(a,b,v[j])<=0n)return false;
    }
  }
  return true;
}
/** Shared region guard for the opt-in projection/domain pipeline. */
export const isValidRootRegion=validRegion;
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
function invalidReason(input:RootFeasibilityInput):string|null {
  if(!input||!nonempty(input.actorId)||!nonempty(input.domainKey)||!nonempty(input.scope)
    ||input.physicalAccelerationMps2!==4||!Array.isArray(input.regions)||input.regions.length===0)return 'invalid_root_input';
  const ids=new Set<string>(),times=new Set<number>();let previous=-Infinity;
  for(const r of input.regions){
    if(!r||!nonempty(r.id)||ids.has(r.id)||r.actorId!==input.actorId||r.policyKey!==input.domainKey
      ||!nonempty(r.provenance)||!Array.isArray(r.refs)||!r.refs.every(nonempty)
      ||!Number.isSafeInteger(r.atMs)||r.atMs<0||r.atMs<previous||!validRegion(r.region))return 'invalid_root_region_or_binding';
    ids.add(r.id);times.add(r.atMs);previous=r.atMs;
  }
  return times.size>64?'root_node_limit':null;
}
function centre(region:RootRegion):Point {
  const v=region.kind==='capsule'?[region.a,region.b]:region.vertices;
  return {x:v.reduce((s,p)=>s+p.x/v.length,0),y:v.reduce((s,p)=>s+p.y/v.length,0)};
}
function directions(triple:readonly RootTimedRegion[]):Point[] {
  const [a,b,c]=triple.map(r=>centre(r.region)),h=(triple[1].atMs-triple[0].atMs)/1000,t=(triple[2].atMs-triple[1].atMs)/1000;
  const dx=(c.x-b.x)/t-(b.x-a.x)/h,dy=(c.y-b.y)/t-(b.y-a.y)/h,scale=Math.max(Math.abs(dx),Math.abs(dy));
  // Direction selection is a heuristic only. All subsequent support/ratio
  // calculations enclose the chosen binary direction, not this heuristic.
  const result:Point[]=[];
  if(Number.isFinite(scale)&&scale>0)result.push({x:dx/scale,y:dy/scale});
  return [...result,{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
}
function bound(input:RootFeasibilityInput,triple:readonly RootTimedRegion[],direction:Point):RootFeasibilityWitness {
  const [a,b,c]=triple,length=norm(direction);
  if(length.lo<=0)throw new RangeError('Uncertain direction norm');
  const h=divide(subtract(point(b.atMs),point(a.atMs)),point(1000));
  const t=divide(subtract(point(c.atMs),point(b.atMs)),point(1000));
  if(h.lo<=0||t.lo<=0)throw new RangeError('Uncertain time interval');
  const ih=divide(point(1),h),it=divide(point(1),t);
  const coefficients=[ih,subtract(point(0),add(ih,it)),it];
  let difference=point(0);
  for(let i=0;i<3;i++)difference=add(difference,multiply(coefficients[i],support(triple[i].region,direction,length)));
  const acceleration=divide(multiply(point(2),difference),multiply(length,add(h,t)));
  return {actorId:input.actorId,domainKey:input.domainKey,scope:input.scope,bindingIds:triple.map(r=>r.id),
    timesMs:triple.map(r=>r.atMs),refs:triple.map(r=>[...r.refs]),provenances:triple.map(r=>r.provenance),
    direction:{...direction},directionalDifference:difference,accelerationLowerBoundMps2:Math.max(0,acceleration.lo),physicalAccelerationMps2:4};
}

/** Necessary condition only. No trajectory, FK, solver or source modification. */
export function inspectRootFeasibility(input:RootFeasibilityInput,ledger:RootWorkLedger):RootFeasibilityReport {
  let inspectedTriples=0,inconclusiveTriples=0,witness:RootFeasibilityWitness|undefined;
  const result=(status:RootFeasibilityReport['status'],reason?:string):RootFeasibilityReport=>({status,
    actorId:input?.actorId,domainKey:input?.domainKey,scope:input?.scope,inspectedTriples,inconclusiveTriples,
    ...(witness?{witness}:{}),...(reason?{reason}:{})});
  try{const invalid=invalidReason(input);if(invalid)return result('invalid_input',invalid);}
  catch{return result('invalid_input','unbounded_or_uncertain_region');}
  if(!(ledger instanceof RootWorkLedger))return result('invalid_input','invalid_shared_ledger');
  const groups:RootTimedRegion[][]=[];
  for(const r of input.regions){
    if(groups.at(-1)?.[0].atMs===r.atMs)groups.at(-1)!.push(r);else groups.push([r]);
  }
  for(let i=0;i<groups.length-2;i++)for(let j=i+1;j<groups.length-1;j++)for(let k=j+1;k<groups.length;k++)
    for(const a of groups[i])for(const b of groups[j])for(const c of groups[k]){
      if(!ledger.charge('preflight',1)){
        witness=undefined;return result('exhausted','shared_work_limit');
      }
      inspectedTriples++;let uncertain=false;
      const triple=[a,b,c];
      for(const direction of directions(triple)){
        try{
          const candidate=bound(input,triple,direction);
          if(!witness||candidate.accelerationLowerBoundMps2>witness.accelerationLowerBoundMps2)witness=candidate;
          if(candidate.accelerationLowerBoundMps2>input.physicalAccelerationMps2)return result('necessary_conflict');
        }catch{uncertain=true;}
      }
      if(uncertain)inconclusiveTriples++;
    }
  return result('not_excluded',inconclusiveTriples?'arithmetic_inconclusive':undefined);
}
