import { afterEach, expect, it, vi } from 'vitest';
import { solveActorConstraints } from './constraint-solver';
import { prepareConstraints, type PreparedActorConstraints } from './constraints';
import { inspectSpan, pointAt, velocityAt, type CurveSpan, type Knot } from './curves';
import { freeze, privateSequence } from './private-fixture';

const actor=(hardKnots:readonly Knot[],softExit:PreparedActorConstraints['softExit']=null):PreparedActorConstraints=>({actorId:'synthetic:test',hardKnots,softExit});
function verifySpans(spans:readonly CurveSpan[]){
  for(const s of spans){const proof=inspectSpan(s);expect(proof.reasons).toEqual([]);expect(proof.maxSpeed).toBeLessThanOrEqual(9);expect(proof.maxAcceleration).toBeLessThanOrEqual(4);}
  for(let i=1;i<spans.length;i++){
    const t=spans[i].fromMs,a=velocityAt(spans[i-1],t),b=velocityAt(spans[i],t);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThanOrEqual(1e-7);
  }
}
afterEach(()=>vi.unstubAllGlobals());

it('certifies constant velocity without adding acceleration or moving hard endpoints',()=>{
  const a=actor([{atMs:0,point:{x:10,y:10}},{atMs:2000,point:{x:14,y:10}},{atMs:4000,point:{x:18,y:10}}]);
  const result=solveActorConstraints(a);expect(result.report.status).toBe('certified');expect(result.spans).toHaveLength(2);
  expect(result.spans[0].x).toEqual([10,4,0,0]);expect(result.report.maxSpeed).toBeCloseTo(2,10);expect(result.report.maxAcceleration).toBeCloseTo(0,10);
  verifySpans(result.spans);expect(pointAt(result.spans[1],4000)).toEqual({x:18,y:10});
});

it('shares vector tangents through a turn and keeps a terminal segment inside the field',()=>{
  const a=actor([{atMs:0,point:{x:0,y:0}},{atMs:2000,point:{x:0,y:2}},{atMs:4000,point:{x:2,y:4}}],{atMs:6000,target:{x:4,y:5}});
  const result=solveActorConstraints(a);expect(result.report.status).toBe('certified');expect(result.spans).toHaveLength(3);
  expect(result.spans.at(-1)!.toMs).toBe(6000);verifySpans(result.spans);
});

it('treats the exit position as an objective instead of a hard snap-back target',()=>{
  const a=actor([{atMs:0,point:{x:20,y:30}},{atMs:1000,point:{x:14,y:30}}],{atMs:2000,target:{x:20,y:30}});
  const result=solveActorConstraints(a);expect(result.report.status).toBe('certified');verifySpans(result.spans);
  expect(pointAt(result.spans.at(-1)!,2000).x).toBeLessThan(14);
});

it('is deterministic and owns immutable output while preserving frozen input',()=>{
  const a=actor([{atMs:0,point:{x:10,y:10}},{atMs:2000,point:{x:14,y:12}},{atMs:4000,point:{x:18,y:10}}]);
  freeze(a);const before=JSON.stringify(a),first=solveActorConstraints(a),second=solveActorConstraints(a);
  expect(first.report.status).toBe('certified');expect(second).toEqual(first);expect(JSON.stringify(a)).toBe(before);
  expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first.spans[0].x)).toBe(true);
});

it.each([0,-1,1.5,10001,NaN,Infinity,null as unknown as number])('rejects an invalid iteration cap %s without solving or exporting spans',maxSweeps=>{
  const a=actor([{atMs:0,point:{x:10,y:10}},{atMs:1000,point:{x:11,y:10}}]);
  const result=solveActorConstraints(a,{maxSweeps});expect(result.report.status).toBe('invalid_input');expect(result.spans).toEqual([]);expect(result.report.iterations).toBe(0);
});

it('does not call a conservative control-hull rejection physical impossibility',()=>{
  // Constant 9m/s is physically on the boundary; the deliberately inward control bound is stricter.
  const result=solveActorConstraints(actor([{atMs:0,point:{x:10,y:10}},{atMs:1000,point:{x:19,y:10}}]),{maxSweeps:20});
  expect(result.report.status).toBe('not_converged');expect(result.report.iterations).toBe(20);
  expect(result.report.analyticCertificate).toBeNull();expect(result.spans).toEqual([]);
});

it.each(['empty','one-node','bad-time','bad-point','bad-exit','overflow','over-64'])(
  'rejects %s input instead of returning a non-finite or sampleable trajectory',kind=>{
    let a=actor([{atMs:0,point:{x:10,y:10}},{atMs:1000,point:{x:11,y:10}}]);
    if(kind==='empty')a=actor([]);
    if(kind==='one-node')a=actor(a.hardKnots.slice(0,1));
    if(kind==='bad-time')a=actor([{atMs:NaN,point:{x:10,y:10}},a.hardKnots[1]]);
    if(kind==='bad-point')a=actor([{atMs:0,point:{x:-1,y:10}},a.hardKnots[1]]);
    if(kind==='bad-exit')a=actor(a.hardKnots,{atMs:1000,target:{x:11,y:10}});
    if(kind==='overflow')a=actor([{atMs:0,point:{x:10,y:10}},{atMs:1e-300,point:{x:10,y:10}}]);
    if(kind==='over-64')a=actor(Array.from({length:64},(_,i)=>({atMs:i*1000,point:{x:10,y:10}})),{atMs:64000,target:{x:10,y:10}});
    const result=solveActorConstraints(a);expect(result.report.status).toBe('invalid_input');expect(result.spans).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

it('accepts the full 64-node fixed chain without exceeding its bounded iteration budget',()=>{
  const result=solveActorConstraints(actor(Array.from({length:64},(_,i)=>({atMs:i*1000,point:{x:10,y:10}}))));
  expect(result.report.status).toBe('certified');expect(result.spans).toHaveLength(63);expect(result.report.iterations).toBeLessThanOrEqual(10000);
});

it('reports an analytic conflict for different hard positions at the same instant',()=>{
  const result=solveActorConstraints(actor([{atMs:0,point:{x:10,y:10}},{atMs:0,point:{x:11,y:10}}]));
  expect(result.report.status).toBe('constraint_conflict');expect(result.report.analyticCertificate).toMatch(/same instant/);expect(result.spans).toEqual([]);
});

it('proves an impossible fixed displacement rather than claiming a solver timeout proves impossibility',()=>{
  const result=solveActorConstraints(actor([{atMs:0,point:{x:10,y:10}},{atMs:10,point:{x:20,y:10}}]));
  expect(result.report.status).toBe('constraint_conflict');expect(result.report.analyticCertificate).toMatch(/displacement/);expect(result.spans).toEqual([]);
});

it('keeps Gomis hard-exit contradiction separate from a bounded solver nonconvergence',async()=>{
  const {source}=await privateSequence(),p=prepareConstraints(source),g=p.actors.find(a=>a.actorId==='historical:statsbomb:20521')!;
  const impossible=solveActorConstraints({...g,hardKnots:[...g.hardKnots,{atMs:g.softExit!.atMs,point:g.softExit!.target}],softExit:null});
  expect(impossible.report.status).toBe('constraint_conflict');expect(impossible.spans).toEqual([]);
  expect(impossible.report.analyticCertificate).toMatch(/23\.139247/);
  const bounded=solveActorConstraints(g,{maxSweeps:1});expect(bounded.report.status).toBe('not_converged');expect(bounded.report.iterations).toBe(1);
  expect(bounded.report.analyticCertificate).toBeNull();expect(bounded.spans).toEqual([]);
});

it('certifies every prepared saved actor through the actual clip end, preserving source anchors',async()=>{
  const {source}=await privateSequence(),before=JSON.stringify(source),prepared=prepareConstraints(source);
  expect(prepared.issues).toEqual([]);const rows=prepared.actors.map(a=>({actor:a,result:solveActorConstraints(a)}));
  const report=rows.map(({actor:a,result:r})=>({actor_id:a.actorId,report:r.report,
    spans:r.spans.map(s=>({from_ms:s.fromMs,to_ms:s.toMs,...inspectSpan(s)})),
    final_point:r.spans.length?pointAt(r.spans.at(-1)!,1697850):null}));
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_SEQUENCE_SOLVER_RECEIPT){const name='node:fs';const fs=await import(/* @vite-ignore */ name) as {writeFileSync:(path:string,text:string)=>void};
    fs.writeFileSync(env.TIMEPITCH_SEQUENCE_SOLVER_RECEIPT,JSON.stringify({case:'TP144',phase:'C2',source_digest:source.rawDigest,actors:report,
      gate:rows.every(row=>row.result.report.status==='certified')?'passed_actor_curves_only':'failed',native_matches:0,model_calls:0,activation:false},null,2)+'\n');}
  expect(rows).toHaveLength(7);
  for(const {actor:a,result:r} of rows){
    expect(r.report.status,a.actorId).toBe('certified');expect(r.spans[0].fromMs).toBe(1684024);expect(r.spans.at(-1)!.toMs).toBe(1697850);
    expect(r.report.maxResidual).not.toBeNull();expect(r.report.maxResidual!).toBeLessThanOrEqual(1e-7);expect(r.report.maxChange!).toBeLessThanOrEqual(1e-9);
    verifySpans(r.spans);
    for(const k of a.hardKnots){const s=r.spans.find(s=>s.fromMs<=k.atMs&&s.toMs>=k.atMs)!;const p=pointAt(s,k.atMs);
      expect(Math.hypot(p.x-k.point.x,p.y-k.point.y)).toBeLessThanOrEqual(1e-6);}
  }
  const gomis=rows.find(row=>row.actor.actorId==='historical:statsbomb:20521')!;
  expect(pointAt(gomis.result.spans.at(-1)!,1697850).x).toBeLessThanOrEqual(23.13924744+1e-6);
  expect(JSON.stringify(source)).toBe(before);
});
