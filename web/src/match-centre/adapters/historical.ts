import { readCapabilities, readMatch, readManifest, readEvents, readSegment, readStatistics, type HistoricalCapabilities, type HistoricalMatch, type HistoricalEvent, type HistoricalStatistics,
  type ReconstructionManifest, type ReconstructionSegment, type ReconstructionFrame } from '../../historical/api';
import type { SceneFrame, VisualCue } from '../../match/retroScene';
import { cursorAt, type EventView, type MatchCursor, type MatchSection, type MatchSessionAdapter, type MotionInterval, type PanelData, type SessionDemand, type SessionDescriptor } from '../session';
import { available, blankSnapshot, clamp, descriptor, detail, emptyPanel, guard, missing, ns, ReadPool, splitFacts, StatisticsQueue, store } from './base';
import { normalizeHistoricalMetrics } from './metrics';
import { normalizeSequenceEvent, validateSequenceEvents } from '../sequence/evidence';
import { normalizePerformanceEvidence } from '../sequence/performance-evidence';
import { validatePilot } from '../sequence/pilot';
import type { SequenceSource } from '../sequence/types';

export type HistoricalReaders = {capabilities:typeof readCapabilities;match:typeof readMatch;manifest:typeof readManifest;events:typeof readEvents;segment:typeof readSegment;statistics:typeof readStatistics};
type Timeline = Pick<HistoricalStatistics,'goals'|'score'>;
const before=(a:{period:number;period_ms:number},b:MatchCursor)=>a.period<b.period||(a.period===b.period&&a.period_ms<=b.periodMs);
const defaults:HistoricalReaders={capabilities:readCapabilities,match:readMatch,manifest:readManifest,events:readEvents,segment:readSegment,statistics:readStatistics};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

export function createHistoricalSession(matchId:number,datasetVersion:string,options:{readers?:Partial<HistoricalReaders>;now?:()=>number}={}) {
  const identity={source:'historical' as const,id:String(matchId),revision:datasetVersion};
  let d=descriptor(identity,{id:'',name:''},{id:'',name:''},null,null);
  const state=store(blankSnapshot(d)),identities=new ReadPool<HistoricalCapabilities>(1),matches=new ReadPool<HistoricalMatch>(1),manifests=new ReadPool<ReconstructionManifest>(1),
    segments=new ReadPool<ReconstructionSegment>(3,4*1024*1024),windows=new ReadPool<HistoricalEvent[]>(3,12*1024*1024),goals=new ReadPool<Timeline>(2);
  const queue=new StatisticsQueue<HistoricalStatistics>(options.now);
  const sequences=new ReadPool<SequenceSource>(1,12*1024*1024);
  let resource:{match:HistoricalMatch;manifest:ReconstructionManifest|null}|null=null;
  let generation=0,panelGeneration=0,eventGeneration=0,statisticsFailed=false;
  let lastPanel:{section:MatchSection;ms:number;final:boolean;demand:SessionDemand}|null=null;
  let lastContext:SessionDemand={playback:'paused'},lastStats:HistoricalStatistics|null=null,finalStats:HistoricalStatistics|null=null;
  let windowDemand:{key:string;control:AbortController}|null=null,manualControl:AbortController|null=null;
  const statisticsError=new Error('statistics_failed_retry_required');

  async function metadata(signal:AbortSignal) {
    guard(signal,state.disposed);if(resource)return resource;
    await identities.get(datasetVersion,signal,async s=>{const caps=await(options.readers?.capabilities??defaults.capabilities)(s);
      if(caps.dataset_version!==datasetVersion)throw new Error('Historical dataset identity changed');return caps;});
    const match=await matches.get(datasetVersion,signal,s=>(options.readers?.match??defaults.match)(matchId,s));
    if(match.id!==matchId)throw new Error('Historical match identity changed');
    let manifest:ReconstructionManifest|null=null;
    try {manifest=await manifests.get(datasetVersion,signal,async s=>{
      const value=await(options.readers?.manifest??defaults.manifest)(matchId,s);
      if(value.match_id!==matchId||value.dataset_version!==datasetVersion)throw new Error('Reconstruction identity changed');return value;
    });}catch(error){guard(signal,state.disposed);}
    guard(signal,state.disposed);
    let offset:number|null=0;
    const periods=(match.clock?.periods??[]).map((p,index)=>{
      const duration=p.duration_ms!==null&&Number.isFinite(p.duration_ms)&&p.duration_ms>=0?p.duration_ms:null;
      const start:number|null=p.period===index+1&&p.playback_start_ms!==null&&offset===p.playback_start_ms?offset:null;
      const result={period:p.period,startMs:start,durationMs:duration};offset=start===null||duration===null?null:start+duration;return result;
    });
    d={...d,home:{id:match.home_team.key,name:match.home_team.name,crestUrl:null,season:match.season_name},away:{id:match.away_team.key,name:match.away_team.name,crestUrl:null,season:match.season_name},
      durationMs:periods.length?offset:null,periods,capabilities:{...d.capabilities,layers:['synthetic','anchors','cuts']},
      metadata:{source:'StatsBomb Open Data',date:match.date,kickOff:match.kick_off,season:match.season_name,dataset:datasetVersion,reconstruction:manifest?.reconstruction_id??null,
        profile:manifest?.profile??null,clockBasis:'source_period_local',permission:'local_only_distribution_blocked',issues:[...match.issues??[],...manifest?.issues??[]],
        playerIdentities:match.lineups?.flatMap(l=>l.players.map(p=>({sourceId:p.source_id,key:p.key,teamKey:l.team_key})))??[],
        finalResult:{score:match.final_score,scope:'final',provenance:'source_recorded'}}};
    resource={match,manifest};return resource;
  }
  function elapsed(period:number,ms:number):number|null {const p=d.periods.find(v=>v.period===period);return p?.startMs==null?null:p.startMs+ms;}
  function validateStats(data:HistoricalStatistics,period:number,ms:number) {
    if(data.match_id!==matchId||data.dataset_version!==datasetVersion||data.cutoff.period!==period||data.cutoff.period_ms!==Math.floor(ms))throw new Error('Statistics identity/cutoff changed');return data;
  }
  async function statistics(period:number,ms:number,key:string,signal:AbortSignal) {
    if(statisticsFailed)throw statisticsError;
    try{return await queue.request(key,async s=>validateStats(await(options.readers?.statistics??defaults.statistics)(matchId,period,ms,datasetVersion,s),period,ms),signal);}
    catch(error){if(!signal.aborted&&!state.disposed&&!(error instanceof DOMException&&error.name==='AbortError'))statisticsFailed=true;throw error;}
  }
  function windowKey(period:number,from:number,to:number) {return `${datasetVersion}/${matchId}/${period}/${from}/${to}`;}
  async function events(period:number,from:number,to:number,signal:AbortSignal,maxItems=Infinity) {
    if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||to-from>60000)throw new Error('Event window must be at most60 seconds');
    const items=await windows.get(windowKey(period,from,to),signal,async s=>{
      const result=await(options.readers?.events??defaults.events)(matchId,period,from,to,datasetVersion,s,maxItems);
      if(result.some(e=>e.period!==period||e.period_ms<from||e.period_ms>=to))throw new Error('Event window identity changed');
      return [...result].sort((a,b)=>a.period_ms-b.period_ms||a.source_index-b.source_index);
    });
    if(items.length>maxItems)throw new Error('Sequence event count limit');
    return items;
  }
  async function segment(reference:ReconstructionManifest['segments'][number],signal:AbortSignal) {
    return segments.get(segmentKey(reference),signal,async s=>{
      const result=await(options.readers?.segment??defaults.segment)(matchId,reference.period,reference.index,s);
      if(result.match_id!==matchId||result.reconstruction_id!==resource!.manifest!.reconstruction_id||result.period!==reference.period||result.index!==reference.index
        ||result.from_ms!==reference.from_ms||result.to_ms!==reference.to_ms)throw new Error('Segment identity/bounds changed');
      return result;
    });
  }
  function segmentKey(reference:ReconstructionManifest['segments'][number]) {return `${datasetVersion}/${resource!.manifest!.reconstruction_id}/${matchId}/${reference.period}/${reference.index}`;}
  function referenceAt(cursor:MatchCursor) {return resource?.manifest?.segments.find(s=>s.period===cursor.period&&cursor.periodMs>=s.from_ms&&(cursor.periodMs<s.to_ms||cursor.periodMs===s.to_ms&&d.periods.find(p=>p.period===s.period)?.durationMs===s.to_ms));}
  function scoreAt(timeline:Timeline|null,cursor:MatchCursor) {
    if(!timeline?.score)return null;
    const reached=timeline.goals.filter(g=>before(g.at,cursor));
    return {home:reached.filter(g=>g.team_key===resource!.match.home_team.key).length,away:reached.filter(g=>g.team_key===resource!.match.away_team.key).length};
  }
  function normalizeEvents(items:readonly HistoricalEvent[]):EventView[] {
    const match=resource!.match;
    return items.map(e=>{
      const pass=object(e.details?.pass),recipient=object(e.type==='Substitution'?object(e.details?.substitution).replacement:pass.recipient),key=match.lineups?.flatMap(l=>l.players).find(p=>p.source_id===recipient.id)?.key;
      const side=e.team_key===match.home_team.key?'home':e.team_key===match.away_team.key?'away':null;
      const outcome=object(object(e.details?.shot).outcome).name??object(pass.outcome).name??null;
      return {id:ns('historical',e.id),sourceIndex:e.source_index,kind:e.type,period:e.period,periodMs:e.period_ms,elapsedMs:elapsed(e.period,e.period_ms),side,
        actorId:e.player_key?ns('historical',e.player_key):null,participantIds:[...new Set([e.player_key,key].filter((v):v is string=>!!v))].map(k=>ns('historical',k)),
        outcome:typeof outcome==='string'?outcome:null,provenance:'source_recorded',refs:[e.id],details:{...e.details,source:{...e}}};
    });
  }
  function expand(f:ReconstructionFrame,score:SceneFrame['score']):SceneFrame {
    const names=new Map(resource!.match.lineups?.flatMap(l=>l.players.map(p=>[p.key,p.name] as const)));
    const roster=resource!.manifest!.roster;
      const counts=new Map<number,number>();for(const [id] of f.players)counts.set(id,(counts.get(id)??0)+1);
      return {clock_ms:elapsed(f.period,f.period_ms)!,period:f.period,score,possession:null,carrier:null,ball:f.ball?{x:f.ball[0],y:f.ball[1]}:null,
        players:f.players.flatMap(([index,x,y])=>{
          const people=roster.filter(p=>p.index===index);if(people.length!==1||counts.get(index)!==1)return [];
          const person=people[0];if(roster.filter(p=>p.key===person.key).length!==1)return [];
          const side=person.team_key===resource!.match.home_team.key?'home':person.team_key===resource!.match.away_team.key?'away':null;
          return side?[{key:ns('historical',person.key),name:names.get(person.key)??person.key,side,role:'MID' as const,x,y}]:[];
        })};
  }
  function interval(data:ReconstructionSegment|null,cursor:MatchCursor,timeline:Timeline|null,sourceEvents:readonly HistoricalEvent[]):MotionInterval|null {
    if(!data||elapsed(cursor.period,cursor.periodMs)===null)return null;
    const offset=elapsed(cursor.period,0)!;
    const frames=data.frames.filter(f=>f.period===cursor.period&&f.period_ms>=data.from_ms&&f.period_ms<=data.to_ms);
    let index=-1;for(let i=0;i<frames.length;i++){if(frames[i].period_ms<=cursor.periodMs)index=i;else break;}
    if(index<0)return null;
    const a=frames[index],b=frames[index+1];
    const from=a.period_ms,to=b?.period_ms??data.to_ms;
    const cuts=data.cuts.filter(c=>c.period===cursor.period&&(c.from_ms<to&&c.to_ms>from||c.from_ms===c.to_ms&&c.from_ms>from&&c.from_ms<=to));
    const blocked=new Set(cuts.map(c=>c.entity_key)),beforeFrame=expand(a,scoreAt(timeline,cursor)),afterFrame=b?expand(b,scoreAt(timeline,cursor)):null;
    const motion:MotionInterval={fromMs:cursor.periodMs===data.to_ms?cursor.elapsedMs:offset+from,toMs:offset+to,before:beforeFrame,after:afterFrame,
      continuousPlayers:new Set(!blocked.has('all')&&afterFrame?beforeFrame.players.filter(p=>!blocked.has(p.key.slice('historical:'.length))&&afterFrame.players.some(q=>q.key===p.key)).map(p=>p.key):[]),
      continuousBall:!!b&&!blocked.has('all')&&!blocked.has('ball')};
    return splitFacts(motion,cursor.elapsedMs,[...sourceEvents.map(e=>elapsed(e.period,e.period_ms)),...data.cuts.flatMap(c=>[elapsed(c.period,c.from_ms),elapsed(c.period,c.to_ms)])].filter((v):v is number=>v!==null));
  }
  function layers(data:ReconstructionSegment|null,cursor:MatchCursor) {
    return {anchors:(data?.anchors??[]).filter(a=>a.period===cursor.period&&a.period_ms!==null&&a.period_ms<=cursor.periodMs).map(a=>({
      id:a.id,eventId:a.event_id,entityId:a.entity_key==='ball'?null:ns('historical',a.entity_key),elapsedMs:a.period_ms===null?null:elapsed(a.period,a.period_ms),
      point:a.location,status:a.status,reason:a.reason??null,refs:[a.event_id],details:{...a}})),
      cuts:(data?.cuts??[]).filter(c=>c.from_ms<=cursor.periodMs).map(c=>({id:c.id,fromMs:elapsed(c.period,c.from_ms),toMs:elapsed(c.period,c.to_ms),entityIds:c.entity_key==='all'?'all' as const:[c.entity_key==='ball'?'ball':ns('historical',c.entity_key)],reason:c.reason,refs:c.event_ids??[]}))};
  }
  function panelsBefore(cursor:MatchCursor) {
    const result={...state.snapshot().panels};
    for(const key of Object.keys(result) as MatchSection[]){const p=result[key];if(p?.scope==='cursor'&&p.cutoff&&(p.cutoff.period>cursor.period||p.cutoff.period===cursor.period&&p.cutoff.periodMs>cursor.periodMs))delete result[key];}
    return result;
  }
  const adapter:MatchSessionAdapter&{retry:(ms:number,signal:AbortSignal)=>Promise<void>;cacheUsage:()=>{segments:number;segmentBytes:number}}={
    identity,snapshot:state.snapshot,subscribe:state.subscribe,
    async loadSequence(request,signal) {
      await metadata(signal);guard(signal,state.disposed);validatePilot(d,request);
      const key=JSON.stringify([identity,resource!.manifest?.reconstruction_id,request]);
      const source=await sequences.get(key,signal,async s=>{
        const manifest=resource!.manifest;if(!manifest)throw new Error('Sequence motion unavailable');
        const from=Math.max(0,request.fromMs-2000),to=Math.min(d.periods[0].durationMs!,request.toMs+2000);
        const refs=manifest.segments.filter(ref=>ref.period===request.period&&ref.from_ms<=to&&ref.to_ms>=from);
        if(!refs.length||refs.length>3||refs.some(ref=>ref.bytes>4*1024*1024))throw new Error('Sequence segment limit/unavailable');
        const [raw,data]=await Promise.all([events(request.period,from,to,s,100),Promise.all(refs.map(ref=>segment(ref,s)))]);
        guard(s,state.disposed);
        const normalized=validateSequenceEvents(raw.map(e=>normalizeSequenceEvent(e,d)));
        const eventIds=new Set(normalized.map(e=>e.id));
        for(const event of normalized){
          const original=raw.find(r=>`historical:${r.id}`===event.id)!;
          if(original.player_key!==null&&event.actorId===null||original.team_key!==null&&event.side===null)throw new Error('Sequence actor/team unresolved');
          if(object(object(original.details?.pass).recipient).id!=null&&event.recipientId===null)throw new Error('Sequence recipient unresolved');
          if(event.relatedIds.some(id=>!eventIds.has(id))||event.assistedShotId!==null&&!eventIds.has(event.assistedShotId))throw new Error('Sequence relation outside bounded source');
        }
        const frames=data.flatMap(segment=>segment.frames.filter(f=>f.period===request.period&&f.period_ms>=from&&f.period_ms<=to).map(f=>{
          const frame=expand(f,null);
          if(frame.players.length!==f.players.length||frame.players.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Sequence roster/coordinates ambiguous');
          return frame;
        })).sort((a,b)=>a.clock_ms-b.clock_ms);
        if(!frames.length)throw new Error('Sequence frames unavailable');
        const cuts=data.flatMap(segment=>segment.cuts.filter(c=>c.period===request.period&&c.from_ms<=to&&c.to_ms>=from).map(c=>({
          id:c.id,fromMs:elapsed(c.period,c.from_ms),toMs:elapsed(c.period,c.to_ms),entityIds:c.entity_key==='all'?'all' as const:[c.entity_key==='ball'?'ball':ns('historical',c.entity_key)],reason:c.reason,refs:[...c.event_ids??[]],
        })));
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({events:normalized,frames,cuts})));
        guard(s,state.disposed);
        const rawDigest=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        const key=JSON.stringify([identity,manifest.reconstruction_id,rawDigest,request]);
        const performanceEvidence=await normalizePerformanceEvidence(raw,{...d,metadata:{...d.metadata,performanceContext:{
          sourceKey:key,rawDigest,motionRevision:manifest.reconstruction_id,request:{...request},
          participants:frames.map(f=>({period:f.period,periodMs:f.clock_ms-d.periods.find(p=>p.period===f.period)!.startMs!,
            playerKeys:f.players.map(p=>p.key.replace(/^historical:/,''))})),
        }}});
        guard(s,state.disposed);
        const value:SequenceSource={key,identity:{...identity},motionRevision:manifest.reconstruction_id,rawDigest,request:{...request},events:normalized,frames,cuts,performanceEvidence};
        // Seal only owned copies. Cached geometry must keep the digest it was keyed by.
        const seal=(v:unknown):void=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(seal);Object.freeze(v);}};
        seal(value);return value;
      });
      guard(signal,state.disposed);state.publish({...state.snapshot(),descriptor:d});return source;
    },
    async ensure(ms,signal,context={playback:'paused'}) {
      const caller=signal;
      guard(signal,state.disposed);const serial=++generation;eventGeneration++;manualControl?.abort();lastContext=context;
      try {
        await metadata(signal);guard(signal,state.disposed);
        if(serial!==generation)return;
        const mapped=cursorAt(d,d.durationMs===null?0:clamp(ms,d.durationMs),context.endingPeriod);
        if(context.endingPeriod!==undefined&&mapped.period===0)throw new Error('Ending-period boundary unavailable');
        const cursor=mapped.period===0?{...mapped,period:resource!.match.clock?.periods[0]?.period??1}:mapped;
        const previous=cursorAt(d,Math.max(0,cursor.elapsedMs-100));
        const from=Math.floor(cursor.periodMs/60000)*60000,to=from+60000;
        const key=windowKey(cursor.period,from,to);
        if(windowDemand?.key!==key){windowDemand?.control.abort();windowDemand={key,control:new AbortController()};}
        signal=AbortSignal.any([signal,windowDemand.control.signal]);
        const ref=referenceAt(cursor),previousRef=referenceAt(previous);
        const metadataPanel=normalizeHistoricalMetrics(resource!.match,null),old=state.snapshot();
        if(serial===generation){
          if(context.explicitSeek||cursor.elapsedMs<(lastPanel?.ms??0))panelGeneration++;
          state.publish({...old,descriptor:d,requestedCursor:cursor,panels:{players:metadataPanel,data:metadataPanel,...panelsBefore(cursor)},loadState:'buffering',reason:null});
        }
        const extent=d.periods.find(p=>p.period===cursor.period)?.durationMs;
        const goalCut=Math.min(extent??to-1,to-1);
        const [sourceEvents,motion,prior,timeline]=await Promise.all([
          events(cursor.period,from,to,signal).then(value=>({value,error:false})).catch(error=>{guard(signal,state.disposed);return {value:[] as HistoricalEvent[],error:true};}),
          ref?segment(ref,signal).catch(error=>{guard(signal,state.disposed);return null;}):Promise.resolve(null),
          // Missing previous poses must not hold the requested destination hostage.
          // Cached source data is sufficient; otherwise the common hook marks a restart.
          Promise.resolve(previousRef?segments.peek(segmentKey(previousRef))??null:null),
          goals.get(windowKey(cursor.period,from,to),signal,async s=>{
            const data=await statistics(cursor.period,goalCut,`goals:${cursor.period}:${from}`,s);if(!data)throw statisticsError;
            return {score:data.score,goals:data.goals};
          }).catch(error=>{guard(signal,state.disposed);return null;}),
        ]);
        guard(signal,state.disposed);if(serial!==generation)return;
        const currentInterval=interval(motion,cursor,timeline,sourceEvents.value),priorInterval=interval(prior??motion,previous,timeline,sourceEvents.value);
        const reached=normalizeEvents(sourceEvents.value.filter(e=>e.period_ms<=cursor.periodMs));
        const lastGoal=timeline?.goals.filter(g=>{const time=elapsed(g.at.period,g.at.period_ms);return time!==null&&before(g.at,cursor)&&time>=cursor.elapsedMs-900;}).at(-1);
        const actor=lastGoal?.player_key??lastGoal?.own_goal_player_key;
        let cue:VisualCue|undefined;
        if(lastGoal&&actor&&(lastGoal.team_key===resource!.match.home_team.key||lastGoal.team_key===resource!.match.away_team.key))cue={type:'goal',participants:[ns('historical',actor)],side:lastGoal.team_key===resource!.match.home_team.key?'home':'away',t1_ms:elapsed(lastGoal.at.period,lastGoal.at.period_ms)!};
        else {const action=reached.filter(e=>e.actorId&&e.side&&e.elapsedMs!==null&&cursor.elapsedMs-e.elapsedMs<250&&(e.kind==='Pass'||e.kind==='Shot')).at(-1);
          if(action)cue={type:action.kind==='Pass'?'pass':'shot',participants:[action.actorId!],side:action.side,t1_ms:action.elapsedMs!};}
        const score=scoreAt(timeline,cursor),latest=state.snapshot();
        state.publish({...latest,descriptor:d,requestedCursor:cursor,presentedCursor:cursor,interval:currentInterval,previousInterval:priorInterval,cue,clockMs:cursor.periodMs,
          milestones:timeline?.goals.filter(g=>before(g.at,cursor)).map(g=>{
            const actor=g.player_key??g.own_goal_player_key;
            return {id:ns('historical',g.event_ids[0]??`${g.at.period}:${g.at.period_ms}:${g.team_key}`),sourceIndex:reached.find(e=>e.refs.some(ref=>g.event_ids.includes(ref)))?.sourceIndex??null,
              kind:'goal',period:g.at.period,periodMs:g.at.period_ms,elapsedMs:elapsed(g.at.period,g.at.period_ms),side:g.team_key===resource!.match.home_team.key?'home':g.team_key===resource!.match.away_team.key?'away':null,
              actorId:actor?ns('historical',actor):null,participantIds:actor?[ns('historical',actor)]:[],outcome:g.kind,provenance:'derived_from_events',refs:g.event_ids,details:{...g}};
          })??[],
          facts:{score:{value:score,provenance:score?'derived_from_events':'unavailable',refs:timeline?.goals.filter(g=>before(g.at,cursor)).flatMap(g=>g.event_ids)??[]},
            possession:{value:null,provenance:'unavailable',refs:[]},carrierId:{value:null,provenance:'unavailable',refs:[]}},events:reached,
          eventWindow:{period:cursor.period,fromMs:from,toMs:to,mode:'cursor',availability:sourceEvents.error?missing('events_unavailable'):available()},layers:layers(motion,cursor),
          loadState:sourceEvents.error?'unavailable':currentInterval?'ready':'facts_only',reason:sourceEvents.error?'source_events_unavailable':!currentInterval?'synthetic_motion_unavailable':null,horizonMs:d.durationMs??cursor.elapsedMs});
      }catch(error){if(caller.aborted||state.disposed)throw error;if(signal.aborted)return;if(serial===generation)state.publish({...state.snapshot(),descriptor:d,loadState:'unavailable',reason:'source_metadata_unavailable'});}
    },
    async loadPanel(section,ms,final,signal,context=lastContext) {
      guard(signal,state.disposed);const serial=++panelGeneration;lastPanel={section,ms,final,demand:context};
      try {
        await metadata(signal);guard(signal,state.disposed);
        const target=cursorAt(d,clamp(ms,d.durationMs),context.endingPeriod);const last=d.periods.at(-1);
        if(context.endingPeriod!==undefined&&target.period===0)throw new Error('Ending-period boundary unavailable');
        const period=final?last?.period??target.period:target.period;
        const exact=final?last?.durationMs:target.periodMs;
        if(exact===null||exact===undefined){const panel=normalizeHistoricalMetrics(resource!.match,null);panel.scope=final?'final':'cursor';
          if(serial===panelGeneration)state.publish({...state.snapshot(),descriptor:d,panels:{...state.snapshot().panels,[section]:panel}});return;}
        const cutoff=final||context.playback==='paused'||context.explicitSeek?Math.floor(exact):Math.floor(exact/5000)*5000;
        // Invalidate future data immediately on explicit backwards analysis/seek.
        if(lastStats&&(lastStats.cutoff.period>period||lastStats.cutoff.period===period&&lastStats.cutoff.period_ms>cutoff))lastStats=null;
        const cached=final?finalStats:lastStats;
        let data=cached?.cutoff.period===period&&cached.cutoff.period_ms===cutoff?cached:null;
        if(!data)data=await statistics(period,cutoff,'panel',signal)??null;
        guard(signal,state.disposed);if(serial!==panelGeneration||!data)return;
        if(final)finalStats=data;else lastStats=data;
        const panel=normalizeHistoricalMetrics(resource!.match,data);panel.scope=final?'final':'cursor';
        if(panel.cutoff)panel.cutoff={...panel.cutoff,elapsedMs:elapsed(period,cutoff)??0};
        state.publish({...state.snapshot(),descriptor:d,panels:{...state.snapshot().panels,[section]:panel}});
      }catch(error){if(signal.aborted||state.disposed)return;
        if(serial===panelGeneration)state.publish({...state.snapshot(),panels:{...state.snapshot().panels,[section]:emptyPanel('statistics_unavailable_retry_required')}});}
    },
    async loadPlayer(playerId,signal){guard(signal,state.disposed);await metadata(signal);guard(signal,state.disposed);
      const panel=state.snapshot().panels.players??normalizeHistoricalMetrics(resource!.match,null),item=panel.players.find(p=>p.id===playerId);
      if(item)state.publish({...state.snapshot(),panels:{...state.snapshot().panels,players:{...panel,playerDetails:[...panel.playerDetails.filter(p=>p.id!==playerId),item]}}});},
    async loadEvents(period,from,to,signal){guard(signal,state.disposed);manualControl?.abort();manualControl=new AbortController();
      signal=AbortSignal.any([signal,manualControl.signal]);const serial=++eventGeneration;
      try {await metadata(signal);const result=await events(period,from,to,signal);guard(signal,state.disposed);if(serial!==eventGeneration)return;
        state.publish({...state.snapshot(),descriptor:d,events:normalizeEvents(result),eventWindow:{period,fromMs:from,toMs:to,mode:'manual',availability:available()}});
      }catch(error){if(signal.aborted||state.disposed)return;if(serial===eventGeneration)state.publish({...state.snapshot(),eventWindow:{period,fromMs:from,toMs:to,mode:'manual',availability:missing('events_unavailable')}});}},
    async retry(ms,signal){for(const pool of [identities,matches,manifests,segments,windows,goals,sequences])pool.clearFailures();statisticsFailed=false;resource=null;
      await adapter.ensure(ms,signal,{playback:'paused',explicitSeek:true});if(lastPanel)await adapter.loadPanel(lastPanel.section,lastPanel.ms,lastPanel.final,signal,lastPanel.demand);},
    cacheUsage:()=>({segments:segments.size,segmentBytes:segments.bytes}),
    dispose(){generation++;panelGeneration++;eventGeneration++;windowDemand?.control.abort();manualControl?.abort();state.dispose();queue.dispose();for(const pool of [identities,matches,manifests,segments,windows,goals,sequences])pool.dispose();},
  };
  return adapter;
}
