import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import type {GrfStatisticsSummary} from '../../api';
import {getGrfStatistics} from '../../api';
import {LanguageProvider,useLanguage} from '../../i18n';
import {GrfMatchView} from '../GrfMatchView';
import {fullFixture} from '../test-fixtures';
import {GrfStatisticsPanel} from './GrfStatisticsPanel';
import {summaryFixture} from './test-fixtures';

vi.mock('../../api',async()=>({...await vi.importActual('../../api'),getGrfStatistics:vi.fn()}));
vi.mock('../../match/Pitch',()=>({Pitch:()=> <div>Pitch fixture</div>}));
beforeEach(()=>{localStorage.clear();vi.mocked(getGrfStatistics).mockReset();vi.mocked(getGrfStatistics).mockResolvedValue(summaryFixture());});
afterEach(cleanup);

it('filters collective shape by team and half without discarding the player filter for other maps',async()=>{
  const data=summaryFixture();data.team_shape.push({side:'away',phase:2,length_m:42,width_m:38,covered_ms:100});
  vi.mocked(getGrfStatistics).mockResolvedValueOnce(data);
  render(<LanguageProvider><GrfStatisticsPanel id="one" traceHash="fixture" onSeek={()=>{}} view="maps"/></LanguageProvider>);
  await screen.findByRole('heading',{name:'Post-match statistics'});
  fireEvent.change(screen.getByLabelText('Team'),{target:{value:'away'}});
  fireEvent.change(screen.getByLabelText('Half'),{target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('Player'),{target:{value:data.players[12].id}});
  fireEvent.click(screen.getByRole('button',{name:'Team structure by half'}));
  const shape=screen.getByRole('table',{name:'Team structure by half'});
  expect(within(shape).getAllByRole('row')).toHaveLength(2);
  expect(within(shape).getByRole('rowheader',{name:'Away club'})).toBeVisible();
  expect(screen.getByLabelText('Player')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Shot map'}));
  expect(screen.getByLabelText('Player')).toBeEnabled();
  expect(screen.getByLabelText('Player')).toHaveValue(data.players[12].id);
});

function LocaleSwitch(){const {setLocale}=useLanguage();return <button onClick={()=>setLocale('es')}>ES</button>;}

it('loads only on explicit final-result reveal or completion and keeps final stats after rewinding',async()=>{
  render(<LanguageProvider><GrfMatchView id="one" record={fullFixture()} onBack={()=>{}}/></LanguageProvider>);
  expect(getGrfStatistics).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));
  await waitFor(()=>expect(getGrfStatistics).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('tab',{name:'Summary'}));await screen.findAllByText('shots');
  fireEvent.change(screen.getByRole('slider'),{target:{value:'300'}});await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('300'));fireEvent.change(screen.getByRole('slider'),{target:{value:'0'}});
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('0'));expect(getGrfStatistics).toHaveBeenCalledTimes(1);expect(screen.getAllByText('shots').length).toBeGreaterThan(0);
});
it('loads automatically at full time and translates without another request or forced tab',async()=>{
  render(<LanguageProvider><LocaleSwitch/><GrfMatchView id="one" record={fullFixture()} onBack={()=>{}}/></LanguageProvider>);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'300'}});await waitFor(()=>expect(getGrfStatistics).toHaveBeenCalledTimes(1));await screen.findByText('Final analysis revealed');
  fireEvent.click(screen.getByText('ES'));expect(screen.getByText('Análisis final visible')).toBeVisible();expect(screen.getByRole('tab',{name:'Emisión en directo'})).toHaveAttribute('aria-selected','true');expect(getGrfStatistics).toHaveBeenCalledTimes(1);
});
it('discards delayed responses for another id and retries a recoverable error',async()=>{
  let finish!:(value:GrfStatisticsSummary)=>void;
  vi.mocked(getGrfStatistics).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<LanguageProvider><GrfStatisticsPanel id="A" traceHash="A" onSeek={()=>{}}/></LanguageProvider>);
  vi.mocked(getGrfStatistics).mockResolvedValueOnce(summaryFixture('B','B scorer'));
  view.rerender(<LanguageProvider><GrfStatisticsPanel id="B" traceHash="B" onSeek={()=>{}}/></LanguageProvider>);
  await screen.findAllByText(/B scorer/);
  await act(async()=>finish(summaryFixture('A','A scorer')));
  expect(screen.queryByText(/A scorer/)).not.toBeInTheDocument();
  vi.mocked(getGrfStatistics).mockRejectedValueOnce(new Error('network'));
  view.rerender(<LanguageProvider><GrfStatisticsPanel id="C" traceHash="C" onSeek={()=>{}}/></LanguageProvider>);
  await screen.findByRole('alert');
  vi.mocked(getGrfStatistics).mockResolvedValueOnce(summaryFixture('C'));
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('rejects a response for another hash and distinguishes zero, missing events and accessible plots',async()=>{
  vi.mocked(getGrfStatistics).mockResolvedValueOnce(summaryFixture('wrong'));
  const view=render(<LanguageProvider><GrfStatisticsPanel id="one" traceHash="fixture" onSeek={()=>{}}/></LanguageProvider>);
  await screen.findByRole('alert');
  const summary=summaryFixture();summary.by_team.home.shots.value=null;summary.coverage.events_complete=false;
  vi.mocked(getGrfStatistics).mockResolvedValueOnce(summary);
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await screen.findByRole('heading',{name:'Post-match statistics'});
  expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  expect(screen.getByText(/Events were not recorded/)).toBeVisible();
  view.rerender(<LanguageProvider><GrfStatisticsPanel id="one" traceHash="fixture" onSeek={()=>{}} view="maps"/></LanguageProvider>);
  expect(screen.getByRole('img',{name:'Shot map'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Confirmed pass network'}));
  expect(screen.getByRole('img',{name:'Confirmed pass network'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Pitch occupancy'}));
  expect(screen.getByRole('img',{name:'Pitch occupancy'})).toBeVisible();
  view.unmount();
});

it('keeps observed positions outside the pitch inside the visible chart frame',async()=>{
  const summary=summaryFixture();summary.positions[0].x=-20;
  vi.mocked(getGrfStatistics).mockResolvedValueOnce(summary);
  render(<LanguageProvider><GrfStatisticsPanel id="one" traceHash="fixture" onSeek={()=>{}} view="maps"/></LanguageProvider>);
  await screen.findByRole('heading',{name:'Post-match statistics'});
  fireEvent.click(screen.getByRole('button',{name:'Confirmed pass network'}));
  expect(screen.getByRole('img',{name:'Confirmed pass network'}).getAttribute('viewBox')?.split(' ')[0]).toBe('-22');
});
