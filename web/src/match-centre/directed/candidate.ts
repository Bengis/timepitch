import type { DirectedCandidate, DirectedCandidateInspection, DirectedRequest } from './types';
import { activeAt, ensure, finite, hash, ownJson, point, record, text, unavailable } from './validation';

function keys(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  ensure(record(value) && Object.keys(value).length===expected.length && expected.every(k=>Object.hasOwn(value,k)),code);
}
function optional(value: unknown, valid: (v: unknown)=>boolean): void {
  keys(value,['value','provenance','reason'],'motion_value');
  if(value.value===null) ensure(value.provenance==='unavailable' && text(value.reason),'motion_absence');
  else ensure((value.provenance==='engine_output' || value.provenance==='view_inferred') && value.reason===null && valid(value.value),'motion_value');
}

/** Structural compatibility only: neither a receipt nor claimed checks authenticate or accept motion. */
export function inspectDirectedCandidate(input: unknown, request: DirectedRequest): DirectedCandidateInspection {
  try {
    const c=ownJson(input);
    keys(c,['version','requestDigest','backend','backendRevision','directorRevision','provenance','units','clock','receipt','samples','eventResults','checks'],'candidate_fields');
    ensure(request.version==='directed-request-1' && hash(request.requestDigest),'request_identity');
    ensure(c.version==='directed-candidate-1' && c.requestDigest===request.requestDigest && c.backend===request.backend && c.backendRevision===request.backendRevision,'candidate_identity');
    ensure(text(c.directorRevision) && c.provenance==='synthetic_motion' && c.units==='metres','candidate_provenance');
    keys(c.clock,['basis','sourceStartMs','physicalStartMs','rate'],'clock_fields');
    ensure(c.clock.basis==='physical_source_offset' && c.clock.sourceStartMs===request.clip.fromMs && finite(c.clock.physicalStartMs) && c.clock.physicalStartMs>=0 && c.clock.rate===1,'physical_clock');
    keys(c.receipt,['id','sha256'],'receipt_fields');
    ensure(text(c.receipt.id) && hash(c.receipt.sha256),'receipt_identity');
    ensure(Array.isArray(c.samples) && c.samples.length>=2,'samples');
    let previousSource=-Infinity, previousPhysical=-Infinity;
    for(const sample of c.samples) {
      keys(sample,['period','sourceMs','physicalMs','players','ball'],'sample_fields');
      ensure(sample.period===request.clip.period && finite(sample.sourceMs) && finite(sample.physicalMs),'sample_time');
      ensure(sample.sourceMs>=request.clip.fromMs && sample.sourceMs<=request.clip.toMs && sample.sourceMs>previousSource && sample.physicalMs>previousPhysical,'sample_order');
      ensure(sample.sourceMs===c.clock.sourceStartMs+(sample.physicalMs-c.clock.physicalStartMs),'sample_clock');
      previousSource=sample.sourceMs;previousPhysical=sample.physicalMs;
      const active=request.roster.filter(p=>activeAt(p,sample.period as number,sample.sourceMs as number));
      ensure(Array.isArray(sample.players) && sample.players.length===active.length,'active_roster');
      const seen=new Set<string>();
      for(const player of sample.players) {
        keys(player,['playerKey','engineId','active','position','velocity','direction','pose'],'player_fields');
        ensure(text(player.playerKey) && !seen.has(player.playerKey),'player_identity');
        const identity=active.find(p=>p.playerKey===player.playerKey);
        ensure(identity && identity.engineId===player.engineId && player.active===true && point(player.position),'player_identity');
        seen.add(player.playerKey);
        optional(player.velocity,v=>record(v) && Object.keys(v).length===2 && finite(v.x) && finite(v.y));
        optional(player.direction,finite);
        optional(player.pose,v=>record(v) && Object.values(v).every(finite));
      }
      keys(sample.ball,['position','height','ownerId'],'ball_fields');
      ensure(point(sample.ball.position) && (sample.ball.ownerId===null || (text(sample.ball.ownerId) && seen.has(sample.ball.ownerId))),'ball_identity');
      optional(sample.ball.height,v=>finite(v) && v>=0);
    }
    ensure(c.samples[0].sourceMs===request.clip.fromMs && c.samples[c.samples.length-1].sourceMs===request.clip.toMs,'clip_coverage');
    ensure(Array.isArray(c.eventResults) && c.eventResults.length===request.events.length,'event_results');
    c.eventResults.forEach((result: unknown,index: number)=>{
      keys(result,['eventId','actorId','recipientId','outcome','sourceMs'],'event_fields');
      const event=request.events[index];
      ensure(result.eventId===event.id && result.actorId===event.actorId && result.recipientId===event.recipientId && result.outcome===event.outcome && result.sourceMs===event.elapsedMs,'historical_event');
    });
    keys(c.checks,['root','node','body'],'physical_checks');
    for(const check of Object.values(c.checks)) {
      keys(check,['status','reason'],'check_fields');
      ensure(['not_run','blocked','passed','failed'].includes(check.status as string),'check_status');
      ensure(check.status==='passed'?check.reason===null:text(check.reason),'check_reason');
    }
    return {status:'structurally_valid',candidate:c as unknown as DirectedCandidate,acceptance:'not_assessed'};
  } catch(error) { return unavailable(error); }
}
