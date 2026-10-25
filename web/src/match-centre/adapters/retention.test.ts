import { expect, it } from 'vitest';
import { normalizeGrfMetrics, normalizeHistoricalMetrics, normalizeTimePitchMetrics } from './metrics';
import { fullFixture } from '../../grf/test-fixtures';
import { summaryFixture } from '../../grf/statistics/test-fixtures';
import { historicalFixture, statisticsFixture } from '../../historical/test-fixtures';
import { bundle, spatialRecord } from './test-fixtures';

it('every supplied definition/team/player ID survives; source-specific unavailable metrics stay explicit',()=>{
  const native=summaryFixture(),sim=bundle(),hist=statisticsFixture();
  for(const [source,panel] of [[native,normalizeGrfMetrics(fullFixture(),native)],[sim,normalizeTimePitchMetrics(spatialRecord(),sim,1000)]] as const){
    const ids=new Set([...Object.keys(source.definitions),...Object.values(source.by_team).flatMap(Object.keys),...Object.values(source.by_player).flatMap(Object.keys)]);
    const kept=new Set([...panel.metrics,...panel.players.flatMap(p=>p.metrics)].map(m=>m.id)); for(const id of ids)expect(kept.has(id),id).toBe(true);
  }
  const panel=normalizeHistoricalMetrics(historicalFixture(),hist);
  for(const id of [...hist.teams.flatMap(t=>Object.keys(t.metrics)),...hist.players.flatMap(p=>Object.keys(p.metrics))])expect(panel.metrics.some(m=>m.id===id)||panel.players.some(p=>p.metrics.some(m=>m.id===id))).toBe(true);
});
it('preserves every supplied TimePitch plot, including both occupancy phases, and equivalent table rows',()=>{
  const stats=bundle();
  for(const kind of ['shots','xg','actions','pass_edges','effort','occupancy_in_possession','occupancy_out_of_possession'])
    stats.plots![kind]=[{kind:kind==='effort'?'effort':'action',time_ms:250,side:'home',value:1,player_key:'test:home:1',event_id:'e',x:10,y:20}];
  const panel=normalizeTimePitchMetrics(spatialRecord(),stats,1000);
  expect(new Set(panel.plots.map(p=>p.id))).toEqual(new Set(Object.keys(stats.plots!)));
  expect(panel.plots.every(p=>p.rows.length===1)).toBe(true);
});
it('retains additional team subjects without attributing them to home/away',()=>{
  const stats=bundle();stats.by_team.other={shots:{...stats.by_team.home.shots,value:17}};
  const panel=normalizeTimePitchMetrics(spatialRecord(),stats,1000);
  expect(panel.metrics.find(m=>m.id==='shots'&&m.subject?.id==='other')?.value).toBe(17);
});
