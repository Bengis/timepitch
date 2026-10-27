import {expect,it} from 'vitest';
import {planHighlights, highlightsRemainingMs} from './highlights';
import type {EventView} from './session';

const event=(kind:string,elapsedMs:number,id=String(elapsedMs))=>({id,kind,elapsedMs} as EventView);
it('keeps all seven goals, both halves and source boundaries in about five minutes at natural speed',()=>{
  const goals=[400000,980000,1500000,2800000,3500000,4300000,5200000].map(ms=>event('goal',ms));
  const shots=Array.from({length:60},(_,i)=>event('shot',60000+i*90000));
  const plan=planHighlights(5800000,2880000,[...goals,...shots]);
  expect(plan.durationMs).toBe(300000);
  expect(plan.policy.speeds).toEqual([1]);
  expect(plan.policy.pauseAt).toEqual([{atMs:2880000,endingPeriod:1}]);
  expect(plan.policy.windows?.[0].fromMs).toBe(0);
  expect(plan.policy.windows?.at(-1)?.toMs).toBe(5800000);
  for(const g of goals)expect(plan.policy.windows?.some(w=>w.fromMs<=g.elapsedMs!&&w.toMs>g.elapsedMs!)).toBe(true);
  expect(plan.policy.windows?.some(w=>w.fromMs<2880000&&w.toMs>2880000)).toBe(true);
  expect(highlightsRemainingMs(plan.policy.windows!,5800000)).toBe(0);
  expect(highlightsRemainingMs(plan.policy.windows!,0)).toBe(300000);
});
it('is deterministic, bounded and nonoverlapping even for adjacent or boundary goals',()=>{
  const events=[event('goal',0),event('goal',100),event('goal',299999),event('goal',600000)];
  const a=planHighlights(600000,300000,events),b=planHighlights(600000,300000,[...events].reverse());
  expect(a).toEqual(b);
  const windows=a.policy.windows!;
  windows.forEach((w,i)=>{expect(w.fromMs).toBeGreaterThanOrEqual(0);expect(w.toMs).toBeLessThanOrEqual(600000);expect(w.toMs).toBeGreaterThan(w.fromMs);if(i)expect(w.fromMs).toBeGreaterThan(windows[i-1].toMs);});
});
it('plays a short recording completely and does not fabricate five minutes of footage',()=>{
  const plan=planHighlights(90000,45000,[]);
  expect(plan.durationMs).toBe(90000);expect(plan.policy.windows).toEqual([{fromMs:0,toMs:90000}]);
});
