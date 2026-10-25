import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import literal from '../../../../backend/tests/fixtures/directed-job-1.json';
import { prepareDirectedJob, scheduleDirectedEvents } from './job';
import { clone } from './test-fixtures';
import type { DirectedJob } from './control-types';

const fixture=()=>clone(literal) as unknown as DirectedJob;
beforeEach(async()=>{const name='node:crypto';const {webcrypto}=await import(/* @vite-ignore */ name);vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>vi.unstubAllGlobals());
const prepare=(j=fixture())=>prepareDirectedJob(j.request,j.profile,j.initialState);

it('prepares the exact Unicode/fractional cross-language literal without granting execution',async()=>{
  const input=fixture(),before=JSON.stringify(input),result=await prepare(input);
  expect(result.status).toBe('prepared');if(result.status!=='prepared')return;
  expect(result.job).toEqual(input);expect(JSON.stringify(input)).toBe(before);
  expect(Object.isFrozen(result.job.initialState.players[0].position.value)).toBe(true);
  expect(result.job.profile.executionMode).toBe('disabled');expect('run' in result.job).toBe(false);
  const {requestDigest,...payload}=result.job.request;
  expect(result.job.requestPayloadUtf8).toBe(JSON.stringify(payload));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(result.job.requestPayloadUtf8));
  expect(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')).toBe(requestDigest);
});
it('preserves exact event/alias times, raw unverified height and excluded conflict metadata',()=>{
  const j=fixture(),commands=scheduleDirectedEvents(j.request);
  expect(commands).toEqual(j.schedule);expect(commands[0].alias!.deltaMs).toBe(-.5);
  expect(commands[2].event.elapsedMs+commands[2].event.durationMs!).toBe(j.request.clip.toMs+.325);
  expect(commands[2].evidence!.shot).toMatchObject({rawEndHeight:1.3,endHeightMetres:null,endHeightUnit:'unverified'});
  expect(j.request.evidence.snapshots[0].rows[0].status).toBe('conflict');
});
it.each(['digest','event_mutation','revision','backend','mode','inventory','clock','channel','duplicate_initial','foreign_initial','inactive_initial','unavailable_position','nonfinite','unknown_owner','missing_cache','missing_refs','duplicate_action'])(
  'rejects incompatible preparation %s without fallback',async kind=>{
    const j=fixture() as any;
    if(kind==='digest')j.request.requestDigest='f'.repeat(64);
    if(kind==='event_mutation')j.request.events[2].outcome='Saved';
    if(kind==='revision')j.profile.engineRevision='other';
    if(kind==='backend')j.profile.backend='touchlines';
    if(kind==='mode')j.profile.executionMode='enabled';
    if(kind==='inventory')j.profile.sourceInventorySha256='';
    if(kind==='clock')j.profile.clock.maxStepMs=0;
    if(kind==='channel')j.profile.availableChannels.push('unknown');
    if(kind==='duplicate_initial')j.initialState.players[1]=clone(j.initialState.players[0]);
    if(kind==='foreign_initial')j.initialState.players[0].engineId='foreign';
    if(kind==='inactive_initial')j.initialState.sourceMs+=1;
    if(kind==='unavailable_position')j.initialState.players[0].position={value:null,provenance:'unavailable',reason:'not_known',refs:[]};
    if(kind==='nonfinite')j.initialState.players[0].velocity.value.x=Infinity;
    if(kind==='unknown_owner')j.initialState.ball.ownerId.value='foreign';
    if(kind==='missing_cache')delete j.initialState.caches;
    if(kind==='missing_refs')j.initialState.players[0].position.refs=[];
    if(kind==='duplicate_action')j.request.evidence.actions.push(clone(j.request.evidence.actions[0]));
    expect((await prepare(j)).status).toBe('unavailable');
  });
it('owns every input before the digest await and retains boundary warnings',async()=>{
  let release!:(value:ArrayBuffer)=>void;
  vi.stubGlobal('crypto',{subtle:{digest:()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;})}});
  const j=fixture() as any,pending=prepare(j);expect(typeof release).toBe('function');
  j.request.events[0].start.x=90;j.profile.seed=99;j.initialState.players[0].position.value.x=99;
  release(Uint8Array.from(literal.request.requestDigest.match(/../g)!,b=>parseInt(b,16)).buffer);
  const r=await pending;expect(r.status).toBe('prepared');if(r.status!=='prepared')return;
  expect(r.job.request.events[0].start!.x).toBe(12);expect(r.job.profile.seed).toBe(42);
  expect(r.job.initialState.players[0].position.value!.x).toBe(12);
  expect(r.job.request.boundaryIssues).toEqual([{code:'action_end_beyond_clip',refs:['shot']}]);
});
it('fails closed without crypto and never loads an engine or fetches data',async()=>{
  const fetch=vi.fn(()=>{throw new Error('Forbidden network');});vi.stubGlobal('fetch',fetch);
  vi.stubGlobal('crypto',{});expect((await prepare()).status).toBe('unavailable');
  expect(fetch).not.toHaveBeenCalled();expect(()=>scheduleDirectedEvents(null as any)).toThrow();
});
it('keeps the G1 runtime graph within pure directed-contract modules',async()=>{
  const fsName='node:fs',pathName='node:path',processName='node:process';
  const fs=await import(/* @vite-ignore */ fsName),path=await import(/* @vite-ignore */ pathName),process=await import(/* @vite-ignore */ processName);
  for(const name of ['job.ts','evidence-audit.ts']){
    const code:string=fs.readFileSync(path.resolve(process.cwd(),'src/match-centre/directed',name),'utf8');
    const imports=[...code.matchAll(/^import (?!type\b).*?from ['"]([^'"]+)['"]/gm)].map(m=>m[1]);
    expect(imports.every(p=>['./validation','./request','./candidate','./job'].includes(p))).toBe(true);
    expect(code).not.toMatch(/\b(import\s*\(|fetch\s*\(|eval\s*\(|new Function\b)/);
  }
});
