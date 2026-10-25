import {act,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {MatchCentre} from './MatchCentre';
import {MatchMaps} from './MatchMaps';
import {MatchPlayers} from './MatchPlayers';
import {normalizeGrfMetrics,normalizeTimePitchMetrics} from './adapters/metrics';
import {modernGrf,bundle,spatialRecord,legacyRecord} from './adapters/test-fixtures';
import {summaryFixture} from '../grf/statistics/test-fixtures';
import {screenFixture} from './unified-screen-fixtures';
import {createTimePitchSession} from './adapters/timepitch';
import {resolveCrest} from '../catalog/crest-resolver';

it('keeps scoped GRF pass geometry and endpoint player filters across both phases',()=>{
 const stats=summaryFixture();stats.pass_edges.push({...stats.pass_edges[0],phase:2});stats.positions.push(...stats.positions.map(p=>({...p,phase:2 as const,x:p.x+1})));
 const plot=normalizeGrfMetrics(modernGrf(),stats).plots.find(p=>p.id==='pass_edges')!;
 const {container,rerender}=render(<MatchMaps plots={[plot]} onSeek={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Map phase'),{target:{value:'1'}});
 expect(container.querySelectorAll('svg line')).toHaveLength(1);expect(container.querySelector('svg line')).toHaveAttribute('x1',String(stats.positions[2].x));
 expect(within(screen.getByLabelText('Map player')).getByRole('option',{name:stats.pass_edges[0].source_id})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Map player'),{target:{value:stats.pass_edges[0].source_id}});expect(container.querySelectorAll('svg line')).toHaveLength(1);
 fireEvent.change(screen.getByLabelText('Map phase'),{target:{value:'2'}});expect(container.querySelector('svg line')).toHaveAttribute('x1',String(stats.positions[2].x+1));
 const missing=normalizeGrfMetrics(modernGrf(),{...stats,positions:stats.positions.filter(p=>p.phase===1)}).plots.find(p=>p.id==='pass_edges')!;rerender(<MatchMaps plots={[missing]} onSeek={()=>{}}/>);expect(container.querySelector('svg line')).not.toBeInTheDocument();expect(container.querySelector('svg circle')).not.toBeInTheDocument();
});
it('preserves weighted occupancy cells and isolates teams',()=>{
 const stats=bundle();stats.plots!.occupancy_in_possession=[{kind:'occupancy',side:'home',time_ms:1000,value:2,x:4.375,y:4.25},{kind:'occupancy',side:'away',time_ms:1000,value:50,x:4.375,y:4.25}];
 const plot=normalizeTimePitchMetrics(spatialRecord(),stats,1000).plots[0];expect(plot.cells).toEqual(expect.arrayContaining([expect.objectContaining({x:0,y:0,width:8.75,height:8.5,value:2})]));
 const {container,rerender}=render(<MatchMaps plots={[{...plot,rows:[],cells:[]}]} onSeek={()=>{}}/>);rerender(<MatchMaps plots={[plot]} onSeek={()=>{}}/>);expect(container.querySelectorAll('svg rect[opacity]')).toHaveLength(1);expect(container.querySelector('svg rect[opacity] title')).toHaveTextContent('2');
 fireEvent.change(screen.getByLabelText('Map team'),{target:{value:'away'}});expect(container.querySelectorAll('svg rect[opacity]')).toHaveLength(1);expect(container.querySelector('svg rect[opacity] title')).toHaveTextContent('50');
});
it('map watch uses elapsed TimePitch time, pauses and returns to the visible field',async()=>{
 const f=screenFixture('timepitch'),stats=bundle();stats.plots!.shots=[{kind:'shot',side:'home',time_ms:500,value:.1,x:90,y:34,event_id:'shot'}];f.initial.panels.maps={...f.panel,plots:normalizeTimePitchMetrics(spatialRecord(),stats,1000).plots};
 render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} initialSection="maps"/>);fireEvent.click(screen.getByRole('button',{name:'Play'}));const watch=screen.getByRole('button',{name:'Watch event'});expect(watch).toBeEnabled();fireEvent.click(watch);
 await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('500'));expect(screen.getByRole('tab',{name:'Live broadcast'})).toHaveAttribute('aria-selected','true');// TP226: armazón de emisiónexpect(screen.getByRole('button',{name:'Play'})).toBeVisible();expect(screen.getByRole('heading',{name:'Events'})).toHaveFocus();
});
it('combines static loaded catalogue details with the current safe player metrics from Match',async()=>{
 const f=screenFixture('timepitch');f.adapter.loadPlayer=vi.fn(async()=>{const p=f.panel.players[0],m={...p.metrics[0],id:'historical:goals',value:12};f.publish({...f.adapter.snapshot(),panels:{...f.initial.panels,players:{...f.panel,scope:'final',cutoff:{elapsedMs:10000,period:2,periodMs:5000},playerDetails:[{...p,metrics:[...p.metrics,m],details:{catalog:{source:'fixture'}}}]}}});});
 render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}}/>);fireEvent.change(screen.getByLabelText('Inspect player'),{target:{value:'test:home:1'}});
 expect(await within(screen.getByRole('dialog')).findByText('historical:goals')).toBeInTheDocument();expect(within(screen.getByRole('dialog')).getByText('12 count')).toBeInTheDocument();
});
it('can return from revealed final analysis to the cursor without leaking the final panel',async()=>{
 const f=screenFixture('historical');render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}} initialSection="summary"/>);fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));
 fireEvent.change(screen.getByLabelText('Analysis scope'),{target:{value:'cursor'}});await waitFor(()=>expect(f.adapter.loadPanel).toHaveBeenLastCalledWith('summary',0,false,expect.any(AbortSignal),expect.any(Object)));
});
it('resolved GRF final actions retain receiver, route, outcome and seek in the common explorer',async()=>{
 const f=screenFixture('grf'),stats=summaryFixture(),actor=stats.players[1].id,receiver=stats.players[2].id;
 stats.passes=[{seq:10,side:'home',actor_id:actor,receiver_id:receiver,kind:'short_pass',outcome:'received',x:10,y:20,end_x:30,end_y:40,match_time_ms:3000,playback_ms:500,phase:1,event_refs:[10,11]} as typeof stats.passes[number]];
 f.initial.panels.match=normalizeGrfMetrics(modernGrf(),stats);render(<MatchCentre adapter={f.adapter} visible onBack={()=>{}}/>);expect(screen.queryByLabelText('Event set')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));
 fireEvent.change(screen.getByLabelText('Event set'),{target:{value:'resolved'}});fireEvent.click(screen.getByRole('button',{name:/pass · Phase 1/}));const detail=screen.getByRole('article',{name:'Details'});
 expect(within(detail).getByRole('button',{name:stats.players[2].name})).toBeInTheDocument();expect(within(detail).getByRole('img',{name:/10, 20.*30, 40/})).toBeInTheDocument();expect(detail).toHaveTextContent('received');expect(detail).toHaveTextContent('11');fireEvent.click(within(detail).getByRole('button',{name:'Watch event'}));await waitFor(()=>expect(screen.getByRole('slider')).toHaveValue('500'));
 fireEvent.change(screen.getByLabelText('Event set'),{target:{value:'source'}});await act(async()=>{});expect(screen.getByLabelText('Event set')).toHaveValue('source');
});
it('player filters also filter metric subjects',()=>{
 const f=screenFixture(),home=f.panel.players[0],away={...home,id:'away:1',side:'away' as const,name:'Away player',metrics:[{...home.metrics[0],id:'away-only'}]};
 render(<MatchPlayers players={[home,away]} onSelect={()=>{}}/>);fireEvent.change(screen.getByRole('combobox',{name:'Team'}),{target:{value:'home'}});expect(screen.queryByText('away-only')).not.toBeInTheDocument();
});
it('known simulation team seasons retain verified crest and formation metadata',()=>{
 const record=legacyRecord();record.config.home_key='arsenal:2003';const session=createTimePitchSession('known',record);expect(session.snapshot().descriptor.home.crestUrl).toBe('/assets/crests/arsenal-2002.gif');
 render(<MatchCentre adapter={session} visible onBack={()=>{}}/>);
 // G17: el marcador de emisión usa el escudo resuelto (HD revisado → HFK); el de la fuente solo si no hay ninguno.
 const crest=resolveCrest('arsenal:2003');expect(document.querySelector('[data-unified-scoreboard] img')).toHaveAttribute('src',crest.kind==='none'?'/assets/crests/arsenal-2002.gif':crest.src);expect(document.querySelector('[data-unified-scoreboard]')).toHaveTextContent('2003/04 · 4-4-2');
});
