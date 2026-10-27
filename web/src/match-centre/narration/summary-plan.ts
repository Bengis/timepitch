import {makeSpeechCue,speechPreset,type DrySpeechCue,type SpeechIdentity} from './azure-cues';
import type {NarrationLine} from './narration';
import {SPEECH_SUMMARY_VERSION,type SpeechMarker,type SpeechPhase} from './speech-summary';
import type {HighlightWindow} from '../highlights';
import {sha256Hex} from '../adapters/recorded-bytes';

export const SUMMARY_PLAN_VERSION='speech-summary-plan-1';
export type SpeechUsage=Readonly<{requests:number;reservations:number;ssmlBytes:number}>;
export type VerifiedSpeechCache=Readonly<{source:SpeechIdentity;cue:DrySpeechCue;asset:Readonly<{file:string;sha256:string;durationMs:number;receiptSha256:string}>}>;
type Summary={actionLines:readonly NarrationLine[];markers:readonly SpeechMarker[]};
export type SummaryPlanInput=Readonly<{source:SpeechIdentity;windows:readonly HighlightWindow[];durationMs:number;
  summaries:Readonly<Record<'en'|'es',Summary>>;markerTiming:'held'|'bounded';prior:SpeechUsage;cache:readonly VerifiedSpeechCache[]}>;
type Slot={clock:'replay'|'presentation';phase:'replay'|SpeechPhase;fromMs:number;toMs:number};
type Selected={cue:DrySpeechCue;slot:Slot;replayAtMs:number;sourceIds:readonly string[];originalTimes:readonly number[];
  compositorVersion:string;maxAudioMs:number;maxStartupMs:number;latestStartMs:number|null;
  durationState:'unmeasured'|'measured_cached';asset:VerifiedSpeechCache['asset']|null;risks:string[]};
type Omitted={lineId:string;locale:'en'|'es';atMs:number;reason:string};
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const goal=(line:NarrationLine)=>line.kind==='goal'||line.kind==='own_goal';
const phases:SpeechPhase[]=['opening','halftime','second-half','fulltime'];
const rank=(line:NarrationLine)=>['save','miss','shot','won','carry','pass','set_piece','offside'].indexOf(line.kind);
const fail=(text:string):never=>{throw new Error(text);};

export async function summaryNamesIdentity(source:SpeechIdentity,mode:'recorded'|'display',names:readonly {id:string;name:string;qid:string|null}[]):Promise<SpeechIdentity>{
  if(mode==='recorded')return{...source};
  if(mode!=='display'||!names.length||names.some(n=>!n.id||!n.name)||new Set(names.map(n=>n.id)).size!==names.length)fail('Invalid summary names identity');
  const fingerprint=await sha256Hex(new TextEncoder().encode(canonical([...names].sort((a,b)=>a.id.localeCompare(b.id)))));
  return{...source,namesVersion:`${source.namesVersion}:resolved-cast-names-1:${fingerprint}`};
}

/** Pure dry proposal. Unmeasured speech owns its complete slot; no claim that it will fit until decoded. */
export async function planSummarySpeech(input:SummaryPlanInput){
  const {source,windows,durationMs,prior}=input;
  if(!['held','bounded'].includes(input.markerTiming))fail('Explicit marker timing required');
  if(!Number.isFinite(durationMs)||durationMs<=0||!windows.length||windows[0].fromMs!==0||windows.at(-1)!.toMs!==durationMs||
    windows.some((w,i)=>!Number.isFinite(w.fromMs)||!Number.isFinite(w.toMs)||w.fromMs<0||w.toMs>durationMs||w.fromMs>=w.toMs||i>0&&w.fromMs<windows[i-1].toMs))fail('Invalid montage windows');
  if(!Object.values(prior).every(n=>Number.isSafeInteger(n)&&n>=0)||prior.requests<4||prior.reservations<4||prior.ssmlBytes<1179||prior.requests<prior.reservations)fail('Invalid or reset prior Speech usage');
  const cache=new Map<string,VerifiedSpeechCache>();
  for(const saved of input.cache){
    const {cue,asset}=saved,preset=speechPreset(cue.binding.preset.id),suffix=`:${preset.id}`;
    if(!cue.id.endsWith(suffix)||cache.has(cue.cacheKey)||!Number.isFinite(asset.durationMs)||asset.durationMs<=0||
      !/^[\w.-]+\.mp3$/.test(asset.file)||!/^[a-f0-9]{64}$/.test(asset.sha256)||!/^[a-f0-9]{64}$/.test(asset.receiptSha256))fail('Invalid saved cache binding');
    const rebuilt=await makeSpeechCue({id:cue.id.slice(0,-suffix.length),source:{id:cue.eventId},kind:cue.kind,text:cue.text,atMs:cue.atMs} as NarrationLine,saved.source,preset,cue.binding.window);
    if(canonical(rebuilt)!==canonical(cue))fail('Invalid saved cache binding');cache.set(cue.cacheKey,saved);
  }
  const selected:Selected[]=[],omitted:Omitted[]=[],used=new Set<string>();
  const skip=(line:NarrationLine,locale:'en'|'es',reason:string)=>omitted.push({lineId:line.id,locale,atMs:line.atMs,reason});
  async function select(line:NarrationLine,locale:'en'|'es',slot:Slot,window:HighlightWindow,marker?:SpeechMarker){
    const speechLine=marker?{...line,id:`${SPEECH_SUMMARY_VERSION}:${line.id}`,source:{...line.source,id:`${SPEECH_SUMMARY_VERSION}:${line.source.id}`}}:line;
    const cue=await makeSpeechCue(speechLine,source,speechPreset(`${locale}-${goal(line)?'goal':'neutral'}`),window);
    const saved=cache.get(cue.cacheKey),maxAudioMs=slot.toMs-slot.fromMs-250;
    if(saved&&canonical(saved.cue)!==canonical(cue))fail('Conflicting cache binding');
    const deadline=saved?Math.min(250,maxAudioMs-saved.asset.durationMs):null;
    if(deadline!==null&&deadline<0){skip(line,locale,'cached_duration_exceeds_slot');return;}
    if(saved)used.add(cue.cacheKey);
    selected.push({cue,slot,replayAtMs:line.atMs,sourceIds:marker?marker.sourceIds:[line.source.id,...(line.source.refs??[])],
      originalTimes:marker?marker.originalTimes:[line.atMs],compositorVersion:SPEECH_SUMMARY_VERSION,maxAudioMs,maxStartupMs:250,latestStartMs:deadline,
      durationState:saved?'measured_cached':'unmeasured',asset:saved?.asset??null,
      risks:!saved&&maxAudioMs<3750?['short_unmeasured_priority_slot']:[]});
  }
  for(const locale of ['en','es'] as const){
    const summary=input.summaries[locale];
    if(canonical(summary.markers.map(m=>m.phase))!==canonical(phases))fail('Invalid presentation marker order');
    const half=summary.markers[1].line.atMs;
    if(half<=0||half>=durationMs||canonical(summary.markers.map(m=>m.line.atMs))!==canonical([0,half,half,durationMs]))fail('Invalid presentation marker anchors');
    if(locale==='es'&&half!==input.summaries.en.markers[1].line.atMs)fail('Locale marker anchors differ');
    const bounded:HighlightWindow[]=[];
    for(const marker of summary.markers){
      const {line,phase}=marker,held=input.markerTiming==='held'||phase==='halftime'||phase==='fulltime';
      const window=held?{fromMs:line.atMs,toMs:line.atMs+15000}:windows.find(w=>line.atMs>=w.fromMs&&line.atMs<w.toMs);
      if(!window)throw new Error('Presentation marker outside permitted window');
      await select(line,locale,{clock:held?'presentation':'replay',phase,fromMs:held?0:line.atMs,toMs:held?15000:window.toMs},window,marker);
      if(!held)bounded.push({fromMs:line.atMs,toMs:window.toMs});
    }
    const lines=[...summary.actionLines].sort((a,b)=>a.atMs-b.atMs||a.id.localeCompare(b.id));
    const ids=new Set<string>();for(const line of lines){
      if(ids.has(line.id)||!Number.isFinite(line.atMs)||line.atMs<0||line.atMs>durationMs||line.kind==='mark')fail('Invalid or duplicate action line');ids.add(line.id);
      if(!windows.some(w=>line.atMs>=w.fromMs&&line.atMs<w.toMs)){if(goal(line))fail('Priority goal outside montage');skip(line,locale,'outside_montage');}
    }
    for(const w of windows){
      const sections=w.fromMs<half&&half<w.toMs?[{fromMs:w.fromMs,toMs:half},{fromMs:half,toMs:w.toMs}]:[w];
      for(const section of sections){
        const actions=lines.filter(l=>l.atMs>=section.fromMs&&l.atMs<section.toMs),goals=actions.filter(goal);
        if(goals.some((l,i)=>i>0&&l.atMs-goals[i-1].atMs<=250))fail('Overlapping priority goals');
        const reserve=bounded.find(b=>section.fromMs>=b.fromMs&&section.fromMs<b.toMs);
        if(reserve){for(const line of actions){if(goal(line))fail('Priority goal conflicts with presentation marker');skip(line,locale,'presentation_slot_reserved');}continue;}
        for(let i=0;i<goals.length;i++){
          const line=goals[i],end=goals[i+1]?.atMs??section.toMs;
          // Preserve original window identity when it has not been shortened by a higher priority boundary.
          await select(line,locale,{clock:'replay',phase:'replay',fromMs:line.atMs,toMs:end},{fromMs:w.fromMs,toMs:end});
        }
        const ordinary=actions.filter(l=>!goal(l)),end=goals[0]?.atMs??section.toMs;
        const eligible=ordinary.filter(l=>l.atMs<end&&end-l.atMs>=4000).sort((a,b)=>rank(a)-rank(b)||a.atMs-b.atMs||a.id.localeCompare(b.id));
        const chosen=eligible[0];if(chosen)await select(chosen,locale,{clock:'replay',phase:'replay',fromMs:chosen.atMs,toMs:end},{fromMs:w.fromMs,toMs:end});
        for(const line of ordinary)if(line!==chosen)skip(line,locale,line.atMs>=end?'priority_slot_reserved':end-line.atMs<4000?'too_close_to_priority_or_cut':'lower_priority_slot_reserved');
      }
    }
  }
  const phaseRank=(p:Slot['phase'])=>p==='replay'?1:phases.indexOf(p)*2;
  selected.sort((a,b)=>a.replayAtMs-b.replayAtMs||phaseRank(a.slot.phase)-phaseRank(b.slot.phase)||a.cue.locale.localeCompare(b.cue.locale)||a.cue.id.localeCompare(b.cue.id));
  omitted.sort((a,b)=>a.atMs-b.atMs||a.locale.localeCompare(b.locale)||a.lineId.localeCompare(b.lineId));
  const misses=selected.filter(x=>!x.asset),proposedNew={requests:misses.length,reservations:misses.length,ssmlBytes:misses.reduce((n,x)=>n+x.cue.bytes,0)};
  const body={version:SUMMARY_PLAN_VERSION,authorized:false as const,synthesisRequests:0 as const,reservationsCreated:0 as const,source,
    selection:{version:SUMMARY_PLAN_VERSION,markerTiming:input.markerTiming,minOrdinarySlotMs:4000,endGuardMs:250,startupCeilingMs:250,presentationSlotMs:15000},
    replay:{durationMs,windows:windows.map(w=>({...w})),summaryMs:windows.reduce((n,w)=>n+w.toMs-w.fromMs,0)},selected,omitted,
    cacheNotUsed:input.cache.filter(c=>!used.has(c.cue.cacheKey)).map(c=>({cacheKey:c.cue.cacheKey,file:c.asset.file,reason:'identity_not_selected'})),
    fullSpokenCoverageVerified:false as const,actualDurationsPending:misses.length,
    budget:{prior:{...prior},cached:used.size,proposedNew,proposedCumulative:{requests:prior.requests+proposedNew.requests,reservations:prior.reservations+proposedNew.reservations,ssmlBytes:prior.ssmlBytes+proposedNew.ssmlBytes},speechCostCeilingEur:0 as const}};
  return{...body,proposalSha256:await sha256Hex(new TextEncoder().encode(canonical(body)))};
}
