import { afterEach, expect, it, vi } from 'vitest';
import { syntheticFrame } from '../unified-fixtures';
import { prepareConstraints } from './constraints';
import { AYEW_SEQUENCE, PILOT_REVISION } from './pilot';
import { freeze, privateSequence } from './private-fixture';
import type { SequenceEvent, SequenceSource } from './types';

const actor='historical:statsbomb:3347',recipient='historical:statsbomb:7063';
const {fromMs,toMs}=AYEW_SEQUENCE;
function event(overrides:Partial<SequenceEvent>={}):SequenceEvent {
  return {id:'historical:carry',refs:['carry'],sourceIndex:1,period:1,periodMs:fromMs+100,elapsedMs:fromMs+100,
    kind:'Carry',actorId:actor,side:'away',recipientId:null,relatedIds:['historical:shot'],assistedShotId:null,
    possessionId:65,durationMs:500.345,start:{x:10,y:20},end:{x:11,y:20},outcome:null,bodyPart:null,xg:null,...overrides};
}
function source(events:readonly SequenceEvent[]=[event(),event({id:'historical:shot',refs:['shot'],sourceIndex:2,
  elapsedMs:fromMs+600,periodMs:fromMs+600,kind:'Shot',durationMs:100,start:{x:11,y:20},end:{x:13,y:20},relatedIds:[]})]):SequenceSource {
  const identity={source:'historical' as const,id:'3754078',revision:PILOT_REVISION},motionRevision='reconstruction-1',rawDigest='a'.repeat(64);
  const players=[actor,recipient,...Array.from({length:20},(_,i)=>`historical:context:${i}`)]
    .map(key=>({key,name:'Synthetic test participant',role:'MID' as const,side:'away' as const,x:10,y:20}));
  return {key:JSON.stringify([identity,motionRevision,rawDigest,AYEW_SEQUENCE]),identity,motionRevision,rawDigest,
    request:AYEW_SEQUENCE,events,frames:[syntheticFrame({clock_ms:fromMs,players}),syntheticFrame({clock_ms:toMs,players:players.map(p=>({...p,x:15}))})],cuts:[]};
}
afterEach(()=>vi.unstubAllGlobals());

it('separates hard event anchors from a soft synthetic exit without changing source durations',()=>{
  const s=source(),before=JSON.stringify(s);freeze(s);const p=prepareConstraints(s),a=p.actors.find(a=>a.actorId===actor)!;
  expect(a.hardKnots).toEqual([{atMs:fromMs,point:{x:10,y:20},refs:[]},
    {atMs:fromMs+100,point:{x:10,y:20},refs:['carry']},
    {atMs:fromMs+600,point:{x:11,y:20},refs:['carry','shot']}]);
  expect(a.softExit).toEqual({atMs:toMs,target:{x:15,y:20}});
  expect(p.aliases).toHaveLength(1);expect(p.aliases[0]).toMatchObject({kind:'carry_handoff',sourceEndMs:fromMs+600.345,presentationEndMs:fromMs+600});
  expect(p.actions[0].event.durationMs).toBe(500.345);expect(p.actions[0].presentationEndMs).toBe(fromMs+600);
  expect(p.sourceKey).toBe(s.key);expect(p.sourceDigest).toBe(s.rawDigest);expect(p.issues).toEqual([]);
  expect(JSON.stringify(s)).toBe(before);
});

it('owns frozen output without freezing or retaining mutable input objects',()=>{
  const s=source(),p=prepareConstraints(s);expect(Object.isFrozen(s.events[0])).toBe(false);
  expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.actors[0].hardKnots[0].point)).toBe(true);
  const first=p.actions[0];expect(first.event).not.toBe(s.events[0]);
  (s.events[0].start as {x:number}).x=99;
  expect(first.event.start).toEqual({x:10,y:20});expect(p.actors[0].hardKnots[0].point).toEqual({x:10,y:20});
});

it('a real action exactly at clip end stays hard instead of being replaced by the synthetic exit',()=>{
  const s=source([event({id:'end-action',sourceIndex:3,elapsedMs:toMs,periodMs:toMs,kind:'Shot',durationMs:100,start:{x:12,y:20},relatedIds:[]})]);
  const a=prepareConstraints(s).actors[0];expect(a.softExit).toBeNull();
  expect(a.hardKnots.at(-1)).toEqual({atMs:toMs,point:{x:12,y:20},refs:['carry']});
});

it('merges equal-time equal-position facts while rejecting contradictory hard anchors for that actor',()=>{
  const e=event({kind:'Ball Recovery',durationMs:0,end:null,relatedIds:[]});
  const second={...e,id:'another',sourceIndex:2,refs:['another']};
  const p=prepareConstraints(source([e,second]));expect(p.actors[0].hardKnots[1].refs).toEqual(['carry','another']);
  const bad=prepareConstraints(source([e,{...second,start:{x:12,y:20}}]));
  expect(bad.actors.some(a=>a.actorId===actor)).toBe(false);
  expect(bad.issues).toContainEqual(expect.objectContaining({entityId:actor,reason:'contradictory_anchor'}));
});

it('links a pass only to its named recipient and keeps both recorded events untouched',()=>{
  const pass=event({kind:'Pass',recipientId:recipient,relatedIds:['receipt']});
  const receipt=event({id:'receipt',refs:['receipt'],sourceIndex:2,kind:'Ball Receipt*',actorId:recipient,elapsedMs:fromMs+600,
    periodMs:fromMs+600,start:{x:11,y:20},end:null,durationMs:null,relatedIds:[pass.id]});
  const p=prepareConstraints(source([pass,receipt]));
  expect(p.aliases).toEqual([{eventId:pass.id,nextEventId:'receipt',kind:'pass_receipt',sourceEndMs:fromMs+600.345,
    presentationEndMs:fromMs+600,deltaMs:expect.closeTo(-.345,6),refs:['carry','receipt']}]);
  expect(p.actions[0].event).toEqual(pass);expect(p.actors.find(a=>a.actorId===recipient)!.hardKnots[1].atMs).toBe(fromMs+600);
});

it.each(['unlinked','wrong-actor','wrong-period','different-location','too-late','intervening','ambiguous'] as const)(
  'rejects %s temporal aliases instead of silently rounding durations',kind=>{
    const s=source(),carry=s.events[0],shot=s.events[1];let events:SequenceEvent[]=[carry,shot];
    if(kind==='unlinked')events=[{...carry,relatedIds:[]},shot];
    if(kind==='wrong-actor')events=[carry,{...shot,actorId:recipient}];
    if(kind==='wrong-period')events=[carry,{...shot,period:2}];
    if(kind==='different-location')events=[carry,{...shot,start:{x:11.001,y:20}}];
    if(kind==='too-late')events=[carry,{...shot,elapsedMs:fromMs+602,periodMs:fromMs+602}];
    if(kind==='intervening')events=[carry,event({id:'intervening',sourceIndex:3,kind:'Pass',actorId:recipient,elapsedMs:fromMs+300,periodMs:fromMs+300,relatedIds:[]}),shot];
    if(kind==='ambiguous')events=[{...carry,relatedIds:[shot.id,'competing']},shot,{...shot,id:'competing',sourceIndex:3}];
    const p=prepareConstraints({...s,events});expect(p.aliases).toEqual([]);
    expect(p.actions.find(a=>a.event.id===carry.id)?.presentationEndMs).toBe(fromMs+600.345);
    expect(p.issues.length).toBeGreaterThan(0);
  });

it('does not alias a receipt belonging to a different pass recipient',()=>{
  const pass=event({kind:'Pass',recipientId:recipient,relatedIds:['receipt']});
  const receipt=event({id:'receipt',sourceIndex:2,kind:'Ball Receipt*',actorId:actor,elapsedMs:fromMs+600,periodMs:fromMs+600,start:{x:11,y:20},end:null,relatedIds:[]});
  const p=prepareConstraints(source([pass,receipt]));expect(p.aliases).toEqual([]);expect(p.issues.length).toBeGreaterThan(0);
});

it.each([null,0,-1,NaN,Infinity])('keeps invalid action duration %s unavailable rather than inventing one',durationMs=>{
  const p=prepareConstraints(source([event({durationMs})]));expect(p.aliases).toEqual([]);
  expect(p.actions[0].presentationEndMs).toBeNull();expect(p.issues.some(i=>i.reason==='invalid_action')).toBe(true);
});

it('does not make a source anchor sampleable when its coordinate is invalid',()=>{
  const p=prepareConstraints(source([event({start:{x:-1,y:20}})]));
  expect(p.actors.some(a=>a.actorId===actor)).toBe(false);expect(p.issues.some(i=>i.entityId===actor&&i.reason==='invalid_anchor')).toBe(true);
});

it('caps the number of hard knots instead of handing an unbounded chain to the solver',()=>{
  const events=Array.from({length:65},(_,i)=>event({id:`event:${i}`,sourceIndex:i,elapsedMs:fromMs+100+i*10,periodMs:fromMs+100+i*10,
    kind:'Ball Recovery',durationMs:0,end:null,relatedIds:[]}));
  const p=prepareConstraints(source(events));expect(p.actors).toEqual([]);expect(p.issues.some(i=>i.reason==='actor_knot_limit')).toBe(true);
});

it('counts the free terminal node in the 64-knot budget',()=>{
  const events=Array.from({length:63},(_,i)=>event({id:`event:${i}`,sourceIndex:i,elapsedMs:fromMs+100+i*10,periodMs:fromMs+100+i*10,
    kind:'Ball Recovery',durationMs:0,end:null,relatedIds:[]}));
  expect(prepareConstraints(source(events.slice(0,62))).actors[0].hardKnots).toHaveLength(63);
  const p=prepareConstraints(source(events));expect(p.actors).toEqual([]);expect(p.issues.some(i=>i.reason==='actor_knot_limit')).toBe(true);
});

it.each(['Ball Recovery','Ball Receipt*','Interception','Goal Keeper','Block','Duel'])(
  'does not alias through an intervening %s control or challenge',kind=>{
    const s=source(),other=event({id:'interruption',sourceIndex:3,kind,actorId:recipient,elapsedMs:fromMs+300,periodMs:fromMs+300,
      durationMs:0,start:{x:10,y:20},end:null,relatedIds:[]});
    const p=prepareConstraints({...s,events:[s.events[0],other,s.events[1]]});
    expect(p.aliases).toEqual([]);expect(p.issues.some(i=>i.reason==='presentation_alias_conflict')).toBe(true);
  });

it('requires a receipt identity from the boundary roster, not merely a matching unknown ID',()=>{
  const pass=event({kind:'Pass',recipientId:'unknown',relatedIds:['receipt']});
  const receipt=event({id:'receipt',sourceIndex:2,kind:'Ball Receipt*',actorId:'unknown',elapsedMs:fromMs+600,periodMs:fromMs+600,
    start:{x:11,y:20},durationMs:0,end:null,relatedIds:[]});
  const p=prepareConstraints(source([pass,receipt]));expect(p.aliases).toEqual([]);
  expect(p.issues.some(i=>i.entityId==='unknown'&&i.reason==='actor_identity_unavailable')).toBe(true);
});

it('keeps the temporal alias threshold inclusive at 1ms and rejects values beyond it',()=>{
  const s=source();
  expect(prepareConstraints({...s,events:[{...s.events[0],durationMs:499},s.events[1]]}).aliases[0].deltaMs).toBe(1);
  expect(prepareConstraints({...s,events:[{...s.events[0],durationMs:498.999},s.events[1]]}).aliases).toEqual([]);
});

it('rejects duplicate source IDs or indices instead of merging independent facts',()=>{
  const s=source();
  expect(()=>prepareConstraints({...s,events:[s.events[0],s.events[0]]})).toThrow(/Duplicate/);
  expect(()=>prepareConstraints({...s,events:[s.events[0],{...s.events[1],sourceIndex:1}]})).toThrow(/Duplicate/);
});

it('is deterministic when source events arrive in a different order',()=>{
  const s=source(),forward=prepareConstraints(s),reverse=prepareConstraints({...s,events:[...s.events].reverse()});
  expect(reverse).toEqual(forward);
});

it('retains bounded source context without treating out-of-clip events as invalid pilot anchors',()=>{
  const s=source(),context=event({id:'context',sourceIndex:0,kind:'Ball Recovery',elapsedMs:fromMs-1000,periodMs:fromMs-1000,
    durationMs:0,start:{x:4,y:20},end:null,relatedIds:[]});
  const prepared=prepareConstraints({...s,events:[context,...s.events]});
  expect(prepared.issues).toEqual([]);expect(prepared.actions.map(a=>a.event.id)).toEqual(['historical:carry','historical:shot']);
  expect(prepared.actors[0].hardKnots[0]).toEqual({atMs:fromMs,point:{x:10,y:20},refs:[]});
});

it.each(['identity','request','digest','key','missing-entry','duplicate-player','different-exit-roster','over-22'])(
  'rejects the %s source boundary instead of accepting a foreign or ambiguous clip',kind=>{
    const s=source();let bad:SequenceSource=s;
    if(kind==='identity')bad={...s,identity:{...s.identity,id:'foreign'}};
    if(kind==='request')bad={...s,request:{...s.request,toMs:toMs+1} as SequenceSource['request']};
    if(kind==='digest')bad={...s,rawDigest:'b'.repeat(64)};
    if(kind==='key')bad={...s,key:'foreign'};
    if(kind==='missing-entry')bad={...s,frames:[s.frames[1]]};
    if(kind==='duplicate-player')bad={...s,frames:s.frames.map(f=>({...f,players:[...f.players,f.players[0]]}))};
    if(kind==='different-exit-roster')bad={...s,frames:[s.frames[0],{...s.frames[1],players:s.frames[1].players.slice(1)}]};
    if(kind==='over-22')bad={...s,frames:s.frames.map(f=>({...f,players:[...f.players,{...f.players[0],key:'extra'}]}))};
    expect(()=>prepareConstraints(bad)).toThrow();
  });

it('prepares the five measured aliases from the real saved match, retaining raw timing and the goal flight',async()=>{
  const {source:s}=await privateSequence(),before=JSON.stringify(s),p=prepareConstraints(s);
  expect(s.rawDigest).toBe('2448bed73cb06c3fbaf2df69b31e6af208afc38a909128b887740428f3b04944');
  const want:readonly (readonly [string,number,number])[]=[['6d5f574e-6796-4686-a8eb-5fff73fe3dea',1685157.667,1685158],
    ['a6f403f1-0209-4f87-b0f7-fd77a5501b9e',1692170.573,1692171],
    ['d1d446ec-f47c-4809-9f73-f2c5b2b4d881',1693494.624,1693494],
    ['7ef21b90-a08a-4201-92ea-dbf9003b6eff',1695068.345,1695068],
    ['faf76064-22e0-49c1-87d0-77e35c0e4b6c',1697115.194,1697116]];
  expect(p.aliases).toHaveLength(5);
  for(const [id,raw,end] of want){const alias=p.aliases.find(a=>a.eventId===`historical:${id}`)!;
    expect(alias.sourceEndMs).toBeCloseTo(raw,7);expect(alias.presentationEndMs).toBe(end);
    expect(p.actions.find(a=>a.event.id===alias.eventId)!.event).toEqual(s.events.find(e=>e.id===alias.eventId));
  }
  expect(p.issues).toEqual([]);expect(p.actors.map(a=>a.actorId)).toEqual([...p.actors.map(a=>a.actorId)].sort());
  expect(p.actors.find(a=>a.actorId==='historical:statsbomb:20521')!.hardKnots.map(k=>k.atMs)).toEqual([1684024,1693494,1693655]);
  const goal=p.actions.find(a=>a.event.outcome==='Goal')!;expect(goal.event.elapsedMs).toBe(1697116);
  expect(goal.presentationEndMs).toBeCloseTo(1697850.325,7);
  expect(s.frames.filter(f=>f.clock_ms>=fromMs&&f.clock_ms<=toMs&&f.ball===null)).toHaveLength(70);
  expect(JSON.stringify(s)).toBe(before);
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_SEQUENCE_CONSTRAINTS_RECEIPT){
    const moduleName='node:fs';const fs=await import(/* @vite-ignore */ moduleName) as {writeFileSync:(path:string,text:string)=>void};
    fs.writeFileSync(env.TIMEPITCH_SEQUENCE_CONSTRAINTS_RECEIPT,JSON.stringify({case:'TP143',phase:'C1',status:'constraints_prepared_not_motion_certified',
      source_digest:s.rawDigest,policy:'sequence-constraints-1',aliases:p.aliases,
      actors:p.actors.map(a=>({actor_id:a.actorId,hard_knots:a.hardKnots.map(k=>({at_ms:k.atMs,refs:k.refs})),synthetic_exit_soft:a.softExit!==null})),
      issues:p.issues,original_null_ball_frames:70,source_mutated:false,native_matches:0,model_calls:0,activation:false},null,2)+'\n');
  }
});
