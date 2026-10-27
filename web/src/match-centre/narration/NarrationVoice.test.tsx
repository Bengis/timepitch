import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NarrationVoice, useReplayVoice } from './NarrationVoice';
import type { NarrationLine } from './narration';
import type { TimelineContext } from '../analysis/RecordedAnalysisViews';

const voice={voiceURI:'local-en',lang:'en-US',localService:true} as SpeechSynthesisVoice;
const line=(atMs:number,kind:NarrationLine['kind']='pass')=>({id:String(atMs),atMs,kind,text:`Play ${atMs}`} as NarrationLine);
const speak=vi.fn(),cancel=vi.fn(),onError=vi.fn();
const initial={cursor:0,active:true,enabled:true,seek:0,cut:0,locale:'en',voice:voice as SpeechSynthesisVoice|null};
const lines=[line(500),line(1000,'goal'),line(5000),line(5500)];
const setup=(props=initial)=>renderHook(p=>useReplayVoice(lines,p.cursor,p.active,p.enabled,p.seek,p.cut,p.locale,p.voice,onError),{initialProps:props});
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubGlobal('speechSynthesis',{speak,cancel,speaking:false});
  vi.stubGlobal('SpeechSynthesisUtterance',class {text:string;constructor(text:string){this.text=text;}});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

it('speaks only new events and gives goals a more excited delivery',()=>{
  const {rerender}=setup();expect(speak).not.toHaveBeenCalled();
  rerender({...initial,cursor:500});expect(speak.mock.calls[0][0].text).toBe('Play 500');
  rerender({...initial,cursor:1000});expect(cancel).toHaveBeenCalledTimes(1);
  expect(speak.mock.calls[1][0]).toMatchObject({text:'Play 1000',rate:1.12,pitch:1.18,voice});
});
it('cancels on pause and never catches up when playback resumes',()=>{
  const {rerender}=setup();rerender({...initial,cursor:500});
  rerender({...initial,cursor:600,active:false});expect(cancel).toHaveBeenCalledTimes(1);
  rerender({...initial,cursor:1000});expect(speak).toHaveBeenCalledTimes(1);
});
it('discards skipped events and resumes from the next event after a montage cut',()=>{
  const {rerender}=setup();rerender({...initial,cursor:500});
  rerender({...initial,cursor:5000,cut:1});expect(cancel).toHaveBeenCalledTimes(1);expect(speak).toHaveBeenCalledTimes(1);
  rerender({...initial,cursor:5500,cut:1});expect(speak.mock.calls[1][0].text).toBe('Play 5500');
});
it('cancels on manual seeks, voice/language changes and disable',()=>{
  const {rerender}=setup();rerender({...initial,cursor:500});
  rerender({...initial,cursor:1000,seek:1});expect(cancel).toHaveBeenCalledTimes(1);
  rerender({...initial,cursor:5000,seek:1,locale:'es'});expect(speak).toHaveBeenCalledTimes(1);
  rerender({...initial,cursor:5500,seek:1,locale:'es',enabled:false});expect(speak).toHaveBeenCalledTimes(1);
});
it('does not accumulate ordinary sentences behind a voice still speaking',()=>{
  const {rerender}=setup();Object.defineProperty(globalThis.speechSynthesis,'speaking',{value:true});
  rerender({...initial,cursor:500});expect(speak).not.toHaveBeenCalled();
  rerender({...initial,cursor:1000});expect(speak).toHaveBeenCalledTimes(1);
});
it('discards a suspended-tab gap and cancels on unmount',()=>{
  const {rerender,unmount}=setup();rerender({...initial,cursor:500});
  rerender({...initial,cursor:5000});expect(speak).toHaveBeenCalledTimes(1);
  rerender({...initial,cursor:5500});expect(speak).toHaveBeenCalledTimes(2);
  unmount();expect(cancel).toHaveBeenCalledTimes(2);
});
it('handles unavailable voices and a synthesis error without sending requests',()=>{
  const {rerender}=setup({...initial,voice:null});rerender({...initial,cursor:500});expect(speak).not.toHaveBeenCalled();
  rerender({...initial,cursor:1000});speak.mock.calls[0][0].onerror({error:'audio-busy'});expect(onError).toHaveBeenCalledOnce();
});

it('offers a Spanish local voice in an English UI but excludes remote synthesis',()=>{
  Object.assign(speechSynthesis,{getVoices:()=>[{...voice,lang:'es-ES',voiceURI:'es',name:'Pablo'},{...voice,localService:false,voiceURI:'cloud',name:'Cloud'}],addEventListener:vi.fn(),removeEventListener:vi.fn()});
  const ctx={player:()=>null,teams:{home:{name:'Home'},away:{name:'Away'}}} as unknown as TimelineContext;
  render(<NarrationVoice ctx={ctx} events={[]} keepers={new Set()} cursor={0} active={false} seekToken={0} cut={0}/>);
  expect(screen.getByRole('button',{name:'Voice off'})).not.toBeDisabled();
  expect(screen.getAllByRole('option').map(o=>o.textContent)).toEqual(['Pablo · es-ES']);
  fireEvent.click(screen.getByRole('button',{name:'Voice off'}));expect(screen.getByRole('button',{name:'Voice on'})).toHaveAttribute('aria-pressed','true');
});

it('does not expose voice controls or inspect device voices in the public production build',()=>{
  vi.stubEnv('DEV',false);
  const getVoices=vi.fn(()=>[voice]);
  Object.assign(speechSynthesis,{getVoices,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  const ctx={player:()=>null,teams:{home:{name:'Home'},away:{name:'Away'}}} as unknown as TimelineContext;
  const {container}=render(<NarrationVoice ctx={ctx} events={[]} keepers={new Set()} cursor={0} active={true} seekToken={0} cut={0}/>);
  expect(container).toBeEmptyDOMElement();
  expect(getVoices).not.toHaveBeenCalled();expect(speak).not.toHaveBeenCalled();
});
