import type { DirectedBackend, DirectedCapabilityReport, DirectedIdentity, DirectedIssue, DirectedRequestPayload, DirectedRequestResult, DirectedSource, Unavailable } from './types';
import { activeAt, CONTROL_IDS, ensure, finite, hash, ownJson, point, record, text, unavailable } from './validation';

export function readDirectedCapabilities(input: unknown): {status:'capabilities_ready'; report:DirectedCapabilityReport} | Unavailable {
  try {
    const value=ownJson(input);
    ensure(record(value) && value.version==='directed-engine-capabilities-1' && hash(value.sourceDigest) && hash(value.evidenceDigest),'capability_identity');
    ensure(record(value.inventory) && Array.isArray(value.engines) && value.engines.length===2,'capability_engines');
    const backends=new Set<string>();
    for(const engine of value.engines){
      ensure(record(engine) && (engine.backend==='grf'||engine.backend==='touchlines') && !backends.has(engine.backend) && text(engine.revision),'capability_backend');
      backends.add(engine.backend);ensure(engine.executionAvailable===false && engine.measured===false,'capability_not_measured');
      ensure(Array.isArray(engine.capabilities) && engine.capabilities.length===CONTROL_IDS.length,'capability_controls');
      const ids=new Set<string>();
      for(const row of engine.capabilities){
        ensure(record(row) && text(row.id) && (CONTROL_IDS as readonly string[]).includes(row.id) && !ids.has(row.id),'capability_control');ids.add(row.id);
        ensure(['source_inspected','requires_extension','unsupported','unknown'].includes(row.state as string) && text(row.finding),'capability_state');
        ensure(row.state==='source_inspected'?row.requiredChange===null:text(row.requiredChange),'capability_change');
        ensure(Array.isArray(row.evidence) && row.evidence.length>0,'capability_evidence');
        for(const ref of row.evidence){
          ensure(record(ref) && text(ref.file) && hash(ref.sha256) && text(ref.symbol),'capability_reference');
          const file=value.inventory[ref.file];ensure(record(file) && file.sha256===ref.sha256,'capability_file_hash');
          ensure(Array.isArray(ref.lines) && ref.lines.length===2 && ref.lines.every(Number.isInteger) && ref.lines[0]>0 && ref.lines[1]>=ref.lines[0],'capability_lines');
        }
      }
    }
    return {status:'capabilities_ready',report:value as unknown as DirectedCapabilityReport};
  } catch(error){return unavailable(error);}
}
export async function buildDirectedRequest(source: DirectedSource, roster: readonly DirectedIdentity[], capabilities: DirectedCapabilityReport,
  backend: DirectedBackend): Promise<DirectedRequestResult> {
  try {
    // Snapshot everything synchronously; callers cannot change content while digest is pending.
    const s=ownJson(source),people=ownJson(roster),caps=readDirectedCapabilities(capabilities);
    ensure(caps.status==='capabilities_ready','invalid_capabilities');const report=caps.report;
    const selected=report.engines.find(e=>e.backend===backend);ensure(selected,'unknown_backend');
    ensure(s?.identity?.source==='historical' && /^[1-9][0-9]*$/.test(s.identity.id) && text(s.identity.revision) && text(s.motionRevision),'source_identity');
    ensure(hash(s.rawDigest) && s.rawDigest===report.sourceDigest && s.performanceEvidence?.evidenceDigest===report.evidenceDigest,'source_digest');
    const c=s.request,ev=s.performanceEvidence;
    ensure(c && c.id==='ayew-equaliser-1' && c.period===1 && finite(c.fromMs) && finite(c.toMs) && c.fromMs>=0 && c.toMs>c.fromMs,'source_clip');
    ensure(s.key===JSON.stringify([s.identity,s.motionRevision,s.rawDigest,s.request]) && ev.sourceKey===s.key && ev.version==='sequence-performance-evidence-1','source_key');
    ensure(Array.isArray(people) && people.length>0 && Array.isArray(s.events) && s.events.length>0 && Array.isArray(s.aliases) && Array.isArray(s.cuts),'source_records');
    const ids=new Map<string,DirectedIdentity>(),sourceIds=new Set<number>(),engineIds=new Set<string>();
    for(const p of people){
      ensure(Number.isInteger(p.sourceId) && p.sourceId>0 && p.playerKey===`historical:statsbomb:${p.sourceId}` && text(p.engineId) && text(p.teamKey)
        && ['home','away'].includes(p.side) && !ids.has(p.playerKey) && !sourceIds.has(p.sourceId) && !engineIds.has(p.engineId),'roster_identity');
      ensure(Array.isArray(p.activeIntervals) && p.activeIntervals.length>0,'roster_activity');
      for(let i=0;i<p.activeIntervals.length;i++){const a=p.activeIntervals[i];
        ensure(Number.isInteger(a.period) && a.period>0 && finite(a.fromMs) && finite(a.toMs) && a.fromMs>=0 && a.toMs>=a.fromMs,'roster_interval');
        ensure(!p.activeIntervals.slice(0,i).some((b:DirectedIdentity['activeIntervals'][number])=>a.period===b.period && a.fromMs<=b.toMs && b.fromMs<=a.toMs),'roster_interval_overlap');}
      ids.set(p.playerKey,p);sourceIds.add(p.sourceId);engineIds.add(p.engineId);
    }
    const events=new Map(s.events.map(e=>[e.id,e]));ensure(events.size===s.events.length && new Set(s.events.map(e=>e.sourceIndex)).size===s.events.length,'event_duplicate');
    const boundaryIssues:DirectedIssue[]=[];
    function participant(id:string|null,ms:number){if(id!==null){const p=ids.get(id);ensure(p && activeAt(p,c.period,ms),'event_participant');} }
    for(let i=0;i<s.events.length;i++){const e=s.events[i];
      ensure(text(e.id) && text(e.kind) && Number.isInteger(e.sourceIndex) && e.sourceIndex>=0 && e.period===c.period && finite(e.periodMs) && finite(e.elapsedMs)
        && e.periodMs===e.elapsedMs && e.elapsedMs>=c.fromMs && e.elapsedMs<=c.toMs,'event_time');
      const previous=s.events[i-1];ensure(!previous || previous.elapsedMs<e.elapsedMs || previous.elapsedMs===e.elapsedMs && previous.sourceIndex<e.sourceIndex,'event_order');
      ensure(Array.isArray(e.refs) && e.refs.length>0 && e.refs.every(text) && Array.isArray(e.relatedIds) && e.relatedIds.every(text),'event_refs');
      ensure(e.start===null||point(e.start),'event_point');ensure(e.end===null||point(e.end),'event_point');
      ensure(e.durationMs===null || finite(e.durationMs) && e.durationMs>=0,'event_duration');
      ensure(e.outcome===null||text(e.outcome),'event_outcome');ensure(e.xg===null||finite(e.xg)&&e.xg>=0&&e.xg<=1,'event_xg');
      ensure([null,'head','left_foot','right_foot'].includes(e.bodyPart),'event_body_part');
      if(['Carry','Pass','Shot'].includes(e.kind))ensure(e.actorId!==null,'missing_actor');
      // An unsuccessful pass may have no recorded receiver. A successful recorded pass may not lose it.
      if(e.kind==='Pass' && e.outcome===null)ensure(e.recipientId!==null,'missing_recipient');
      participant(e.actorId,e.elapsedMs);participant(e.recipientId,e.elapsedMs);
      if(e.actorId!==null)ensure(e.side===ids.get(e.actorId)!.side,'event_team');
      if(e.kind==='Pass' && e.recipientId!==null)ensure(e.side===ids.get(e.recipientId)!.side,'recipient_team');
      if(['Carry','Pass','Shot'].includes(e.kind) && e.durationMs!==null){
        const end=e.elapsedMs+e.durationMs;ensure(finite(end),'event_end');
        if(end>c.toMs)boundaryIssues.push({code:'action_end_beyond_clip',refs:e.refs});
      }
    }
    const aliasEvents=new Set<string>();
    for(const a of s.aliases){const from=events.get(a.eventId),to=events.get(a.nextEventId);
      ensure(from && to && !aliasEvents.has(a.eventId) && from.durationMs!==null,'alias_event');aliasEvents.add(a.eventId);
      ensure(a.sourceEndMs===from.elapsedMs+from.durationMs && a.presentationEndMs===to.elapsedMs && a.deltaMs===a.presentationEndMs-a.sourceEndMs && Math.abs(a.deltaMs)<=1,'alias_time');
      ensure(a.kind===(from.kind==='Pass'?'pass_receipt':from.kind==='Carry'?'carry_handoff':null) && Array.isArray(a.refs)&&a.refs.every(text),'alias_kind');
      ensure(to.elapsedMs>from.elapsedMs && from.relatedIds.includes(to.id) && to.side===from.side
        && to.actorId===(from.kind==='Carry'?from.actorId:from.recipientId) && (from.kind!=='Pass'||to.kind==='Ball Receipt*')
        && from.end && to.start && Math.hypot(from.end.x-to.start.x,from.end.y-to.start.y)<=1e-6,'alias_consistency');
    }
    ensure(Array.isArray(ev.actions) && Array.isArray(ev.snapshots) && Array.isArray(ev.issues),'evidence_records');
    for(const a of ev.actions){const event=events.get(a.eventId);ensure(event && a.elapsedMs===event.elapsedMs && a.actorId===event.actorId,'evidence_action');
      if(a.shot)ensure(a.shot.endHeightUnit==='unverified' && a.shot.endHeightMetres===null && (a.shot.rawEndHeight===null||finite(a.shot.rawEndHeight)),'evidence_height');}
    for(const snapshot of ev.snapshots){const event=events.get(snapshot.eventId);
      ensure(event && snapshot.period===event.period && snapshot.periodMs===event.periodMs && snapshot.elapsedMs===event.elapsedMs && Array.isArray(snapshot.rows),'evidence_snapshot');
      for(const row of snapshot.rows){ensure(['usable','conflict','unresolved'].includes(row.status) && (row.point===null||point(row.point)) && (row.eventPoint===null||point(row.eventPoint)),'evidence_row');
        if(row.playerKey!==null){const p=ids.get(row.playerKey);ensure(p && p.sourceId===row.sourceId && activeAt(p,snapshot.period,snapshot.elapsedMs),'evidence_player');}
        else ensure(row.status==='unresolved','evidence_unresolved');
        if(row.status==='conflict')ensure(text(row.reason) && finite(row.discrepancyM) && row.discrepancyM>0 && row.point && row.eventPoint,'evidence_conflict');
      }
    }
    const payload=ownJson<DirectedRequestPayload>({version:'directed-request-1',backend,backendRevision:selected.revision,executionAvailable:false,
      sourceKey:s.key,sourceDigest:s.rawDigest,evidenceDigest:ev.evidenceDigest,sourceIdentity:s.identity,motionRevision:s.motionRevision,clip:c,
      events:s.events,evidence:ev,roster:people,aliases:s.aliases,cuts:s.cuts,
      policy:{version:'directed-physical-1',playerSpeedMps:9,playerAccelerationMps2:4,ballGroundSpeedMps:45,contactM:.08,stanceM:.03,rootClearanceM:.5},capabilities:report,boundaryIssues});
    ensure(globalThis.crypto?.subtle?.digest,'crypto_unavailable');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
    ensure(bytes.byteLength===32,'invalid_digest');
    const requestDigest=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    return {status:'request_ready',request:ownJson({...payload,requestDigest})};
  } catch(error){return unavailable(error);}
}
