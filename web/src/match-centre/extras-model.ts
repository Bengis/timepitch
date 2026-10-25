import type {GrfReplay,GrfStatisticsSummary,MatchRecord} from '../api';
import {resolvedEvents} from '../match/replay';

export type ExtraPlayer={id:string;sourceKey:string;teamKey:string;teamName:string;name:string;role:string;side:'home'|'away';attributes?:Record<string,number>};
export type ExtraAction={id:string;type:string;side:'home'|'away'|null;time:number;seek:number;players:string[];outcome:string;start?:[number,number];end?:[number,number];evidence:Record<string,string|number|boolean>;refs:string[]};
export type ExtraModel={players:ExtraPlayer[];actions:ExtraAction[];metrics:Record<string,Record<string,number>>;complete:boolean;native:boolean};

export function grfExtras(data:GrfStatisticsSummary,record?:GrfReplay):ExtraModel{
  const players=data.players.map(p=>({...p,sourceKey:p.source_key,teamKey:record?.input.config[`${p.side}_key`]??'',teamName:p.side==='home'?data.home_name:data.away_name,
    attributes:record?.input.players.find(original=>original.id===p.id)?.attributes}));
  const actions:ExtraAction[]=[...data.passes.map(p=>({id:`pass-${p.seq}`,type:'pass',side:p.side,time:p.match_time_ms,seek:p.playback_ms,
    players:[p.actor_id,...p.receiver_id?[p.receiver_id]:[]],outcome:p.outcome,start:[p.x,p.y] as [number,number],
    end:p.end_x!=null&&p.end_y!=null?[p.end_x,p.end_y] as [number,number]:undefined,evidence:{kind:p.kind},refs:(p.event_refs??[p.seq]).map(String)})),
    ...data.shots.map(s=>({id:`shot-${s.seq}`,type:'shot',side:s.side,time:s.match_time_ms,seek:s.playback_ms,players:[s.actor_id],outcome:s.outcome,start:[s.x,s.y] as [number,number],evidence:{set_piece:s.set_piece},refs:[String(s.seq)]})),
    ...data.goals.map(g=>({id:`goal-${g.seq}`,type:'goal',side:g.side,time:g.match_time_ms,seek:g.playback_ms,players:[...g.actor_id?[g.actor_id]:[],...g.assist_id?[g.assist_id]:[]],outcome:g.own_goal?'own_goal':'goal',evidence:{},refs:[String(g.seq)]}))];
  const metrics=Object.fromEntries(players.map(p=>[p.id,Object.fromEntries(Object.entries(data.by_player[p.id]??{}).filter(([,v])=>v.availability==='measured'&&v.value!=null).map(([k,v])=>[k,v.value!]))]));
  return {players,actions:actions.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id)),metrics,complete:data.coverage.events_complete,native:true};
}

export function timepitchExtras(record:MatchRecord,time:number):ExtraModel{
  const players=record.initial_frame.players.map(p=>({...p,id:p.key,sourceKey:p.key.startsWith(p.side+':')?p.key.slice(p.side.length+1):p.key,teamKey:record.config[`${p.side}_key`],teamName:record[`${p.side}_name`]}));
  const events=resolvedEvents(record,time);
  const actions:ExtraAction[]=events.filter(e=>['pass','shot','goal','save','recovery','tackle'].includes(e.type)).map(e=>({id:e.id,type:e.type,side:e.side??null,time:e.t1_ms,seek:e.t1_ms,
    players:[...new Set(e.participants)],outcome:e.outcome,evidence:e.evidence,refs:[e.id],
    start:'origin_mm' in e?[e.origin_mm[0]/1000,e.origin_mm[1]/1000]:undefined,end:'end_mm' in e?[e.end_mm[0]/1000,e.end_mm[1]/1000]:undefined}));
  const metrics=Object.fromEntries(players.map(p=>[p.id,{goals:0,shots:0,pass_attempts:0,pass_received:0,recoveries:0,saves:0,tackles:0}]));
  for(const e of events){const actor=metrics[e.participants[0]];if(!actor)continue;
    if(e.type==='goal')actor.goals++;
    if(e.type==='shot')actor.shots++;
    if(e.type==='recovery')actor.recoveries++;
    if(e.type==='save')actor.saves++;
    if(e.type==='tackle')actor.tackles++;
    if(e.type==='pass'){actor.pass_attempts++;if(e.outcome==='complete')actor.pass_received++;}
  }
  return {players,actions,metrics,complete:true,native:false};
}

export function leaders(model:ExtraModel,metric:string){
  const eligible=model.players.filter(p=>Number.isFinite(model.metrics[p.id]?.[metric]));
  const count=Math.max(0,...eligible.map(p=>model.metrics[p.id][metric]));
  return {count,players:count>0?eligible.filter(p=>model.metrics[p.id][metric]===count):[]};
}
