import { describe, expect, it } from 'vitest';
import literal from '../../../../../backend/tests/fixtures/directed-job-1.json';
import nativeLiteral from './native-export-controlled-literal.json';
import { auditDirectedEvidence } from '../evidence-audit';
import { inspectDirectedCandidate } from '../candidate';
import { CONTROL_IDS } from '../validation';
import { clone } from '../test-fixtures';
import type { DirectedEvidenceBundle, DirectedExecutionProfile, DirectedJob } from '../control-types';
import type { DirectedRequest, Unavailable } from '../types';
import { GRF_EXPORT_CONTROL_COVERAGE, readDirectedGrfExport } from './export';

/** Controlled literals only: the native-shape export is hand-authored, never engine output or saved-play tracking. */
const FROM=1684024;
const job=()=>clone(literal) as unknown as DirectedJob;
function pilotRequest():any { return clone(job().request); }
/** Aligned 300 ms variant, mirrored by the Python literal generator. Not the 13.826 s pilot. */
function request():any {
  const r=pilotRequest();r.clip.toMs=FROM+300;
  const shot=r.events[2];shot.elapsedMs=shot.periodMs=FROM+250;
  for(const a of r.evidence.actions)a.elapsedMs=FROM+250;
  for(const s of r.evidence.snapshots){s.elapsedMs=s.periodMs=FROM+250;}
  return r;
}
function profile():any {
  return {...clone(job().profile),directorRevision:'directed-grf-native-1',transformId:'grf-world-110x72-canonical-105x68-v1',
    artifactSha256:'d'.repeat(64),availableChannels:['positions','velocity','height','contacts']};
}
const native=()=>clone(nativeLiteral) as any;
const envelope=(x:any=native())=>({version:'grf-directed-export-read-1',receipt:{id:'controlled-export-literal',sha256:'e'.repeat(64)},export:x});
const read=(x:any=native(),r:any=request(),p:any=profile())=>readDirectedGrfExport(envelope(x),r as DirectedRequest,p as DirectedExecutionProfile);
function bundle(result:DirectedEvidenceBundle|Unavailable):DirectedEvidenceBundle {
  if('status' in result)throw new Error(`unexpected unavailable: ${JSON.stringify(result.issues)}`);
  return result;
}
const codes=(b:DirectedEvidenceBundle)=>b.unavailable.map(i=>i.code);
/** Codes some test in this file actually asserts; the TP180 coverage test (last) requires every mapped code here. */
const asserted=new Set<string>();
const seen=(code:string)=>{asserted.add(code);return code;};
/** A run under profile p embeds p both in profileJson and in the initial packet it lowered. */
function withProfile(x:any,p:any){
  x.profileJson=JSON.stringify(p);
  const i=JSON.parse(x.initialPacketUtf8);i.profile=p;x.initialPacketUtf8=JSON.stringify(i);return x;
}
/** Adds one away player to the request roster and to the literal export (actors, samples and initial native players). */
function withOpponent(r:any,x:any){
  r.roster.push({sourceId:3,playerKey:'historical:statsbomb:3',engineId:'away:3',teamKey:'team:away',side:'away',activeIntervals:[{period:1,fromMs:FROM,toMs:FROM+300}]});
  x.actors.push({playerKey:'historical:statsbomb:3',engineId:'away:3'});
  for(const s of x.samples)s.players.push({engineId:'away:3',positionNative:{x:0,y:0,z:0},velocityNative:{x:0,y:0,z:0}});
  const i=JSON.parse(x.initialPacketUtf8);
  i.nativePlayers.push({...clone(i.nativePlayers[0]),playerKey:'historical:statsbomb:3',engineId:'away:3'});
  x.initialPacketUtf8=JSON.stringify(i);
}

describe('readDirectedGrfExport',()=>{
  it('[control:state_export] reads the native-shape literal into a structurally valid candidate that the G1 audit still blocks',()=>{
    const x=native(),before=JSON.stringify(x),r=request(),b=bundle(read(x,r));
    expect(JSON.stringify(x)).toBe(before);expect(Object.isFrozen(b)).toBe(true);
    expect(b.candidate).not.toBeNull();
    expect(inspectDirectedCandidate(b.candidate,r).status).toBe('structurally_valid');
    expect(b.candidate!.samples).toHaveLength(31);
    expect(b.candidate!.samples[0].players[1].position).toEqual({x:21,y:25.5});
    expect(b.candidate!.samples[0].ball.position).toEqual({x:10.5,y:34});
    expect(b.events.map(e=>[e.eventId,e.actorId,e.recipientId,e.outcome,e.sourceMs])).toEqual(
      r.events.map((e:any)=>[e.id,e.actorId,e.recipientId,e.outcome,e.elapsedMs]));
    const audit=auditDirectedEvidence(r,b);
    expect(audit.status).toBe('blocked');expect(audit.acceptance).toBe('not_assessed');
    expect(Object.values(audit.checks).every(c=>c.status==='blocked')).toBe(true);
  });

  it.each([
    ['world_basis_profile','world_basis'],['world_basis_export','export_build_identity'],['build_artifact','export_build_identity'],
    ['engine_revision','profile_identity'],['native_revision','export_identity'],['actor_mapping','export_actor_mapping'],
    ['vector_space','export_vector'],['seed','export_seed_binding'],['source_clock','export_clock'],['sample_clock','export_sample_clock'],
    ['initial_clock','export_initial_binding'],['off_grid_contact','export_contact_clock'],['goal_counter_decrease','export_goal_counter'],
    ['body_intervals','export_authority'],['historical_tracking','export_authority'],['acceptance','export_authority'],
    ['unmapped_contact_actor','export_contact_actor'],['unknown_event','export_contact_event'],['extra_field','export_fields'],
    ['body_surface','export_body_surface_contract'],['animation_authority','export_body_surface_contract'],
    ['command_binding','export_command_binding'],['unavailable_capture','native_capture_unavailable'],['receipt','export_receipt'],
    ['profile_in_initial','export_initial_binding'],['total_ticks','export_initial_binding'],['native_players','export_initial_binding'],
    ['captured_with_reason','export_status'],['failed_without_reason','export_status'],
  ])('[control:identities_active][control:units][control:physical_clock][control:initial_state][control:isolation_rng] rejects wrong identity %s',(kind,code)=>{
    const x=native();let r=request(),p=profile();
    if(kind==='world_basis_profile'){p.transformId='grf-world-observation-normalized';withProfile(x,p);}
    if(kind==='world_basis_export')x.profileJson=JSON.stringify({...profile(),transformId:'grf-team-local-mirrored'});
    if(kind==='build_artifact')x.profileJson=JSON.stringify({...profile(),artifactSha256:'f'.repeat(64)});
    if(kind==='engine_revision'){p.engineRevision='other-grf-revision';withProfile(x,p);}
    if(kind==='native_revision')x.patchRevision='directed-grf-native-0';
    if(kind==='actor_mapping'){x.actors[0].engineId='home:2';x.actors[1].engineId='home:1';}
    if(kind==='vector_space')x.samples[3].ballNative.space='grf_team_local';
    if(kind==='seed'){const i=JSON.parse(x.initialPacketUtf8);i.seed=43;x.initialPacketUtf8=JSON.stringify(i);}
    if(kind==='source_clock')x.sourceStartMs=FROM+10;
    if(kind==='sample_clock')x.samples[4].nativeMs+=10;
    if(kind==='initial_clock'){const i=JSON.parse(x.initialPacketUtf8);i.clock.tickMs=5;x.initialPacketUtf8=JSON.stringify(i);}
    if(kind==='off_grid_contact'){x.contacts[2].relativeMs=255;x.contacts[2].nativeMs=255;}
    if(kind==='goal_counter_decrease')x.samples[30].homeGoals=0;
    if(kind==='body_intervals')x.bodyIntervals={root:{passed:true}};
    if(kind==='historical_tracking')x.historicalTracking=true;
    if(kind==='acceptance')x.acceptance='accepted';
    if(kind==='unmapped_contact_actor')x.contacts[0].actorEngineId='away:3';
    if(kind==='unknown_event')x.contacts[0].eventId='invented';
    if(kind==='extra_field')x.rendererPose={};
    if(kind==='body_surface')x.contacts[2].bodySurface={effector:'left_foot',centre:{x:0,y:0,z:0}};
    if(kind==='animation_authority')x.contacts[2].animationTargetAuthority='body_surface';
    if(kind==='command_binding'){const c=JSON.parse(x.commands[0].inputPacketUtf8);c.eventId='receipt';x.commands[0].inputPacketUtf8=JSON.stringify(c);}
    if(kind==='unavailable_capture'){x.status='unavailable';}
    const initial=(f:(i:any)=>void)=>{const i=JSON.parse(x.initialPacketUtf8);f(i);x.initialPacketUtf8=JSON.stringify(i);};
    if(kind==='profile_in_initial')initial(i=>{i.profile.artifactSha256='f'.repeat(64);});
    if(kind==='total_ticks')initial(i=>{i.clock.totalTicks=31;});
    if(kind==='native_players')initial(i=>{i.nativePlayers.reverse();});
    if(kind==='captured_with_reason')x.reason='unexpected_reason';
    if(kind==='failed_without_reason'){x.status='failed';x.reason='';}
    const env:any=envelope(x);if(kind==='receipt')env.receipt.sha256='not-a-hash';
    const result=readDirectedGrfExport(env,r,p) as Unavailable;
    expect(result.status).toBe('unavailable');expect(result.issues[0].code).toBe(seen(code));
  });

  it.each(['actor','receiver','time','goal','foreign_goal'])(
    '[control:actor_targets][control:explicit_pass_recipient][control:prescribed_shot_outcome] preserves raw %s mismatch, withholds the candidate and fails the G1 audit',kind=>{
      const x=native(),r=request();
      if(kind==='actor')x.contacts[0].actorEngineId='home:2';
      if(kind==='receiver'){withOpponent(r,x);x.contacts.splice(1,0,{...clone(x.contacts[0]),eventId:'',actorEngineId:'away:3',nativeMs:150,relativeMs:150});}
      if(kind==='time'){x.contacts[2].relativeMs=260;x.contacts[2].nativeMs=260;}
      if(kind==='goal')for(const s of x.samples)s.homeGoals=0;
      if(kind==='foreign_goal')for(const s of x.samples){s.awayGoals=s.homeGoals;s.homeGoals=0;}
      const b=bundle(read(x,r));
      expect(b.candidate).toBeNull();expect(codes(b)).toContain('candidate_event_results_not_observed');
      if(kind==='receiver')expect(b.events[0]).toMatchObject({recipientId:'historical:statsbomb:3',engineRecipientId:'away:3',outcome:seen('native_next_contact_opponent')});
      if(kind==='goal')expect(b.events[2].outcome).toBe(seen('native_no_goal'));
      if(kind==='foreign_goal')expect(b.events[2].outcome).toBe('native_opponent_goal');
      if(kind==='time')expect(b.events[2].sourceMs).toBe(FROM+260);
      const audit=auditDirectedEvidence(r,b);
      expect(audit.status).toBe('failed');
      expect(audit.issues.map(i=>i.code)).toContain(seen(kind==='actor'?'contact_identity':kind==='time'?'contact_time_mismatch':'observed_event_mismatch'));
    });

  it('[control:prescribed_shot_outcome] desired commands never populate observed events or candidate eventResults',()=>{
    const x=native(),r=request();
    const packets=x.commands.map((c:any)=>JSON.parse(c.inputPacketUtf8));
    packets[0].actorEngineId='home:2';packets[0].recipientEngineId='home:1';
    packets[2].actorEngineId='home:1';packets[2].outcomeConstraint='Saved';
    x.commands.forEach((c:any,i:number)=>{c.inputPacketUtf8=JSON.stringify(packets[i]);});
    const b=bundle(read(x,r));
    expect(b.events.map(e=>[e.eventId,e.engineActorId,e.engineRecipientId,e.outcome])).toEqual(
      [['pass','home:1','home:2',null],['receipt','home:2',null,null],['shot','home:2',null,'Goal']]);
    expect(b.candidate).not.toBeNull();
    expect(b.candidate!.eventResults.map(e=>[e.eventId,e.actorId,e.recipientId,e.outcome])).toEqual(
      r.events.map((e:any)=>[e.id,e.actorId,e.recipientId,e.outcome]));
  });

  it.each(['observed_without_contact','not_dispatched_with_contact','unobserved_with_contact'])(
    'native command flags that contradict the exported contacts withhold the candidate (%s)',kind=>{
      const x=native();
      if(kind==='observed_without_contact')x.contacts.splice(2,1);
      if(kind==='not_dispatched_with_contact')x.commands[2].dispatched=false;
      if(kind==='unobserved_with_contact')x.commands[2].contactObserved=false;
      const b=bundle(read(x));
      expect(b.candidate).toBeNull();
      expect(codes(b)).toContain('native_command_contact_flag_inconsistent');
      expect(b.unavailable).toContainEqual({code:'candidate_native_command_flags_inconsistent',refs:['shot']});
    });

  it('goal counters credit a shot only until the next native touch; a later goal is ambiguous, not Goal',()=>{
    const later=native(),r=request();withOpponent(r,later);
    later.contacts.push({...clone(later.contacts[2]),eventId:'',actorEngineId:'away:3',nativeMs:260,relativeMs:260});
    const b=bundle(read(later,r));
    expect(b.events.map(e=>e.eventId)).toEqual(['pass','receipt']);
    expect(b.unavailable).toContainEqual({code:'native_goal_attribution_ambiguous',refs:['shot','shot','away:3@260']});
    expect(b.candidate).toBeNull();
    const within=native(),r2=request();withOpponent(r2,within);
    within.contacts.push({...clone(within.contacts[2]),eventId:'',actorEngineId:'away:3',nativeMs:280,relativeMs:280});
    expect(bundle(read(within,r2)).events[2].outcome).toBe('Goal');
  });

  it('[control:save_block_recovery] a recorded non-goal outcome is unverifiable from goal counters, not inferred',()=>{
    const r=request(),x=native();r.events[2].outcome='Saved';for(const s of x.samples)s.homeGoals=0;
    const b=bundle(read(x,r));
    expect(b.events.map(e=>e.eventId)).toEqual(['pass','receipt']);
    expect(b.unavailable).toContainEqual({code:seen('observed_outcome_unverifiable'),refs:['shot','shot']});
    expect(b.candidate).toBeNull();
  });

  it('unavailable pose, direction, velocity and physical height stay null, never zero',()=>{
    const p={...profile(),availableChannels:['positions','contacts','pose']},x=withProfile(native(),p);
    const b=bundle(read(x,request(),p)),sample=b.candidate!.samples[5];
    expect(sample.ball.height).toEqual({value:null,provenance:'unavailable',reason:'channel_not_in_profile'});
    for(const player of sample.players){
      expect(player.pose).toEqual({value:null,provenance:'unavailable',reason:'not_exported_by_native_1'});
      expect(player.direction.value).toBeNull();expect(player.velocity.value).toBeNull();
    }
    expect(b.unavailable).toContainEqual({code:'profile_channel_not_exported',refs:['pose']});
    const withHeight=bundle(read()).candidate!.samples[5];
    expect(withHeight.ball.height).toEqual({value:.11,provenance:'engine_output',reason:null});
    expect(withHeight.players[0].velocity).toEqual({value:{x:0,y:0},provenance:'engine_output',reason:null});
  });

  it('[control:possession] ball owner is not exported: candidate ownerId null means "not exported", not an observed loose ball',()=>{
    // The candidate type only allows null here. Renderers and the G1 audit must read it through ball_owner_not_exported,
    // never as evidence that nobody owned the ball.
    const b=bundle(read());
    expect(b.unavailable).toContainEqual({code:seen('ball_owner_not_exported'),refs:['grf-directed-native-export-1']});
    expect(b.candidate!.samples.every(s=>s.ball.ownerId===null)).toBe(true);
  });

  it('[control:units] converts native world derivatives with the registered basis, without mirroring by team',()=>{
    const x=native();x.samples[7].players[1].velocityNative={x:2.2,y:-3.6,z:0};
    const v=bundle(read(x)).candidate!.samples[7].players[1].velocity.value!;
    expect(v.x).toBeCloseTo(2.1,12);expect(v.y).toBeCloseTo(3.4,12);
  });

  it('[control:cross_header][control:render_dependency] body and effector channels cite the native export, never the renderer or animation target',()=>{
    const x=native();x.contacts[2].bodyPart='right_foot';
    const b=bundle(read(x));
    expect(b.contacts.every(c=>c.geometry===null)).toBe(true);
    expect(codes(b)).toContain(seen('body_surface_not_exported'));
    expect(b.unavailable).toContainEqual({code:'native_effector_mismatch',refs:['shot','shot','right_foot']});
    expect(b.candidate).toBeNull();
    expect(b.unavailable).toContainEqual({code:'candidate_effector_not_observed',refs:['shot','shot','right_foot']});
    expect(codes(bundle(read()))).not.toContain('native_effector_mismatch');
    expect(JSON.stringify(b)).not.toContain('animationTarget');
    const audit=auditDirectedEvidence(request(),b);
    expect(audit.contacts.every(c=>c.surfaceErrorM===null)).toBe(true);expect(audit.checks.body.status).toBe('blocked');
  });

  it('root, node and body need independent evidence: sampled-only positions stay blocked',()=>{
    const b=bundle(read());
    expect(b.intervalEvidence).toEqual({root:null,node:null,body:null});
    expect(codes(b)).toEqual(expect.arrayContaining(['sampled_positions_not_interval_evidence','root_interval_evidence_unavailable',
      'node_interval_evidence_unavailable','body_interval_evidence_unavailable',seen('teardown_not_in_native_export')]));
    expect(Object.values(b.candidate!.checks).every(c=>c.status==='blocked')).toBe(true);
    expect(Object.values(auditDirectedEvidence(request(),b).checks).every(c=>c.status==='blocked')).toBe(true);
  });

  it('keeps the known diagnosed exclusion and accounts for all 26 usable observations',()=>{
    const r=request(),conflict=r.evidence.snapshots[0].rows[0];
    const usable=(n:number,eventId:string)=>Array.from({length:n},(_,i)=>({...clone(conflict),sourceId:100+i,playerKey:`historical:statsbomb:${eventId}-${i}`,
      status:'usable',reason:null,eventPoint:null,discrepancyM:null,refs:[eventId]}));
    r.evidence.snapshots=[{...r.evidence.snapshots[0],rows:[conflict,...usable(8,'shot')]},
      {...clone(r.evidence.snapshots[0]),eventId:'pass',rows:usable(9,'pass')},{...clone(r.evidence.snapshots[0]),eventId:'receipt',rows:usable(9,'receipt')}];
    const b=bundle(read(native(),r)),audit=auditDirectedEvidence(r,b);
    expect(r.evidence.snapshots.flatMap((s:any)=>s.rows)).toHaveLength(27);
    expect(audit.observations).toEqual({usable:26,unresolved:0,diagnosedConflicts:[{eventId:'shot',playerKey:'historical:statsbomb:1',refs:['shot']}]});
    expect(codes(b).filter(c=>c==='usable_observation_not_bound')).toHaveLength(26);
    expect(codes(b)).not.toContain('source_conflict_unhandled');
    expect(b.candidate).not.toBeNull();
  });

  it('a new conflict without the approved diagnosis stays blocked',()=>{
    const r=request();r.evidence.snapshots[0].rows.push({...clone(r.evidence.snapshots[0].rows[0]),sourceId:2,playerKey:'historical:statsbomb:2'});
    const b=bundle(read(native(),r));
    expect(b.unavailable).toContainEqual({code:'source_conflict_unhandled',refs:['shot','historical:statsbomb:2','shot']});
    expect(b.unavailable).toContainEqual({code:'candidate_source_conflict_unhandled',refs:['shot','historical:statsbomb:2']});
    expect(b.candidate).toBeNull();
  });

  it('[control:event_time_between_ticks] the 13.826 s pilot keeps its off-grid end and shot blocked, with raw native failure retained',()=>{
    const r=pilotRequest(),x=native();
    x.status='failed';x.reason='fixed_grid_contact_boundary';x.physicalTicks=0;x.samples=x.samples.slice(0,1);x.contacts=[];
    x.commands=x.commands.slice(0,2);for(const c of x.commands)c.contactObserved=false;
    const b=bundle(read(x,r));
    expect(b.candidate).toBeNull();
    expect(b.unavailable).toEqual(expect.arrayContaining([{code:'native_capture_failed',refs:['fixed_grid_contact_boundary']},
      {code:seen('candidate_clip_end_off_grid'),refs:['ayew-equaliser-1']},{code:'candidate_initial_ticks_unbound',refs:['ayew-equaliser-1','30']}]));
    const audit=auditDirectedEvidence(r,b);
    expect(audit.status).toBe('blocked');expect(audit.boundaryIssues).toEqual(r.boundaryIssues);
    expect(r.evidence.actions[0].shot.endHeightMetres).toBeNull();
  });

  it('a failed native capture keeps observed raw contacts but never becomes a candidate',()=>{
    const x=native();x.status='failed';x.reason='actual_clock_discontinuity';
    const b=bundle(read(x));
    expect(b.candidate).toBeNull();expect(b.contacts).toHaveLength(3);
    expect(b.unavailable).toContainEqual({code:'native_capture_failed',refs:['actual_clock_discontinuity']});
  });

  it.each([
    ['capture_incomplete','candidate_capture_incomplete',['ayew-equaliser-1']],
    ['outside_pitch','candidate_sample_outside_canonical_pitch',['4']],
    ['negative_height','candidate_negative_ball_height',[]],
  ])('withholds the candidate on %s',(kind,code,refs)=>{
    const x=native();
    if(kind==='capture_incomplete'){x.physicalTicks=29;x.samples=x.samples.slice(0,30);}
    if(kind==='outside_pitch')x.samples[4].ballNative.x=60;
    if(kind==='negative_height')x.samples[4].ballNative.z=-.01;
    const b=bundle(read(x));
    expect(b.candidate).toBeNull();expect(b.unavailable).toContainEqual({code,refs});
  });

  it('a profile without the contacts channel reads no contacts or events and builds no candidate',()=>{
    const p={...profile(),availableChannels:['positions','velocity','height']},b=bundle(read(withProfile(native(),p),request(),p));
    expect(codes(b)).toContain('profile_channel_contacts_unavailable');
    expect(b.contacts).toEqual([]);expect(b.events).toEqual([]);expect(b.candidate).toBeNull();
  });

  it('two native contacts tagged with the same event are ambiguous: neither is read and the G1 audit does not abort',()=>{
    const x=native(),r=request();x.contacts.push({...clone(x.contacts[2]),nativeMs:280,relativeMs:280});
    const b=bundle(read(x,r));
    expect(b.unavailable).toContainEqual({code:'native_event_contact_ambiguous',refs:['shot','home:2@250','home:2@280']});
    expect(b.unavailable).toContainEqual({code:'candidate_event_contact_ambiguous',refs:['shot']});
    expect(b.contacts.map(c=>c.eventId)).toEqual(['pass','receipt']);expect(b.events.map(e=>e.eventId)).toEqual(['pass','receipt']);
    expect(b.candidate).toBeNull();
    expect(auditDirectedEvidence(r,b).issues.map(i=>i.code)).not.toContain('contact_duplicate');
  });

  it('reports malformed input as unavailable without invoking any engine',()=>{
    expect((readDirectedGrfExport(null,request(),profile()) as Unavailable).status).toBe('unavailable');
    const x=native();x.samples[2].ballNative.x=NaN;
    expect((read(x) as Unavailable).status).toBe('unavailable');
  });

  // Must stay last: it checks codes recorded by the tests above (vitest runs a file's tests in order).
  it('maps every TP180 control row to a code that a test above actually asserts',()=>{
    expect(Object.keys(GRF_EXPORT_CONTROL_COVERAGE).sort()).toEqual([...CONTROL_IDS].sort());
    for(const [id,row] of Object.entries(GRF_EXPORT_CONTROL_COVERAGE)){
      expect(['tested','unsupported']).toContain(row.status);
      expect(asserted.has(row.code),`${id} -> ${row.code} is not asserted by any test`).toBe(true);
    }
  });
});
