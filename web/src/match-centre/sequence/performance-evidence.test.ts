import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HistoricalEvent } from '../../historical/api';
import { createHistoricalSession } from '../adapters/historical';
import { signal } from '../adapters/test-fixtures';
import { normalizePerformanceEvidence } from './performance-evidence';
import { action, sequenceDescriptor } from './test-fixtures';
import { AYEW_SEQUENCE, PILOT_REVISION } from './pilot';
import { freeze, sourceBundle } from './private-fixture';

beforeEach(async() => { const cryptoName='node:crypto';const {webcrypto}=await import(/* @vite-ignore */ cryptoName) as {webcrypto:Crypto};vi.stubGlobal('crypto',webcrypto); });
afterEach(() => vi.unstubAllGlobals());
const copy = <T,>(v:T):T => JSON.parse(JSON.stringify(v));
const shotDetails=(e:HistoricalEvent)=>e.details!.shot as {freeze_frame:any[];end_location?:number[]};
function descriptor() {
  const d=sequenceDescriptor(), rawDigest='a'.repeat(64), motionRevision='test-motion';
  const people=[3509,3645,3957,7063,20521,3347].map(id=>({sourceId:id,key:`statsbomb:${id}`,teamKey:[3509,3645,3957].includes(id)?d.home.id:d.away.id}));
  const sourceKey=JSON.stringify([d.identity,motionRevision,rawDigest,AYEW_SEQUENCE]);
  d.metadata={...d.metadata,reconstruction:motionRevision,playerIdentities:people,
    performanceContext:{sourceKey,rawDigest,motionRevision,request:AYEW_SEQUENCE,
      participants:[{period:1,periodMs:1693655,playerKeys:people.map(p=>p.key)}]}};
  return d;
}
function shot():HistoricalEvent {
  return {...action('header',1693655,'Shot',20521),location:{x:96.6,y:36.55},canonical_location:{x:8.4,y:31.45},
    details:{shot:{body_part:{name:'Head'},end_location:[116.6,39.4,.9],freeze_frame:[
      {location:[117.8,40],player:{id:3509,name:'Wrong name'},teammate:false,position:{id:1}},
      {location:[111.2,37.3],player:{id:3957},teammate:false},
    ]}}};
}

it('orients all snapshot rows in the parent shot frame, preserving raw rows and sealed owned copies',async()=>{
  const raw=[shot()],d=descriptor(),before=JSON.stringify({raw,d});freeze(raw);freeze(d);
  const e=await normalizePerformanceEvidence(raw,d);
  expect(e.snapshots[0].rows[0]).toMatchObject({playerKey:'historical:statsbomb:3509',status:'usable',point:{x:expect.closeTo(1.925,10),y:34}});
  expect(e.snapshots[0].rows[0].raw).toEqual(shotDetails(raw[0]).freeze_frame[0]);
  expect(e.sourceKey).toBe((d.metadata!.performanceContext as {sourceKey:string}).sourceKey);
  expect(e.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);expect(e.version).toBe('sequence-performance-evidence-1');
  expect(Object.isFrozen(e.snapshots[0].rows[0].raw)).toBe(true);
  expect(JSON.stringify({raw,d})).toBe(before);
});
it('uses the same parent-frame rule for a home shot and the second half without flipping each opponent again',async()=>{
  for(const [team,period,expected] of [['home',1,{x:103.075,y:34}],['away',2,{x:103.075,y:34}],['home',2,{x:1.925,y:34}]] as const){
    const d=descriptor(),e=shot(),ctx=copy(d.metadata!.performanceContext) as any;
    e.period=period;e.team_key=team==='home'?d.home.id:d.away.id;e.player_key=team==='home'?'statsbomb:3645':'statsbomb:20521';
    e.canonical_location=period===1?e.location:{x:96.6,y:36.55};
    if(team==='home'&&period===2)e.canonical_location={x:8.4,y:31.45};
    shotDetails(e).freeze_frame[0].teammate=team==='home';
    const offset=d.periods.find(p=>p.period===period)!.startMs!;
    ctx.request={...AYEW_SEQUENCE,period,fromMs:offset+AYEW_SEQUENCE.fromMs,toMs:offset+AYEW_SEQUENCE.toMs};ctx.sourceKey=JSON.stringify([d.identity,ctx.motionRevision,ctx.rawDigest,ctx.request]);
    ctx.participants[0].period=period;d.metadata={...d.metadata,performanceContext:ctx};
    expect((await normalizePerformanceEvidence([e],d)).snapshots[0].rows[0].point).toEqual({x:expect.closeTo(expected.x,10),y:expect.closeTo(expected.y,10)});
  }
});
it('retains a contradictory same-time event and snapshot without choosing precedence',async()=>{
  const duel={...action('duel',1693655,'Duel',3957),source_index:1693656,canonical_location:{x:8.4875,y:31.535}};
  const e=await normalizePerformanceEvidence([shot(),duel],descriptor());
  const row=e.snapshots[0].rows.find(r=>r.playerKey==='historical:statsbomb:3957')!;
  expect(row.status).toBe('conflict');expect(row.reason).toBe('simultaneous_event_position_conflict');
  expect(row.eventPoint).toEqual(duel.canonical_location);expect(row.discrepancyM).toBeGreaterThan(0);
  expect(row.refs).toContain('duel');expect(row.point).not.toEqual(row.eventPoint);
});
it.each(['foreign','duplicate','inactive','team','coordinate','missing_participation'] as const)('keeps %s snapshot rows unresolved instead of guessing identities or positions',async reason=>{
  const e=shot(),d=descriptor(),rows=shotDetails(e).freeze_frame;
  if(reason==='foreign')rows[0].player.id=999;
  if(reason==='duplicate')rows.push(copy(rows[0]));
  if(reason==='inactive')(d.metadata!.performanceContext as any).participants[0].playerKeys=[];
  if(reason==='team')rows[0].teammate=true;
  if(reason==='coordinate')rows[0].location=[121,40];
  if(reason==='missing_participation')(d.metadata!.performanceContext as any).participants=[];
  const result=await normalizePerformanceEvidence([e],d);
  expect(result.snapshots[0].rows[0].status).toBe('unresolved');expect(result.snapshots[0].rows[0].reason).toBeTruthy();
  expect(result.issues.length).toBeGreaterThan(0);
});
it.each(['source','revision','digest','period','canonical','invalid_location','invalid_canonical','duplicates'] as const)('rejects stale or invalid %s context',async kind=>{
  const e=shot(),d=descriptor(),ctx=d.metadata!.performanceContext as any;
  if(kind==='source')ctx.sourceKey=ctx.sourceKey.replace('3754078','999');
  if(kind==='revision')d.identity={...d.identity,revision:'foreign'};
  if(kind==='digest')ctx.rawDigest='not-a-digest';
  if(kind==='period')e.period=2;
  if(kind==='canonical')e.canonical_location={x:50,y:50};
  if(kind==='invalid_location')e.location={x:-1,y:34};
  if(kind==='invalid_canonical')e.canonical_location={x:Infinity,y:34};
  const raw=kind==='duplicates'?[e,e]:[e];
  await expect(normalizePerformanceEvidence(raw,d)).rejects.toThrow();
});
it('keeps absent and malformed metadata explicit, retains raw height without claiming an unverified unit',async()=>{
  const e=shot(),d=descriptor();delete shotDetails(e).end_location;
  const missing=await normalizePerformanceEvidence([e],d);
  expect(missing.actions[0].shot).toMatchObject({rawEndHeight:null,endHeightMetres:null,endHeightUnit:'unverified'});
  const rawHeight=await normalizePerformanceEvidence([shot()],d);
  expect(rawHeight.actions[0].shot).toMatchObject({rawEndHeight:.9,endHeightMetres:null,endHeightUnit:'unverified'});
  e.details={pass:{height:[],cross:'yes'},goalkeeper:{body_part:42,technique:null},shot:{end_location:[10,20,-1],freeze_frame:'bad'}};
  const bad=await normalizePerformanceEvidence([e],d);
  expect(bad.actions[0].pass).toMatchObject({height:null,cross:null});expect(bad.issues.length).toBeGreaterThan(0);
});
it('hashes supplementary content independently and deterministically',async()=>{
  const d=descriptor(),raw=[shot()],a=await normalizePerformanceEvidence(raw,d),b=await normalizePerformanceEvidence(copy(raw),copy(d));
  expect(a).toEqual(b);shotDetails(raw[0]).end_location![2]=1.3;
  const changed=await normalizePerformanceEvidence(raw,d);expect(changed.sourceKey).toBe(a.sourceKey);expect(changed.evidenceDigest).not.toBe(a.evidenceDigest);
});
it('retains a malformed raw row for diagnosis while refusing to place it',async()=>{
  const e=shot();shotDetails(e).freeze_frame=[42];
  const result=await normalizePerformanceEvidence([e],descriptor());
  expect(result.snapshots[0].rows[0]).toMatchObject({status:'unresolved',playerKey:null,point:null,raw:42});
});
it('rejects an unresolved event actor rather than attributing supplementary facts by name',async()=>{
  const e={...shot(),player_key:'statsbomb:foreign'};
  await expect(normalizePerformanceEvidence([e],descriptor())).rejects.toThrow(/actor/i);
});
it('keeps an ambiguous lineup identity and duplicate participation frame unresolved',async()=>{
  for(const kind of ['identity','participation']){
    const d=descriptor(),meta=d.metadata as any;
    if(kind==='identity')meta.playerIdentities.push({...meta.playerIdentities[0],key:'statsbomb:other'});
    else meta.performanceContext.participants.push(copy(meta.performanceContext.participants[0]));
    const e=await normalizePerformanceEvidence([shot()],d);
    expect(e.snapshots[0].rows[0].status).toBe('unresolved');
  }
});
it('enforces event and snapshot row caps without doing unbounded normalisation',async()=>{
  await expect(normalizePerformanceEvidence(Array(101).fill(shot()),descriptor())).rejects.toThrow(/limit/i);
  const e=shot();shotDetails(e).freeze_frame=Array(23).fill(shotDetails(e).freeze_frame[0]);
  const result=await normalizePerformanceEvidence([e],descriptor());
  expect(result.snapshots).toHaveLength(0);expect(result.issues).toContainEqual(expect.objectContaining({code:'invalid_snapshot'}));
});
it('adapter changes the extra digest for a cross-only change while retaining the exact legacy V2 digest',async()=>{
  const b=await sourceBundle(),items=copy(b.page.items);
  (items.find(e=>e.id==='d1d446ec-f47c-4809-9f73-f2c5b2b4d881')!.details!.pass as {cross:boolean}).cross=false;
  const create=(events:HistoricalEvent[])=>createHistoricalSession(3754078,PILOT_REVISION,{readers:{capabilities:async()=>b.caps,
    match:async()=>b.match,manifest:async()=>b.manifest,events:async()=>events,segment:async()=>b.segment}});
  const a=create(b.page.items),c=create(items);
  try{
    const first=await a.loadSequence!(AYEW_SEQUENCE,signal()),second=await c.loadSequence!(AYEW_SEQUENCE,signal());
    expect(first.rawDigest).toBe(second.rawDigest);expect(first.key).toBe(second.key);
    expect(first.performanceEvidence!.evidenceDigest).not.toBe(second.performanceEvidence!.evidenceDigest);
    expect(first.events).toEqual(second.events);expect(first.frames).toEqual(second.frames);expect(first.cuts).toEqual(second.cuts);
  }finally{a.dispose();c.dispose();}
});
it('normalizes the real high cross, right-hand save and three snapshots without changing V2 identity, facts or input',async()=>{
  const b=await sourceBundle(),original=JSON.stringify(b);freeze(b);
  const a=createHistoricalSession(3754078,PILOT_REVISION,{readers:{capabilities:async()=>b.caps,match:async()=>b.match,
    manifest:async()=>b.manifest,events:async()=>b.page.items,segment:async()=>b.segment}});
  try{
    const before=a.snapshot(),s=await a.loadSequence!(AYEW_SEQUENCE,signal()),e=s.performanceEvidence!;
    expect(e).toBeDefined();expect(e.sourceKey).toBe(s.key);expect(e.snapshots).toHaveLength(3);
    expect(e.snapshots.flatMap(s=>s.rows)).toHaveLength(27);
    expect(new Set(e.snapshots.flatMap(s=>s.rows.map(r=>r.playerKey)))).toHaveProperty('size',10);
    expect(e.snapshots.flatMap(s=>s.rows).filter(r=>r.status==='conflict')).toHaveLength(1);
    expect(e.snapshots.flatMap(s=>s.rows).filter(r=>r.status==='usable')).toHaveLength(26);
    expect(e.snapshots.flatMap(s=>s.rows).filter(r=>r.status==='unresolved')).toHaveLength(0);
    expect(e.snapshots[0].rows.find(r=>r.playerKey==='historical:statsbomb:3957')!.discrepancyM).toBeCloseTo(1.036931,6);
    expect(e.actions.find(a=>a.eventId==='historical:d1d446ec-f47c-4809-9f73-f2c5b2b4d881')!.pass).toMatchObject({height:'high',cross:true,bodyPart:'left_foot'});
    expect(e.actions.find(a=>a.eventId==='historical:bc3318af-2ebc-4581-8e19-310fd137407e')!.keeper).toMatchObject({bodyPart:'right_hand',technique:'Diving'});
    const bytes=new TextEncoder().encode(JSON.stringify({events:s.events,frames:s.frames,cuts:s.cuts}));
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    expect(s.rawDigest).toBe(digest);expect(JSON.parse(s.key)[2]).toBe(digest);
    expect(a.snapshot().facts).toEqual(before.facts);expect(a.snapshot().presentedCursor).toEqual(before.presentedCursor);
    expect(Object.isFrozen(e.snapshots[0].rows[0].raw)).toBe(true);expect(await a.loadSequence!(AYEW_SEQUENCE,signal())).toBe(s);
    expect(JSON.stringify(b)).toBe(original);
    const receipt=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env.TIMEPITCH_PERFORMANCE_EVIDENCE_RECEIPT;
    if(receipt){
      const fsName='node:fs';const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(p:string,t:string)=>void};
      fs.writeFileSync(receipt,JSON.stringify({sourceKey:s.key,rawDigest:s.rawDigest,evidenceDigest:e.evidenceDigest,
        snapshots:e.snapshots.length,rows:27,usable:26,conflicts:1,unresolved:0,issues:e.issues,
        endHeights:e.actions.filter(a=>a.shot).map(a=>({eventId:a.eventId,...a.shot})),
        factsUnchanged:true,sourceInputUnchanged:true},null,2)+'\n');
    }
  }finally{a.dispose();}
});
