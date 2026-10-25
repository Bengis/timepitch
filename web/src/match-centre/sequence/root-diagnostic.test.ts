import { afterEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { classifyContacts } from './contact-semantics';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { compileRootDiagnostic,compileRefinedRootDiagnostic } from './root-diagnostic';
import * as domains from './root-contact-domains';
import * as projections from './root-projection';
import * as grids from './root-time-grid';
import * as feasibility from './root-feasibility';
import * as kinematics from './body-kinematics';
import { sampleBodyGeometry } from './body-kinematics';
import { describeBodyContactTarget } from './body-constraints';
import type { SequenceSource } from './types';
import type { RootDomainPlan } from './root-contact-domains';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
// Deliberately empty/stationary or straight-line toy, not the saved 17-event solve.
async function toy(moving=false):Promise<SequenceSource>{
  const {source}=await privateSequence();
  const frames=[source.request.fromMs,source.request.toMs].map((clock_ms,i)=>({...source.frames[0],clock_ms,
    players:source.frames[0].players.map(p=>({...p,x:p.x+(moving?i*.1:0)}))}));
  const rawDigest='a'.repeat(64),motionRevision='root-orchestration-toy-1',key=JSON.stringify([source.identity,motionRevision,rawDigest,source.request]);
  return {...source,key,rawDigest,motionRevision,events:[],frames,cuts:[],
    performanceEvidence:{...source.performanceEvidence!,sourceKey:key,actions:[],snapshots:[],issues:[]}};
}
const run=(source:SequenceSource)=>compileRootDiagnostic(source,classifyContacts(source),createDiagnosticBodyGeometry());
it('locked_v2_controlled_outputs_remain_byte_identical',async()=>{
  const cryptoName='node:crypto';
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
  const results=[run(await toy()),run(await toy(true))];
  const hash=crypto.createHash('sha256').update(JSON.stringify(results)).digest('hex');
  expect(hash).toBe('dae7159de288fccbdec3b63b527b31402906c2c25b71e58ed0aaec10854b239d');
  expect(results.every(r=>r.profile==='historical-root-diagnostic-2'&&r.policy==='physical-1'&&r.status==='roots_proposed')).toBe(true);
});
it('single_shared_ledger_across_all_stages',async()=>{
  const source=await toy(),build=vi.spyOn(domains,'buildRootContactDomains'),project=vi.spyOn(projections,'projectRootActor'),witness=vi.spyOn(domains,'inspectRootNodeWitnesses');
  const result=run(source);expect(result.status,JSON.stringify({reason:result.reason,issues:result.issues,
    actors:result.actors.map(a=>({actorId:a.actorId,preflight:a.preflight?.status,projection:a.projection?.status}))})).toBe('roots_proposed');expect(project).toHaveBeenCalledTimes(22);
  const ledgers=build.mock.calls[0][4];expect(witness.mock.calls[0][2]).toBe(ledgers);
  for(const [input,ledger] of project.mock.calls){expect(ledger).toBe(ledgers.get(input.actorId));
    const report=result.actors.find(a=>a.actorId===input.actorId)!;expect(report.work.consumed).toBe(ledger.consumed);
    expect(report.work.consumed).toBe(Object.values(report.work.byStage).reduce((s:number,n)=>s+(n as number),0));
    expect(report.work.byStage.preparation).toBeGreaterThan(0);expect(report.work.byStage.solver).toBeGreaterThan(0);expect(report.work.byStage.verification).toBeGreaterThan(0);}
});
it('any_actor_or_contact_failure_withholds_all_tracks',async()=>{
  const source=await toy(),real=projections.projectRootActor,spy=vi.spyOn(projections,'projectRootActor');
  spy.mockImplementation((input,work,policy)=>{const r=real(input,work,policy);if(input.actorId!==source.frames[0].players[0].key)return r;
    const {track:_ignored,...failed}=r;return {...failed,status:'not_converged',reason:'controlled_actor_failure'};});
  const failed=run(source);expect(failed.status).toBe('unavailable');expect(failed).not.toHaveProperty('roots');expect(failed.nodeWitnesses.status).toBe('not_run');
  spy.mockRestore();vi.spyOn(domains,'inspectRootNodeWitnesses').mockImplementation(plan=>({status:'unresolved',planKey:plan.key,witnesses:[],bodyAccepted:false,
    issues:[{code:'controlled_contact_failure',actorId:null,atMs:null,eventId:null,refs:[]}]}));
  const contact=run(source);expect(contact.status).toBe('unavailable');expect(contact).not.toHaveProperty('roots');expect(contact.nodeWitnesses.status).toBe('unresolved');
});
it('old_failed_receipt_cannot_be_promoted',()=>{
  const result=compileRootDiagnostic({status:'failed',reports:[],tracks:[]} as unknown as SequenceSource,{} as never,createDiagnosticBodyGeometry());
  expect(result.status).toBe('unavailable');expect(result).not.toHaveProperty('roots');expect(result.reason).toBe('invalid_source_input');
});
it('roots_never_implement_product_sampler',async()=>{
  const result=run(await toy());expect(result.status).toBe('roots_proposed');expect(result.roots).toHaveLength(22);
  expect(result).not.toHaveProperty('sample');expect(result).not.toHaveProperty('accepted');expect(result.bodyAcceptance).toBe('blocked');
});
it('neutral_same_foot_drift_blocks_body_even_when_roots_pass',async()=>{
  const result=run(await toy(true));expect(result.status).toBe('roots_proposed');expect(result.bodyAcceptance).toBe('blocked');
  expect(result.downstreamBlockers).toContain('neutral_pose_is_not_locomotion');
  expect(result.downstreamBlockers).toContain('independent_continuous_body_verifier_not_run');
  expect(result.supportDiagnostics.some((s:any)=>s.sameLocalFootTranslationM>.03)).toBe(true);
});
it('same_source_same_key',async()=>{
  const source=await toy(),before=JSON.stringify(source),a=run(source),b=run(source);
  expect(a.key).toBe(b.key);expect(a.actors).toEqual(b.actors);expect(JSON.stringify(source)).toBe(before);
});
async function contactToy():Promise<SequenceSource>{
  const {source}=await privateSequence(),first=source.events.find(e=>e.kind==='Pass')!,g=createDiagnosticBodyGeometry();
  const fk=sampleBodyGeometry(g,{root:{x:0,y:0},heading:0,...g.actionTemplates.rightFoot});
  if(fk.status!=='available')throw new Error('Toy FK unavailable');
  const target=describeBodyContactTarget(g,fk,'rightFoot',first.start!);
  const event={...first,bodyPart:'right_foot' as const,relatedIds:[],recipientId:null,assistedShotId:null,
    durationMs:source.request.toMs-source.request.fromMs,end:{...first.start!}};
  const frames=[source.request.fromMs,source.request.toMs].map(clock_ms=>({...source.frames[0],clock_ms,
    players:source.frames[0].players.map(p=>p.key===first.actorId?{...p,...target.root}:{...p})}));
  const rawDigest='b'.repeat(64),motionRevision='single-stationary-contact-toy',key=JSON.stringify([source.identity,motionRevision,rawDigest,source.request]);
  const action={...source.performanceEvidence!.actions.find(a=>a.eventId===first.id)!};
  if(action.pass)action.pass={...action.pass,bodyPart:'right_foot'};
  const toySource={...source,key,rawDigest,motionRevision,events:[event],frames,cuts:[],
    performanceEvidence:{...source.performanceEvidence!,sourceKey:key,actions:[action],snapshots:[],issues:[]}};
  return toySource;
}
it('real_contact_witness_and_FK_share_preparation_ledger',async()=>{
  const source=await contactToy(),event=source.events[0],result=run(source);
  expect(result.status,result.reason).toBe('roots_proposed');expect(result.nodeWitnesses.status).toBe('witnessed');
  if(result.nodeWitnesses.status!=='not_run')expect(result.nodeWitnesses.witnesses.flatMap(w=>w.contactEventIds)).toContain(event.id);
  expect(result.actors.find(a=>a.actorId===event.actorId)!.work.byStage.fk).toBeGreaterThan(8);
});
const refined=(source:SequenceSource)=>compileRefinedRootDiagnostic(source,classifyContacts(source),createDiagnosticBodyGeometry());
it('refined_profile_and_actual_grid_key_are_distinct_without_mutating_source',async()=>{
  const source=await toy(true),before=JSON.stringify(source),v2=run(source),v3=refined(source);
  expect(v3.status,v3.reason).toBe('roots_proposed');expect(v3.profile).toBe('historical-root-diagnostic-3');expect(v3.policy).toBe('physical-refined-1');
  expect(v2.profile).toBe('historical-root-diagnostic-2');expect(v2).not.toHaveProperty('grid');expect(v2.key).not.toBe(v3.key);
  expect(v3.grid!.status).toBe('ready');expect(v3.grid!.actors).toHaveLength(22);expect(v3.inventory.maxNodes).toBe(29);
  expect(JSON.parse(v3.key)).toContain(v3.grid!.key);expect(v3.grid!.baseDomainKey).toBe(v3.domainKey);
  expect(JSON.stringify(source)).toBe(before);expect(v3.bodyAcceptance).toBe('blocked');expect(v3).not.toHaveProperty('sample');expect(v3).not.toHaveProperty('accepted');
  const root=v3.grid!.actors[0].nodes[1].pose.root;expect(Object.isFrozen(root)).toBe(true);
  expect(()=>{(root as {x:number}).x+=1;}).toThrow();
  const changed={...source,frames:source.frames.map((f,i)=>i?{...f,players:f.players.map(p=>({...p,x:p.x+.01}))}:f)};
  const other=refined(changed);expect(other.key).not.toBe(v3.key);expect(other.grid!.key).not.toBe(v3.grid!.key);
});
it('refined_reuses_original_ledgers_regions_reserves_and_node_FK_without_synthetic_witnesses',async()=>{
  const source=await contactToy(),build=vi.spyOn(domains,'buildRootContactDomains'),grid=vi.spyOn(grids,'buildRefinedRootGrid'),
    preflight=vi.spyOn(feasibility,'inspectRootFeasibility'),project=vi.spyOn(projections,'projectRootActor'),witness=vi.spyOn(domains,'inspectRootNodeWitnesses'),fk=vi.spyOn(kinematics,'sampleBodyGeometry');
  const result=refined(source);expect(result.status,result.reason).toBe('roots_proposed');expect(project).toHaveBeenCalledTimes(22);
  const plan=build.mock.results[0].value! as RootDomainPlan,ledgers=build.mock.calls[0][4];
  expect(grid).toHaveBeenCalledTimes(1);expect(grid.mock.calls[0]).toEqual([plan,ledgers]);expect(witness.mock.calls[0][0]).toBe(plan);expect(witness.mock.calls[0][2]).toBe(ledgers);
  for(let i=0;i<22;i++){
    const [input,work,policy]=project.mock.calls[i],original=plan.actors[i];expect(work).toBe(ledgers.get(input.actorId));expect(policy).toBe('physical-refined-1');
    expect(input.nodes).toBe(result.grid!.actors[i].nodes);expect(input.constraints).toBe(original.bindings);expect(input.postCheckReserve).toBe(original.postCheckReserve);
    expect(preflight.mock.calls[i][1]).toBe(work);expect(preflight.mock.calls[i][0].regions).toEqual(original.bindings.map(r=>({...r,policyKey:plan.key})));
    const row=result.actors[i];expect(row.work.consumed).toBe(work.consumed);expect(row.work.consumed).toBeLessThanOrEqual(10000);
    expect(row.work.consumed).toBe(Object.values(row.work.byStage).reduce((s,n)=>s+n,0));expect(row.work.byStage.preparation).toBeGreaterThan(1);
    expect(row.projection!.diagnostics.curveCheckStatus).toBe('passed');
  }
  expect(result.nodeWitnesses.status).toBe('witnessed');
  if(result.nodeWitnesses.status!=='not_run'){
    expect(result.nodeWitnesses.witnesses.flatMap(w=>w.contactEventIds)).toContain(source.events[0].id);
    expect(result.nodeWitnesses.witnesses.every(w=>plan.groups.some(g=>g.actorId===w.actorId&&g.atMs===w.atMs))).toBe(true);
  }
  const expectedMaxFK=plan.groups.reduce((s,g)=>s+g.poses.length,0);
  expect(fk.mock.calls.length).toBeLessThanOrEqual(expectedMaxFK*2);expect(result.bodyAcceptance).toBe('blocked');
});
it('refined_grid_exhaustion_preserves_spend_and_withholds_all_roots_before_projection',async()=>{
  const real=domains.buildRootContactDomains,project=vi.spyOn(projections,'projectRootActor');
  vi.spyOn(domains,'buildRootContactDomains').mockImplementation((...args)=>{const plan=real(...args),work=args[4].get(plan.actors[0].actorId)!;
    work.charge('preparation',9999-work.consumed);return plan;});
  const result=refined(await toy());expect(result.status).toBe('unavailable');expect(result.reason).toBe('grid_unavailable');expect(result).not.toHaveProperty('roots');
  expect(result.grid!.status).toBe('unavailable');expect(result.grid!.actors).toEqual([]);expect(result.actors[0].work.consumed).toBe(10000);expect(project).not.toHaveBeenCalled();
});
it('refined_actor_or_node_contact_rejection_never_leaks_partial_tracks_or_retries',async()=>{
  const source=await toy(),real=projections.projectRootActor,project=vi.spyOn(projections,'projectRootActor');
  project.mockImplementation((input,work,policy)=>{const result=real(input,work,policy);if(input.actorId!==source.frames[0].players[0].key)return result;
    const {track:_,...failed}=result;return {...failed,status:'not_converged',reason:'controlled_refined_actor_failure'};});
  const result=refined(source);expect(result.status).toBe('unavailable');expect(result).not.toHaveProperty('roots');expect(result.nodeWitnesses.status).toBe('not_run');expect(project).toHaveBeenCalledTimes(22);
  project.mockRestore();vi.spyOn(domains,'inspectRootNodeWitnesses').mockImplementation(plan=>({status:'unresolved',planKey:plan.key,witnesses:[],bodyAccepted:false,
    issues:[{code:'controlled_refined_contact_failure',actorId:null,atMs:null,eventId:null,refs:[]}]}));
  const contact=refined(source);expect(contact.status).toBe('unavailable');expect(contact).not.toHaveProperty('roots');expect(contact.reason).toBe('node_witnesses_unresolved');
});
it('refined_rejects_source_mutation_during_preparation_and_failed_vectors_as_inputs',async()=>{
  const source=await toy(),real=grids.buildRefinedRootGrid,project=vi.spyOn(projections,'projectRootActor');
  vi.spyOn(grids,'buildRefinedRootGrid').mockImplementation((...args)=>{const result=real(...args);
    (source.frames[1].players[0] as {x:number}).x+=.01;return result;});
  const result=refined(source);expect(result.status).toBe('unavailable');expect(result.reason).toBe('source_identity_changed');expect(result).not.toHaveProperty('roots');expect(project).not.toHaveBeenCalled();
  const invalid=compileRefinedRootDiagnostic({status:'failed',reports:[],finalNodes:[]} as unknown as SequenceSource,{} as never,createDiagnosticBodyGeometry());
  expect(invalid.reason).toBe('invalid_source_input');expect(invalid).not.toHaveProperty('roots');expect(invalid.grid).toBeNull();
});
it('stored_preparation_work_estimate_does_not_solve_or_spend_a_new_admission',async()=>{
  const {source}=await privateSequence(),semantics=classifyContacts(source),binding=domains.buildRootContactDomains;
  const work=new Map(source.frames[0].players.map(p=>[p.key,new feasibility.RootWorkLedger()]));
  const bindings=(await import('./root-observation-bindings')).classifyRootBindings(source,semantics);
  const project=vi.spyOn(projections,'projectRootActor'),plan=binding(source,semantics,createDiagnosticBodyGeometry(),bindings,work);
  const total=()=>[...work.values()].reduce((s,w)=>s+w.consumed,0);
  expect(total()).toBe(174);const grid=grids.buildRefinedRootGrid(plan,work);expect(grid.status).toBe('ready');expect(total()).toBe(752);
  for(const actor of plan.actors){
    const preflight=feasibility.inspectRootFeasibility({actorId:actor.actorId,domainKey:plan.key,scope:'finite_catalogue_necessary_root_regions',physicalAccelerationMps2:4,
      regions:actor.bindings.map(r=>({...r,policyKey:plan.key}))},work.get(actor.actorId)!);
    expect(preflight.status).toBe('not_excluded');
    expect(10000-work.get(actor.actorId)!.consumed-1-actor.postCheckReserve).toBeGreaterThan(0);
  }
  expect(total()).toBe(960);expect([...work.values()].reduce((s,w)=>s+(w.byStage.preflight??0),0)).toBe(208);
  expect(grid.actors.reduce((s,a)=>s+a.syntheticTimesMs.length,0)).toBe(578);expect(project).not.toHaveBeenCalled();
  expect(source.events).toHaveLength(17);expect(plan.bindingPlan.snapshots).toHaveLength(26);expect(plan.bindingPlan.excludedSnapshots).toHaveLength(1);expect(plan.ball.aliases).toHaveLength(5);
});
it('refined_source_changes_during_projection_or_witnesses_withhold_all_roots',async()=>{
  for(const stage of ['projection','witness'] as const){
    vi.restoreAllMocks();const source=await toy();
    const mutate=()=>{(source.frames[1].players[0] as {x:number}).x+=.01;};
    if(stage==='projection'){
      const real=projections.projectRootActor;
      vi.spyOn(projections,'projectRootActor').mockImplementation((...args)=>{const result=real(...args);mutate();return result;});
    }else{
      const real=domains.inspectRootNodeWitnesses;
      vi.spyOn(domains,'inspectRootNodeWitnesses').mockImplementation((...args)=>{const result=real(...args);mutate();return result;});
    }
    const result=refined(source);expect(result.status,stage).toBe('unavailable');expect(result.reason).toBe('source_identity_changed');expect(result).not.toHaveProperty('roots');
  }
});
it('exhausted_shared_ledger_cannot_reset_before_projection',async()=>{
  const real=domains.buildRootContactDomains;
  vi.spyOn(domains,'buildRootContactDomains').mockImplementation((...args)=>{const plan=real(...args);
    for(const work of args[4].values())work.charge('preparation',10000-work.consumed);return plan;});
  const result=run(await toy());expect(result.status).toBe('unavailable');expect(result).not.toHaveProperty('roots');
  expect(result.actors.every(a=>a.work.consumed===10000&&a.projection?.status==='exhausted')).toBe(true);
});
