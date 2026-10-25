import { getGrfStatistics, UnsupportedGrfReplayError, type GrfReplay, type GrfStatisticsSummary, type TeamSeason } from '../../api';
import { cursorAt, type EventView, type MotionInterval, type SessionSnapshot } from '../session';
import type { SceneFrame } from '../../match/retroScene';
import { available, blankSnapshot, clamp, descriptor, ns } from './base';
import { normalizeGrfMetrics } from './metrics';
import { savedSession } from './saved';

const point=(xy:readonly number[])=>({x:(xy[0]+1)*52.5,y:(xy[1]+.42)*68/.84});
const distance=(a:readonly number[],b:readonly number[])=>Math.hypot((a[0]-b[0])*52.5,(a[1]-b[1])*68/.84);
export function createGrfSession(id:string,record:GrfReplay,readers:{statistics?:typeof getGrfStatistics;team?:(id:string,signal:AbortSignal)=>Promise<TeamSeason>}={}) {
  if(!['grf-experimental-1','grf-experimental-2','grf-experimental-3'].includes(record.schema_version))throw new UnsupportedGrfReplayError();
  const d=descriptor({source:'grf',id,revision:record.trace_hash},{id:record.input.config.home_key,name:record.input.home_name},{id:record.input.config.away_key,name:record.input.away_name},record.duration_ms,`/api/grf/matches/${encodeURIComponent(id)}/replay`);
  for(const side of ['home','away'] as const){const year=Number(record.input.config[`${side}_key`].split(':')[1]);d[side]={...d[side],formation:record.input.config[`${side}_formation`],...(d[side].crestUrl&&Number.isInteger(year)?{season:`${year}/${String(year+1).slice(-2)}`}:{})};}
  const half=record.schema_version==='grf-experimental-1'?null:record.halftime_sample_index*100;
  d.periods=half===null?[{period:1,startMs:0,durationMs:record.duration_ms}]:[{period:1,startMs:0,durationMs:half},{period:2,startMs:half,durationMs:record.duration_ms-half}];
  d.metadata={schema:record.schema_version,engine:record.engine_version,dataset:record.input.dataset_version,hash:record.trace_hash,seed:record.input.config.seed,
    native:record.native_binary_sha256,config:record.input.config,clockBasis:record.schema_version==='grf-experimental-1'?'unavailable':'native_recorded',completed:record.samples.length>0&&record.duration_ms>0,limits:'experimental compressed-clock replay; not calibrated tracking'};
  function frame(index:number):SceneFrame {
    const a=record.samples[index],owner=a.owner_team>=0&&a.owner_slot>=0?record.input.players.find(p=>p.side===(a.owner_team===0?'home':'away')&&p.slot===a.owner_slot):null;
    return {clock_ms:index*100,period:'phase' in a?a.phase:1,score:{home:a.score[0],away:a.score[1]},possession:a.owner_team===0?'home':a.owner_team===1?'away':null,
      carrier:owner?ns('grf',owner.id):null,ball:point(a.ball_xyz),players:record.input.players.filter(p=>!('home_active' in a)||(p.side==='home'?a.home_active[p.slot]:a.away_active[p.slot])!==false)
        .map(p=>({...point(p.side==='home'?a.home_xy[p.slot]:a.away_xy[p.slot]),key:ns('grf',p.id),name:p.name,role:p.role,side:p.side}))};
  }
  function interval(time:number):MotionInterval {
    const i=Math.min(record.samples.length-1,Math.floor(time/100)),a=record.samples[i],b=record.samples[i+1];
    const same=!!b&&(!('phase' in a)||('phase' in b&&a.phase===b.phase))&&b.engine_step===a.engine_step+1&&a.game_mode===0&&a.game_mode===b.game_mode&&a.score.every((v,j)=>v===b.score[j]);
    const live=same&&a.home_xy.every((p,j)=>distance(p,b.home_xy[j])<=3)&&a.away_xy.every((p,j)=>distance(p,b.away_xy[j])<=3)&&distance(a.ball_xyz,b.ball_xyz)<=10;
    const before=frame(i),after=b?frame(i+1):null;
    return {fromMs:i*100,toMs:b?(i+1)*100:record.duration_ms,before,after,continuousPlayers:new Set(live?before.players.filter(p=>after?.players.some(q=>q.key===p.key)).map(p=>p.key):[]),continuousBall:live};
  }
  function resolve(ms:number):SessionSnapshot {
    const time=clamp(ms,record.duration_ms),motion=interval(time),cursor=cursorAt(d,time),a=record.samples[Math.min(record.samples.length-1,Math.floor(time/100))];
    const events:EventView[]=record.schema_version==='grf-experimental-3'?record.telemetry.events.filter(e=>e.sample_index*100<=time).map(e=>{
      const actor=e.actor_team<0?null:record.input.players.find(p=>p.side===(e.actor_team===0?'home':'away')&&p.slot===e.player);
      return {id:ns('grf',String(e.seq)),sourceIndex:e.seq,kind:e.type==='goal'?'goal':e.kind,period:e.phase,periodMs:e.match_time_ms,
        elapsedMs:e.sample_index*100,side:e.team===0?'home' as const:'away' as const,actorId:actor?ns('grf',actor.id):null,
        participantIds:actor?[ns('grf',actor.id)]:[],outcome:e.type==='goal'?(e.own_goal?'own_goal':'goal'):e.stage||null,provenance:'native_observed' as const,refs:[String(e.seq)],details:{...e}};
    }):[];
    if(half!==null&&time>=half)events.push({id:'grf:halftime',sourceIndex:-1,kind:'halftime',period:2,periodMs:0,elapsedMs:half,side:null,actorId:null,participantIds:[],outcome:null,provenance:'native_observed',refs:[],details:{}});
    if(time>=record.duration_ms)events.push({id:'grf:fulltime',sourceIndex:Number.MAX_SAFE_INTEGER,kind:half===null?'episode_end':'fulltime',period:motion.before.period,periodMs:'match_time_ms' in a?a.match_time_ms:time,elapsedMs:record.duration_ms,side:null,actorId:null,participantIds:[],outcome:null,provenance:'native_observed',refs:[],details:{}});
    events.sort((x,y)=>x.elapsedMs!-y.elapsedMs!||x.sourceIndex-y.sourceIndex);
    const goalCue=events.filter(e=>e.kind==='goal'&&e.actorId&&time-e.elapsedMs!<900).at(-1);
    // Pase: 250 ms. Tiro (TP222): hasta el siguiente toque o 1,5 s, para que el portero se estire cuando le llega el balón.
    const touches=events.filter(e=>e.actorId&&e.details.type==='touch'),lastTouch=touches.at(-1);
    const actionCue=touches.filter(e=>time-e.elapsedMs!<(e.kind==='shot'?1500:250)&&['short_pass','long_pass','high_pass','shot'].includes(e.kind)&&(e.kind!=='shot'||e===lastTouch)).at(-1);
    const cue=goalCue??actionCue;
    return {...blankSnapshot(d),requestedCursor:cursor,presentedCursor:cursor,interval:motion,previousInterval:interval(Math.max(0,time-100)),events,milestones:events.filter(e=>['goal','halftime','fulltime','episode_end'].includes(e.kind)),
      cue:cue?{type:cue.kind==='goal'?'goal':cue.kind==='shot'?'shot':'pass',participants:[cue.actorId!],side:cue.side,t1_ms:cue.elapsedMs!}:undefined,
      clockMs:'match_time_ms' in a?a.match_time_ms:null,loadState:'ready',horizonMs:record.duration_ms,
      observations:{availability:available(),provenance:'native_observed',values:{index:a.index,engine_step:a.engine_step,final_engine_step:record.samples.at(-1)!.engine_step,
        game_mode:a.game_mode,owner_team:a.owner_team,owner_slot:a.owner_slot,actual_time_ms:'actual_time_ms' in a?a.actual_time_ms:null}},
      facts:{score:{value:motion.before.score,provenance:'native_observed',refs:[]},possession:{value:motion.before.possession,provenance:motion.before.possession?'native_observed':'unavailable',refs:[]},carrierId:{value:motion.before.carrier,provenance:motion.before.carrier?'native_observed':'unavailable',refs:[]}},panels:{players:metadataPanel,data:metadataPanel}};
  }
  const metadataPanel=normalizeGrfMetrics(record,null);
  return savedSession<GrfStatisticsSummary>({descriptor:d,resolve,dataset:record.input.dataset_version,team:readers.team,metadata:()=>normalizeGrfMetrics(record,null),
    statisticsAt:(ms,final)=>final||ms>=record.duration_ms?record.duration_ms:null,
    readStatistics:async(_ms,signal)=>{const data=await(readers.statistics??getGrfStatistics)(id,signal);
      if(data.trace_hash!==record.trace_hash||data.statistics_version!=='grf-statistics-1')throw new Error('Statistics identity changed');return data;},
    normalize:data=>normalizeGrfMetrics(record,data)});
}
