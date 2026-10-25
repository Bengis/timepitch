import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../sequence/root-diagnostic',()=>{throw new Error('Forbidden root compiler');});
vi.mock('../adapters/historical',()=>{throw new Error('Forbidden source loader');});
vi.mock('../adapters/grf',()=>{throw new Error('Forbidden simulation adapter');});
vi.mock('../../match/renderers/registry',()=>{throw new Error('Forbidden renderer');});
import { buildDirectedRequest } from './request';
import { inspectDirectedCandidate } from './candidate';
import { candidate, capabilities, identities, source } from './test-fixtures';

afterEach(()=>vi.unstubAllGlobals());
it('uses only owned JSON and crypto, with no loader, engine, renderer, network or graphics dependency',async()=>{
  const name='node:crypto';const {webcrypto}=await import(/* @vite-ignore */ name);vi.stubGlobal('crypto',webcrypto);
  const fetch=vi.fn(()=>{throw new Error('Forbidden network');});vi.stubGlobal('fetch',fetch);
  const s=source(),r=await buildDirectedRequest(s,identities(),capabilities(),'grf');expect(r.status).toBe('request_ready');if(r.status!=='request_ready')return;
  const result=inspectDirectedCandidate(candidate(r.request),r.request);expect(result.status).toBe('structurally_valid');
  (s as any).graphics='different-art';(s as any).frames=[{notRealTracking:true}];
  const second=await buildDirectedRequest(s,identities(),capabilities(),'grf');expect(second.status).toBe('request_ready');
  if(second.status==='request_ready')expect(second.request.requestDigest).toBe(r.request.requestDigest);
  expect(fetch).not.toHaveBeenCalled();expect('run' in r.request).toBe(false);
});
it('has a closed runtime dependency graph within the directed contract folder',async()=>{
  const fsName='node:fs',pathName='node:path';const fs=await import(/* @vite-ignore */ fsName),path=await import(/* @vite-ignore */ pathName);
  const processName='node:process';const process=await import(/* @vite-ignore */ processName);
  const base=path.resolve(process.cwd(),'src/match-centre/directed');
  for(const file of ['request.ts','candidate.ts','validation.ts']){
    const text:string=fs.readFileSync(path.join(base,file),'utf8');
    const runtime=[...text.matchAll(/^import (?!type\b).*?from ['"]([^'"]+)['"]/gm)].map(m=>m[1]);
    expect(runtime.every(p=>p==='./validation')).toBe(true);
    expect(text).not.toMatch(/\b(import\s*\(|fetch\s*\(|eval\s*\(|new Function\b)/);
  }
});
