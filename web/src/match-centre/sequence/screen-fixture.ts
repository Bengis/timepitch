import { vi } from 'vitest';
import { syntheticAdapter, syntheticSnapshot } from '../unified-fixtures';
import { cursorAt } from '../session';
import { privateSequence, rawView } from './private-fixture';
import { compileDepiction } from './depiction';
import { AYEW_POLICY } from './pilot';
import type { SequencePresentation } from './types';

// UI boundary oracle over the sealed clip; never a native run or a new reconstruction.
export async function sequenceScreenFixture() {
  const {source}=await privateSequence(),s=syntheticSnapshot(source.identity);
  s.descriptor.durationMs=5851968;s.descriptor.periods=[{period:1,startMs:0,durationMs:2880495},{period:2,startMs:2880495,durationMs:2971473}];
  s.descriptor.metadata={clockBasis:'source_period_local',finalResult:{score:{home:2,away:2}}};
  s.descriptor.home.name='Chelsea';s.descriptor.away.name='Swansea';
  const store=syntheticAdapter(s);
  store.adapter.ensure=vi.fn(async(ms,signal,demand)=>{
    if(signal.aborted)return;
    const frame=rawView(source,ms).frame,score=ms>=2878495?{home:2,away:1}:{home:1,away:ms>=1697116?1:0};frame.score=score;
    store.publish({...s,requestedCursor:cursorAt(s.descriptor,ms,demand?.endingPeriod),presentedCursor:cursorAt(s.descriptor,ms,demand?.endingPeriod),clockMs:cursorAt(s.descriptor,ms,demand?.endingPeriod).periodMs,
      facts:{...s.facts,score:{value:score,provenance:'source_recorded',refs:[]}},horizonMs:5851968,
      loadState:ms>source.request.toMs?'facts_only':'ready',interval:ms>source.request.toMs?null:{fromMs:ms,toMs:ms+100,before:frame,after:{...frame,clock_ms:ms+100},continuousPlayers:new Set(frame.players.map(p=>p.key)),continuousBall:true}});
  });
  store.adapter.loadSequence=vi.fn(async()=>source);
  store.adapter.loadPanel=vi.fn(async()=>{});store.adapter.loadPlayer=vi.fn(async()=>{});store.adapter.dispose=vi.fn();
  const sequence:SequencePresentation={kind:'actions',source,depiction:compileDepiction(source,'historical-action-preview-2'),policy:AYEW_POLICY};
  return {...store,sequence};
}
