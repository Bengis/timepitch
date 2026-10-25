import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import App from '../App';
import {LanguageProvider} from '../i18n';
import * as api from './api';
import * as simulation from '../api';
import {historicalFixture,statisticsFixture} from './test-fixtures';
vi.mock('../api',async()=>({...await vi.importActual('../api'),getTeams:vi.fn(),getTeam:vi.fn(),getMatches:vi.fn(),getGrfMatches:vi.fn(),getEngines:vi.fn(),createMatch:vi.fn(),createGrfMatch:vi.fn()}));
vi.mock('./api',async()=>({...await vi.importActual('./api'),readCapabilities:vi.fn(),readMatch:vi.fn(),readManifest:vi.fn(),readStatistics:vi.fn(),readEvents:vi.fn(),readMatchup:vi.fn()}));
beforeEach(()=>{
  location.hash='#/reconstruction/9';
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  vi.mocked(simulation.getTeams).mockResolvedValue([]);vi.mocked(simulation.getTeam).mockRejectedValue(new Error('Fixture no squad'));
  vi.mocked(simulation.getMatches).mockResolvedValue([]);vi.mocked(simulation.getGrfMatches).mockResolvedValue([]);vi.mocked(simulation.getEngines).mockResolvedValue([]);
  vi.mocked(api.readCapabilities).mockResolvedValue({two_modes_ui:true,reconstruction_enabled:true,dataset_state:'ready',dataset_version:'v1',publication_status:'blocked_pending_permission'});
  vi.mocked(api.readMatch).mockResolvedValue(historicalFixture());vi.mocked(api.readManifest).mockRejectedValue(new Error('No motion'));
  vi.mocked(api.readEvents).mockResolvedValue([]);vi.mocked(api.readStatistics).mockImplementation(async(_id,_period,ms)=>statisticsFixture(ms));
});
afterEach(()=>vi.restoreAllMocks());
const go=(hash:string)=>{window.location.hash=hash;window.dispatchEvent(new HashChangeEvent('hashchange'));};
it('keeps reconstruction read-only and opens simulation only as a separate workspace',async()=>{
  render(<LanguageProvider><App/></LanguageProvider>);
  await screen.findByText('Home historical club',{selector:'.tp-sb-full'});
  expect(screen.queryByRole('button',{name:'Simulate this matchup'})).not.toBeInTheDocument();
  // TP240: sin pestañas; se cambia de espacio por enlace directo.
  go('#/');
  await screen.findByRole('button',{name:'Play match'});
  go('#/reconstruction/9');
  await screen.findByText('Home historical club',{selector:'.tp-sb-full'});
  expect(api.readMatchup).not.toHaveBeenCalled();
  expect(simulation.createMatch).not.toHaveBeenCalled();expect(simulation.createGrfMatch).not.toHaveBeenCalled();
});
