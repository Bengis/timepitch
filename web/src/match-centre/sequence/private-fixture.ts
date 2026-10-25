import { expect, vi } from 'vitest';
import type { HistoricalCapabilities, HistoricalMatch, HistoricalEvent, HistoricalStatistics, ReconstructionManifest, ReconstructionSegment } from '../../historical/api';
import { createHistoricalSession } from '../adapters/historical';
import { signal } from '../adapters/test-fixtures';
import { sampleInterval } from '../sampling';
import type { SampleView } from '../session';
import { AYEW_SEQUENCE, PILOT_REVISION } from './pilot';
import type { SequenceSource } from './types';
import { skipPrivate } from '../../test-private-data';

// Node runner only. Required private fixture, never a Vite/browser module.
export async function sourceBundle() {
  const env = (globalThis as typeof globalThis & {process?:{env:Record<string,string|undefined>}}).process?.env;
  if (!env?.TIMEPITCH_SEQUENCE_SOURCE_DIR) skipPrivate('TIMEPITCH_SEQUENCE_SOURCE_DIR');
  const fsName='node:fs',cryptoName='node:crypto';
  const fs=await import(/* @vite-ignore */ fsName) as {readFileSync:(path:string,encoding:'utf8')=>string};
  const crypto=await import(/* @vite-ignore */ cryptoName) as {webcrypto:Crypto;createHash:(name:string)=>{update:(s:string)=>{digest:(encoding:string)=>string}}};
  vi.stubGlobal('crypto',crypto.webcrypto);
  const raw=(name:string)=>fs.readFileSync(`${env.TIMEPITCH_SEQUENCE_SOURCE_DIR}/${name}.json`,'utf8');
  const sources=JSON.parse(raw('sources')) as {files:Record<string,string>};
  for(const [file,hash] of Object.entries(sources.files))expect(crypto.createHash('sha256').update(fs.readFileSync(`${env.TIMEPITCH_SEQUENCE_SOURCE_DIR}/${file}`,'utf8')).digest('hex')).toBe(hash);
  return {caps:JSON.parse(raw('capabilities')) as HistoricalCapabilities,match:JSON.parse(raw('match')) as HistoricalMatch,
    manifest:JSON.parse(raw('manifest')) as ReconstructionManifest,segment:JSON.parse(raw('segment')) as ReconstructionSegment,
    page:JSON.parse(raw('events')) as {total:number;items:HistoricalEvent[]},
    halfStats:JSON.parse(raw('half-statistics')) as HistoricalStatistics,secondStats:JSON.parse(raw('second-statistics')) as HistoricalStatistics,
    halfEvents:JSON.parse(raw('half-events')) as {total:number;items:HistoricalEvent[]},secondEvents:JSON.parse(raw('second-events')) as {total:number;items:HistoricalEvent[]}};
}
export function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
export async function privateSequence() {
  const b=await sourceBundle();freeze(b);
  const a=createHistoricalSession(3754078,PILOT_REVISION,{readers:{capabilities:async()=>b.caps,match:async()=>b.match,manifest:async()=>b.manifest,events:async()=>b.page.items,segment:async()=>b.segment}});
  try{return {source:await a.loadSequence!(AYEW_SEQUENCE,signal()),bundle:b};}finally{a.dispose();}
}
export function rawView(source:SequenceSource,time:number):SampleView {
  function frame(ms:number) {
    const before=source.frames.filter(f=>f.clock_ms<=ms).at(-1)??source.frames[0];
    const after=source.frames.find(f=>f.clock_ms>ms)??null;
    const cuts=source.cuts.filter(c=>c.fromMs!==null&&c.toMs!==null&&c.fromMs< (after?.clock_ms??ms) && c.toMs>before.clock_ms);
    const blocked=new Set(cuts.flatMap(c=>c.entityIds==='all'?['all']:c.entityIds));
    return sampleInterval({before,after,fromMs:before.clock_ms,toMs:after?.clock_ms??before.clock_ms,
      continuousBall:!blocked.has('all')&&!blocked.has('ball'),continuousPlayers:new Set(before.players.filter(p=>!blocked.has('all')&&!blocked.has(p.key)).map(p=>p.key))},ms);
  }
  return {frame:frame(time),previous:frame(time-100),cursor:{elapsedMs:time,period:1,periodMs:time},clockMs:time,cue:undefined,restarting:false};
}
