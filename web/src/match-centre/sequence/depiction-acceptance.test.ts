import { afterEach, expect, it, vi } from 'vitest';
import { readPrivateFile } from '../../test-private-data';
import { compileDepiction, focusTrack, sequenceCue } from './depiction';
import { sequenceFocus } from './focus';
import { freeze, privateSequence, rawView } from './private-fixture';
import { prepareConstraints } from './constraints';
import { solveActorConstraints } from './constraint-solver';
import { inspectSpan, pointAt, rootsInUnitInterval, velocityAt, type CurveSpan } from './curves';
import { momentsAt } from './analysis';
import type { SequenceSource } from './types';

function originalCursors(source:SequenceSource,anchors:readonly number[]) {
  const {fromMs,toMs}=source.request,times=new Set<number>([fromMs,toMs]);
  for(let t=fromMs;t<=toMs;t+=50)times.add(t);
  for(const at of [...source.events.flatMap(e=>[e.elapsedMs,...(e.durationMs!==null?[e.elapsedMs+e.durationMs]:[])]),
    ...anchors,...source.cuts.flatMap(c=>[c.fromMs,c.toMs].filter((t):t is number=>t!==null))]){
    for(const delta of [-1,0,1])if(at+delta>=fromMs&&at+delta<=toMs)times.add(at+delta);
  }
  for(const rate of [.5,1,2])for(let wall=0;fromMs+wall*rate<=toMs;wall+=50)times.add(fromMs+wall*rate);
  return [...times].sort((a,b)=>a-b);
}

afterEach(()=>vi.unstubAllGlobals());
it('sweeps the actual saved sequence and records unresolved coherence as a failed gate',async()=>{
  const {source,bundle}=await privateSequence(),before=JSON.stringify(source),d=compileDepiction(source),{fromMs,toMs}=source.request;
  const ordered=originalCursors(source,bundle.segment.anchors.flatMap(a=>a.period_ms===null?[]:[a.period_ms])),seen=new Map<number,string>(),availability={available:0,partial:0,unavailable:0};
  for(const t of ordered){
    const raw=rawView(source,t);raw.frame.score={home:1,away:t>=1697116?1:0};raw.frame.possession=null;raw.frame.carrier=null;freeze(raw);
    const sample=d.sample(t,raw);availability[sample.availability]++;seen.set(t,JSON.stringify(sample));
    if(sample.frame){
      expect(sample.frame.players).toHaveLength(22);expect(new Set(sample.frame.players.map(p=>p.key)).size).toBe(22);
      expect(sample.frame.players.every(p=>p.x>=-1e-6&&p.x<=105+1e-6&&p.y>=-1e-6&&p.y<=68+1e-6)).toBe(true);
      expect(sample.frame.score).toEqual(raw.frame.score);expect(sample.frame.clock_ms).toBe(raw.frame.clock_ms);
      expect(sample.frame.period).toBe(raw.frame.period);expect(sample.frame.possession).toBeNull();expect(sample.frame.carrier).toBeNull();
    }else expect(sample.availability).toBe('unavailable');
    const point=sequenceFocus(d,t,null,false);if(point)expect(Number.isFinite(point.x)&&Number.isFinite(point.y)).toBe(true);
  }
  for(const t of [...ordered].reverse()){
    const raw=rawView(source,t);raw.frame.score={home:1,away:t>=1697116?1:0};
    expect(JSON.stringify(d.sample(t,raw))).toBe(seen.get(t));
  }
  for(const t of [fromMs-1,toMs+1])expect(d.sample(t,rawView(source,t)).availability).toBe('unavailable');
  expect(JSON.stringify(source)).toBe(before);
  const legacy=source.cuts.filter(c=>c.reason==='player_motion_limit').map(c=>{
    const related=d.issues.filter(i=>c.entityIds!=='all'&&c.entityIds.includes(i.entityId)&&i.fromMs<=c.toMs!&&i.toMs>=c.fromMs!);
    return {id:c.id,entity_ids:c.entityIds,from_ms:c.fromMs,to_ms:c.toMs,status:related.length?'unresolved':'resolved_under_profile',issues:related};
  });
  expect(legacy).toHaveLength(3);
  const report={case:'TP141',phase:2,version:d.version,source_digest:source.rawDigest,clip:{from_ms:fromMs,to_ms:toMs},
    gate:d.issues.length||availability.unavailable||availability.partial?'failed':'passed',samples:ordered.length,availability,legacy_actor_cuts:legacy,issues:d.issues,
    original_null_ball_frames:source.frames.filter(f=>f.clock_ms>=fromMs&&f.clock_ms<=toMs&&f.ball===null).length,
    visual_acceptance:'not_run',native_matches:0,model_calls:0,source_mutated:false};
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_SEQUENCE_PHASE2_RECEIPT){const fsName='node:fs';const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(path:string,text:string)=>void};fs.writeFileSync(env.TIMEPITCH_SEQUENCE_PHASE2_RECEIPT,JSON.stringify(report,null,2)+'\n');}
});

// Include every stationary point of position, squared speed and squared acceleration,
// not just a regular time grid. inspectSpan remains the independent physical verifier.
function criticalTimes(span:CurveSpan):number[] {
  const derivative=(p:readonly number[])=>p.slice(1).map((v,i)=>v*(i+1));
  const normSquared=(x:readonly number[],y:readonly number[])=>{
    const out=Array(Math.max(x.length,y.length)*2-1).fill(0) as number[];
    for(const p of [x,y])p.forEach((a,i)=>p.forEach((b,j)=>{out[i+j]+=a*b;}));return out;
  };
  const vx=derivative(span.x),vy=derivative(span.y),ax=derivative(vx),ay=derivative(vy);
  return [...new Set([0,1,...[vx,vy,derivative(normSquared(vx,vy)),derivative(normSquared(ax,ay))].flatMap(rootsInUnitInterval)])]
    .map(u=>span.fromMs+(span.toMs-span.fromMs)*u).sort((a,b)=>a-b);
}
const distance=(p:{x:number;y:number},q:{x:number;y:number})=>Math.hypot(p.x-q.x,p.y-q.y);
const scoredRaw=(source:SequenceSource,t:number)=>{
  const raw=rawView(source,t);raw.frame.score={home:1,away:t>=1697116?1:0};freeze(raw);return raw;
};

it('includes analytical interior extrema rather than trusting a cursor grid',()=>{
  // x=10+3u-4u^3: velocity vanishes at .5; speed has another critical point at 0.
  const span:CurveSpan={fromMs:100,toMs:1100,x:[10,3,0,-4],y:[20,0,0,0],refs:[]};
  expect(criticalTimes(span)).toContain(600);
  expect(criticalTimes(span)).toEqual(expect.arrayContaining([100,1100]));
  // x=10+u+2u²-2u³: positive speed has its maximum at u=1/3.
  const interior=criticalTimes({...span,x:[10,1,2,-2]});
  expect(interior.some(t=>Math.abs(t-(100+1000/3))<1e-6)).toBe(true);
});

it('requires whole-clip V2 acceptance, retaining the failed V1 gate and immutable facts',async()=>{
  const {source,bundle}=await privateSequence(),before=JSON.stringify(source),{fromMs,toMs}=source.request;
  const prepared=prepareConstraints(source),v1=compileDepiction(source),d=compileDepiction(source,'historical-action-preview-2');
  expect(source.events.find(e=>e.outcome==='Goal')).toMatchObject({kind:'Shot',elapsedMs:1697116,durationMs:734.325});
  const original=originalCursors(source,bundle.segment.anchors.flatMap(a=>a.period_ms===null?[]:[a.period_ms]));
  expect(original).toHaveLength(614);
  const oldAvailability={available:0,partial:0,unavailable:0};
  for(const t of original)oldAvailability[v1.sample(t,scoredRaw(source,t)).availability]++;
  expect(oldAvailability).toEqual({available:394,partial:89,unavailable:131});expect(v1.issues).toHaveLength(10);
  const times=new Set(original),add=(t:number)=>{if(t>=fromMs&&t<=toMs)times.add(t);};
  for(const a of prepared.aliases)for(const at of [a.sourceEndMs,a.presentationEndMs])for(const delta of [-1,0,1])add(at+delta);
  const curves=prepared.actors.map(input=>({input,...solveActorConstraints(input)}));
  expect(curves).toHaveLength(7);expect(prepared.aliases).toHaveLength(5);
  const actorProofs=curves.map(({input,spans,report})=>{
    expect(report.status).toBe('certified');expect(report.reasons).toEqual([]);
    expect(report.maxResidual).toBeLessThanOrEqual(1e-7);expect(report.maxChange).toBeLessThanOrEqual(1e-9);
    expect(spans[0].fromMs).toBe(fromMs);expect(spans.at(-1)!.toMs).toBe(toMs);
    let maxJump=0;
    const proofs=spans.map((span,i)=>{
      const proof=inspectSpan(span);expect(proof.reasons).toEqual([]);
      expect(proof.maxSpeed).toBeLessThanOrEqual(9+1e-8);expect(proof.maxAcceleration).toBeLessThanOrEqual(4+1e-8);
      if(i){expect(span.fromMs).toBe(spans[i-1].toMs);
        expect(distance(pointAt(spans[i-1],span.fromMs),pointAt(span,span.fromMs))).toBeLessThanOrEqual(1e-6);
        maxJump=Math.max(maxJump,distance(velocityAt(spans[i-1],span.fromMs),velocityAt(span,span.fromMs)));}
      const critical=criticalTimes(span);critical.forEach(add);
      for(const at of [span.fromMs,span.toMs])for(const delta of [-1,0,1])add(at+delta);
      return {from_ms:span.fromMs,to_ms:span.toMs,max_speed_m_s:proof.maxSpeed,max_acceleration_m_s2:proof.maxAcceleration,critical_ms:critical};
    });
    expect(maxJump).toBeLessThanOrEqual(1e-7);
    for(const knot of input.hardKnots){const span=spans.find(s=>s.fromMs<=knot.atMs&&s.toMs>=knot.atMs)!;
      expect(distance(pointAt(span,knot.atMs),knot.point)).toBeLessThanOrEqual(1e-6);}
    return {actor_id:input.actorId,report,full_tail:true,free_exit:input.softExit!==null,max_velocity_jump_m_s:maxJump,spans:proofs};
  });
  const ball=focusTrack(d,null)!.spans;
  for(const span of ball)for(const at of [span.fromMs,span.toMs])for(const delta of [-1,0,1])add(at+delta);
  // Include the unchanged context sampler's interval boundaries too, without
  // claiming the corrected-actor motion certificate applies to those tracks.
  for(const player of source.frames[0].players)for(const span of focusTrack(d,player.key)!.spans)
    for(const at of [span.fromMs,span.toMs])for(const delta of [-1,0,1])add(at+delta);
  const ordered=[...times].sort((a,b)=>a-b),availability={available:0,partial:0,unavailable:0},seen=new Map<number,string>(),focusSeen=new Map<number,unknown>();
  for(const t of ordered){const sample=d.sample(t,scoredRaw(source,t));availability[sample.availability]++;seen.set(t,JSON.stringify(sample));focusSeen.set(t,sequenceFocus(d,t,null,false));}
  const gate=d.issues.length||availability.partial||availability.unavailable?'failed':'passed';
  // This assertion is the acceptance gate, unlike the deliberately retained V1 diagnostic.
  expect({gate,issues:d.issues,availability}).toEqual({gate:'passed',issues:[],availability:{available:ordered.length,partial:0,unavailable:0}});
  expect(d.version).toBe('historical-action-preview-2');expect(d.diagnostics?.aliases).toEqual(prepared.aliases);
  expect(d.diagnostics?.actors).toEqual(curves.map(c=>({actorId:c.input.actorId,report:c.report})));
  const corrected=new Set(curves.map(c=>c.input.actorId)),ids=source.frames[0].players.map(p=>p.key).sort();
  for(const t of ordered){
    const raw=scoredRaw(source,t),sample=d.sample(t,raw),frame=sample.frame!;
    expect(frame.players.map(p=>p.key).sort()).toEqual(ids);expect(frame.players).toHaveLength(22);
    expect(frame.players.every(p=>p.x>=0&&p.x<=105&&p.y>=0&&p.y<=68)).toBe(true);
    expect(frame.ball!.x).toBeGreaterThanOrEqual(0);expect(frame.ball!.x).toBeLessThanOrEqual(105);
    expect(frame.ball!.y).toBeGreaterThanOrEqual(0);expect(frame.ball!.y).toBeLessThanOrEqual(68);
    // Geometry may change; every non-geometric frame/player field stays factual/raw.
    expect({...frame,players:raw.frame.players,ball:raw.frame.ball}).toEqual(raw.frame);
    expect({...sample.previous!,players:raw.previous.players,ball:raw.previous.ball}).toEqual(raw.previous);
    expect(sample.previous!.players.filter(p=>!corrected.has(p.key))).toEqual(raw.previous.players.filter(p=>!corrected.has(p.key)));
    for(const player of frame.players){const originalPlayer=raw.frame.players.find(p=>p.key===player.key)!;
      if(!corrected.has(player.key))expect(player).toEqual(originalPlayer);
      else{expect({...player,x:originalPlayer.x,y:originalPlayer.y}).toEqual(originalPlayer);
        const curve=curves.find(c=>c.input.actorId===player.key)!,span=curve.spans.find(s=>t>=s.fromMs&&t<=s.toMs)!;
        expect(distance(player,pointAt(span,t))).toBeLessThanOrEqual(1e-6);
        expect(distance(sequenceFocus(d,t,player.key,false)!,player)).toBeLessThanOrEqual(1e-6);}
    }
    const focus=sequenceFocus(d,t,null,false);expect(focus).not.toBeNull();expect(Number.isFinite(focus!.x)&&Number.isFinite(focus!.y)).toBe(true);
    expect(sequenceCue(source,t)?.type).not.toBe('goal');
    for(const locale of ['en','es'] as const)for(const moment of momentsAt(source,t,locale)){
      expect(moment.atMs).toBeLessThanOrEqual(t);
      expect(moment.evidenceIds.every(id=>source.events.some(e=>e.id===id&&e.elapsedMs<=t))).toBe(true);
      if(t<1697116)expect(moment.evidenceIds).not.toContain(source.events.find(e=>e.outcome==='Goal')!.id);
    }
  }
  // The rate changes cursor order/density, never the data provider or source clock.
  const schedules=[];
  for(const rate of [.5,1,2]){
    const schedule=new Set(ordered);for(let wall=0;fromMs+wall*rate<=toMs;wall+=50)schedule.add(fromMs+wall*rate);
    const forward=[...schedule].sort((a,b)=>a-b);
    for(const direction of [forward,[...forward].reverse()])for(const t of direction){
      expect(JSON.stringify(d.sample(t,scoredRaw(source,t)))).toBe(seen.get(t));
      expect(sequenceFocus(d,t,null,false)).toEqual(focusSeen.get(t));
    }
    schedules.push({rate,forward:forward.length,backward:forward.length});
  }
  const ballProofs=ball.map((span,i)=>{
    const action=prepared.actions.find(a=>a.event.elapsedMs===span.fromMs&&a.presentationEndMs===span.toMs);
    const p=span.at(span.fromMs)!,q=span.at(span.toMs)!;expect(p).not.toBeNull();expect(q).not.toBeNull();
    if(i){expect(span.fromMs).toBe(ball[i-1].toMs);expect(distance(p,ball[i-1].at(span.fromMs)!)).toBeLessThanOrEqual(1e-6);}
    let maxSpeed:number,kind:string;
    if(action?.event.kind==='Carry'){
      const curve=curves.find(c=>c.input.actorId===action.event.actorId)!;
      maxSpeed=Math.max(...curve.spans.filter(s=>s.toMs>=span.fromMs&&s.fromMs<=span.toMs).map(s=>inspectSpan(s).maxSpeed));kind='certified_actor_carry';
      for(const t of ordered.filter(t=>t>=span.fromMs&&t<=span.toMs))expect(distance(span.at(t)!,pointAt(curve.spans.find(s=>t>=s.fromMs&&t<=s.toMs)!,t))).toBeLessThanOrEqual(1e-6);
    }else{
      kind=action?.event.kind??'bounded_bridge';maxSpeed=distance(p,q)/((span.toMs-span.fromMs)/1000);
      if(action){expect(distance(p,action.event.start!)).toBeLessThanOrEqual(1e-6);expect(distance(q,action.event.end!)).toBeLessThanOrEqual(1e-6);}
      else expect(span.toMs-span.fromMs).toBeLessThanOrEqual(5000);
      // For linear Pass/Shot/bridge construction these endpoint coefficients prove the bound continuously.
      for(const t of ordered.filter(t=>t>=span.fromMs&&t<=span.toMs)){
        const u=(t-span.fromMs)/(span.toMs-span.fromMs);
        expect(distance(span.at(t)!,{x:p.x+(q.x-p.x)*u,y:p.y+(q.y-p.y)*u})).toBeLessThanOrEqual(1e-6);
      }
    }
    expect(maxSpeed).toBeLessThanOrEqual(45+1e-8);
    return {from_ms:span.fromMs,to_ms:span.toMs,kind,max_speed_m_s:maxSpeed,handoff_error_m:i?distance(p,ball[i-1].at(span.fromMs)!):0};
  });
  expect(ball[0].fromMs).toBe(fromMs);expect(ball.at(-1)!.toMs).toBe(1697850.325);
  for(const t of [fromMs-1,toMs+1]){expect(d.sample(t,rawView(source,t)).availability).toBe('unavailable');expect(sequenceFocus(d,t,null,false)).toBeNull();}
  expect(JSON.stringify(source)).toBe(before);
  expect(source.rawDigest).toBe('2448bed73cb06c3fbaf2df69b31e6af208afc38a909128b887740428f3b04944');
  expect(source.frames.filter(f=>f.clock_ms>=fromMs&&f.clock_ms<=toMs&&f.ball===null)).toHaveLength(70);
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  const fsName='node:fs',cryptoName='node:crypto';
  const fs=await import(/* @vite-ignore */ fsName) as {readFileSync:(path:string,encoding:'utf8')=>string;writeFileSync:(path:string,text:string)=>void;existsSync:(p:string)=>boolean};
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(name:string)=>{update:(text:string)=>{digest:(encoding:string)=>string}}};
  const legacy=JSON.parse(readPrivateFile(fs,'../research/design-evaluation/2026-10-20-match-sequence/phase2-depiction.json'));
  expect(legacy).toMatchObject({gate:'failed',samples:614,availability:oldAvailability,issues:v1.issues});
  const protectedSources=JSON.parse(readPrivateFile(fs,'../research/design-evaluation/2026-10-20-match-sequence/source-evidence.json')).protected_sha256 as Record<string,string>;
  const checked=Object.fromEntries(Object.entries(protectedSources).filter(([path])=>!path.includes('three.ts')));
  expect(Object.keys(checked)).toHaveLength(3);
  for(const [path,hash] of Object.entries(checked))expect(crypto.createHash('sha256').update(fs.readFileSync(`../${path.replace(/\\/g,'/')}`,'utf8')).digest('hex')).toBe(hash);
  const sourceHashes=JSON.parse(fs.readFileSync(`${env!.TIMEPITCH_SEQUENCE_SOURCE_DIR}/sources.json`,'utf8')).files as Record<string,string>;
  expect(Object.keys(sourceHashes)).toHaveLength(9); // Already verified by the sealed private reader above.
  const report={case:'TP146',phase:'C4',date:'2026-10-21',profile:d.version,source_digest:source.rawDigest,
    identity:source.identity,motion_revision:source.motionRevision,policy_version:d.diagnostics!.policyVersion,source_files_sha256:sourceHashes,
    clip:{from_ms:fromMs,to_ms:toMs},gate,samples:ordered.length,availability,issues:d.issues,
    v1:{gate:'failed',samples:original.length,availability:oldAvailability,issues:v1.issues},
    aliases:prepared.aliases,actors:actorProofs,ball:ballProofs,schedules,
    original_null_ball_frames:70,source_mutated:false,background_players:22-corrected.size,
    background_scope:'Unchanged synthetic context; no new C1 or measured-tracking certification',protected_sources_sha256:checked,
    invariants:{source_json_unchanged:true,all_event_starts_and_durations_unchanged:true,identities:22,
      score_before_goal:{home:1,away:0},score_from_1697116:{home:1,away:1},no_future_evidence:true,
      no_early_celebration:true,goal_flight_end_ms:1697850.325,out_of_clip_rejected:true,
      previous_frame_facts_and_background_unchanged:true,ball_domain_contiguous:true},
    native_matches:0,model_calls:0,activation:'not_selected',visual_acceptance:'not_run'};
  if(env?.TIMEPITCH_SEQUENCE_CORRECTION_RECEIPT)fs.writeFileSync(env.TIMEPITCH_SEQUENCE_CORRECTION_RECEIPT,JSON.stringify(report,null,2)+'\n');
},30000);
