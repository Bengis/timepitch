import {render,screen} from '@testing-library/react';
import {it,vi,expect} from 'vitest';
import {MatchCentre} from './MatchCentre';
import {screenFixture} from './unified-screen-fixtures';
import {buildMatchCast} from '../presentation/cast';
import {SUMMARY_CORRECTIONS,summaryScope} from './narration/summary-corrections';
import type {useMatchPlayback} from './useMatchPlayback';
import type {EventView} from './session';
const boundary=vi.hoisted(()=>({current:null as unknown as ReturnType<typeof useMatchPlayback>}));
vi.mock('./useMatchPlayback',()=>({useMatchPlayback:()=>boundary.current}));
vi.mock('../match/Pitch',()=>({Pitch:()=> <div data-testid="field"/>}));
vi.mock('../presentation/useMatchCast',()=>({useMatchCast:()=>({cast:null,crests:{home:{src:'',kind:'none',source:null},away:{src:'',kind:'none',source:null}}})}));

it('reuses verified display cast at a retained equaliser cursor while the ordinary squad hook is still loading',()=>{
  const f=screenFixture('recorded'),e=SUMMARY_CORRECTIONS[0],s=f.initial;
  const player={...f.panel.players[0],id:'away',name:'Danny Vance',side:'away' as const};
  const players=[{...player,id:'home',name:'Jude Norris',side:'home' as const},player];
  const cast=buildMatchCast({source:'recorded',homeKey:'arsenal:2003',awayKey:'mancity:2024',players,squads:{home:[],away:[]}});
  const verified={...cast,players:new Map(cast.players)};verified.players.set('away',{...verified.players.get('away')!,displayName:'Josh Newbury'});
  s.descriptor={...s.descriptor,metadata:{engine:'grf'},home:{...s.descriptor.home,id:'arsenal:2003',name:'North London Reds'},away:{...s.descriptor.away,id:'mancity:2024',name:'Mancunian Sky'},durationMs:5811700,periods:[{period:1,startMs:0,durationMs:2925900},{period:2,startMs:2925900,durationMs:2885800}]};
  s.panels=Object.fromEntries(Object.entries(s.panels).map(([key,p])=>[key,{...p!,players,playerDetails:players}]));
  s.events=[{id:'first',elapsedMs:409500,side:'home',actorId:'home'},{id:e.eventId,elapsedMs:e.atMs,side:'away',actorId:'away'}].map(x=>({...x,kind:'goal',period:1,periodMs:x.elapsedMs,sourceIndex:0,participantIds:[x.actorId],outcome:'scored',provenance:'simulated',refs:[],details:{}})) as EventView[];
  boundary.current={state:{elapsedMs:925500,pendingSeekMs:null,speed:1,wantsPlay:false,isPlaying:false,isMatchEnd:false,status:'paused'},snapshot:{...s,presentedCursor:{elapsedMs:925500,period:1,periodMs:925500}},view:null,demand:{},policyId:'match-highlights-1',play:vi.fn(),pause:vi.fn(),seek:vi.fn(),setSpeed:vi.fn(),replay:vi.fn(),continueAfterStop:vi.fn()} as unknown as ReturnType<typeof useMatchPlayback>;
  render(<MatchCentre adapter={f.adapter} visible liveSimulation onBack={()=>{}} savedAudio={{manifestUrl:'/speech-summary-preview/manifest.json',expectedSource:summaryScope.source}} savedAudioCast={verified} speechCorrections={SUMMARY_CORRECTIONS}/>);
  expect(screen.getByText(e.replacementText)).toBeInTheDocument();
});
