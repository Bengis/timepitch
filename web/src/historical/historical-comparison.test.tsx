import {beforeEach,expect,it,vi} from 'vitest';
import {act,render,screen,within} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {HistoricalComparison,HistoricalComparisonPanel} from './HistoricalComparison';
import {getMatches,getGrfMatches} from '../api';
import {writeComparisonLink} from './matchup';
vi.mock('../api',async()=>({...await vi.importActual('../api'),getMatches:vi.fn(),getGrfMatches:vi.fn()}));
import {readComparison,type ComparisonResult} from './api';
vi.mock('./api',async()=>({...await vi.importActual('./api'),readComparison:vi.fn()}));
import {comparisonFixture as fixture} from './test-fixtures';

beforeEach(()=>{sessionStorage.clear();vi.mocked(readComparison).mockReset();vi.mocked(getMatches).mockReset().mockResolvedValue([]);vi.mocked(getGrfMatches).mockReset().mockResolvedValue([]);});
it('shows variant definitions and no common delta for incompatible xG',async()=>{
  vi.mocked(readComparison).mockResolvedValue(fixture());
  render(<LanguageProvider><HistoricalComparison historicalMatchId={9} datasetVersion="h1" engine="timepitch" simulationId="saved"/></LanguageProvider>);
  const table=await screen.findByRole('table',{name:'Expected goals'});
  expect(within(table).queryByText('Simulation − recorded')).not.toBeInTheDocument();
  expect(screen.getByText('Different definitions')).toBeVisible();
  expect(screen.getByText(/statsbomb-shot-xg/)).toBeInTheDocument();
  expect(screen.getByText(/timepitch-generative-xg/)).toBeInTheDocument();
});
it('refreshes owned choices when a requested simulation completes while the panel stays mounted',async()=>{
  const job={id:'newly-ready',state:'ready',config:{home_key:'chelsea:2015',away_key:'arsenal:2015',seed:42},summary:null} as Awaited<ReturnType<typeof getMatches>>[number];
  vi.mocked(getMatches).mockResolvedValueOnce([]).mockResolvedValue([job]);
  vi.mocked(readComparison).mockResolvedValue({...fixture(),simulation_id:'newly-ready'});
  render(<LanguageProvider><HistoricalComparisonPanel historicalMatchId={9} datasetVersion="h1"/></LanguageProvider>);
  await screen.findByText(/No saved simulations/);
  act(()=>writeComparisonLink({historicalMatchId:9,engine:'timepitch',simulationId:'newly-ready'}));
  expect(await screen.findByRole('option',{name:/TimePitch.*chelsea:2015/})).toBeInTheDocument();
});
it('discards a response for an earlier selected saved replay',async()=>{
  let resolve!:(value:ComparisonResult)=>void;
  vi.mocked(readComparison).mockReturnValueOnce(new Promise(r=>resolve=r)).mockRejectedValue(new Error('Fixture unavailable'));
  const view=render(<LanguageProvider><HistoricalComparison historicalMatchId={9} datasetVersion="h1" engine="timepitch" simulationId="saved"/></LanguageProvider>);
  view.rerender(<LanguageProvider><HistoricalComparison historicalMatchId={9} datasetVersion="h1" engine="grf" simulationId="other"/></LanguageProvider>);
  resolve(fixture());
  expect(await screen.findByRole('alert')).toHaveTextContent('Comparison unavailable');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it.each(['timepitch','grf'] as const)('preserves the %s owned choices when the other history fails',async engine=>{
  const job={id:'available',state:'ready',config:{home_key:'chelsea:2015',away_key:'arsenal:2015',seed:42},summary:null} as Omit<Awaited<ReturnType<typeof getMatches>>[number],'summary'>&{summary:null};
  vi.mocked(engine==='timepitch'?getMatches:getGrfMatches).mockResolvedValue([job]);
  vi.mocked(engine==='timepitch'?getGrfMatches:getMatches).mockRejectedValue(new Error('One history unavailable'));
  render(<LanguageProvider><HistoricalComparisonPanel historicalMatchId={9} datasetVersion="h1"/></LanguageProvider>);
  expect(await screen.findByRole('option',{name:new RegExp(`${engine==='grf'?'GRF':'TimePitch'}.*chelsea:2015`)})).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('One simulation history is unavailable');
});
it('explains that native GRF shot animations can include clearances',async()=>{
  const value=fixture();value.engine='grf';value.rows=[{metric:'shots',historical:{home:4,away:3,definition:'statsbomb-shot-events'},simulated:{home:4,away:3,definition:'grf-native-shot-actions'},status:'different_definition',delta:null,reason:'different_definition'}];
  vi.mocked(readComparison).mockResolvedValue(value);
  render(<LanguageProvider><HistoricalComparison historicalMatchId={9} datasetVersion="h1" engine="grf" simulationId="saved"/></LanguageProvider>);
  expect(await screen.findByText(/GRF counts native shot animations/)).toBeVisible();
  expect(screen.queryByText('Simulation − recorded')).not.toBeInTheDocument();
});
