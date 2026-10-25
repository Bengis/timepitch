import { prepareConstraints } from './constraints';
import { solveActorConstraints } from './constraint-solver';
import { solveStagingActor } from './staging-solver';
import { fieldPoint, inspectSpan, pointAt, rootsInUnitInterval, velocityAt, type CurveSpan, type Knot } from './curves';
import type { SequenceDepiction } from './depiction';
import type { StagedSequence, StagingConstraint, StagingContact, StagingIssue, StagingOffset, StagingReport, StagingTrack } from './performance-types';
import type { Point, SequenceSource } from './types';

const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const val=(p:readonly number[],u:number):number=>p.reduceRight((a,c)=>a*u+c,0);
const derivative=(p:readonly number[])=>p.slice(1).map((c,i)=>c*(i+1));
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
function seal<T>(v:T):T {if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(seal);Object.freeze(v);}return v;}
const times=(values:readonly number[])=>[...new Set(values)].sort((a,b)=>a-b);
const sample=(spans:readonly CurveSpan[],t:number)=>{
  const span=spans.find(s=>t>=s.fromMs&&t<=s.toMs);return span&&Number.isFinite(t)?pointAt(span,t):null;
};
// Reparameterise a cubic on a shared time interval. Squared relative distance
// has degree <=6; every interior minimum is a root of its degree <=5 derivative.
function onInterval(p:readonly number[],span:CurveSpan,a:number,b:number):number[] {
  const u=(a-span.fromMs)/(span.toMs-span.fromMs),h=(b-a)/(span.toMs-span.fromMs);
  const [c0=0,c1=0,c2=0,c3=0]=p;
  return [c0+c1*u+c2*u*u+c3*u*u*u,h*(c1+2*c2*u+3*c3*u*u),h*h*(c2+3*c3*u),h*h*h*c3];
}
function minimumDistance(a:CurveSpan,b:CurveSpan,from:number,to:number) {
  const x=onInterval(a.x,a,from,to).map((v,i)=>v-onInterval(b.x,b,from,to)[i]);
  const y=onInterval(a.y,a,from,to).map((v,i)=>v-onInterval(b.y,b,from,to)[i]);
  const squared=Array(7).fill(0) as number[];
  for(const p of [x,y])p.forEach((v,i)=>p.forEach((w,j)=>{squared[i+j]+=v*w;}));
  const candidates=[0,1,...rootsInUnitInterval(derivative(squared))];
  let best={distance:Infinity,atMs:from};
  for(const u of candidates){const d=Math.hypot(val(x,u),val(y,u));if(d<best.distance)best={distance:d,atMs:from+(to-from)*u};}
  return best;
}

/** Independent continuous verifier, also usable on deliberately damaged candidates. */
export function inspectStaging(staged:StagedSequence):StagingReport {
  const issues:StagingIssue[]=[...staged.issues],add=(code:string,actorIds:readonly string[],detail?:string,atMs?:number,refs:readonly string[]=[])=>
    issues.push({code,actorIds,detail,atMs,refs,blocking:true});
  let maxSpeed=0,maxAcceleration=0,minClearanceM=Infinity;
  if(!Number.isFinite(staged.fromMs)||!Number.isFinite(staged.toMs)||staged.toMs<=staged.fromMs
    ||staged.actorIds.length<1||staged.actorIds.length>22||new Set(staged.actorIds).size!==staged.actorIds.length
    ||staged.tracks.length!==staged.actorIds.length||new Set(staged.tracks.map(t=>t.actorId)).size!==staged.actorIds.length
    ||staged.tracks.some(t=>!staged.actorIds.includes(t.actorId)))add('identity_coverage',[]);
  const valid=new Set<string>();
  for(const track of staged.tracks){
    const {spans,actorId}=track;
    if(!spans.length||spans.length>63||spans[0].fromMs!==staged.fromMs||spans.at(-1)!.toMs!==staged.toMs){add('domain_coverage',[actorId]);continue;}
    let malformed=false;
    for(let i=0;i<spans.length;i++){
      const s=spans[i];
      if(!s.x.length||!s.y.length||s.x.length>4||s.y.length>4||!Number.isFinite(s.fromMs)||!Number.isFinite(s.toMs)||s.toMs<=s.fromMs||[...s.x,...s.y].some(v=>!Number.isFinite(v))){add('invalid_curve',[actorId]);malformed=true;continue;}
      // The legacy verifier expects cubic storage, including explicit zero
      // coefficients for stationary/linear spans. Do not change V2 to adapt it.
      const cubic={...s,x:Array.from({length:4},(_,n)=>s.x[n]??0),y:Array.from({length:4},(_,n)=>s.y[n]??0)};
      const proof=inspectSpan(cubic);maxSpeed=Math.max(maxSpeed,proof.maxSpeed);maxAcceleration=Math.max(maxAcceleration,proof.maxAcceleration);
      for(const reason of proof.reasons)add(reason,[actorId],undefined,s.fromMs,s.refs);
      const previous=spans[i-1];
      if(previous){
        if(previous.toMs!==s.fromMs){add('domain_coverage',[actorId]);malformed=true;}
        else if(!malformed&&(distance(pointAt(previous,s.fromMs),pointAt(s,s.fromMs))>1e-6||distance(velocityAt(previous,s.fromMs),velocityAt(s,s.fromMs))>1e-7))add('continuity',[actorId],undefined,s.fromMs);
      }
    }
    if(!malformed)valid.add(actorId);
  }
  for(const c of staged.constraints){
    const track=staged.tracks.find(t=>t.actorId===c.actorId);if(!track)continue;
    const p=valid.has(c.actorId)?sample(track.spans,c.atMs):null;
    if(!p||!fieldPoint(c.point)||!Number.isFinite(c.radiusM)||c.radiusM<0||c.radiusM>.65
      ||c.provenance!=='recorded_action_envelope'&&c.radiusM!==0||distance(p,c.point)>c.radiusM+1e-6)add('constraint_mismatch',[c.actorId],c.provenance,c.atMs,c.refs);
  }
  // Split at every curve boundary AND exception boundary before taking minima.
  for(let i=0;i<staged.tracks.length;i++)for(let j=i+1;j<staged.tracks.length;j++){
    const a=staged.tracks[i],b=staged.tracks[j];if(!valid.has(a.actorId)||!valid.has(b.actorId))continue;
    const exceptions=staged.duelExceptions.filter(e=>e.actorIds.includes(a.actorId)&&e.actorIds.includes(b.actorId));
    if(exceptions.some(e=>{
      const duel=staged.contacts.find(c=>c.kind==='Duel'&&e.actorIds.includes(c.actorId)&&c.relatedIds.some(id=>staged.contacts.some(s=>s.eventId===id&&s.kind==='Shot'&&s.actorId!==c.actorId&&e.actorIds.includes(s.actorId))));
      return !duel||new Set(e.actorIds).size!==2||!Number.isFinite(e.minM)||e.minM<.08||e.minM>.5
        ||e.fromMs!==Math.max(staged.fromMs,duel.atMs-250)||e.toMs!==Math.min(staged.toMs,duel.atMs+250);
    })){add('invalid_duel_exception',[a.actorId,b.actorId]);continue;}
    const boundaries=times([staged.fromMs,staged.toMs,...a.spans.map(s=>s.toMs),...b.spans.map(s=>s.toMs),...exceptions.flatMap(e=>[e.fromMs,e.toMs])]);
    for(let n=1;n<boundaries.length;n++){
      const from=boundaries[n-1],to=boundaries[n],mid=(from+to)/2;
      const x=a.spans.find(s=>s.fromMs<=mid&&s.toMs>=mid)!,y=b.spans.find(s=>s.fromMs<=mid&&s.toMs>=mid)!;
      const closest=minimumDistance(x,y,from,to);minClearanceM=Math.min(minClearanceM,closest.distance);
      const exception=exceptions.find(e=>mid>=e.fromMs&&mid<=e.toMs),minimum=exception?.minM??.5;
      if(closest.distance<minimum-1e-6)add('clearance',[a.actorId,b.actorId],`${closest.distance} m < ${minimum} m`,closest.atMs,exception?.refs??[]);
    }
  }
  return seal({accepted:!issues.some(i=>i.blocking),maxSpeed:staged.tracks.length&&Number.isFinite(maxSpeed)?maxSpeed:null,maxAcceleration:staged.tracks.length&&Number.isFinite(maxAcceleration)?maxAcceleration:null,
    minClearanceM:Number.isFinite(minClearanceM)?minClearanceM:null,issues:copy(issues)});
}

/** Offline presentation compiler. No engine, model, renderer, IO or caller-owned clock. */
export function compileStaging(source:SequenceSource,base:SequenceDepiction):StagedSequence {
  const {fromMs,toMs}=source.request,evidence=source.performanceEvidence;
  const issues:StagingIssue[]=[],constraints:StagingConstraint[]=[],contacts:StagingContact[]=[],offsets:StagingOffset[]=[],tracks:StagingTrack[]=[],solvers:StagedSequence['solvers'][number][]=[],duelExceptions:StagedSequence['duelExceptions'][number][]=[];
  let aliases:StagedSequence['aliases']=[],actorIds:string[]=[];
  const add=(code:string,actorIds:readonly string[]=[],refs:readonly string[]=[],detail?:string,atMs?:number,blocking=true)=>issues.push({code,actorIds:[...actorIds],refs:[...refs],detail,atMs,blocking});
  const key=JSON.stringify([source.key,evidence?.evidenceDigest??null,base.key,'historical-staging-1',{playerSpeed:9,playerAcceleration:4,rootEnvelopeM:.65,clearanceM:.5}]);
  const output=(accepted:boolean):StagedSequence=>{
    const ownedTracks=accepted?copy(tracks):[];
    return seal({version:'historical-staging-1',key,sourceKey:source.key,evidenceDigest:evidence?.evidenceDigest??'',fromMs,toMs,actorIds:[...actorIds],
      tracks:ownedTracks,constraints:copy(constraints),contacts:copy(contacts),offsets:copy(offsets),issues:copy(issues),aliases:copy(aliases),duelExceptions:copy(duelExceptions),solvers:copy(solvers),
      sampleRoot(id,t){return accepted&&Number.isFinite(t)&&t>=fromMs&&t<=toMs?sample(ownedTracks.find(v=>v.actorId===id)?.spans??[],t):null;}});
  };
  let prepared;
  try{
    prepared=prepareConstraints(source);
    if(base.version!=='historical-action-preview-2'||JSON.parse(base.key)[0]!==source.key)throw new Error('V2 source binding');
  }catch(e){add('invalid_source',[],[],String(e));return output(false);}
  aliases=prepared.aliases;
  if(!evidence||evidence.sourceKey!==source.key||evidence.version!=='sequence-performance-evidence-1'||!/^[a-f0-9]{64}$/.test(evidence.evidenceDigest))add('invalid_evidence');
  if(source.events.length>100||evidence&&(evidence.snapshots.length>100||evidence.actions.length>100||evidence.snapshots.some(s=>s.rows.length>22)))add('input_limit');
  if(issues.some(i=>i.blocking))return output(false);
  for(const p of prepared.issues)add(p.reason,[p.entityId],p.refs);
  for(const p of base.issues.filter(p=>p.entityId==='ball'))add('base_ball_issue',[p.entityId],p.refs,p.reason,p.fromMs);
  const entry=source.frames.find(f=>f.clock_ms===fromMs)!,exit=source.frames.find(f=>f.clock_ms===toMs)!;
  actorIds=entry.players.map(p=>p.key).sort();
  for(const f of source.frames)if(f.clock_ms>=fromMs&&f.clock_ms<=toMs){
    if(f.period!==source.request.period||f.players.length!==actorIds.length||new Set(f.players.map(p=>p.key)).size!==actorIds.length
      ||f.players.some(p=>!actorIds.includes(p.key)||!fieldPoint(p)||entry.players.find(q=>q.key===p.key)?.side!==p.side))add('invalid_frame_identity');
  }
  const events=[...source.events].filter(e=>e.elapsedMs>=fromMs&&e.elapsedMs<=toMs).sort((a,b)=>a.elapsedMs-b.elapsedMs||a.id.localeCompare(b.id));
  const byId=new Map(source.events.map(e=>[e.id,e]));
  for(const e of events){
    if(!e.actorId||!actorIds.includes(e.actorId)||!fieldPoint(e.start)){add('invalid_event_actor_or_point',e.actorId?[e.actorId]:[],e.refs);continue;}
    if(e.kind==='Pass'&&(!e.recipientId||!actorIds.includes(e.recipientId)))add('missing_receiver',[e.actorId],e.refs);
    if(['Block','Goal Keeper','Duel'].includes(e.kind)){
      const linked=e.relatedIds.map(id=>byId.get(id)).filter(s=>s?.kind==='Shot');
      if(linked.length!==1||linked[0]!.elapsedMs>e.elapsedMs)add('unlinked_contact',[e.actorId],e.refs,e.kind,e.elapsedMs);
      if(e.kind==='Duel'&&linked.length===1&&linked[0]!.actorId){
        duelExceptions.push({actorIds:[e.actorId,linked[0]!.actorId!],fromMs:Math.max(fromMs,e.elapsedMs-250),toMs:Math.min(toMs,e.elapsedMs+250),minM:.08,refs:[...e.refs,...linked[0]!.refs]});
      }
    }
    contacts.push({eventId:e.id,actorId:e.actorId,atMs:e.elapsedMs,point:{...e.start},kind:e.kind,relatedIds:[...e.relatedIds],refs:[...e.refs]});
    const envelope=['Pass','Shot','Ball Receipt*','Carry'].includes(e.kind);
    constraints.push({actorId:e.actorId,atMs:e.elapsedMs,point:{...e.start},radiusM:envelope ? .65 : 0,
      provenance:envelope?'recorded_action_envelope':'recorded_event_root',refs:[...e.refs]});
    if(e.kind==='Carry'){
      const end=prepared.actions.find(a=>a.event.id===e.id)?.presentationEndMs;
      if(end!==null&&end!==undefined&&end<=toMs&&fieldPoint(e.end))constraints.push({actorId:e.actorId,atMs:end,point:{...e.end},radiusM:.65,provenance:'recorded_action_envelope',refs:[...e.refs]});
    }
  }
  for(const snapshot of evidence!.snapshots){
    if(snapshot.period!==source.request.period||snapshot.periodMs!==snapshot.elapsedMs||!Number.isFinite(snapshot.elapsedMs)||snapshot.elapsedMs<fromMs||snapshot.elapsedMs>toMs){add('invalid_snapshot_time',[],[snapshot.eventId]);continue;}
    const seen=new Set<string>();
    for(const row of snapshot.rows){
      if(row.status!=='usable'){add(`snapshot_${row.status}_excluded`,row.playerKey?[row.playerKey]:[],row.refs,row.reason??undefined,snapshot.elapsedMs,row.status==='unresolved');continue;}
      if(!row.playerKey||!actorIds.includes(row.playerKey)||!fieldPoint(row.point)||seen.has(row.playerKey)){add('invalid_snapshot_row',row.playerKey?[row.playerKey]:[],row.refs);continue;}
      seen.add(row.playerKey);constraints.push({actorId:row.playerKey,atMs:snapshot.elapsedMs,point:{...row.point},radiusM:0,provenance:'recorded_snapshot',refs:[...row.refs]});
    }
  }
  if(issues.some(i=>i.blocking))return output(false);
  for(const person of [...entry.players].sort((a,b)=>a.key.localeCompare(b.key))){
    const actorId=person.key,owned=constraints.filter(c=>c.actorId===actorId),knots:Knot[]=[];
    if(!owned.length){
      const terminal=exit.players.find(p=>p.key===actorId)!,atMs=(fromMs+toMs)/2;
      const context:StagingConstraint={actorId,atMs,point:{x:(person.x+terminal.x)/2,y:(person.y+terminal.y)/2},radiusM:0,
        provenance:person.side===events.find(e=>e.kind==='Pass')?.side?'synthetic_support':'synthetic_cover',refs:[]};
      owned.push(context);constraints.push(context);
    }
    const entryConstraint:StagingConstraint={actorId,atMs:fromMs,point:{x:person.x,y:person.y},radiusM:0,provenance:'synthetic_entry',refs:[]};
    constraints.push(entryConstraint);
    for(const atMs of times([fromMs,...owned.map(c=>c.atMs)])){
      const group=[...owned,entryConstraint].filter(c=>c.atMs===atMs),exact=group.filter(c=>c.radiusM===0),chosen=exact[0]??group[0];
      // Recorded snapshots take precedence only over the approved action-root
      // envelope, never over another exact record. All source points survive.
      if(exact.length&&group.some(c=>distance(c.point,chosen.point)>c.radiusM+1e-6)){add('node_constraint_conflict',[actorId],group.flatMap(c=>c.refs),'Exact position outside contact envelope; no relaxation performed',atMs);continue;}
      knots.push({atMs,point:{...chosen.point},refs:[...new Set(group.flatMap(c=>c.refs))]});
    }
    if(knots.length+(knots.at(-1)?.atMs===toMs?0:1)>64){add('actor_node_limit',[actorId]);continue;}
    if(issues.some(i=>i.blocking&&i.actorIds.includes(actorId)))continue;
    const terminal=exit.players.find(p=>p.key===actorId)!;
    const target={atMs:toMs,target:{x:terminal.x,y:terminal.y}};
    const solved=owned.some(c=>c.radiusM>0)?solveStagingActor(actorId,[...owned,entryConstraint],target):
      solveActorConstraints({actorId,hardKnots:knots,softExit:knots.at(-1)?.atMs===toMs?null:target});
    solvers.push({actorId,report:solved.report});
    if(solved.report.status!=='certified'){add(`actor_${solved.report.status}`,[actorId],knots.flatMap(k=>k.refs??[]),solved.report.analyticCertificate??solved.report.reasons.join(','));continue;}
    const constrained=owned.some(c=>c.provenance.startsWith('recorded_'));
    tracks.push({actorId,side:person.side,provenance:constrained?'synthetic_constrained':owned[0].provenance==='synthetic_support'?'synthetic_support':'synthetic_cover',spans:solved.spans});
    for(const c of contacts.filter(c=>c.actorId===actorId)){
      const root=sample(solved.spans,c.atMs)!;offsets.push({actorId,eventId:c.eventId,atMs:c.atMs,point:{...c.point},root,offsetM:distance(root,c.point),provenance:'illustrative_contact_root'});
    }
  }
  if(issues.some(i=>i.blocking))return output(false);
  const report=inspectStaging(output(true));
  issues.push(...report.issues.filter(i=>i.blocking));
  return output(report.accepted);
}
