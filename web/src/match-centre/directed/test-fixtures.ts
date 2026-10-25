import type { SequenceEvent } from '../sequence/types';
import type { DirectedCandidate, DirectedCapabilityReport, DirectedIdentity, DirectedRequest, DirectedSource } from './types';

export const FROM = 1684024, TO = 1697850;
export const CAPABILITY_IDS = ['identities_active','units','physical_clock','initial_state','possession','actor_targets',
  'explicit_pass_recipient','cross_header','save_block_recovery','prescribed_shot_outcome','event_time_between_ticks',
  'state_export','isolation_rng','teardown','render_dependency'] as const;
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export const absent = () => ({ value: null, provenance: 'unavailable' as const, reason: 'not_exported' });
export function identities(): DirectedIdentity[] {
  return [1,2].map(id => ({ sourceId:id,playerKey:`historical:statsbomb:${id}`,engineId:`home:${id}`,teamKey:'team:home',side:'home',
    activeIntervals:[{period:1,fromMs:FROM,toMs:TO}] }));
}
function event(id:string, at:number, actor:number): SequenceEvent {
  return {id,refs:[id],sourceIndex:at,period:1,periodMs:at,elapsedMs:at,kind:'Ball Receipt*',
    actorId:`historical:statsbomb:${actor}`,side:'home',recipientId:null,relatedIds:[],assistedShotId:null,possessionId:1,
    durationMs:null,start:{x:12,y:34},end:null,outcome:null,bodyPart:null,xg:null};
}
export function source(): DirectedSource {
  const pass={...event('pass',FROM+100,1),kind:'Pass',recipientId:'historical:statsbomb:2',relatedIds:['receipt'],durationMs:100.5,end:{x:12,y:34}};
  const receipt=event('receipt',FROM+200,2);
  const shot={...event('shot',TO-100,2),kind:'Shot',durationMs:100.325,end:{x:105,y:34},outcome:'Goal',bodyPart:'left_foot' as const,xg:.12};
  const identity={source:'historical' as const,id:'3754078',revision:'controlled-fixture'};
  const request={id:'ayew-equaliser-1' as const,period:1 as const,fromMs:1684024 as const,toMs:1697850 as const};
  const key=JSON.stringify([identity,'fixture-motion','a'.repeat(64),request]);
  return {key,identity,motionRevision:'fixture-motion',rawDigest:'a'.repeat(64),request,events:[pass,receipt,shot],frames:[],cuts:[],
    aliases:[{eventId:'pass',nextEventId:'receipt',sourceEndMs:FROM+200.5,presentationEndMs:FROM+200,deltaMs:-.5,kind:'pass_receipt',refs:['pass','receipt']}],
    performanceEvidence:{version:'sequence-performance-evidence-1',sourceKey:key,evidenceDigest:'b'.repeat(64),
      actions:[{eventId:'shot',elapsedMs:TO-100,actorId:shot.actorId,refs:['shot'],pass:null,keeper:null,
        shot:{bodyPart:'left_foot',rawEndHeight:1.3,endHeightUnit:'unverified',endHeightMetres:null,rawEndLocation:[120,40,1.3]}}],
      snapshots:[{eventId:'shot',period:1,periodMs:TO-100,elapsedMs:TO-100,rows:[{sourceId:1,playerKey:'historical:statsbomb:1',
        point:{x:20,y:34},eventPoint:{x:21.04,y:34},status:'conflict',reason:'fixture_conflict',discrepancyM:1.04,refs:['shot'],raw:{kept:true}}]}],
      issues:[{eventId:'shot',playerKey:'historical:statsbomb:1',code:'fixture_conflict',refs:['shot']}]}};
}
export function capabilities(): DirectedCapabilityReport {
  return {version:'directed-engine-capabilities-1',sourceDigest:'a'.repeat(64),evidenceDigest:'b'.repeat(64),
    inventory:{fixture:{sha256:'c'.repeat(64)}},engines:(['grf','touchlines'] as const).map(backend => ({backend,
      revision:backend==='grf'?'fixture-grf-revision':'d'.repeat(40),executionAvailable:false,measured:false,
      capabilities:CAPABILITY_IDS.map(id => ({id,state:'requires_extension',finding:'Controlled source report',requiredChange:'not implemented',
        evidence:[{file:'fixture',sha256:'c'.repeat(64),lines:[1,2],symbol:'fixture'}]}))}))};
}

/** Literal parser fixture; not a generated movement or physical acceptance example. */
export function candidate(request: DirectedRequest): DirectedCandidate {
  return {version:'directed-candidate-1',requestDigest:request.requestDigest,backend:request.backend,backendRevision:request.backendRevision,
    directorRevision:'controlled-director-1',provenance:'synthetic_motion',units:'metres',
    clock:{basis:'physical_source_offset',sourceStartMs:FROM,physicalStartMs:0,rate:1},receipt:{id:'controlled-receipt',sha256:'e'.repeat(64)},
    samples:[FROM,TO].map(sourceMs=>({period:1,sourceMs,physicalMs:sourceMs-FROM,
      players:request.roster.map(p=>({playerKey:p.playerKey,engineId:p.engineId,active:true,position:{x:12,y:34},
        velocity:absent(),direction:absent(),pose:absent()})),
      ball:{position:{x:12,y:34},height:absent(),ownerId:null}})),
    eventResults:request.events.map(e=>({eventId:e.id,actorId:e.actorId,recipientId:e.recipientId,outcome:e.outcome,sourceMs:e.elapsedMs})),
    checks:{root:{status:'not_run',reason:'controlled fixture'},node:{status:'not_run',reason:'controlled fixture'},body:{status:'blocked',reason:'not assessed'}}};
}
