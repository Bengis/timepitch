import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HistoricalMatchCentre } from './HistoricalMatchCentre';
import { sequenceScreenFixture } from '../match-centre/sequence/screen-fixture';
import { PILOT_REVISION } from '../match-centre/sequence/pilot';
import { StrictMode } from 'react';
const {factory}=vi.hoisted(()=>({factory:vi.fn()}));
vi.mock('../match-centre/adapters/historical',async importOriginal=>{
  const actual=await importOriginal<typeof import('../match-centre/adapters/historical')>();
  return {...actual,createHistoricalSession:(...args:Parameters<typeof actual.createHistoricalSession>)=>args[2]?actual.createHistoricalSession(...args):factory(...args)};
});
vi.mock('../match/Pitch',()=>({Pitch:()=> <canvas/>}));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const route={mode:'reconstruction',matchId:3754078,sequence:'ayew-equaliser-1'} as const;
it('prepares V2 before first controller sampling and reconfigures profiles without disposing it',async()=>{
  vi.stubEnv('VITE_TIMEPITCH_SEQUENCE_PREVIEW','1');
  const f=await sequenceScreenFixture();factory.mockReturnValue(f.adapter);
  const props={matchId:3754078,datasetVersion:PILOT_REVISION,visible:true,onNavigate:vi.fn()};
  const {rerender}=render(<HistoricalMatchCentre {...props} route={route}/>);
  expect(screen.queryByRole('button',{name:'Play'})).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Replay sequence'})).toBeInTheDocument());
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1684024'));
  expect(vi.mocked(f.adapter.ensure).mock.calls[0][0]).toBe(1684024);expect(f.listeners.size).toBe(1);
  rerender(<HistoricalMatchCentre {...props} route={{...route,sequence:'halftime-check-1'}}/>);
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveAttribute('min','2878495'));
  expect(f.adapter.dispose).not.toHaveBeenCalled();expect(f.listeners.size).toBe(1);
  rerender(<HistoricalMatchCentre {...props} route={route}/>);
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1684024'));
  expect(f.adapter.dispose).not.toHaveBeenCalled();expect(f.listeners.size).toBe(1);
});
it('flag off, unsupported profile or wrong revision keeps ordinary viewing with an explicit notice',async()=>{
  const f=await sequenceScreenFixture();factory.mockReturnValue(f.adapter);
  const props={matchId:3754078,datasetVersion:PILOT_REVISION,visible:true,onNavigate:vi.fn()};
  const {rerender}=render(<HistoricalMatchCentre {...props} route={route}/>);
  expect(screen.getAllByRole('tab')).toHaveLength(6);expect(screen.getByText(/Sequence preview unavailable/)).toBeInTheDocument();
  expect(f.adapter.loadSequence).not.toHaveBeenCalled();
  vi.stubEnv('VITE_TIMEPITCH_SEQUENCE_PREVIEW','1');
  rerender(<HistoricalMatchCentre {...props} route={{...route,sequence:'unavailable'}}/>);
  expect(screen.getAllByRole('tab')).toHaveLength(6);expect(f.adapter.loadSequence).not.toHaveBeenCalled();
  rerender(<HistoricalMatchCentre {...props} datasetVersion="wrong" route={route}/>);
  await act(async()=>{});expect(screen.getAllByRole('tab')).toHaveLength(6);expect(f.adapter.loadSequence).not.toHaveBeenCalled();
});
it('StrictMode preparation leaves one live subscription and disposes only on unmount',async()=>{
  vi.stubEnv('VITE_TIMEPITCH_SEQUENCE_PREVIEW','1');const f=await sequenceScreenFixture();factory.mockReturnValue(f.adapter);
  const {unmount}=render(<StrictMode><HistoricalMatchCentre matchId={3754078} datasetVersion={PILOT_REVISION} visible onNavigate={()=>{}} route={route}/></StrictMode>);
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('1684024'));
  expect(f.listeners.size).toBe(1);expect(f.adapter.dispose).not.toHaveBeenCalled();
  unmount();await act(async()=>{});expect(f.listeners.size).toBe(0);expect(f.adapter.dispose).toHaveBeenCalledOnce();
});
