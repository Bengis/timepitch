import type { SequenceSource } from './types';
import type { SemanticSequence,BodyGeometry } from './contact-types';
import type { RefinedRootDiagnosticResult } from './root-diagnostic';

export const REFINED_ADMISSION_ID='TP173-root-refined-diagnostic-2';
export const REFINED_CANDIDATE_FILE='research/design-evaluation/2026-10-21-body-contact-correction/refined-harness-offline-check.json';
export const REFINED_ADMISSION_DIRECTORY='.superpowers/sdd/2026-10-21-root-grid-and-acceptance/phase4-refined-single-admission/';
export type RefinedHarnessCandidate=Readonly<{sourceDigest:string;verification:{originalResultSha256:string;originalAdmissionMarkerSha256:string;candidateCodeHashes:Record<string,string>}}>;
export type RefinedHarnessPorts=Readonly<{
  admissionId:string|undefined;cwd:string;
  readFileSync:(path:string,encoding:'utf8')=>string;
  writeFileSync:(path:string,text:string,options:{flag:'wx'})=>void;
  hash:(text:string)=>string;
  prepare:()=>Promise<{source:SequenceSource;semantics:SemanticSequence;geometry:BodyGeometry}>;
  compile:(source:SequenceSource,semantics:SemanticSequence,geometry:BodyGeometry)=>RefinedRootDiagnosticResult;
}>;
export async function resolveRefinedHarnessPaths(cwd:string):Promise<{root:string;file:(relative:string)=>string}>{
  const moduleName='node:path';
  const path=await import(/* @vite-ignore */ moduleName) as {resolve:(...parts:string[])=>string;basename:(p:string)=>string;relative:(a:string,b:string)=>string;isAbsolute:(p:string)=>boolean};
  const root=path.basename(cwd)==='web'?path.resolve(cwd,'..'):path.resolve(cwd);
  return {root,file:relative=>{
    const file=path.resolve(root,relative),within=path.relative(root,file);
    if(path.isAbsolute(relative)||within==='..'||within.startsWith('../')||within.startsWith('..\\')||path.isAbsolute(within))throw new Error('Harness path outside repository');
    return file;
  }};
}
/** Node test harness only; the unit tests supply memory writes and a compiler double. */
export async function runRefinedAdmissionHarness(ports:RefinedHarnessPorts):Promise<RefinedRootDiagnosticResult>{
  if(ports.admissionId!==REFINED_ADMISSION_ID)throw new Error('Separate explicit authorisation of cumulative maximum2 required');
  const {file}=await resolveRefinedHarnessPaths(ports.cwd),read=(path:string)=>ports.readFileSync(file(path),'utf8');
  if(JSON.parse(read('web/package.json')).name!=='timepitch-web')throw new Error('Invalid TimePitch repository root');
  const candidate=JSON.parse(read(REFINED_CANDIDATE_FILE)) as RefinedHarnessCandidate;
  const check=(path:string,expected:string)=>{if(ports.hash(read(path))!==expected)throw new Error(`Harness hash mismatch: ${path}`);};
  const previous='.superpowers/sdd/2026-10-21-root-feasibility-correction/phase4-single-admission/';
  check(previous+'result.json',candidate.verification.originalResultSha256);
  check(previous+'admission.json',candidate.verification.originalAdmissionMarkerSha256);
  for(const [path,sha256] of Object.entries(candidate.verification.candidateCodeHashes))check(path,sha256);
  const {source,semantics,geometry}=await ports.prepare();
  if(source.rawDigest!==candidate.sourceDigest)throw new Error('Harness source digest mismatch');
  const startedAt=new Date().toISOString(),id=REFINED_ADMISSION_ID;
  ports.writeFileSync(file(REFINED_ADMISSION_DIRECTORY+'admission.json'),JSON.stringify({id,startedAt,consumedBefore:1,cumulativeMaximum:2,retries:0,
    sourceDigest:source.rawDigest,policy:'physical-refined-1',grid:'root-time-grid-1',maxGapMs:500})+'\n',{flag:'wx'});
  let result:RefinedRootDiagnosticResult|undefined,error:string|null=null;const start=performance.now();
  try {
    result=ports.compile(source,semantics,geometry); // One call, no fallback or continuation.
    return result;
  }catch(e){error=String(e);throw e;}
  finally {
    ports.writeFileSync(file(REFINED_ADMISSION_DIRECTORY+'result.json'),JSON.stringify({id,startedAt,elapsedMs:performance.now()-start,error,
      sourceDigest:source.rawDigest,geometrySha256:ports.hash(JSON.stringify(geometry)),result},null,2)+'\n',{flag:'wx'});
  }
}
