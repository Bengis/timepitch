import { ChroniclePanel } from './ChroniclePanel';
import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { identity,ready,status } from './test-fixtures';
import type { SessionIdentity } from '../match-centre/session';
import { MatchCentre } from '../match-centre/MatchCentre';
import { screenFixture } from '../match-centre/unified-screen-fixtures';
type Props={identity:SessionIdentity;locale:'en'|'es';completed:boolean;revealed:boolean;onSeekEvidence:(refs:readonly string[])=>void;availableEventRefs?:readonly string[];onModeChange?:(enabled:boolean)=>void};
async function panel(){return ChroniclePanel;}
let posts:number,reads:string[],response:ReturnType<typeof ready>|null,capability:ReturnType<typeof status>,errorCode:number;
const props=():Props=>({identity,locale:'en',completed:true,revealed:true,onSeekEvidence:vi.fn(),availableEventRefs:['grf:1']});
beforeEach(()=>{
  posts=0;reads=[];response=null;capability=status();errorCode=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(init?.method==='POST'){posts++;if(errorCode)return new Response(null,{status:errorCode});return Response.json(response??{...ready(),state:'queued',checked:null});}
    reads.push(url);
    if(url.endsWith('/status'))return Response.json(capability);
    if(url.startsWith('/api/chronicles/v2'))return response?Response.json(response):new Response(null,{status:204});
    throw new Error('Unmatched network forbidden');
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it('generates_only_on_explicit_click and double click creates one job',async()=>{
  const Panel=await panel();render(<Panel {...props()}/>);
  const button=await screen.findByRole('button',{name:'Generate chronicle'});
  expect(posts).toBe(0);fireEvent.click(button);fireEvent.click(button);
  await screen.findByText('Queued');expect(posts).toBe(1);
});

it('refresh_tabs_and_locale_never_post',async()=>{
  const Panel=await panel(),p=props();const f=render(<Panel {...p}/>);
  await screen.findByRole('button',{name:'Generate chronicle'});f.rerender(<Panel {...p} locale="es"/>);
  await screen.findByRole('button',{name:'Generar crónica'});f.unmount();render(<Panel {...p}/>);
  await screen.findByRole('button',{name:'Generate chronicle'});expect(posts).toBe(0);
});

it.each(['session','source','locale'])('old_response_cannot_cross_owner_source_or_locale: %s even if fetch ignores abort',async boundary=>{
  const Panel=await panel();let resolve!:(value:Response)=>void;
  vi.mocked(fetch).mockImplementation(url=>String(url).endsWith('/status')?Promise.resolve(Response.json(status())):new Promise(r=>{resolve=r;}));
  const p=props(),f=render(<Panel {...p}/>);await waitFor(()=>expect(resolve).toBeDefined());
  // New object represents a newly bound owned session, even for the same source tuple.
  const oldResolve=resolve;
  const nextIdentity=boundary==='session'?{...identity}:boundary==='source'?{...identity,id:'other-source',revision:'c'.repeat(64)}:identity;
  f.rerender(<Panel {...p} identity={nextIdentity} locale={boundary==='locale'?'es':'en'}/>);
  await act(async()=>{oldResolve(Response.json(ready(identity,'en')));});
  expect(screen.queryByText(/Home club finished/)).not.toBeInTheDocument();expect(posts).toBe(0);
});

it('an existing report is hidden when the owned session instance changes',async()=>{
  const Panel=await panel();response=ready();const p=props(),f=render(<Panel {...p}/>);
  await screen.findByRole('heading',{name:/Home club finished/});
  vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));
  f.rerender(<Panel {...p} identity={{...identity}}/>);
  expect(screen.queryByRole('heading',{name:/Home club finished/})).not.toBeInTheDocument();expect(posts).toBe(0);
});

it('rejects a mismatched source revision in a ready response',async()=>{
  const Panel=await panel();response=ready({...identity,revision:'c'.repeat(64)});render(<Panel {...props()}/>);
  await screen.findByRole('alert');expect(screen.queryByText(/Home club finished/)).not.toBeInTheDocument();
});

it('ready_text_survives_worker_offline and generation disabled',async()=>{
  const Panel=await panel();response=ready();capability=status({mode:'off',worker:'off',generation_allowed:false});render(<Panel {...props()}/>);
  await screen.findByRole('heading',{name:/Home club finished/});expect(screen.queryByRole('button',{name:'Generate chronicle'})).not.toBeInTheDocument();
});

it('renders_plain_text_and_evidence_accessibly without fake jumps',async()=>{
  const Panel=await panel();response=ready();response.checked!.draft.headline.text='<img src=x onerror=alert(1)> plain text';
  const p=props();const f=render(<Panel {...p}/>);
  await screen.findByRole('heading',{name:'<img src=x onerror=alert(1)> plain text'});expect(f.container.querySelector('img')).toBeNull();
  const details=f.container.querySelectorAll('details');expect(details.length).toBe(3);
  fireEvent.click(within(details[1] as HTMLElement).getByText(/Evidence/));
  fireEvent.click(screen.getByRole('button',{name:'Watch cited event'}));expect(p.onSeekEvidence).toHaveBeenCalledWith(['grf:1']);
  f.rerender(<Panel {...p} availableEventRefs={[]}/>);expect(screen.queryByRole('button',{name:'Watch cited event'})).not.toBeInTheDocument();
});

it('does_not_claim_semantic_verification and retains coverage and final scope',async()=>{
  const Panel=await panel();response=ready();render(<Panel {...props()}/>);
  await screen.findByText(/meaning has not been independently verified/);expect(screen.getByText('Some events omitted')).toBeVisible();
  expect(screen.getByText(/Final match.*independent of playback/)).toBeVisible();
});

it.each([{revealed:false,completed:true},{revealed:true,completed:false}])('spoilers and unfinished sources do not read or generate %j',async flags=>{
  const Panel=await panel();render(<Panel {...props()} {...flags}/>);await act(async()=>{});
  expect(reads).toEqual([]);expect(posts).toBe(0);expect(screen.queryByText(/Home club finished/)).not.toBeInTheDocument();
});

it('historical reconstruction is explicitly unsupported without any API request',async()=>{
  const Panel=await panel();render(<Panel {...props()} identity={{source:'historical',id:'9',revision:'v1'}}/>);
  expect(screen.getByText(/Reconstruction.*not supported/)).toBeVisible();expect(reads).toEqual([]);
});

it('unsupported engine capability is explicit and cannot generate',async()=>{
  const Panel=await panel();capability=status({supported_engines:['timepitch']});render(<Panel {...props()}/>);
  await screen.findByText('Chronicles are unavailable for this saved source.');
  expect(screen.queryByRole('button',{name:'Generate chronicle'})).not.toBeInTheDocument();expect(posts).toBe(0);
});

it('transmits only source identity and locale on explicit creation',async()=>{
  const Panel=await panel();render(<Panel {...props()}/>);fireEvent.click(await screen.findByRole('button',{name:'Generate chronicle'}));
  await screen.findByText('Queued');const call=vi.mocked(fetch).mock.calls.find(([,init])=>init?.method==='POST')!;
  expect(JSON.parse(String(call[1]!.body))).toEqual({engine:'grf',match_id:identity.id,trace_hash:identity.revision,locale:'en'});
  expect(call[1]!.credentials).toBe('same-origin');
});

it.each([404,409,429,503])('terminal HTTP %i does not retry or erase match analysis',async code=>{
  const Panel=await panel();errorCode=code;render(<div><p>Recorded match facts</p><Panel {...props()}/></div>);
  fireEvent.click(await screen.findByRole('button',{name:'Generate chronicle'}));await screen.findByRole('alert');
  expect(posts).toBe(1);expect(screen.getByText('Recorded match facts')).toBeVisible();expect(screen.getByRole('button',{name:'Generate chronicle'})).toBeDisabled();
});

it('queued polling only reads the stored job, never regenerates',async()=>{
  const Panel=await panel();response={...ready(),state:'queued',checked:null};render(<Panel {...props()}/>);
  await screen.findByText('Queued');response=ready();await screen.findByRole('heading',{name:/Home club finished/},{timeout:3000});
  expect(posts).toBe(0);expect(reads.some(url=>url.endsWith('/saved-report'))).toBe(true);
});

it('aborts active browser requests on unmount without suggesting a refund',async()=>{
  const Panel=await panel();let signal:AbortSignal|undefined;
  vi.mocked(fetch).mockImplementation(async(_url,init)=>{signal=init?.signal??undefined;return new Promise(()=>{});});
  const f=render(<Panel {...props()}/>);await waitFor(()=>expect(signal).toBeDefined());f.unmount();expect(signal!.aborted).toBe(true);expect(posts).toBe(0);
});

it('no_duplicate_fullmatch_control_or_false_ai_off in the shared Summary',async()=>{
  const f=screenFixture('timepitch');f.initial.descriptor.metadata={completed:true};
  const read=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url,init)=>String(url).endsWith('/windows')?Promise.resolve(Response.json([{id:'fulltime',end_ms:0,event_ids:[],metrics:{},score:{home:1,away:0},revision:f.adapter.identity.revision}])):read(url,init));
  render(<MatchCentre adapter={f.adapter} visible initialSection="summary" onBack={()=>{}} actions={{explanations:{id:f.adapter.identity.id,revision:f.adapter.identity.revision}}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));
  expect(await screen.findByRole('region',{name:'Match chronicle'})).toBeVisible();
  await screen.findByRole('button',{name:'Generate chronicle'});
  expect(screen.queryByRole('option',{name:'Full-time'})).not.toBeInTheDocument();
  expect(screen.queryByText(/AI explanations are off/)).not.toBeInTheDocument();expect(posts).toBe(0);
});

it('ready evidence reuses the existing player and focuses its controls',async()=>{
  const f=screenFixture('grf');f.initial.descriptor.metadata={completed:true};response=ready(f.adapter.identity);
  f.initial.events=[{...f.initial.events[0],kind:'goal'}];
  response.checked!.evidence[1].event_refs=['source:event'];
  render(<MatchCentre adapter={f.adapter} visible initialSection="summary" onBack={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));
  await screen.findByRole('heading',{name:/Home club finished/});
  const region=screen.getByRole('region',{name:'Match chronicle'});
  const detail=region.querySelectorAll('details')[1];fireEvent.click(within(detail as HTMLElement).getByText(/Evidence/));
  fireEvent.click(screen.getByRole('button',{name:'Watch cited event'}));
  await waitFor(()=>expect(screen.getByRole('tab',{name:'Match'})).toHaveAttribute('aria-selected','true'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Play'})).toHaveFocus());expect(posts).toBe(0);
});

it('a goal reference seeks the goal rather than a pass sharing its resolution reference',async()=>{
  const f=screenFixture('grf'),base=f.initial.events[0];f.initial.descriptor.metadata={completed:true};f.initial.events=[];f.panel.scope='final';
  f.panel.actions=[{...base,id:'pass-action',kind:'pass',refs:['1'],elapsedMs:200},
    {...base,id:'grf:resolved:goal-1',kind:'goal',refs:['1'],elapsedMs:500}];
  response=ready(f.adapter.identity);render(<MatchCentre adapter={f.adapter} visible initialSection="summary" onBack={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));await screen.findByRole('heading',{name:/Home club finished/});
  const detail=screen.getByRole('region',{name:'Match chronicle'}).querySelectorAll('details')[1];
  fireEvent.click(within(detail as HTMLElement).getByText(/Evidence/));fireEvent.click(screen.getByRole('button',{name:'Watch cited event'}));
  await waitFor(()=>expect(screen.getByRole('slider',{name:'Match position'})).toHaveValue('500'));expect(posts).toBe(0);
});
