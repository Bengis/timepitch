import { fieldPoint, type Knot } from './curves';
import type { DepictionIssue } from './depiction';
import { validateSequenceEvents } from './evidence';
import { AYEW_SEQUENCE, PILOT_MATCH, PILOT_REVISION } from './pilot';
import type { Point, SequenceEvent, SequenceSource } from './types';

export type PresentationAlias = Readonly<{
  eventId:string;nextEventId:string;sourceEndMs:number;presentationEndMs:number;deltaMs:number;
  kind:'carry_handoff'|'pass_receipt';refs:readonly string[];
}>;
export type PreparedActorConstraints = Readonly<{
  actorId:string;hardKnots:readonly Knot[];softExit:Readonly<{atMs:number;target:Point}>|null;
}>;
export type PreparedAction = Readonly<{event:SequenceEvent;presentationEndMs:number|null}>;
export type PreparedSequenceConstraints = Readonly<{
  key:string;sourceKey:string;sourceDigest:string;request:SequenceSource['request'];
  actors:readonly PreparedActorConstraints[];actions:readonly PreparedAction[];
  aliases:readonly PresentationAlias[];issues:readonly DepictionIssue[];
}>;

const samePoint=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y)<=1e-6;
const actionKind=(e:SequenceEvent)=>['Carry','Pass','Shot'].includes(e.kind);
const interruptsHandoff=(e:SequenceEvent)=>actionKind(e)||['Ball Recovery','Ball Receipt*','Interception','Goal Keeper','Block','Duel'].includes(e.kind);
const pointCopy=(p:Point|null)=>p===null?null:{...p};
function seal<T>(value:T):T {
  if(value&&typeof value==='object'){Object.values(value).forEach(seal);Object.freeze(value);}return value;
}
function sourceKeyMatches(source:SequenceSource):boolean {
  try {
    const key=JSON.parse(source.key),r=key?.[3],id=key?.[0];
    return Array.isArray(key)&&key.length===4&&id?.source===source.identity.source&&id?.id===source.identity.id
      &&id?.revision===source.identity.revision&&key[1]===source.motionRevision&&key[2]===source.rawDigest
      &&r?.id===source.request.id&&r?.period===source.request.period&&r?.fromMs===source.request.fromMs&&r?.toMs===source.request.toMs;
  }catch{return false;}
}

// A preparation of the adapter's sealed source, not a new source loader or a tracking claim.
export function prepareConstraints(source:SequenceSource):PreparedSequenceConstraints {
  const {fromMs,toMs,period}=source.request;
  if(source.identity.source!=='historical'||source.identity.id!==PILOT_MATCH||source.identity.revision!==PILOT_REVISION
    ||source.request.id!==AYEW_SEQUENCE.id||period!==AYEW_SEQUENCE.period||fromMs!==AYEW_SEQUENCE.fromMs||toMs!==AYEW_SEQUENCE.toMs
    ||!source.motionRevision||!/^[a-f0-9]{64}$/.test(source.rawDigest)||!sourceKeyMatches(source))throw new Error('Constraint source/profile unavailable');
  const entries=source.frames.filter(f=>f.clock_ms===fromMs&&f.period===period),exits=source.frames.filter(f=>f.clock_ms===toMs&&f.period===period);
  if(entries.length!==1||exits.length!==1)throw new Error('Constraint entry/exit unavailable');
  const entry=entries[0],exit=exits[0],identities=new Map(entry.players.map(p=>[p.key,p]));
  if(!entry.players.length||entry.players.length>22||identities.size!==entry.players.length||exit.players.length!==identities.size
    ||new Set(exit.players.map(p=>p.key)).size!==identities.size||exit.players.some(p=>identities.get(p.key)?.side!==p.side)
    ||[...entry.players,...exit.players].some(p=>!p.key||!fieldPoint(p)))throw new Error('Constraint boundary identities/coordinates unavailable');

  // Copy before sealing: preparation must neither freeze nor mutate caller-owned objects.
  const events=validateSequenceEvents(source.events).map(e=>({...e,refs:[...e.refs],relatedIds:[...e.relatedIds],start:pointCopy(e.start),end:pointCopy(e.end)}));
  const issues:DepictionIssue[]=[],aliases:PresentationAlias[]=[],actions:PreparedAction[]=[];
  const issue=(entityId:string,reason:string,refs:readonly string[],start:number=fromMs,end:number=toMs)=>{
    issues.push({entityId,reason,refs:[...new Set(refs)],fromMs:Math.max(fromMs,start),toMs:Math.min(toMs,end)});
  };
  const validEvent=(e:SequenceEvent)=>e.period===period&&Number.isFinite(e.elapsedMs)&&Number.isFinite(e.periodMs)
    &&e.elapsedMs===e.periodMs&&Number.isInteger(e.sourceIndex)&&e.elapsedMs>=0;
  const inClip=(e:SequenceEvent)=>validEvent(e)&&e.elapsedMs>=fromMs&&e.elapsedMs<=toMs;
  for(const e of events)if(!validEvent(e))issue(e.actorId??'ball','invalid_event',e.refs);

  for(const e of events.filter(e=>actionKind(e)&&e.elapsedMs>=fromMs&&e.elapsedMs<=toMs)){
    const rawEnd=e.durationMs!==null&&Number.isFinite(e.durationMs)&&e.durationMs>0?e.elapsedMs+e.durationMs:null;
    let end=rawEnd;
    if(!validEvent(e)||rawEnd===null||!Number.isFinite(rawEnd)||!e.actorId||!identities.has(e.actorId)||!fieldPoint(e.start)||!fieldPoint(e.end)){
      issue('ball','invalid_action',e.refs);end=null;
    }else if(e.kind==='Carry'||e.kind==='Pass'){
      const targetKind=(n:SequenceEvent)=>e.kind==='Carry'||n.kind==='Ball Receipt*';
      const targetActor=e.kind==='Carry'?e.actorId:e.recipientId;
      const following=events.filter(n=>inClip(n)&&n.elapsedMs>e.elapsedMs&&n.actorId===targetActor&&targetKind(n));
      const nextTime=following[0]?.elapsedMs;
      const next=following.filter(n=>n.elapsedMs===nextTime);
      const linked=events.filter(n=>e.relatedIds.includes(n.id)&&n.elapsedMs>e.elapsedMs&&targetKind(n));
      const near=next.some(n=>Math.abs(n.elapsedMs-rawEnd)<=1);
      // No speculative retiming: unrelated distant actions simply retain the raw endpoint.
      if(linked.length||near||e.relatedIds.some(id=>!events.some(n=>n.id===id))){
        const n=linked.length===1?linked[0]:null;
        const intervening=n&&events.some(v=>inClip(v)&&interruptsHandoff(v)&&v.id!==e.id&&v.elapsedMs>e.elapsedMs&&v.elapsedMs<n.elapsedMs);
        if(n&&inClip(n)&&n.actorId===targetActor&&targetActor!==null&&identities.has(targetActor)&&n.side===e.side&&next.length===1&&next[0].id===n.id
          &&fieldPoint(n.start)&&samePoint(e.end,n.start)&&Math.abs(n.elapsedMs-rawEnd)<=1&&!intervening){
          end=n.elapsedMs;aliases.push({eventId:e.id,nextEventId:n.id,sourceEndMs:rawEnd,presentationEndMs:end,
            deltaMs:end-rawEnd,kind:e.kind==='Carry'?'carry_handoff':'pass_receipt',refs:[...new Set([...e.refs,...n.refs])]});
        }else issue('ball','presentation_alias_conflict',[...e.refs,...linked.flatMap(n=>n.refs)],e.elapsedMs,Math.min(toMs,rawEnd));
      }
    }
    actions.push({event:e,presentationEndMs:end});
  }

  const actors:PreparedActorConstraints[]=[];
  const actorIds=[...new Set(events.filter(inClip).flatMap(e=>e.actorId?[e.actorId]:[]))].sort();
  for(const actorId of actorIds){
    const first=identities.get(actorId),last=exit.players.find(p=>p.key===actorId),owned=events.filter(e=>e.actorId===actorId&&inClip(e));
    if(!first||!last){issue(actorId,'actor_identity_unavailable',owned.flatMap(e=>e.refs));continue;}
    const knots:Knot[]=[{atMs:fromMs,point:{x:first.x,y:first.y},refs:[]}];let invalid=false;
    for(const e of owned){
      if(!fieldPoint(e.start)||e.side!==first.side){issue(actorId,'invalid_anchor',e.refs);invalid=true;continue;}
      knots.push({atMs:e.elapsedMs,point:{...e.start},refs:[...e.refs]});
      if(e.kind==='Carry'){
        const a=actions.find(a=>a.event.id===e.id);
        if(!a||a.presentationEndMs===null||!fieldPoint(e.end)){issue(actorId,'invalid_anchor',e.refs);invalid=true;continue;}
        if(a.presentationEndMs<=toMs)knots.push({atMs:a.presentationEndMs,point:{...e.end},refs:[...e.refs]});
      }
    }
    const merged:Knot[]=[];
    for(const k of knots.sort((a,b)=>a.atMs-b.atMs)){
      const prev=merged.at(-1);
      if(prev?.atMs===k.atMs){
        if(!samePoint(prev.point,k.point)){issue(actorId,'contradictory_anchor',[...prev.refs??[],...k.refs??[]]);invalid=true;}
        else merged[merged.length-1]={...prev,refs:[...new Set([...prev.refs??[],...k.refs??[]])]};
      }else merged.push(k);
    }
    const softExit=merged.at(-1)?.atMs===toMs?null:{atMs:toMs,target:{x:last.x,y:last.y}};
    if(merged.length+(softExit?1:0)>64){issue(actorId,'actor_knot_limit',owned.flatMap(e=>e.refs));invalid=true;}
    if(!invalid)actors.push({actorId,hardKnots:merged,softExit});
  }
  const key=JSON.stringify([source.key,'sequence-constraints-1',{aliasMs:1,pointM:1e-6,playerSpeed:9,playerAcceleration:4,ballSpeed:45},aliases]);
  return seal({key,sourceKey:source.key,sourceDigest:source.rawDigest,request:{...source.request},actors,actions,aliases,issues});
}
