import { afterEach, expect, it, vi } from 'vitest';
import { compileActorCurve, hermiteSpan, inspectSpan, pointAt, preferredTangents, rootsInUnitInterval, velocityAt, type Knot } from './curves';
import { privateSequence } from './private-fixture';

afterEach(()=>vi.unstubAllGlobals());

it('extracts the legacy tangent prior without changing its coefficients or reversal policy',()=>{
  const knots=[{atMs:0,point:{x:10,y:10}},{atMs:2000,point:{x:14,y:12}},{atMs:4000,point:{x:18,y:10}}];
  expect(preferredTangents(knots)).toEqual([{x:2,y:1},{x:2,y:0},{x:2,y:-1}]);
  expect(compileActorCurve(knots).spans.map(s=>[s.x,s.y])).toEqual([[[10,4,0,0],[10,2,2,-2]],[[14,4,0,0],[12,0,-4,2]]]);
});

it('retains the actual saved V1 coefficients byte for byte after extracting the prior',async()=>{
  const {source}=await privateSequence();const name='node:crypto';
  const crypto=await import(/* @vite-ignore */ name) as {createHash:(name:string)=>{update:(s:string)=>{digest:(kind:string)=>string}}};
  for(const [id,want] of [
    ['20521','b2ba92c797c1a5e8d15034b97e59b49fc4c5d99c091697d1a38c91995a35f8a7'],
    ['3347','404f06d1f3584b3d453fdfcc8966a351768e9a39a8ea95197bc3b9ca1e29bad7'],
    ['3957','e9ddabcc7e40d9c93ffd03c62a76f9730aee688ccf4505e16dfbf5d4a202170a'],
    ['7063','4e9b0372d457a3f307fab2477d8296d71a3d7fc1536dface42f4def5585c4bcd'],
  ]){
    const actorId=`historical:statsbomb:${id}`,pose=(t:number)=>source.frames.find(f=>f.clock_ms===t)!.players.find(p=>p.key===actorId)!;
    const a=pose(1684024),b=pose(1697850),knots:Knot[]=[{atMs:1684024,point:{x:a.x,y:a.y}},{atMs:1697850,point:{x:b.x,y:b.y}}];
    for(const e of source.events.filter(e=>e.actorId===actorId)){
      if(e.start)knots.push({atMs:e.elapsedMs,point:e.start});
      if(e.kind==='Carry'&&e.durationMs!==null&&e.end)knots.push({atMs:e.elapsedMs+e.durationMs,point:e.end});
    }
    const coefficients=compileActorCurve(knots).spans.map(({fromMs,toMs,x,y})=>({fromMs,toMs,x,y}));
    expect(crypto.createHash('sha256').update(JSON.stringify(coefficients)).digest('hex'),actorId).toBe(want);
  }
});

it('uses shared knot velocities, respects reversals and reproduces endpoints exactly',()=>{
  const curve=compileActorCurve([{atMs:0,point:{x:10,y:10}},{atMs:2000,point:{x:14,y:12}},{atMs:4000,point:{x:18,y:10}}]);
  expect(curve.issues).toHaveLength(0);
  expect(pointAt(curve.spans[0],0)).toEqual({x:10,y:10});expect(pointAt(curve.spans[0],2000)).toEqual({x:14,y:12});
  expect(velocityAt(curve.spans[0],2000)).toEqual(velocityAt(curve.spans[1],2000));
  expect(velocityAt(curve.spans[0],2000).x).toBeGreaterThan(0);expect(velocityAt(curve.spans[0],2000).y).toBe(0);
});
it('checks analytic polynomial extrema including an interior speed peak and coordinate overshoot',()=>{
  const fast=hermiteSpan({atMs:0,point:{x:10,y:10}},{atMs:1000,point:{x:18,y:10}},{x:0,y:0},{x:0,y:0});
  const proof=inspectSpan(fast);expect(proof.maxSpeed).toBeCloseTo(12);expect(proof.maxAcceleration).toBeCloseTo(48);
  expect(proof.reasons).toEqual(expect.arrayContaining(['speed_limit','acceleration_limit']));
  const overshoot=hermiteSpan({atMs:0,point:{x:104,y:10}},{atMs:1000,point:{x:104,y:10}},{x:8,y:0},{x:-8,y:0});
  expect(inspectSpan(overshoot).reasons).toContain('field_bounds');
  expect(rootsInUnitInterval([-.125,.75,-1.5,1])).toEqual([.5]); // repeated cubic root
});
it('rejected_actor_curves_are_explicit_issues rather than clamped coordinates',()=>{
  for(const knots of [
    [{atMs:0,point:{x:10,y:10}},{atMs:10,point:{x:20,y:10}}],
    [{atMs:0,point:{x:10,y:10}},{atMs:0,point:{x:11,y:10}}],
    [{atMs:0,point:{x:-1,y:10}},{atMs:1000,point:{x:10,y:10}}],
  ])expect(compileActorCurve(knots).issues.length).toBeGreaterThan(0);
});
