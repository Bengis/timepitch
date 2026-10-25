import { afterEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { classifyContacts } from './contact-semantics';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { compileBodyContactCandidate } from './body-contact-candidate';
afterEach(()=>vi.unstubAllGlobals());
// Hand-controlled contract fixture, owned copies only. Does not replace the saved match.
async function stationaryContractSource(cuts:import('./types').SequenceSource['cuts']=[]){
  const {source}=await privateSequence(),first=source.events.find(e=>e.kind==='Pass')!,start=first.start!,
    event={...first,relatedIds:[],recipientId:null,assistedShotId:null,durationMs:source.request.toMs-source.request.fromMs,end:{...start}};
  const players=source.frames[0].players.map(p=>p.key===first.actorId?{...p,...start}:{...p});
  const frames=[source.request.fromMs,source.request.toMs].map(clock_ms=>({...source.frames[0],clock_ms,players:players.map(p=>({...p})),ball:{...start}}));
  const text=JSON.stringify({events:[event],frames,cuts}),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)),
    rawDigest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''),
    key=JSON.stringify([source.identity,'stationary-contract-fixture',rawDigest,source.request]);
  return {...source,key,rawDigest,motionRevision:'stationary-contract-fixture',events:[event],frames,cuts,
    performanceEvidence:{...source.performanceEvidence!,sourceKey:key,actions:source.performanceEvidence!.actions.filter(a=>a.eventId===event.id),snapshots:[],issues:[]}};
}
it('saved_whole_clip_attempt_preserves_source_and_reports_failure_without_partial_tracks',async()=>{
  const {source}=await privateSequence(),before=JSON.stringify(source),s=classifyContacts(source),g=createDiagnosticBodyGeometry();
  const c=compileBodyContactCandidate(source,s,g);
  expect(c.profile).toBe('historical-body-contact-1');
  expect(c.diagnostics.prepared.actors).toHaveLength(22);
  expect(c.sourceKey).toBe(source.key);expect(c.geometryKey).toBe(g.key);expect(c.semanticKey).toBe(s.key);
  expect(JSON.stringify(source)).toBe(before);
  if(c.status==='unavailable'){expect(c).not.toHaveProperty('tracks');expect(c.issues.length).toBeGreaterThan(0);expect(c.sample(1693655)).toBeNull();}
  else expect(c.tracks).toHaveLength(22); // Proposed never means accepted by the future verifier.
  const fsName='node:fs';const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_BODY_CANDIDATE_RECEIPT){const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(p:string,t:string)=>void};
    fs.writeFileSync(env.TIMEPITCH_BODY_CANDIDATE_RECEIPT,JSON.stringify({case:'TP162',kind:'uncertified_diagnostic_attempt',status:c.status,
      sourceKey:c.sourceKey,geometryKey:c.geometryKey,semanticKey:c.semanticKey,issues:c.issues,
      actors:c.diagnostics.prepared.actors.length,bindings:c.diagnostics.prepared.constraints,contacts:c.diagnostics.prepared.contacts,
      excludedSnapshots:c.diagnostics.prepared.excludedSnapshots,reports:c.diagnostics.reports,
      sourceUnchanged:true,nativeMatches:0,modelCalls:0,published:false},null,2)+'\n');}
});
it('same_cursor_same_pose_across_seek_schedules_and_invalid_semantics_never_fallback',async()=>{
  const {source}=await privateSequence(),s=classifyContacts(source),g=createDiagnosticBodyGeometry();
  const c=compileBodyContactCandidate(source,{...s,sourceKey:'foreign'},g);
  expect(c.issues.length).toBeGreaterThan(0);expect(c.status).toBe('unavailable');
  for(const t of [1693655,1684024,1693655,1697850,1693655])expect(c.sample(t)).toBeNull();
});
it('proposed_complete_sample_is_absolute_time_deterministic_at_half_normal_double_and_reverse_speeds',async()=>{
  const source=await stationaryContractSource(),c=compileBodyContactCandidate(source,classifyContacts(source),createDiagnosticBodyGeometry());
  expect(c.status).toBe('proposed');
  const middle=(source.request.fromMs+source.request.toMs)/2,expected=c.sample(middle);
  expect(expected).not.toBeNull();expect(expected!.actors).toHaveLength(22);
  expect(c).toHaveProperty('ballHeightKnots');
  expect(expected!.ballProvenance).toBe('recorded_xy_illustrative_height');
  for(const speed of [.5,1,2]){
    c.sample(source.request.fromMs+1000*speed);c.sample(source.request.toMs);c.sample(source.request.fromMs);
    expect(c.sample(middle)).toEqual(expected);
  }
  expect(c.sample(source.request.toMs+1)).toBeNull();expect(c.sample(NaN)).toBeNull();
});
it('source_player_cut_withholds_the_whole_sample_instead_of_a_partial_team',async()=>{
  const source=await stationaryContractSource([{id:'actor-cut',fromMs:1688000,toMs:1689000,entityIds:['historical:statsbomb:3057'],reason:'unknown player gap',refs:['contract-cut']}]);
  const c=compileBodyContactCandidate(source,classifyContacts(source),createDiagnosticBodyGeometry());
  expect(c.status).toBe('proposed');expect(c.sample(1688500)).toBeNull();expect(c.sample(1687000)).not.toBeNull();
});
