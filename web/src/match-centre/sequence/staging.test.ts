import { expect, it } from 'vitest';
import { syntheticFrame } from '../unified-fixtures';
import { AYEW_SEQUENCE, PILOT_REVISION } from './pilot';
import { compileDepiction, type SequenceDepiction } from './depiction';
import { compileStaging, inspectStaging } from './staging';
import type { SequenceEvent, SequenceSource } from './types';
import type { StagedSequence } from './performance-types';

const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const from=AYEW_SEQUENCE.fromMs,to=AYEW_SEQUENCE.toMs;
function fixture():SequenceSource {
  const identity={source:'historical' as const,id:'3754078',revision:PILOT_REVISION},rawDigest='a'.repeat(64),motionRevision='test';
  const players=Array.from({length:22},(_,i)=>({key:`p${i}`,name:`Player ${i}`,side:i<11?'home' as const:'away' as const,role:'MID' as const,x:10+(i%11)*7,y:i<11?20:48}));
  const frames=[from,to].map(clock_ms=>syntheticFrame({clock_ms,period:1,players}));
  const key=JSON.stringify([identity,motionRevision,rawDigest,AYEW_SEQUENCE]);
  return {identity,key,rawDigest,motionRevision,request:AYEW_SEQUENCE,frames,events:[],cuts:[],performanceEvidence:{
    version:'sequence-performance-evidence-1',sourceKey:key,evidenceDigest:'b'.repeat(64),actions:[],snapshots:[],issues:[]}};
}
function event(id:string,actorId:string,at=from+3000,kind='Ball Recovery'):SequenceEvent {
  return {id,actorId,kind,elapsedMs:at,periodMs:at,period:1,refs:[id],sourceIndex:at,side:'home',recipientId:null,
    relatedIds:[],assistedShotId:null,possessionId:1,durationMs:null,start:{x:10,y:20},end:null,outcome:null,bodyPart:null,xg:null};
}
const compile=(s:SequenceSource)=>compileStaging(s,compileDepiction(s,'historical-action-preview-2'));
it('covers every identity over the whole clip, preserves inputs and is independent of seek history',()=>{
  const s=fixture(),before=JSON.stringify(s),staged=compile(s),report=inspectStaging(staged);
  expect(report.accepted).toBe(true);expect(staged.tracks).toHaveLength(22);
  for(const t of [from,to,from+7000,from,from+123.4,to])expect(staged.sampleRoot('p0',t)).toEqual({x:10,y:20});
  expect(staged.sampleRoot('missing',from)).toBeNull();expect(staged.sampleRoot('p0',from-1)).toBeNull();
  expect(staged.sampleRoot('p0',NaN)).toBeNull();expect(report.maxSpeed).toBe(0);expect(report.maxAcceleration).toBe(0);
  expect(JSON.stringify(s)).toBe(before);expect(compile(s).key).toBe(staged.key);
  expect(Object.isFrozen(staged.tracks[0].spans[0].x)).toBe(true);
});
it('keeps recorded action points separate from visual roots within the contact envelope',()=>{
  const s=fixture(),e={...event('contact','p0',from+3000,'Shot'),durationMs:1000,end:{x:10,y:20}},at=e.elapsedMs;
  const changed={...s,events:[e],performanceEvidence:{...s.performanceEvidence!,snapshots:[{eventId:e.id,period:1,periodMs:at,elapsedMs:at,rows:[
    {sourceId:1,playerKey:'p0',point:{x:10.6,y:20},status:'usable' as const,reason:null,eventPoint:null,discrepancyM:null,refs:[e.id],raw:{}}]}]}};
  const staged=compile(changed);expect(inspectStaging(staged).accepted).toBe(true);
  expect(staged.contacts[0]).toMatchObject({eventId:'contact',point:{x:10,y:20},actorId:'p0'});
  expect(staged.offsets[0]).toMatchObject({actorId:'p0',offsetM:expect.closeTo(.6),provenance:'illustrative_contact_root'});
  expect(staged.sampleRoot('p0',at)!.x).toBeCloseTo(10.6);expect(e.start).toEqual({x:10,y:20});
});
it('retains conflicting snapshots as diagnostics and never silently makes them hard constraints',()=>{
  const s=fixture(),at=from+3000;
  const changed={...s,performanceEvidence:{...s.performanceEvidence!,snapshots:[{eventId:'snapshot',period:1,periodMs:at,elapsedMs:at,rows:[
    {sourceId:1,playerKey:'p0',point:{x:100,y:60},status:'conflict' as const,reason:'simultaneous_event_position_conflict',eventPoint:{x:10,y:20},discrepancyM:90,refs:['duel','snapshot'],raw:{}}]}]}};
  const staged=compile(changed);expect(inspectStaging(staged).accepted).toBe(true);
  expect(staged.constraints.some(c=>c.provenance==='recorded_snapshot')).toBe(false);
  expect(staged.issues).toContainEqual(expect.objectContaining({code:'snapshot_conflict_excluded',blocking:false}));
});
it('rejects unreachable exact snapshots without exposing a subset of good tracks',()=>{
  const s=fixture(),snapshots=[{at:from+100,point:{x:10,y:20}},{at:from+200,point:{x:20,y:20}}].map(({at,point},i)=>({eventId:`shot${i}`,period:1,periodMs:at,elapsedMs:at,rows:[
    {sourceId:1,playerKey:'p0',point,status:'usable' as const,reason:null,eventPoint:null,discrepancyM:null,refs:[`shot${i}`],raw:{}}]}));
  const staged=compile({...s,performanceEvidence:{...s.performanceEvidence!,snapshots}});
  expect(staged.tracks).toEqual([]);expect(staged.sampleRoot('p1',from)).toBeNull();expect(inspectStaging(staged).accepted).toBe(false);
  expect(staged.issues).toContainEqual(expect.objectContaining({code:'actor_constraint_conflict',actorIds:['p0'],blocking:true}));
});
it('uses the permitted contact envelope when exact action centres cannot be reached',()=>{
  const s=fixture(),e={...event('near','p0',from+10,'Shot'),durationMs:1000,end:{x:10.6,y:20}};
  const staged=compile({...s,events:[{...e,start:{x:10.6,y:20}}]});
  expect(inspectStaging(staged).accepted).toBe(true);
  expect(staged.offsets[0].offsetM).toBeGreaterThan(.5);expect(staged.offsets[0].offsetM).toBeLessThanOrEqual(.65+1e-6);
  expect(staged.sampleRoot('p0',from)).toEqual({x:10,y:20});
});
it('does not extend the approved action-root envelope to recovery event roots',()=>{
  const s=fixture(),e=event('recovery','p0',from+10);
  const staged=compile({...s,events:[{...e,start:{x:10.6,y:20}}]});
  expect(inspectStaging(staged).accepted).toBe(false);expect(staged.tracks).toEqual([]);
  expect(staged.constraints.find(c=>c.refs.includes('recovery'))!.radiusM).toBe(0);
});
it.each(['duplicate','invalid','receiver','block','save','stale','period','limit'] as const)('rejects %s input with explicit diagnostics',kind=>{
  const s=copy(fixture()) as any;
  if(kind==='duplicate')s.frames[0].players[1].key='p0';
  if(kind==='invalid')s.frames[0].players[0].x=NaN;
  if(kind==='receiver')s.events=[{...event('pass','p0',from+3000,'Pass'),durationMs:1000,end:{x:17,y:20},recipientId:'absent'}];
  if(kind==='block')s.events=[event('block','p0',from+3000,'Block')];
  if(kind==='save')s.events=[event('save','p0',from+3000,'Goal Keeper')];
  if(kind==='stale')s.performanceEvidence.sourceKey='foreign';
  if(kind==='period')s.performanceEvidence.snapshots=[{eventId:'bad',period:2,periodMs:from,elapsedMs:from,rows:[]}];
  if(kind==='limit')s.events=Array.from({length:101},(_,i)=>event(`e${i}`,'p0',from+i));
  let base:SequenceDepiction;try{base=compileDepiction(s,'historical-action-preview-2');}catch{base={key:'invalid',version:'historical-action-preview-2',issues:[],sample:()=>({availability:'unavailable',frame:null,previous:null,refs:[]})};}
  const staged=compileStaging(s,base);expect(inspectStaging(staged).accepted).toBe(false);expect(staged.tracks).toEqual([]);
});
it('finds an interior collision between polynomial curves even when their endpoints are separated',()=>{
  const ok=compile(fixture()),span={fromMs:from,toMs:to,x:[20],y:[30],refs:[]};
  const tracks=ok.tracks.map((t,i)=>i===0?{...t,spans:[span]}:i===1?{...t,spans:[{...span,x:[21,-4,4]}]}:t);
  const report=inspectStaging({...ok,tracks} as StagedSequence);
  expect(report.accepted).toBe(false);expect(report.issues).toContainEqual(expect.objectContaining({code:'clearance',actorIds:['p0','p1']}));
  const witness=report.issues.find(i=>i.code==='clearance')!;
  expect(witness.atMs).toBeCloseTo((from+to)/2);expect(report.minClearanceM).toBeCloseTo(0);
});
it('independently rejects an incomplete, discontinuous or non-finite candidate rather than trusting its status',()=>{
  const ok=compile(fixture());
  for(const spans of [[],[{fromMs:from,toMs:to,x:[Infinity],y:[20],refs:[]}],
    [{fromMs:from,toMs:from+6000,x:[10],y:[20],refs:[]},{fromMs:from+6000,toMs:to,x:[11],y:[20],refs:[]}]]){
    const report=inspectStaging({...ok,tracks:ok.tracks.map((t,i)=>i? t:{...t,spans})} as StagedSequence);
    expect(report.accepted).toBe(false);
  }
});
it('does not permit an unlinked duel exception to conceal a collision',()=>{
  const ok=compile(fixture()),mid=(from+to)/2;
  const tracks=ok.tracks.map(t=>t.actorId==='p1'?{...t,spans:[{fromMs:from,toMs:to,x:[10,0,0,0],y:[20.1,0,0,0],refs:[]}]}:t);
  const report=inspectStaging({...ok,tracks,duelExceptions:[{actorIds:['p0','p1'],fromMs:mid-250,toMs:mid+250,minM:.08,refs:['made-up']}]} as StagedSequence);
  expect(report.accepted).toBe(false);expect(report.issues).toContainEqual(expect.objectContaining({code:'invalid_duel_exception'}));
});
it('rejects acceleration and field violations at interior critical points',()=>{
  const ok=compile(fixture());
  const span={fromMs:from,toMs:to,x:[10,500,-500,0],y:[20,0,0,0],refs:[]};
  const report=inspectStaging({...ok,tracks:ok.tracks.map(t=>t.actorId==='p0'?{...t,spans:[span]}:t)});
  expect(report.accepted).toBe(false);
  expect(report.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['speed_limit','acceleration_limit','field_bounds']));
});
it('does not let a claimed exact snapshot acquire a presentation radius in the independent verifier',()=>{
  const ok=compile(fixture());
  const report=inspectStaging({...ok,constraints:[...ok.constraints,{actorId:'p0',atMs:from,point:{x:10.4,y:20},radiusM:.65,provenance:'recorded_snapshot',refs:['snapshot']} ]});
  expect(report.accepted).toBe(false);
});
