import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {getGrfStatistics} from '../api';
import {LanguageProvider} from '../i18n';
import {GrfStatisticsPanel} from './statistics/GrfStatisticsPanel';
import {summaryFixture} from './statistics/test-fixtures';
import {GrfMatchView} from './GrfMatchView';
import {fullFixture} from './test-fixtures';

vi.mock('../api',async()=>({...await vi.importActual('../api'),getGrfStatistics:vi.fn()}));
vi.mock('../match/Pitch',()=>({Pitch:()=> <div role="img" aria-label="Pitch fixture"/>}));
beforeEach(()=>{localStorage.clear();vi.mocked(getGrfStatistics).mockReset();vi.mocked(getGrfStatistics).mockResolvedValue(summaryFixture());});
afterEach(cleanup);

it('prioritises the summary and keeps every additional metric behind a readable disclosure',async()=>{
  render(<LanguageProvider><GrfStatisticsPanel id="one" traceHash="fixture" onSeek={()=>{}}/></LanguageProvider>);
  const main=await screen.findByRole('table',{name:'Team comparison'});
  expect(within(main).getAllByRole('row')).toHaveLength(7);
  expect(screen.getByRole('rowheader',{name:'Goals with unresolved author',hidden:true})).not.toBeVisible();
  fireEvent.click(screen.getByText('Additional team statistics',{selector:'summary'}));
  expect(screen.getByRole('rowheader',{name:'Goals with unresolved author'})).toBeVisible();
});

it('keeps player metrics attributed to the selected team and exposes mobile details',async()=>{
  render(<LanguageProvider><GrfStatisticsPanel id="one" traceHash="fixture" onSeek={()=>{}} view="players"/></LanguageProvider>);
  const table=await screen.findByRole('table',{name:'Player statistics'});
  expect(within(table).getAllByRole('rowheader')).toHaveLength(11);
  fireEvent.click(screen.getByRole('button',{name:'Away club'}));
  expect(within(table).getAllByRole('rowheader')).toHaveLength(11);
  fireEvent.click(screen.getByRole('button',{name:'Passing'}));
  expect(within(table).getByRole('columnheader',{name:'Unresolved passes'})).toBeInTheDocument();
  const expand=screen.getAllByRole('button',{name:/More statistics for/})[0];
  fireEvent.click(expand);
  expect(expand).toHaveAttribute('aria-expanded','true');
  expect(within(within(table).getByText('Interrupted passes',{selector:'dt'}).parentElement!).getByRole('definition')).toHaveTextContent('Not available');
});

it('pauses a hidden match and resumes the same cursor without recreating the replay',async()=>{
  const props={id:'one',record:fullFixture(),onBack:()=>{}};
  const view=render(<LanguageProvider><GrfMatchView {...props} visible/></LanguageProvider>);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'100'}});
  await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('100'));
  fireEvent.click(screen.getByRole('button',{name:'Play'}));
  view.rerender(<LanguageProvider><GrfMatchView {...props} visible={false}/></LanguageProvider>);
  expect(screen.queryByRole('button',{name:'Play'})).not.toBeInTheDocument();
  const position=(view.container.querySelector('input[type=range]') as HTMLInputElement).value;
  view.rerender(<LanguageProvider><GrfMatchView {...props} visible/></LanguageProvider>);
  expect(screen.getByRole('slider')).toHaveValue(position);
  expect(screen.getByRole('button',{name:'Play'})).toBeVisible();
});
