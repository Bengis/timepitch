import { expect, it } from 'vitest';
import type { HistoricalEvent, HistoricalMatch, HistoricalStatistics, ReconstructionManifest, ReconstructionSegment } from '../../historical/api';
import { createHistoricalSession } from './historical';
import { normalizeHistoricalMetrics } from './metrics';
import { signal } from './test-fixtures';
import {sampleInterval} from '../sampling';

type CapturedSource={match:HistoricalMatch;manifest:ReconstructionManifest;segments:ReconstructionSegment[];windows:HistoricalEvent[][];statistics:HistoricalStatistics[];final:HistoricalStatistics};
// Optional private capture read by Vitest's Node runner, never served by Vite.
// Keep Node-only APIs out of the browser tsconfig/dependency set.
const input=(globalThis as typeof globalThis & {process?:{env:Record<string,string|undefined>}}).process?.env.TIMEPITCH_UNIFIED_REAL_FIXTURE;
function freeze(value:unknown){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}}

it.runIf(Boolean(input))('normalizes accepted local3754078 source files without mutation, retaining all metrics and the recorded2–2',async()=>{
  const moduleName='node:fs';
  const fs=await import(/* @vite-ignore */ moduleName) as {readFileSync:(path:string,encoding:'utf8')=>string};
  const data=JSON.parse(fs.readFileSync(input!,'utf8')) as CapturedSource;const original=JSON.stringify(data);freeze(data);
  const panel=normalizeHistoricalMetrics(data.match,data.final);
  const ids=new Set([...data.final.teams.flatMap(t=>Object.keys(t.metrics)),...data.final.players.flatMap(p=>Object.keys(p.metrics))]);
  const retained=new Set([...panel.metrics,...panel.players.flatMap(p=>p.metrics)].map(m=>m.id));
  expect([...ids].every(id=>retained.has(id))).toBe(true);expect(panel.players).toHaveLength(data.final.players.length);
  expect(data.final.score).toEqual({home:2,away:2});
  const adapter=createHistoricalSession(3754078,data.manifest.dataset_version,{readers:{
    capabilities:async()=>({two_modes_ui:true,reconstruction_enabled:true,dataset_state:'ready',dataset_version:data.manifest.dataset_version,publication_status:'blocked_pending_permission'}),
    match:async()=>data.match,manifest:async()=>data.manifest,
    events:async(_id,p,from)=>data.windows.find(items=>items.some(e=>e.period===p&&Math.floor(e.period_ms/60000)*60000===from))??[],
    segment:async(_id,p,index)=>{const segment=data.segments.find(s=>s.period===p&&s.index===index);if(!segment)throw new Error('Segment not captured');return segment;},
    statistics:async(_id,p,ms)=>{const result=[...data.statistics,data.final].find(s=>s.cutoff.period===p&&s.cutoff.period_ms===ms);if(!result)throw new Error('Cutoff not captured');return result;},
  }});
  try{
    for(const ms of [0,50,100,59999,60000,60050,119999]){
      await adapter.ensure(ms,signal());expect(adapter.snapshot().loadState).toBe('ready');
      expect(adapter.snapshot().presentedCursor.elapsedMs).toBe(ms);
      expect(adapter.snapshot().events.every(e=>e.elapsedMs!==null&&e.elapsedMs<=ms)).toBe(true);
      expect(adapter.cacheUsage().segments).toBeLessThanOrEqual(3);expect(adapter.cacheUsage().segmentBytes).toBeLessThanOrEqual(12*1024*1024);
    }
    // Exact real source frame times supply an independent oracle for unknown ball/cuts.
    for(const frame of data.segments[0].frames.filter(f=>f.ball===null).slice(0,3)){
      await adapter.ensure(frame.period_ms,signal());const snapshot=adapter.snapshot();
      expect(snapshot.interval).not.toBeNull();expect(sampleInterval(snapshot.interval!,frame.period_ms).ball).toBeNull();
      expect(snapshot.facts.carrierId.value).toBeNull();expect(snapshot.facts.possession.value).toBeNull();
    }
    await adapter.loadPanel('summary',0,true,signal());
    expect(adapter.snapshot().panels.summary?.scope).toBe('final');
    expect(adapter.snapshot().panels.summary?.metrics.find(m=>m.id==='goals'&&m.subject?.id===data.match.home_team.key)?.value).toBe(2);
  }finally{adapter.dispose();}
  expect(JSON.stringify(data)).toBe(original);
});
