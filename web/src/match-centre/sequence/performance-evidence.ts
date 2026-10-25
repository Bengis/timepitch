import type { HistoricalEvent } from '../../historical/api';
import type { SessionDescriptor } from '../session';
import { normalizeSequenceEvent, validateSequenceEvents } from './evidence';
import type { Point } from './types';

type Status = 'usable' | 'conflict' | 'unresolved';
type Foot = 'head' | 'left_foot' | 'right_foot' | null;
export type PerformanceIssue = Readonly<{eventId:string;playerKey:string|null;code:string;refs:readonly string[]}>;
export type PerformanceSnapshotRow = Readonly<{
  sourceId:number|null;playerKey:string|null;point:Point|null;status:Status;reason:string|null;
  eventPoint:Point|null;discrepancyM:number|null;refs:readonly string[];raw:unknown;
}>;
export type PerformanceActionEvidence = Readonly<{
  eventId:string;elapsedMs:number;actorId:string|null;refs:readonly string[];
  pass:Readonly<{height:'ground'|'low'|'high'|null;cross:boolean|null;bodyPart:Foot;raw:Readonly<Record<string,unknown>>}>|null;
  keeper:Readonly<{technique:string|null;bodyPart:'left_hand'|'right_hand'|'both_hands'|'left_foot'|'right_foot'|'head'|null;
    position:string|null;type:string|null;outcome:string|null;raw:Readonly<Record<string,unknown>>}>|null;
  shot:Readonly<{bodyPart:Foot;rawEndHeight:number|null;endHeightUnit:'unverified';endHeightMetres:null;rawEndLocation:unknown}>|null;
}>;
export type PerformanceEvidence = Readonly<{
  version:'sequence-performance-evidence-1';sourceKey:string;evidenceDigest:string;
  actions:readonly PerformanceActionEvidence[];
  snapshots:readonly Readonly<{eventId:string;period:number;periodMs:number;elapsedMs:number;rows:readonly PerformanceSnapshotRow[]}>[];
  issues:readonly PerformanceIssue[];
}>;

const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const text=(v:unknown):string|null=>typeof v==='string'&&v.length>0?v:null;
const named=(v:unknown)=>text(record(v).name);
const body=(v:unknown):Foot=>({'Head':'head','Left Foot':'left_foot','Right Foot':'right_foot'} as const)[named(v) as 'Head']??null;
const own=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
function seal<T>(v:T):T {
  if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(seal);Object.freeze(v);}return v;
}
// Canonicalise object keys without reordering source arrays or rewriting raw records.
function stable(v:unknown):unknown {
  if(Array.isArray(v))return v.map(stable);
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(record(v)[k])]));
  return v;
}
const point=(v:unknown):Point|null=>{const p=record(v);return finite(p.x)&&finite(p.y)&&p.x>=0&&p.x<=105&&p.y>=0&&p.y<=68?{x:p.x,y:p.y}:null;};
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

/** Supplementary facts only. No fetch, native call, pose, movement or fact retiming. */
export async function normalizePerformanceEvidence(raw:readonly HistoricalEvent[],descriptor:SessionDescriptor):Promise<PerformanceEvidence> {
  const meta=descriptor.metadata??{},context=record(meta.performanceContext),request=record(context.request);
  const sourceKey=text(context.sourceKey),digest=text(context.rawDigest),motion=text(context.motionRevision);
  const period=descriptor.periods.find(p=>p.period===request.period);
  if(descriptor.identity.source!=='historical'||!sourceKey||!digest||!/^[a-f0-9]{64}$/.test(digest)||!motion||motion!==meta.reconstruction
    ||!period||period.startMs===null||period.durationMs===null||!finite(request.fromMs)||!finite(request.toMs)||request.toMs<=request.fromMs
    ||request.fromMs<period.startMs||request.toMs>period.startMs+period.durationMs
    ||sourceKey!==JSON.stringify([descriptor.identity,motion,digest,request]))throw new Error('Performance source identity/context changed');
  if(raw.length>100||new TextEncoder().encode(JSON.stringify(raw)).byteLength>2*1024*1024)throw new Error('Performance evidence limit');
  const normalized=validateSequenceEvents(raw.map(e=>normalizeSequenceEvent(e,descriptor)));
  for(const e of normalized){
    if(e.period!==request.period||e.elapsedMs<request.fromMs-2000||e.elapsedMs>request.toMs+2000)throw new Error('Performance event period/window changed');
    const original=raw.find(r=>`historical:${r.id}`===e.id)!;
    if(original.player_key!=null&&e.actorId===null)throw new Error('Performance actor identity unresolved');
    if(original.team_key!=null&&e.side===null)throw new Error('Performance event team unresolved');
  }
  const people=Array.isArray(meta.playerIdentities)?meta.playerIdentities.map(record):[];
  const participation=Array.isArray(context.participants)?context.participants.map(record):[];
  if(participation.length>500)throw new Error('Performance participation limit');
  const issues:PerformanceIssue[]=[],actions:PerformanceActionEvidence[]=[],snapshots:PerformanceEvidence['snapshots'][number][]=[];
  const issue=(eventId:string,playerKey:string|null,code:string,refs:readonly string[])=>issues.push({eventId,playerKey,code,refs:[...refs]});
  for(const e of [...raw].sort((a,b)=>a.period_ms-b.period_ms||a.source_index-b.source_index)){
    const n=normalized.find(n=>n.id===`historical:${e.id}`)!,details=record(e.details),pass=record(details.pass),shot=record(details.shot),keeper=record(details.goalkeeper);
    const side=e.team_key===descriptor.home.id?'home':e.team_key===descriptor.away.id?'away':null;
    const flip=(side==='away')!==(e.period===2||e.period===4);
    const orient=(p:Point):Point=>flip?{x:105-p.x,y:68-p.y}:{...p};
    const sourcePoint=point(e.location),canonical=point(e.canonical_location);
    if(e.location!=null&&!sourcePoint||e.canonical_location!=null&&!canonical)throw new Error('Invalid performance source coordinate');
    if(sourcePoint&&(!canonical||side===null||distance(orient(sourcePoint),canonical)>1e-6))throw new Error('Performance canonical coordinate frame changed');
    let passData:PerformanceActionEvidence['pass']=null,shotData:PerformanceActionEvidence['shot']=null,keeperData:PerformanceActionEvidence['keeper']=null;
    if(details.pass!==undefined){
      const height=({'Ground Pass':'ground','Low Pass':'low','High Pass':'high'} as const)[named(pass.height) as 'Ground Pass']??null;
      const cross=typeof pass.cross==='boolean'?pass.cross:null;
      if(!Object.keys(pass).length||pass.height!==undefined&&height===null||pass.cross!==undefined&&cross===null||pass.body_part!==undefined&&body(pass.body_part)===null)
        issue(n.id,n.actorId,'invalid_pass_metadata',n.refs);
      passData={height,cross,bodyPart:body(pass.body_part),raw:own(pass)};
    }
    if(details.goalkeeper!==undefined){
      const hand=({'Left Hand':'left_hand','Right Hand':'right_hand','Both Hands':'both_hands','Left Foot':'left_foot','Right Foot':'right_foot','Head':'head'} as const)[named(keeper.body_part) as 'Left Hand']??null;
      if(!Object.keys(keeper).length||keeper.body_part!==undefined&&hand===null||keeper.technique!==undefined&&named(keeper.technique)===null)
        issue(n.id,n.actorId,'invalid_keeper_metadata',n.refs);
      keeperData={technique:named(keeper.technique),bodyPart:hand,position:named(keeper.position),type:named(keeper.type),outcome:named(keeper.outcome),raw:own(keeper)};
    }
    if(details.shot!==undefined){
      const end=shot.end_location;
      const rawEndHeight=Array.isArray(end)&&end.length===3&&finite(end[2])&&end[2]>=0?end[2]:null;
      if(end!==undefined&&(!Array.isArray(end)||(end.length!==2&&end.length!==3)||end.some(v=>!finite(v))||end.length===3&&rawEndHeight===null))
        issue(n.id,n.actorId,'invalid_shot_end_location',n.refs);
      // Saved Events v4 describes [x,y,z], but does not establish a text-verifiable z unit.
      // Preserve the number. Neither x/y rescaling nor a guessed metre conversion is valid.
      shotData={bodyPart:body(shot.body_part),rawEndHeight,endHeightUnit:'unverified',endHeightMetres:null,rawEndLocation:end===undefined?null:own(end)};
    }
    actions.push({eventId:n.id,elapsedMs:n.elapsedMs,actorId:n.actorId,refs:[...n.refs],pass:passData,keeper:keeperData,shot:shotData});
    if(shot.freeze_frame===undefined)continue;
    if(!Array.isArray(shot.freeze_frame)||shot.freeze_frame.length>22){issue(n.id,null,'invalid_snapshot',n.refs);continue;}
    const rawRows=shot.freeze_frame;
    const rows=rawRows.map(record),counts=new Map<number,number>();
    for(const row of rows){const id=record(row.player).id;if(finite(id))counts.set(id,(counts.get(id)??0)+1);}
    const frames=participation.filter(f=>f.period===e.period&&f.periodMs===e.period_ms);
    const active=frames.length===1&&Array.isArray(frames[0].playerKeys)&&frames[0].playerKeys.every(k=>typeof k==='string')
      &&new Set(frames[0].playerKeys).size===frames[0].playerKeys.length?new Set(frames[0].playerKeys as string[]):null;
    const output:PerformanceSnapshotRow[]=rows.map((row,index)=>{
      const value=record(row.player).id,sourceId=finite(value)&&Number.isSafeInteger(value)&&value>0?value:null;
      const matches=people.filter(p=>p.sourceId===sourceId),person=sourceId!==null&&matches.length===1?matches[0]:null;
      const rawKey=person?text(person.key):null;
      const unique=rawKey!==null&&people.filter(p=>p.key===rawKey).length===1;
      const playerKey=unique?`historical:${rawKey}`:null;
      const loc=row.location,valid=Array.isArray(loc)&&loc.length===2&&loc.every(finite)&&loc[0]>=0&&loc[0]<=120&&loc[1]>=0&&loc[1]<=80;
      const pos=valid&&side!==null?orient({x:loc[0]*105/120,y:loc[1]*68/80}):null;
      let reason:string|null=sourceId===null||!playerKey?'unresolved_player':counts.get(sourceId)!==1?'duplicate_snapshot_player':!pos?'invalid_snapshot_coordinate':side===null?'unknown_parent_team':
        person!.teamKey!==descriptor.home.id&&person!.teamKey!==descriptor.away.id?'unknown_player_team':
        typeof row.teammate!=='boolean'||row.teammate!==(person!.teamKey===e.team_key)?'snapshot_team_mismatch':!active?'unavailable_participation':!active.has(rawKey!)?'inactive_snapshot_player':null;
      let status:Status=reason?'unresolved':'usable',eventPoint:Point|null=null,discrepancyM:number|null=null;
      const refs=[...n.refs];
      if(!reason&&pos){
        const conflicts=normalized.filter(v=>v.id!==n.id&&v.actorId===playerKey&&v.period===e.period&&v.periodMs===e.period_ms&&v.start&&distance(v.start,pos)>1e-6);
        if(conflicts.length){
          status='conflict';reason='simultaneous_event_position_conflict';eventPoint={...conflicts[0].start!};discrepancyM=distance(eventPoint,pos);
          refs.push(...conflicts.flatMap(v=>v.refs));
        }
      }
      if(reason)issue(n.id,playerKey,reason,refs);
      return {sourceId,playerKey,point:pos,status,reason,eventPoint,discrepancyM,refs:[...new Set(refs)],raw:own(rawRows[index])};
    });
    snapshots.push({eventId:n.id,period:e.period,periodMs:e.period_ms,elapsedMs:n.elapsedMs,rows:output});
  }
  const content={version:'sequence-performance-evidence-1' as const,sourceKey,actions,snapshots,issues};
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(content))));
  const evidenceDigest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  return seal({...content,evidenceDigest});
}
