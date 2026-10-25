import { afterEach, expect, it, vi } from 'vitest';
import { compileDepiction } from './depiction';
import { prepareConstraints } from './constraints';
import { solveActorConstraints } from './constraint-solver';
import { privateSequence, rawView } from './private-fixture';
import { compileStaging, inspectStaging } from './staging';

afterEach(()=>vi.unstubAllGlobals());
it('retains the saved whole-clip gate failure, withholding all tracks and preserving V2/facts',async()=>{
  const {source}=await privateSequence(),before=JSON.stringify(source),base=compileDepiction(source,'historical-action-preview-2');
  const old=prepareConstraints(source).actors.map(a=>solveActorConstraints(a));
  const t=[source.request.fromMs,1692171,1693655,1694186,1695068,1697116,source.request.toMs];
  const baseSamples=t.map(at=>base.sample(at,rawView(source,at)));
  const staged=compileStaging(source,base),report=inspectStaging(staged);
  expect(JSON.stringify(source)).toBe(before);expect(source.rawDigest).toBe('2448bed73cb06c3fbaf2df69b31e6af208afc38a909128b887740428f3b04944');
  expect(source.performanceEvidence!.evidenceDigest).toBe('fd34efda0b62f58619e10a24439ae3b49eaa4dec4a5fe0d1e0bd6c2a0c9d0d07');
  expect(prepareConstraints(source).actors.map(a=>solveActorConstraints(a))).toEqual(old);
  expect(t.map(at=>base.sample(at,rawView(source,at)))).toEqual(baseSamples);
  expect(staged.actorIds).toHaveLength(22);expect(staged.constraints.filter(c=>c.provenance==='recorded_snapshot')).toHaveLength(26);
  expect(staged.issues).toContainEqual(expect.objectContaining({code:'snapshot_conflict_excluded',blocking:false,actorIds:['historical:statsbomb:3957']}));
  const receipt={case:'TP156',phase:2,version:staged.version,key:staged.key,sourceDigest:source.rawDigest,evidenceDigest:staged.evidenceDigest,
    gate:report.accepted?'passed':'failed',clip:{fromMs:staged.fromMs,toMs:staged.toMs},actors:staged.actorIds.length,acceptedTracks:staged.tracks.length,
    report,constraints:staged.constraints,contacts:staged.contacts,offsets:staged.offsets,solvers:staged.solvers,aliases:staged.aliases,duelExceptions:staged.duelExceptions,
    sourcesUnchanged:true,v2Unchanged:true,nativeMatches:0,modelCalls:0,published:false};
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_STAGING_RECEIPT){const fsName='node:fs';const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(path:string,text:string)=>void};fs.writeFileSync(env.TIMEPITCH_STAGING_RECEIPT,JSON.stringify(receipt,null,2)+'\n');}
  // Initial acceptance attempt is retained in the private RED receipt. These
  // assertions verify fail-closed behaviour, not acceptance of the real clip.
  expect(report.accepted).toBe(false);expect(staged.tracks).toEqual([]);
  expect(staged.solvers.filter(s=>s.report.status==='certified')).toHaveLength(19);
  expect(staged.solvers.filter(s=>s.report.status==='not_converged').map(s=>s.actorId)).toEqual(['historical:statsbomb:20521']);
  expect(staged.solvers.find(s=>s.actorId==='historical:statsbomb:3645')!.report).toMatchObject({status:'constraint_conflict',iterations:0,reasons:['analytic_reachability']});
  expect(staged.solvers.find(s=>s.actorId==='historical:statsbomb:7063')!.report).toMatchObject({status:'constraint_conflict',iterations:0,
    reachabilityWitness:{minRequiredAcceleration:expect.closeTo(4.1562179572325295,9),limit:4}});
  for(const s of staged.solvers.filter(s=>s.report.status==='not_converged')){
    expect(s.report.iterations).toBeLessThanOrEqual(10000);expect(s.report.analyticCertificate).toBeNull();
    expect(s.report.failedBounds!.length).toBeGreaterThan(0);
  }
  for(const actorId of staged.actorIds)for(const at of t)expect(staged.sampleRoot(actorId,at)).toBeNull();
});
