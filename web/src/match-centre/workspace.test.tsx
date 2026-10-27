import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import App from '../App';
import * as api from '../api';
import * as historical from '../historical/api';
import {fullFixture} from '../grf/test-fixtures';
vi.mock('../api',async()=>({...await vi.importActual('../api'),getTeams:vi.fn(),getTeam:vi.fn(),getMatches:vi.fn(),getGrfMatches:vi.fn(),getEngines:vi.fn(),getGrfMatch:vi.fn(),getGrfReplay:vi.fn(),getGrfStatistics:vi.fn(),createMatch:vi.fn(),createGrfMatch:vi.fn()}));
vi.mock('../historical/api',async()=>({...await vi.importActual('../historical/api'),readCapabilities:vi.fn(),readSeasons:vi.fn()}));
beforeEach(()=>{
  window.location.hash='';vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  vi.mocked(api.getTeams).mockResolvedValue([]);vi.mocked(api.getTeam).mockRejectedValue(new Error('No squad'));
  vi.mocked(api.getMatches).mockResolvedValue([]);vi.mocked(api.getGrfMatches).mockResolvedValue([]);vi.mocked(api.getEngines).mockResolvedValue([]);
  vi.mocked(historical.readCapabilities).mockResolvedValue({two_modes_ui:true,reconstruction_enabled:true,dataset_state:'ready',dataset_version:'v1',publication_status:'blocked_pending_permission'});
  vi.mocked(historical.readSeasons).mockRejectedValue(new Error('Read unavailable'));
});
afterEach(()=>vi.restoreAllMocks());
const go=(hash:string)=>{window.location.hash=hash;window.dispatchEvent(new HashChangeEvent('hashchange'));};
it('uses capability flags even with historical reads down; navigation never creates a simulation',async()=>{
  render(<LanguageProvider><App/></LanguageProvider>);
  // Studio adds compact navigation without creating a simulation or exposing unavailable historical reads.
  expect(await screen.findByRole('button',{name:'Play match'})).toBeVisible();
  expect(screen.getByRole('navigation',{name:'Workspace'})).toBeVisible();
  expect(document.querySelector('.vs-hero')).toBeVisible();
  expect(document.querySelector('.simulation-subnav')).toBeNull();
  expect(screen.getByRole('link',{name:/Time\s*Pitch/i})).toHaveAttribute('href','#/');
  go('#/reconstruction');
  await screen.findByRole('alert');
  go('#/');
  expect(await screen.findByRole('button',{name:'Play match'})).toBeVisible();
  expect(api.createMatch).not.toHaveBeenCalled();expect(api.createGrfMatch).not.toHaveBeenCalled();
});
it('does not steal navigation when a previously requested saved replay becomes ready',async()=>{
  const replay=fullFixture();
  const job={id:'pending',state:'ready',config:replay.input.config,summary:{home_name:'Home club',away_name:'Away club',score:[0,0]}} as api.GrfJob;
  vi.mocked(api.getGrfMatches).mockResolvedValue([job]);
  let resolve!:(job:api.GrfJob)=>void;
  vi.mocked(api.getGrfMatch).mockReturnValue(new Promise(r=>resolve=r));
  vi.mocked(api.getGrfReplay).mockResolvedValue(replay);
  vi.mocked(api.getGrfStatistics).mockRejectedValue(new Error('No summary'));
  render(<LanguageProvider><App/></LanguageProvider>);
  await screen.findByRole('button',{name:'Play match'});
  go('#/library');
  fireEvent.click(await screen.findByRole('button',{name:/Home club — Away club/}));
  go('#/reconstruction');
  resolve(job);
  await waitFor(()=>expect(api.getGrfReplay).toHaveBeenCalled());
  expect(window.location.hash).toBe('#/reconstruction');
  // TP248: sin «Volver a tu partido» en otras pantallas; el partido no se impone.
  expect(screen.queryByRole('button',{name:'Back to your match'})).toBeNull();
});
it('explains an unavailable historical deep link instead of leaving an empty page',async()=>{
  window.location.hash='#/reconstruction/9';
  vi.mocked(historical.readCapabilities).mockResolvedValue({two_modes_ui:true,reconstruction_enabled:false,dataset_state:'absent',dataset_version:null,publication_status:'blocked_pending_permission'});
  render(<LanguageProvider><App/></LanguageProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('historical archive is unavailable');
});
