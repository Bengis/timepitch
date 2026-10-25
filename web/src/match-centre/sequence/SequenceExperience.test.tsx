import { act,fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MatchCentre } from '../MatchCentre';
import { sequenceScreenFixture as fixture } from './screen-fixture';
import { halftimePolicy } from './pilot';
import { LanguageProvider } from '../../i18n';
import type { ReactNode } from 'react';
import type { PitchProjection } from '../../match/renderers/types';

vi.mock('../../match/Pitch',()=>({Pitch:({frame,active,renderOverlay}:{frame:{ball:unknown;players:unknown[]};active:boolean;renderOverlay?:(p:PitchProjection)=>ReactNode})=><section data-testid="single-pitch" hidden={!active}><canvas data-ball={JSON.stringify(frame.ball)} data-players={frame.players.length}/>{renderOverlay?.({viewport:{width:384,height:256},projectFieldPoint:(x,y)=>({x,y})})}</section>}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('one_pitch_and_progressive_details',async()=>{
  const f=await fixture(),{container}=render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Play'})).toBeEnabled());
  expect(container.querySelectorAll('canvas')).toHaveLength(1);expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(container.querySelector('.sequence-ball-overlay')).toBeNull();
  expect(screen.getByRole('button',{name:'Replay sequence'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Next moment'})).toBeInTheDocument();
  expect(within(screen.getByRole('combobox',{name:'Speed'})).getAllByRole('option').map(o=>o.textContent)).toEqual(['0.5×','1×','2×']);
  expect(screen.getByRole('heading',{name:'This play'})).toBeInTheDocument();
  fireEvent.click(screen.getByText('Match details'));await waitFor(()=>expect(screen.getAllByRole('tab')).toHaveLength(6));
  expect(container.querySelectorAll('canvas')).toHaveLength(1);
});
it('keeps saved exports in details and never mounts a chronicle for the pilot',async()=>{
  const f=await fixture();f.adapter.snapshot().descriptor.export={href:'/saved-export.json',availability:{status:'available',reason:null}};
  render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Play'})).toBeEnabled());
  expect(screen.queryByRole('link',{name:'Export replay'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Match details'));
  await waitFor(()=>expect(screen.getByRole('link',{name:'Export replay'})).toHaveAttribute('href','/saved-export.json'));
  fireEvent.click(screen.getByRole('tab',{name:'Summary'}));expect(screen.queryByText('AI match report')).not.toBeInTheDocument();
});
it('localizes the simplified controls and analysis in Spanish',async()=>{
  localStorage.setItem('timepitch.locale','es');const f=await fixture();
  render(<LanguageProvider><MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/></LanguageProvider>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Reproducir'})).toBeEnabled());
  expect(screen.getByRole('heading',{name:'Esta jugada'})).toBeInTheDocument();
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1695328'}});
  await waitFor(()=>expect(screen.getByRole('heading',{name:/Tiro de .*Ayew.* bloqueado/})).toBeInTheDocument());
  expect(screen.getByRole('button',{name:'Ver evidencias'})).toBeInTheDocument();
});
it('ordinary hidden-layer preferences cannot erase the certified pilot players or ball',async()=>{
  const f=await fixture(),{rerender,container}=render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}}/>);
  fireEvent.click(screen.getByRole('checkbox',{name:'Synthetic movement'}));
  rerender(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/>);
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1684024'));
  expect(container.querySelector('canvas')).toHaveAttribute('data-players','22');expect(container.querySelector('canvas')).not.toHaveAttribute('data-ball','null');
});
it('future_moment_is_generic_in_dom_and_aria',async()=>{
  const f=await fixture(),{container}=render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/>);
  await waitFor(()=>expect(screen.getByRole('slider',{name:'Sequence position'})).toHaveValue('1684024'));
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1695328'}});
  await waitFor(()=>expect(screen.getByRole('heading',{name:/Ayew.*shot is blocked/})).toBeInTheDocument());
  expect(screen.getByText('0.263')).toBeInTheDocument();expect(screen.getAllByText(/Cahill/)[0]).toBeInTheDocument();
  expect(container.innerHTML).not.toMatch(/Ayew scores|0\.307|2 : 2|132624e5-65f2-405e-9842-d26eaa11e939/);
  expect(screen.getAllByRole('button',{name:/Next moment/}).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1697116'}});
  await waitFor(()=>expect(screen.getByText('1 : 1')).toBeInTheDocument());
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1695328'}});
  await waitFor(()=>expect(screen.getByText('1 : 0')).toBeInTheDocument());expect(container.innerHTML).not.toContain('Ayew scores');
});
it('clip_end_does_not_reveal_match_final',async()=>{
  const f=await fixture();render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/>);
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1684024'));
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1697850'}});
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1697850'));
  expect(screen.queryByText('2 : 2')).not.toBeInTheDocument();expect(screen.queryByText(/Full-time/)).not.toBeInTheDocument();
  expect(f.adapter.loadPanel).not.toHaveBeenCalledWith(expect.anything(),expect.anything(),true,expect.anything(),expect.anything());
  fireEvent.click(screen.getByRole('button',{name:'Replay sequence'}));
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1684024'));expect(screen.getByRole('button',{name:'Play'})).toBeInTheDocument();
});
it('next moment pauses and evidence/player inspection keeps the pitch',async()=>{
  const f=await fixture(),{container}=render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/>);
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1684024'));
  fireEvent.click(screen.getByRole('button',{name:'Next moment'}));
  await waitFor(()=>expect(Number((screen.getByRole('slider') as HTMLInputElement).value)).toBeGreaterThan(1684024));
  expect(screen.getByRole('button',{name:'Play'})).toBeInTheDocument();
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1695328'}});
  await waitFor(()=>expect(screen.getByText('0.263')).toBeInTheDocument());
  const player=screen.getByRole('button',{name:'Gary Cahill'});player.focus();fireEvent.click(player);
  expect(screen.getByRole('dialog')).toBeInTheDocument();expect(container.querySelectorAll('canvas')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Close player detail'}));expect(player).toHaveFocus();
  fireEvent.click(screen.getByRole('button',{name:'View evidence'}));expect(screen.getByText(/43aa4774/)).toBeInTheDocument();
});
it('closing an inspector after the play card changes restores the primary control',async()=>{
  const f=await fixture();render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={f.sequence}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Play'})).toBeEnabled());
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1695328'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Gary Cahill'})).toBeInTheDocument());
  const opener=screen.getByRole('button',{name:'Gary Cahill'});opener.focus();fireEvent.click(opener);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1697116'}});
  await waitFor(()=>expect(screen.getByText('1 : 1')).toBeInTheDocument());expect(opener.isConnected).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Close player detail'}));expect(screen.getByRole('button',{name:'Play'})).toHaveFocus();
});
it('half-time pauses at the real boundary and continues with second-half time, even without motion',async()=>{
  let now=0,id=0;const callbacks=new Map<number,FrameRequestCallback>();
  vi.spyOn(performance,'now').mockImplementation(()=>now);
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{callbacks.set(++id,cb);return id;});
  vi.stubGlobal('cancelAnimationFrame',(key:number)=>callbacks.delete(key));
  const f=await fixture();
  render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} sequence={{kind:'boundary-check',policy:halftimePolicy(f.adapter.snapshot().descriptor)}}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Play'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Play'}));
  await act(async()=>{now=3000;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(now));});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Start second half'})).toBeEnabled());
  expect(screen.getByText(/1st half · Half-time/)).toBeInTheDocument();
  expect(f.adapter.ensure).toHaveBeenCalledWith(2880495,expect.anything(),expect.objectContaining({endingPeriod:1}));
  fireEvent.click(screen.getByRole('button',{name:'Start second half'}));
  await waitFor(()=>expect(screen.getByText(/2nd half · 45:00/)).toBeInTheDocument());
  expect(f.adapter.snapshot().presentedCursor).toMatchObject({elapsedMs:2880495,period:2,periodMs:0});
});
