import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { StatisticsPanel } from './StatisticsPanel';
import { LanguageProvider,LanguageSelector } from '../../i18n';
import type { MatchRecordV2,StatisticsBundle,TeamSeason } from '../../api';
import { getStatistics } from '../../api';
import { Roster } from '../../catalog/Roster';
import { StatisticsPlots } from './StatisticsPlots';
import type { RenderFrame } from '../../api';
vi.mock('../../api',()=>({getStatistics:vi.fn()}));

const value={value:.4,unit:'xG',origin:'simulated' as const,status:'available' as const,source:'fixture',definition_version:'events-1',event_ids:['shot'],sample_ranges:[]};
const bundle=(end:number):StatisticsBundle=>({version:'metrics-1',end_ms:end,
  definitions:{simulated_xg:{id:'simulated_xg',version:'events-1',unit:'xG',label_key:'metrics.simulated_xg',parameters:{}}},
  by_team:{home:{simulated_xg:value},away:{simulated_xg:{...value,value:.1}}},by_player:{},plots:{}});
const record={format_version:2,trace_hash:'same-hash',home_name:'Home example',away_name:'Away example',
  initial_frame:{players:[]},statistics:bundle(5400000)} as unknown as MatchRecordV2;
const wrap=(time:number,id='match-a')=><LanguageProvider><LanguageSelector/><StatisticsPanel matchId={id} record={record} timeMs={time}/></LanguageProvider>;
beforeEach(()=>{localStorage.clear();vi.mocked(getStatistics).mockReset();});
afterEach(cleanup);

it('queries only explicitly, retains numbers across language and clears on rewind',async()=>{
  vi.mocked(getStatistics).mockResolvedValue(bundle(1800250));
  const view=render(wrap(1800349));
  expect(getStatistics).not.toHaveBeenCalled();
  expect(screen.queryByText('Final match statistics')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Inspect current statistics'}));
  await waitFor(()=>expect(screen.getByTestId('statistics-result')).toHaveAttribute('data-end-ms','1800250'));
  expect(getStatistics).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
  expect(screen.getByTestId('statistics-result')).toHaveAttribute('data-trace-hash','same-hash');
  expect(screen.getByText('xG simulado')).toBeInTheDocument();
  expect(getStatistics).toHaveBeenCalledTimes(1);
  view.rerender(wrap(1700000));
  expect(screen.queryByTestId('statistics-result')).not.toBeInTheDocument();
});

it('ignores a late response from another time, identity or request language',async()=>{
  let resolve!:(value:StatisticsBundle)=>void;
  vi.mocked(getStatistics).mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const view=render(wrap(1800349));
  fireEvent.click(screen.getByRole('button',{name:'Inspect current statistics'}));
  view.rerender(wrap(1000000,'match-b'));
  await act(async()=>resolve(bundle(1800250)));
  expect(screen.queryByTestId('statistics-result')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Inspect current statistics'}));
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
  await act(async()=>resolve(bundle(1000000)));
  expect(screen.queryByTestId('statistics-result')).not.toBeInTheDocument();
});

it('uses the validated persisted final bundle only at full time',()=>{
  const view=render(wrap(5399000));
  expect(screen.queryByText('Final match statistics')).not.toBeInTheDocument();
  view.rerender(wrap(5400000));
  expect(screen.getByText('Final match statistics')).toBeInTheDocument();
  expect(screen.getByTestId('statistics-result')).toHaveAttribute('data-end-ms','5400000');
  expect(getStatistics).not.toHaveBeenCalled();
});

it('invalidates the loaded snapshot when the same match identity has a different trace hash',async()=>{
  vi.mocked(getStatistics).mockResolvedValue(bundle(1800000));
  const view=render(wrap(1800000));
  fireEvent.click(screen.getByRole('button',{name:'Inspect current statistics'}));
  await screen.findByTestId('statistics-result');
  view.rerender(<LanguageProvider><StatisticsPanel matchId="match-a" record={{...record,trace_hash:'new-hash'}} timeMs={1800000}/></LanguageProvider>);
  expect(screen.queryByTestId('statistics-result')).not.toBeInTheDocument();
});

it('distinguishes measured historical zero from missing data and shows covered exposure',()=>{
  const history={value:0,unit:'xG',source:'fpl:match_observations',status:'measured',definition_version:'historical-advanced-1',covered_minutes:180,fixtures_covered:2,fixtures_total:3};
  const team={name:'Example',source:'fpl',players:[{key:'player-1',name:'Historical example',role:'MID',quality_flags:[],stats:{},advanced_stats:{xg:history}}]} as unknown as TeamSeason;
  render(<LanguageProvider><Roster team={team}/></LanguageProvider>);
  fireEvent.click(screen.getByText('Advanced historical statistics'));
  expect(screen.getByText('0')).toHaveAttribute('title','Measured');
  expect(screen.getByText('180 min')).toBeInTheDocument();
  expect(screen.getByText(/2\/3 fixtures/)).toBeInTheDocument();
  expect(screen.getAllByTitle('Unavailable').length).toBeGreaterThan(0);
});

it('keeps the xG curve explicitly team scoped when a player is selected',()=>{
  const players=[{key:'a',name:'First shooter'},{key:'b',name:'Selected shooter'}] as unknown as RenderFrame['players'];
  render(<LanguageProvider><StatisticsPlots plots={{xg:[
    {kind:'xg',time_ms:1000,side:'home',player_key:'a',value:.3},
    {kind:'xg',time_ms:2000,side:'home',player_key:'b',value:.5},
  ]}} endMs={3000} home="Home" away="Away" players={players} playerKey="b"/></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('Chart view'),{target:{value:'xg'}});
  expect(screen.getByText('Team totals across all shooters; individual totals are in the metric table.')).toBeVisible();
  fireEvent.click(screen.getByText(/Show chart data/));
  expect(screen.getByRole('columnheader',{name:'Team cumulative xG'})).toBeVisible();
  expect(screen.getByText('First shooter')).toBeVisible();
  expect(screen.getByText('Selected shooter')).toBeVisible();
  expect(screen.getByText('0.3 xG')).toBeVisible();
  expect(screen.getByText('0.5 xG')).toBeVisible();
});

it('shows the recorded incoming pass link for a selected receiver and opens its evidence',()=>{
  const inspect=vi.fn();
  const players=[{key:'a',name:'First passer',side:'home'},{key:'b',name:'Selected receiver',side:'home'}] as unknown as RenderFrame['players'];
  render(<LanguageProvider><StatisticsPlots plots={{pass_edges:[
    {kind:'pass_edge',time_ms:1000,side:'home',player_key:'a',related_player_key:'b',event_id:'pass-1',value:1},
  ]}} endMs={3000} home="Home" away="Away" players={players} playerKey="b" onInspect={inspect}/></LanguageProvider>);
  expect(screen.getByRole('option',{name:'Completed pass links'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Chart view'),{target:{value:'passes'}});
  expect(screen.getByRole('img',{name:'Completed pass links'})).toBeVisible();
  fireEvent.keyDown(screen.getByRole('button',{name:/Inspect event pass-1/}),{key:'Enter'});
  expect(inspect).toHaveBeenCalledWith('pass-1');
  fireEvent.click(screen.getByText(/Show chart data/));
  expect(screen.getByRole('columnheader',{name:'Receiver'})).toBeVisible();
  expect(screen.getByText('First passer')).toBeVisible();
  expect(screen.getByText('Selected receiver')).toBeVisible();
});
