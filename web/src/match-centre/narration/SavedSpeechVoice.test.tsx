import {expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SavedSpeechVoice} from './SavedSpeechVoice';
import type {TimelineContext} from '../analysis/RecordedAnalysisViews';
import type {ReplayAudioSource} from './ReplayAudio';
import sealedSummary from './fixtures/summary-cache.json';

const mocks=vi.hoisted(()=>({release:vi.fn(),update:vi.fn(),dispose:vi.fn(),suspend:vi.fn(),ended:vi.fn(),cancelPresentation:vi.fn(),playPresentation:vi.fn(async()=> 'ended')}));
vi.mock('./saved-speech',()=>({loadSavedSpeechAudio:vi.fn(async()=>({clips:[{}],omitted:[],release:mocks.release,timing:'native-deadline'}))}));
vi.mock('./summary-speech',()=>({loadSummarySpeechAudio:vi.fn(async()=>({clips:Array(5).fill({}),omitted:[],release:mocks.release,timing:'native-deadline'}))}));
vi.mock('./ReplayAudio',()=>({ReplayAudio:class{update=mocks.update;dispose=mocks.dispose;suspend=mocks.suspend;ended=mocks.ended;cancelPresentation=mocks.cancelPresentation;playPresentation=mocks.playPresentation;}}));
const ctx={teams:{home:{name:'Home'},away:{name:'Away'}},player:()=>null} as unknown as TimelineContext;
const source={manifestUrl:'/speech-preview/manifest.json',expectedSource:{}} as ReplayAudioSource;
const props={source,ctx,events:[],keepers:new Set<string>(),language:'en' as const,cursor:0,active:false,seekToken:0,cut:0,speed:1,
  presentation:{phase:'opening' as const,periods:[{period:1,startMs:0,durationMs:4000},{period:2,startMs:4000,durationMs:3000}],durationMs:7000}};
it('shows chronological presentation text without inventing marker audio or exposing future final',async()=>{
  const view=render(<SavedSpeechVoice {...props}/>);await waitFor(()=>expect(screen.getByText('Saved audio ready')).toBeInTheDocument());
  expect(screen.getByText(/We're under way/)).toBeInTheDocument();expect(screen.queryByText(/Full-time!/)).toBeNull();
  view.rerender(<SavedSpeechVoice {...props} cursor={4000} presentation={{...props.presentation,phase:'halftime'}}/>);
  expect(screen.getByText(/Half-time\./)).toBeInTheDocument();expect(screen.getByText(/Text only/)).toBeInTheDocument();
  view.rerender(<SavedSpeechVoice {...props} cursor={4000} active presentation={{...props.presentation,phase:'second-half'}}/>);
  expect(screen.getByText('The second half is under way.')).toBeInTheDocument();
  view.rerender(<SavedSpeechVoice {...props} cursor={7000} presentation={{...props.presentation,phase:'fulltime'}}/>);
  expect(screen.getByText(/Full-time!/)).toBeInTheDocument();view.unmount();expect(mocks.dispose).toHaveBeenCalled();
});
it('cancels immediately on document hide without waiting for a replay frame',async()=>{
  const view=render(<SavedSpeechVoice {...props} active/>);await screen.findByText('Saved audio ready');
  fireEvent.click(screen.getByRole('button',{name:'Saved voice on'}));
  mocks.update.mockClear();
  Object.defineProperty(document,'hidden',{configurable:true,value:true});
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(mocks.suspend).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({active:false}),expect.anything());
  Object.defineProperty(document,'hidden',{configurable:true,value:false});
  act(()=>document.dispatchEvent(new Event('visibilitychange')));view.unmount();
});
it('selects the separate full-summary loader with the available language inventory',async()=>{
  const view=render(<SavedSpeechVoice {...props} source={{manifestUrl:'/speech-summary-preview/manifest.json',expectedSource:sealedSummary.source} as ReplayAudioSource}/>);
  await screen.findByText('Saved audio ready');
  expect(screen.getByText(/50 saved clips.*25 per language/i)).toBeInTheDocument();view.unmount();
});
it('records native audio completion with measured progress rather than assuming a successful play means completion',async()=>{
  const view=render(<SavedSpeechVoice {...props}/>);await screen.findByText('Saved audio ready');
  const audio=view.container.querySelector('audio')!;
  Object.defineProperties(audio,{currentTime:{configurable:true,value:7.704},ended:{configurable:true,value:true}});
  fireEvent.ended(audio);
  expect(JSON.parse(view.container.querySelector('[data-speech-events]')!.getAttribute('data-speech-events')!)).toContainEqual(expect.objectContaining({kind:'stop',reason:'audio_ended',audioTimeMs:7704,audioEnded:true}));
});
