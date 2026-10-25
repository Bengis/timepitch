/** Synthetic response for UI tests only. */
import type {GrfStatisticsSummary} from '../../api';
import {fullFixture} from '../test-fixtures';

export function summaryFixture(hash='fixture',scorer='Scorer'):GrfStatisticsSummary{
  const players=fullFixture().input.players;players[1].name=scorer;
  const counts:Record<string,number>={goals:1,assists:0,shots:2,pass_attempts:3,pass_received:2,pass_unresolved:1,
    team_possession_pct:50,possession_pct:25,team_length_m:30,team_width_m:25,confirmed_receipt_pct:200/3,fouls:0,offsides:0,corners:0,penalties:0,recoveries:0};
  const metrics=Object.fromEntries(Object.entries(counts).map(([name,value])=>[name,{value,availability:'measured' as const,definition_id:name,
    numerator:value,denominator:100,covered_ms:200,reason:null,event_refs:[],sample_ranges:[]}]));
  metrics.team_possession_pct={...metrics.team_possession_pct,numerator:100,denominator:200};
  return {statistics_version:'grf-statistics-1',trace_hash:hash,replay_version:'grf-experimental-3',home_name:'Home club',away_name:'Away club',
    score:[1,0],full_time_ms:5414400,halftime_ms:2701800,players,
    definitions:Object.fromEntries(Object.keys(counts).map(k=>[k,{unit:k.endsWith('_pct')?'percent' as const:k.endsWith('_m')?'m' as const:'count' as const,description:'Fixture definition'}])),
    by_team:{home:metrics,away:metrics},by_player:Object.fromEntries(players.map(p=>[p.id,metrics])),
    goals:[{seq:1,side:'home',actor_id:players[1].id,own_goal:false,assist_id:null,shot_seq:0,match_time_ms:2700000,playback_ms:200,phase:1}],
    shots:[{seq:0,side:'home',actor_id:players[1].id,x:90,y:34,match_time_ms:2699000,playback_ms:100,phase:1,set_piece:false,outcome:'goal'}],
    passes:[],pass_edges:[{side:'home',phase:1,source_id:players[2].id,target_id:players[1].id,count:2}],
    positions:players.map((p,i)=>({side:p.side,player_id:p.id,phase:1,x:20+i*3,y:5+(i%10)*5,covered_ms:200})),
    occupancy:[{side:'home',player_id:players[1].id,phase:1,col:4,row:4,duration_ms:200}],
    team_shape:[{side:'home',phase:1,length_m:30,width_m:25,covered_ms:200}],
    coverage:{events_complete:true,native_clock_available:true,activity_verified:true,eligible_ms:200,excluded_ms:100,
      outside_player_ms:0,free_ball_pct:50,warnings:[]}};
}
