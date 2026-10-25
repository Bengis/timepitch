import type { DirectedAudit, DirectedEvidenceBundle } from './control-types';
import type { DirectedIssue, DirectedRequest } from './types';
import { inspectDirectedCandidate } from './candidate';
import { checkDirectedProfile, controlKeys, isDirectedVector3 } from './job';
import { activeAt, ensure, finite, hash, ownJson, text } from './validation';

/** Recompute contradictions/residuals from declarations; never attest a run or certify continuous physics. */
export function auditDirectedEvidence(request:DirectedRequest,bundle:DirectedEvidenceBundle):DirectedAudit {
  const issues:DirectedIssue[]=[],contacts:{eventId:string;surfaceErrorM:number|null;timeErrorMs:number}[]=[];
  const observations: {usable:number;diagnosedConflicts:{eventId:string;playerKey:string|null;refs:readonly string[]}[];unresolved:number}={usable:0,diagnosedConflicts:[],unresolved:0};
  let failed=false,nodeFailed=false,rootFailed=false,boundaryIssues:readonly DirectedIssue[]=[];
  const issue=(code:string,refs:readonly string[]=[],failure=false)=>{issues.push({code,refs});failed ||= failure;};
  try {
    const r=ownJson(request),b=ownJson(bundle);
    ensure(r && hash(r.requestDigest),'request_identity');
    controlKeys(b,['version','requestDigest','profile','candidate','receipt','units','clock','identities','events','contacts','intervalEvidence','unavailable'],'evidence_fields');
    ensure(b.version==='directed-evidence-1' && b.requestDigest===r.requestDigest && b.units==='metres','evidence_identity');
    checkDirectedProfile(b.profile,r);
    boundaryIssues=r.boundaryIssues;
    for(const snapshot of r.evidence.snapshots)for(const row of snapshot.rows){
      if(row.status==='usable')observations.usable++;
      else if(row.status==='conflict')observations.diagnosedConflicts.push({eventId:snapshot.eventId,playerKey:row.playerKey,refs:row.refs});
      else observations.unresolved++;
    }
    // This is not a new approval of an observation policy: preserve statuses, never impose a conflict as a target.
    if(observations.diagnosedConflicts.length)issue('source_conflict_diagnosed');
    if(observations.unresolved)issue('source_observation_unresolved');
    controlKeys(b.clock,['sourceStartMs','physicalStartMs','rate'],'evidence_clock');
    ensure(b.clock.sourceStartMs===r.clip.fromMs && finite(b.clock.physicalStartMs) && b.clock.physicalStartMs>=0 && b.clock.rate===1,'evidence_clock');
    const sourceAt=(physical:unknown,source:unknown)=>finite(physical) && finite(source) && source===b.clock.sourceStartMs+(physical-b.clock.physicalStartMs);
    controlKeys(b.receipt,['id','sha256'],'evidence_receipt');
    ensure(text(b.receipt.id) && hash(b.receipt.sha256),'evidence_receipt');
    issue('execution_receipt_not_authenticated');
    if(b.profile.artifactSha256===null)issue('artifact_unavailable');
    ensure(Array.isArray(b.identities) && b.identities.length===r.roster.length,'evidence_roster');
    const mapped=new Map(r.roster.map(p=>[p.playerKey,p]));
    const identitySeen=new Set<string>();
    for(const p of b.identities){controlKeys(p,['playerKey','engineId'],'evidence_player');
      ensure(text(p.playerKey) && !identitySeen.has(p.playerKey) && mapped.get(p.playerKey)?.engineId===p.engineId,'evidence_player');identitySeen.add(p.playerKey);}
    if(b.candidate===null)issue('candidate_unavailable');
    else {
      const checked=inspectDirectedCandidate(b.candidate,r);
      if(checked.status!=='structurally_valid'){issue('candidate_incompatible',[],true);nodeFailed=true;}
      else {
        ensure(checked.candidate.directorRevision===b.profile.directorRevision && checked.candidate.receipt.id===b.receipt.id && checked.candidate.receipt.sha256===b.receipt.sha256,'candidate_receipt');
        ensure(checked.candidate.clock.sourceStartMs===b.clock.sourceStartMs && checked.candidate.clock.physicalStartMs===b.clock.physicalStartMs && checked.candidate.clock.rate===b.clock.rate,'candidate_clock');
      }
    }
    ensure(Array.isArray(b.events) && Array.isArray(b.contacts) && Array.isArray(b.unavailable),'evidence_records');
    const seen=new Set<string>();let previousEventIndex=-1;
    for(const e of b.events){
      controlKeys(e,['eventId','period','sourceMs','physicalMs','actorId','engineActorId','recipientId','engineRecipientId','outcome'],'observed_event_fields');
      ensure(text(e.eventId) && !seen.has(e.eventId),'observed_event_duplicate');seen.add(e.eventId);
      const source=r.events.find(v=>v.id===e.eventId);ensure(source,'observed_event_reference');
      const index=r.events.indexOf(source);ensure(index>previousEventIndex,'observed_event_order');previousEventIndex=index;
      if(!sourceAt(e.physicalMs,e.sourceMs)){issue('observed_clock_mismatch',source.refs,true);rootFailed=true;}
      if(e.period!==source.period || e.sourceMs!==source.elapsedMs || e.actorId!==source.actorId || e.recipientId!==source.recipientId || e.outcome!==source.outcome){issue('observed_event_mismatch',source.refs,true);nodeFailed=true;}
      for(const [id,native] of [[e.actorId,e.engineActorId],[e.recipientId,e.engineRecipientId]]){
        const p=typeof id==='string'?mapped.get(id):null;
        if(id===null?native!==null:!p || native!==p.engineId || !activeAt(p,source.period,source.elapsedMs)){issue('observed_identity_mismatch',source.refs,true);nodeFailed=true;}
      }
    }
    for(const e of r.events)if(!seen.has(e.id))issue('observed_event_unavailable',e.refs);
    const seenContacts=new Set<string>();
    for(const c of b.contacts){
      controlKeys(c,['eventId','actorId','engineId','period','sourceMs','physicalMs','geometry'],'contact_fields');
      ensure(text(c.eventId) && !seenContacts.has(c.eventId),'contact_duplicate');seenContacts.add(c.eventId);
      const source=r.events.find(e=>e.id===c.eventId),p=typeof c.actorId==='string'?mapped.get(c.actorId):null;
      ensure(source && p && source.actorId===c.actorId && p.engineId===c.engineId && activeAt(p,source.period,source.elapsedMs),'contact_identity');
      ensure(finite(c.sourceMs) && finite(c.physicalMs),'contact_time');
      const timeErrorMs=Math.max(Math.abs(c.sourceMs-source.elapsedMs),Math.abs((b.clock.sourceStartMs+(c.physicalMs-b.clock.physicalStartMs))-source.elapsedMs));
      if(c.period!==source.period || timeErrorMs!==0){issue('contact_time_mismatch',source.refs,true);nodeFailed=true;}
      let surfaceErrorM:number|null=null;
      if(c.geometry===null)issue('contact_geometry_unavailable',source.refs);
      else {
        controlKeys(c.geometry,['provenance','effector','effectorCentre','effectorRadiusM','ballCentre','ballRadiusM'],'contact_geometry');
        const g=c.geometry;
        ensure(['engine_output','view_inferred'].includes(g.provenance as string) && text(g.effector) && isDirectedVector3(g.effectorCentre) && isDirectedVector3(g.ballCentre)
          && finite(g.effectorRadiusM) && g.effectorRadiusM>=0 && finite(g.ballRadiusM) && g.ballRadiusM>0,'contact_geometry');
        if(g.provenance!=='engine_output')issue('contact_geometry_inferred',source.refs);
        else {
          surfaceErrorM=Math.abs(Math.hypot(g.ballCentre.x-g.effectorCentre.x,g.ballCentre.y-g.effectorCentre.y,g.ballCentre.z-g.effectorCentre.z)-(g.effectorRadiusM+g.ballRadiusM));
          ensure(finite(surfaceErrorM),'contact_nonfinite_residual');
          const keeper=r.evidence.actions.find(a=>a.eventId===source.id)?.keeper;
          const required=source.bodyPart??keeper?.bodyPart??null;
          if(required!==null && required!==g.effector){issue('contact_effector_mismatch',source.refs,true);nodeFailed=true;}
          if(surfaceErrorM>r.policy.contactM){issue('contact_surface_error',source.refs,true);nodeFailed=true;}
        }
      }
      contacts.push({eventId:source.id,surfaceErrorM,timeErrorMs});
    }
    for(const e of r.events)if(['Pass','Shot','Ball Receipt*','Goal Keeper','Block','Ball Recovery','Interception','Duel'].includes(e.kind) && !seenContacts.has(e.id))issue('contact_evidence_unavailable',e.refs);
    controlKeys(b.intervalEvidence,['root','node','body'],'interval_evidence');
    issue('continuous_interval_verifier_unavailable');
    issue('body_geometry_verifier_unavailable');
    for(const missing of b.unavailable){controlKeys(missing,['code','refs'],'unavailable_issue');ensure(text(missing.code) && Array.isArray(missing.refs) && missing.refs.every(text),'unavailable_issue');issues.push({code:missing.code,refs:missing.refs});}
    issues.push(...b.profile.unsupported);
  } catch(error) {issue(error instanceof Error?error.message:'invalid_evidence',[],true);}
  return ownJson({status:failed?'failed':'blocked',acceptance:'not_assessed',issues,contacts,observations,boundaryIssues,
    checks:{root:{status:rootFailed?'failed':'blocked',reason:rootFailed?'observed_clock_mismatch':'continuous_interval_verifier_unavailable'},
      node:{status:nodeFailed?'failed':'blocked',reason:nodeFailed?'observed_node_mismatch':'full_node_evidence_not_verified'},
      body:{status:'blocked',reason:'body_geometry_verifier_unavailable'}}});
}
