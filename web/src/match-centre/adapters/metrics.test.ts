import { describe, expect, it } from 'vitest';
import { normalizeGrfMetrics, normalizeHistoricalMetrics, normalizeTimePitchMetrics } from './metrics';
import { summaryFixture } from '../../grf/statistics/test-fixtures';
import { fullFixture } from '../../grf/test-fixtures';
import { historicalFixture, statisticsFixture } from '../../historical/test-fixtures';
import { bundle, spatialRecord } from './test-fixtures';

describe('metric/plot view data', () => {
  it('retains definition-only, team-only and player-only metric IDs with zero distinct from missing', () => {
    const stats = bundle(); stats.definitions.hidden = { id: 'hidden', version: 'hidden-1', unit: 'm', label_key: 'hidden' };
    stats.by_player['test:home:1'] = { detail_only: { ...stats.by_team.home.shots, value: null, reason: 'missing' } };
    const panel = normalizeTimePitchMetrics(spatialRecord(), stats, 1000);
    expect(new Set(panel.metrics.map(m => m.id))).toEqual(new Set(['shots','hidden','detail_only']));
    expect(panel.metrics.find(m => m.id==='shots')?.value).toBe(0);
    expect(panel.metrics.find(m => m.id==='hidden')?.availability.status).toBe('unavailable');
    expect(panel.players.flatMap(p => p.metrics).find(m => m.id==='detail_only')?.value).toBeNull();
  });
  it('retains every GRF map/table including native coordinates, phase and original definitions', () => {
    const data = summaryFixture(), original = JSON.stringify(data), panel = normalizeGrfMetrics(fullFixture(), data);
    expect(panel.plots.map(p => p.kind)).toEqual(expect.arrayContaining(['shots','pass_network','average_positions','occupancy','team_shape']));
    expect(panel.plots.every(p => p.coordinateMeaning.includes('native'))).toBe(true);
    expect(panel.plots.find(p => p.kind==='average_positions')?.rows).toHaveLength(22);
    expect(panel.metrics.find(m => m.id==='team_possession_pct')?.details).toMatchObject({ denominator:200 });
    expect(panel.metrics.find(m=>m.id==='eligible_ms')?.value).toBe(200);
    expect(JSON.stringify(data)).toBe(original);
  });
  it('historical effort/roles remain unavailable, no synthetic kilometres or inferred position', () => {
    const match = historicalFixture(), stats = statisticsFixture(1000), original = JSON.stringify({match,stats});
    const panel = normalizeHistoricalMetrics(match, stats);
    expect(panel.players[0].role.value).toBeNull(); expect(panel.players[0].jersey.value).toBe('9');
    expect(panel.metrics.find(m => m.id==='distance_m')).toMatchObject({ value:null, provenance:'unavailable' });
    expect(panel.plots.map(p => p.kind)).toEqual(expect.arrayContaining(['actions','action_zones','pass_network']));
    expect(JSON.stringify({match,stats})).toBe(original);
  });
  it('xG and pass/shot definitions retain their own source identity', () => {
    const hist = statisticsFixture(); hist.teams[0].metrics.xg = { value: 1, provenance:'derived_from_events', missing_count:0, variant:'StatsBomb shot xG' };
    const native = summaryFixture(); native.by_team.home.xg = { value:null, availability:'unavailable', definition_id:'xg', covered_ms:0 };
    const sim = bundle(); sim.by_team.home.simulated_xg = { ...sim.by_team.home.shots, value:1, definition_version:'generative-xg-1' };
    const definitions = [normalizeHistoricalMetrics(historicalFixture(),hist),normalizeGrfMetrics(fullFixture(),native),normalizeTimePitchMetrics(spatialRecord(),sim,1000)]
      .map(p => p.metrics.find(m => m.id==='xg'||m.id==='simulated_xg')!.definition);
    expect(new Set(definitions).size).toBe(3);
  });
  it('retains unknown player subjects without joining by name or assigning a team',()=>{
    const stats=bundle();stats.by_player.unlisted={detail_only:{...stats.by_team.home.shots,value:7}};
    const panel=normalizeTimePitchMetrics(spatialRecord(),stats,1000);
    expect(panel.players.find(p=>p.id==='timepitch:unlisted')).toMatchObject({name:null,side:null});
    expect(panel.players.find(p=>p.id==='timepitch:unlisted')?.metrics.find(m=>m.id==='detail_only')?.value).toBe(7);
  });
  it('historical raw final score/cards/position intervals are gated separately from cursor data',()=>{
    const match=historicalFixture();match.lineups![0].players[0].cards=[{type:'Red Card',time:'60:00'}];
    match.lineups![0].players[0].positions=[{position:'Right Center Midfield',from:'00:00',from_period:1,to:null,to_period:null,end_reason:'Final Whistle'}];
    const stats=statisticsFixture(1000);stats.players=[{player_key:'statsbomb:10',team_key:'statsbomb:1',active:true,metrics:{}}];
    const panel=normalizeHistoricalMetrics(match,stats);
    expect(panel.players[0].role.value).toBe('Right Center Midfield');
    expect(panel.players[0].details).not.toHaveProperty('cards');expect(panel.players[0].finalDetails).toHaveProperty('cards');
    expect(panel.sourceDetails.find(d=>d.id==='source_match')?.value).not.toContain('final_score');
    match.lineups![0].players[0].positions!.push({...match.lineups![0].players[0].positions![0],position:'Goalkeeper'});
    expect(normalizeHistoricalMetrics(match,stats).players[0].role.value).toBeNull();
  });
  it('retains legacy basic summary definitions without leaking their final values into the cursor',()=>{
    const record=spatialRecord();record.metrics.home={goals:1,shots:7,shots_on_target:3,saves:2,passes:100,completed_passes:80,pressures:5,tackles:7,possession_ms:2700000};
    const cursor=normalizeTimePitchMetrics(record,null,1000),final=normalizeTimePitchMetrics(record,null,5400000);
    expect(cursor.metrics.find(m=>m.id==='shots'&&m.details?.group==='basic')?.value).toBeNull();
    expect(final.metrics.find(m=>m.id==='shots'&&m.details?.group==='basic')?.value).toBe(7);
    expect(final.metrics.find(m=>m.id==='possession_pct'&&m.details?.group==='basic')?.value).toBe(50);
  });
});
