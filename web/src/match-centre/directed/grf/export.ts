import type { DirectedContact, DirectedEvidenceBundle, DirectedExecutionProfile, ObservedDirectedEvent } from '../control-types';
import type { DirectedCandidate, DirectedIssue, DirectedPlayerSample, DirectedRequest, DirectedSample, OptionalMotionValue, Unavailable } from '../types';
import { inspectDirectedCandidate } from '../candidate';
import { checkDirectedProfile, controlKeys } from '../job';
import { CONTROL_IDS, activeAt, ensure, finite, hash, ownJson, point, record, text, unavailable } from '../validation';

/** Field sets emitted by `Director::Export` in native-1 (bound to the patch text by test_directed_grf_export.py). */
export const GRF_NATIVE_EXPORT_VERSION='grf-directed-native-export-1';
export const GRF_NATIVE_REVISION='directed-grf-native-1';
export const GRF_WORLD_TRANSFORM='grf-world-110x72-canonical-105x68-v1';
const EXPORT_KEYS=['version','patchRevision','status','reason','acceptance','executionMode','profileJson','initialPacketUtf8','nativeEpochMs',
  'sourceStartMs','physicalTicks','actors','commands','contacts','samples','bodyIntervals','historicalTracking'];
const CONTACT_KEYS=['eventId','actorEngineId','nativeMs','relativeMs','bodyPart','function','role','ballNative','ballVelocityAfterNative',
  'animationTargetNative','animationTargetAuthority','bodySurface'];
const SAMPLE_KEYS=['tick','nativeMs','homeGoals','awayGoals','ballNative','ballVelocityNative','players'];
const TICK_MS=10;

type ControlId=typeof CONTROL_IDS[number];
/** TP180 control rows: what this reader verifies from a native export, or the explicit code that keeps it unsupported. */
export const GRF_EXPORT_CONTROL_COVERAGE:Readonly<Record<ControlId,Readonly<{status:'tested'|'unsupported';code:string}>>>={
  identities_active:{status:'tested',code:'export_actor_mapping'},
  units:{status:'tested',code:'world_basis'},
  physical_clock:{status:'tested',code:'export_sample_clock'},
  initial_state:{status:'tested',code:'export_initial_binding'},
  possession:{status:'unsupported',code:'ball_owner_not_exported'},
  actor_targets:{status:'tested',code:'contact_identity'},
  explicit_pass_recipient:{status:'tested',code:'native_next_contact_opponent'},
  cross_header:{status:'unsupported',code:'body_surface_not_exported'},
  save_block_recovery:{status:'unsupported',code:'observed_outcome_unverifiable'},
  prescribed_shot_outcome:{status:'tested',code:'native_no_goal'},
  event_time_between_ticks:{status:'unsupported',code:'candidate_clip_end_off_grid'},
  state_export:{status:'tested',code:'export_fields'},
  isolation_rng:{status:'tested',code:'export_seed_binding'},
  teardown:{status:'unsupported',code:'teardown_not_in_native_export'},
  render_dependency:{status:'tested',code:'export_body_surface_contract'},
};

type Xyz={x:number;y:number;z:number};
const int=(v:unknown,min=0):v is number=>Number.isSafeInteger(v) && (v as number)>=min;
function xyz(v:unknown):Xyz {controlKeys(v,['x','y','z'],'export_vector');ensure(finite(v.x) && finite(v.y) && finite(v.z),'export_vector');return v as Xyz;}
/** Registered fixed world basis (G2): +X canonical +X, +Y toward canonical top. No team-local mirroring. */
const canonicalPosition=(v:Xyz)=>({x:(v.x+55)*105/110,y:(36-v.y)*68/72});
const canonicalVelocity=(v:Xyz)=>({x:v.x*105/110,y:(0-v.y)*68/72});
function same(a:unknown,b:unknown):boolean {
  if(Array.isArray(a))return Array.isArray(b) && a.length===b.length && a.every((v,i)=>same(v,b[i]));
  if(record(a))return record(b) && !Array.isArray(b) && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>Object.hasOwn(b,k) && same(a[k],b[k]));
  return a===b;
}
function parse(raw:unknown,code:string):Record<string,unknown> {
  ensure(typeof raw==='string','export_packet_text');
  let value:unknown;
  try{value=JSON.parse(raw);}catch{throw new Error(code);}
  ensure(record(value),code);return value;
}
const absent=(reason:string):OptionalMotionValue<never>=>({value:null,provenance:'unavailable',reason});
const observed=<T,>(value:T):OptionalMotionValue<T>=>({value,provenance:'engine_output',reason:null});

/**
 * Read a `grf-directed-native-export-1` capture as declared evidence. Never executes, authenticates or accepts a run.
 * Input envelope: `{version:'grf-directed-export-read-1',receipt:{id,sha256},export}`; the receipt is a declaration
 * that the G1 audit still reports as unauthenticated. Observed events come only from native contacts and goal counters,
 * never from queued (desired) commands.
 */
export function readDirectedGrfExport(input:unknown,request:DirectedRequest,profile:DirectedExecutionProfile):DirectedEvidenceBundle|Unavailable {
  try {
    const env=ownJson(input),r=ownJson(request),p=ownJson(profile);
    controlKeys(env,['version','receipt','export'],'export_envelope');
    ensure(env.version==='grf-directed-export-read-1','export_envelope');
    controlKeys(env.receipt,['id','sha256'],'export_receipt');
    ensure(text(env.receipt.id) && hash(env.receipt.sha256),'export_receipt');
    ensure(r && r.version==='directed-request-1' && hash(r.requestDigest) && r.backend==='grf','request_identity');
    checkDirectedProfile(p,r);
    ensure(p.transformId===GRF_WORLD_TRANSFORM,'world_basis');
    ensure(p.directorRevision===GRF_NATIVE_REVISION,'native_revision');
    ensure(p.clock.kind==='fixed_10ms' && p.clock.maxStepMs===TICK_MS,'physical_clock');
    const x=env.export;
    controlKeys(x,EXPORT_KEYS,'export_fields');
    ensure(x.version===GRF_NATIVE_EXPORT_VERSION && x.patchRevision===GRF_NATIVE_REVISION && x.patchRevision===p.directorRevision,'export_identity');
    ensure(x.acceptance==='not_assessed' && x.executionMode==='disabled' && x.historicalTracking===false && x.bodyIntervals===null,'export_authority');
    ensure(x.status!=='unavailable','native_capture_unavailable');
    ensure((x.status==='captured' && x.reason==='') || (x.status==='failed' && text(x.reason)),'export_status');
    ensure(same(parse(x.profileJson,'export_profile_json'),p),'export_build_identity');
    const initial=parse(x.initialPacketUtf8,'export_initial_binding');
    ensure(initial.seed===p.seed,'export_seed_binding');
    ensure(same(initial.profile,p),'export_initial_binding');
    controlKeys(initial.clock,['startSourceMs','tickMs','totalTicks'],'export_initial_binding');
    const total=initial.clock.totalTicks,clipMs=r.clip.toMs-r.clip.fromMs,aligned=clipMs%TICK_MS===0;
    ensure(initial.clock.startSourceMs===r.clip.fromMs && initial.clock.tickMs===TICK_MS && int(total,1),'export_initial_binding');
    // An aligned clip fixes the tick count; an off-grid clip has no host schedule, so its count stays unbound (blocked below).
    ensure(!aligned || total===clipMs/TICK_MS,'export_initial_binding');
    ensure(record(initial.initialState) && initial.initialState.sourceMs===r.clip.fromMs && initial.initialState.period===r.clip.period,'export_initial_binding');
    ensure(record(initial.nativeOptions) && initial.nativeOptions.initialStatePolicy==='grf-directed-cold-start-1','export_initial_binding');
    ensure(x.sourceStartMs===r.clip.fromMs && int(x.nativeEpochMs) && int(x.physicalTicks) && x.physicalTicks<=total,'export_clock');
    const epoch=x.nativeEpochMs as number,ticks=x.physicalTicks as number;

    // Identity: one stable mapping, exactly the roster active at the clip start.
    const roster=new Map(r.roster.map(v=>[v.playerKey,v]));
    const active=r.roster.filter(v=>activeAt(v,r.clip.period,r.clip.fromMs));
    ensure(Array.isArray(x.actors) && x.actors.length===active.length,'export_actor_mapping');
    const keyOf=new Map<string,string>();
    for(const a of x.actors){
      controlKeys(a,['playerKey','engineId'],'export_actor_mapping');
      const known=typeof a.playerKey==='string'?roster.get(a.playerKey):undefined;
      ensure(known && known.engineId===a.engineId && active.includes(known) && !keyOf.has(a.engineId),'export_actor_mapping');
      keyOf.set(a.engineId,a.playerKey as string);
    }
    const engineIds=[...keyOf.keys()];
    // The initial packet must have been lowered for exactly these actors, in this order.
    ensure(Array.isArray(initial.nativePlayers) && initial.nativePlayers.length===engineIds.length
      && initial.nativePlayers.every((v,i)=>record(v) && v.engineId===engineIds[i] && v.playerKey===keyOf.get(engineIds[i])),'export_initial_binding');

    // Samples: native clock only; goal counters are cumulative engine state.
    ensure(Array.isArray(x.samples) && x.samples.length===ticks+1,'export_sample_clock');
    let home=0,away=0;
    const samples=x.samples.map((s,index)=>{
      controlKeys(s,SAMPLE_KEYS,'export_sample_fields');
      ensure(s.tick===index && s.nativeMs===epoch+index*TICK_MS,'export_sample_clock');
      ensure(int(s.homeGoals) && int(s.awayGoals) && s.homeGoals>=home && s.awayGoals>=away,'export_goal_counter');
      home=s.homeGoals as number;away=s.awayGoals as number;
      ensure(Array.isArray(s.players) && s.players.length===engineIds.length,'export_sample_players');
      const players=s.players.map((v,i)=>{
        controlKeys(v,['engineId','positionNative','velocityNative'],'export_sample_players');
        ensure(v.engineId===engineIds[i],'export_sample_players');
        return {engineId:v.engineId as string,position:xyz(v.positionNative),velocity:xyz(v.velocityNative)};
      });
      return {tick:index,homeGoals:home,awayGoals:away,ball:xyz(s.ballNative),ballVelocity:xyz(s.ballVelocityNative),players};
    });

    // Contacts: the native touch callback, not a body surface; animation targets are never geometry.
    ensure(Array.isArray(x.contacts),'export_contact_fields');
    let previous=0;
    const raw=x.contacts.map(c=>{
      controlKeys(c,CONTACT_KEYS,'export_contact_fields');
      ensure(typeof c.eventId==='string' && (c.eventId==='' || r.events.some(e=>e.id===c.eventId)),'export_contact_event');
      ensure(typeof c.actorEngineId==='string' && keyOf.has(c.actorEngineId),'export_contact_actor');
      ensure(int(c.relativeMs) && c.nativeMs===epoch+(c.relativeMs as number) && (c.relativeMs as number)%TICK_MS===0
        && (c.relativeMs as number)<=ticks*TICK_MS && (c.relativeMs as number)>=previous,'export_contact_clock');
      previous=c.relativeMs as number;
      ensure(c.animationTargetAuthority==='animation_target_not_body_surface' && c.bodySurface===null,'export_body_surface_contract');
      ensure(typeof c.bodyPart==='string' && Number.isSafeInteger(c.function) && Number.isSafeInteger(c.role),'export_contact_fields');
      xyz(c.ballNative);xyz(c.ballVelocityAfterNative);xyz(c.animationTargetNative);
      return {eventId:c.eventId as string,actor:c.actorEngineId as string,ms:c.relativeMs as number,body:c.bodyPart as string};
    });

    // Commands are retained input only: checked for binding, never read as results.
    ensure(Array.isArray(x.commands),'export_command_binding');
    const commandIds=new Set<string>(),flags:{eventId:string;dispatched:boolean;contactObserved:boolean}[]=[];
    for(const c of x.commands){
      controlKeys(c,['eventId','inputPacketUtf8','dispatched','contactObserved'],'export_command_binding');
      ensure(typeof c.eventId==='string' && r.events.some(e=>e.id===c.eventId) && !commandIds.has(c.eventId)
        && typeof c.dispatched==='boolean' && typeof c.contactObserved==='boolean','export_command_binding');
      commandIds.add(c.eventId);flags.push({eventId:c.eventId,dispatched:c.dispatched as boolean,contactObserved:c.contactObserved as boolean});
      ensure(parse(c.inputPacketUtf8,'export_command_binding').eventId===c.eventId,'export_command_binding');
    }

    const issues:DirectedIssue[]=[];
    const gap=(code:string,refs:readonly string[]=[])=>issues.push({code,refs:[...refs]});
    // Blockers withhold the candidate; they are appended to the issues after the gaps.
    const blockers:DirectedIssue[]=[];
    const block=(code:string,refs:readonly string[]=[])=>blockers.push({code,refs:[...refs]});
    if(!aligned)block('candidate_initial_ticks_unbound',[r.clip.id,String(total)]);
    if(x.status==='failed')gap('native_capture_failed',[x.reason as string]);
    const channels=new Set(p.availableChannels);
    for(const channel of ['pose','direction','body_intervals'] as const)if(channels.has(channel))gap('profile_channel_not_exported',[channel]);
    gap('ball_owner_not_exported',[GRF_NATIVE_EXPORT_VERSION]);
    gap('body_surface_not_exported',[GRF_NATIVE_EXPORT_VERSION]);
    gap('sampled_positions_not_interval_evidence',[GRF_NATIVE_EXPORT_VERSION]);
    for(const level of ['root','node','body'])gap(`${level}_interval_evidence_unavailable`,[GRF_NATIVE_EXPORT_VERSION]);
    gap('teardown_not_in_native_export',[GRF_NATIVE_EXPORT_VERSION]);

    // Source observations: preserve statuses; a conflict without its recorded diagnosis is new and blocks.
    for(const snapshot of r.evidence.snapshots)for(const row of snapshot.rows){
      const who=row.playerKey??`source:${row.sourceId}`;
      if(row.status==='usable')gap('usable_observation_not_bound',[snapshot.eventId,who,...row.refs]);
      else if(row.status==='conflict' && !r.evidence.issues.some(i=>i.eventId===snapshot.eventId && i.playerKey===row.playerKey && i.code===row.reason))
      {gap('source_conflict_unhandled',[snapshot.eventId,who,...row.refs]);block('candidate_source_conflict_unhandled',[snapshot.eventId,who]);}
    }

    // Native-side command flags must agree with the tagged contacts actually exported.
    for(const f of flags){
      const tagged=raw.some(c=>c.eventId===f.eventId);
      if(f.contactObserved!==tagged || (tagged && !f.dispatched)){
        gap('native_command_contact_flag_inconsistent',[f.eventId,`dispatched:${f.dispatched}`,`contactObserved:${f.contactObserved}`,`taggedContact:${tagged}`]);
        block('candidate_native_command_flags_inconsistent',[f.eventId]);
      }
    }

    const contactsEnabled=channels.has('contacts');
    if(!contactsEnabled)gap('profile_channel_contacts_unavailable');
    // One tagged contact per event: several are ambiguous and none of them is read as the event's observation.
    const ambiguous=new Set(raw.filter((c,i)=>c.eventId!=='' && raw.findIndex(v=>v.eventId===c.eventId)!==i).map(c=>c.eventId));
    for(const id of ambiguous){
      gap('native_event_contact_ambiguous',[id,...raw.filter(c=>c.eventId===id).map(c=>`${c.actor}@${c.ms}`)]);
      block('candidate_event_contact_ambiguous',[id]);
    }
    const directed=contactsEnabled?raw.filter(c=>c.eventId!=='' && !ambiguous.has(c.eventId)):[];
    const contacts:DirectedContact[]=directed.map(c=>({eventId:c.eventId,actorId:keyOf.get(c.actor)!,engineId:c.actor,period:r.clip.period,
      sourceMs:r.clip.fromMs+c.ms,physicalMs:c.ms,geometry:null}));
    for(const c of directed){
      const e=r.events.find(v=>v.id===c.eventId)!,keeper=r.evidence.actions.find(a=>a.eventId===e.id)?.keeper;
      const required=e.bodyPart??keeper?.bodyPart??null;
      if(required!==null && required!==c.body){gap('native_effector_mismatch',[e.id,...e.refs,c.body]);block('candidate_effector_not_observed',[e.id,...e.refs,c.body]);}
    }

    // Observed events: actor/time from the event's own native contact; receiver from the next touch by another player;
    // outcome only where native evidence can name it. Unnameable outcomes stay unavailable rather than echoed.
    const side=(engineId:string)=>engineId.split(':')[0];
    const goalsBefore=(ms:number)=>samples[Math.max(0,ms/TICK_MS-1)];
    const goalTotal=(s:{homeGoals:number;awayGoals:number})=>s.homeGoals+s.awayGoals;
    const events:ObservedDirectedEvent[]=[];
    for(const e of r.events){
      const c=directed.find(v=>v.eventId===e.id);if(!c)continue;
      const refs=[e.id,...e.refs];
      let recipient:string|null=null,outcome:string|null=null;
      if(e.kind==='Pass'){
        const next=raw.find(v=>v.ms>=c.ms && raw.indexOf(v)>raw.indexOf(c) && v.actor!==c.actor);
        if(!next){gap('observed_recipient_unavailable',refs);continue;}
        recipient=next.actor;
        if(e.outcome!==null){gap('observed_outcome_unverifiable',refs);continue;}
        outcome=side(next.actor)===side(c.actor)?null:'native_next_contact_opponent';
      } else {
        if(e.recipientId!==null){gap('observed_recipient_unavailable',refs);continue;}
        if(e.kind==='Shot'){
          // Attribution window: from the tick before this contact to the tick before the next native touch (any player).
          // A counter change after that touch cannot be credited to this shot from goal counters alone.
          const next=raw.find(v=>raw.indexOf(v)>raw.indexOf(c));
          const before=goalsBefore(c.ms),last=samples[samples.length-1],after=next?goalsBefore(next.ms):last,own=side(c.actor)==='home';
          const scored=own?after.homeGoals>before.homeGoals:after.awayGoals>before.awayGoals;
          const conceded=own?after.awayGoals>before.awayGoals:after.homeGoals>before.homeGoals;
          if(scored)outcome='Goal';
          else if(conceded)outcome='native_opponent_goal';
          else if(goalTotal(last)>goalTotal(after)){gap('native_goal_attribution_ambiguous',[...refs,`${next!.actor}@${next!.ms}`]);continue;}
          else if(e.outcome==='Goal')outcome='native_no_goal';
          else {gap('observed_outcome_unverifiable',refs);continue;}
        } else if(e.outcome!==null){gap('observed_outcome_unverifiable',refs);continue;}
      }
      events.push({eventId:e.id,period:r.clip.period,sourceMs:r.clip.fromMs+c.ms,physicalMs:c.ms,actorId:keyOf.get(c.actor)!,engineActorId:c.actor,
        recipientId:recipient===null?null:keyOf.get(recipient)!,engineRecipientId:recipient,outcome});
    }

    // Candidate: only a complete, native-observed capture. Results are copied from observations, never from commands.
    let candidate:DirectedCandidate|null=null;
    if(!aligned)block('candidate_clip_end_off_grid',[r.clip.id]);
    else if(ticks*TICK_MS!==r.clip.toMs-r.clip.fromMs)block('candidate_capture_incomplete',[r.clip.id]);
    if(x.status!=='captured')block('candidate_native_capture_failed',[x.reason as string]);
    const matches=events.length===r.events.length && r.events.every((e,i)=>events[i].eventId===e.id && events[i].actorId===e.actorId
      && events[i].recipientId===e.recipientId && events[i].outcome===e.outcome && events[i].sourceMs===e.elapsedMs);
    if(!matches)block('candidate_event_results_not_observed');
    const outside=samples.filter(s=>!point(canonicalPosition(s.ball)) || s.players.some(v=>!point(canonicalPosition(v.position)))).map(s=>String(s.tick));
    if(outside.length)block('candidate_sample_outside_canonical_pitch',outside.slice(0,20));
    if(samples.some(s=>s.ball.z<0))block('candidate_negative_ball_height');
    if(!blockers.length){
      const built:DirectedCandidate={version:'directed-candidate-1',requestDigest:r.requestDigest,backend:'grf',backendRevision:r.backendRevision,
        directorRevision:p.directorRevision,provenance:'synthetic_motion',units:'metres',
        clock:{basis:'physical_source_offset',sourceStartMs:r.clip.fromMs,physicalStartMs:0,rate:1},receipt:env.receipt as {id:string;sha256:string},
        samples:samples.map((s):DirectedSample=>({period:r.clip.period,sourceMs:r.clip.fromMs+s.tick*TICK_MS,physicalMs:s.tick*TICK_MS,
          players:s.players.map((v):DirectedPlayerSample=>({playerKey:keyOf.get(v.engineId)!,engineId:v.engineId,active:true,position:canonicalPosition(v.position),
            velocity:channels.has('velocity')?observed(canonicalVelocity(v.velocity)):absent('channel_not_in_profile'),
            direction:absent('not_exported_by_native_1'),pose:absent('not_exported_by_native_1')})),
          // ownerId null means "not exported by native-1" (ball_owner_not_exported), never an observed loose ball.
          ball:{position:canonicalPosition(s.ball),height:channels.has('height')?observed(s.ball.z):absent('channel_not_in_profile'),ownerId:null}})),
        eventResults:events.map(e=>({eventId:e.eventId,actorId:e.actorId,recipientId:e.recipientId,outcome:e.outcome,sourceMs:e.sourceMs})),
        checks:{root:{status:'blocked',reason:'continuous_interval_evidence_unavailable'},node:{status:'blocked',reason:'independent_node_evidence_unavailable'},
          body:{status:'blocked',reason:'body_surface_not_exported'}}};
      const inspection=inspectDirectedCandidate(built,r);
      if(inspection.status==='structurally_valid')candidate=inspection.candidate;
      else block('candidate_structurally_invalid',inspection.issues.map(i=>i.code));
    }
    issues.push(...blockers);
    return ownJson({version:'directed-evidence-1',requestDigest:r.requestDigest,profile:p,candidate,receipt:env.receipt as {id:string;sha256:string},units:'metres',
      clock:{sourceStartMs:r.clip.fromMs,physicalStartMs:0,rate:1},identities:(x.actors as {playerKey:string;engineId:string}[]).map(a=>({playerKey:a.playerKey,engineId:a.engineId})),
      events,contacts,intervalEvidence:{root:null,node:null,body:null},unavailable:issues} satisfies DirectedEvidenceBundle);
  } catch(error) {return unavailable(error);}
}
