import { expect, it } from 'vitest';
import literal from '../../../../backend/tests/fixtures/directed-job-1.json';
import { auditDirectedEvidence } from './evidence-audit';
import { candidate, clone } from './test-fixtures';
import type { DirectedEvidenceBundle, DirectedJob } from './control-types';

const job=()=>clone(literal) as unknown as DirectedJob;
function bundle():DirectedEvidenceBundle {
  const j=job(),r=j.request,event=r.events[2];
  return {version:'directed-evidence-1',requestDigest:r.requestDigest,profile:j.profile,candidate:candidate(r),
    receipt:{id:'controlled-receipt',sha256:'e'.repeat(64)},units:'metres',
    clock:{sourceStartMs:r.clip.fromMs,physicalStartMs:0,rate:1},identities:r.roster.map(p=>({playerKey:p.playerKey,engineId:p.engineId})),
    events:r.events.map(e=>({eventId:e.id,period:e.period,sourceMs:e.elapsedMs,physicalMs:e.elapsedMs-r.clip.fromMs,actorId:e.actorId,
      engineActorId:r.roster.find(p=>p.playerKey===e.actorId)?.engineId??null,recipientId:e.recipientId,
      engineRecipientId:r.roster.find(p=>p.playerKey===e.recipientId)?.engineId??null,outcome:e.outcome})),
    contacts:[{eventId:event.id,actorId:event.actorId!,engineId:'home:2',period:1,sourceMs:event.elapsedMs,physicalMs:event.elapsedMs-r.clip.fromMs,
      geometry:{provenance:'engine_output',effector:'left_foot',effectorCentre:{x:12,y:34,z:1},effectorRadiusM:.1,ballCentre:{x:12.35,y:34,z:1},ballRadiusM:.2}}],
    intervalEvidence:{root:null,node:null,body:null},unavailable:[]};
}

it('recomputes the surface residual from exported geometry without certifying a body or a run',()=>{
  const b=bundle(),before=JSON.stringify(b),r=auditDirectedEvidence(job().request,b);
  expect(r.status).toBe('blocked');expect(r.acceptance).toBe('not_assessed');
  expect(r.contacts[0].surfaceErrorM).toBeCloseTo(.05,10);expect(r.contacts[0].timeErrorMs).toBe(0);
  expect(r.checks.body.status).toBe('blocked');expect(r.checks.root.status).toBe('blocked');expect(r.checks.node.status).toBe('blocked');
  expect(JSON.stringify(b)).toBe(before);expect(Object.isFrozen(r.contacts)).toBe(true);
});
it('retains the diagnosed excluded conflict and unverified height without automatic source failure',()=>{
  const request=job().request,r=auditDirectedEvidence(request,bundle());
  expect(r.status).toBe('blocked');expect(r.observations.diagnosedConflicts).toEqual([{eventId:'shot',playerKey:'historical:statsbomb:1',refs:['shot']}]);
  expect(r.boundaryIssues).toEqual(request.boundaryIssues);expect(request.evidence.actions[0].shot!.endHeightMetres).toBeNull();
});
it.each(['goal','receiver','foreign_actor','time','contact_gap','effector','contact_time','candidate_identity','candidate_clock','event_order','receipt','clock','duplicate_event','units'])(
  'rejects contradictory observed %s independently of the historical overlay',kind=>{
    const b=bundle() as any;
    if(kind==='goal')b.events[2].outcome='Saved';
    if(kind==='receiver')b.events[0].recipientId=null;
    if(kind==='foreign_actor')b.events[2].engineActorId='foreign';
    if(kind==='time')b.events[2].sourceMs+=.325;
    if(kind==='contact_gap')b.contacts[0].geometry.ballCentre.x=12.5;
    if(kind==='effector')b.contacts[0].geometry.effector='head';
    if(kind==='contact_time')b.contacts[0].physicalMs+=.325;
    if(kind==='candidate_identity')b.candidate.requestDigest='f'.repeat(64);
    if(kind==='candidate_clock'){b.candidate.clock.physicalStartMs=50;for(const sample of b.candidate.samples)sample.physicalMs+=50;}
    if(kind==='event_order')b.events.reverse();
    if(kind==='receipt')b.receipt.sha256='f'.repeat(64);
    if(kind==='clock')b.clock.rate=18;
    if(kind==='duplicate_event')b.events[1]=clone(b.events[0]);
    if(kind==='units')b.units='yards';
    expect(auditDirectedEvidence(job().request,b).status).toBe('failed');
  });
it('does not trust claimed passed checks or opaque interval certificates',()=>{
  const b=bundle() as any;
  for(const check of Object.values(b.candidate.checks) as any[]){check.status='passed';check.reason=null;}
  b.intervalEvidence={root:{passed:true},node:{passed:true},body:{passed:true}};
  const r=auditDirectedEvidence(job().request,b);
  expect(r.acceptance).toBe('not_assessed');expect(r.status).toBe('blocked');
  expect(Object.values(r.checks).every(check=>check.status==='blocked')).toBe(true);
});
it.each(['geometry','inferred_geometry','missing_event','no_candidate'])(
  'reports unavailable evidence without fabricating zeros: %s',kind=>{
    const b=bundle() as any;
    if(kind==='geometry')b.contacts[0].geometry=null;
    if(kind==='inferred_geometry')b.contacts[0].geometry.provenance='view_inferred';
    if(kind==='missing_event')b.events.pop();
    if(kind==='no_candidate')b.candidate=null;
    const r=auditDirectedEvidence(job().request,b);expect(r.status).toBe('blocked');
    if(kind.includes('geometry'))expect(r.contacts[0].surfaceErrorM).toBeNull();
    expect(r.issues.length).toBeGreaterThan(0);
  });
it('reports malformed input as failed without invoking any engine or validator runtime',()=>{
  expect(auditDirectedEvidence(job().request,null as any).status).toBe('failed');
  const b=bundle() as any;b.contacts[0].geometry.ballCentre.x=NaN;
  expect(auditDirectedEvidence(job().request,b).status).toBe('failed');
});
