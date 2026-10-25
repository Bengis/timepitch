import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {LanguageProvider,LanguageSelector} from '../i18n';
import {HistoricalMatchCentre} from './HistoricalMatchCentre';
import * as api from './api';
import {statisticsFixture} from './test-fixtures';
import {sourceReaders} from '../match-centre/adapters/test-fixtures';
vi.mock('./api',async()=>({...await vi.importActual('./api'),readCapabilities:vi.fn(),readMatch:vi.fn(),readManifest:vi.fn(),readStatistics:vi.fn(),readEvents:vi.fn(),readSegment:vi.fn()}));
beforeEach(()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const f=sourceReaders();
  vi.mocked(api.readCapabilities).mockImplementation(f.readers.capabilities);
  vi.mocked(api.readMatch).mockImplementation(f.readers.match);vi.mocked(api.readManifest).mockImplementation(f.readers.manifest);
  vi.mocked(api.readStatistics).mockImplementation(f.readers.statistics);vi.mocked(api.readEvents).mockImplementation(f.readers.events);vi.mocked(api.readSegment).mockImplementation(f.readers.segment);
});
afterEach(()=>vi.restoreAllMocks());
function mount(){return render(<LanguageProvider><LanguageSelector/><HistoricalMatchCentre matchId={9} datasetVersion="v1" visible onNavigate={vi.fn()}/></LanguageProvider>);}
const ready=()=>screen.findByText('Home historical club',{selector:'.tp-sb-full'});
const score=()=>document.querySelector('[data-unified-scoreboard] .tp-sb-digits') as HTMLElement;
it('places the primary playback action before the field and toggles it accessibly',async()=>{
  const view=mount();await ready();const play=screen.getByRole('button',{name:'Play'}),pitch=view.container.querySelector('canvas')!;
  expect(play.compareDocumentPosition(pitch)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(play).toHaveClass('unified-play');
  fireEvent.click(play);expect(screen.getByRole('button',{name:'Pause'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
  expect(screen.getByRole('button',{name:'Reproducir'})).toBeEnabled();
});
it('keeps the notice on every tab and language, final score requires explicit reveal',async()=>{
  mount();await ready();await waitFor(()=>expect(score()).toHaveTextContent('0–0'));
  expect(screen.queryByText('Final result: 2 : 0')).not.toBeInTheDocument();
  for(const name of ['Players','Maps','Effort','Data','Summary']){fireEvent.click(screen.getByRole('tab',{name}));expect(screen.getByRole('note')).toHaveTextContent('synthetic tracking');}
  fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));expect(await screen.findByText(/Final result: 2 : 0/)).toBeVisible();expect(score()).toHaveTextContent('0–0');
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));expect(screen.getByRole('note')).toHaveTextContent('tracking sintético');
});
it('does not display a late match after identity changes',async()=>{
  let resolve!:(value:api.HistoricalMatch)=>void;const f=sourceReaders();vi.mocked(api.readMatch).mockReturnValueOnce(new Promise(r=>resolve=r));
  const view=mount();await waitFor(()=>expect(api.readMatch).toHaveBeenCalled());
  view.rerender(<LanguageProvider><HistoricalMatchCentre matchId={10} datasetVersion="v1" visible onNavigate={vi.fn()}/></LanguageProvider>);
  resolve(f.match);await screen.findByRole('alert');expect(screen.queryByText('Home historical club',{selector:'.tp-sb-full'})).not.toBeInTheDocument();
});
it('keeps facts usable if motion is unavailable and tabs have keyboard navigation',async()=>{
  vi.mocked(api.readManifest).mockRejectedValue(new Error('Offline motion'));mount();await ready();
  expect(await screen.findByText(/Movement is unavailable/)).toBeVisible();const first=screen.getByRole('tab',{name:'Match'});
  fireEvent.keyDown(first,{key:'ArrowRight'});expect(screen.getByRole('tab',{name:'Summary'})).toHaveFocus();
});
it('filters a prefetched future goal out of the cursor score',async()=>{
  vi.mocked(api.readStatistics).mockImplementation(async(_id,period,ms)=>({...statisticsFixture(ms),cutoff:{period,period_ms:ms},score:{home:1,away:0},goals:[{at:{period:1,period_ms:30000},team_key:'statsbomb:1',kind:'regular',player_key:'statsbomb:10',own_goal_player_key:null,event_ids:['goal']}]}));
  mount();await ready();await waitFor(()=>expect(score()).toHaveTextContent('0–0'));fireEvent.change(screen.getByRole('slider'),{target:{value:'35000'}});await waitFor(()=>expect(score()).toHaveTextContent('1–0'));
});
it('does not claim an unknown player is off the pitch or has played zero minutes',async()=>{
  mount();await ready();fireEvent.click(screen.getByRole('tab',{name:'Players'}));const row=await within(screen.getByRole('table',{name:'Players'})).findByRole('row',{name:/Recorded player/});
  expect(within(row).queryByText('Not on pitch at this cutoff')).not.toBeInTheDocument();expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  const metricRows=screen.getAllByRole('row').filter(row=>row.textContent?.includes('played_ms'));for(const metric of metricRows)expect(metric.textContent).toContain('Unavailable');
});
it('hides loading and failure states when its historical workspace is not visible',async()=>{
  vi.mocked(api.readMatch).mockClear();vi.mocked(api.readMatch).mockRejectedValue(new Error('Historical failure'));
  const view=render(<LanguageProvider><HistoricalMatchCentre matchId={9} datasetVersion="v1" visible={false} onNavigate={vi.fn()}/></LanguageProvider>);
  expect(api.readMatch).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.rerender(<LanguageProvider><HistoricalMatchCentre matchId={9} datasetVersion="v1" visible onNavigate={vi.fn()}/></LanguageProvider>);await screen.findByRole('alert');
  view.rerender(<LanguageProvider><HistoricalMatchCentre matchId={9} datasetVersion="v1" visible={false} onNavigate={vi.fn()}/></LanguageProvider>);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('keeps analysis controls and focus mounted while the requested cutoff changes',async()=>{
  vi.mocked(api.readStatistics).mockImplementation(async(_id,period,ms)=>({...statisticsFixture(ms),cutoff:{period,period_ms:ms},action_map:Array.from({length:70},(_,i)=>({event_id:`pass-${i}`,type:'Pass',team_key:'statsbomb:1',player_key:'statsbomb:10',location:{x:10,y:20},end_location:null,provenance:'derived_from_events' as const}))}));
  const view=mount();await ready();fireEvent.click(screen.getByRole('tab',{name:'Maps'}));const map=await waitFor(()=>{const element=view.container.querySelector('[data-plot-id=action_map]');expect(element).not.toBeNull();return element as HTMLElement;});
  const filter=within(map).getByLabelText('Filter map rows');fireEvent.change(filter,{target:{value:'Pass'}});fireEvent.click(within(map).getByRole('button',{name:'Next'}));filter.focus();
  fireEvent.change(screen.getByRole('slider'),{target:{value:'5000'}});expect(filter).toHaveFocus();await waitFor(()=>expect(view.container.querySelector('.unified-scope')).toHaveTextContent('0:05'));expect(filter).toHaveValue('Pass');expect(within(map).getByText(/Page 2\/2/)).toBeVisible();
});
it('labels live statistics with their five-second cutoff rather than the advancing replay clock',async()=>{
  const view=mount();await ready();fireEvent.click(screen.getByRole('tab',{name:'Summary'}));fireEvent.change(screen.getByRole('slider'),{target:{value:'14000'}});await waitFor(()=>expect(view.container.querySelector('.unified-scope')).toHaveTextContent('0:14'));fireEvent.click(screen.getByRole('button',{name:'Play'}));await waitFor(()=>expect(view.container.querySelector('.unified-scope')).toHaveTextContent('0:10'));
});
it('does not reuse an earlier statistics score when the cursor goal timeline is unavailable',async()=>{
  vi.mocked(api.readStatistics).mockImplementation(async(_id,period,ms)=>{if(ms===59999)throw new Error('Missing goal timeline');return {...statisticsFixture(ms),cutoff:{period,period_ms:ms}};});
  mount();await ready();fireEvent.change(screen.getByRole('slider'),{target:{value:'14000'}});await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('14000'));fireEvent.click(screen.getByRole('button',{name:'Play'}));expect(score()).toHaveTextContent('—–—');
});