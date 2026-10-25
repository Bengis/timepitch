import {expect,it} from 'vitest';
import type {MatchRecord} from '../api';
import {summaryFixture} from '../grf/statistics/test-fixtures';
import {grfExtras,leaders,timepitchExtras} from './extras-model';

it('keeps unavailable metrics out of rankings, shares positive ties and never awards zero',()=>{
  const data=summaryFixture();data.by_player=Object.fromEntries(Object.entries(data.by_player).map(([key,value])=>[key,structuredClone(value)]));
  for(const metrics of Object.values(data.by_player))metrics.goals.value=null;
  data.by_player[data.players[1].id].goals.value=2;
  data.by_player[data.players[12].id].goals.value=2;
  const model=grfExtras(data);
  expect(leaders(model,'goals').players.map(p=>p.id)).toEqual([data.players[1].id,data.players[12].id]);
  expect(leaders(model,'recoveries').players).toEqual([]);
  expect(model.metrics[data.players[0].id]).not.toHaveProperty('goals');
});
it('preserves unknown attribution and unresolved shot outcomes without manufacturing endpoints',()=>{
  const data=summaryFixture();data.goals[0].actor_id=null;data.shots[0].outcome='unresolved';
  const model=grfExtras(data);
  expect(model.actions.find(e=>e.type==='goal')!.players).toEqual([]);
  expect(model.actions.find(e=>e.type==='shot')!.outcome).toBe('unresolved');
  expect(model.actions.find(e=>e.type==='shot')!.end).toBeUndefined();
});
it('counts only resolved TimePitch actions and uses exact source keys instead of names',()=>{
  const frame={clock_ms:0,period:1 as const,ball:{x:0,y:0},carrier:null,possession:'home' as const,score:{home:0,away:0},players:[
    {key:'home:fpl:7',name:'Same name',side:'home' as const,role:'MID' as const,x:0,y:0},
    {key:'away:fpl:7',name:'Same name',side:'away' as const,role:'MID' as const,x:0,y:0}]};
  const record={config:{home_key:'arsenal:2024',away_key:'mancity:2024'},home_name:'Arsenal',away_name:'City',initial_frame:frame,
    events:[{id:'p1',t0_ms:0,t1_ms:100,type:'pass',side:'home',participants:['home:fpl:7','away:fpl:7'],outcome:'intercepted',evidence:{},frame_after:frame},
      {id:'g1',t0_ms:200,t1_ms:200,type:'goal',side:'away',participants:['away:fpl:7'],outcome:'scored',evidence:{},frame_after:frame}]} as MatchRecord;
  const early=timepitchExtras(record,150);
  expect(early.actions).toHaveLength(1);expect(early.metrics['home:fpl:7'].pass_received).toBe(0);
  expect(early.metrics['away:fpl:7'].goals).toBe(0);expect(early.actions[0].start).toBeUndefined();
  expect(timepitchExtras(record,200).metrics['away:fpl:7'].goals).toBe(1);
  expect(early.players.map(p=>p.sourceKey)).toEqual(['fpl:7','fpl:7']);
});
