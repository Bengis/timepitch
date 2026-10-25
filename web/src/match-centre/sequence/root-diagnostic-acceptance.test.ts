import { afterEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { classifyContacts } from './contact-semantics';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { compileRootDiagnostic } from './root-diagnostic';
import type { RootDiagnosticResult } from './root-diagnostic';

// Default test configuration excludes this file. A durable wx claim forbids repeats.
const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
afterEach(()=>vi.unstubAllGlobals());
it('TP168-root-diagnostic-1: all22 roots and every required node contact',async()=>{
  if(env?.TIMEPITCH_ROOT_DIAGNOSTIC_ADMISSION!=='TP168-root-diagnostic-1'||!env.TIMEPITCH_ROOT_DIAGNOSTIC_DIR)
    throw new Error('Explicit single admission and private output directory required');
  const fsName='node:fs',cryptoName='node:crypto';
  const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(p:string,s:string,options:{flag:'wx'})=>void};
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
  const {source}=await privateSequence(),semantics=classifyContacts(source),geometry=createDiagnosticBodyGeometry();
  const directory=env.TIMEPITCH_ROOT_DIAGNOSTIC_DIR,startedAt=new Date().toISOString();
  fs.writeFileSync(`${directory}/admission.json`,JSON.stringify({id:'TP168-root-diagnostic-1',startedAt,limit:1,sourceDigest:source.rawDigest})+'\n',{flag:'wx'});
  let result:RootDiagnosticResult|undefined,error:string|null=null;const start=performance.now();
  try {
    result=compileRootDiagnostic(source,semantics,geometry); // Exactly one corrected saved-input invocation.
  }catch(e){error=String(e);throw e;}
  finally {
    fs.writeFileSync(`${directory}/result.json`,JSON.stringify({id:'TP168-root-diagnostic-1',startedAt,elapsedMs:performance.now()-start,error,
      sourceDigest:source.rawDigest,geometrySha256:crypto.createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),result},null,2)+'\n',{flag:'wx'});
  }
  // Persist before assertions; retain failure rather than weakening this gate or retrying.
  expect(result?.status,result?.reason).toBe('roots_proposed');
  expect(result?.roots).toHaveLength(22);expect(result?.nodeWitnesses.status).toBe('witnessed');
  if(result&&result.nodeWitnesses.status!=='not_run'){
    const events=new Set(result.nodeWitnesses.witnesses.flatMap(w=>w.contactEventIds));
    for(const observation of result.observations.filter(o=>o.observation.physicalContactRequired))expect(events.has(observation.observation.eventId)).toBe(true);
  }
  expect(result?.bodyAcceptance).toBe('blocked');
},120000);
