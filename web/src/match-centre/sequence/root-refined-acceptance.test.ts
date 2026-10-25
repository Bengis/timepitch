import { afterEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { classifyContacts } from './contact-semantics';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { compileRefinedRootDiagnostic } from './root-diagnostic';
import { runRefinedAdmissionHarness } from './root-refined-harness';

// Prepared only. Explicit opt-in, sealed candidate, fixed durable wx claim; no reset/retry.
const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
afterEach(()=>vi.unstubAllGlobals());
it('TP173-root-refined-diagnostic-2: one future saved-input invocation, roots and node contacts',async()=>{
  if(env?.TIMEPITCH_ROOT_REFINED_ADMISSION!=='TP173-root-refined-diagnostic-2')throw new Error('Separate explicit authorisation of cumulative maximum2 required');
  const fsName='node:fs',cryptoName='node:crypto',processName='node:process';
  const fs=await import(/* @vite-ignore */ fsName) as {
    readFileSync:(p:string,encoding:'utf8')=>string;writeFileSync:(p:string,s:string,options:{flag:'wx'})=>void;
  };
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
  const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
  const nodeProcess=await import(/* @vite-ignore */ processName) as {cwd:()=>string};
  const result=await runRefinedAdmissionHarness({admissionId:env.TIMEPITCH_ROOT_REFINED_ADMISSION,cwd:nodeProcess.cwd(),
    readFileSync:fs.readFileSync,writeFileSync:fs.writeFileSync,hash,compile:compileRefinedRootDiagnostic,
    prepare:async()=>{const {source}=await privateSequence();return {source,semantics:classifyContacts(source),geometry:createDiagnosticBodyGeometry()};}});
  // Persist rejection before assertions. No fallback or automatic rerun.
  expect(result?.profile).toBe('historical-root-diagnostic-3');expect(result?.policy).toBe('physical-refined-1');
  expect(result?.status,result?.reason).toBe('roots_proposed');expect(result?.roots).toHaveLength(22);expect(result?.nodeWitnesses.status).toBe('witnessed');
  if(result&&result.nodeWitnesses.status!=='not_run'){
    const covered=new Set(result.nodeWitnesses.witnesses.flatMap(w=>w.contactEventIds));
    for(const o of result.observations.filter(o=>o.observation.physicalContactRequired))expect(covered.has(o.observation.eventId)).toBe(true);
  }
  expect(result?.actors.every(a=>a.work.consumed<=10000)).toBe(true);expect(result?.inventory.maxNodes).toBeLessThanOrEqual(64);
  expect(result?.grid?.maxGapMs).toBe(500);expect(result?.bodyAcceptance).toBe('blocked');
},120000);
