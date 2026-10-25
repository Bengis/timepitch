import type { DirectedCommand, DirectedExecutionProfile, DirectedInitialState, DirectedJobResult, Vector3 } from './control-types';
import type { DirectedRequest } from './types';
import { buildDirectedRequest } from './request';
import { activeAt, ensure, finite, hash, ownJson, point, record, text, unavailable } from './validation';

export function controlKeys(value:unknown,expected:readonly string[],code:string):asserts value is Record<string,unknown> {
  ensure(record(value) && Object.keys(value).length===expected.length && expected.every(k=>Object.hasOwn(value,k)),code);
}
export const isDirectedVector3=(v:unknown):v is Vector3=>record(v) && Object.keys(v).length===3 && finite(v.x) && finite(v.y) && finite(v.z);
const position=(v:unknown)=>isDirectedVector3(v) && point(v) && v.z>=0;

/** Declaration consistency only; a profile is neither a verified build nor a permit. */
export function checkDirectedProfile(input:unknown,request:DirectedRequest):asserts input is DirectedExecutionProfile {
  controlKeys(input,['version','backend','engineRevision','directorRevision','sourceInventorySha256','artifactSha256','sourceBindingPolicySha256','seed','transformId','clock','availableChannels','unsupported','executionMode'],'profile_fields');
  ensure(input.version==='directed-profile-1' && input.backend===request.backend && input.engineRevision===request.backendRevision && text(input.directorRevision),'profile_identity');
  ensure(hash(input.sourceInventorySha256) && hash(input.sourceBindingPolicySha256) && (input.artifactSha256===null||hash(input.artifactSha256)),'profile_hash');
  ensure(input.executionMode==='disabled' && Number.isSafeInteger(input.seed) && (input.seed as number)>=0 && text(input.transformId),'profile_disabled');
  controlKeys(input.clock,['kind','maxStepMs'],'profile_clock');
  ensure(['fixed_10ms','event_subdivision'].includes(input.clock.kind as string) && finite(input.clock.maxStepMs) && input.clock.maxStepMs>0,'profile_clock');
  ensure(input.clock.kind!=='fixed_10ms'||input.clock.maxStepMs===10,'profile_clock');
  const channels=['positions','velocity','direction','height','pose','contacts','body_intervals'];
  ensure(Array.isArray(input.availableChannels) && input.availableChannels.includes('positions') && new Set(input.availableChannels).size===input.availableChannels.length && input.availableChannels.every(v=>channels.includes(v)),'profile_channels');
  ensure(Array.isArray(input.unsupported),'profile_issues');
  for(const issue of input.unsupported){controlKeys(issue,['code','refs'],'profile_issue');ensure(text(issue.code) && Array.isArray(issue.refs) && issue.refs.every(text),'profile_issue');}
}

function prior(input:unknown,valid:(v:unknown)=>boolean):unknown {
  controlKeys(input,['value','provenance','refs','reason'],'initial_prior');
  ensure(['observed','inferred'].includes(input.provenance as string) && input.reason===null && Array.isArray(input.refs) && input.refs.length>0 && input.refs.every(text) && valid(input.value),'initial_unavailable');
  return input.value;
}
function checkInitial(input:unknown,request:DirectedRequest):void {
  controlKeys(input,['version','period','sourceMs','units','players','ball','phase','caches'],'initial_fields');
  ensure(input.version==='directed-initial-1' && input.period===request.clip.period && input.sourceMs===request.clip.fromMs && input.units==='metres','initial_identity');
  const active=request.roster.filter(p=>activeAt(p,request.clip.period,request.clip.fromMs));
  ensure(Array.isArray(input.players) && input.players.length===active.length,'initial_roster');
  const seen=new Set<string>();
  for(const p of input.players){
    controlKeys(p,['playerKey','engineId','position','velocity','phase','energy','memory'],'initial_player');
    ensure(text(p.playerKey) && !seen.has(p.playerKey) && active.some(a=>a.playerKey===p.playerKey && a.engineId===p.engineId),'initial_player');seen.add(p.playerKey);
    prior(p.position,position);prior(p.velocity,isDirectedVector3);prior(p.phase,text);
    // Common initial energy is a declared fraction, not an upstream stamina unit.
    prior(p.energy,v=>finite(v) && v>=0 && v<=1);prior(p.memory,record);
  }
  controlKeys(input.ball,['position','velocity','ownerId'],'initial_ball');
  prior(input.ball.position,position);prior(input.ball.velocity,isDirectedVector3);prior(input.ball.ownerId,v=>v===null||text(v)&&seen.has(v));
  prior(input.phase,text);prior(input.caches,v=>record(v) && Object.keys(v).length===2 && text(v.revision) && record(v.values));
}

/** An execution index only; this does not reinterpret or execute the recorded action. */
export function scheduleDirectedEvents(request:DirectedRequest):readonly DirectedCommand[] {
  const r=ownJson(request);
  ensure(r && Array.isArray(r.events) && Array.isArray(r.evidence.actions) && Array.isArray(r.aliases),'schedule_records');
  const actions=new Map(r.evidence.actions.map(a=>[a.eventId,a]));
  const aliases=new Map(r.aliases.map(a=>[a.eventId,a]));
  ensure(actions.size===r.evidence.actions.length && aliases.size===r.aliases.length,'schedule_duplicate');
  ensure(new Set(r.events.map(e=>e.id)).size===r.events.length && [...actions.keys(),...aliases.keys()].every(id=>r.events.some(e=>e.id===id)),'schedule_reference');
  return ownJson([...r.events].sort((a,b)=>a.elapsedMs-b.elapsedMs||a.sourceIndex-b.sourceIndex)
    .map(event=>({event,evidence:actions.get(event.id)??null,alias:aliases.get(event.id)??null})));
}
export async function prepareDirectedJob(request:DirectedRequest,profile:DirectedExecutionProfile,initial:DirectedInitialState):Promise<DirectedJobResult> {
  try {
    const r=ownJson(request),p=ownJson(profile),i=ownJson(initial);
    ensure(r && hash(r.requestDigest),'request_identity');checkDirectedProfile(p,r);checkInitial(i,r);
    const {requestDigest,...payload}=r;
    const requestPayloadUtf8=JSON.stringify(payload);
    // Reuse the existing request validator/hash, not a second source interpreter.
    const rebuilt=await buildDirectedRequest({key:r.sourceKey,identity:r.sourceIdentity,motionRevision:r.motionRevision,rawDigest:r.sourceDigest,
      request:r.clip,events:r.events,performanceEvidence:r.evidence,frames:[],cuts:r.cuts,aliases:r.aliases},r.roster,r.capabilities,r.backend);
    ensure(rebuilt.status==='request_ready','request_invalid');
    const {requestDigest:expected,...expectedPayload}=rebuilt.request;
    ensure(expected===requestDigest && JSON.stringify(expectedPayload)===requestPayloadUtf8,'request_byte_identity');
    return {status:'prepared',job:ownJson({version:'directed-job-1',request:r,requestPayloadUtf8,profile:p,initialState:i,schedule:scheduleDirectedEvents(r)})};
  } catch(error){return unavailable(error);}
}
