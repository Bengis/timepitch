import { afterEach,expect,it,vi } from 'vitest';
import { buildRefinedRootGrid } from './root-time-grid';
import * as domains from './root-contact-domains';
import * as kinematics from './body-kinematics';
import { RootWorkLedger } from './root-feasibility';
import { privateSequence } from './private-fixture';
import { classifyContacts } from './contact-semantics';
import { classifyRootBindings } from './root-observation-bindings';
import { createDiagnosticBodyGeometry } from './body-geometry';
import type { RootDomainPlan } from './root-contact-domains';
import type { PoseNode } from './contact-types';

vi.mock('./root-projection',()=>{throw new Error('Projection forbidden in time-grid tests');});
vi.mock('./root-diagnostic',()=>{throw new Error('Full diagnostic forbidden in time-grid tests');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
// Numeric fixtures bypass only the registration query; real authority is tested separately.
function toy(times=[0,1001,1162]){
  const nodes:PoseNode[]=times.map((atMs,i)=>({atMs,pose:{root:{x:10+i,y:20+i},heading:0,angles:{},supportMode:'grounded',supportingFeet:['leftFoot','rightFoot']}}));
  const actors=Array.from({length:22},(_,i)=>({actorId:`toy-${i}`,fromMs:times[0],toMs:times.at(-1)!,entry:nodes[0].pose.root,exitPrior:nodes.at(-1)!.pose.root,
    nodes:structuredClone(nodes),bindings:[],postCheckReserve:2}));
  const plan={version:'root-contact-domains-1',status:'ready',key:'toy-domain-1',actors,contacts:[],groups:[],localisations:[],controls:[]} as unknown as RootDomainPlan;
  const work=new Map(actors.map(a=>[a.actorId,new RootWorkLedger()]));
  vi.spyOn(domains,'hasRootDomainWorkBinding').mockReturnValue(true);
  return {plan,work};
}
it('balances_1001ms_without_a_one_millisecond_tail_and_keeps_the161ms_gap',()=>{
  const {plan,work}=toy(),result=buildRefinedRootGrid(plan,work);
  expect(result.status).toBe('ready');expect(result.actors).toHaveLength(22);
  const actor=result.actors[0];expect(actor.nodes.map(n=>n.atMs)).toEqual([0,333,667,1001,1162]);
  expect(actor.originalTimesMs).toEqual([0,1001,1162]);expect(actor.syntheticTimesMs).toEqual([333,667]);
  expect(actor.nodes[1].pose.root.x).toBeCloseTo(10+333/1001);expect(actor.nodes[2].pose.root.y).toBeCloseTo(20+667/1001);
});
it('preserves_original_nodes_and_evidence_and_owns_immutable_computational_priors',()=>{
  const {plan,work}=toy(),before=JSON.stringify(plan),fk=vi.spyOn(kinematics,'sampleBodyGeometry');
  const result=buildRefinedRootGrid(plan,work);expect(result.status).toBe('ready');
  for(const old of plan.actors[0].nodes)expect(result.actors[0].nodes.find(n=>n.atMs===old.atMs)).toEqual(old);
  expect(JSON.stringify(plan)).toBe(before);expect(Object.isFrozen(plan)).toBe(false);
  expect(Object.isFrozen(result.actors[0].nodes[1].pose.root)).toBe(true);expect(result.actors[0].nodes[0]).not.toBe(plan.actors[0].nodes[0]);
  expect(result).not.toHaveProperty('contacts');expect(result).not.toHaveProperty('sample');expect(result).not.toHaveProperty('accepted');expect(fk).not.toHaveBeenCalled();
});
it('charges_only_added_nodes_on_each_existing_ledger_and_withholds_every_actor_on_exhaustion',()=>{
  const {plan,work}=toy();for(const ledger of work.values())ledger.charge('preparation',7);
  const result=buildRefinedRootGrid(plan,work);expect(result.status).toBe('ready');
  for(const ledger of work.values()){expect(ledger.consumed).toBe(9);expect(ledger.byStage).toEqual({preparation:9});}
  const exhausted=toy();exhausted.work.get('toy-1')!.charge('preparation',9999);
  const failed=buildRefinedRootGrid(exhausted.plan,exhausted.work);expect(failed.status).toBe('unavailable');expect(failed.actors).toEqual([]);
  expect(exhausted.work.get('toy-1')!.consumed).toBe(10000);expect(exhausted.work.get('toy-0')!.consumed).toBe(2);
});
it('rejects_invalid_times_boundaries_and_node_caps_before_generating_nodes',()=>{
  for(const times of [[0,0,1001],[0,1.5,1001],[1001,0],[0,32000]]){
    const {plan,work}=toy(times),result=buildRefinedRootGrid(plan,work);expect(result.status).toBe('unavailable');expect(result.actors).toEqual([]);
    expect([...work.values()].every(w=>w.consumed===0)).toBe(true);
  }
  const {plan,work}=toy();const outside={...plan,actors:plan.actors.map((a,i)=>i? a:{...a,toMs:1000})};
  expect(buildRefinedRootGrid(outside,work).status).toBe('unavailable');
});
it('keys_actual_times_and_priors_and_base_domain_without_a_budget_reset',()=>{
  const a=toy(),b=toy();expect(buildRefinedRootGrid(a.plan,a.work).key).toBe(buildRefinedRootGrid(b.plan,b.work).key);
  const c=toy([0,1002,1162]);expect(buildRefinedRootGrid(c.plan,c.work).key).not.toBe(buildRefinedRootGrid(a.plan,a.work).key);
  const d=toy();expect(buildRefinedRootGrid({...d.plan,key:'other-domain'},d.work).key).not.toBe(buildRefinedRootGrid(a.plan,a.work).key);
  const changed={...b.plan,actors:b.plan.actors.map((row,i)=>i?row:{...row,nodes:row.nodes.map((n,j)=>j!==1?n:{...n,pose:{...n.pose,root:{x:15,y:25}}})})};
  expect(buildRefinedRootGrid(changed,b.work).key).not.toBe(buildRefinedRootGrid(a.plan,a.work).key);
});
it('unregistered_malformed_actors_fail_closed_before_their_contents_are_read',()=>{
  const {work}=toy();vi.restoreAllMocks();
  const forged={status:'ready',key:'forged-domain',actors:Array(22).fill(null)} as unknown as RootDomainPlan;
  expect(buildRefinedRootGrid(forged,work).status).toBe('unavailable');
});
it('real_saved_preparation_retains17_26_1_5_and_registers_the_same_ledgers_with752units',async()=>{
  const {source}=await privateSequence(),semantics=classifyContacts(source),bindings=classifyRootBindings(source,semantics);
  const work=new Map(source.frames[0].players.map(p=>[p.key,new RootWorkLedger()]));
  const plan=domains.buildRootContactDomains(source,semantics,createDiagnosticBodyGeometry(),bindings,work),before=JSON.stringify(plan);
  const cryptoName='node:crypto';
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
  const hash=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
  expect(hash(plan.key)).toBe('52d84a8e953957189e025092953eb89aa7a27f937542f385b531c9fffa6f4296');
  expect(plan.status).toBe('ready');expect(domains.hasRootDomainWorkBinding(plan,work)).toBe(true);
  expect([...work.values()].reduce((s,w)=>s+w.consumed,0)).toBe(174);
  const fk=vi.spyOn(kinematics,'sampleBodyGeometry'),result=buildRefinedRootGrid(plan,work);
  expect(result.status).toBe('ready');expect(result.actors).toHaveLength(22);
  expect(Math.min(...result.actors.map(a=>a.nodes.length))).toBe(29);expect(Math.max(...result.actors.map(a=>a.nodes.length))).toBe(32);
  expect(result.actors.reduce((s,a)=>s+a.syntheticTimesMs.length,0)).toBe(578);
  expect([...work.values()].reduce((s,w)=>s+w.consumed,0)).toBe(752);expect([...work.values()].reduce((s,w)=>s+(w.byStage.fk??0),0)).toBe(103);
  expect(fk).not.toHaveBeenCalled();expect(JSON.stringify(plan)).toBe(before);
  expect(source.events).toHaveLength(17);expect(plan.bindingPlan.snapshots).toHaveLength(26);expect(plan.bindingPlan.excludedSnapshots).toHaveLength(1);expect(plan.ball.aliases).toHaveLength(5);
  for(const actor of result.actors){
    const original=plan.actors.find(a=>a.actorId===actor.actorId)!;
    expect(actor.originalTimesMs).toEqual(original.nodes.map(n=>n.atMs));expect(actor.nodes.every((n,i)=>!i||n.atMs-actor.nodes[i-1].atMs<=500)).toBe(true);
  }
  const spent=[...work.values()].map(w=>w.consumed);
  for(const invalid of [{...plan},structuredClone({...plan,ball:{...plan.ball,sample:undefined}})])expect(buildRefinedRootGrid(invalid as RootDomainPlan,work).status).toBe('unavailable');
  const replacement=new Map(work);replacement.set(plan.actors[0].actorId,new RootWorkLedger());
  expect(domains.hasRootDomainWorkBinding(plan,replacement)).toBe(false);expect(buildRefinedRootGrid(plan,replacement).status).toBe('unavailable');
  expect(buildRefinedRootGrid(plan,new Map()).status).toBe('unavailable');expect([...work.values()].map(w=>w.consumed)).toEqual(spent);
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_ROOT_GRID_RECEIPT){
    const fsName='node:fs';
    const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(p:string,s:string,o:{flag:'wx'})=>void};
    fs.writeFileSync(env.TIMEPITCH_ROOT_GRID_RECEIPT,JSON.stringify({case:'TP171',kind:'computational_grid_preparation_only',status:result.status,
      gridKeySha256:hash(result.key),baseDomainKeySha256:hash(result.baseDomainKey),sourceDigest:source.rawDigest,
      maxGapMs:result.maxGapMs,actors:result.actors.map(a=>({actorId:a.actorId,originalTimesMs:a.originalTimesMs,syntheticTimesMs:a.syntheticTimesMs,
        nodeCount:a.nodes.length,work:{consumed:work.get(a.actorId)!.consumed,byStage:work.get(a.actorId)!.byStage}})),
      preparationBeforeGrid:174,addedNodes:578,preparationAfterGrid:752,originalFKCalls:103,gridFKCalls:0,
      originalEvents:17,snapshots:26,excludedConflicts:1,aliases:5,solverCalls:0,fullDiagnosticCalls:0,newAdmissions:0,bodyAccepted:false},null,2)+'\n',{flag:'wx'});
  }
});
