// Offline preparation only. No Speech client, admission, credentials, audio generation or playback.
import { fictionalClub, fictionalPlayer, type NamesMode } from '../../catalog/fictional';
import league from '../../catalog/fictional-league.json';
import { loadRecordedReplay, type RecordedReplayEntry, sha256Hex } from '../adapters/recorded-replay';
import { loadRecordedEvents } from '../adapters/recorded-events';
import { createRecordedSession } from '../adapters/recorded-session';
import { ns } from '../adapters/base';
import type {RecordedTrack} from '../adapters/recorded-track';
import { planHighlights, type HighlightWindow } from '../highlights';
import { narrate, type NarrationLine } from './narration';

export const SPEECH_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const VERSION='azure-speech-dry-1', NARRATOR_VERSION='narration-tp278-1', MARGIN_MS=250;
export type SpeechPreset=Readonly<{id:string;locale:'en'|'es';language:string;voice:string;style:'excited'|'cheerful'|null;rate:string;pitch:string;label?:string}>;
const PRESETS:Readonly<Record<string,SpeechPreset>>=Object.freeze({
  'en-neutral':{id:'en-neutral',locale:'en',language:'en-US',voice:'en-US-GuyNeural',style:null,rate:'0%',pitch:'0%'},
  'en-goal':{id:'en-goal',locale:'en',language:'en-US',voice:'en-US-GuyNeural',style:'excited',rate:'+5%',pitch:'+3%'},
  'es-neutral':{id:'es-neutral',locale:'es',language:'es-ES',voice:'es-ES-AlvaroNeural',style:null,rate:'0%',pitch:'0%'},
  'es-goal-prosody-2':{id:'es-goal-prosody-2',locale:'es',language:'es-ES',voice:'es-ES-AlvaroNeural',style:null,rate:'+5%',pitch:'+3%',label:'More energetic prosody'},
});
export function speechPreset(id:string):SpeechPreset {
  if(id==='es-goal')id='es-goal-prosody-2';
  if(!Object.hasOwn(PRESETS,id))throw new Error('Unsupported Speech preset');
  return {...PRESETS[id]};
}
export type SpeechIdentity=Readonly<{replayId:string;engine:'grf';engineVersion:string;calibration:string;datasetVersion:string;seed:number;homeKey:string;awayKey:string;traceHash:string;recordingSha256:string;eventsSha256:string|null;narratorVersion:string;namesVersion:string;namesMode:NamesMode}>;
const hash=(text:string)=>sha256Hex(new TextEncoder().encode(text));
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const xml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));

export async function makeSpeechCue(line:NarrationLine,source:SpeechIdentity,preset:SpeechPreset,window:HighlightWindow){
  const trusted=speechPreset(preset.id);
  if(JSON.stringify(trusted)!==JSON.stringify(preset))throw new Error('Speech preset was modified');
  if(!line.text.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(line.text))throw new Error('Invalid XML speech text');
  if(!Number.isFinite(line.atMs)||!Number.isFinite(window.fromMs)||!Number.isFinite(window.toMs)||line.atMs<window.fromMs||line.atMs+MARGIN_MS>=window.toMs)throw new Error('Cue has no permitted playback window');
  const body=`<prosody rate="${preset.rate}" pitch="${preset.pitch}">${xml(line.text)}</prosody>`;
  const styled=preset.style?`<mstts:express-as style="${preset.style}">${body}</mstts:express-as>`:body;
  const ssml=`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${preset.language}"><voice name="${preset.voice}">${styled}</voice></speak>`;
  const textSha256=await hash(line.text),ssmlSha256=await hash(ssml);
  const binding={version:VERSION,sourceSha256:await hash(canonical(source)),eventId:line.source.id,atMs:line.atMs,window,preset,format:SPEECH_FORMAT,textSha256,ssmlSha256};
  return {id:`${line.id}:${preset.id}`,eventId:line.source.id,kind:line.kind,text:line.text,atMs:line.atMs,playUntilMs:window.toMs,maxDurationMs:window.toMs-line.atMs-MARGIN_MS,
    locale:preset.locale,voice:preset.voice,style:preset.style,format:SPEECH_FORMAT,textSha256,ssmlSha256,ssml,bytes:new TextEncoder().encode(ssml).byteLength,
    binding,cacheKey:await hash(canonical(binding)),...(preset.label?{treatment:preset.label}:{}),audio:{state:'not_generated' as const,assetSha256:null,durationMs:null}};
}
export type DrySpeechCue=Awaited<ReturnType<typeof makeSpeechCue>>;

/** The same source identity is used by offline preparation and the saved-replay test player. */
export async function recordedSpeechIdentity(entry:RecordedReplayEntry,track:RecordedTrack,namesMode:NamesMode):Promise<SpeechIdentity>{
  if(entry.engine!=='grf'||track.engine!=='grf'||entry.trace_hash!==track.traceHash)throw new Error('Speech source identity mismatch');
  return {replayId:entry.id,engine:'grf',engineVersion:track.engineVersion,calibration:entry.calibration,datasetVersion:track.datasetVersion,seed:track.seed,homeKey:track.home.key,awayKey:track.away.key,traceHash:track.traceHash,
    recordingSha256:entry.sha256,eventsSha256:entry.events?.sha256??null,narratorVersion:NARRATOR_VERSION,
    namesVersion:`fictional-fnv1a-1:${await hash(JSON.stringify(league))}`,namesMode};
}

export async function prepareRecordedSpeech(entry:RecordedReplayEntry,read:(file:string,signal:AbortSignal)=>Promise<ArrayBuffer>,
  options:{namesMode:NamesMode;throughMs?:number;signal?:AbortSignal}){
  if(entry.engine!=='grf')throw new Error('Initial Speech pilot supports only the saved GRF replay');
  if(!['fictional','real'].includes(options.namesMode))throw new Error('Invalid names mode');
  const signal=options.signal??new AbortController().signal;
  const track=await loadRecordedReplay(entry,read,signal),recorded=await loadRecordedEvents(entry,read,signal);
  const adapter=createRecordedSession(entry.id,track,recorded);
  try {
    const full=adapter.resolveFrame(track.durationMs),throughMs=options.throughMs??track.durationMs;
    if(!Number.isFinite(throughMs)||throughMs<0||throughMs>track.durationMs)throw new Error('Invalid preparation cutoff');
    const events=[...full.events,...(full.touches??[])].filter(e=>e.elapsedMs!==null&&e.elapsedMs<=throughMs);
    const half=track.periodStarts.find(p=>p.period===2),halfMs=half?half.index*track.intervalMs:null;
    const windows=planHighlights(track.durationMs,halfMs,full.events).policy.windows!;
    const source=await recordedSpeechIdentity(entry,track,options.namesMode);
    const fict=options.namesMode==='fictional';
    const names=new Map(track.players.map(p=>[ns(track.engine,p.id),fict?fictionalPlayer(p.name):p.name]));
    const keepers=new Set(track.players.filter(p=>p.role==='GK').map(p=>ns(track.engine,p.id)));
    const teams={home:fict?fictionalClub(track.home.name):track.home.name,away:fict?fictionalClub(track.away.name):track.away.name};
    const cues:DrySpeechCue[]=[],pilot:DrySpeechCue[]=[],omitted:{id:string;locale:string;reason:string}[]=[];
    for(const locale of ['en','es'] as const){
      const lines=narrate(events,{locale,name:id=>id?names.get(id)??null:null,keepers,teams});
      let pilotPicked=false;
      for(const line of lines){
        const window=windows.find(w=>line.atMs>=w.fromMs&&line.atMs+MARGIN_MS<w.toMs);
        if(!window){omitted.push({id:line.id,locale,reason:'outside_window_or_no_room'});continue;}
        const goal=line.kind==='goal'||line.kind==='own_goal';
        cues.push(await makeSpeechCue(line,source,speechPreset(`${locale}-${goal?'goal':'neutral'}`),window));
        if(goal&&!pilotPicked){
          pilotPicked=true;
          for(const variant of ['neutral','goal'])pilot.push(await makeSpeechCue(line,source,speechPreset(`${locale}-${variant}`),window));
        }
      }
    }
    cues.sort((a,b)=>a.atMs-b.atMs||a.id.localeCompare(b.id));
    const bytes=pilot.reduce((n,c)=>n+c.bytes,0);
    return {version:VERSION,authorized:false as const,synthesisRequests:0 as const,source,throughMs,windows,cues,omitted,
      pilot:{status:'proposal_not_admitted' as const,proposedRequests:pilot.length,requestLimit:4,bytes,byteLimit:4000,withinLimit:pilot.length===4&&bytes<=4000,cues:pilot},
      audioAssets:0 as const,capabilityCheck:'regional_voice_styles_and_F0_not_verified' as const};
  } finally {adapter.dispose();}
}
