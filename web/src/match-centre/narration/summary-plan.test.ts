import {expect,it} from 'vitest';
import {planSummarySpeech,summaryNamesIdentity,type SummaryPlanInput} from './summary-plan';
import {makeSpeechCue,speechPreset,type SpeechIdentity} from './azure-cues';
import type {NarrationLine} from './narration';
import type {SpeechMarker} from './speech-summary';

const source:SpeechIdentity={replayId:'saved',engine:'grf',engineVersion:'g1',calibration:'cal1',datasetVersion:'d1',seed:43,homeKey:'home',awayKey:'away',traceHash:'a'.repeat(64),recordingSha256:'b'.repeat(64),eventsSha256:null,narratorVersion:'narration-tp278-1',namesVersion:'names-1',namesMode:'fictional'};
const line=(id:string,atMs:number,kind:NarrationLine['kind']='shot',text='A shoots.'):NarrationLine=>({id,atMs,kind,text,source:{id:`event:${id}`},side:'home',actorId:null} as NarrationLine);
const markers:SpeechMarker[]=(['opening','halftime','second-half','fulltime'] as const).map((phase,i)=>({phase,line:line(`speech:${phase}`,[0,30000,30000,60000][i],'mark',`Marker ${phase}.`),sourceIds:[`native:${phase}`],originalTimes:[[0,30000,29900,60000][i]],rule:'observed_boundary'}));
type MutableInput={-readonly [K in keyof SummaryPlanInput]:SummaryPlanInput[K]};
const input=():MutableInput=>({source,windows:[{fromMs:0,toMs:8000},{fromMs:10000,toMs:22000},{fromMs:28000,toMs:32000},{fromMs:50000,toMs:60000}],durationMs:60000,
  summaries:{en:{actionLines:[line('pass',11000,'pass'),line('shot',19500),line('goal',20000,'goal'),line('outside',40000)],markers},es:{actionLines:[line('pass',11000,'pass','A pasa.'),line('shot',19500,'shot','A dispara.'),line('goal',20000,'goal','¡Gol de A!'),line('outside',40000)],markers}},
  markerTiming:'held',prior:{requests:4,reservations:4,ssmlBytes:1179},cache:[]});

it('reserves non-overlapping slots for goals and one ordinary phrase before them, omitting the adjacent shot',async()=>{
  const p=await planSummarySpeech(input());const en=p.selected.filter(x=>x.cue.locale==='en');
  expect(en.find(x=>x.cue.eventId==='event:goal')?.slot).toEqual({clock:'replay',phase:'replay',fromMs:20000,toMs:22000});
  expect(en.find(x=>x.cue.eventId==='event:pass')?.cue.playUntilMs).toBe(20000);
  expect(p.omitted).toContainEqual(expect.objectContaining({lineId:'shot',locale:'en',reason:'too_close_to_priority_or_cut'}));
  expect(p.omitted).toContainEqual(expect.objectContaining({lineId:'outside',reason:'outside_montage'}));
  expect(en.find(x=>x.cue.eventId==='event:goal')).toMatchObject({durationState:'unmeasured',latestStartMs:null,maxAudioMs:1750});
  expect(p.fullSpokenCoverageVerified).toBe(false);expect(p.authorized).toBe(false);expect(p.synthesisRequests).toBe(0);
});
it('keeps all four markers factual and in separate presentation phases, with full-time after the final replay fact',async()=>{
  const p=await planSummarySpeech(input()),en=p.selected.filter(x=>x.cue.locale==='en'&&x.slot.clock==='presentation');
  expect(en.map(x=>x.slot.phase)).toEqual(['opening','halftime','second-half','fulltime']);
  expect(en.every(x=>x.slot.fromMs===0&&x.slot.toMs===15000)).toBe(true);
  const full=en[3];expect(full.replayAtMs).toBe(60000);expect(full.sourceIds).toEqual(['native:fulltime']);
  expect(p.replay.summaryMs).toBe(34000);expect(p.replay.windows).toEqual(input().windows);
});
it('bounded marker choice preserves montage time and marks short unmeasured priority slots honestly',async()=>{
  const i=input();i.markerTiming='bounded';const p=await planSummarySpeech(i),second=p.selected.find(x=>x.cue.locale==='en'&&x.slot.phase==='second-half');
  expect(second?.slot).toEqual({clock:'replay',phase:'second-half',fromMs:30000,toMs:32000});
  expect(second?.risks).toContain('short_unmeasured_priority_slot');
  expect(p.selected.find(x=>x.slot.phase==='halftime')?.slot.clock).toBe('presentation');
});
it('counts every new SSML byte cumulatively without discounting the two unused spent samples',async()=>{
  const p=await planSummarySpeech(input());expect(p.budget.prior).toEqual({requests:4,reservations:4,ssmlBytes:1179});
  expect(p.budget.proposedNew.requests).toBe(p.selected.length);
  expect(p.budget.proposedNew.ssmlBytes).toBe(p.selected.reduce((n,x)=>n+new TextEncoder().encode(x.cue.ssml).length,0));
  expect(p.budget.proposedCumulative.requests).toBe(4+p.selected.length);expect(p.budget.proposedCumulative.reservations).toBe(4+p.selected.length);
  expect(p.budget.proposedCumulative.ssmlBytes).toBe(1179+p.budget.proposedNew.ssmlBytes);expect(p.budget.speechCostCeilingEur).toBe(0);
});
it('reuses only the complete original cue binding, and computes the measured startup deadline',async()=>{
  const i=input();i.summaries.en.actionLines=[line('goal',14000,'goal')];
  const cue=await makeSpeechCue(i.summaries.en.actionLines[0],source,speechPreset('en-goal'),i.windows[1]);
  i.cache=[{source,cue,asset:{file:'saved.mp3',sha256:'c'.repeat(64),durationMs:7704,receiptSha256:'d'.repeat(64)}}];
  const p=await planSummarySpeech(i),goal=p.selected.find(x=>x.cue.eventId==='event:goal'&&x.cue.locale==='en');
  expect(goal).toMatchObject({durationState:'measured_cached',latestStartMs:46,maxAudioMs:7750});
  expect(p.budget.cached).toBe(1);expect(p.budget.proposedNew.requests).toBe(p.selected.length-1);
  const changed={...i,source:{...source,namesVersion:'display-names-2'}};const revised=await planSummarySpeech(changed);
  expect(revised.budget.cached).toBe(0);expect(revised.cacheNotUsed[0].reason).toBe('identity_not_selected');
});
it('is deterministic, preserves caller data, uses neutral markers and rejects a forged cache binding',async()=>{
  const i=input(),before=JSON.stringify(i),a=await planSummarySpeech(i);expect(a).toEqual(await planSummarySpeech(i));expect(JSON.stringify(i)).toBe(before);
  expect(a.selected.filter(x=>x.cue.kind==='mark').every(x=>x.cue.style===null&&x.cue.binding.preset.rate==='0%')).toBe(true);
  const goal=a.selected.find(x=>x.cue.kind==='goal')!;i.cache=[{source,cue:{...goal.cue,text:'A different fact'},asset:{file:'forged.mp3',sha256:'c'.repeat(64),durationMs:300,receiptSha256:'d'.repeat(64)}}];
  await expect(planSummarySpeech(i)).rejects.toThrow(/cache binding/i);
});
it('rejects reset usage, overlapping windows and coincident priority events before producing a proposal',async()=>{
  const i=input();await expect(planSummarySpeech({...i,prior:{requests:0,reservations:0,ssmlBytes:0}})).rejects.toThrow(/prior/i);
  await expect(planSummarySpeech({...i,windows:[{fromMs:0,toMs:15000},{fromMs:10000,toMs:60000}]})).rejects.toThrow(/windows/i);
  i.summaries.en.actionLines=[...i.summaries.en.actionLines,line('other-goal',20000,'goal')];
  await expect(planSummarySpeech(i)).rejects.toThrow(/priority/i);
});
it('versions the exact displayed player identities while preserving the recorded identity when explicitly selected',async()=>{
  const names=[{id:'p1',name:'Visible A',qid:'Q1'},{id:'p2',name:'Visible B',qid:'Q2'}];
  expect(await summaryNamesIdentity(source,'recorded',names)).toEqual(source);
  const display=await summaryNamesIdentity(source,'display',names);
  expect(display.namesVersion).not.toBe(source.namesVersion);expect(display).toEqual(await summaryNamesIdentity(source,'display',[...names].reverse()));
  expect((await summaryNamesIdentity(source,'display',[names[0],{...names[1],qid:'Q3'}])).namesVersion).not.toBe(display.namesVersion);
  expect(source.namesVersion).toBe('names-1');
});
