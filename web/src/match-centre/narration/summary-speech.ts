import sealed from './fixtures/summary-cache.json';
import {makeSpeechCue,speechPreset,type DrySpeechCue} from './azure-cues';
import type {NarrationLine} from './narration';
import type {SpeechPhase} from './speech-summary';
import type {PreparedReplayAudio,ReplayAudioSource} from './ReplayAudio';
import {sha256Hex} from '../adapters/recorded-bytes';
const canonical=(x:unknown):string=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=():never=>{throw new Error('Saved summary audio identity or content mismatch');};
type Item={cue:DrySpeechCue;asset:{file:string;sha256:string;durationMs:number;receiptSha256:string;mime:string;sampleRate:number;channels:number;bitRate:number};slot:{clock:'replay'|'presentation';phase:'replay'|SpeechPhase;fromMs:number;toMs:number};origin:{artifactSha256:string;originalIndex:number;receiptFile:string;receiptSha256:string}};
export async function loadSummarySpeechAudio(config:ReplayAudioSource,locale:'en'|'es',signal:AbortSignal,
  fetcher:(url:string,init?:RequestInit)=>Promise<Response>=(url,init)=>fetch(url,init),createUrl:(b:Blob)=>string=b=>URL.createObjectURL(b),revoke:(url:string)=>void=url=>URL.revokeObjectURL(url)):Promise<PreparedReplayAudio>{
  if(config.manifestUrl!=='/speech-summary-preview/manifest.json'||canonical(config.expectedSource)!==canonical(sealed.source))fail();
  signal.throwIfAborted();const r=await fetcher(config.manifestUrl,{signal,credentials:'omit',cache:'no-store'});if(!r.ok)fail();
  const text=await r.text();if(new TextEncoder().encode(text).length>1000000)fail();
  const m=JSON.parse(text) as {version:string;kind:string;source:unknown;parentArtifactSha256:string;recoveryArtifactSha256:string;items:Item[]};
  if(m.version!=='saved-summary-preview-2'||m.kind!=='azure-summary-complete'||canonical(m.source)!==canonical(config.expectedSource)||m.parentArtifactSha256!==sealed.parentArtifactSha256||m.recoveryArtifactSha256!==sealed.recoveryArtifactSha256||!Array.isArray(m.items)||m.items.length!==50)fail();
  const ids=new Set<string>();
  for(const item of m.items){
    const {cue,asset}=item,expected=(sealed.itemHashes as Record<string,string>)[cue?.id];
    if(!expected||ids.has(cue.id)||await sha256Hex(new TextEncoder().encode(canonical(item)))!==expected)fail();ids.add(cue.id);
    const preset=speechPreset(cue.binding.preset.id),suffix=':'+preset.id;
    const rebuilt=await makeSpeechCue({id:cue.id.slice(0,-suffix.length),source:{id:cue.eventId},kind:cue.kind,text:cue.text,atMs:cue.atMs} as NarrationLine,config.expectedSource,preset,cue.binding.window);
    if(canonical(rebuilt)!==canonical(cue)||!/^\/speech-summary-preview\/(parent|recovery)\/\d{3}-[\w-]+\.mp3$/.test(asset.file)||asset.mime!=='audio/mpeg'||asset.sampleRate!==24000||asset.channels!==1||asset.bitRate!==48000||!Number.isFinite(asset.durationMs)||asset.durationMs<=0||asset.durationMs>=cue.maxDurationMs)fail();
  }
  for(const lang of ['en','es']){const items=m.items.filter(x=>x.cue.locale===lang);if(items.length!==25||items.filter(x=>x.slot.clock==='replay').length!==21||['opening','halftime','second-half','fulltime'].some(p=>items.filter(x=>x.slot.clock==='presentation'&&x.slot.phase===p).length!==1))fail();}
  const clips:PreparedReplayAudio['clips'][number][]=[],presentationClips:(PreparedReplayAudio['clips'][number]&{phase:SpeechPhase})[]=[],urls:string[]=[];const release=()=>{urls.forEach(revoke);urls.length=0;};
  try{
    for(const {cue,asset,slot} of m.items.filter(x=>x.cue.locale===locale)){
      signal.throwIfAborted();const r=await fetcher(asset.file,{signal,credentials:'omit',cache:'no-store'});
      if(!r.ok||r.headers.get('Content-Type')?.split(';')[0]!=='audio/mpeg')fail();
      const bytes=new Uint8Array(await r.arrayBuffer());signal.throwIfAborted();
      if(bytes.length<64||bytes.length>2000000||await sha256Hex(bytes)!==asset.sha256)fail();
      const url=createUrl(new Blob([bytes],{type:'audio/mpeg'}));urls.push(url);const clip={cue,url,durationMs:asset.durationMs};if(slot.clock==='presentation')presentationClips.push({...clip,phase:slot.phase as SpeechPhase});else clips.push(clip);
    }
    return{clips,presentationClips,omitted:[],release,timing:'native-deadline',schedule:'verified-cues'};
  }catch(e){release();throw e;}
}
