import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {getGrfStatistics,getTeam} from '../api';
import {GrfStatisticsPanel} from '../grf/statistics/GrfStatisticsPanel';
import {summaryFixture} from '../grf/statistics/test-fixtures';
import {fullFixture} from '../grf/test-fixtures';
import {MatchExtras} from './MatchExtras';
import {grfExtras} from './extras-model';

vi.mock('../api',()=>({getGrfStatistics:vi.fn(),getTeam:vi.fn()}));
beforeEach(()=>{localStorage.clear();vi.mocked(getTeam).mockReset();vi.mocked(getTeam).mockRejectedValue(new Error('Offline'));});
afterEach(cleanup);
function setup(){
  const data=summaryFixture();
  // Deliberately retain ties: never award an arbitrary winner from array order.
  data.passes=[{seq:7,side:'home',actor_id:data.players[1].id,receiver_id:data.players[2].id,kind:'short_pass',outcome:'received',match_time_ms:1200,playback_ms:100,phase:1,x:20,y:30,end_x:40,end_y:35,event_refs:[7,8]}];
  vi.mocked(getGrfStatistics).mockResolvedValue(data);
  const onSeek=vi.fn();
  render(<LanguageProvider><GrfStatisticsPanel id="extras" traceHash="fixture" view="summary" onSeek={onSeek} record={fullFixture()}/></LanguageProvider>);
  return {data,onSeek};
}
it('shows tied recorded performances with an explicit criterion and no invented MVP',async()=>{
  setup();const highlights=await screen.findByRole('region',{name:'Standout performances'});
  expect(within(highlights).getAllByText(/Shared lead/)).toHaveLength(2);
  expect(within(highlights).queryByText(/MVP/)).not.toBeInTheDocument();
  expect(within(highlights).getByText(/Highest recorded count/)).toBeVisible();
});
it('opens a recorded pass detail and seeks only when Watch moment is pressed',async()=>{
  const {onSeek}=setup();
  fireEvent.change(await screen.findByLabelText('Event type'),{target:{value:'pass'}});
  fireEvent.click(screen.getByRole('button',{name:/Inspect Pass/}));
  const detail=screen.getByRole('region',{name:'Recorded action'});
  expect(within(detail).getByText('Confirmed receipt')).toBeVisible();
  expect(within(detail).getByRole('img',{name:/Recorded endpoints/})).toBeVisible();
  expect(onSeek).not.toHaveBeenCalled();
  fireEvent.click(within(detail).getByRole('button',{name:'Watch moment'}));
  expect(onSeek).toHaveBeenCalledWith(100);
});
it('opens an accessible player card, keeps missing history distinct and closes with Escape',async()=>{
  setup();await screen.findByRole('region',{name:'Standout performances'});
  fireEvent.click(screen.getAllByRole('button',{name:'Player card: Scorer'})[0]);
  const dialog=screen.getByRole('dialog',{name:'Scorer'});
  expect(within(dialog).getByText('Simulated performance')).toBeVisible();
  expect(within(dialog).getByText(/Estimated engine attributes/)).toBeVisible();
  expect(await within(dialog).findByText('Historical data unavailable')).toBeVisible();
  fireEvent.keyDown(dialog,{key:'Escape'});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([['off_target','Fuera de portería'],['incomplete','Incompleto'],['held','Retenido']])('translates the recorded %s outcome without exposing raw codes',async(outcome,label)=>{
  localStorage.setItem('timepitch.locale','es');
  const model=grfExtras(summaryFixture());model.actions=[{id:'one',type:'shot',side:'home',time:100,seek:100,players:[],outcome,evidence:{},refs:['one']}];
  render(<LanguageProvider><MatchExtras model={model} onSeek={()=>{}} datasetVersion="fixture"/></LanguageProvider>);
  fireEvent.click(screen.getByRole('button',{name:/Inspeccionar Tiro/}));
  expect(screen.getByText(label,{exact:true})).toBeVisible();
});
