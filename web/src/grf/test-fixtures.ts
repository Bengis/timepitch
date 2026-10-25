/** Synthetic viewer fixtures, not native match acceptance. */
import type {components} from '../generated/api';
type GrfReplay=components['schemas']['GrfReplay'];
export function legacyFixture():GrfReplay {
  const players:GrfReplay['input']['players']=Array.from({length:22},(_,i)=>({
    id:`${i<11?'home':'away'}:p${i%11}`,source_key:`p${i%11}`,side:i<11?'home':'away',slot:i%11,
    name:`Player ${i+1}`,role:i%11===0?'GK':'MID',native_role:i%11===0?'GK':'CM',
    attributes:{physical_velocity:.5,technical_shot:.5,technical_shortpass:.5},
    provenance:{physical_velocity:'estimated',technical_shot:'estimated',technical_shortpass:'estimated'},
  }));
  const samples:GrfReplay['samples']=Array.from({length:3},(_,i)=>({index:i,engine_step:i-1,
    score:i===2?[1,0]:[0,0],owner_team:0,owner_slot:1,game_mode:0,
    home_xy:Array.from({length:11},()=>[-.5+i*.01,0]),away_xy:Array.from({length:11},()=>[.5,0]),ball_xyz:[0,0,.1]}));
  return {schema_version:'grf-experimental-1',engine_version:'grf-2.10.2-probe',input:{
    config:{home_key:'example:2000',away_key:'example:2000',home_players:players.slice(0,11).map(p=>p.source_key),away_players:players.slice(11).map(p=>p.source_key),home_formation:'4-4-2',away_formation:'4-4-2',home_tactic:'balanced',away_tactic:'balanced',seed:42},
    players,home_name:'Example',away_name:'Example',dataset_version:'fixture',ratings_version:'ratings-1',input_hash:'fixture',
    settings:{game_duration:3000,physics_steps_per_frame:10,offsides:true,left_team_difficulty:.6,right_team_difficulty:.6,reverse_team_processing:false,actions:[19,19]},
  },samples,attribute_readbacks:[],native_binary_sha256:'fixture',observation_interval_ms:100,duration_ms:200,steps_left:0,trace_hash:'fixture'};
}


export function fullFixture():components['schemas']['GrfFullMatchReplay'] {
  const old=legacyFixture();
  return {...old,schema_version:'grf-experimental-2',engine_version:'grf-2.10.2-full-match-1',
    input:{...old.input,settings:{physics_steps_per_frame:10,offsides:true,left_team_difficulty:.6,right_team_difficulty:.6,
      reverse_team_processing:false,actions:[19,19],game_duration:4200,second_half:1500,finish_policy:'stoppage-or-neutral-after-90'}},
    duration_ms:300,steps_left:1193,halftime_sample_index:2,completion_reason:'full_time',
    samples:Array.from({length:4},(_,i)=>({...old.samples[Math.min(i,2)],index:i,
      engine_step:[-1,1499,1500,3007][i],match_time_ms:[0,2700000,2701800,5414400][i],
      actual_time_ms:[1900,151900,152000,310000][i],phase:i<2?1:2,in_play:true,set_piece:false})),
  };
}
