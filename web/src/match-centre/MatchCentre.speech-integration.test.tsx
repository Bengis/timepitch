import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Profiler,StrictMode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MatchCentre} from './MatchCentre';
import {LanguageProvider,LanguageSelector} from '../i18n';
import {setNamesMode} from '../catalog/fictional';
import type {useMatchPlayback} from './useMatchPlayback';
import type {PlaybackState} from './playback';
import type {ReplayAudioEvent} from './narration/ReplayAudio';
import {savedSummaryAvailable,savedSummaryFixture,savedSummaryFetch,savedSummaryManifest,savedSummarySource} from './narration/summary-speech.test-support';

const control=vi.hoisted(()=>({current:null as ReturnType<typeof useMatchPlayback>|null,observed:null as ReturnType<typeof useMatchPlayback>|null,afterRead:null as (()=>void)|null}));
vi.mock('./useMatchPlayback',async importOriginal=>{
  const real=await importOriginal<typeof import('./useMatchPlayback')>();
  return{useMatchPlayback:(...args:Parameters<typeof useMatchPlayback>)=>{const playback=control.current??real.useMatchPlayback(...args);control.observed=playback;const afterRead=control.afterRead;control.afterRead=null;afterRead?.();return playback;}};
});
vi.mock('../match/Pitch',()=>({Pitch:({overlay}:{overlay?:React.ReactNode})=><div>{overlay}</div>}));

type Fixture=Awaited<ReturnType<typeof savedSummaryFixture>>;
type Asset={file:string;durationMs:number};
let now=0,nextRaf=0,urlSerial=0,pendingAsset:Asset|undefined,seekSerial=0;
let seekAck:{revision:number;targetMs:number;status:'pending'|'settled'|'cancelled'}|null=null;
let callbacks:Map<number,FrameRequestCallback>,durations:Map<string,number>;
const times=new WeakMap<HTMLMediaElement,{duration:number;time:number;ended:boolean;playing:boolean}>();
function mediaState(audio:HTMLMediaElement){let state=times.get(audio);if(!state){state={duration:0,time:0,ended:false,playing:false};times.set(audio,state);}return state;}
beforeEach(()=>{
  setNamesMode('fictional',false);control.current=null;control.observed=null;control.afterRead=null;seekSerial=0;seekAck=null;now=0;nextRaf=0;urlSerial=0;pendingAsset=undefined;callbacks=new Map();durations=new Map();
  vi.spyOn(performance,'now').mockImplementation(()=>now);
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{callbacks.set(++nextRaf,cb);return nextRaf;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id));
  const items=savedSummaryAvailable?savedSummaryManifest().items as {asset:Asset}[]:[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    pendingAsset=items.find(i=>i.asset.file===url)?.asset;
    return savedSummaryFetch(url);
  }));
  vi.stubGlobal('URL',class extends URL{
    static createObjectURL(){const url=`blob:tp304-${++urlSerial}`;expect(pendingAsset).toBeDefined();durations.set(url,pendingAsset!.durationMs);return url;}
    static revokeObjectURL(){}
  });
  vi.spyOn(HTMLMediaElement.prototype,'duration','get').mockImplementation(function(this:HTMLMediaElement){return mediaState(this).duration;});
  vi.spyOn(HTMLMediaElement.prototype,'currentTime','get').mockImplementation(function(this:HTMLMediaElement){return mediaState(this).time;});
  vi.spyOn(HTMLMediaElement.prototype,'currentTime','set').mockImplementation(function(this:HTMLMediaElement,value){mediaState(this).time=value;});
  vi.spyOn(HTMLMediaElement.prototype,'ended','get').mockImplementation(function(this:HTMLMediaElement){return mediaState(this).ended;});
  vi.spyOn(HTMLMediaElement.prototype,'readyState','get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(function(this:HTMLMediaElement){Object.assign(mediaState(this),{duration:(durations.get(this.src)??0)/1000,time:0,ended:false});});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(async function(this:HTMLMediaElement){mediaState(this).playing=true;});
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){mediaState(this).playing=false;});
});
afterEach(()=>{setNamesMode('real',false);vi.restoreAllMocks();vi.unstubAllGlobals();});

function at(f:Fixture,ms:number,patch:Partial<PlaybackState>={}){
  control.current={state:{elapsedMs:ms,pendingSeekMs:null,speed:1,wantsPlay:true,isPlaying:true,isMatchEnd:false,status:'playing',stop:null,...patch},
    snapshot:f.adapter.resolveFrame(ms),view:null,demand:{playback:'playing'},policyId:'match-highlights-1',
    seekState:seekAck,play:vi.fn(),pause:vi.fn(),seek:vi.fn((targetMs:number)=>{seekAck={revision:++seekSerial,targetMs,status:'pending'};return seekSerial;}),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn()};
}
function events(container:HTMLElement):ReplayAudioEvent[]{return JSON.parse(container.querySelector('[data-speech-events]')!.getAttribute('data-speech-events')!);}

it.skipIf(!savedSummaryAvailable)('starts the saved 7704ms English goal inside 46ms with 60Hz frames and 20ms native startup',async()=>{
  const f=await savedSummaryFixture('en');
  const goal=f.prepared.clips.find(c=>c.cue.id==='goal:grf:goal:0:en-goal')!;
  expect(goal.durationMs).toBe(7704);
  expect(goal.cue.playUntilMs-250-goal.durationMs-goal.cue.atMs).toBe(46);
  const mount=render(<StrictMode><MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/></StrictMode>);
  try{
    await enableVoice('en');
    fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:'409449'}});
    await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(async function(this:HTMLMediaElement){
      mediaState(this).playing=true;now+=20;
    });
    fireEvent.click(mount.container.querySelector('.pbk-play')!);
    for(let i=0;i<6&&!events(mount.container).some(e=>e.kind==='play');i++){
      await act(async()=>{now+=1000/60;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});
    }
    expect(events(mount.container).filter(e=>e.kind==='skip'||e.kind==='error')).toEqual([]);
    expect(events(mount.container)).toContainEqual(expect.objectContaining({kind:'started',cueId:goal.cue.id,deadlineMs:46,startLagMs:expect.any(Number)}));
    const start=events(mount.container).find(e=>e.kind==='started'&&e.cueId===goal.cue.id)!;
    expect(start.startLagMs).toBeLessThanOrEqual(46);
    await finish(mount.container,goal,control.observed!.state.elapsedMs);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('still closes in %s after full-match speed, summary restart and an unsupported UI language round trip',async locale=>{
  localStorage.setItem('timepitch.locale','en');
  const f=await savedSummaryFixture(locale);
  const mount=render(<StrictMode><LanguageProvider><LanguageSelector/><MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/></LanguageProvider></StrictMode>);
  const frame=async(ms:number)=>{await act(async()=>{now+=ms;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});};
  try{
    await enableVoice(locale);
    for(const target of [f.periods[1].startMs!,f.track.durationMs,698390,913200,417000,925400,1403600,1569100]){
      fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(target)}});
      await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
      await frame(32);
    }
    fireEvent.click(screen.getByRole('button',{name:'Full match'}));
    await waitFor(()=>expect(control.observed!.policyId).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'5-minute halves: the match lasts 10 min'}));
    fireEvent.click(mount.container.querySelector('.pbk-play')!);
    await frame(1000);
    fireEvent.click(mount.container.querySelector('.pbk-play')!);
    fireEvent.click(screen.getByRole('button',{name:'Restart highlights'}));
    await waitFor(()=>expect(control.observed!.policyId).toBe('match-highlights-1'));
    expect(control.observed!.state.elapsedMs).toBe(0);
    fireEvent.change(mount.container.querySelector('.language-control select')!,{target:{value:'fr'}});
    expect(screen.getByRole('button',{name:'Saved voice on'})).toBeDisabled();
    fireEvent.change(mount.container.querySelector('.language-control select')!,{target:{value:'en'}});
    await enableVoice(locale);
    fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(f.track.durationMs-1000)}});
    await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
    fireEvent.click(mount.container.querySelector('.pbk-play')!);
    await frame(1100);
    expect(control.observed!.state.isMatchEnd).toBe(true);
    await finish(mount.container,f.prepared.presentationClips!.find(c=>c.phase==='fulltime')!,f.track.durationMs);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();localStorage.removeItem('timepitch.locale');}
},20000);

it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('closes in %s after a seek settles and playback crosses EOF before React commits that acknowledgement',async locale=>{
  const f=await savedSummaryFixture(locale);
  const mount=render(<StrictMode><MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/></StrictMode>);
  try{
    await enableVoice(locale);
    fireEvent.click(screen.getByRole('button',{name:'Full match'}));
    await waitFor(()=>expect(control.observed!.policyId).toBeNull());
    fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:'698000'}});
    await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
    const original=f.adapter.ensure.bind(f.adapter);
    vi.spyOn(f.adapter,'ensure').mockImplementation(async(...args)=>{
      await original(...args);now+=1100;
      // Native audio keeps progressing while source work delays the main thread.
      const audio=mount.container.querySelector('audio');
      if(audio&&mediaState(audio).playing)mediaState(audio).time+=1.1;
    });
    await act(async()=>{
      fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(f.track.durationMs-1000)}});
      fireEvent.click(mount.container.querySelector('.pbk-play')!);
    });
    await act(async()=>{const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});
    expect(control.observed!.state.isMatchEnd).toBe(true);
    await finish(mount.container,f.prepared.presentationClips!.find(c=>c.phase==='fulltime')!,f.track.durationMs);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('retains the natural %s final stop while its explicit seek acknowledgement is pending',async locale=>{
  const f=await savedSummaryFixture(locale),end=f.track.durationMs;
  at(f,end-10001,{wantsPlay:false,isPlaying:false,status:'paused'});
  const props={adapter:f.adapter,visible:true,onBack:()=>{},analysis:f.analysis,savedAudio:savedSummarySource,savedAudioCast:f.cast};
  const mount=render(<MatchCentre {...props}/>);
  try{
    await enableVoice(locale);
    fireEvent.click(screen.getByRole('button',{name:'Forward 10 s'}));
    at(f,end-1,{wantsPlay:true,isPlaying:true});
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    at(f,end,{isMatchEnd:true,wantsPlay:false,isPlaying:false,status:'ended',stop:{kind:'clip-end',atMs:end}});
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    expect(events(mount.container)).toEqual([]);
    seekAck={revision:seekSerial,targetMs:end-1,status:'settled'};
    at(f,end,{isMatchEnd:true,wantsPlay:false,isPlaying:false,status:'ended',stop:{kind:'clip-end',atMs:end}});
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    await finish(mount.container,f.prepared.presentationClips!.find(c=>c.phase==='fulltime')!,end);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable)('reports an opted-in closing rejected while its saved controller is loading',async()=>{
  const f=await savedSummaryFixture('en');at(f,f.track.durationMs-1);
  const props={adapter:f.adapter,visible:true,onBack:()=>{},analysis:f.analysis,savedAudio:savedSummarySource,savedAudioCast:f.cast};
  const mount=render(<MatchCentre {...props}/>);
  try{
    await enableVoice('en');
    vi.mocked(fetch).mockImplementation(()=>new Promise<Response>(()=>{}));
    const next={...props,savedAudio:{...savedSummarySource}};
    await act(async()=>mount.rerender(<MatchCentre {...next}/>));
    expect(mount.container.querySelector('[data-audio-status="loading"]')).toBeInTheDocument();
    at(f,f.track.durationMs,{isMatchEnd:true,wantsPlay:false,isPlaying:false,status:'ended',stop:{kind:'clip-end',atMs:f.track.durationMs}});
    await act(async()=>mount.rerender(<MatchCentre {...next}/>));
    expect(events(mount.container)).toContainEqual(expect.objectContaining({kind:'skip',reason:'presentation_unavailable',atMs:f.track.durationMs}));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(mount.container.querySelector('[data-saved-speech]')).toHaveTextContent('partial coverage');
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('dispatches the %s closing in the commit that first presents the natural final card',async locale=>{
  const f=await savedSummaryFixture(locale);let firstFinalPlays:number|undefined;
  const mount=render(<StrictMode><Profiler id="closing-first-paint" onRender={()=>{
    if(firstFinalPlays===undefined&&document.querySelector('[data-speech-phase="fulltime"]'))firstFinalPlays=vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
  }}><MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/></Profiler></StrictMode>);
  try{
    await enableVoice(locale);
    fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(f.track.durationMs-1)}});
    await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
    fireEvent.click(mount.container.querySelector('.pbk-play')!);
    await act(async()=>{now+=32;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});
    expect(firstFinalPlays).toBe(1);
    await finish(mount.container,f.prepared.presentationClips!.find(c=>c.phase==='fulltime')!,f.track.durationMs);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('publishes the %s closing on the next tick when wall time crosses EOF during a StrictMode render',async locale=>{
  const f=await savedSummaryFixture(locale);
  const mount=render(<StrictMode><MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/></StrictMode>);
  try{
    await enableVoice(locale);
    fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(f.track.durationMs-10)}});
    await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
    fireEvent.click(mount.container.querySelector('.pbk-play')!);
    control.afterRead=()=>{now+=10;};
    await act(async()=>{now+=1;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});
    expect(control.observed!.state.isMatchEnd).toBe(false);
    await act(async()=>{now+=32;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});
    expect(control.observed!.state.isMatchEnd).toBe(true);
    await finish(mount.container,f.prepared.presentationClips!.find(c=>c.phase==='fulltime')!,f.track.durationMs);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('records why an unstarted %s closing is cancelled when the tab hides before the EOF commit',async locale=>{
  let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  const f=await savedSummaryFixture(locale);
  const mount=render(<StrictMode><MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/></StrictMode>);
  try{
    await enableVoice(locale);
    fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(f.track.durationMs-1)}});
    await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
    fireEvent.click(mount.container.querySelector('.pbk-play')!);
    await act(async()=>{now+=32;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    const cueId=f.prepared.presentationClips!.find(c=>c.phase==='fulltime')!.cue.id;
    expect(control.observed!.state.isMatchEnd).toBe(true);
    expect(events(mount.container).filter(e=>e.kind==='play'&&e.cueId===cueId)).toEqual([]);
    expect(events(mount.container)).toContainEqual(expect.objectContaining({kind:'skip',reason:'presentation_hidden',cueId}));
    await act(async()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    expect(events(mount.container).filter(e=>e.kind==='play'&&e.cueId===cueId)).toEqual([]);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);
async function enableVoice(locale:'en'|'es'){
  await waitFor(()=>expect(screen.getByRole('button',{name:'Saved voice on'})).toBeEnabled(),{timeout:10000});
  if(locale==='es'){
    fireEvent.change(screen.getByLabelText('Saved voice language'),{target:{value:'es'}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Saved voice on'})).toBeEnabled(),{timeout:10000});
  }
  fireEvent.click(screen.getByRole('button',{name:'Saved voice on'}));
  expect(screen.getByRole('button',{name:'Saved voice off'})).toHaveAttribute('aria-pressed','true');
}
async function finish(container:HTMLElement,clip:{cue:{id:string};durationMs:number},clock:number){
  const audio=container.querySelector('audio')!;
  expect(events(container).filter(e=>e.kind==='play'&&e.cueId===clip.cue.id)).toHaveLength(1);
  expect(events(container).filter(e=>e.kind==='started'&&e.cueId===clip.cue.id)).toHaveLength(1);
  expect(control.observed!.state.elapsedMs).toBe(clock);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(events(container).filter(e=>e.kind==='play').length);
  await act(async()=>{now+=clip.durationMs;Object.assign(mediaState(audio),{time:audio.duration,ended:true,playing:false});fireEvent.ended(audio);});
  expect(events(container).filter(e=>e.audioEnded&&e.cueId===clip.cue.id)).toEqual([expect.objectContaining({audioTimeMs:clip.durationMs,audioEnded:true})]);
  expect(events(container).filter(e=>e.kind==='error'||e.kind==='skip')).toEqual([]);
}

it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('automatically completes real %s HT/FT clips after buffering and an automatic cut, without anticipating either marker',async locale=>{
  const f=await savedSummaryFixture(locale),ht=f.periods[1].startMs!;
  at(f,ht-1,{isPlaying:false,status:'buffering'});
  const props={adapter:f.adapter,visible:true,onBack:()=>{},savedAudio:savedSummarySource,savedAudioCast:f.cast,analysis:f.analysis};
  const mount=render(<MatchCentre {...props}/>);
  try{
    await enableVoice(locale);
    expect(events(mount.container).filter(e=>e.kind==='play')).toEqual([]);
    for(const phase of ['halftime','fulltime'] as const){
      const clock=phase==='halftime'?ht:f.track.durationMs;
      if(phase==='fulltime'){
        at(f,clock-1,{isPlaying:false,status:'buffering',jump:{revision:1,fromMs:ht,toMs:clock-1}});
        await act(async()=>mount.rerender(<MatchCentre {...props}/>));
        expect(events(mount.container).filter(e=>e.kind==='play')).toHaveLength(1);
      }
      at(f,clock,{isPlaying:false,wantsPlay:false,isMatchEnd:phase==='fulltime',status:phase==='fulltime'?'ended':'paused',
        stop:phase==='halftime'?{kind:'halftime',atMs:clock,endingPeriod:1}:{kind:'clip-end',atMs:clock},
        jump:{revision:phase==='halftime'?1:2,fromMs:clock-10,toMs:clock}});
      await act(async()=>mount.rerender(<MatchCentre {...props}/>));
      const clip=f.prepared.presentationClips!.find(c=>c.phase===phase)!;
      expect(clip.durationMs).toBe(locale==='en'?(phase==='halftime'?5256:5352):(phase==='halftime'?5208:5496));
      await finish(mount.container,clip,clock);
      await act(async()=>mount.rerender(<MatchCentre {...props}/>));
      expect(events(mount.container).filter(e=>e.kind==='play'&&e.cueId===clip.cue.id)).toHaveLength(1);
    }
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable)('releases seek(0) suppression when the first resolved cursor is 1; later natural HT and FT still complete',async()=>{
  const f=await savedSummaryFixture('en'),ht=f.periods[1].startMs!;
  at(f,1000,{wantsPlay:false,isPlaying:false,status:'paused'});
  const props={adapter:f.adapter,visible:true,onBack:()=>{},savedAudio:savedSummarySource,savedAudioCast:f.cast,analysis:f.analysis};
  const mount=render(<MatchCentre {...props}/>);
  try{
    await enableVoice('en');fireEvent.click(screen.getByRole('button',{name:'Back 10 s'}));
    expect(control.current!.seek).toHaveBeenCalledWith(0);
    at(f,1000,{pendingSeekMs:0,isPlaying:false,status:'buffering'});await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    seekAck={revision:seekSerial,targetMs:0,status:'settled'};at(f,1);await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    expect(events(mount.container).filter(e=>e.kind==='play')).toEqual([]);
    for(const phase of ['halftime','fulltime'] as const){
      const clock=phase==='halftime'?ht:f.track.durationMs;
      at(f,clock-1);await act(async()=>mount.rerender(<MatchCentre {...props}/>));
      at(f,clock,{isPlaying:false,wantsPlay:false,isMatchEnd:phase==='fulltime',stop:phase==='halftime'?{kind:'halftime',atMs:clock,endingPeriod:1}:{kind:'clip-end',atMs:clock}});
      await act(async()=>mount.rerender(<MatchCentre {...props}/>));
      await finish(mount.container,f.prepared.presentationClips!.find(c=>c.phase===phase)!,clock);
    }
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);

it.skipIf(!savedSummaryAvailable).each(['halftime','fulltime'] as const)('manual seeks onto and across %s remain silent, then a later natural stop still speaks',async phase=>{
  const f=await savedSummaryFixture('en'),ht=f.periods[1].startMs!,boundary=phase==='halftime'?ht:f.track.durationMs;
  at(f,boundary-10000);
  const props={adapter:f.adapter,visible:true,onBack:()=>{},savedAudio:savedSummarySource,savedAudioCast:f.cast,analysis:f.analysis};
  const mount=render(<MatchCentre {...props}/>);
  try{
    await enableVoice('en');fireEvent.click(screen.getByRole('button',{name:'Forward 10 s'}));
    seekAck={revision:seekSerial,targetMs:boundary,status:'settled'};
    at(f,boundary,{isPlaying:false,wantsPlay:false,isMatchEnd:phase==='fulltime'});
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    expect(events(mount.container).filter(e=>e.kind==='play')).toEqual([]);
    // A separate explicit seek settles beyond HT (FT is clamped to the recording's end).
    at(f,boundary-9999);await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    fireEvent.click(screen.getByRole('button',{name:'Forward 10 s'}));
    seekAck={revision:seekSerial,targetMs:Math.min(f.track.durationMs,boundary+1),status:'settled'};
    at(f,Math.min(f.track.durationMs,boundary+1),{isPlaying:false,wantsPlay:false,isMatchEnd:phase==='fulltime'});
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    expect(events(mount.container).filter(e=>e.kind==='play')).toEqual([]);
    at(f,boundary-1);await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    at(f,boundary,{isPlaying:false,wantsPlay:false,isMatchEnd:phase==='fulltime',stop:phase==='halftime'?{kind:'halftime',atMs:boundary,endingPeriod:1}:{kind:'clip-end',atMs:boundary}});
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    await finish(mount.container,f.prepared.presentationClips!.find(c=>c.phase===phase)!,boundary);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);


// This path uses the real hook, controller, adapter, saved loader and speech components.
it.skipIf(!savedSummaryAvailable).each(['en','es'] as const)('drives automatic %s HT/FT through the real playback controller and saved adapter with RAF and native media simulated',async locale=>{
  const f=await savedSummaryFixture(locale),ht=f.periods[1].startMs!;
  const mount=render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/>);
  const frame=async(ms:number)=>{await act(async()=>{now+=ms;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});};
  try{
    await enableVoice(locale);
    for(const phase of ['halftime','fulltime'] as const){
      const boundary=phase==='halftime'?ht:f.track.durationMs;
      const clip=f.prepared.presentationClips!.find(c=>c.phase===phase)!;
      for(const target of phase==='halftime'?[boundary,boundary+1]:[boundary]){
        fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(target)}});
        await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
        expect(control.observed!.state.elapsedMs).toBe(target);
        expect(control.observed!.state.stop).toBeNull();
        await frame(64);
        expect(events(mount.container).filter(e=>e.kind==='play'&&e.cueId===clip.cue.id)).toEqual([]);
      }
      fireEvent.change(mount.container.querySelector('.pbk-range')!,{target:{value:String(boundary-1)}});
      await waitFor(()=>expect(control.observed!.state.pendingSeekMs).toBeNull());
      expect(control.observed!.state.elapsedMs).toBe(boundary-1);
      expect(events(mount.container).filter(e=>e.kind==='play'&&e.cueId===clip.cue.id)).toEqual([]);
      fireEvent.click(mount.container.querySelector('.pbk-play')!);
      await frame(32);
      expect(control.observed!.state.elapsedMs).toBe(boundary);
      expect(control.observed!.state.stop?.kind).toBe(phase==='halftime'?'halftime':'clip-end');
      expect(mount.container.querySelector(`[data-saved-speech][data-speech-phase="${phase}"]`)).toBeInTheDocument();
      await frame(1000);
      expect(control.observed!.state.elapsedMs).toBe(boundary);
      await finish(mount.container,clip,boundary);
      await frame(1000);
      expect(control.observed!.state.elapsedMs).toBe(boundary);
      expect(events(mount.container).filter(e=>e.audioEnded&&e.cueId===clip.cue.id)).toHaveLength(1);
    }
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},20000);
