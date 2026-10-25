import type { GrfReplay, GrfStatisticsSummary, MatchRecord, StatisticsBundle, TeamSeason } from '../../api';
import type { HistoricalMatch, HistoricalStatistics } from '../../historical/api';
import type { MetricView, PanelData, PlayerView, PlotView, ViewProvenance } from '../session';
import { available, cell, detail, emptyPanel, missing, ns, row } from './base';
import { grfExtras, leaders, timepitchExtras, type ExtraModel } from '../extras-model';

function metric(id: string, value: number | null, definition: string, unit: string, provenance: ViewProvenance,
  subject: MetricView['subject'], status: 'available'|'partial'|'unavailable', reason: string | null, evidenceIds: readonly string[], details: Record<string,unknown>): MetricView {
  return { id, value, definition, unit, provenance, subject, availability:{status,reason},evidenceIds,details };
}
const value = <T,>(v: T | null, provenance: ViewProvenance) => ({ value:v,provenance:v===null?'unavailable' as const:provenance,refs:[] });
function player(id:string,name:string|null,side:'home'|'away'|null,role:string|null,jersey:string|null,provenance:ViewProvenance):PlayerView {
  return {id,name,side,sourceRefs:[id],role:value(role,provenance),jersey:value(jersey,provenance),intervals:value(null,'unavailable'),
    estimatedAttributes:[],metrics:[],availability:available()};
}
function plot(id:string,kind:string,coordinateMeaning:string,definition:string,provenance:ViewProvenance,objects:readonly object[]):PlotView {
  const rows=objects.map(row), columns=[...new Set(rows.flatMap(Object.keys))];
  return {id,kind,coordinateMeaning,definition,provenance,availability:available(),columns,rows,details:{count:rows.length}};
}
function standouts(model: ExtraModel, source: string): PanelData['standouts'] {
  return ['goals','shots','pass_received','recoveries','saves','tackles'].map(id=>{
    const result=leaders(model,id);
    return {id,playerIds:result.players.map(p=>ns(source,p.id)),criterion:`${id}: maximum available count; ties retained (${result.count})`,
      evidenceIds:model.actions.filter(a=>a.players.some(p=>result.players.some(v=>v.id===p))).flatMap(a=>a.refs),
      availability: result.players.length ? available() : missing('no_positive_observed_leader')};
  });
}

export function normalizeTimePitchMetrics(record: MatchRecord, statistics: StatisticsBundle|null, timeMs:number):PanelData {
  const source='timepitch', p=emptyPanel();p.scope=timeMs>=5400000?'final':'cursor';
  const usable=statistics&&statistics.end_ms<=timeMs?statistics:null;
  p.availability=usable?available():missing('statistics_not_loaded_at_cursor');
  p.cutoff=usable?{elapsedMs:usable.end_ms,period:usable.end_ms>=2700000?2:1,periodMs:usable.end_ms>=2700000?usable.end_ms-2700000:usable.end_ms}:null;
  const ids=new Set([...Object.keys(usable?.definitions??{}),...Object.values(usable?.by_team??{}).flatMap(Object.keys),...Object.values(usable?.by_player??{}).flatMap(Object.keys)]);
  const metrics=(kind:'team'|'player',id:string,values:NonNullable<typeof usable>['by_team'][string])=>[...ids].map(key=>{
    const m=values[key],d=usable?.definitions[key];
    return metric(key,m?.value??null,`timepitch:${m?.definition_version??d?.version??'unspecified'}:${d?.id??key}`,
      m?.unit??d?.unit??'',m?.origin==='historical'?'source_recorded':m?.origin==='estimated'?'estimated':m?'simulated':'unavailable',
      {kind,id},m?.status??'unavailable',m?.reason??(m?null:'not_supplied_for_subject'),m?.event_ids??[],{...m,definition:d??null});
  });
  p.metrics=[...new Set(['home','away',...Object.keys(usable?.by_team??{})])].flatMap(side=>metrics('team',side,usable?.by_team[side]??{}));
  for(const side of ['home','away'] as const){
    const basic=record.metrics[side];if(!basic)continue;
    for(const [id,observed] of Object.entries(basic)){
      const final=timeMs>=5400000,known=final&&typeof observed==='number'&&Number.isFinite(observed);
      p.metrics=[...p.metrics,metric(id,known?observed:null,`timepitch:basic:${record.rules_version}:${id}`,id==='possession_ms'?'ms':'count',known?'simulated':'unavailable',
        {kind:'team',id:side},known?'available':'unavailable',known?null:final?'not_supplied':'final_only',[],{group:'basic',scope:'final'})];
    }
    const possession=basic.possession_ms;
    p.metrics=[...p.metrics,metric('possession_pct',timeMs>=5400000&&Number.isFinite(possession)?possession/54000:null,'timepitch:basic:fixed90-possession-1','percent',timeMs>=5400000?'simulated':'unavailable',
      {kind:'team',id:side},timeMs>=5400000&&Number.isFinite(possession)?'available':'unavailable',timeMs>=5400000?null:'final_only',[],{group:'basic',denominator:5400000,scope:'final'})];
  }
  p.players=record.initial_frame.players.map(original=>{
    const item=player(ns(source,original.key),original.name,original.side,original.role,null,'estimated');
    item.sourceRefs=[original.key];item.metrics=metrics('player',item.id,usable?.by_player[original.key]??{});
    item.details={sourceKey:original.key.startsWith(original.side+':')?original.key.slice(original.side.length+1):original.key,
      teamKey:record.config[`${original.side}_key`],inputRole:original.role};return item;
  });
  for(const key of Object.keys(usable?.by_player??{}))if(!p.players.some(p=>p.id===ns(source,key))){
    const item=player(ns(source,key),null,null,null,null,'unavailable');item.sourceRefs=[key];item.metrics=metrics('player',item.id,usable!.by_player[key]);p.players=[...p.players,item];
  }
  p.playerDetails=p.players;
  p.definitions=Object.entries(usable?.definitions??{}).map(([id,d])=>({id,text:`timepitch:${d.version}:${d.id}`,provenance:'simulated',availability:available(),details:{...d}}));
  p.definitions=[...p.definitions,...[...new Set(p.metrics.filter(m=>m.details?.group==='basic').map(m=>m.definition))].map(id=>({id,text:id,provenance:'simulated' as const,availability:available(),details:{group:'basic',scope:'final'}}))];
  if(!usable&&p.metrics.some(m=>m.availability.status==='available'))p.availability={status:'partial',reason:'advanced_statistics_not_loaded'};
  p.plots=Object.entries(usable?.plots??{}).map(([id,items])=>{
    const visible=items.filter(point=>point.time_ms<=timeMs);
    const meaning=id==='pass_edges'?'schematic lineup-slot links, not measured positions':id==='effort'?'simulated movement metres, not recorded tracking'
      :id==='xg'?'simulated team cumulative xG, not StatsBomb xG':'simulated canonical action/occupancy coordinates, 105x68m';
    const kind=id.startsWith('occupancy')?'occupancy':id==='pass_edges'?'pass_network':id;
    const result=plot(id,kind,meaning,`timepitch:${id}`, 'simulated',visible.map(point=>({...point,elapsed_ms:point.time_ms})));
    result.points=visible.filter(point=>point.x!=null&&point.y!=null).map((point,i)=>({id:point.event_id??String(i),x:point.x!,y:point.y!,value:point.value,refs:point.event_id?[point.event_id]:[],scope:row(point)}));
    if(id==='pass_edges')result.edges=visible.filter(point=>point.player_key&&point.related_player_key).map(point=>({from:ns(source,point.player_key!),to:ns(source,point.related_player_key!),value:point.value,scope:row(point)}));
    if(id==='xg'||id==='effort')result.series=[...new Set(visible.map(point=>id==='xg'?point.side:point.player_key??point.side))].map(key=>({id:key,values:visible.filter(point=>(id==='xg'?point.side:point.player_key??point.side)===key).map(point=>({elapsedMs:point.time_ms,value:point.value,scope:row(point)}))}));
    if(kind==='occupancy'){result.points=[];result.cells=visible.filter(point=>point.x!=null&&point.y!=null).map(point=>({x:point.x!-105/24,y:point.y!-68/16,width:105/12,height:68/8,value:point.value,scope:row(point)}));}
    result.details={phase:id.startsWith('occupancy_')?id.slice(10):null};return result;
  });
  p.standouts=standouts(timepitchExtras(record,timeMs),source);
  p.sourceDetails=[detail('basic_metrics',timeMs>=5400000?record.metrics:null,'simulated'),detail('versions',{engine:record.engine_version,rules:record.rules_version,ratings:record.ratings_version,dataset:record.dataset_version,hash:record.trace_hash,seed:record.seed}),
    detail('config',record.config),detail('legacy',!('format_version' in record)),detail('spatial_models_unavailable',['xT','xPass','PSxG']),detail('explanations_policy','explicit_action_only; no model execution on playback')];
  return p;
}

export function normalizeGrfMetrics(record:GrfReplay,statistics:GrfStatisticsSummary|null):PanelData {
  const source='grf',p=emptyPanel('final_statistics_not_loaded');
  const replayDetails=[detail('versions',{engine:record.engine_version,schema:record.schema_version,hash:record.trace_hash,native:record.native_binary_sha256}),detail('attribute_readbacks',record.attribute_readbacks),
    detail('replay_timing',{duration_ms:record.duration_ms,observation_interval_ms:record.observation_interval_ms,steps_left:record.steps_left,final_engine_step:record.samples.at(-1)?.engine_step??null,
      halftime_sample_index:record.schema_version==='grf-experimental-1'?null:record.halftime_sample_index,completion_reason:record.schema_version==='grf-experimental-1'?'episode_end':record.completion_reason})];
  p.players=record.input.players.map(original=>{
    const item=player(ns(source,original.id),original.name,original.side,original.role,null,'estimated');item.sourceRefs=[original.id,original.source_key];
    item.estimatedAttributes=Object.entries(original.attributes).map(([id,v])=>metric(id,v,`grf-input-estimate:${id}`,'normalized','estimated',{kind:'player',id:item.id},'available',null,[],{source:original.provenance[id]??null}));
    item.details={slot:original.slot,nativeRole:original.native_role,teamKey:record.input.config[`${original.side}_key`],sourceKey:original.source_key};return item;
  });p.playerDetails=p.players;
  if(!statistics) { p.sourceDetails=[detail('input',record.input),...replayDetails,detail('compressed_effort_unavailable','Native compressed-clock observations do not measure full-match distance/speed')];return p; }
  p.availability=available();p.scope='final';
  p.cutoff={elapsedMs:record.duration_ms,period:record.schema_version==='grf-experimental-1'?1:2,periodMs:statistics.full_time_ms??record.duration_ms};
  const ids=new Set([...Object.keys(statistics.definitions),...Object.values(statistics.by_team).flatMap(Object.keys),...Object.values(statistics.by_player).flatMap(Object.keys),'shots_on_target','saves','cards','xg']);
  const metrics=(kind:'team'|'player',id:string,values:GrfStatisticsSummary['by_team'][string])=>[...ids].map(key=>{
    const m=values[key],definition=statistics.definitions[m?.definition_id??key];
    return metric(key,m?.value??null,`grf:${statistics.statistics_version}:${m?.definition_id??key}`,definition?.unit??'',
      !m||m.availability==='unavailable'?'unavailable':m.availability==='measured'?'native_observed':'derived_from_events',
      {kind,id},!m||m.availability==='unavailable'?'unavailable':'available',m?.reason??(m?null:'not_supplied_for_subject'),m?.event_refs?.map(String)??[],{...m,definition:definition??null});
  });
  p.metrics=[...new Set(['home','away',...Object.keys(statistics.by_team)])].flatMap(side=>metrics('team',side,statistics.by_team[side]??{}));
  p.players=p.players.map(item=>({...item,metrics:metrics('player',item.id,statistics.by_player[item.sourceRefs[0]]??{})}));
  for(const key of Object.keys(statistics.by_player))if(!p.players.some(p=>p.id===ns(source,key))){
    const sourcePlayer=statistics.players.find(p=>p.id===key),item=player(ns(source,key),sourcePlayer?.name??null,sourcePlayer?.side??null,null,null,'unavailable');
    item.sourceRefs=[key];item.metrics=metrics('player',item.id,statistics.by_player[key]);p.players=[...p.players,item];
  }p.playerDetails=p.players;
  for(const id of ['distance_m','average_speed_kmh','max_speed_kmh','hsr_distance_m'])p.metrics=[...p.metrics,metric(id,null,`grf:compressed-clock:${id}`,'','unavailable',{kind:'match',id:'match'},'unavailable','compressed_clock_is_not_full_match_tracking',[],{})];
  for(const id of ['eligible_ms','excluded_ms','outside_player_ms','free_ball_pct'] as const){
    const v=statistics.coverage[id],known=statistics.coverage.native_clock_available&&v!==null&&v!==undefined;
    p.metrics=[...p.metrics,metric(id,known?v:null,`grf:coverage:${id}`,id.endsWith('_pct')?'percent':'ms',known?'native_observed':'unavailable',{kind:'match',id:'match'},
      known?'available':'unavailable',known?null:'native_clock_unavailable',[],{clockBasis:'native_compressed_observation',activityVerified:statistics.coverage.activity_verified})];
  }
  const assigned=statistics.by_team.home?.team_possession_pct?.denominator,eligible=statistics.coverage.eligible_ms;
  p.metrics=[...p.metrics,metric('unassigned_possession_pct',assigned!=null&&eligible>0?100*Math.max(0,eligible-assigned)/eligible:null,'grf:coverage:unassigned-team-control','percent','derived_from_events',
    {kind:'match',id:'match'},assigned!=null&&eligible>0?'available':'unavailable',assigned!=null&&eligible>0?null:'eligible_denominator_unavailable',[],{assigned_ms:assigned??null,eligible_ms:eligible})];
  p.definitions=Object.entries(statistics.definitions).map(([id,d])=>({id,text:`grf:${statistics.statistics_version}:${id} · ${d.description}`,provenance:'derived_from_events',availability:available(),details:{...d}}));
  const plots:PlotView[]=[
    plot('shots','shots','native observations in canonical metres, 105x68', 'grf-native-shot-animation (may include clearances)','native_observed',statistics.shots),
    plot('pass_edges','pass_network','native mean positions and confirmed pass links, metres','grf-confirmed-receipt-links','derived_from_events',statistics.pass_edges),
    plot('positions','average_positions','native observed mean positions, metres','grf-position-means','native_observed',statistics.positions),
    plot('occupancy','occupancy','native observation exposure;12x8 cells, not real-match tracking','grf-occupancy','native_observed',statistics.occupancy),
    plot('team_shape','team_shape','native observed team length/width by phase, metres','grf-team-shape','derived_from_events',statistics.team_shape),
  ];
  plots[0].points=statistics.shots.map(s=>({id:String(s.seq),x:s.x,y:s.y,value:null,refs:[String(s.seq)],scope:row(s)}));
  plots[1].nodeLayout='positions';
  plots[1].edges=statistics.pass_edges.map(edge=>({from:ns(source,edge.source_id),to:ns(source,edge.target_id),value:edge.count,scope:row(edge)}));
  plots[1].points=plots[2].points=statistics.positions.map(pos=>({id:ns(source,pos.player_id),x:pos.x,y:pos.y,value:pos.covered_ms,refs:[],scope:row(pos)}));
  plots[3].cells=statistics.occupancy.map(c=>({x:c.col*105/12,y:c.row*68/8,width:105/12,height:68/8,value:c.duration_ms,scope:row(c)}));
  const extra=grfExtras(statistics,record);
  p.actions=extra.actions.map((a,index)=>({id:ns(source,`resolved:${a.id}`),sourceIndex:index,kind:a.type,period:statistics.passes.find(p=>`pass-${p.seq}`===a.id)?.phase??statistics.shots.find(p=>`shot-${p.seq}`===a.id)?.phase??statistics.goals.find(p=>`goal-${p.seq}`===a.id)?.phase??0,
    periodMs:a.time,elapsedMs:a.seek,side:a.side,actorId:a.players[0]?ns(source,a.players[0]):null,participantIds:a.players.map(id=>ns(source,id)),outcome:a.outcome,provenance:'derived_from_events',refs:a.refs,
    details:{...a.evidence,location:a.start??null,end_location:a.end??null,sourceActionId:a.id,scope:'final',clockBasis:'native match clock',match_time_ms:a.time}}));
  p.plots=plots;p.standouts=standouts(grfExtras(statistics,record),source);
  p.sourceDetails=[detail('coverage',statistics.coverage,'native_observed'),detail('goals',statistics.goals,'derived_from_events'),detail('passes',statistics.passes,'derived_from_events'),
    detail('shots',statistics.shots,'native_observed'),detail('final_score',statistics.score,'native_observed'),detail('clock',{full_time_ms:statistics.full_time_ms,halftime_ms:statistics.halftime_ms},'native_observed'),
    detail('input',record.input),...replayDetails,
    detail('compressed_effort_unavailable','Native compressed-clock observations do not measure full-match distance/speed')];
  return p;
}

export function normalizeHistoricalMetrics(match:HistoricalMatch,statistics:HistoricalStatistics|null):PanelData {
  const p=emptyPanel('statistics_not_loaded'),source='historical';
  p.availability=statistics?available():{status:'partial',reason:'statistics_not_loaded'};
  p.cutoff=statistics&&statistics.playback_ms!==null?{elapsedMs:statistics.playback_ms,period:statistics.cutoff.period,periodMs:statistics.cutoff.period_ms}:null;
  const ids=new Set([...statistics?.teams.flatMap(t=>Object.keys(t.metrics))??[],...statistics?.players.flatMap(t=>Object.keys(t.metrics))??[],'possession_pct','distance_m','defensive_line_height_m']);
  const tracking=new Set(['possession_pct','distance_m','defensive_line_height_m']);
  const metrics=(kind:'team'|'player',id:string,values:NonNullable<typeof statistics>['teams'][number]['metrics'])=>[...ids].map(key=>{
    const m=values[key]; const unavailable=tracking.has(key)||!m||m.provenance==='unavailable';
    return metric(key,unavailable?null:m.value,`statsbomb:${statistics?.definition_version??'statsbomb-events-1'}:${key}:${m?.variant??'source-definition'}`,
      key.endsWith('_ms')?'ms':key.endsWith('_m')?'m':key.endsWith('_pct')?'percent':'',unavailable?'unavailable':'derived_from_events',
      {kind,id},unavailable?'unavailable':m.missing_count>0?'partial':'available',m?.reason??(tracking.has(key)?'No measured tracking':m?null:'not_supplied_for_subject'),m?.event_ids??[],{...m});
  });
  p.metrics=[...new Set([match.home_team.key,match.away_team.key,...statistics?.teams.map(t=>t.team_key)??[]])].flatMap(id=>metrics('team',id,statistics?.teams.find(t=>t.team_key===id)?.metrics??{}));
  p.players=match.lineups?.flatMap(lineup=>lineup.players.map(original=>{
    const item=player(ns(source,original.key),original.name,lineup.team_key===match.home_team.key?'home':lineup.team_key===match.away_team.key?'away':null,null,original.jersey_number==null?null:String(original.jersey_number),'source_recorded');
    item.sourceRefs=[original.key];item.metrics=metrics('player',item.id,statistics?.players.find(v=>v.player_key===original.key)?.metrics??{});
    const active=statistics?.players.find(v=>v.player_key===original.key)?.active??null;
    const eligible=(original.positions??[]).filter(pos=>pos.from_period===1&&pos.from==='00:00'&&typeof pos.position==='string'
      && (pos.to===null&&pos.end_reason==='Final Whistle'||pos.to_period===1&&statistics?.cutoff.period===1&&typeof pos.to==='string'
        && /^\d+:\d{2}$/.test(pos.to)&&statistics.cutoff.period_ms<(Number(pos.to.split(':')[0])*60+Number(pos.to.split(':')[1]))*1000));
    const known=eligible.length===1?eligible[0]:null;
    if(active&&known){item.role={value:String(known.position),provenance:'source_recorded',refs:[original.key]};
      if(match.clock?.periods[0]?.playback_start_ms===0)item.intervals={value:[{fromMs:0,toMs:known.to_period===1&&typeof known.to==='string'?(Number(known.to.split(':')[0])*60+Number(known.to.split(':')[1]))*1000:null}],provenance:'source_recorded',refs:[original.key]};}
    item.finalDetails={positions:original.positions??[],cards:original.cards??[]};
    item.details={sourceKey:original.key,teamKey:lineup.team_key,
      active:statistics?.players.find(v=>v.player_key===original.key)?.active??null,positionAvailability:'raw source intervals retained; no rendering placeholder displayed'};return item;
  }))??[];
  for(const original of statistics?.players??[])if(!p.players.some(p=>p.id===ns(source,original.player_key))){
    const side=original.team_key===match.home_team.key?'home':original.team_key===match.away_team.key?'away':null;
    const item=player(ns(source,original.player_key),null,side,null,null,'unavailable');item.sourceRefs=[original.player_key];
    item.metrics=metrics('player',item.id,original.metrics);item.details={active:original.active,teamKey:original.team_key};p.players=[...p.players,item];
  }p.playerDetails=p.players;
  p.definitions=[...ids].map(id=>({id,text:`statsbomb:${statistics?.definition_version??'statsbomb-events-1'}:${id}`,provenance:tracking.has(id)?'unavailable':'derived_from_events',availability:tracking.has(id)?missing('No measured tracking'):available()}));
  const actions=statistics?.action_map??[],edges=statistics?.pass_network??[];
  const map=plot('action_map','actions','recorded event action positions canonical105x68m; not tracking','statsbomb-source-actions','derived_from_events',actions);
  map.points=actions.map(a=>({id:a.event_id,x:a.location.x,y:a.location.y,value:null,refs:[a.event_id],scope:row(a)}));
  const network=plot('pass_network','pass_network','schematic player-node links; node locations are not recorded positions','statsbomb-completed-pass-network','derived_from_events',edges);
  network.edges=edges.map(e=>({from:ns(source,e.player_key),to:ns(source,e.recipient_key),value:e.count,scope:row(e)}));
  const zones=plot('action_zones','action_zones','recorded action x-zones0–35/35–70/70–105m; not time-weighted occupancy','statsbomb-action-zone-count','derived_from_events',
    [0,35,70].flatMap(from=>[match.home_team.key,match.away_team.key].map(team=>({from,to:from+35,team,count:actions.filter(a=>a.team_key===team&&a.location.x>=from&&(a.location.x<from+35||from===70&&a.location.x===105)).length}))));
  p.plots=[map,zones,network];
  const {final_score,lineups,...sourceMatch}=match;p.finalDetails={sourceMatch:match};
  p.sourceDetails=[detail('source_match',sourceMatch),detail('clock',match.clock),detail('statistics_status',statistics?{definition:statistics.definition_version,cutoff:statistics.cutoff,display_clock:statistics.display_clock,clock_status:statistics.clock_status,participation_status:statistics.participation_status,reconciliation:statistics.reconciliation,summary_reconciled:statistics.summary_reconciled}:null),
    detail('issues',statistics?.issues??match.issues),detail('goals',statistics?.goals,'derived_from_events'),detail('substitutions',statistics?.substitutions,'derived_from_events'),detail('cards',statistics?.cards,'derived_from_events'),detail('formations',statistics?.formations,'derived_from_events'),
    detail('tracking_unavailable','Source events are recorded; reconstruction coordinates are synthetic and supply no possession/distance/effort metric'),detail('license','StatsBomb Open Data; public redistribution requires separate permission from the provider')];
  return p;
}

/** Enrich only an exact source key. Dataset drift is kept as a warning, never a name join. */
export function catalogPlayer(item:PlayerView,team:TeamSeason,sourceKey:string,expectedDataset:string):PlayerView {
  const original=team.players.find(p=>p.key===sourceKey);if(!original)return {...item,availability:missing('source_player_not_found')};
  const attributes=Object.entries(original.advanced_stats??{}).map(([id,m])=>metric(`historical:${id}`,m.value,m.definition_version,m.unit,m.status==='estimated'?'estimated':'source_recorded',
    {kind:'player',id:item.id},m.status==='measured'||m.status==='estimated'?'available':m.status,m.reason??null,[],{...m}));
  return {...item,metrics:[...item.metrics,...Object.entries(original.stats).map(([id,m])=>metric(`historical:${id}`,m.value,`catalog:${team.source}:${id}`,m.unit,m.status==='estimated'?'estimated':'source_recorded',
    {kind:'player',id:item.id},m.status==='measured'||m.status==='estimated'?'available':m.status,null,[],{...m})),...attributes],
    details:{...item.details,catalog:{source:team.source,season:team.season_label,datasetVersion:team.dataset_version,datasetChanged:team.dataset_version!==expectedDataset,qualityFlags:original.quality_flags}}};
}
