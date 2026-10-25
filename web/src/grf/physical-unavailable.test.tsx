import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import App from '../App';
import {getGrfReplay,requirePlayableGrfReplay,UnsupportedGrfReplayError,type GrfReplayResponse} from '../api';
import {legacyFixture,fullFixture} from './test-fixtures';

beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('keeps compressed replay versions playable and refuses physical versions at the HTTP boundary',async()=>{
  for(const record of [legacyFixture(),fullFixture()]) expect(requirePlayableGrfReplay(record)).toBe(record);
  for(const schema_version of ['grf-physical-1','grf-activity-1','grf-actions-1']){
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({schema_version}),{status:200})));
    await expect(getGrfReplay('physical')).rejects.toBeInstanceOf(UnsupportedGrfReplayError);
  }
});

it('explains a physical history entry in both languages without opening a compressed viewer',async()=>{
  const job={id:'physical-saved',state:'ready',config:{home_key:'home:2000',away_key:'away:2001'},summary:{score:[0,0],home_name:'Saved home',away_name:'Saved away'}};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    const value=url==='/api/catalog/teams'?[]:url==='/api/matches'?[]:url==='/api/engines'?[{id:'timepitch',available:true},{id:'grf',available:true}]:
      url==='/api/grf/matches'?[job]:url.endsWith('/replay')?{schema_version:'grf-actions-1'} satisfies Partial<GrfReplayResponse>:job;
    return new Response(JSON.stringify(value),{status:200});
  }));
  const {container}=render(<LanguageProvider><App/></LanguageProvider>);
  const nav=screen.getByRole('navigation',{name:'Workspace'});
  fireEvent.click(within(nav).getByRole('button',{name:'Library'}));
  fireEvent.click(await screen.findByRole('button',{name:/Saved home — Saved away/}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/physical.*not.*available.*browser/i);
  expect(container.querySelector('.grf-match-view')).toBeNull();
  expect(within(nav).getByRole('button',{name:'Match centre'})).toBeDisabled();
  expect(screen.getByRole('button',{name:/Saved home — Saved away/})).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/físic.*no.*disponible.*navegador/i);
  fireEvent.click(screen.getByRole('button',{name:'Nuevo partido'}));
  expect(screen.getByRole('button',{name:'Jugar partido'})).toBeVisible();
});
