import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import App from '../App';

const api=vi.hoisted(()=>({getMatches:vi.fn(),getEngines:vi.fn(),getGrfMatches:vi.fn(),
  createGrfMatch:vi.fn(),getGrfMatch:vi.fn(),getGrfReplay:vi.fn(),getMatch:vi.fn(),getReplay:vi.fn(),getTeams:vi.fn()}));
vi.mock('../api',async original=>({...await original<typeof import('../api')>(),...api}));
vi.mock('../match/useTeam',()=>({useTeam:(key:string)=>({key,team:null,failed:false,valid:true,
  formation:'4-4-2',tactic:'balanced',players:[],setKey:vi.fn(),retry:vi.fn()})}));
vi.mock('./GrfMatchView',()=>({GrfMatchView:()=> <div>Native replay opened</div>}));

beforeEach(()=>{
  localStorage.clear();vi.resetAllMocks();vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  api.getTeams.mockResolvedValue([]);api.getMatches.mockResolvedValue([]);
  api.getEngines.mockResolvedValue([{id:'timepitch',available:true},{id:'grf',available:true}]);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('navigates setup, library and an open match without requesting the replay again',async()=>{
  const job={id:'saved-native',state:'ready',config:{home_key:'home:2000',away_key:'away:2001'},summary:{score:[0,0],home_name:'Saved home',away_name:'Saved away'}};
  api.getGrfMatches.mockResolvedValue([job]);api.getGrfMatch.mockResolvedValue(job);api.getGrfReplay.mockResolvedValue({});
  render(<LanguageProvider><App/></LanguageProvider>);
  const nav=screen.getByRole('navigation',{name:'Workspace'});
  expect(within(nav).getByRole('button',{name:'Match centre'})).toBeDisabled();
  fireEvent.click(within(nav).getByRole('button',{name:'Library'}));
  fireEvent.click(await screen.findByRole('button',{name:/Saved home — Saved away/}));
  await screen.findByText('Native replay opened');
  fireEvent.click(within(nav).getByRole('button',{name:'New match'}));
  expect(screen.getByText('Native replay opened')).not.toBeVisible();
  expect(screen.getByRole('button',{name:'Play match'})).toBeVisible();
  fireEvent.click(within(nav).getByRole('button',{name:'Match centre'}));
  expect(screen.getByText('Native replay opened')).toBeVisible();
  expect(api.getGrfReplay).toHaveBeenCalledTimes(1);
});

it('defaults to GRF when the prepared GRF runtime is available (TP242)',async()=>{
  api.getGrfMatches.mockResolvedValue([]);
  render(<LanguageProvider><App/></LanguageProvider>);
  // TP248/TP250: el motor se elige con botones a la vista.
  await waitFor(()=>expect(screen.getByRole('radio',{name:/Google Research Football/})).toBeEnabled());
  expect(screen.getByRole('radio',{name:/Google Research Football/})).toBeChecked();
  // TP242: el motor TimePitch ya no se ofrece cuando GRF está disponible.
  expect(screen.queryByRole('radio',{name:/^TimePitch/})).toBeNull();
});

it('keeps TimePitch usable when GRF is unavailable',async()=>{
  api.getGrfMatches.mockResolvedValue([]);
  api.getEngines.mockResolvedValue([{id:'timepitch',available:true},{id:'grf',available:false,reason:'missing_runtime'}]);
  render(<LanguageProvider><App/></LanguageProvider>);
  await screen.findByText('The GRF runtime is not installed.');
  expect(screen.getByRole('radio',{name:/^TimePitch/})).toBeChecked();
  expect(screen.getByRole('radio',{name:/Google Research Football/})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Play match'})).toBeEnabled();
});

it('keeps the refreshed GRF history when the older initial response arrives last',async()=>{
  let resolveInitial!:(value:unknown[])=>void;
  const initial=new Promise<unknown[]>(resolve=>{resolveInitial=resolve;});
  const job={id:'new-native-match',state:'ready',config:{home_key:'home:2000',away_key:'away:2001'},summary:{score:[0,0],home_name:'New home',away_name:'New away'}};
  api.getGrfMatches.mockReturnValueOnce(initial).mockResolvedValue([job]);
  api.createGrfMatch.mockResolvedValue(job);api.getGrfMatch.mockResolvedValue(job);api.getGrfReplay.mockResolvedValue({});
  const {container}=render(<LanguageProvider><App/></LanguageProvider>);
  await waitFor(()=>expect(screen.getByRole('radio',{name:/Google Research Football/})).toBeEnabled());
  fireEvent.click(screen.getByRole('radio',{name:/Google Research Football/}));
  fireEvent.click(screen.getByRole('button',{name:'Play match'}));
  await screen.findByText('Native replay opened');
  fireEvent.click(screen.getByRole('button',{name:'Library'}));
  const history=within(container.querySelector('.grf-history')! as HTMLElement);
  await history.findByRole('button',{name:/New home — New away/});
  await act(async()=>resolveInitial([]));
  expect(history.queryByRole('button',{name:/New home — New away/})).toBeInTheDocument();
});

it('opens delayed GRF history and survives a language change without querying the other engine',async()=>{
  let resolveJob!:(value:unknown)=>void;
  const pending=new Promise(resolve=>{resolveJob=resolve;});
  const job={id:'saved-native',state:'ready',config:{home_key:'home:2000',away_key:'away:2001'},summary:{score:[0,0],home_name:'Saved home',away_name:'Saved away'}};
  api.getGrfMatches.mockResolvedValue([job]);api.getGrfMatch.mockReturnValueOnce(pending);
  api.getGrfReplay.mockResolvedValue({});
  render(<LanguageProvider><App/></LanguageProvider>);
  await waitFor(()=>expect(screen.getByRole('radio',{name:/Google Research Football/})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Library'}));
  fireEvent.click(await screen.findByRole('button',{name:/Saved home — Saved away/}));
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
  await act(async()=>resolveJob(job));
  await screen.findByText('Native replay opened');
  expect(api.getGrfReplay).toHaveBeenCalledWith('saved-native',expect.any(AbortSignal));
  expect(api.getMatch).not.toHaveBeenCalled();expect(api.getReplay).not.toHaveBeenCalled();
});
