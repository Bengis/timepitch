import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {getGrfStatistics} from '../api';
import {LanguageProvider,LanguageSelector} from '../i18n';
import {GrfMatchView} from './GrfMatchView';
import {fullFixture} from './test-fixtures';
import {modernGrf} from '../match-centre/adapters/test-fixtures';
import type {GrfReplay} from '../api';
import {summaryFixture} from './statistics/test-fixtures';
vi.mock('../api',async()=>({...await vi.importActual('../api'),getGrfStatistics:vi.fn()}));
vi.mock('../match/Pitch',()=>({Pitch:()=> <div role="img" aria-label="Pitch fixture"/>}));
beforeEach(()=>{localStorage.clear();vi.mocked(getGrfStatistics).mockReset();vi.mocked(getGrfStatistics).mockResolvedValue(summaryFixture());});afterEach(cleanup);
const tab=(name:string)=>screen.getByRole('tab',{name});
function open(record:GrfReplay=fullFixture()){return render(<LanguageProvider><LanguageSelector/><GrfMatchView id="tabs" record={record} onBack={()=>{}}/></LanguageProvider>);}
// TP226: GRF usa el armazón de emisión (Emisión/Ficha/Alineaciones + Análisis); «Mostrar análisis final» está en la emisión y en Análisis.
it('uses the broadcast shell tabs and keeps final results behind an explicit reveal',async()=>{
  open();expect(screen.getAllByRole('tab')).toHaveLength(6);expect(tab('Live broadcast')).toHaveAttribute('aria-selected','true');
  fireEvent.change(screen.getByRole('slider'),{target:{value:'100'}});await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('100'));
  fireEvent.click(tab('Line-ups'));expect(getGrfStatistics).not.toHaveBeenCalled();fireEvent.click(tab('Summary'));fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));
  await waitFor(()=>expect(getGrfStatistics).toHaveBeenCalledTimes(1));fireEvent.click(tab('Line-ups'));await screen.findAllByText('pass_received');expect(tab('Line-ups')).toHaveAttribute('aria-selected','true');
  fireEvent.click(tab('Live broadcast'));expect(screen.getByRole('img',{name:'Pitch fixture'})).toBeVisible();expect(screen.getByRole('slider')).toHaveValue('100');
});
it('retains all team and player passing/defending metrics with honest missing effort',async()=>{
  const data=summaryFixture();for(const key of ['own_goals','own_goals_for','unattributed_goals'])data.by_team.home[key]={...data.by_team.home.goals,value:2,definition_id:key};vi.mocked(getGrfStatistics).mockResolvedValue(data);
  open();fireEvent.click(tab('Summary'));fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));await screen.findAllByText('unattributed_goals');
  expect(screen.getAllByText('own_goals_for').length).toBeGreaterThan(0);fireEvent.click(tab('Line-ups'));await screen.findAllByText('pass_unresolved');expect(screen.getAllByText('fouls').length).toBeGreaterThan(0);expect(screen.getAllByText('offsides').length).toBeGreaterThan(0);
  fireEvent.click(tab('Effort'));await screen.findAllByText(/compressed_clock_is_not_full_match_tracking/);expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
});
it('preserves filter controls through language and cutoff updates and reuses final reads across tabs',async()=>{
  const view=open();fireEvent.click(tab('Maps'));fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));await screen.findByText('Shot map',{selector:'h3'});
  const map=view.container.querySelector('[data-plot-id=shots]') as HTMLElement;const filter=within(map).getByLabelText('Filter map rows');fireEvent.change(filter,{target:{value:'home'}});filter.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));expect(within(map).getByLabelText('Filtrar filas del mapa')).toHaveValue('home');expect(filter).toHaveFocus();
  fireEvent.click(tab('Alineaciones'));fireEvent.click(tab('Resumen'));expect(getGrfStatistics).toHaveBeenCalledTimes(1);
});
it('supports keyboard tabs and inspection without forced tab switches',async()=>{
  open(modernGrf());tab('Live broadcast').focus();fireEvent.keyDown(tab('Live broadcast'),{key:'End'});expect(tab('Effort')).toHaveFocus();fireEvent.keyDown(tab('Effort'),{key:'Home'});expect(tab('Live broadcast')).toHaveFocus();
  fireEvent.change(screen.getByRole('slider'),{target:{value:'300'}});await screen.findAllByText('Full match');expect(tab('Live broadcast')).toHaveAttribute('aria-selected','true');
  const buttons=screen.getAllByRole('button').filter(b=>b.textContent?.startsWith('goal ·'));fireEvent.click(buttons[0]);expect(screen.getByRole('button',{name:'Watch event'})).toBeEnabled();
});
it('keeps loading and failure visible while retaining the selected tab and source metadata',async()=>{
  let reject!:(error:Error)=>void;vi.mocked(getGrfStatistics).mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
  open();fireEvent.click(screen.getByText('Technical details'));await screen.findByRole('heading',{name:'input'});fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));await waitFor(()=>expect(getGrfStatistics).toHaveBeenCalled());
  reject(new Error('Offline'));await screen.findByRole('alert');expect(tab('Live broadcast')).toHaveAttribute('aria-selected','true');expect(screen.getByRole('heading',{name:'input'})).toBeVisible();expect(screen.getByRole('button',{name:'Retry data read'})).toBeEnabled();
});
it('keeps full-time keyboard focus on the mounted playback control without forcing Summary',async()=>{
  open();const slider=screen.getByRole('slider');slider.focus();fireEvent.change(slider,{target:{value:'300'}});await screen.findAllByText('Full match');expect(slider).toHaveFocus();expect(tab('Live broadcast')).toHaveAttribute('aria-selected','true');
});