import {act,fireEvent,render} from '@testing-library/react';
import {StrictMode,useEffect} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MatchCentre} from './MatchCentre';
import {setNamesMode} from '../catalog/fictional';
import type {useMatchPlayback} from './useMatchPlayback';
import {savedSummaryAvailable,savedSummaryFixture,savedSummarySource} from './narration/summary-speech.test-support';
import type {SavedSpeechControl} from './narration/SavedSpeechVoice';
import type {SpeechPhase} from './narration/speech-summary';

const observation=vi.hoisted(()=>({playback:null as ReturnType<typeof useMatchPlayback>|null,phases:[] as string[]}));
vi.mock('./useMatchPlayback',async importOriginal=>{
  const real=await importOriginal<typeof import('./useMatchPlayback')>();
  return{useMatchPlayback:(...args:Parameters<typeof useMatchPlayback>)=>{
    const playback=real.useMatchPlayback(...args);observation.playback=playback;return playback;
  }};
});
vi.mock('../match/Pitch',()=>({Pitch:({overlay}:{overlay?:React.ReactNode})=><div>{overlay}</div>}));
// This test isolates phase arrival from media startup. The source, playback hook,
// controller, buffering and montage policy remain real; no synthesis/native audio.
vi.mock('./narration/NarrationVoice',()=>({NarrationVoice:({onSpeechControl}:{onSpeechControl?:(c:SavedSpeechControl|null)=>void})=>{
  useEffect(()=>{
    onSpeechControl?.({present:async(phase:SpeechPhase)=>{observation.phases.push(phase);return 'ended';},cancel:()=>{}});
    return()=>onSpeechControl?.(null);
  },[onSpeechControl]);
  return null;
}}));

let now=0,readCost=0,next=0,frames:Map<number,FrameRequestCallback>;
beforeEach(()=>{
  now=0;readCost=0;next=0;frames=new Map();observation.playback=null;observation.phases=[];
  setNamesMode('fictional',false);
  vi.spyOn(performance,'now').mockImplementation(()=>now+=readCost);
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++next,cb);return next;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('No network during saved arrival test');}));
});
afterEach(()=>{setNamesMode('real',false);vi.restoreAllMocks();vi.unstubAllGlobals();});

it.skipIf(!savedSummaryAvailable).each([0,.001,.1,.5])('requests all four markers through the entire saved montage with %s ms clock-read cost',async cost=>{
  const f=await savedSummaryFixture('es');
  const mount=render(<StrictMode><MatchCentre adapter={f.adapter} visible onBack={()=>{}} analysis={f.analysis} savedAudio={savedSummarySource} savedAudioCast={f.cast}/></StrictMode>);
  try{
    readCost=cost;
    await act(async()=>{fireEvent.click(mount.container.querySelector('.pbk-play')!);});
    let continued=false;
    for(let i=0;i<1000&&!observation.playback!.state.isMatchEnd;i++){
      await act(async()=>{now+=1000;const batch=[...frames.values()];frames.clear();batch.forEach(cb=>cb(now));});
      const start=mount.container.querySelector<HTMLButtonElement>('[data-match-phase="halftime"] .tp-break-primary');
      if(!continued&&start){
        await act(async()=>{fireEvent.click(start);});
        continued=true;
      }
    }
    await act(async()=>{});
    expect(observation.playback!.state.isMatchEnd,JSON.stringify(observation.playback!.state)).toBe(true);
    expect(observation.phases).toEqual(['opening','halftime','second-half','fulltime']);
  }finally{mount.unmount();f.adapter.dispose();f.prepared.release();}
},60000);
