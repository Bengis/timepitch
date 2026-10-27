import {makeSpeechCue,speechPreset,type DrySpeechCue} from './azure-cues';
import {sha256Hex} from '../adapters/recorded-bytes';
import type {NarrationLine} from './narration';
import type {PreparedReplayAudio,ReplayAudioSource} from './ReplayAudio';
import sealedCanary from './fixtures/saved-canary.json';

type Asset={file:string;sha256:string;durationMs:number;mime:string;sampleRate:number;channels:number;bitRate:number};
const canonical=(x:unknown)=>JSON.stringify(x,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const allowed=new Set(['/speech-preview/02-en-excited.mp3','/speech-preview/04-es-prosody.mp3']);
const fail=(message:string):never=>{throw new Error(message);};

/** Saved real canary MP3s only. Separate from the WAV test envelope; never calls a synthesis service. */
export async function loadSavedSpeechAudio(config:ReplayAudioSource,locale:'en'|'es',signal:AbortSignal,
  fetcher:(url:string,init?:RequestInit)=>Promise<Response>=(url,init)=>fetch(url,init),createUrl:(b:Blob)=>string=b=>URL.createObjectURL(b),revoke:(url:string)=>void=url=>URL.revokeObjectURL(url)):Promise<PreparedReplayAudio>{
  if(config.manifestUrl!=='/speech-preview/manifest.json')fail('Invalid saved Speech manifest URL');
  signal.throwIfAborted();const response=await fetcher(config.manifestUrl,{signal,credentials:'omit',cache:'no-store'});
  if(!response.ok)fail('Saved Speech unavailable');const text=await response.text();signal.throwIfAborted();
  if(new TextEncoder().encode(text).length>1000000)fail('Saved Speech manifest too large');
  const manifest=JSON.parse(text) as {version:string;kind:string;source:unknown;items:{cue:DrySpeechCue;asset:Asset}[]};
  if(manifest.version!=='saved-speech-preview-1'||manifest.kind!=='azure-canary'||canonical(manifest.source)!==canonical(config.expectedSource)||!Array.isArray(manifest.items)||manifest.items.length>2)fail('Saved Speech identity mismatch');
  const ids=new Set<string>();
  for(const {cue,asset} of manifest.items){
    if(!cue||ids.has(cue.id)||!asset)fail('Invalid saved Speech item');ids.add(cue.id);
    // This preview has exactly two receipt-bound originals. A self-consistent new cue
    // must never relabel their bytes as a new narrator, fact, window or treatment.
    const original=sealedCanary.items.find(item=>item.asset.file===asset.file);
    if(!original||canonical(manifest.source)!==canonical(sealedCanary.source)||canonical({cue,asset})!==canonical(original))fail('Saved canary binding mismatch');
    const preset=speechPreset(cue.binding.preset.id),suffix=`:${preset.id}`;
    if(!cue.id.endsWith(suffix))fail('Saved Speech preset mismatch');
    const expected=await makeSpeechCue({id:cue.id.slice(0,-suffix.length),source:{id:cue.eventId},kind:cue.kind,text:cue.text,atMs:cue.atMs} as NarrationLine,config.expectedSource,preset,cue.binding.window);
    if(canonical(expected)!==canonical(cue))fail('Saved Speech cue binding mismatch');
    if(!allowed.has(asset.file)||asset.mime!=='audio/mpeg'||asset.sampleRate!==24000||asset.channels!==1||asset.bitRate!==48000||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isFinite(asset.durationMs)||asset.durationMs<=0)fail('Invalid saved MP3 asset');
  }
  const urls:string[]=[],clips:PreparedReplayAudio['clips'][number][]=[],omitted:string[]=[];
  const release=()=>{urls.forEach(url=>revoke(url));urls.length=0;};
  try{
    for(const {cue,asset} of manifest.items.filter(i=>i.cue.locale===locale)){
      const r=await fetcher(asset.file,{signal,credentials:'omit',cache:'no-store'});if(!r.ok||r.headers.get('Content-Type')?.split(';')[0]!=='audio/mpeg')fail('Saved MP3 unavailable');
      const bytes=new Uint8Array(await r.arrayBuffer());signal.throwIfAborted();
      if(bytes.length<64||bytes.length>2000000||await sha256Hex(bytes)!==asset.sha256)fail('Saved MP3 hash mismatch');
      signal.throwIfAborted();
      if(asset.durationMs>cue.maxDurationMs){omitted.push('too_long');continue;}
      const url=createUrl(new Blob([bytes],{type:'audio/mpeg'}));urls.push(url);clips.push({cue,url,durationMs:asset.durationMs});
    }
    return{clips,omitted,release,timing:'native-deadline'};
  }catch(error){release();throw error;}
}
