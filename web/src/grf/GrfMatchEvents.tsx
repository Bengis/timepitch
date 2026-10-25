import {useMemo} from 'react';
import type {GrfReplay} from '../api';
import {clockLabel} from '../match/replay';
import {useCentreText} from '../match-centre/messages';
import {useGrfText} from './messages';
import {useGrfStatsText} from './statistics/messages';

export function GrfMatchEvents({record,playbackMs,onSeek}:{record:GrfReplay;playbackMs:number;onSeek:(ms:number)=>void}){
  const c=useCentreText(),g=useGrfText(),t=useGrfStatsText();
  const goals=useMemo(()=>record.schema_version==='grf-experimental-3'?record.telemetry.events.filter(e=>e.type==='goal'):[],[record]);
  const reached=goals.filter(e=>e.sample_index*100<=playbackMs);
  const half=record.schema_version==='grf-experimental-1'?null:record.halftime_sample_index;
  return <aside className="grf-match-events"><h2>{c.events}</h2>
    <p className="small-note">{record.schema_version==='grf-experimental-3'?c.noMilestones:c.episodeEvents}</p>
    <ol>{[...reached.map(e=>({index:e.sample_index,event:e})),...(half!==null&&playbackMs>=half*100?[{index:half,event:null}]:[])].sort((a,b)=>a.index-b.index||(a.event?1:-1)).map(item=>{
      if(!item.event)return <li className="event-period" key="second-half">{g.secondHalf}</li>;
      const e=item.event;
      const actor=record.input.players.find(p=>p.side===(e.actor_team===0?'home':'away')&&p.slot===e.player);
      return <li key={e.seq}><button className="secondary" aria-label={`${c.watch} ${clockLabel(e.match_time_ms)}`} onClick={()=>onSeek(e.sample_index*100)}>{clockLabel(e.match_time_ms)}</button>
        <div><strong>{e.actor_team<0?t.unknown:actor?.name??t.unknown}{e.own_goal?` · ${t.ownGoal}`:''}</strong><small>{e.team===0?record.input.home_name:record.input.away_name}</small></div></li>;
    })}</ol>
    {playbackMs>=record.duration_ms&&<p className="event-period">{record.schema_version==='grf-experimental-1'?g.legacyEnd:g.fullTime}</p>}
  </aside>;
}
