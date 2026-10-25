import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPrivateFile } from '../../test-private-data';
import { classifyContacts } from './contact-semantics';
import { privateSequence } from './private-fixture';
import type { SequenceSource } from './types';

afterEach(()=>vi.unstubAllGlobals());
let source: SequenceSource;
beforeEach(async()=>{source=(await privateSequence()).source;});
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const eventId=(id:string)=>`historical:${id}`;
const ids={save:'bc3318af-2ebc-4581-8e19-310fd137407e',context:'0d104861-7e71-4301-8807-491b8727758a',
  noTouch:'48bf043f-5661-42f5-8cd5-43f5477d23f7',header:'9a0921e9-2ef6-42fd-9eed-52bc7ac69a4d',
  receipt:'ca6118f6-10dd-4997-a6a1-86a5fa71c707',block:'36556d53-6eaa-49da-95fb-78015de01fa2'};
function observation(s:SequenceSource,id:string) {
  return classifyContacts(s).observations.find(o=>o.eventId===eventId(id))!;
}
function patchKeeper(id:string,patch:Record<string,unknown>):SequenceSource {
  return {...source,performanceEvidence:{...source.performanceEvidence!,actions:source.performanceEvidence!.actions.map(a=>
    a.eventId===eventId(id)?{...a,keeper:{...a.keeper!,...patch}}:a)}};
}

it('saved_17_observations_keep_six_named_effectors',async()=>{
  const before=JSON.stringify(source),result=classifyContacts(source);
  expect(result.observations).toHaveLength(17);
  expect(result.issues).toEqual([]);
  expect(result.observations.map(o=>o.role)).toEqual(['strike','arrival_observation','control_interval','strike',
    'arrival_observation','contest','strike','save','recovery_observation','control_interval','strike',
    'block','shot_context','recovery_observation','control_interval','strike','no_touch']);
  expect(result.observations.filter(o=>o.effector!==null&&o.effector!=='unknownSurface')).toHaveLength(6);
  expect(result.observations.filter(o=>o.physicalContactRequired)).toHaveLength(7);
  expect(observation(source,ids.save)).toMatchObject({effector:'rightHand',role:'save'});
  expect(observation(source,ids.header)).toMatchObject({effector:'head',role:'strike'});
  expect(result.observations.filter(o=>o.actorId==='historical:statsbomb:3347'&&o.kind==='Shot')
    .map(o=>o.effector)).toEqual(['leftFoot','leftFoot']);
  expect(result.sourceDigest).toBe('2448bed73cb06c3fbaf2df69b31e6af208afc38a909128b887740428f3b04944');
  expect(result.evidenceDigest).toBe('fd34efda0b62f58619e10a24439ae3b49eaa4dec4a5fe0d1e0bd6c2a0c9d0d07');
  expect(result.observations.map(o=>o.metadata.event)).toEqual(source.events);
  expect(result.observations.map(o=>[o.eventId,o.sourceAtMs,o.sourcePoint,o.refs]))
    .toEqual(source.events.map(e=>[e.id,e.elapsedMs,e.start,e.refs]));
  const fsName='node:fs';const fs=await import(/* @vite-ignore */ fsName) as {readFileSync:(p:string,e:'utf8')=>string;writeFileSync:(p:string,t:string)=>void;existsSync:(p:string)=>boolean};
  const audit=JSON.parse(readPrivateFile(fs,'../research/design-evaluation/2026-10-21-sequence-performance/body-contact-review.json'));
  expect(result.observations.map(o=>o.eventId)).toEqual(audit.classifiedEvents.map((e:{eventId:string})=>eventId(e.eventId)));
  expect(JSON.stringify(source)).toBe(before);
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_CONTACT_SEMANTICS_RECEIPT)fs.writeFileSync(env.TIMEPITCH_CONTACT_SEMANTICS_RECEIPT,
    JSON.stringify({case:'TP160',phase:1,scope:'classification_only',...result,
      sourceUnchanged:true,nativeMatches:0,modelCalls:0,published:false},null,2)+'\n');
});

it('no_touch_overrides_limb_metadata',()=>{
  const o=observation(patchKeeper(ids.noTouch,{bodyPart:'right_hand'}),ids.noTouch);
  expect(o).toMatchObject({role:'no_touch',effector:null,physicalContactRequired:false});
  expect(o.metadata.action!.keeper!.bodyPart).toBe('right_hand');
});
it('shot_faced_is_context_even_with_a_recorded_limb',()=>{
  expect(observation(patchKeeper(ids.context,{bodyPart:'right_hand'}),ids.context))
    .toMatchObject({role:'shot_context',effector:null,physicalContactRequired:false});
});
it.each(['Unknown Saved Something',null])('unknown_keeper_never_becomes_save: %s',type=>{
  const result=classifyContacts(patchKeeper(ids.save,{type}));
  expect(result.observations.find(o=>o.eventId===eventId(ids.save)))
    .toMatchObject({role:'unsupported',effector:null,physicalContactRequired:false});
  expect(result.issues).toContainEqual(expect.objectContaining({eventId:eventId(ids.save),code:'unsupported_keeper_type'}));
});
it('receipt_then_header_has_no_invented_foot_touch',()=>{
  const a=observation(source,ids.receipt),b=observation(source,ids.header);
  expect(a).toMatchObject({role:'arrival_observation',effector:null,physicalContactRequired:false});
  expect(b).toMatchObject({role:'strike',effector:'head',physicalContactRequired:true});
  expect(b.sourceAtMs-a.sourceAtMs).toBe(161);
});
it('losing_duel_not_ball_touch',()=>{
  expect(classifyContacts(source).observations.find(o=>o.kind==='Duel'))
    .toMatchObject({role:'contest',effector:null,physicalContactRequired:false});
});
it('recoveries_and_carries_do_not_create_impact_events',()=>{
  const observations=classifyContacts(source).observations;
  expect(observations.filter(o=>o.role==='control_interval')).toHaveLength(3);
  expect(observations.filter(o=>o.role==='recovery_observation')).toHaveLength(2);
  expect(observations.filter(o=>o.kind==='Carry'||o.kind==='Ball Recovery')
    .every(o=>o.effector===null&&!o.physicalContactRequired)).toBe(true);
});
it('ambiguous_block_not_nearest_player',()=>{
  const block=source.events.find(e=>e.id===eventId(ids.block))!;
  const changed={...source,events:source.events.map(e=>e===block?{...e,relatedIds:[...e.relatedIds,eventId(ids.header)]}:e)};
  const r=classifyContacts(changed),o=r.observations.find(o=>o.eventId===block.id)!;
  expect(o.actorId).toBe(block.actorId);
  expect(o.relatedIds).toEqual([eventId('43aa4774-0851-4e64-a1b8-2ed198f8d75f'),eventId(ids.header)]);
  expect(o.physicalContactRequired).toBe(false);
  expect(r.issues).toContainEqual(expect.objectContaining({code:'ambiguous_contact_link',eventId:block.id}));
});
it('missing_body_part_stays_unknown',()=>{
  const changed={...source,events:source.events.map(e=>e.id===eventId(ids.header)?{...e,bodyPart:null}:e),
    performanceEvidence:{...source.performanceEvidence!,actions:source.performanceEvidence!.actions.map(a=>
      a.eventId===eventId(ids.header)?{...a,shot:{...a.shot!,bodyPart:null}}:a)}};
  expect(observation(changed,ids.header)).toMatchObject({role:'strike',effector:'unknownSurface',physicalContactRequired:true});
  expect(observation(source,ids.block)).toMatchObject({role:'block',effector:'unknownSurface',physicalContactRequired:true});
});
it.each(['source','evidence_source','missing_evidence','duplicate_action','period','period_time','actor','missing_actor','side','action_actor','action_time','point','limb_conflict','dangling_link'] as const)
('invalid_%s_is_diagnostic_without_confirmed_contact',kind=>{
  const s=copy(source) as any,header=s.events.find((e:any)=>e.id===eventId(ids.header));
  const a=s.performanceEvidence.actions.find((e:any)=>e.eventId===header.id);
  if(kind==='source')s.identity.id='foreign';
  if(kind==='evidence_source')s.performanceEvidence.sourceKey='foreign';
  if(kind==='missing_evidence')delete s.performanceEvidence;
  if(kind==='duplicate_action')s.performanceEvidence.actions.push(copy(a));
  if(kind==='period')header.period=2;
  if(kind==='period_time')header.periodMs++;
  if(kind==='actor')header.actorId='historical:statsbomb:foreign';
  if(kind==='missing_actor')header.actorId=null;
  if(kind==='side')header.side='home';
  if(kind==='action_actor')a.actorId='historical:statsbomb:foreign';
  if(kind==='action_time')a.elapsedMs++;
  if(kind==='point')header.start.x=Infinity;
  if(kind==='limb_conflict')a.shot.bodyPart='right_foot';
  if(kind==='dangling_link')header.relatedIds=['historical:missing'];
  const r=classifyContacts(s);
  expect(r.observations).toHaveLength(17);
  expect(r.issues.length).toBeGreaterThan(0);
  expect(r.observations.find(o=>o.eventId===header.id)!.physicalContactRequired).toBe(false);
});
it('over_limit_input_stops_before_classifying_or_copying_observations',()=>{
  const r=classifyContacts({...source,events:Array(101).fill(source.events[0])});
  expect(r.observations).toEqual([]);
  expect(r.issues).toContainEqual(expect.objectContaining({code:'input_limit'}));
});
it('owns_and_seals_metadata_without_freezing_callers_and_keys_actual_policy_inputs',()=>{
  const s=copy(source),before=JSON.stringify(s),r=classifyContacts(s);
  expect(JSON.stringify(s)).toBe(before);
  expect(Object.isFrozen(s.events[0])).toBe(false);
  expect(Object.isFrozen(r.observations[0].metadata.event.start)).toBe(true);
  expect(r.observations[0].metadata.event).not.toBe(s.events[0]);
  expect(r).toEqual(classifyContacts(copy(source)));
  expect(classifyContacts(patchKeeper(ids.noTouch,{bodyPart:'right_hand'})).key).not.toBe(r.key);
  const reordered={...s,events:[...s.events].reverse(),performanceEvidence:{...s.performanceEvidence!,actions:[...s.performanceEvidence!.actions].reverse()}};
  expect(classifyContacts(reordered)).toEqual(r);
});
