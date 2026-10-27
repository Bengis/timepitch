import {expect} from 'vitest';
import {loadSummarySpeechAudio} from './summary-speech';
import type {ReplayAudioSource} from './ReplayAudio';
import {TRACKED_REPLAY_INDEX,loadRecordedReplay} from '../adapters/recorded-replay';
import {loadRecordedEvents} from '../adapters/recorded-events';
import {createRecordedSession} from '../adapters/recorded-session';
import {resolveSummaryDisplaySource} from './summary-source';
import {composeSpeechSummary} from './speech-summary';
import {summaryScope,applySummaryCorrections} from './summary-corrections';
import {fictionalClub} from '../../catalog/fictional';
import sealed from './fixtures/summary-cache.json';
import {prepareRecordedAnalysis} from '../analysis/recorded-analysis';

// Real, local files only; the port models playback timing without decoding or playing sound.
const fsModule='node:fs';
const {readFileSync,existsSync}=await import(/* @vite-ignore */fsModule) as {
  existsSync:(p:string)=>boolean;
  readFileSync:{(p:string,encoding:'utf8'):string;(p:string):Uint8Array<ArrayBuffer>};
};
export const savedSummaryAvailable=existsSync('../.local/speech-tp301/preview-manifest.json')&&existsSync('../.local/replays-dist');
export const savedSummarySource={manifestUrl:'/speech-summary-preview/manifest.json',expectedSource:sealed.source} as ReplayAudioSource;
export async function savedSummaryFixture(locale:'en'|'es'){
  const entry=TRACKED_REPLAY_INDEX.recordings.find(e=>e.id===savedSummarySource.expectedSource.replayId)!;
  const read=async(file:string)=>Uint8Array.from(readFileSync('../.local/replays-dist/'+file)).buffer;
  const signal=new AbortController().signal;
  const track=await loadRecordedReplay(entry,read,signal),recorded=await loadRecordedEvents(entry,read,signal);
  const adapter=createRecordedSession(entry.id,track,recorded);
  const resolved=await resolveSummaryDisplaySource(entry,track,adapter.snapshot().panels.data!.players,async file=>JSON.parse(readFileSync('../web/public/data/players/'+file,'utf8')));
  expect(resolved.source).toEqual(savedSummarySource.expectedSource);
  const names=new Map(resolved.identities.map(p=>[p.id,p.name]));
  const ctx={locale,name:(id:string|null)=>id?names.get(id)??null:null,keepers:new Set(track.players.filter(p=>p.role==='GK').map(p=>`${track.engine}:${p.id}`)),teams:{home:fictionalClub(track.home.name),away:fictionalClub(track.away.name)}};
  const descriptor=adapter.snapshot().descriptor;
  const at=(ms:number)=>{
    const snapshot=adapter.resolveFrame(ms);
    return composeSpeechSummary([...snapshot.events,...(snapshot.touches??[])],descriptor.periods,track.durationMs,ctx);
  };
  const linesAt=(ms:number)=>applySummaryCorrections(at(ms).actionLines,summaryScope(savedSummarySource.expectedSource,locale));
  let counter=0;
  const prepared=await loadSummarySpeechAudio(savedSummarySource,locale,signal,savedSummaryFetch,()=>`blob:verified-${counter++}`,()=>{});
  // Cross-check the sealed inventory against the complete original match, not the truncated live view.
  const complete=linesAt(track.durationMs),markers=at(track.durationMs).markers;
  for(const {cue} of prepared.clips)expect(complete.find(l=>l.source.id===cue.eventId&&l.atMs===cue.atMs&&l.kind===cue.kind&&l.text===cue.text)).toBeDefined();
  for(const clip of prepared.presentationClips??[]){const marker=markers.find(m=>m.phase===clip.phase)!;expect([clip.cue.atMs,clip.cue.kind,clip.cue.text]).toEqual([marker.line.atMs,marker.line.kind,marker.line.text]);}
  return{prepared,track,adapter,linesAt,cast:resolved.cast,analysis:prepareRecordedAnalysis({track,events:adapter.resolveFrame(track.durationMs).events,passes:recorded?.events??[]}),periods:descriptor.periods};
}

export const savedSummaryManifest=()=>JSON.parse(readFileSync('../.local/speech-tp301/preview-manifest.json','utf8'));
export const savedSummaryReadText=(path:string)=>readFileSync(path,'utf8');
export async function savedSummaryFetch(url:string){
  if(url===savedSummarySource.manifestUrl)return new Response(readFileSync('../.local/speech-tp301/preview-manifest.json','utf8'));
  if(!/^\/speech-summary-preview\/(parent|recovery)\/[^/]+\.mp3$/.test(url))throw new Error(`Unexpected offline fetch: ${url}`);
  return new Response(readFileSync('../.local/'+(url.includes('/parent/')?'speech-tp296-run/':'speech-tp299-run/')+url.split('/').at(-1)),{headers:{'Content-Type':'audio/mpeg'}});
}
