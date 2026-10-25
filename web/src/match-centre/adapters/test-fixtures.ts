import type { LegacyMatchRecord, MatchRecordV2, MotionSample, StatisticsBundle, GrfReplay } from '../../api';
import type { components } from '../../generated/api';
import { fullFixture } from '../../grf/test-fixtures';
import { syntheticFrame } from '../unified-fixtures';
import { historicalFixture, manifestFixture, segmentFixture, statisticsFixture } from '../../historical/test-fixtures';
import type { HistoricalEvent, HistoricalStatistics, ReconstructionSegment } from '../../historical/api';

export function legacyRecord(): LegacyMatchRecord {
  const frame = syntheticFrame();
  return { config: { home_key: 'a:2000', away_key: 'b:2000', home_players: [], away_players: [], home_formation: '4-4-2', away_formation: '4-4-2', home_tactic:'balanced', away_tactic:'balanced', seed: 42 },
    seed: 42, dataset_version: 'test', engine_version: 'engine-1', ratings_version: 'ratings-1', rules_version: 'rules-1',
    home_name: 'Synthetic home', away_name: 'Synthetic away', trace_hash: 'fixture', initial_frame: { ...frame, ball: frame.ball!, score: frame.score!, period: 1, possession: 'home' },
    events: [
      { id: 'pass', type: 'pass', t0_ms: 0, t1_ms: 1000, side: 'home', participants: ['test:home:1'], outcome: 'complete', evidence: {}, frame_after: { ...frame, clock_ms: 1000, ball: { x: 30, y: 20 }, score: { home: 0, away: 0 }, period: 1, possession: 'away' } },
      { id: 'goal', type: 'goal', t0_ms: 1000, t1_ms: 1000, side: 'home', participants: ['test:home:1'], outcome: 'goal', evidence: {}, frame_after: { ...frame, clock_ms: 1000, ball: { x: 30, y: 20 }, score: { home: 1, away: 0 }, period: 1, possession: 'home' } },
      { id: 'end', type: 'fulltime', t0_ms: 5400000, t1_ms: 5400000, side: null, participants: [], outcome: 'end', evidence: {}, frame_after: { ...frame, clock_ms: 5400000, ball: { x: 52.5, y: 34 }, score: { home: 1, away: 0 }, period: 2, possession: 'home' } },
    ], metrics: {} };
}
export function spatialRecord(): MatchRecordV2 {
  const old = legacyRecord();
  const motion = (ms: number, x: number, reset = 0, period = 1, goal = 0): MotionSample =>
    [ms, period, goal, 0, 0, 0, 0, reset, x * 1000, 20000, [x * 1000, 20000, 30000, 40000]];
  return { ...old, format_version: 2, engine_version: 'engine-2', rules_version: 'rules-2', ratings_version: 'ratings-1', metrics_version: 'metrics-1',
    motion: [motion(0, 10), motion(250, 20), motion(500, 30), motion(500, 40, 2, 1, 1), motion(750, 45, 0, 1, 1), motion(2700000, 20, 2, 2, 1), motion(5400000, 20, 0, 2, 1)],
    events: [{ id: 'goal', type: 'goal', t0_ms: 500, t1_ms: 500, side: 'home', participants: ['test:home:1'], outcome: 'goal', evidence: {}, origin_mm: [30000,20000], end_mm: [30000,20000], period:1, sample_index:3, origin_sample_index:2, released_ms:500, possession_id:0, sequence_id:0 }] };
}
export function bundle(end_ms = 1000): StatisticsBundle {
  return { version: 'metrics-1', end_ms, definitions: { shots: { id: 'shots', version: 'sim-shots-1', unit: 'count', label_key: 'shots' } },
    by_team: { home: { shots: { value: 0, unit: 'count', origin: 'simulated', status: 'available', source: 'test', definition_version: 'sim-shots-1' } } },
    by_player: {}, plots: {} };
}
export const signal = () => new AbortController().signal;
export function modernGrf():Extract<GrfReplay,{schema_version:'grf-experimental-3'}> {
  const old=fullFixture();
  const event=(seq:number,index:number):components['schemas']['GrfNativeEvent']=>({seq,sample_index:index,type:'touch',kind:'short_pass',stage:'',team:0,actor_team:0,player:1,victim_team:-1,victim_player:-1,
    action_id:0,incident_id:0,function:0,touch_type:0,actual_time_ms:100,match_time_ms:old.samples[index].match_time_ms,phase:old.samples[index].phase,
    in_play:true,set_piece:false,own_goal:false,mirrored:false,ball_mirrored:false,actor_xy:[0,0],ball_xyz:[0,0,0],raw_actor_xy:[0,0],raw_ball_xyz:[0,0,0],score:[0,0],attack_direction:[1,-1]});
  return {...old,schema_version:'grf-experimental-3',engine_version:'grf-2.10.2-stats-1',input:{...old.input,telemetry_version:'grf-native-events-1'},
    samples:old.samples.map(s=>({...s,home_active:Array(11).fill(true),away_active:Array(11).fill(true),attack_direction:[1,-1]})),
    telemetry:{version:'grf-native-events-1',events:[event(0,1),{...event(1,2),type:'goal',kind:'goal',own_goal:true,team:1}],emitted_count:2,overflowed:false}};
}
export const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
export function sourceReaders() {
  const match = historicalFixture(); match.clock!.periods[0].duration_ms = 125000; match.clock!.periods[0].observed_end_ms = 125000;
  const manifest = manifestFixture(); manifest.duration_ms = 125000;
  manifest.segments = [0,1,2].map(index => ({ ...manifest.segments[0], index, from_ms: index * 60000, to_ms: Math.min(125000, (index + 1) * 60000) }));
  const events: HistoricalEvent[] = [];
  const segment = (period: number, index: number): ReconstructionSegment => ({ ...segmentFixture(), period, index,
    from_ms: index * 60000, to_ms: manifest.segments.find(s=>s.period===period&&s.index===index)?.to_ms??Math.min(125000, (index + 1) * 60000), includes_period_end: index === 2,
    frames: [0,100,1000,59900,60000].map(ms => ({ ...segmentFixture().frames[0], period, period_ms: index * 60000 + ms,
      players: [[0,20+ms/10000,30]], ball: ms === 0 ? null : [30,40] })), cuts: [], anchors: [] });
  const readers = {
    capabilities:async()=>({two_modes_ui:true,reconstruction_enabled:true,dataset_state:'ready' as const,dataset_version:'v1',publication_status:'blocked_pending_permission' as const}),
    match: async () => match, manifest: async () => manifest,
    events: async (_id: number, period: number, from: number, to: number) => events.filter(e => e.period === period && e.period_ms >= from && e.period_ms < to),
    segment: async (_id: number, period: number, index: number) => segment(period, index),
    statistics: async (_id: number, period: number, ms: number): Promise<HistoricalStatistics> => ({ ...statisticsFixture(ms), cutoff: { period, period_ms: ms }, score: { home: 0, away: 0 } }),
  };
  return { match, manifest, events, readers, segment };
}
export function historicalEvent(id: string, ms: number, type = 'Pass', index = 1): HistoricalEvent {
  return { id, source_index: index, period: 1, period_ms: ms, minute: Math.floor(ms/60000), second: Math.floor(ms/1000)%60,
    type, team_key: 'statsbomb:1', player_key: 'statsbomb:10', provenance: 'source_recorded', coordinate_provenance: 'unavailable', details: {} };
}
