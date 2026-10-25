import { afterEach, expect, it, vi } from 'vitest';
import { compileDepiction, sequenceCue } from './depiction';
import { privateSequence, rawView, freeze } from './private-fixture';

afterEach(()=>vi.unstubAllGlobals());
it('carry_has_a_depiction_without_changing_raw_nulls',async()=>{
  const {source}=await privateSequence(),original=JSON.stringify(source),depiction=compileDepiction(source);
  const carry=source.events.find(e=>e.kind==='Carry'&&e.actorId==='historical:statsbomb:7063')!;
  for(let t=carry.elapsedMs;t<=carry.elapsedMs+carry.durationMs!;t+=50){
    const raw=rawView(source,t);freeze(raw);const frame=depiction.sample(t,raw).frame;
    expect(frame?.ball).not.toBeNull();expect(frame).not.toBeNull();
    const actor=frame!.players.find(p=>p.key===carry.actorId)!;
    expect(frame!.ball!.x).toBeCloseTo(actor.x,6);expect(frame!.ball!.y).toBeCloseTo(actor.y,6);
    expect(frame!.score).toEqual(raw.frame.score);expect(frame!.carrier).toBe(raw.frame.carrier);expect(frame!.possession).toBe(raw.frame.possession);
  }
  for(const [t,p] of [[carry.elapsedMs,carry.start],[carry.elapsedMs+carry.durationMs!,carry.end]] as const){
    const ball=depiction.sample(t,rawView(source,t)).frame?.ball;expect(ball!.x).toBeCloseTo(p!.x,6);expect(ball!.y).toBeCloseTo(p!.y,6);
  }
  expect(JSON.stringify(source)).toBe(original);
  expect(source.frames.filter(f=>f.clock_ms>=1684024&&f.clock_ms<=1697850&&f.ball===null)).toHaveLength(70);
});
it('invalid actions, conflicting anchors and foreign samples have explicit issues and never attach to a nearby player',async()=>{
  const {source}=await privateSequence();const carry=source.events.find(e=>e.kind==='Carry')!;
  for(const durationMs of [null,0,-1]){
    const d=compileDepiction({...source,events:source.events.map(e=>e.id===carry.id?{...e,durationMs}:e)});
    expect(d.issues.some(i=>i.refs.includes(carry.id))).toBe(true);
    expect(d.sample(carry.elapsedMs+200,rawView(source,carry.elapsedMs+200)).availability).toBe('unavailable');
  }
  const bad=compileDepiction({...source,events:source.events.map(e=>e.id===carry.id?{...e,start:{x:-1,y:20}}:e)});
  expect(bad.issues.length).toBeGreaterThan(0);
  expect(bad.sample(carry.elapsedMs+200,rawView(source,carry.elapsedMs+200)).availability).toBe('unavailable');
  expect(()=>compileDepiction({...source,identity:{...source.identity,id:'foreign'}})).toThrow();
  const d=compileDepiction(source),raw=rawView(source,1686000);raw.frame.players[0].key='foreign';
  expect(d.sample(1686000,raw).availability).toBe('unavailable');
  for(const t of [1684023,1697851,NaN])expect(d.sample(t,rawView(source,1684024)).availability).toBe('unavailable');
});
it('source cues name only the reached actor, honour body part, and delay celebration to the action endpoint',async()=>{
  const {source}=await privateSequence();
  expect(sequenceCue(source,1693655)).toMatchObject({type:'shot',bodyPart:'head',participants:['historical:statsbomb:20521']});
  expect(sequenceCue(source,1695068)).toMatchObject({type:'shot',bodyPart:'left_foot',participants:['historical:statsbomb:3347']});
  expect(sequenceCue(source,1697116)).toMatchObject({type:'shot',bodyPart:'left_foot',t1_ms:1697116});
  const goal=source.events.find(e=>e.outcome==='Goal')!;
  expect(sequenceCue(source,goal.elapsedMs+goal.durationMs!)).toMatchObject({type:'goal',t1_ms:goal.elapsedMs+goal.durationMs!});
  expect(sequenceCue({...source,events:source.events.map(e=>({...e,actorId:'unknown'}))},1693655)).toBeUndefined();
});

const V2='historical-action-preview-2' as const;
it('keeps V1 as the default and isolates the explicit immutable V2 profile and diagnostics',async()=>{
  const {source}=await privateSequence(),before=JSON.stringify(source),legacy=compileDepiction(source),explicit=compileDepiction(source,'historical-action-preview-1');
  expect(explicit.key).toBe(legacy.key);expect(explicit.issues).toEqual(legacy.issues);expect(legacy.version).toBe('historical-action-preview-1');
  const d=compileDepiction(source,V2);expect(d.version).toBe(V2);expect(d.key).not.toBe(legacy.key);expect(compileDepiction(source,V2)).toBe(d);
  expect(d.diagnostics?.policyVersion).toBe('sequence-constraints-1');expect(d.diagnostics?.aliases).toHaveLength(5);
  expect(d.diagnostics?.actors).toHaveLength(7);expect(d.diagnostics?.actors.every(a=>a.report.status==='certified')).toBe(true);
  expect(d.diagnostics!.actors.map(a=>a.actorId)).toEqual([...d.diagnostics!.actors.map(a=>a.actorId)].sort());
  expect(Object.isFrozen(d.diagnostics)).toBe(true);expect(Object.isFrozen(d.diagnostics?.actors)).toBe(true);
  expect(d.issues).toEqual([]);expect(legacy.issues).toHaveLength(10);expect(legacy.diagnostics).toBeUndefined();
  expect(()=>compileDepiction(source,'foreign' as never)).toThrow();
  expect(()=>compileDepiction({...source,identity:{...source.identity,id:'foreign'}},V2)).toThrow();
  expect(()=>compileDepiction({...source,rawDigest:'b'.repeat(64)},V2)).toThrow();
  const raw=rawView(source,1693550);raw.frame.players[0].key='foreign';expect(d.sample(1693550,raw).availability).toBe('unavailable');
  expect(JSON.stringify(source)).toBe(before);
});

it('uses V2 presentation handoffs while preserving facts, cue timing and the precise goal flight',async()=>{
  const {source}=await privateSequence(),before=JSON.stringify(source),d=compileDepiction(source,V2),seen=new Map<number,string>();
  expect(d.version).toBe(V2);
  const times=new Set<number>([1684024,1693550,1697115,1697116,1697850]);
  for(const alias of d.diagnostics!.aliases)for(const t of [alias.sourceEndMs,alias.presentationEndMs])for(const delta of [-1,0,1])times.add(t+delta);
  const rows=[];
  for(const t of [...times].sort((a,b)=>a-b)){
    const raw=rawView(source,t);raw.frame.score={home:1,away:t>=1697116?1:0};freeze(raw);
    const sample=d.sample(t,raw);expect(sample.availability,`cursor ${t}`).toBe('available');expect(sample.frame).not.toBeNull();
    expect(sample.frame!.score).toEqual(raw.frame.score);expect(sample.frame!.clock_ms).toBe(t);expect(sample.frame!.period).toBe(1);
    expect(sample.frame!.possession).toBeNull();expect(sample.frame!.carrier).toBeNull();expect(sample.frame!.players).toHaveLength(22);
    seen.set(t,JSON.stringify(sample));rows.push({at_ms:t,availability:sample.availability,score:sample.frame!.score});
  }
  for(const t of [...times].reverse()){
    const raw=rawView(source,t);raw.frame.score={home:1,away:t>=1697116?1:0};expect(JSON.stringify(d.sample(t,raw))).toBe(seen.get(t));
  }
  for(const e of source.events.filter(e=>e.kind==='Carry')){
    const end=d.diagnostics!.aliases.find(a=>a.eventId===e.id)!.presentationEndMs,t=(e.elapsedMs+end)/2;
    const sample=d.sample(t,rawView(source,t)).frame!,p=sample.players.find(p=>p.key===e.actorId)!;
    expect(sample.ball).toEqual({x:p.x,y:p.y});
  }
  expect(sequenceCue(source,1695068)?.type).toBe('shot');expect(sequenceCue(source,1697115)?.type).not.toBe('goal');
  expect(sequenceCue(source,1697116)?.type).toBe('shot');expect(sequenceCue(source,1697850)?.type).not.toBe('goal');
  const goal=source.events.find(e=>e.outcome==='Goal')!;expect(goal.elapsedMs+goal.durationMs!).toBeCloseTo(1697850.325,7);
  for(const t of [1684023,1697850.325,1697851])expect(d.sample(t,rawView(source,t)).availability).toBe('unavailable');
  expect(JSON.stringify(source)).toBe(before);expect(source.frames.filter(f=>f.ball===null&&f.clock_ms>=1684024&&f.clock_ms<=1697850)).toHaveLength(70);
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_SEQUENCE_INTEGRATION_RECEIPT){const name='node:fs';const fs=await import(/* @vite-ignore */ name) as {writeFileSync:(p:string,t:string)=>void};
    fs.writeFileSync(env.TIMEPITCH_SEQUENCE_INTEGRATION_RECEIPT,JSON.stringify({case:'TP145',phase:'C3',profile:d.version,source_digest:source.rawDigest,
      diagnostics:d.diagnostics,issues:d.issues,checked_boundaries:rows,C4_acceptance:'not_run',native_matches:0,model_calls:0,activation:false},null,2)+'\n');}
});

it('does not let a rejected actor supply a Carry even when the raw player remains visible',async()=>{
  const {source}=await privateSequence();
  const changed={...source,events:source.events.map(e=>e.actorId==='historical:statsbomb:3347'&&e.elapsedMs>=1696431
    ?{...e,start:e.start?{...e.start,x:90}:null,end:e.kind==='Carry'&&e.end?{...e.end,x:90}:e.end}:e)};
  const d=compileDepiction(changed,V2);
  expect(d.version).toBe(V2);
  expect(d.diagnostics!.actors.find(a=>a.actorId==='historical:statsbomb:3347')!.report.status).toBe('constraint_conflict');
  expect(d.issues.some(i=>i.reason==='carry_actor_curve_rejected')).toBe(true);expect(d.sample(1696800,rawView(changed,1696800)).availability).toBe('unavailable');
});

it.each(['restart','conflict','contradictory_anchor','unknown'])('keeps a genuine %s ball gap unavailable',async reason=>{
  const {source}=await privateSequence(),changed={...source,cuts:[...source.cuts,{id:'blocked-bridge',fromMs:1694187,toMs:1694592,entityIds:['ball'],reason,refs:[]}]};
  const d=compileDepiction(changed,V2);expect(d.version).toBe(V2);expect(d.issues.some(i=>i.reason==='unknown_or_conflicting_ball_gap')).toBe(true);
  expect(d.sample(1694400,rawView(changed,1694400)).availability).toBe('unavailable');
});

it('preserves the 5s unknown-gap limit without undoing the known long Carry',async()=>{
  const {source}=await privateSequence(),changed={...source,events:source.events.filter(e=>e.elapsedMs<=1685158&&e.kind!=='Carry'||e.outcome==='Goal')};
  const d=compileDepiction(changed,V2);expect(d.version).toBe(V2);expect(d.sample(1690000,rawView(changed,1690000)).availability).toBe('unavailable');
  expect(d.issues.some(i=>i.reason==='unknown_or_conflicting_ball_gap'&&i.toMs-i.fromMs>5000)).toBe(true);
});

it('checks pass speed again after a valid presentation alias shortens its duration',async()=>{
  const {source}=await privateSequence(),pass=source.events[0],receipt=source.events.find(e=>e.kind==='Ball Receipt*')!;
  const seconds=(receipt.elapsedMs-pass.elapsedMs)/1000,sign=pass.start!.x<52.5?1:-1;
  const end={x:pass.start!.x+sign*(45*seconds+.01),y:pass.start!.y};
  const changed={...source,events:[{...pass,end,durationMs:seconds*1000+.8},{...receipt,start:end}]};
  expect((45*seconds+.01)/(seconds+.0008)).toBeLessThan(45);
  const d=compileDepiction(changed,V2);expect(d.version).toBe(V2);expect(d.diagnostics!.aliases).toHaveLength(1);
  expect(d.issues.some(i=>i.reason==='ball_speed_limit')).toBe(true);
  const t=(pass.elapsedMs+receipt.elapsedMs)/2;expect(d.sample(t,rawView(changed,t)).availability).toBe('unavailable');
});

it('rejects incompatible ball positions at an exact shared action boundary',async()=>{
  const {source}=await privateSequence(),shot=source.events.find(e=>e.kind==='Shot')!,carry=source.events.find(e=>e.kind==='Carry'&&e.actorId==='historical:statsbomb:3347')!;
  const changed={...source,events:[{...shot,durationMs:531,relatedIds:[]},
    {...carry,elapsedMs:1694186,periodMs:1694186,relatedIds:[]}]};
  const d=compileDepiction(changed,V2);expect(d.version).toBe(V2);
  expect(d.diagnostics!.actors.every(a=>a.report.status==='certified')).toBe(true);
  expect(d.issues).toContainEqual(expect.objectContaining({reason:'conflicting_ball_handoff',fromMs:1694186,toMs:1694186}));
  expect(d.sample(1694186,rawView(changed,1694186)).availability).toBe('unavailable');
});

it.each([[1692170.7,1692170.9],[1692171,1692171]])('does not erase a restart at %s–%s with a presentation alias',async(fromMs,toMs)=>{
  const {source}=await privateSequence(),changed={...source,cuts:[...source.cuts,{id:'alias-restart',fromMs,toMs,entityIds:['ball'],reason:'restart',refs:[]}]};
  const d=compileDepiction(changed,V2);expect(d.version).toBe(V2);expect(d.diagnostics!.aliases).toHaveLength(5);
  const t=(fromMs+toMs)/2;expect(d.sample(t,rawView(changed,t)).availability).toBe('unavailable');
  expect(d.issues).toContainEqual(expect.objectContaining({reason:'source_ball_cut',fromMs,toMs}));
});

it.each(['Pass','Shot'])('rejects a %s duration that collapses to a zero-width span in floating-point time',async kind=>{
  const {source}=await privateSequence(),base=source.events[0];
  const changed={...source,events:[{...base,kind,durationMs:1e-20,end:base.start,relatedIds:[]}]};
  const d=compileDepiction(changed,V2);expect(d.version).toBe(V2);
  expect(d.issues.some(i=>i.reason==='invalid_action')).toBe(true);
  expect(d.sample(base.elapsedMs,rawView(changed,base.elapsedMs)).availability).toBe('unavailable');
});
