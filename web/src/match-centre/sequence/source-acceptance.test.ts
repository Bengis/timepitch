import { expect, it, vi } from 'vitest';
import { createHistoricalSession } from '../adapters/historical';
import { signal } from '../adapters/test-fixtures';
import { AYEW_SEQUENCE, PILOT_REVISION, halftimePolicy } from './pilot';
import { momentsAt } from './analysis';
import { sourceBundle, freeze } from './private-fixture';

it('requires the original private clip; verifies source links, raw gaps, precise duration and three actor cuts without rebuilding motion',async()=>{
  const b=await sourceBundle(), original=JSON.stringify(b);freeze(b);
  expect(b.caps.dataset_version).toBe(PILOT_REVISION);expect(b.page.total).toBe(b.page.items.length);
  const readers={capabilities:async()=>b.caps,match:async()=>b.match,manifest:async()=>b.manifest,
    events:vi.fn(async()=>b.page.items),segment:vi.fn(async()=>b.segment),statistics:vi.fn(async()=>{throw new Error('No statistics read for preparation');})};
  const a=createHistoricalSession(3754078,PILOT_REVISION,{readers});
  try {
    const before=a.snapshot();const source=await a.loadSequence!(AYEW_SEQUENCE,signal());
    expect(a.snapshot().presentedCursor).toEqual(before.presentedCursor);expect(a.snapshot().facts).toEqual(before.facts);
    expect(a.snapshot().loadState).not.toBe('ready');expect(readers.statistics).not.toHaveBeenCalled();
    const frames=source.frames.filter(f=>f.clock_ms>=1684024&&f.clock_ms<=1697850);
    expect(frames).toHaveLength(154);expect(frames.filter(f=>f.ball===null)).toHaveLength(70);
    expect(frames.every(f=>f.players.length===22&&new Set(f.players.map(p=>p.key)).size===22)).toBe(true);
    expect(source.frames.every(f=>f.score===null&&f.carrier===null&&f.possession===null)).toBe(true);
    const carry=source.events.find(e=>e.refs.includes('a6f403f1-0209-4f87-b0f7-fd77a5501b9e'))!;
    expect(carry.durationMs).toBeCloseTo(7012.573,9);expect(carry.actorId).toBe('historical:statsbomb:7063');
    expect(source.cuts.some(c=>c.reason==='ball_gap_over_5s')).toBe(true);
    for(const id of ['statsbomb:20521','statsbomb:3347'])expect(source.cuts.some(c=>c.entityIds!=='all'&&c.entityIds.includes(`historical:${id}`))).toBe(true);
    expect(source.cuts.filter(c=>c.reason==='player_motion_limit')).toHaveLength(3);
    const card=momentsAt(source,1695328,'en').at(-1)!;
    expect(card.explanation).toMatch(/Courtois.*Gomis.*Ayew.*Cahill/);expect(card.shotXg).toBe(.26275134);
    expect(card.explanation).toContain('1.4');expect(JSON.stringify(card)).not.toContain('132624e5-65f2-405e-9842-d26eaa11e939');
    expect(source.motionRevision).toBe(b.manifest.reconstruction_id);expect(source.rawDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(source)).toBe(true);expect(Object.isFrozen(source.frames[0])).toBe(true);
    const again=await a.loadSequence!(AYEW_SEQUENCE,signal());expect(again).toEqual(source);expect(readers.events).toHaveBeenCalledOnce();expect(readers.segment).toHaveBeenCalledOnce();
    expect(halftimePolicy(a.snapshot().descriptor).pauseAt).toEqual([{atMs:2880495,endingPeriod:1}]);
    expect(JSON.stringify(b)).toBe(original);
  }finally{a.dispose();vi.unstubAllGlobals();}
});
it('retains the actual 2–1 source score on both sides of the exact half-time boundary',async()=>{
  const b=await sourceBundle();freeze(b);
  expect(b.halfEvents.items).toHaveLength(b.halfEvents.total);expect(b.secondEvents.items).toHaveLength(b.secondEvents.total);
  const a=createHistoricalSession(3754078,PILOT_REVISION,{readers:{capabilities:async()=>b.caps,match:async()=>b.match,manifest:async()=>b.manifest,
    events:async(_id,p)=>p===1?b.halfEvents.items:b.secondEvents.items,
    segment:async()=>{throw new Error('Boundary motion is outside the captured clip');},
    statistics:async(_id,p,ms)=>{const stats=p===1?b.halfStats:b.secondStats;expect(stats.cutoff.period_ms).toBe(ms);return stats;}}});
  try {
    await a.ensure(2880495,signal(),{playback:'paused',endingPeriod:1});
    expect(a.snapshot().loadState).toBe('facts_only');expect(a.snapshot().presentedCursor).toMatchObject({period:1,periodMs:2880495});
    expect(a.snapshot().facts.score.value).toEqual({home:2,away:1});
    await a.loadPanel('summary',2880495,false,signal(),{playback:'paused',endingPeriod:1});
    expect(a.snapshot().panels.summary?.cutoff).toMatchObject({period:1,periodMs:2880495});
    await a.ensure(2880495,signal(),{playback:'playing',explicitSeek:true});
    expect(a.snapshot().presentedCursor).toMatchObject({period:2,periodMs:0});
    expect(a.snapshot().facts.score.value).toEqual({home:2,away:1});
  }finally{a.dispose();vi.unstubAllGlobals();}
});
it('rejects corrupt/duplicate/foreign or aborted private sequence input without changing ordinary source readiness',async()=>{
  const b=await sourceBundle();
  for(const items of [[...b.page.items,b.page.items[0]],b.page.items.map((e,i)=>i===0?{...e,player_key:'foreign'}:e),
    b.page.items.map((e,i)=>i===0?{...e,details:{pass:{recipient:{id:999,name:'Montero'}}}}:e),
    b.page.items.map((e,i)=>i===0?{...e,related_events:['foreign']}:e)]){
    const a=createHistoricalSession(3754078,PILOT_REVISION,{readers:{capabilities:async()=>b.caps,match:async()=>b.match,manifest:async()=>b.manifest,events:async()=>items,segment:async()=>b.segment}});
    await expect(a.loadSequence!(AYEW_SEQUENCE,signal())).rejects.toThrow();expect(a.snapshot().loadState).toBe('buffering');a.dispose();
  }
  const a=createHistoricalSession(3754078,PILOT_REVISION);const c=new AbortController();c.abort();
  await expect(a.loadSequence!(AYEW_SEQUENCE,c.signal)).rejects.toThrow();a.dispose();vi.unstubAllGlobals();
});
