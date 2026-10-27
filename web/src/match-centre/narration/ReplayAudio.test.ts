import {expect,it,vi} from 'vitest';
import {ReplayAudio,loadTestReplayAudio,type ReplayAudioFrame} from './ReplayAudio';
import {makeSpeechCue,speechPreset,type SpeechIdentity} from './azure-cues';
import {sha256Hex} from '../adapters/recorded-bytes';
import type {NarrationLine} from './narration';

const source:SpeechIdentity={replayId:'saved',engine:'grf',engineVersion:'g1',calibration:'cal1',datasetVersion:'d1',seed:43,homeKey:'home',awayKey:'away',traceHash:'a'.repeat(64),recordingSha256:'b'.repeat(64),eventsSha256:null,narratorVersion:'narration-tp278-1',namesVersion:'n1',namesMode:'fictional'};
const line=(atMs=1000,text='A shoots.'):NarrationLine=>({id:`shot:${atMs}`,source:{id:`event:${atMs}`,elapsedMs:atMs},atMs,text,kind:'shot',side:'home',actorId:'a'} as NarrationLine);
const frame:ReplayAudioFrame={cursorMs:0,active:true,enabled:true,speed:1,seek:0,cut:0,volume:.5};
it('crosses a verified saved cue even when interpolated playback has not published its event yet',async()=>{
  const p=await player(),cue=await makeSpeechCue(line(1390),source,speechPreset('en-neutral'),{fromMs:0,toMs:8000});
  const a={...audio(),readyState:4},events:unknown[]=[];
  const prepared={...p.prepared,timing:'native-deadline' as const,schedule:'verified-cues' as const,clips:[{cue,url:'blob:verified',durationMs:350}]};
  const controller=new ReplayAudio(a,prepared,e=>events.push(e),()=>0);
  controller.update({...frame,cursorMs:1301},[]);
  controller.update({...frame,cursorMs:1389},[]);expect(a.play).not.toHaveBeenCalled();
  controller.update({...frame,cursorMs:1391},[]);await Promise.resolve();
  expect(a.play).toHaveBeenCalledOnce();
  expect(events).toContainEqual(expect.objectContaining({kind:'started',atMs:1390,startLagMs:1}));
  controller.update({...frame,cursorMs:1401},[line(1390)]);
  expect(a.play).toHaveBeenCalledOnce();controller.dispose();
});
it('does not catch up a verified cue crossed too late and records the omission',async()=>{
  const p=await player(),a={...audio(),readyState:4},events:unknown[]=[];
  const c=new ReplayAudio(a,{...p.prepared,timing:'native-deadline',schedule:'verified-cues'},e=>events.push(e),()=>0);
  c.update({...frame,cursorMs:900},[]);c.update({...frame,cursorMs:1300},[]);
  expect(a.play).not.toHaveBeenCalled();
  expect(events).toContainEqual(expect.objectContaining({kind:'skip',reason:'too_late',atMs:1000,cueId:p.cue.id}));
  c.update({...frame,cursorMs:1301},[line()]);expect(a.play).not.toHaveBeenCalled();c.dispose();
});
it('retains pause, seek, cut, speed, disable and hidden cancellation for the verified schedule',async()=>{
  for(const cause of ['pause','seek','cut','speed','disable','hidden']){
    const p=await player(),a={...audio(),readyState:4};
    const c=new ReplayAudio(a,{...p.prepared,timing:'native-deadline',schedule:'verified-cues'},()=>{},()=>0);
    c.update({...frame,cursorMs:900},[]);c.update({...frame,cursorMs:1001},[]);await Promise.resolve();expect(a.play).toHaveBeenCalledOnce();
    if(cause==='hidden')c.suspend();else c.update({...frame,cursorMs:1050,...(cause==='pause'?{active:false}:cause==='seek'?{seek:1}:cause==='cut'?{cut:1}:cause==='speed'?{speed:5}:{enabled:false})},[]);
    expect(a.pause).toHaveBeenCalledOnce();c.update({...frame,cursorMs:1100},[]);expect(a.play).toHaveBeenCalledOnce();c.dispose();
  }
});
it('keeps the 46ms native startup deadline with verified cue scheduling and no live lines',async()=>{
  const p=await player(),cue=await makeSpeechCue({...line(409500),kind:'goal'},source,speechPreset('en-goal'),{fromMs:395500,toMs:417500});
  const prepared={...p.prepared,timing:'native-deadline' as const,schedule:'verified-cues' as const,clips:[{cue,url:'blob:goal',durationMs:7704}]};
  let now=0,resolve=()=>{};const a={...audio(),duration:7.704,readyState:4,play:vi.fn(()=>new Promise<void>(r=>{resolve=r;}))},events:unknown[]=[];
  const c=new ReplayAudio(a,prepared,e=>events.push(e),()=>now);
  c.update({...frame,cursorMs:409400},[]);c.update({...frame,cursorMs:409500},[]);now=47;resolve();await Promise.resolve();
  expect(a.pause).toHaveBeenCalledOnce();expect(events).toContainEqual(expect.objectContaining({kind:'skip',reason:'native_start_deadline'}));c.dispose();
});
it('uses one audio element for held presentation markers and resumes only after native end',async()=>{
  const p=await player(),cue=await makeSpeechCue({...line(4000,'Half-time.'),kind:'mark'},source,speechPreset('en-neutral'),{fromMs:4000,toMs:19000});
  const a={...audio(),duration:2,readyState:4},events:unknown[]=[];
  const controller=new ReplayAudio(a,{...p.prepared,presentationClips:[{cue,url:'blob:half',durationMs:2000,phase:'halftime' as const}]},e=>events.push(e),()=>0);
  controller.update({...frame,cursorMs:4000,active:false},[]);
  const result=controller.playPresentation('halftime');await Promise.resolve();
  expect(a.play).toHaveBeenCalledOnce();expect(a.src).toBe('blob:half');
  controller.update({...frame,cursorMs:4000,active:false,volume:0},[]);expect(a.pause).not.toHaveBeenCalled();expect(a.volume).toBe(0);
  a.currentTime=2;a.ended=true;controller.ended();expect(await result).toBe('ended');
  expect(events).toContainEqual(expect.objectContaining({reason:'presentation_complete',audioEnded:true}));controller.dispose();
});
it('reports a presentation rejected before its anchor instead of silently losing it',async()=>{
  const p=await player(),cue=await makeSpeechCue({...line(4000,'Half-time.'),kind:'mark'},source,speechPreset('en-neutral'),{fromMs:4000,toMs:19000});
  const a={...audio(),duration:2,readyState:4},events:unknown[]=[];
  const c=new ReplayAudio(a,{...p.prepared,presentationClips:[{cue,url:'blob:half',durationMs:2000,phase:'halftime'}]},e=>events.push(e),()=>0);
  c.update({...frame,cursorMs:3999,active:false},[]);expect(await c.playPresentation('halftime')).toBe('skipped');
  expect(events).toContainEqual(expect.objectContaining({kind:'skip',reason:'presentation_before_anchor',atMs:4000,cueId:cue.id}));
  expect(a.play).not.toHaveBeenCalled();c.dispose();
});
it('cancels presentation on seek, disabled voice, hidden tab and native-start failure without catch-up',async()=>{
  for(const cause of ['seek','disable','hidden','late']){
    const p=await player(),cue=await makeSpeechCue({...line(0,'Kick-off.'),kind:'mark'},source,speechPreset('en-neutral'),{fromMs:0,toMs:15000});
    let now=0,resolve=()=>{};const a={...audio(),duration:2,readyState:4,play:vi.fn(()=>new Promise<void>(r=>{resolve=r;}))};
    const controller=new ReplayAudio(a,{...p.prepared,presentationClips:[{cue,url:'blob:opening',durationMs:2000,phase:'opening' as const}]},()=>{},()=>now);
    controller.update({...frame,active:false},[]);const result=controller.playPresentation('opening');
    if(cause==='hidden')controller.suspend();else if(cause==='late'){now=251;resolve();await Promise.resolve();}
    else controller.update({...frame,active:false,...(cause==='seek'?{seek:1}:{enabled:false})},[]);
    expect(await result).toBe(cause==='late'?'failed':'cancelled');expect(a.pause).toHaveBeenCalledOnce();controller.dispose();
  }
});
function wav(ms=350){
  const bytes=new Uint8Array(44+24*ms*2),v=new DataView(bytes.buffer),text=(at:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,bytes.length-44,true);return bytes;
}
async function fixture(){
  const cue=await makeSpeechCue(line(),source,speechPreset('en-neutral'),{fromMs:0,toMs:8000}),bytes=wav();
  const manifest={version:'replay-audio-test-1',kind:'test-tones',source,items:[{cue,asset:{file:'/speech-test/normal.wav',sha256:await sha256Hex(bytes),durationMs:350,mime:'audio/wav'}}]};
  const fetcher=vi.fn(async(url:string)=>url.endsWith('.json')?new Response(JSON.stringify(manifest)):new Response(bytes));
  const revoke=vi.fn(),url=vi.fn(()=> 'blob:test');
  const config={manifestUrl:'/speech-test/fictional.json',expectedSource:source};
  const load=()=>loadTestReplayAudio(config,'en',new AbortController().signal,fetcher,url,revoke);
  return{cue,manifest,bytes,fetcher,revoke,url,config,load};
}
function audio(){return{src:'',currentTime:0,duration:.35,ended:false,volume:1,play:vi.fn(async()=>{}),pause:vi.fn(),load:vi.fn()};}
async function player(){const f=await fixture(),prepared=await f.load(),a=audio(),events:unknown[]=[];return{...f,prepared,a,events,player:new ReplayAudio(a,prepared,e=>events.push(e))};}

it('validates manifest identity and bytes before creating a playable object URL',async()=>{
  const f=await fixture(),prepared=await f.load();expect(prepared.clips).toHaveLength(1);expect(f.fetcher).toHaveBeenCalledTimes(2);
  prepared.release();expect(f.revoke).toHaveBeenCalledWith('blob:test');
  f.manifest.source={...source,seed:44};await expect(f.load()).rejects.toThrow(/identity/i);expect(f.fetcher).toHaveBeenCalledTimes(3);
});

it('preserves native preload at zero instead of seeking again and missing the 46ms goal deadline',async()=>{
  const p=await player(),goal={...line(409500),kind:'goal' as const};
  const cue=await makeSpeechCue(goal,source,speechPreset('en-goal'),{fromMs:395500,toMs:417500});
  let now=0,position=0,ready=4,readyAtPlay=0;
  const a={...audio(),duration:7.704,get currentTime(){return position;},set currentTime(value:number){position=value;ready=1;},get readyState(){return ready;},
    play:vi.fn(async()=>{readyAtPlay=ready;if(ready<3)now+=47;})};
  const events:unknown[]=[],c=new ReplayAudio(a,{...p.prepared,timing:'native-deadline',schedule:'verified-cues',clips:[{cue,url:'blob:goal',durationMs:7704}]},e=>events.push(e),()=>now);
  c.update({...frame,cursorMs:409400},[]);c.update({...frame,cursorMs:409500},[]);await Promise.resolve();
  expect(readyAtPlay).toBe(4);
  expect(events).toContainEqual(expect.objectContaining({kind:'started',cueId:cue.id,deadlineMs:46}));
  expect(events).not.toContainEqual(expect.objectContaining({kind:'skip'}));c.dispose();
});
it('still rewinds a nonzero native asset before starting its verified cue',async()=>{
  const p=await player(),a={...audio(),currentTime:.2,readyState:4},seen:number[]=[];
  a.play=vi.fn(async()=>{seen.push(a.currentTime);});
  const c=new ReplayAudio(a,{...p.prepared,timing:'native-deadline',schedule:'verified-cues'},()=>{},()=>0);
  c.update({...frame,cursorMs:900},[]);c.update({...frame,cursorMs:1000},[]);await Promise.resolve();
  expect(seen).toEqual([0]);c.dispose();
});
it('preloads a verified MP3 and admits Guy only within its measured 46ms start deadline',async()=>{
  const p=await player(),cue=await makeSpeechCue({...line(409500),kind:'goal'},source,speechPreset('en-goal'),{fromMs:395500,toMs:417500});
  const prepared={...p.prepared,timing:'native-deadline' as const,clips:[{...p.prepared.clips[0],cue,durationMs:7704}]};
  let now=0;const a={...audio(),duration:7.704,readyState:4};const controller=new ReplayAudio(a,prepared,()=>{},()=>now);
  const goal={...line(409500),kind:'goal' as const};controller.update({...frame,cursorMs:409400},[]);
  expect(a.load).toHaveBeenCalled();controller.update({...frame,cursorMs:409500},[goal]);expect(a.play).toHaveBeenCalledOnce();
  now=10;await Promise.resolve();expect(a.pause).not.toHaveBeenCalled();
  controller.dispose();
});
it('keeps the due clip preloaded when a frame crosses its timestamp and another clip follows',async()=>{
  const p=await player(),goal={...line(409500),kind:'goal' as const};
  const cue=await makeSpeechCue(goal,source,speechPreset('en-goal'),{fromMs:395500,toMs:417500});
  const next=await makeSpeechCue(line(698390),source,speechPreset('en-neutral'),{fromMs:688390,toMs:710190});
  const a={...audio(),duration:7.704,readyState:4},events:unknown[]=[];
  const prepared={...p.prepared,timing:'native-deadline' as const,clips:[{cue,url:'blob:due',durationMs:7704},{cue:next,url:'blob:next',durationMs:3200}]};
  const controller=new ReplayAudio(a,prepared,e=>events.push(e),()=>0);
  controller.update({...frame,cursorMs:409400},[]);expect(a.src).toBe('blob:due');
  controller.update({...frame,cursorMs:409516},[goal]);await Promise.resolve();
  expect(a.src).toBe('blob:due');expect(a.play).toHaveBeenCalledOnce();
  expect(events).not.toContainEqual(expect.objectContaining({reason:'not_preloaded'}));controller.dispose();
});
it('cancels a native MP3 start after its deadline even with no new replay frame',async()=>{
  const p=await player(),cue=await makeSpeechCue({...line(409500),kind:'goal'},source,speechPreset('en-goal'),{fromMs:395500,toMs:417500});
  const prepared={...p.prepared,timing:'native-deadline' as const,clips:[{...p.prepared.clips[0],cue,durationMs:7704}]};
  let now=0,resolve=()=>{};const a={...audio(),duration:7.704,readyState:4,play:vi.fn(()=>new Promise<void>(r=>{resolve=r;}))};
  const controller=new ReplayAudio(a,prepared,()=>{},()=>now),goal={...line(409500),kind:'goal' as const};
  controller.update({...frame,cursorMs:409400},[]);controller.update({...frame,cursorMs:409500},[goal]);now=47;resolve();await Promise.resolve();
  expect(a.pause).toHaveBeenCalledOnce();controller.dispose();
});
it('rejects modified cue binding/text, external assets and corrupted audio without synthesis',async()=>{
  for(const mutate of [(f:Awaited<ReturnType<typeof fixture>>)=>{f.manifest.items[0].cue.text='Future invented goal';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.manifest.items[0].asset.file='https://other/audio.wav';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.bytes[50]=1;}]){
    const f=await fixture();mutate(f);await expect(f.load()).rejects.toThrow();expect(f.url).not.toHaveBeenCalled();
  }
});
it('omits an audio that does not fit instead of changing replay timing',async()=>{
  const f=await fixture();const cue=await makeSpeechCue(line(),source,speechPreset('en-neutral'),{fromMs:0,toMs:1500});f.manifest.items[0].cue=cue;
  const result=await f.load();expect(result.clips).toHaveLength(0);expect(result.omitted).toContain('too_long');result.release();
});
it('never announces on enabling or before the event, and skips a text not backed by the current narration',async()=>{
  const p=await player();p.player.update(frame,[]);p.player.update({...frame,cursorMs:999},[line()]);expect(p.a.play).not.toHaveBeenCalled();
  p.player.update({...frame,cursorMs:1000},[line(1000,'Different fact')]);expect(p.a.play).not.toHaveBeenCalled();
  p.player.update({...frame,cursorMs:0,seek:1},[]);p.player.update({...frame,cursorMs:1000,seek:1},[line()]);expect(p.a.play).toHaveBeenCalledOnce();
});
it('cancels on pause, seek, montage cut and non-natural speed without catch-up',async()=>{
  for(const change of [{active:false},{seek:1},{cut:1},{speed:5},{enabled:false}]){
    const p=await player();p.player.update(frame,[]);p.player.update({...frame,cursorMs:1000},[line()]);expect(p.a.play).toHaveBeenCalledOnce();
    p.player.update({...frame,cursorMs:1050,...change},[line()]);expect(p.a.pause).toHaveBeenCalledOnce();
    p.player.update({...frame,cursorMs:1100},[line()]);expect(p.a.play).toHaveBeenCalledOnce();
  }
});
it('volume and ordinary renders retain the same audio, while disposal releases it',async()=>{
  const p=await player();p.player.update(frame,[]);p.player.update({...frame,cursorMs:1000},[line()]);
  p.player.update({...frame,cursorMs:1100,volume:0},[line()]);expect(p.a.volume).toBe(0);expect(p.a.pause).not.toHaveBeenCalled();expect(p.a.play).toHaveBeenCalledOnce();
  p.player.dispose();expect(p.a.pause).toHaveBeenCalledOnce();expect(p.revoke).toHaveBeenCalledOnce();
});
it('discards a suspended-tab gap and an unresolved play request that becomes late',async()=>{
  const p=await player();p.a.play.mockImplementation(()=>new Promise(()=>{}));p.player.update(frame,[]);p.player.update({...frame,cursorMs:1000},[line()]);
  p.player.update({...frame,cursorMs:1400},[line()]);expect(p.a.pause).toHaveBeenCalledOnce();
  p.player.update({...frame,cursorMs:5000},[line(5000)]);expect(p.a.play).toHaveBeenCalledOnce();
});
it('an aborted late load never creates an asset URL or starts audio',async()=>{
  const f=await fixture(),controller=new AbortController();const response=await f.fetcher('/speech-test/fictional.json');
  const delayed=vi.fn(async()=>{controller.abort();return response;});
  await expect(loadTestReplayAudio(f.config,'en',controller.signal,delayed,f.url,f.revoke)).rejects.toThrow();expect(f.url).not.toHaveBeenCalled();
});

it('omits a near-end cue when native startup delay would leave too little time for the whole tone',async()=>{
  const p=await player(),cue=await makeSpeechCue(line(),source,speechPreset('en-neutral'),{fromMs:0,toMs:2000});
  const prepared={...p.prepared,clips:[{...p.prepared.clips[0],cue,durationMs:650}]};p.a.duration=.65;
  let finish!:()=>void;p.a.play.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  const events:{kind:string;reason:string}[]=[],controller=new ReplayAudio(p.a,prepared,e=>events.push(e));
  controller.update(frame,[]);controller.update({...frame,cursorMs:1050},[line()]);controller.update({...frame,cursorMs:1221},[line()]);
  finish?.();await Promise.resolve();expect(events).toContainEqual(expect.objectContaining({kind:'skip',reason:'too_late'}));
  expect(p.a.play.mock.calls.length===0||p.a.pause.mock.calls.length>0).toBe(true);
});

it('rejects a native decoder duration mismatch on delayed start',async()=>{
  const p=await player();let finish!:()=>void;p.a.play.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  p.player.update(frame,[]);p.player.update({...frame,cursorMs:1000},[line()]);p.a.duration=9;finish();await Promise.resolve();
  expect(p.events).toContainEqual(expect.objectContaining({kind:'error',reason:'duration_mismatch'}));
});
it('a native play promise resolved after cancellation cannot restart or mark a new clip',async()=>{
  const p=await player();let finish!:()=>void;p.a.play.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  p.player.update(frame,[]);p.player.update({...frame,cursorMs:1000},[line()]);p.player.update({...frame,cursorMs:1100,active:false},[line()]);
  const before=JSON.stringify(p.events);finish();await Promise.resolve();expect(JSON.stringify(p.events)).toBe(before);expect(p.a.play).toHaveBeenCalledOnce();expect(p.a.pause).toHaveBeenCalledOnce();
});
it('suspends immediately with a pending play promise and never catches up on return',async()=>{
  const p=await player();let finish!:()=>void;p.a.play.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  p.player.update(frame,[]);p.player.update({...frame,cursorMs:1000},[line()]);
  p.player.suspend();expect(p.a.pause).toHaveBeenCalledOnce();const before=JSON.stringify(p.events);
  finish();await Promise.resolve();expect(JSON.stringify(p.events)).toBe(before);
  p.player.update({...frame,cursorMs:1100},[line()]);expect(p.a.play).toHaveBeenCalledOnce();p.player.dispose();
});
it('records native media progress before a boundary stop so completion is not inferred from reset audio',async()=>{
  const p=await player();const prepared={...p.prepared,timing:'native-deadline' as const,clips:p.prepared.clips.map(c=>({...c,cue:{...c.cue,playUntilMs:2000}}))};
  const a={...audio(),readyState:4},events:unknown[]=[];const c=new ReplayAudio(a,prepared,e=>events.push(e),()=>0);
  c.update(frame,[]);c.update({...frame,cursorMs:1000},[line()]);await Promise.resolve();a.currentTime=.35;a.ended=true;
  c.update({...frame,cursorMs:1800},[]);
  expect(events).toContainEqual(expect.objectContaining({kind:'stop',audioTimeMs:350,audioEnded:true}));c.dispose();
});
it('ignores a stale presentation play promise after cancellation and restarting the same marker',async()=>{
  const p=await player(),cue=await makeSpeechCue({...line(0,'Kick-off.'),kind:'mark'},source,speechPreset('en-neutral'),{fromMs:0,toMs:15000});
  const promises:{reject:(reason:Error)=>void;resolve:()=>void}[]=[];
  const a={...audio(),duration:2,readyState:4,play:vi.fn(()=>new Promise<void>((resolve,reject)=>promises.push({resolve,reject})))};
  const controller=new ReplayAudio(a,{...p.prepared,presentationClips:[{cue,url:'blob:opening',durationMs:2000,phase:'opening' as const}]},()=>{},()=>0);
  controller.update({...frame,active:false},[]);const first=controller.playPresentation('opening');controller.cancelPresentation();expect(await first).toBe('cancelled');
  const second=controller.playPresentation('opening');promises[0].reject(new Error('old play'));await Promise.resolve();
  promises[1].resolve();await Promise.resolve();a.currentTime=2;a.ended=true;controller.ended();expect(await second).toBe('ended');controller.dispose();
});
