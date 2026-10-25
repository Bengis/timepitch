import type {ComparisonResult,HistoricalMatch,HistoricalStatistics,ReconstructionManifest,ReconstructionSegment} from './api';
export const historicalFixture=():HistoricalMatch=>({id:9,key:'statsbomb:9',season_id:27,season_name:'2015/2016',date:'2015-09-19',kick_off:null,
  home_team:{key:'statsbomb:1',source_id:1,name:'Home historical club'},away_team:{key:'statsbomb:2',source_id:2,name:'Away historical club'},
  final_score:{home:2,away:0},status:'partial',lineups:[{team_key:'statsbomb:1',players:[{key:'statsbomb:10',source_id:10,name:'Recorded player',jersey_number:9,positions:[],cards:[]}]}],event_count:1,issues:[],provenance:'source_recorded',
  clock:{periods:[{period:1,duration_ms:60000,observed_end_ms:60000,playback_start_ms:0,start_event_ids:['start'],end_event_ids:['end']}],issues:[],provenance:'derived_from_events'}});
export const statisticsFixture=(ms=0):HistoricalStatistics=>({dataset_version:'v1',match_id:9,cutoff:{period:1,period_ms:ms},display_clock:`00:${String(Math.floor(ms/1000)).padStart(2,'0')}`,playback_ms:ms,
  definition_version:'statsbomb-events-1',provenance:'derived_from_events',score:{home:0,away:0},reconciliation:'not_final',clock_status:'ready',participation_status:'partial',summary_reconciled:false,
  teams:[{team_key:'statsbomb:1',metrics:{shots:{value:null,provenance:'unavailable',event_ids:[],variant:null,reason:'missing',observed_value:null,missing_count:1}}}],
  players:[],goals:[],substitutions:[],cards:[],formations:[],pass_network:[],action_map:[],issues:['partial_participation']});
export const manifestFixture=():ReconstructionManifest=>({reconstruction_id:'r1',dataset_version:'v1',match_id:9,profile:{version:'synthetic-motion-1',tick_ms:100,segment_ms:60000,player_max_speed:9,player_max_acceleration:4,ball_max_speed:45,max_ball_gap_ms:5000},
  roster:[{index:0,key:'statsbomb:10',team_key:'statsbomb:1'}],segments:[{period:1,index:0,from_ms:0,to_ms:60000,bytes:1000,sha256:'a'.repeat(64),status:'partial'}],
  status:'partial',issues:[],anchor_counts:{placed:1},cut_counts:{},ball_unavailable_ms:60000,duration_ms:60000,provenance:'synthetic_motion',label_en:'Real match events · Synthetic tracking',label_es:'Eventos reales · Tracking sintético',local_use_only:true});
export const segmentFixture=():ReconstructionSegment=>({reconstruction_id:'r1',match_id:9,period:1,index:0,from_ms:0,to_ms:60000,includes_period_end:true,status:'partial',
  frames:[{period:1,period_ms:0,players:[[0,20,30]],ball:null,ball_reason:'gap',anchor_ids:[],provenance:'synthetic_motion'}],
  anchors:[{id:'anchor',event_id:'e1',source_index:1,period:1,period_ms:0,entity_key:'ball',location:{x:20,y:30},status:'placed',reason:null,provenance:'derived_from_events'}],
  cuts:[],ball_unavailable_ms:60000,provenance:'synthetic_motion'});

export const comparisonFixture=():ComparisonResult=>({historical_match_id:9,historical_dataset_version:'h1',historical_reconciliation:'matched',engine:'timepitch',simulation_id:'saved',trace_hash:'fixture',engine_version:'fixture',seed:42,home_key:'chelsea:2015',away_key:'arsenal:2015',historical_formations:{home:'4-2-3-1',away:'4-2-3-1'},simulated_formations:{home:'4-4-2',away:'4-4-2'},lineup_differences:['home_xi_unverified'],issues:[],rows:[
  {metric:'goals',historical:{home:0,away:0,definition:'final-goal-count'},simulated:{home:1,away:0,definition:'final-goal-count'},status:'comparable',delta:{home:1,away:0},reason:null},
  {metric:'xg',historical:{home:.2,away:.1,definition:'statsbomb-shot-xg'},simulated:{home:.2,away:.1,definition:'timepitch-generative-xg'},status:'different_definition',delta:null,reason:'different_definition'}]});
