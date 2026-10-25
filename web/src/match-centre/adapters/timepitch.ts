import { getStatistics, type MatchRecord, type MatchRecordV2, type RenderFrame, type StatisticsBundle, type TeamSeason } from '../../api';
import type { SceneFrame } from '../../match/retroScene';
import { cursorAt, type MotionInterval, type SessionSnapshot } from '../session';
import { blankSnapshot, clamp, descriptor, ns, splitFacts } from './base';
import { normalizeTimePitchMetrics } from './metrics';
import { savedSession } from './saved';

function upper<T>(items:readonly T[],time:number,key:(item:T)=>number) {
  let lo=0,hi=items.length;while(lo<hi){const mid=(lo+hi)>>>1;if(key(items[mid])<=time)lo=mid+1;else hi=mid;}return lo-1;
}
function expand(frame:RenderFrame):SceneFrame {
  return {...frame,players:frame.players.map(p=>({...p,key:ns('timepitch',p.key)})),carrier:frame.carrier?ns('timepitch',frame.carrier):null};
}
function spatialFrame(record:MatchRecordV2,index:number):SceneFrame {
  const s=record.motion[index];return {clock_ms:s[0],period:s[1],score:{home:s[2],away:s[3]},possession:s[4]===0?'home':'away',
    carrier:s[5]>=0&&record.initial_frame.players[s[5]]?ns('timepitch',record.initial_frame.players[s[5]].key):null,
    ball:{x:s[8]/1000,y:s[9]/1000},players:record.initial_frame.players.map((p,i)=>({...p,key:ns('timepitch',p.key),x:s[10][2*i]/1000,y:s[10][2*i+1]/1000}))};
}

export function createTimePitchSession(id:string,record:MatchRecord,readers:{statistics?:typeof getStatistics;team?:(id:string,signal:AbortSignal)=>Promise<TeamSeason>}={}) {
  const spatial='format_version' in record&&record.format_version===2?record:null;
  const duration=spatial?.motion.at(-1)?.[0]??record.events.filter(e=>e.type==='fulltime').at(-1)?.t1_ms??5400000;
  const d=descriptor({source:'timepitch',id,revision:record.trace_hash},{id:record.config.home_key,name:record.home_name},{id:record.config.away_key,name:record.away_name},duration,`/api/matches/${encodeURIComponent(id)}/replay`);
  for(const side of ['home','away'] as const){const year=Number(record.config[`${side}_key`].split(':')[1]);d[side]={...d[side],formation:record.config[`${side}_formation`],...(d[side].crestUrl&&Number.isInteger(year)?{season:`${year}/${String(year+1).slice(-2)}`}:{})};}
  const markers=spatial?spatial.motion.map(s=>({period:s[1],time:s[0]})):[{period:record.initial_frame.period,time:0},...record.events.map(e=>({period:'period' in e?e.period:e.frame_after.period,time:e.t1_ms}))];
  const starts=[...new Set(markers.map(m=>m.period))].map(period=>({period,startMs:markers.find(m=>m.period===period)!.time,durationMs:null as number|null}));
  d.periods=starts.map((p,i)=>({...p,durationMs:(starts[i+1]?.startMs??duration)-p.startMs}));
  d.metadata={engine:record.engine_version,rules:record.rules_version,ratings:record.ratings_version,dataset:record.dataset_version,seed:record.seed,hash:record.trace_hash,legacy:!spatial,config:record.config,clockBasis:'recorded_elapsed',completed:record.events.some(e=>e.type==='fulltime')};
  function interval(time:number):MotionInterval {
    if(spatial){
      const i=Math.max(0,upper(spatial.motion,time,s=>s[0])),a=spatial.motion[i],b=spatial.motion[i+1];
      const before=spatialFrame(spatial,i),after=b?spatialFrame(spatial,i+1):null;
      const live=!!b&&b[7]===0&&b[0]>a[0]&&a[1]===b[1];
      return {fromMs:a[0],toMs:b?.[0]??duration,before,after,continuousPlayers:new Set(live?before.players.map(p=>p.key):[]),continuousBall:live};
    }
    const legacy=record as Exclude<MatchRecord,MatchRecordV2>;
    const i=upper(legacy.events,time,e=>e.t1_ms),before=expand(i>=0?legacy.events[i].frame_after:legacy.initial_frame),next=legacy.events[i+1];
    const start=i>=0?legacy.events[i].t1_ms:0;
    if(!next)return {fromMs:start,toMs:duration,before,after:null,continuousPlayers:new Set(),continuousBall:false};
    if(time<next.t0_ms)return {fromMs:start,toMs:next.t0_ms,before,after:null,continuousPlayers:new Set(),continuousBall:false};
    const after=expand(next.frame_after),live=next.t1_ms>next.t0_ms&&before.period===after.period;
    return {fromMs:next.t0_ms,toMs:next.t1_ms,before,after,continuousPlayers:new Set(live?before.players.map(p=>p.key):[]),continuousBall:live};
  }
  function resolve(ms:number):SessionSnapshot {
    const time=clamp(ms,duration),cursor=cursorAt(d,time),motion=splitFacts(interval(time),time,record.events.map(e=>e.t1_ms));
    const reached=record.events.map((event,index)=>({event,index})).filter(({event})=>event.t1_ms<=time);
    const events=reached.map(({event:e,index})=>({id:ns('timepitch',e.id),sourceIndex:index,kind:e.type,period:'period' in e?e.period:cursorAt(d,e.t1_ms).period,
      periodMs:cursorAt(d,e.t1_ms).periodMs,elapsedMs:e.t1_ms,side:e.side??null,actorId:e.participants[0]?ns('timepitch',e.participants[0]):null,
      participantIds:e.participants.map(p=>ns('timepitch',p)),outcome:e.outcome,provenance:'simulated' as const,refs:[e.id],details:{...e}}));
    const known=new Set(record.initial_frame.players.map(p=>p.key));
    const visual=reached.map(({event})=>event).filter(e=>e.side&&e.participants[0]&&known.has(e.participants[0]));
    const cue=visual.filter(e=>e.type==='goal'&&time-e.t1_ms<900).at(-1)??visual.filter(e=>(e.type==='pass'||e.type==='shot')&&time-e.t1_ms<250).at(-1);
    return {...blankSnapshot(d),requestedCursor:cursor,presentedCursor:cursor,interval:motion,previousInterval:splitFacts(interval(Math.max(0,time-100)),Math.max(0,time-100),record.events.map(e=>e.t1_ms)),clockMs:time,
      facts:{score:{value:motion.before.score,provenance:'simulated',refs:events.filter(e=>e.kind==='goal').flatMap(e=>e.refs)},possession:{value:motion.before.possession,provenance:'simulated',refs:[]},carrierId:{value:motion.before.carrier,provenance:motion.before.carrier?'simulated':'unavailable',refs:[]}},
      cue:cue?{type:cue.type,participants:cue.participants.map(p=>ns('timepitch',p)),t1_ms:cue.t1_ms,side:cue.side}:undefined,
      events,milestones:events.filter(e=>['goal','halftime','fulltime'].includes(e.kind)),panels:{players:metadataPanel,data:metadataPanel},loadState:'ready',horizonMs:duration};
  }
  const metadataPanel=normalizeTimePitchMetrics(record,null,0);
  return savedSession<StatisticsBundle>({descriptor:d,resolve,dataset:record.dataset_version,team:readers.team,
    metadata:()=>normalizeTimePitchMetrics(record,null,0),statisticsAt:(ms,final)=>Math.min(duration,Math.floor((final?duration:ms)/250)*250),
    readStatistics:async(ms,signal)=>{
      const persisted=spatial?.statistics;if(ms===duration&&persisted&&persisted.end_ms===ms)return persisted;
      const data=await(readers.statistics??getStatistics)(id,ms,signal);if(data.end_ms!==ms)throw new Error('Statistics cutoff changed');return data;
    },normalize:(data,ms)=>normalizeTimePitchMetrics(record,data,ms)});
}
