import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {GrfMatchView} from './GrfMatchView';
import {fullFixture,legacyFixture} from './test-fixtures';
import {summaryFixture} from './statistics/test-fixtures';
vi.mock('../api',async()=>({...await vi.importActual('../api'),getGrfStatistics:vi.fn(()=>Promise.resolve(summaryFixture()))}));
vi.mock('../match/Pitch',()=>({Pitch:({frame,displayClockLabel}:{frame:{clock_ms:number};displayClockLabel?:string})=><div data-testid="pitch" data-animation-time={frame.clock_ms} data-display-time={displayClockLabel}/> }));
beforeEach(()=>localStorage.clear());afterEach(cleanup);
it('shows native halves and full time, keeps the playback clock separate and replays from kickoff',async()=>{
  render(<LanguageProvider><GrfMatchView id="full" record={fullFixture()} onBack={()=>{}}/></LanguageProvider>);
  expect(screen.getByRole('button',{name:'Play'})).toBeEnabled();const slider=screen.getByRole('slider');fireEvent.change(slider,{target:{value:'200'}});
  await waitFor(()=>expect(screen.getByTestId('pitch')).toHaveAttribute('data-animation-time','200'));expect(screen.getByTestId('pitch')).toHaveAttribute('data-display-time','45:01');
  expect(screen.getByRole('combobox',{name:'Phase'})).toHaveValue('2');fireEvent.change(slider,{target:{value:'300'}});
  await screen.findByText('Final analysis revealed');expect(screen.getByTestId('pitch')).toHaveAttribute('data-display-time','90:14');expect(screen.getByRole('tab',{name:'Live broadcast'})).toHaveAttribute('aria-selected','true');
  fireEvent.click(screen.getByRole('button',{name:'Replay'}));await waitFor(()=>expect(slider).toHaveValue('0'));expect(screen.getByRole('combobox',{name:'Phase'})).toHaveValue('1');
});
it('labels an old episode without inventing halves or a full-match clock',async()=>{
  render(<LanguageProvider><GrfMatchView id="legacy" record={legacyFixture()} onBack={()=>{}}/></LanguageProvider>);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'200'}});await screen.findByText('Final analysis revealed');
  expect(screen.getByTestId('pitch')).toHaveAttribute('data-display-time','—');expect(screen.getByRole('combobox',{name:'Phase'}).children).toHaveLength(1);expect(screen.queryByText('90:00')).not.toBeInTheDocument();
});