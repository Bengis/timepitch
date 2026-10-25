import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildDirectedRequest, readDirectedCapabilities } from './request';
import { capabilities, clone, FROM, identities, source, TO } from './test-fixtures';

beforeEach(async() => {const name='node:crypto';const {webcrypto}=await import(/* @vite-ignore */ name);vi.stubGlobal('crypto',webcrypto);});
afterEach(() => vi.unstubAllGlobals());
const build = () => buildDirectedRequest(source(),identities(),capabilities(),'grf');

it('owns an immutable historical request without granting execution or changing inputs',async()=>{
  const s=source(),roster=identities(),caps=capabilities(),before=JSON.stringify({s,roster,caps});
  const result=await buildDirectedRequest(s,roster,caps,'grf');
  expect(result.status).toBe('request_ready');if(result.status!=='request_ready')return;
  expect(result.request).toMatchObject({backend:'grf',executionAvailable:false,sourceDigest:s.rawDigest,clip:s.request,
    policy:{playerSpeedMps:9,playerAccelerationMps2:4,ballGroundSpeedMps:45,contactM:.08,stanceM:.03,rootClearanceM:.5}});
  expect(result.request.requestDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.isFrozen(result.request.evidence.snapshots[0].rows[0].raw)).toBe(true);
  expect(JSON.stringify({s,roster,caps})).toBe(before);
  expect((await build()).status).toBe('request_ready');
});
it('preserves fractional time, raw height, conflict records and only retained aliases',async()=>{
  const s=source(),result=await build();expect(result.status).toBe('request_ready');if(result.status!=='request_ready')return;
  expect(result.request.events).toEqual(s.events);expect(result.request.aliases).toEqual(s.aliases);
  expect(result.request.events[2].elapsedMs+result.request.events[2].durationMs!).toBe(TO+.325);
  expect(result.request.clip.toMs).toBe(TO);
  expect(result.request.boundaryIssues).toEqual([{code:'action_end_beyond_clip',refs:['shot']}]);
  expect(result.request.evidence.actions[0].shot).toMatchObject({rawEndHeight:1.3,endHeightMetres:null,endHeightUnit:'unverified'});
  expect(result.request.evidence.snapshots[0].rows[0]).toEqual(s.performanceEvidence!.snapshots[0].rows[0]);
});
it.each(['missing_actor','missing_recipient','opponent_recipient','alias_receiver','alias_link','alias_geometry'])(
  'rejects incomplete participants or inconsistent retained metadata: %s',async kind=>{
    const s=clone(source()) as any,roster=clone(identities()) as any;
    if(kind==='missing_actor')s.events[0].actorId=null;
    if(kind==='missing_recipient')s.events[0].recipientId=null;
    if(kind==='opponent_recipient')roster[1].side='away';
    if(kind==='alias_receiver')s.events[1].actorId=s.events[0].actorId;
    if(kind==='alias_link')s.events[0].relatedIds=[];
    if(kind==='alias_geometry')s.events[1].start.x+=1;
    expect((await buildDirectedRequest(s,roster,capabilities(),'grf')).status).toBe('unavailable');
  });
it('rejects accessors in arrays without invoking caller code',async()=>{
  const s=source(),event=s.events[0],getter=vi.fn(()=>event);
  Object.defineProperty(s.events,'0',{get:getter,enumerable:true,configurable:true});
  expect((await buildDirectedRequest(s,identities(),capabilities(),'grf')).status).toBe('unavailable');
  expect(getter).not.toHaveBeenCalled();
});
it.each(['source_digest','evidence_digest','source_key','foreign_actor','foreign_receiver','duplicate_engine','duplicate_source','inactive','missing_evidence','missing_aliases','new_alias','nonfinite','wrong_period'])(
  'rejects %s rather than guessing or rewriting the source',async(kind)=>{
    const s=clone(source()) as any,roster=clone(identities()) as any;
    if(kind==='source_digest')s.rawDigest='e'.repeat(64);
    if(kind==='evidence_digest')s.performanceEvidence!.evidenceDigest='e'.repeat(64);
    if(kind==='source_key')s.key='different';
    if(kind==='foreign_actor')s.events[0].actorId='historical:statsbomb:999';
    if(kind==='foreign_receiver')s.events[0].recipientId='historical:statsbomb:999';
    if(kind==='duplicate_engine')roster[1].engineId=roster[0].engineId;
    if(kind==='duplicate_source')roster[1].sourceId=roster[0].sourceId;
    if(kind==='inactive')roster[1].activeIntervals=[];
    if(kind==='missing_evidence')delete s.performanceEvidence;
    if(kind==='missing_aliases')delete (s as any).aliases;
    if(kind==='new_alias')(s.aliases[0] as any).deltaMs=2;
    if(kind==='nonfinite')(s.events[0].start as any).x=NaN;
    if(kind==='wrong_period')(s.events[0] as any).period=2;
    expect((await buildDirectedRequest(s,roster,capabilities(),'grf')).status).toBe('unavailable');
  });
it.each(['version','duplicate_backend','ready','measured','missing_control','bad_evidence_hash'])(
  'rejects capability report %s without promoting source inspection',kind=>{
    const c=clone(capabilities()) as any;
    if(kind==='version')c.version='another';
    if(kind==='duplicate_backend')c.engines[1].backend='grf';
    if(kind==='ready')c.engines[0].capabilities[0].state='ready';
    if(kind==='measured')c.engines[0].measured=true;
    if(kind==='missing_control')c.engines[0].capabilities.pop();
    if(kind==='bad_evidence_hash')c.engines[0].capabilities[0].evidence[0].sha256='f'.repeat(64);
    expect(readDirectedCapabilities(c).status).toBe('unavailable');
  });
it('accepts both inspected backends but has no execution entry point',async()=>{
  expect(readDirectedCapabilities(capabilities()).status).toBe('capabilities_ready');
  for(const backend of ['grf','touchlines'] as const){const r=await buildDirectedRequest(source(),identities(),capabilities(),backend);
    expect(r.status).toBe('request_ready');if(r.status==='request_ready')expect(r.request.executionAvailable).toBe(false);}
});
it('binds copied content before awaiting crypto and hashes exact serialized payload',async()=>{
  let release!:(value:ArrayBuffer)=>void,bytes!:Uint8Array;
  vi.stubGlobal('crypto',{subtle:{digest:vi.fn((_algorithm,buffer)=>{bytes=new Uint8Array(buffer).slice();return new Promise<ArrayBuffer>(r=>{release=r;});})}});
  const s=source(),pending=buildDirectedRequest(s,identities(),capabilities(),'grf');
  expect(typeof release).toBe('function');(s.events[0].start as any).x=90;release(new Uint8Array(32).fill(7).buffer);
  const result=await pending;expect(result.status).toBe('request_ready');if(result.status!=='request_ready')return;
  expect(result.request.events[0].start!.x).toBe(12);
  const {requestDigest,...payload}=result.request;
  expect(new TextDecoder().decode(bytes)).toBe(JSON.stringify(payload));expect(requestDigest).toBe('07'.repeat(32));
});
it('fails closed on unavailable or rejected crypto and malformed non-JSON input',async()=>{
  vi.stubGlobal('crypto',{});expect((await build()).status).toBe('unavailable');
  vi.stubGlobal('crypto',{subtle:{digest:()=>Promise.reject(new Error('offline'))}});expect((await build()).status).toBe('unavailable');
  expect((await buildDirectedRequest(null as any,[],capabilities(),'grf')).status).toBe('unavailable');
  expect(FROM).toBeLessThan(TO);
});
