import { afterEach,expect,it,vi } from 'vitest';
import { skipPrivate } from '../../test-private-data';
import { REFINED_ADMISSION_ID,REFINED_CANDIDATE_FILE,REFINED_ADMISSION_DIRECTORY,resolveRefinedHarnessPaths,runRefinedAdmissionHarness } from './root-refined-harness';
import type { RefinedHarnessCandidate,RefinedHarnessPorts } from './root-refined-harness';
import type { RefinedRootDiagnosticResult } from './root-diagnostic';
import type { SequenceSource } from './types';
import type { BodyGeometry,SemanticSequence } from './contact-types';

// A runtime compiler import or source loader in the helper is always forbidden here.
vi.mock('./root-diagnostic',()=>{throw new Error('Real v3 compiler forbidden in harness offline tests');});
vi.mock('./private-fixture',()=>{throw new Error('Real saved-source preparation forbidden in harness offline tests');});
afterEach(()=>vi.restoreAllMocks());
async function nodeCwd(){
  const moduleName='node:process';return (await import(/* @vite-ignore */ moduleName) as {cwd:()=>string}).cwd();
}
async function setup(){
  const cwd=await nodeCwd(),paths=await resolveRefinedHarnessPaths(cwd),files=new Map<string,string>(),writes:string[]=[];
  const candidate:RefinedHarnessCandidate={sourceDigest:'toy-digest',verification:{originalResultSha256:'old-result',originalAdmissionMarkerSha256:'old-claim',candidateCodeHashes:{'web/toy.ts':'toy-code'}}};
  const original='.superpowers/sdd/2026-10-21-root-feasibility-correction/phase4-single-admission/';
  files.set(paths.file('web/package.json'),JSON.stringify({name:'timepitch-web'}));files.set(paths.file(REFINED_CANDIDATE_FILE),JSON.stringify(candidate));
  files.set(paths.file(original+'result.json'),'old-result');files.set(paths.file(original+'admission.json'),'old-claim');files.set(paths.file('web/toy.ts'),'toy-code');
  const result={profile:'historical-root-diagnostic-3',policy:'physical-refined-1',status:'unavailable',reason:'controlled-rejection',bodyAcceptance:'blocked'} as RefinedRootDiagnosticResult;
  const prepare=vi.fn(async()=>({source:{rawDigest:'toy-digest'} as SequenceSource,semantics:{} as SemanticSequence,geometry:{} as BodyGeometry}));
  const compile=vi.fn(()=>result);
  const ports:RefinedHarnessPorts={admissionId:REFINED_ADMISSION_ID,cwd,hash:s=>s,prepare,compile,
    readFileSync:p=>{if(!files.has(p))throw new Error('Unexpected file read');return files.get(p)!;},
    writeFileSync:(p,s,o)=>{expect(o.flag).toBe('wx');if(files.has(p))throw Object.assign(new Error('EEXIST'),{code:'EEXIST'});files.set(p,s);writes.push(p);}};
  return {paths,files,writes,ports,result,prepare,compile};
}
it('paths_are_native_disk_paths_under_jsdom_instead_of_module_urls',async()=>{
  const cwd=await nodeCwd(),paths=await resolveRefinedHarnessPaths(cwd);
  expect(paths.file('web/package.json')).not.toMatch(/^(https?|file):\/\//);
  expect(paths.root.replaceAll('\\','/')).toBe(cwd.replaceAll('\\','/').replace(/\/web$/,''));
  expect((await resolveRefinedHarnessPaths(paths.root)).root).toBe(paths.root);
  expect(()=>paths.file('../outside')).toThrow();
});
it('offline_transaction_persists_rejection_once_and_retains_cumulative_history',async()=>{
  const t=await setup(),result=await runRefinedAdmissionHarness(t.ports);
  expect(result).toBe(t.result);expect(t.prepare).toHaveBeenCalledTimes(1);expect(t.compile).toHaveBeenCalledTimes(1);
  const marker=t.paths.file(REFINED_ADMISSION_DIRECTORY+'admission.json'),output=t.paths.file(REFINED_ADMISSION_DIRECTORY+'result.json');
  expect(t.writes).toEqual([marker,output]);expect(JSON.parse(t.files.get(marker)!)).toMatchObject({consumedBefore:1,cumulativeMaximum:2,retries:0});
  expect(JSON.parse(t.files.get(output)!)).toMatchObject({id:REFINED_ADMISSION_ID,error:null,result:{reason:'controlled-rejection'}});
});
it('missing_authority_and_wrong_hash_or_source_fail_before_any_claim_or_compile',async()=>{
  for(const mode of ['authority','code','source','root'] as const){
    const t=await setup();let ports=t.ports;
    if(mode==='authority')ports={...ports,admissionId:undefined};
    if(mode==='code')t.files.set(t.paths.file('web/toy.ts'),'changed');
    if(mode==='source')t.prepare.mockResolvedValue({...await t.prepare(),source:{rawDigest:'foreign'} as SequenceSource});
    if(mode==='root')t.files.set(t.paths.file('web/package.json'),JSON.stringify({name:'foreign'}));
    await expect(runRefinedAdmissionHarness(ports)).rejects.toThrow();expect(t.writes).toEqual([]);expect(t.compile).not.toHaveBeenCalled();
  }
});
it('an_existing_claim_blocks_the_compiler_without_replacing_prior_files',async()=>{
  const t=await setup(),marker=t.paths.file(REFINED_ADMISSION_DIRECTORY+'admission.json');t.files.set(marker,'retained-claim');
  await expect(runRefinedAdmissionHarness(t.ports)).rejects.toThrow('EEXIST');expect(t.files.get(marker)).toBe('retained-claim');expect(t.writes).toEqual([]);expect(t.compile).not.toHaveBeenCalled();
});
it('compiler_exception_is_persisted_then_rethrown_without_a_retry',async()=>{
  const t=await setup();t.compile.mockImplementation(()=>{throw new Error('controlled exception');});
  await expect(runRefinedAdmissionHarness(t.ports)).rejects.toThrow('controlled exception');expect(t.compile).toHaveBeenCalledTimes(1);
  const output=t.paths.file(REFINED_ADMISSION_DIRECTORY+'result.json');expect(JSON.parse(t.files.get(output)!)).toMatchObject({error:'Error: controlled exception'});expect(t.writes).toHaveLength(2);
});
it('actual_candidate_and_prior_files_are_readable_in_jsdom_with_memory_only_admission_writes',async()=>{
  const cwd=await nodeCwd(),paths=await resolveRefinedHarnessPaths(cwd),fsName='node:fs',cryptoName='node:crypto';
  const fs=await import(/* @vite-ignore */ fsName) as {readFileSync:(p:string,e:'utf8')=>string;existsSync:(p:string)=>boolean};
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
  const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex'),read=(p:string)=>fs.readFileSync(paths.file(p),'utf8');
  for(const p of ['research/design-evaluation/2026-10-21-body-contact-correction/phase4-refined-integration.json',REFINED_CANDIDATE_FILE])if(!fs.existsSync(paths.file(p)))skipPrivate(p);
  const previous=JSON.parse(read('research/design-evaluation/2026-10-21-body-contact-correction/phase4-refined-integration.json')) as RefinedHarnessCandidate;
  // Preserve the original seal. Read the separate real successor; only harness code may differ.
  const candidate=JSON.parse(read(REFINED_CANDIDATE_FILE)) as RefinedHarnessCandidate,entry='web/src/match-centre/sequence/root-refined-acceptance.test.ts';
  for(const [name,expected] of Object.entries(previous.verification.candidateCodeHashes)){
    if(name!==entry)expect(hash(read(name)),name).toBe(expected);
  }
  const memory=new Map<string,string>(),compile=vi.fn(()=>({status:'unavailable',reason:'offline-double-only'} as RefinedRootDiagnosticResult));
  const marker=paths.file(REFINED_ADMISSION_DIRECTORY+'admission.json'),output=paths.file(REFINED_ADMISSION_DIRECTORY+'result.json');
  expect(fs.existsSync(marker)).toBe(false);expect(fs.existsSync(output)).toBe(false);
  const result=await runRefinedAdmissionHarness({admissionId:REFINED_ADMISSION_ID,cwd,hash,
    readFileSync:fs.readFileSync,
    writeFileSync:(path,text,o)=>{expect(o.flag).toBe('wx');if(memory.has(path))throw new Error('EEXIST');memory.set(path,text);},
    prepare:async()=>({source:{rawDigest:candidate.sourceDigest} as SequenceSource,semantics:{} as SemanticSequence,geometry:{} as BodyGeometry}),compile});
  expect(result.reason).toBe('offline-double-only');expect(compile).toHaveBeenCalledTimes(1);expect([...memory.keys()]).toEqual([marker,output]);
  expect(fs.existsSync(marker)).toBe(false);expect(fs.existsSync(output)).toBe(false);
});
