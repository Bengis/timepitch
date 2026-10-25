import { expect,it,vi } from 'vitest';
import { readPrivateFile } from '../../test-private-data';
import { auditStoredRootVector } from './root-vector-audit';
import type { RootVectorAuditInput } from './root-vector-audit';
import { rootIntervalMath as m } from './root-feasibility';
import type { RootInterval as I } from './root-feasibility';

// Fail loudly if this read-only reader/auditor ever imports an optimiser or FK.
vi.mock('./root-projection',()=>{throw new Error('Projection forbidden in stored-vector audit');});
vi.mock('./root-diagnostic',()=>{throw new Error('Full diagnostic forbidden in stored-vector audit');});
vi.mock('./body-kinematics',()=>{throw new Error('FK forbidden in stored-vector audit');});
const acceleration=(a=0):RootVectorAuditInput=>({actorId:'constant-acceleration-toy',nodes:[
  {atMs:0,root:{x:50,y:34},velocity:{x:0,y:0}},
  {atMs:1000,root:{x:50+a/2,y:34},velocity:{x:a,y:0}},
]});
it('reports_acceleration_excess_even_below_the_old_iteration_residual',()=>{
  const a=4+5e-8,result=auditStoredRootVector(acceleration(a));
  expect(result.status).toBe('audited');expect(result.spans).toHaveLength(1);
  expect(result.spans[0].maxAcceleration).toBeCloseTo(a,12);
  expect(result.spans[0].reasons).toEqual(['acceleration_limit']);
});
it('reports_speed_and_field_reasons_without_clamping_the_vector',()=>{
  const speed=9+5e-8,input=acceleration();
  const result=auditStoredRootVector({...input,nodes:[
    {...input.nodes[0],velocity:{x:speed,y:0}},
    {...input.nodes[1],root:{x:50+speed,y:34},velocity:{x:speed,y:0}},
  ]});
  expect(result.status).toBe('audited');expect(result.spans[0].maxSpeed).toBeCloseTo(speed,12);
  expect(result.spans[0].reasons).toEqual(['speed_limit']);
  const field=auditStoredRootVector({...input,nodes:input.nodes.map(n=>({...n,root:{x:-1,y:34}}))});
  expect(field.status).toBe('audited');expect(field.spans[0].reasons).toEqual(['field_bounds']);
});
it('auditing_a_valid_vector_never_returns_a_track_or_acceptance_or_mutates_it',()=>{
  const input=acceleration(1),before=JSON.stringify(input),result=auditStoredRootVector(input);
  expect(result.status).toBe('audited');expect(result.spans[0].reasons).toEqual([]);
  expect(JSON.stringify(input)).toBe(before);
  for(const key of ['track','tracks','roots','nodes','sample','accepted'])expect(result).not.toHaveProperty(key);
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.spans[0].reasons)).toBe(true);
});
it('invalid_or_unrepresentable_inputs_fail_without_partial_span_reports',()=>{
  const input=acceleration(),first=input.nodes[0];
  const invalid:unknown[]=[null,{}, {actorId:'',nodes:input.nodes}, {...input,nodes:[]}, {...input,nodes:[first]},
    {...input,nodes:[first,first]}, {...input,nodes:[input.nodes[1],first]},
    {...input,nodes:[first,{...input.nodes[1],atMs:1.5}]},
    {...input,nodes:[first,{...input.nodes[1],atMs:Number.MAX_SAFE_INTEGER+1}]},
    {...input,nodes:[first,{...input.nodes[1],root:{x:NaN,y:0}}]},
    {...input,nodes:[first,{...input.nodes[1],velocity:{x:0,y:Infinity}}]},
    {...input,nodes:Array.from({length:65},(_,atMs)=>({...first,atMs}))},
    {...input,nodes:[first,null]},
    {...input,nodes:[first,{...input.nodes[1],root:{x:Number.MAX_VALUE,y:0}}]},
    {status:'unavailable',reports:[],roots:[]},
  ];
  for(const value of invalid){const result=auditStoredRootVector(value as RootVectorAuditInput);
    expect(result.status).toBe('invalid_input');expect(result.spans).toEqual([]);expect(result.reason).toBeTruthy();}
});
it('allows_exactly64_nodes_and_returns_at_most63_scalar_span_reports',()=>{
  const first=acceleration().nodes[0],result=auditStoredRootVector({actorId:'64-node-toy',
    nodes:Array.from({length:64},(_,i)=>({...first,atMs:i*1000}))});
  expect(result.status).toBe('audited');expect(result.spans).toHaveLength(63);
});

type Polygon={kind:'polygon';vertices:{x:number;y:number}[]};
type Binding={id:string;atMs:number;provenance:string;refs:string[];region:Polygon};
type Saved={result:{status:string;actors:{actorId:string;projection:{status:string;diagnostics:{finalNodes:RootVectorAuditInput['nodes']}}}[];domainKey:string}};
async function savedVectors():Promise<Saved>{
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  const path=env?.TIMEPITCH_ROOT_VECTOR_RECEIPT??'../.superpowers/sdd/2026-10-21-root-feasibility-correction/phase4-single-admission/result.json';
  const fsName='node:fs',cryptoName='node:crypto';
  const fs=await import(/* @vite-ignore */ fsName) as {readFileSync:(p:string,e:'utf8')=>string;existsSync:(p:string)=>boolean};
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
  const raw=readPrivateFile(fs,path);
  expect(crypto.createHash('sha256').update(raw).digest('hex')).toBe('8450ab2351e0311b9f5cec8ef6f0267d1e28def2b6b84199f2b3c99447e0fa55');
  return JSON.parse(raw) as Saved;
}
it('reads_all22_sealed_vectors_and_retains14_controls_and8_acceleration_failures',async()=>{
  const saved=await savedVectors(),before=JSON.stringify(saved),reports=saved.result.actors.map(a=>({actorId:a.actorId,
    stored:a.projection.status,audit:auditStoredRootVector({actorId:a.actorId,nodes:a.projection.diagnostics.finalNodes})}));
  expect(reports).toHaveLength(22);expect(reports.every(r=>r.audit.status==='audited')).toBe(true);
  expect(reports.filter(r=>r.audit.spans.every(s=>!s.reasons.length))).toHaveLength(14);
  const failed=reports.filter(r=>r.audit.spans.some(s=>s.reasons.length));expect(failed).toHaveLength(8);
  expect(failed.every(r=>r.stored==='not_converged')).toBe(true);
  for(const report of failed)expect([...new Set(report.audit.spans.flatMap(s=>s.reasons))]).toEqual(['acceleration_limit']);
  const maximum=(id:string)=>Math.max(...reports.find(r=>r.actorId===`historical:statsbomb:${id}`)!.audit.spans.map(s=>s.maxAcceleration));
  expect(Math.abs(maximum('20521')-4.000000099979425)).toBeLessThan(1e-12);
  expect(Math.abs(maximum('3645')-4.000000123493589)).toBeLessThan(1e-12);
  expect(saved.result.status).toBe('unavailable');expect(JSON.stringify(saved)).toBe(before);
});

// Test-only certificate arithmetic: no runtime optimiser or grid implementation.
type V={x:I;y:I};
const p=m.point,v=(x:number,y:number):V=>({x:p(x),y:p(y)});
const plus=(a:V,b:V):V=>({x:m.add(a.x,b.x),y:m.add(a.y,b.y)});
const scale=(a:V,k:I):V=>({x:m.multiply(a.x,k),y:m.multiply(a.y,k)});
const minus=(a:V,b:V)=>plus(a,scale(b,p(-1)));
const norm=(a:V)=>{const square=m.add(m.multiply(a.x,a.x),m.multiply(a.y,a.y));return m.sqrt({lo:Math.max(0,square.lo),hi:square.hi});};
function certificate(bindings:readonly Binding[],scope:'original_cubic_grid'|'max500ms_cubic_grid'|'general_acceleration'){
  const n=v(85,52),q=v(15,-99),h=bindings.slice(1).map((b,i)=>m.divide(p(b.atMs-bindings[i].atMs),p(1000))),inv=h.map(x=>m.divide(p(1),x));
  const coefficients=[scale(n,inv[0]),plus(scale(n,m.multiply(p(-1),m.add(inv[0],inv[1]))),scale(q,inv[1])),
    minus(scale(n,inv[1]),scale(q,m.add(inv[1],inv[2]))),scale(q,inv[2])];
  let lower=p(0);
  for(let i=0;i<4;i++){
    const c=coefficients[i],dots=bindings[i].region.vertices.map(point=>m.add(m.multiply(c.x,p(point.x)),m.multiply(c.y,p(point.y))));
    const minimum={lo:Math.min(...dots.map(d=>d.lo)),hi:Math.min(...dots.map(d=>d.hi))};
    lower=m.add(lower,m.subtract(minimum,m.multiply(p(1e-7),norm(c))));
  }
  let upper=p(0);
  if(scope==='general_acceleration'){
    let middle=p(0);
    for(let i=0;i<=64;i++)middle=m.add(middle,m.multiply(norm(plus(scale(n,p(1-i/64)),scale(q,p(i/64)))),p(i===0||i===64?.5:1)));
    upper=m.add(m.add(m.divide(m.multiply(h[0],norm(n)),p(2)),m.multiply(h[1],m.divide(middle,p(64)))),m.divide(m.multiply(h[2],norm(q)),p(2)));
  }else for(let j=0;j<3;j++){
    const gap=bindings[j+1].atMs-bindings[j].atMs,count=scope==='original_cubic_grid'?1:Math.ceil(gap/500),ka=[v(0,0),n,q][j],kb=[n,q,v(0,0)][j];
    const kernel=(at:number)=>plus(scale(ka,m.subtract(p(1),m.divide(p(at),p(gap)))),scale(kb,m.divide(p(at),p(gap))));
    for(let k=0;k<count;k++){
      const a=Math.floor(k*gap/count),b=Math.floor((k+1)*gap/count),aK=kernel(a),bK=kernel(b);
      upper=m.add(upper,m.divide(m.multiply(m.divide(p(b-a),p(1000)),m.add(norm(plus(scale(aK,p(2)),bK)),norm(plus(aK,scale(bK,p(2)))))),p(6)));
    }
  }
  const bound=m.divide(lower,upper);
  return {scope,status:bound.lo>4?'necessary_conflict':'not_excluded',bound,bindingIds:bindings.map(b=>b.id),refs:bindings.flatMap(b=>b.refs)};
}
it('four_region_certificate_excludes_only_the_old_cubic_representation_not_all_physical_paths',async()=>{
  const saved=await savedVectors(),plan=JSON.parse(saved.result.domainKey) as {actors:{actorId:string;bindings:Binding[]}[]};
  const actor=plan.actors.find(a=>a.actorId==='historical:statsbomb:7063')!,times=[1692171,1693655,1695068,1697116];
  const bindings=times.map(at=>actor.bindings.find(b=>b.atMs===at&&['contact_surface','recorded_snapshot'].includes(b.provenance))!);
  expect(bindings.every(b=>b.region.kind==='polygon'&&b.refs.length>0)).toBe(true);
  const original=certificate(bindings,'original_cubic_grid');expect(original.status).toBe('necessary_conflict');
  expect(original.bound.lo).toBeGreaterThanOrEqual(4.175263);expect(original.bound.hi).toBeLessThan(4.175264);
  for(const [scope,floor] of [['max500ms_cubic_grid',3.978566],['general_acceleration',3.960920]] as const){
    const weaker=certificate(bindings,scope);expect(weaker.status).toBe('not_excluded');expect(weaker.bound.lo).toBeGreaterThanOrEqual(floor);
    expect(weaker.bound.hi).toBeLessThan(floor+.000001);expect(weaker.status).not.toBe('feasible');
  }
  expect(original.bindingIds).toEqual(bindings.map(b=>b.id));expect(original.refs).toHaveLength(4);
});
