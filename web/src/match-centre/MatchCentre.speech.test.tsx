import {useEffect} from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MatchCentre} from './MatchCentre';
import {screenFixture} from './unified-screen-fixtures';
import type {useMatchPlayback} from './useMatchPlayback';
import type {PresentationResult} from './narration/ReplayAudio';
import type {SavedSpeechControl} from './narration/SavedSpeechVoice';
const mocks=vi.hoisted(()=>({current:null as unknown as ReturnType<typeof useMatchPlayback>,present:vi.fn(),cancel:vi.fn()}));
vi.mock('./useMatchPlayback',()=>({useMatchPlayback:()=>mocks.current}));
vi.mock('../match/Pitch',()=>({Pitch:({overlay}:{overlay?:React.ReactNode})=><div>{overlay}</div>}));
vi.mock('./narration/NarrationVoice',()=>({NarrationVoice:({onSpeechControl}:{onSpeechControl?:(c:SavedSpeechControl|null)=>void})=>{
  useEffect(()=>{onSpeechControl?.({present:mocks.present,cancel:mocks.cancel});return()=>onSpeechControl?.(null);},[onSpeechControl]);return null;
}}));
afterEach(()=>{vi.clearAllMocks();});
function fixture(ms=0,playing=false,stop=false){
  const f=screenFixture('timepitch');
  mocks.current={state:{elapsedMs:ms,pendingSeekMs:null,speed:1,wantsPlay:playing,isPlaying:playing,isMatchEnd:false,status:playing?'playing':'paused',stop:stop?{kind:'halftime',atMs:5000,endingPeriod:1}:null},
    snapshot:{...f.initial,presentedCursor:{elapsedMs:ms,period:ms>=5000?2:1,periodMs:ms>=5000?ms-5000:ms}},view:null,demand:{},policyId:'match-highlights-1',
    play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn()} as unknown as ReturnType<typeof useMatchPlayback>;
  return{adapter:f.adapter,visible:true,onBack:()=>{},savedAudio:{manifestUrl:'/speech-summary-preview/manifest.json',expectedSource:{} as never}};
}
it('holds the match clock on the opening card until speech ends; user pause revokes auto-resume',async()=>{
  let finish!:(result:PresentationResult)=>void;mocks.present.mockImplementation(()=>new Promise<PresentationResult>(r=>{finish=r;}));
  const mount=render(<MatchCentre {...fixture()}/>);
  fireEvent.click(mount.container.querySelector('.pbk-play')!);
  expect(mocks.present).toHaveBeenCalledWith('opening');expect(mocks.current.pause).toHaveBeenCalled();expect(mocks.current.play).not.toHaveBeenCalled();
  expect(mount.container.querySelector('[data-speech-hold="opening"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));
  await act(async()=>finish('ended'));expect(mocks.current.play).not.toHaveBeenCalled();
});
it('waits for second-half speech before releasing the authoritative halftime stop',async()=>{
  let finish!:(result:PresentationResult)=>void;mocks.present.mockImplementation(()=>new Promise<PresentationResult>(r=>{finish=r;}));
  render(<MatchCentre {...fixture(5000,false,true)}/>);
  expect(mocks.present).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/Start the second half/}));
  expect(mocks.present).toHaveBeenCalledWith('second-half');expect(mocks.current.continueAfterStop).not.toHaveBeenCalled();
  await act(async()=>finish('ended'));expect(mocks.current.continueAfterStop).toHaveBeenCalledOnce();
});
it('speaks halftime only after natural arrival; the clock remains at the recorded boundary',async()=>{
  mocks.present.mockResolvedValue('ended');const props=fixture(4900,true),mount=render(<MatchCentre {...props}/>);
  mocks.current={...mocks.current,state:{...mocks.current.state,elapsedMs:5000,isPlaying:false,wantsPlay:false,stop:{kind:'halftime',atMs:5000,endingPeriod:1}},snapshot:{...mocks.current.snapshot,presentedCursor:{elapsedMs:4900,period:1,periodMs:4900}}};
  await act(async()=>mount.rerender(<MatchCentre {...props}/>));
  expect(mocks.present).toHaveBeenCalledWith('halftime');expect(mocks.current.state.elapsedMs).toBe(5000);expect(mocks.current.continueAfterStop).not.toHaveBeenCalled();
});
it.each(['halftime','fulltime'] as const)('speaks a natural %s card in full-match playback without a policy stop',async phase=>{
  mocks.present.mockResolvedValue('ended');const before=phase==='halftime'?4900:9900,at=phase==='halftime'?5000:10000;
  const props=fixture(before,true);mocks.current={...mocks.current,policyId:null};const mount=render(<MatchCentre {...props}/>);
  mocks.current={...mocks.current,state:{...mocks.current.state,elapsedMs:at,isPlaying:phase==='halftime',wantsPlay:phase==='halftime',isMatchEnd:phase==='fulltime',status:phase==='fulltime'?'ended':'playing'},snapshot:{...mocks.current.snapshot,presentedCursor:{elapsedMs:at,period:2,periodMs:at-5000}}};
  await act(async()=>mount.rerender(<MatchCentre {...props}/>));
  expect(mocks.present).toHaveBeenCalledWith(phase);expect(mocks.current.play).not.toHaveBeenCalled();
});
it('does not narrate a phase card reached through an explicit seek',async()=>{
  mocks.present.mockResolvedValue('ended');const props=fixture(4900,true);mocks.current={...mocks.current,policyId:null};const mount=render(<MatchCentre {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Forward 10 s'}));
  mocks.current={...mocks.current,state:{...mocks.current.state,elapsedMs:10000,isPlaying:false,wantsPlay:false,isMatchEnd:true,status:'ended'},snapshot:{...mocks.current.snapshot,presentedCursor:{elapsedMs:10000,period:2,periodMs:5000}}};
  await act(async()=>mount.rerender(<MatchCentre {...props}/>));expect(mocks.present).not.toHaveBeenCalled();
});
it.each(['halftime','fulltime'] as const)('uses the authoritative %s stop after buffering and an automatic cut',async phase=>{
  mocks.present.mockResolvedValue('ended');const at=phase==='halftime'?5000:10000;
  const props=fixture(at-100,true);mocks.current={...mocks.current,state:{...mocks.current.state,isPlaying:false,status:'buffering'}};
  const mount=render(<MatchCentre {...props}/>);
  mocks.current={...mocks.current,state:{...mocks.current.state,elapsedMs:at,isPlaying:false,wantsPlay:false,isMatchEnd:phase==='fulltime',status:'paused',stop:phase==='halftime'?{kind:'halftime',atMs:at,endingPeriod:1}:{kind:'clip-end',atMs:at},jump:{revision:1,fromMs:at-200,toMs:at-100}}};
  await act(async()=>mount.rerender(<MatchCentre {...props}/>));
  expect(mocks.present).toHaveBeenCalledWith(phase);
  await act(async()=>mount.rerender(<MatchCentre {...props}/>));expect(mocks.present).toHaveBeenCalledTimes(1);
});
it('releases a confirmed seek without observing its exact cursor, then speaks both later natural stops',async()=>{
  mocks.present.mockResolvedValue('ended');const props=fixture(1000,true),mount=render(<MatchCentre {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Back 10 s'}));
  Object.assign(mocks.current,{seekState:{revision:1,targetMs:0,status:'settled'}});
  mocks.current={...mocks.current,state:{...mocks.current.state,elapsedMs:1},snapshot:{...mocks.current.snapshot,presentedCursor:{elapsedMs:1,period:1,periodMs:1}}};
  await act(async()=>mount.rerender(<MatchCentre {...props}/>));expect(mocks.present).not.toHaveBeenCalled();
  for(const [at,phase] of [[5000,'halftime'],[10000,'fulltime']] as const){
    mocks.current={...mocks.current,state:{...mocks.current.state,elapsedMs:at-100,isPlaying:true,wantsPlay:true,stop:null}};
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    mocks.current={...mocks.current,state:{...mocks.current.state,elapsedMs:at,isPlaying:false,wantsPlay:false,isMatchEnd:phase==='fulltime',stop:phase==='halftime'?{kind:'halftime',atMs:at,endingPeriod:1}:{kind:'clip-end',atMs:at}}};
    await act(async()=>mount.rerender(<MatchCentre {...props}/>));
    expect(mocks.present).toHaveBeenCalledWith(phase);
  }
  expect(mocks.present).toHaveBeenCalledTimes(2);
});
