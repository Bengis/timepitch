import {makeSpeechCue,speechPreset,type DrySpeechCue,type SpeechIdentity} from './azure-cues';
import {sha256Hex} from '../adapters/recorded-bytes';
import type {NarrationLine} from './narration';
import type {SpeechPhase} from './speech-summary';

export type ReplayAudioSource={manifestUrl:string;expectedSource:SpeechIdentity};
type Asset={file:string;sha256:string;durationMs:number;mime:string};
type Clip={cue:DrySpeechCue;url:string;durationMs:number};
export type PreparedReplayAudio={clips:readonly Clip[];presentationClips?:readonly (Clip&{phase:SpeechPhase})[];omitted:readonly string[];release:()=>void;timing?:'native-deadline';schedule?:'verified-cues'};
export type PresentationResult='ended'|'skipped'|'cancelled'|'failed';
export type ReplayAudioFrame={cursorMs:number;active:boolean;enabled:boolean;speed:number;seek:number;cut:number;volume:number};
export type ReplayAudioEvent={kind:'play'|'stop'|'skip'|'error'|'started';reason:string;atMs:number;startLagMs?:number;deadlineMs?:number;audioTimeMs?:number;audioEnded?:boolean;cueId?:string};
type AudioPort=Pick<HTMLAudioElement,'src'|'currentTime'|'duration'|'ended'|'volume'|'play'|'pause'|'load'>&Partial<Pick<HTMLAudioElement,'readyState'>>;
type FetchAudio=(url:string,init?:RequestInit)=>Promise<Response>;
const canonical=(x:unknown)=>JSON.stringify(x,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=(message:string):never=>{throw new Error(message);};
const audioFiles=new Set(['/speech-test/normal.wav','/speech-test/goal.wav']);

function waveDuration(bytes:Uint8Array<ArrayBuffer>){
  if(bytes.length<44||bytes.length>1000000)fail('Invalid test WAV');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(a:number,b:number)=>new TextDecoder().decode(bytes.subarray(a,b));
  if(text(0,4)!=='RIFF'||text(8,12)!=='WAVE'||text(12,16)!=='fmt '||text(36,40)!=='data'||v.getUint32(4,true)!==bytes.length-8||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint32(24,true)!==24000||v.getUint32(28,true)!==48000||v.getUint16(32,true)!==2||v.getUint16(34,true)!==16||v.getUint32(40,true)!==bytes.length-44)fail('Unsupported test WAV');
  return (bytes.length-44)/48000*1000;
}

/** Test envelopes never authorize synthesis. Validate every cue before loading only same-origin, fixed WAV files. */
export async function loadTestReplayAudio(config:ReplayAudioSource,locale:'en'|'es',signal:AbortSignal,
  fetcher:FetchAudio=(url,init)=>fetch(url,init),createUrl:(b:Blob)=>string=b=>URL.createObjectURL(b),revoke:(url:string)=>void=url=>URL.revokeObjectURL(url)):Promise<PreparedReplayAudio>{
  if(config.manifestUrl!==`/speech-test/${config.expectedSource.namesMode}.json`)fail('Invalid test manifest URL');
  signal.throwIfAborted();
  const response=await fetcher(config.manifestUrl,{signal,credentials:'omit',cache:'no-store'});
  if(!response.ok)fail('Test audio unavailable');
  const text=await response.text();signal.throwIfAborted();if(new TextEncoder().encode(text).length>1000000)fail('Test manifest too large');
  const manifest=JSON.parse(text) as {version:string;kind:string;source:SpeechIdentity;items:{cue:DrySpeechCue;asset:Asset}[]};
  if(manifest.version!=='replay-audio-test-1'||manifest.kind!=='test-tones'||canonical(manifest.source)!==canonical(config.expectedSource))fail('Test audio identity mismatch');
  if(!Array.isArray(manifest.items)||manifest.items.length>500)fail('Invalid test cues');
  const files=new Map<string,Asset>(),ids=new Set<string>();
  for(const {cue,asset} of manifest.items){
    if(!cue||typeof cue.id!=='string'||ids.has(cue.id)||typeof cue.text!=='string'||!['goal','own_goal','save','miss','shot','pass','carry','won','set_piece','offside','mark'].includes(cue.kind))fail('Invalid test cue');
    ids.add(cue.id);
    const preset=speechPreset(cue.binding.preset.id),suffix=`:${preset.id}`;
    if(!cue.id.endsWith(suffix))fail('Cue preset mismatch');
    const expected=await makeSpeechCue({id:cue.id.slice(0,-suffix.length),source:{id:cue.eventId},kind:cue.kind,text:cue.text,atMs:cue.atMs} as NarrationLine,config.expectedSource,preset,cue.binding.window);
    if(canonical(expected)!==canonical(cue))fail('Cue hash or binding mismatch');
    if(!asset||!audioFiles.has(asset.file)||asset.mime!=='audio/wav'||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isFinite(asset.durationMs)||asset.durationMs<=0)fail('Invalid test audio asset');
    const prior=files.get(asset.file);if(prior&&canonical(prior)!==canonical(asset))fail('Conflicting test asset');
    if(cue.locale===locale)files.set(asset.file,asset);
  }
  const verified=new Map<string,Uint8Array<ArrayBuffer>>();
  for(const asset of files.values()){
    const r=await fetcher(asset.file,{signal,credentials:'omit',cache:'no-store'});if(!r.ok)fail('Test audio unavailable');
    const bytes=new Uint8Array(await r.arrayBuffer());signal.throwIfAborted();
    if(await sha256Hex(bytes)!==asset.sha256||Math.abs(waveDuration(bytes)-asset.durationMs)>.5)fail('Test audio hash or duration mismatch');
    verified.set(asset.file,bytes);
  }
  signal.throwIfAborted();
  const urls=new Map<string,string>(),omitted:string[]=[];
  const release=()=>{for(const url of urls.values())revoke(url);urls.clear();};
  try{
    for(const [file,bytes] of verified)urls.set(file,createUrl(new Blob([bytes],{type:'audio/wav'})));
    const clips=manifest.items.filter(x=>x.cue.locale===locale).flatMap(({cue,asset})=>{
      if(asset.durationMs>cue.maxDurationMs){omitted.push('too_long');return [];}
      return [{cue,url:urls.get(asset.file)!,durationMs:asset.durationMs}];
    });
    return {clips,omitted,release};
  }catch(error){release();throw error;}
}

/** One audio element; all decisions follow the existing replay cursor. Never autonomous scheduling or catch-up. */
export class ReplayAudio {
  private previous:ReplayAudioFrame|null=null;
  private current:{clip:Clip;generation:number;started:boolean}|null=null;
  private generation=0;
  private disposed=false;
  private presentation:{clip:Clip;generation:number;started:boolean;resolve:(result:PresentationResult)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
  constructor(private audio:AudioPort,private prepared:PreparedReplayAudio,private notify:(event:ReplayAudioEvent)=>void=()=>{},private now:()=>number=()=>performance.now()){}
  private prime(cursor:number){
    if(this.prepared.timing!=='native-deadline'||this.current)return;
    const next=this.prepared.clips.find(c=>c.cue.atMs>=cursor);
    if(next&&this.audio.src!==next.url){this.audio.src=next.url;this.audio.load();}
  }
  private stop(reason:string){
    this.generation++;
    if(this.presentation){const p=this.presentation;this.presentation=null;clearTimeout(p.timer);this.audio.pause();this.audio.currentTime=0;p.resolve('cancelled');this.notify({kind:'stop',reason,atMs:p.clip.cue.atMs,cueId:p.clip.cue.id});}
    if(this.current){const cueId=this.current.clip.cue.id,progress=this.prepared.timing==='native-deadline'?{audioTimeMs:this.audio.currentTime*1000,audioEnded:this.audio.ended}:{};this.current=null;this.audio.pause();this.audio.currentTime=0;this.notify({kind:'stop',reason,atMs:this.previous?.cursorMs??0,cueId,...progress});}
  }
  update(frame:ReplayAudioFrame,lines:readonly NarrationLine[]){
    if(this.disposed)return;
    const before=this.previous;this.previous={...frame};this.audio.volume=Math.max(0,Math.min(1,frame.volume));
    if(this.presentation){
      if(!frame.enabled||frame.speed!==1||frame.active||before&&frame.seek!==before.seek||before&&frame.cut!==before.cut||before&&frame.cursorMs!==before.cursorMs)this.stop('presentation_cancelled');
      return;
    }
    if(!before||!frame.active||!frame.enabled||frame.speed!==1||!before.active||!before.enabled||before.speed!==1||frame.seek!==before.seek||frame.cut!==before.cut||frame.cursorMs<before.cursorMs||frame.cursorMs-before.cursorMs>2000){this.stop('discontinuity');if(frame.enabled)this.prime(frame.cursorMs);return;}
    // A frame may cross the due cue by a few milliseconds. Keep that asset until handled below.
    this.prime(before.cursorMs);
    if(this.current){
      if(frame.cursorMs>=this.current.clip.cue.playUntilMs-250||!this.current.started&&frame.cursorMs-this.current.clip.cue.atMs>250)this.stop('late_or_window_end');
      else if(this.audio.ended)this.ended();
    }
    // Only the sealed summary loader supplies this schedule, after verifying source and every MP3.
    // Interpolated motion may cross a fact before the live snapshot publishes it. Its verified cue
    // is already available, but can still play only on this cursor crossing, never in advance.
    const candidates=this.prepared.schedule==='verified-cues'?this.prepared.clips.map(({cue})=>({atMs:cue.atMs,kind:cue.kind,text:cue.text,source:{id:cue.eventId}})):lines;
    const crossed=candidates.filter(l=>l.atMs>before.cursorMs&&l.atMs<=frame.cursorMs);
    if(this.prepared.schedule==='verified-cues')for(const line of crossed.filter(l=>frame.cursorMs-l.atMs>250)){
      this.notify({kind:'skip',reason:'too_late',atMs:line.atMs,cueId:this.prepared.clips.find(c=>c.cue.eventId===line.source.id&&c.cue.atMs===line.atMs)?.cue.id});
    }
    const fresh=crossed.filter(l=>frame.cursorMs-l.atMs<=250);
    const goal=(l:{kind:NarrationLine['kind']})=>l.kind==='goal'||l.kind==='own_goal';
    const line=fresh.filter(goal).at(-1)??fresh.at(-1);if(!line)return;
    const clip=this.prepared.clips.find(c=>c.cue.eventId===line.source.id&&c.cue.atMs===line.atMs&&c.cue.text===line.text&&c.cue.kind===line.kind);
    if(!clip){this.notify({kind:'skip',reason:'no_matching_audio',atMs:line.atMs});return;}
    // Reserve the permitted startup lag as well as the complete tone before asking native media to play.
    const native=this.prepared.timing==='native-deadline',latestStart=Math.min(clip.cue.atMs+250,clip.cue.playUntilMs-250-clip.durationMs);
    if(native&&(this.audio.src!==clip.url||(this.audio.readyState??0)<3)){this.notify({kind:'skip',reason:'not_preloaded',atMs:line.atMs,cueId:clip?.cue.id});return;}
    if(native?frame.cursorMs>latestStart:Math.max(frame.cursorMs,clip.cue.atMs+250)+clip.durationMs>clip.cue.playUntilMs-250){this.notify({kind:'skip',reason:'too_late',atMs:line.atMs,cueId:clip?.cue.id});return;}
    if(this.current&&!goal(line))return;
    this.stop('next_goal');const generation=++this.generation;this.current={clip,generation,started:false};
    if(this.audio.src!==clip.url)this.audio.src=clip.url;
    // Seeking even to the existing zero discards native readiness. Preserve a primed clip.
    if(this.audio.currentTime!==0)this.audio.currentTime=0;
    const issuedAt=this.now(),issuedCursor=frame.cursorMs;
    try{
      const promise=this.audio.play();this.notify({kind:'play',reason:native?'saved_azure_clip':'test_tone',atMs:line.atMs,cueId:clip?.cue.id});
      void promise.then(()=>{
        if(this.current?.generation!==generation)return;
        if(!Number.isFinite(this.audio.duration)||Math.abs(this.audio.duration*1000-clip.durationMs)>5){this.stop('duration_mismatch');this.notify({kind:'error',reason:'duration_mismatch',atMs:line.atMs,cueId:clip?.cue.id});return;}
        const cursor=native?Math.max(this.previous!.cursorMs,issuedCursor+this.now()-issuedAt):this.previous!.cursorMs,remaining=Math.max(0,clip.durationMs-this.audio.currentTime*1000);
        const start=Math.max(issuedCursor,cursor-this.audio.currentTime*1000);
        if(native&&start>latestStart){this.stop('too_late');this.notify({kind:'skip',reason:'native_start_deadline',atMs:line.atMs,cueId:clip?.cue.id});return;}
        if(cursor-clip.cue.atMs>250||cursor+remaining>clip.cue.playUntilMs-250){this.stop('too_late');this.notify({kind:'skip',reason:'too_late',atMs:line.atMs,cueId:clip?.cue.id});return;}
        this.current.started=true;
        if(native)this.notify({kind:'started',reason:'saved_azure_clip',atMs:line.atMs,cueId:clip?.cue.id,startLagMs:start-clip.cue.atMs,deadlineMs:latestStart-clip.cue.atMs});
      },()=>{
        if(this.current?.generation!==generation)return;this.stop('play_failed');this.notify({kind:'error',reason:'play_failed',atMs:line.atMs,cueId:clip?.cue.id});
      });
    }catch{this.stop('play_failed');this.notify({kind:'error',reason:'play_failed',atMs:line.atMs,cueId:clip?.cue.id});}
  }
  /** Uses the same native port while the owner holds the match clock on a verified phase card. */
  playPresentation(phase:SpeechPhase,blockedReason?:'presentation_hidden'|'presentation_unavailable'):Promise<PresentationResult>{
    const clip=this.prepared.presentationClips?.find(c=>c.phase===phase),frame=this.previous;
    if(this.disposed)return Promise.resolve('skipped');
    const reason=blockedReason??(!clip?'presentation_missing_clip':!frame?'presentation_no_clock':!frame.enabled?'presentation_disabled':frame.speed!==1?'presentation_speed':frame.cursorMs<clip.cue.atMs?'presentation_before_anchor':null);
    if(reason||!clip||!frame){this.notify({kind:'skip',reason:reason!,atMs:clip?.cue.atMs??frame?.cursorMs??0,cueId:clip?.cue.id});return Promise.resolve('skipped');}
    this.stop('presentation');this.previous={...frame,active:false};const generation=++this.generation;
    return new Promise(resolve=>{
      const timeout=()=>this.failPresentation('presentation_window_end');
      this.presentation={clip,generation,started:false,resolve,timer:setTimeout(timeout,clip.cue.playUntilMs-clip.cue.atMs-250)};
      this.audio.src=clip.url;this.audio.currentTime=0;this.audio.load();const issued=this.now();
      const deadline=Math.min(250,clip.cue.playUntilMs-clip.cue.atMs-250-clip.durationMs);
      try{void this.audio.play().then(()=>{
        if(this.presentation?.generation!==generation)return;
        const lag=Math.max(0,this.now()-issued-this.audio.currentTime*1000);
        if(!Number.isFinite(this.audio.duration)||Math.abs(this.audio.duration*1000-clip.durationMs)>5){this.failPresentation('duration_mismatch');return;}
        if(lag>deadline){this.failPresentation('native_start_deadline');return;}
        this.presentation.started=true;
        this.notify({kind:'started',reason:`presentation_${phase}`,atMs:clip.cue.atMs,cueId:clip.cue.id,startLagMs:lag,deadlineMs:deadline});
      },()=>{if(this.presentation?.generation===generation)this.failPresentation('play_failed');});
      this.notify({kind:'play',reason:`presentation_${phase}`,atMs:clip.cue.atMs,cueId:clip.cue.id});
      }catch{this.failPresentation('play_failed');}
    });
  }
  private failPresentation(reason:string){
    const p=this.presentation;if(!p)return;this.presentation=null;clearTimeout(p.timer);this.audio.pause();this.audio.currentTime=0;
    this.notify({kind:'error',reason,atMs:p.clip.cue.atMs,cueId:p.clip.cue.id});p.resolve('failed');
  }
  ended(){
    const p=this.presentation;
    if(!p){
      const c=this.current;if(!c?.started||!this.audio.ended)return false;
      this.current=null;this.notify({kind:'stop',reason:'audio_ended',atMs:c.clip.cue.atMs,cueId:c.clip.cue.id,audioTimeMs:this.audio.currentTime*1000,audioEnded:true});return true;
    }
    if(!p.started||!this.audio.ended)return false;
    if(Math.abs(this.audio.currentTime*1000-p.clip.durationMs)>50){this.failPresentation('presentation_incomplete');return true;}
    this.presentation=null;clearTimeout(p.timer);
    this.notify({kind:'stop',reason:'presentation_complete',atMs:p.clip.cue.atMs,cueId:p.clip.cue.id,audioTimeMs:this.audio.currentTime*1000,audioEnded:true});p.resolve('ended');return true;
  }
  cancelPresentation(){if(this.presentation)this.stop('presentation_cancelled');}
  suspend(){if(this.disposed)return;this.stop('hidden');if(this.previous)this.previous={...this.previous,active:false};}
  dispose(){if(this.disposed)return;this.disposed=true;this.stop('dispose');this.audio.src='';this.audio.load();this.prepared.release();}
}
