import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { classifyContacts } from './contact-semantics';
import { classifyRootBindings } from './root-observation-bindings';
import type { SequenceSource } from './types';
let source:SequenceSource;
beforeEach(async()=>{source=(await privateSequence()).source;});afterEach(()=>vi.unstubAllGlobals());
it('all_events_snapshots_and_known_conflict_are_retained',async()=>{
  const semantics=classifyContacts(source),plan=classifyRootBindings(source,semantics);
  expect(plan.status).toBe('ready');expect(plan.observations).toHaveLength(17);
  expect(plan.observations.map(b=>b.observation)).toEqual(semantics.observations);
  expect(plan.snapshots).toHaveLength(26);expect(plan.excludedSnapshots).toHaveLength(1);
  expect(plan.excludedSnapshots[0].reason).toBe('simultaneous_event_position_conflict');
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_ROOT_BINDING_RECEIPT){
    const fsName='node:fs',fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(p:string,s:string)=>void};
    fs.writeFileSync(env.TIMEPITCH_ROOT_BINDING_RECEIPT,JSON.stringify({case:'TP166',kind:'root_binding_plan_no_solve',status:plan.status,
      observations:plan.observations.map(b=>({eventId:b.observation.eventId,actorId:b.observation.actorId,atMs:b.observation.sourceAtMs,
        sourcePoint:b.observation.sourcePoint,disposition:b.disposition,localisation:b.localisation,requiredContact:b.observation.physicalContactRequired,effector:b.observation.effector})),
      snapshots:plan.snapshots.map(s=>({eventId:s.eventId,atMs:s.atMs,actorId:s.row.playerKey,point:s.row.point,refs:s.row.refs})),
      excludedSnapshots:plan.excludedSnapshots,issues:plan.issues,correctedWholeClipAttempts:0,nativeMatches:0,modelCalls:0,published:false},null,2)+'\n');
  }
});
it('arrival_is_not_anatomical_localisation_and_keeps_original_point_time_actor',()=>{
  const p=classifyRootBindings(source,classifyContacts(source));
  const receipt=p.observations.find(b=>b.observation.kind==='Ball Receipt*'&&b.observation.actorId==='historical:statsbomb:20521')!;
  expect(receipt.disposition).toBe('arrival_context');expect(receipt.localisation).toBe('not_anatomically_localised');
  expect(receipt.observation).toMatchObject({sourceAtMs:1693494,physicalContactRequired:false,effector:null});
  expect(receipt.observation.sourcePoint).toEqual(source.events.find(e=>e.id===receipt.observation.eventId)!.start);
});
it('ball_actions_are_not_extra_trunk_disks_and_keeper_context_stays_distinct',()=>{
  const p=classifyRootBindings(source,classifyContacts(source));
  for(const b of p.observations.filter(b=>['Pass','Shot'].includes(b.observation.kind))){
    expect(b.disposition).toBe('ball_contact');expect(b.localisation).toBe('not_anatomically_localised');
  }
  expect(p.observations.filter(b=>b.disposition==='ball_control')).toHaveLength(3);
  const save=p.observations.find(b=>b.observation.role==='save')!;
  expect(save.localisation).toBe('finite_actor_context');expect(save.disposition).toBe('ball_contact');
  const shot=source.events.find(e=>save.observation.relatedIds.includes(e.id)&&e.kind==='Shot')!;
  expect(save.observation.sourcePoint).not.toEqual(shot.end);
  expect(p.observations.find(b=>b.observation.role==='no_touch')!.observation.physicalContactRequired).toBe(false);
});
it('changed_source_or_semantics_cannot_reuse_stale_keys',()=>{
  const semantics=classifyContacts(source),changed={...semantics,observations:semantics.observations.map(o=>o.role==='save'?{...o,physicalContactRequired:false}:o)};
  expect(classifyRootBindings(source,changed).status).toBe('unavailable');
  const altered={...source,events:source.events.map((e,i)=>i===0?{...e,start:{x:99,y:50}}:e)};
  expect(classifyRootBindings(altered,semantics).status).toBe('unavailable');
});
it('unsupported_events_and_bad_snapshot_bindings_fail_closed',()=>{
  const unsupported={...source,events:source.events.map((e,i)=>i===0?{...e,kind:'Unsupported'}:e)};
  expect(classifyRootBindings(unsupported,classifyContacts(unsupported)).status).toBe('unavailable');
  const changed={...source,performanceEvidence:{...source.performanceEvidence!,snapshots:source.performanceEvidence!.snapshots.map((s,i)=>i===0?{...s,elapsedMs:s.elapsedMs+1}:s)}};
  expect(classifyRootBindings(changed,classifyContacts(changed)).status).toBe('unavailable');
});
it('owned_sealed_plan_does_not_mutate_source_and_keys_include_snapshot_content',()=>{
  const before=JSON.stringify(source),semantics=classifyContacts(source),p=classifyRootBindings(source,semantics);
  expect(JSON.stringify(source)).toBe(before);expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.observations)).toBe(true);
  const changed={...source,performanceEvidence:{...source.performanceEvidence!,snapshots:source.performanceEvidence!.snapshots.map((s,i)=>i===0?{...s,rows:s.rows.map((r,j)=>j===0&&r.point?{...r,point:{x:r.point.x+.01,y:r.point.y}}:r)}:s)}};
  expect(classifyRootBindings(changed,classifyContacts(changed)).key).not.toBe(p.key);
});
