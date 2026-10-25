import { afterEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { classifyContacts } from './contact-semantics';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { classifyRootBindings } from './root-observation-bindings';
import { RootWorkLedger } from './root-feasibility';
import { hermiteSpan } from './curves';
import { buildRootContactDomains,inspectRootNodeWitnesses,contactOuterCapsule,encloseRootCapsules,contactSurfaceErrorM } from './root-contact-domains';
import type { BodyRootTrack,MetricCapsule } from './contact-types';
import type { SequenceSource } from './types';
afterEach(()=>vi.unstubAllGlobals());
function ledgers(source:SequenceSource){return new Map(source.frames[0].players.map(p=>[p.key,new RootWorkLedger()]));}
function build(source:SequenceSource){const semantics=classifyContacts(source),work=ledgers(source);
  return {plan:buildRootContactDomains(source,semantics,createDiagnosticBodyGeometry(),classifyRootBindings(source,semantics),work),work};}
async function stationary(){
  const {source}=await privateSequence(),first=source.events.find(e=>e.kind==='Pass')!,start=first.start!;
  const event={...first,relatedIds:[],recipientId:null,assistedShotId:null,durationMs:source.request.toMs-source.request.fromMs,end:{...start}};
  const players=source.frames[0].players.map(p=>p.key===first.actorId?{...p,...start}:{...p});
  const frames=[source.request.fromMs,source.request.toMs].map(clock_ms=>({...source.frames[0],clock_ms,players:players.map(p=>({...p})),ball:{...start}}));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({event,frames})));
  const rawDigest=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const key=JSON.stringify([source.identity,'root-witness-unit-fixture',rawDigest,source.request]);
  return {...source,key,rawDigest,motionRevision:'root-witness-unit-fixture',events:[event],frames,cuts:[],
    performanceEvidence:{...source.performanceEvidence!,sourceKey:key,actions:source.performanceEvidence!.actions.filter(a=>a.eventId===event.id),snapshots:[],issues:[]}};
}
function stationaryRoots(plan:ReturnType<typeof buildRootContactDomains>):BodyRootTrack[]{
  return plan.actors.map(a=>({actorId:a.actorId,poseNodes:a.nodes,spans:[hermiteSpan({atMs:a.fromMs,point:a.entry},{atMs:a.toMs,point:a.entry},{x:0,y:0},{x:0,y:0})]}));
}
it('surface_contact_outer_region_is_not_an_eight_centimetre_root_disk',()=>{
  const surface:MetricCapsule={id:'rightFoot',a:{x:0,y:0,z:.05},b:{x:.2,y:0,z:.05},radiusM:.05};
  const r=contactOuterCapsule({x:1,y:0,z:.11},.11,surface)!;
  expect(r.a.x).toBeCloseTo(1);expect(r.b.x).toBeCloseTo(.8);
  expect(r.radiusM).toBeGreaterThanOrEqual(Math.sqrt(.24**2-.06**2));expect(r.radiusM).toBeLessThan(.24+1e-10);
  expect(contactOuterCapsule({x:1,y:0,z:2},.11,surface)).toBeNull();
});
it('outer_hull_contains_branches_but_is_not_a_contact_witness',()=>{
  const regions=[{id:'a',a:{x:-1,y:0},b:{x:-1,y:0},radiusM:.1},{id:'b',a:{x:1,y:0},b:{x:1,y:0},radiusM:.1}];
  const polygon=encloseRootCapsules(regions);
  expect(polygon.kind).toBe('polygon');
  if(polygon.kind==='polygon')for(const r of regions)for(let k=0;k<32;k++){
    const p={x:r.a.x+.1*Math.cos(k*Math.PI/16),y:r.a.y+.1*Math.sin(k*Math.PI/16)};
    for(let i=0;i<polygon.vertices.length;i++){
      const a=polygon.vertices[i],b=polygon.vertices[(i+1)%polygon.vertices.length];
      expect((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)).toBeGreaterThanOrEqual(-1e-10);
    }
  }
  const surface:MetricCapsule={id:'rightHand',a:{x:0,y:0,z:1},b:{x:0,y:0,z:1},radiusM:.07};
  expect(contactSurfaceErrorM({x:.18,y:0,z:1},.11,surface,'rightHand')).toBeCloseTo(0);
  expect(contactSurfaceErrorM({x:0,y:0,z:1},.11,surface,'rightHand')).toBeGreaterThan(.08);
  expect(contactSurfaceErrorM({x:.18,y:0,z:3},.11,surface,'rightHand')).toBeGreaterThan(.08);
  expect(contactSurfaceErrorM({x:.18,y:0,z:1},.11,surface,'leftHand')).toBeNull();
  expect(contactSurfaceErrorM({x:.18,y:0,z:1},.11,surface,'unknownSurface')).toBeNull();
});
it('invalid_capsules_and_radii_cannot_form_a_contact_proof',()=>{
  expect(()=>encloseRootCapsules([{id:'invalid',a:{x:0,y:0},b:{x:0,y:0},radiusM:-1}])).toThrow();
  const surface:MetricCapsule={id:'head',a:{x:0,y:0,z:1},b:{x:0,y:0,z:1},radiusM:.18};
  expect(contactSurfaceErrorM({x:.07,y:0,z:1},-.11,surface,'head')).toBeNull();
});
it('saved_preparation_keeps_seven_contacts_26_markers_and_shared_ball_hypotheses',async()=>{
  const {source}=await privateSequence(),before=JSON.stringify(source),{plan,work}=build(source);
  expect(plan.status,JSON.stringify(plan.issues)).toBe('ready');expect(plan.actors).toHaveLength(22);expect(plan.contacts).toHaveLength(7);
  expect(plan.localisations.filter(l=>l.provenance==='recorded_snapshot')).toHaveLength(26);expect(plan.bindingPlan.excludedSnapshots).toHaveLength(1);
  const gomis=plan.actors.find(a=>a.actorId==='historical:statsbomb:20521')!;
  expect(gomis.nodes.some(n=>n.atMs===1693494)).toBe(true);expect(gomis.nodes.some(n=>n.atMs===1693655)).toBe(true);
  expect(gomis.bindings.some(b=>b.atMs===1693494&&b.provenance==='recorded_event')).toBe(false);
  for(const c of plan.contacts){
    expect(c.branches.length).toBeGreaterThan(0);expect(c.originalRootSurrogate.radiusM).toBe(.08);
    expect(c.ballProvenance).toBe('recorded_xy_illustrative_height');
    expect(c.branches.every(b=>b.outerRegion.radiusM>.08)).toBe(true);
  }
  const block=plan.contacts.find(c=>c.observation.role==='block')!;
  expect(block.observation.effector).toBe('unknownSurface');expect(block.branches.every(b=>!b.surfaceId.includes('Hand'))).toBe(true);
  const save=plan.contacts.find(c=>c.observation.role==='save')!;
  expect(save.branches.every(b=>b.surfaceId==='rightHand'&&b.pose.supportMode==='dive')).toBe(true);
  expect(save.ball).not.toEqual({...save.observation.sourcePoint,z:save.ball.z});
  expect(plan.ball.rawHeights.every(h=>h.unit==='unverified')).toBe(true);
  expect(JSON.stringify(source)).toBe(before);expect([...work.values()].every(w=>w.consumed<=10000)).toBe(true);
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_ROOT_DOMAIN_RECEIPT){
    const fsName='node:fs',cryptoName='node:crypto';
    const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(p:string,s:string)=>void};
    const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
    fs.writeFileSync(env.TIMEPITCH_ROOT_DOMAIN_RECEIPT,JSON.stringify({case:'TP167',kind:'finite_contact_domain_preparation_only',status:plan.status,
      keySha256:crypto.createHash('sha256').update(plan.key).digest('hex'),sourceDigest:source.rawDigest,geometryUnchanged:true,issues:plan.issues,
      actors:plan.actors.map(a=>({actorId:a.actorId,nodeTimes:a.nodes.map(n=>n.atMs),bindingCount:a.bindings.length,postCheckReserve:a.postCheckReserve,
        work:{consumed:work.get(a.actorId)!.consumed,byStage:work.get(a.actorId)!.byStage}})),
      contacts:plan.contacts.map(c=>({eventId:c.observation.eventId,actorId:c.observation.actorId,atMs:c.observation.sourceAtMs,recordedEffector:c.observation.effector,
        ball:c.ball,ballProvenance:c.ballProvenance,branchCount:c.branches.length,surfaces:[...new Set(c.branches.map(b=>b.surfaceId))],
        originalBranchId:c.originalBranchId,originalRootSurrogate:c.originalRootSurrogate,necessaryRegion:c.region})),
      localisations:plan.localisations,controls:plan.controls,aliases:plan.ball.aliases,rawHeights:plan.ball.rawHeights,
      knownConflicts:plan.bindingPlan.excludedSnapshots,correctedWholeClipAttempts:0,nativeMatches:0,modelCalls:0,published:false,bodyAccepted:false},null,2)+'\n');
  }
});
it('actual_FK_witnesses_use_the_same_pose_for_contact_and_localisation',async()=>{
  const source=await stationary(),{plan,work}=build(source),roots=stationaryRoots(plan);
  const witnessed=inspectRootNodeWitnesses(plan,roots,work);
  expect(witnessed.status).toBe('witnessed');expect(witnessed.bodyAccepted).toBe(false);
  const first=source.events[0],rawRow={sourceId:1,playerKey:first.actorId,point:{x:0,y:0},status:'usable' as const,reason:null,eventPoint:null,discrepancyM:null,refs:first.refs,raw:{}};
  const conflict={...source,performanceEvidence:{...source.performanceEvidence,snapshots:[{eventId:first.id,elapsedMs:first.elapsedMs,period:first.period,periodMs:first.periodMs,rows:[rawRow]}]}};
  const other=build(conflict);
  expect(inspectRootNodeWitnesses(other.plan,stationaryRoots(other.plan),other.work).status).toBe('unresolved');
});
it('stale_binding_or_forged_plan_missing_roots_and_replaced_ledgers_cannot_pass',async()=>{
  const source=await stationary(),semantics=classifyContacts(source),binding=classifyRootBindings(source,semantics),work=ledgers(source);
  const stale={...binding,observations:binding.observations.slice(1)};
  expect(buildRootContactDomains(source,semantics,createDiagnosticBodyGeometry(),stale,work).status).toBe('unavailable');
  const {plan,work:other}=build(source);
  expect(inspectRootNodeWitnesses({...plan},stationaryRoots(plan),other).status).toBe('unresolved');
  expect(inspectRootNodeWitnesses(plan,[],other).status).toBe('unresolved');
  expect(inspectRootNodeWitnesses(plan,stationaryRoots(plan),ledgers(source)).status).toBe('unresolved');
});
it('budget_exhaustion_and_unsupported_support_never_trigger_pose_fallback',async()=>{
  const source=await stationary(),s=classifyContacts(source),b=classifyRootBindings(source,s),work=ledgers(source);
  work.get(source.events[0].actorId!)!.charge('fk',10000);
  expect(buildRootContactDomains(source,s,createDiagnosticBodyGeometry(),b,work).status).toBe('unavailable');
  const g=createDiagnosticBodyGeometry(),side=source.events[0].bodyPart==='left_foot'?'leftFoot':'rightFoot';
  const invalid={...g,actionTemplates:{...g.actionTemplates,[side]:{...g.actionTemplates[side],supportingFeet:[side]}}};
  expect(buildRootContactDomains(source,s,invalid as typeof g,b,ledgers(source)).status).toBe('unavailable');
});
