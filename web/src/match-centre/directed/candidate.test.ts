import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildDirectedRequest } from './request';
import { inspectDirectedCandidate } from './candidate';
import { candidate, capabilities, clone, FROM, identities, source } from './test-fixtures';
import type { DirectedRequest } from './types';

let request: DirectedRequest;
beforeEach(async()=>{
  const name='node:crypto';const {webcrypto}=await import(/* @vite-ignore */ name);vi.stubGlobal('crypto',webcrypto);
  const result=await buildDirectedRequest(source(),identities(),capabilities(),'grf');
  if(result.status!=='request_ready')throw new Error('Request fixture failed');request=result.request;
});
afterEach(()=>vi.unstubAllGlobals());

it('owns a structurally valid literal without accepting its claimed physical checks',()=>{
  const input=candidate(request),before=JSON.stringify(input),result=inspectDirectedCandidate(input,request);
  expect(result.status).toBe('structurally_valid');if(result.status!=='structurally_valid')return;
  expect(result.acceptance).toBe('not_assessed');expect(result.candidate.samples[0].ball.height).toEqual({value:null,provenance:'unavailable',reason:'not_exported'});
  expect(Object.isFrozen(result.candidate.samples[0].players[0].position)).toBe(true);
  expect(JSON.stringify(input)).toBe(before);(input.samples[0].players[0].position as any).x=99;
  expect(result.candidate.samples[0].players[0].position.x).toBe(12);
  const claimed=clone(candidate(request)) as any;for(const check of Object.values(claimed.checks) as any[]){check.status='passed';check.reason=null;}
  const r=inspectDirectedCandidate(claimed,request);expect(r.status).toBe('structurally_valid');if(r.status==='structurally_valid')expect(r.acceptance).toBe('not_assessed');
});
it.each(['backend','revision','digest','units','roster','duplicate_player','inactive','missing_player','nonfinite','field','reversed','duplicate_time','clock','rate','period','actor','receiver','outcome','event_time','event_missing','event_duplicate','missing_check','accepted_flag','old_v2','height','pose','receipt','extra_score'])(
  'rejects incompatible %s while preserving request identity',kind=>{
    const c=clone(candidate(request)) as any;
    if(kind==='backend')c.backend='touchlines';
    if(kind==='revision')c.backendRevision='other';
    if(kind==='digest')c.requestDigest='f'.repeat(64);
    if(kind==='units')c.units='pixels';
    if(kind==='roster')c.samples[0].players[0].engineId='foreign';
    if(kind==='duplicate_player')c.samples[0].players[1]=clone(c.samples[0].players[0]);
    if(kind==='inactive')c.samples[0].players[0].active=false;
    if(kind==='missing_player')c.samples[0].players.pop();
    if(kind==='nonfinite')c.samples[0].ball.position.x=Infinity;
    if(kind==='field')c.samples[0].players[0].position.y=69;
    if(kind==='reversed')c.samples.reverse();
    if(kind==='duplicate_time')c.samples[1]=clone(c.samples[0]);
    if(kind==='clock')c.samples[1].physicalMs+=1;
    if(kind==='rate')c.clock.rate=18;
    if(kind==='period')c.samples[0].period=2;
    if(kind==='actor')c.eventResults[0].actorId=c.eventResults[0].recipientId;
    if(kind==='receiver')c.eventResults[0].recipientId=null;
    if(kind==='outcome')c.eventResults[2].outcome='Saved';
    if(kind==='event_time')c.eventResults[0].sourceMs+=.325;
    if(kind==='event_missing')c.eventResults.pop();
    if(kind==='event_duplicate')c.eventResults[1]=clone(c.eventResults[0]);
    if(kind==='missing_check')delete c.checks.body;
    if(kind==='accepted_flag')c.accepted=true;
    if(kind==='old_v2'){c.version='sequence-depiction-2';delete c.receipt;}
    if(kind==='height')c.samples[0].ball.height={value:null,provenance:'engine_output',reason:null};
    if(kind==='pose')c.samples[0].players[0].pose={value:{head:NaN},provenance:'view_inferred',reason:null};
    if(kind==='receipt')c.receipt.sha256='';
    if(kind==='extra_score')c.score={home:99,away:0};
    expect(inspectDirectedCandidate(c,request).status).toBe('unavailable');
  });
it('preserves explicit absent pose and permits finite signed velocity without certifying physics',()=>{
  const c=clone(candidate(request)) as any;c.samples[0].players[0].velocity={value:{x:-1,y:2},provenance:'engine_output',reason:null};
  expect(inspectDirectedCandidate(c,request).status).toBe('structurally_valid');
});
it('checks ownership against active historical IDs and guards non-JSON inputs',()=>{
  const c=clone(candidate(request)) as any;c.samples[0].ball.ownerId='foreign';expect(inspectDirectedCandidate(c,request).status).toBe('unavailable');
  expect(inspectDirectedCandidate(null,request).status).toBe('unavailable');
  c.samples[0].sourceMs=FROM-1;expect(inspectDirectedCandidate(c,request).status).toBe('unavailable');
});
