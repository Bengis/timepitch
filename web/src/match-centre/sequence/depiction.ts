import type { SceneFrame, VisualCue } from '../../match/retroScene';
import type { SampleView } from '../session';
import { sampleInterval } from '../sampling';
import { validateSequenceEvents } from './evidence';
import { AYEW_SEQUENCE, PILOT_MATCH, PILOT_REVISION } from './pilot';
import { compileActorCurve, fieldPoint, pointAt, type CurveSpan, type Knot } from './curves';
import { prepareConstraints, type PresentationAlias } from './constraints';
import { solveActorConstraints, type SolverReport } from './constraint-solver';
import type { Point, SequenceEvent, SequenceSource } from './types';

export type DepictionIssue = Readonly<{fromMs:number;toMs:number;entityId:string|'ball';reason:string;refs:readonly string[]}>;
export type DepictionProfile='historical-action-preview-1'|'historical-action-preview-2';
export type DepictionDiagnostics=Readonly<{
  policyVersion:'sequence-constraints-1';aliases:readonly PresentationAlias[];
  actors:readonly Readonly<{actorId:string;report:SolverReport}>[];
}>;
export type SequenceDepiction = Readonly<{
  key:string;version:DepictionProfile;issues:readonly DepictionIssue[];diagnostics?:DepictionDiagnostics;
  sample(elapsedMs:number,raw:SampleView):Readonly<{frame:SceneFrame|null;previous:SceneFrame|null;availability:'available'|'partial'|'unavailable';refs:readonly string[]}>;
}>;
export type FocusSpan = Readonly<{fromMs:number;toMs:number;at:(time:number)=>Point|null}>;
type BallSpan=FocusSpan&{refs:readonly string[]};
const compiled=new WeakMap<SequenceDepiction,{fromMs:number;toMs:number;ball:readonly FocusSpan[];actors:ReadonlyMap<string,readonly FocusSpan[]>}>();
const v2Cache=new WeakMap<SequenceSource,SequenceDepiction>();
const active=(issue:DepictionIssue,t:number)=>t>=issue.fromMs&&t<=issue.toMs;
const actionKind=(e:SequenceEvent)=>['Pass','Shot','Carry'].includes(e.kind);
const protectedBallCut=(reason:string)=>/conflict|contradict|restart|period|unknown/i.test(reason);

export function compileDepiction(source:SequenceSource,profile:DepictionProfile='historical-action-preview-1'):SequenceDepiction {
  if(profile!=='historical-action-preview-1'&&profile!=='historical-action-preview-2')throw new Error('Depiction profile unavailable');
  const cached=profile==='historical-action-preview-2'&&Object.isFrozen(source)?v2Cache.get(source):undefined;
  if(cached)return cached;
  if(source.identity.source!=='historical'||source.identity.id!==PILOT_MATCH||source.identity.revision!==PILOT_REVISION
    ||JSON.stringify(source.request)!==JSON.stringify(AYEW_SEQUENCE))throw new Error('Depiction source/profile unavailable');
  const events=validateSequenceEvents(source.events),{fromMs,toMs}=source.request;
  const entry=source.frames.find(f=>f.clock_ms===fromMs),exit=source.frames.find(f=>f.clock_ms===toMs);
  if(!entry||!exit||entry.players.length!==new Set(entry.players.map(p=>p.key)).size)throw new Error('Depiction entry/exit identities unavailable');
  const identities=new Map(entry.players.map(p=>[p.key,p.side]));
  const issues:DepictionIssue[]=[],actors=new Map<string,readonly CurveSpan[]>();
  const issue=(entityId:string,start:number,end:number,reason:string,refs:readonly string[])=>issues.push({entityId,fromMs:Math.max(fromMs,start),toMs:Math.min(toMs,end),reason,refs:[...refs]});
  const prepared=profile==='historical-action-preview-2'?prepareConstraints(source):null;
  const reports:{actorId:string;report:SolverReport}[]=[];
  if(prepared){
    issues.push(...prepared.issues.map(i=>({...i,refs:[...i.refs]})));
    // Explicit evidence gaps survive inside actions and sub-ms alias windows, including a zero-width cut.
    for(const c of source.cuts)if((c.entityIds==='all'||c.entityIds.includes('ball'))&&c.fromMs!==null&&c.toMs!==null
      &&c.fromMs<=toMs&&c.toMs>=fromMs&&protectedBallCut(c.reason))issue('ball',c.fromMs,c.toMs,'source_ball_cut',c.refs);
  }
  const actorIds=new Set(events.filter(e=>!prepared||e.elapsedMs>=fromMs&&e.elapsedMs<=toMs).flatMap(e=>e.actorId?[e.actorId]:[]));
  for(const id of prepared?[...actorIds].sort():actorIds){
    if(prepared){
      // An empty named track blocks raw fallback in both Carry and selected-actor focus.
      actors.set(id,[]);const constraint=prepared.actors.find(a=>a.actorId===id);
      if(!constraint)continue;
      const solved=solveActorConstraints(constraint);reports.push(Object.freeze({actorId:id,report:solved.report}));
      if(solved.report.status==='certified')actors.set(id,solved.spans);
      else issue(id,fromMs,toMs,`actor_curve_${solved.report.status}`,constraint.hardKnots.flatMap(k=>k.refs??[]));
      continue;
    }
    const first=entry.players.find(p=>p.key===id),last=exit.players.find(p=>p.key===id);
    if(!first||!last){issue(id,fromMs,toMs,'actor_identity_unavailable',[]);continue;}
    const knots:Knot[]=[{atMs:fromMs,point:{x:first.x,y:first.y}},{atMs:toMs,point:{x:last.x,y:last.y}}];
    for(const e of events.filter(e=>e.actorId===id)){
      if(e.start&&e.elapsedMs>=fromMs&&e.elapsedMs<=toMs)knots.push({atMs:e.elapsedMs,point:e.start,refs:[e.id]});
      if(e.kind==='Carry'&&e.end&&e.durationMs!==null&&e.durationMs>0&&e.elapsedMs+e.durationMs<=toMs)knots.push({atMs:e.elapsedMs+e.durationMs,point:e.end,refs:[e.id]});
    }
    const curve=compileActorCurve(knots);actors.set(id,curve.spans);
    for(const failure of curve.issues)issue(id,failure.fromMs,failure.toMs,failure.reasons.join(','),failure.refs);
  }
  const actorAt=(id:string,t:number):Point|null=>{
    if(issues.some(i=>i.entityId===id&&active(i,t)))return null;
    const span=actors.get(id)?.find(s=>t>=s.fromMs&&t<=s.toMs);return span?pointAt(span,t):null;
  };
  const ball:BallSpan[]=[],actions=prepared?prepared.actions.map(a=>a.event):events.filter(actionKind);
  const linear=(a:Point,b:Point,start:number,end:number,refs:readonly string[]):BallSpan=>{
    const p={...a},q={...b};return {fromMs:start,toMs:end,refs:[...refs],at:t=>({x:p.x+(q.x-p.x)*(t-start)/(end-start),y:p.y+(q.y-p.y)*(t-start)/(end-start)})};
  };
  for(let n=0;n<actions.length;n++){
    const e=actions[n],end=prepared?(prepared.actions[n].presentationEndMs??e.elapsedMs+1):e.elapsedMs+(e.durationMs??0),fallback=actions[n+1]?.elapsedMs??toMs;
    if((prepared&&(prepared.actions[n].presentationEndMs===null||!Number.isFinite(end)||end<=e.elapsedMs))||!e.actorId||!identities.has(e.actorId)||!fieldPoint(e.start)||!fieldPoint(e.end)||e.durationMs===null||!Number.isFinite(e.durationMs)||e.durationMs<=0){
      issue('ball',e.elapsedMs,Math.max(e.elapsedMs+1,end,fallback),'invalid_action',[e.id]);continue;
    }
    if(e.kind==='Carry'){
      const id=e.actorId;
      ball.push({fromMs:e.elapsedMs,toMs:end,refs:[e.id],at:t=>actorAt(id,t)});
      for(const failure of issues.filter(i=>i.entityId===id&&i.toMs>=e.elapsedMs&&i.fromMs<=end))issue('ball',Math.max(e.elapsedMs,failure.fromMs),Math.min(end,failure.toMs),'carry_actor_curve_rejected',[e.id,...failure.refs]);
    }else if(Math.hypot(e.end.x-e.start.x,e.end.y-e.start.y)/(prepared?(end-e.elapsedMs)/1000:e.durationMs/1000)>45+1e-8){
      issue('ball',e.elapsedMs,end,'ball_speed_limit',[e.id]);
    }else ball.push(linear(e.start,e.end,e.elapsedMs,end,[e.id]));
  }
  const ordered=[...ball].sort((a,b)=>a.fromMs-b.fromMs);
  for(let n=1;n<ordered.length;n++){
    const a=ordered[n-1],b=ordered[n];
    if(a.toMs>b.fromMs){issue('ball',b.fromMs,Math.min(a.toMs,b.toMs),'overlapping_ball_actions',[...a.refs,...b.refs]);continue;}
    if(a.toMs===b.fromMs){
      if(prepared){const p=a.at(a.toMs),q=b.at(b.fromMs);if(!p||!q||Math.hypot(p.x-q.x,p.y-q.y)>1e-6)issue('ball',b.fromMs,b.fromMs,'conflicting_ball_handoff',[...a.refs,...b.refs]);}
      continue;
    }
    const p=a.at(a.toMs),q=b.at(b.fromMs),gap=b.fromMs-a.toMs;
    const forbidden=source.cuts.some(c=>(c.entityIds==='all'||c.entityIds.includes('ball'))&&c.fromMs!==null&&c.toMs!==null&&c.fromMs<b.fromMs&&c.toMs>a.toMs
      &&(prepared?protectedBallCut(c.reason):/conflict|contradict|restart|period/i.test(c.reason)));
    if(gap<=5000&&p&&q&&!forbidden&&Math.hypot(q.x-p.x,q.y-p.y)/(gap/1000)<=45+1e-8)ball.push(linear(p,q,a.toMs,b.fromMs,[...a.refs,...b.refs]));
    else issue('ball',a.toMs,b.fromMs,'unknown_or_conflicting_ball_gap',[...a.refs,...b.refs]);
  }
  ball.sort((a,b)=>a.fromMs-b.fromMs);
  const ballAt=(t:number)=>{
    if(issues.some(i=>i.entityId==='ball'&&active(i,t)))return null;
    const span=ball.filter(s=>t>=s.fromMs&&t<=s.toMs).at(-1);return span?.at(t)??null;
  };
  const paint=(raw:SceneFrame,t:number):SceneFrame=>({...raw,ball:ballAt(t),players:raw.players.map(p=>{
    const point=actorAt(p.key,t);return point?{...p,...point}:{...p};
  })});
  const unavailable=()=>({frame:null,previous:null,availability:'unavailable' as const,refs:[]});
  const diagnostics:DepictionDiagnostics|undefined=prepared?Object.freeze({policyVersion:'sequence-constraints-1',aliases:prepared.aliases,actors:Object.freeze(reports)}):undefined;
  const value:SequenceDepiction={key:JSON.stringify([source.key,source.motionRevision,source.rawDigest,source.request,profile,...(prepared?[prepared.key]:[])]),version:profile,issues,...(diagnostics?{diagnostics}:{}),
    sample(t,raw){
      if(!Number.isFinite(t)||t<fromMs||t>toMs||raw.cursor.elapsedMs!==t||raw.cursor.period!==source.request.period
        ||raw.frame.period!==source.request.period||raw.frame.clock_ms!==t||raw.frame.players.length!==identities.size
        ||new Set(raw.frame.players.map(p=>p.key)).size!==identities.size||raw.frame.players.some(p=>identities.get(p.key)!==p.side))return unavailable();
      const frame=paint(raw.frame,t);if(!frame.ball)return unavailable();
      const previousTime=raw.previous.clock_ms;
      const previous=previousTime>=fromMs&&previousTime<=toMs?paint(raw.previous,previousTime):{...raw.previous,players:raw.previous.players.map(p=>({...p})),ball:raw.previous.ball?{...raw.previous.ball}:null};
      return {frame,previous,availability:issues.some(i=>active(i,t))?'partial':'available',refs:[...new Set(ball.filter(s=>t>=s.fromMs&&t<=s.toMs).flatMap(s=>s.refs))]};
    }};
  // Focus uses the same compiled roots/ball, with explicit holes for rejected spans.
  const validFocus=(spans:readonly FocusSpan[],entity:string):readonly FocusSpan[]=>spans.flatMap(span=>{
    const failures=issues.filter(i=>i.entityId===entity&&i.fromMs<span.toMs&&i.toMs>span.fromMs);
    const times=[span.fromMs,span.toMs,...failures.flatMap(i=>[Math.max(span.fromMs,i.fromMs),Math.min(span.toMs,i.toMs)])].sort((a,b)=>a-b).filter((t,i,list)=>i===0||t!==list[i-1]);
    return times.slice(1).flatMap((end,i)=>failures.some(f=>active(f,(times[i]+end)/2))?[]:[{fromMs:times[i],toMs:end,
      at:prepared?(t:number)=>issues.some(f=>f.entityId===entity&&active(f,t))?null:span.at(t):span.at}]);
  });
  const focusActors=new Map<string,readonly FocusSpan[]>();
  for(const [id,spans] of actors)focusActors.set(id,validFocus(spans.map(s=>({fromMs:s.fromMs,toMs:s.toMs,at:t=>pointAt(s,t)})),id));
  // Unmodified players retain the shared sampler's original synthetic track.
  for(const id of identities.keys())if(!focusActors.has(id))focusActors.set(id,source.frames.slice(1).flatMap((after,i)=>{
    const before=source.frames[i];if(after.clock_ms<=fromMs||before.clock_ms>=toMs||after.clock_ms<=before.clock_ms)return [];
    const blocked=source.cuts.some(c=>(c.entityIds==='all'||c.entityIds.includes(id))&&c.fromMs!==null&&c.toMs!==null&&c.fromMs<after.clock_ms&&c.toMs>before.clock_ms);
    if(blocked)return [];
    return [{fromMs:Math.max(fromMs,before.clock_ms),toMs:Math.min(toMs,after.clock_ms),at:(t:number)=>{
      const frame=sampleInterval({before,after,fromMs:before.clock_ms,toMs:after.clock_ms,continuousBall:false,continuousPlayers:new Set([id])},t);
      const p=frame.players.find(p=>p.key===id);return p?{x:p.x,y:p.y}:null;
    }}];
  }));
  compiled.set(value,{fromMs,toMs,ball:validFocus(ball,'ball'),actors:focusActors});
  for(const i of issues){Object.freeze(i.refs);Object.freeze(i);}Object.freeze(issues);Object.freeze(value);
  if(prepared&&Object.isFrozen(source))v2Cache.set(source,value);
  return value;
}
export function focusTrack(depiction:SequenceDepiction,selectedKey:string|null) {
  const data=compiled.get(depiction);return data?{fromMs:data.fromMs,toMs:data.toMs,spans:selectedKey===null?data.ball:data.actors.get(selectedKey)??[]}:null;
}
export function sequenceCue(source:SequenceSource,t:number):VisualCue|undefined {
  const actions=validateSequenceEvents(source.events).filter(e=>actionKind(e)&&e.elapsedMs<=t&&e.actorId&&source.frames.some(f=>f.players.some(p=>p.key===e.actorId)));
  const e=actions.at(-1);if(!e)return undefined;
  const endpoint=e.durationMs!==null&&e.durationMs>0?e.elapsedMs+e.durationMs:null;
  if(e.kind==='Shot'&&e.outcome==='Goal'&&endpoint!==null&&t>=endpoint&&t<endpoint+900)return {type:'goal',participants:[e.actorId!],t1_ms:endpoint,side:e.side,bodyPart:e.bodyPart};
  if((e.kind==='Pass'||e.kind==='Shot')&&t-e.elapsedMs<250)return {type:e.kind==='Pass'?'pass':'shot',participants:[e.actorId!],t1_ms:e.elapsedMs,side:e.side,bodyPart:e.bodyPart};
  return undefined;
}
