import type { Effector, SemanticIssue, SemanticRole, SemanticSequence, SourceObservation } from './contact-types';
import type { PerformanceActionEvidence } from './performance-evidence';
import type { SequenceEvent, SequenceSource } from './types';

const VERSION='sequence-contact-semantics-1' as const;
const digest=(s:string)=>/^[a-f0-9]{64}$/.test(s);
const limb=(part:string|null):Effector=>({head:'head',left_foot:'leftFoot',right_foot:'rightFoot',
  left_hand:'leftHand',right_hand:'rightHand'} as Record<string,Effector>)[part??'']??'unknownSurface';
function own<T>(value:T):T {
  if(Array.isArray(value))return value.map(own) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,own(v)])) as T;
  return value;
}
function seal<T>(value:T):T {
  if(value&&typeof value==='object'){Object.values(value).forEach(seal);Object.freeze(value);}return value;
}
function stable(value:unknown):unknown {
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  // Invalid nonfinite input remains distinct in a diagnostic key, never a valid coordinate.
  return typeof value==='number'&&!Number.isFinite(value)?{invalidNumber:String(value)}:value;
}

/** Classification only: no motion, solver, IO, animation, ball attachment or inferred limb. */
export function classifyContacts(source: SequenceSource): SemanticSequence {
  const issues:SemanticIssue[]=[],evidence=source.performanceEvidence;
  const add=(code:string,event:SequenceEvent|null)=>issues.push({code,eventId:event?.id??null,refs:[...(event?.refs??[])],blocking:true});
  const finish=(observations:readonly SourceObservation[]):SemanticSequence=>{
    const content={version:VERSION,sourceKey:source.key,sourceDigest:source.rawDigest,evidenceDigest:evidence?.evidenceDigest??null,observations,issues};
    // Deterministic identity of the actual metadata, not a cryptographic attestation.
    return seal({...content,key:JSON.stringify(stable(content))});
  };
  if(source.events.length>100||(evidence?.actions.length??0)>100){add('input_limit',null);return finish([]);}
  if(source.identity.source!=='historical'||!digest(source.rawDigest)
    ||source.key!==JSON.stringify([source.identity,source.motionRevision,source.rawDigest,source.request]))add('invalid_source_binding',null);
  if(!evidence||evidence.sourceKey!==source.key||evidence.version!=='sequence-performance-evidence-1'||!digest(evidence.evidenceDigest))add('invalid_evidence_binding',null);
  if(new Set(source.events.map(e=>e.id)).size!==source.events.length
    ||new Set(source.events.map(e=>e.sourceIndex)).size!==source.events.length)add('duplicate_event_identity',null);
  if(evidence?.actions.some(a=>!source.events.some(e=>e.id===a.eventId)))add('foreign_action_evidence',null);
  const invalidBinding=issues.length>0;
  const entry=source.frames.find(f=>f.clock_ms===source.request.fromMs);
  const observations:SourceObservation[]=[...source.events].sort((a,b)=>a.elapsedMs-b.elapsedMs||a.sourceIndex-b.sourceIndex).map(e=>{
    const before=issues.length,actions=evidence?.actions.filter(a=>a.eventId===e.id)??[];
    const action:PerformanceActionEvidence|null=actions.length===1?actions[0]:null;
    if(actions.length!==1||action?.actorId!==e.actorId||action?.elapsedMs!==e.elapsedMs
      ||JSON.stringify(action?.refs)!==JSON.stringify(e.refs))add('invalid_action_binding',e);
    if(e.period!==source.request.period||!Number.isFinite(e.elapsedMs)||e.elapsedMs<source.request.fromMs||e.elapsedMs>source.request.toMs
      // SequenceRequest currently admits only period 1, whose source offset is zero.
      ||!Number.isFinite(e.periodMs)||e.periodMs!==e.elapsedMs||!Number.isInteger(e.sourceIndex))add('invalid_event_time',e);
    const actors=entry?.players.filter(p=>p.key===e.actorId)??[];
    if(e.actorId===null||actors.length!==1||actors[0].side!==e.side)add('unresolved_actor',e);
    if(!e.start||!Number.isFinite(e.start.x)||!Number.isFinite(e.start.y)||e.start.x<0||e.start.x>105||e.start.y<0||e.start.y>68)add('invalid_event_point',e);
    if(e.relatedIds.some(id=>source.events.filter(other=>other.id===id).length!==1))add('unresolved_related_event',e);
    for(const problem of evidence?.issues.filter(i=>i.eventId===e.id&&i.code.startsWith('invalid_'))??[])add(problem.code,e);

    let role:SemanticRole='unsupported',effector:Effector=null,physicalContactRequired=false;
    switch(e.kind){
      case 'Pass':case 'Shot':{
        role='strike';physicalContactRequired=true;
        const part=e.kind==='Pass'?action?.pass?.bodyPart:action?.shot?.bodyPart;
        if(part&&e.bodyPart&&part!==e.bodyPart)add('conflicting_body_part',e);
        effector=limb(part??e.bodyPart);
        break;
      }
      case 'Carry':role='control_interval';break;
      case 'Ball Recovery':role='recovery_observation';break;
      case 'Ball Receipt*':role='arrival_observation';break;
      case 'Duel':role='contest';break;
      case 'Block':role='block';effector='unknownSurface';physicalContactRequired=true;break;
      case 'Goal Keeper':{
        const keeper=action?.keeper;
        // Negative touch/context evidence wins over a supplied limb or a suggestive type name.
        if(keeper?.outcome==='No Touch')role='no_touch';
        else if(keeper?.type==='Shot Faced')role='shot_context';
        else if(keeper?.type==='Shot Saved'){
          role='save';effector=limb(keeper.bodyPart);physicalContactRequired=true;
        }else add('unsupported_keeper_type',e);
        break;
      }
      default:add('unsupported_event_kind',e);
    }
    if(role==='save'||role==='block'){
      const shots=e.relatedIds.map(id=>source.events.find(other=>other.id===id)!).filter(other=>other?.kind==='Shot');
      if(shots.length!==1||shots[0].actorId===e.actorId)add('ambiguous_contact_link',e);
    }
    if(invalidBinding||issues.length>before){physicalContactRequired=false;effector=null;}
    return {eventId:e.id,actorId:e.actorId,kind:e.kind,role,sourceIndex:e.sourceIndex,sourceAtMs:e.elapsedMs,
      sourcePoint:own(e.start),relatedIds:[...e.relatedIds],refs:[...e.refs],effector,physicalContactRequired,
      metadata:{event:own(e),action:own(action)}};
  });
  return finish(observations);
}
