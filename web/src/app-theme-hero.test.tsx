// TP271: Studio preserves setup controls and source clarity without an illustrated banner.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {LanguageProvider} from './i18n';
import App from './App';
import * as api from './api';
import * as historical from './historical/api';
vi.mock('./api',async()=>({...await vi.importActual('./api'),getTeams:vi.fn(),getTeam:vi.fn(),getMatches:vi.fn(),getGrfMatches:vi.fn(),getEngines:vi.fn()}));
vi.mock('./historical/api',async()=>({...await vi.importActual('./historical/api'),readCapabilities:vi.fn()}));
beforeEach(()=>{
  window.location.hash='';vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  vi.mocked(api.getTeams).mockResolvedValue([]);vi.mocked(api.getTeam).mockRejectedValue(new Error('No squad'));
  vi.mocked(api.getMatches).mockResolvedValue([]);vi.mocked(api.getGrfMatches).mockResolvedValue([]);vi.mocked(api.getEngines).mockResolvedValue([]);
  vi.mocked(historical.readCapabilities).mockRejectedValue(new Error('No capabilities'));
});
afterEach(()=>vi.restoreAllMocks());

// Studio retains the existing engine/graphics/Play and provenance controls without an illustrated hero.
it('keeps one Play action, visible engine and graphics choices and source clarity in Studio (EN/ES)',async()=>{
  const {container}=render(<LanguageProvider><App/></LanguageProvider>);
  const hero=container.querySelector('.setup-view .vs-hero') as HTMLElement;
  expect(hero).not.toBeNull();
  expect(within(hero).queryByRole('img')).toBeNull();
  expect(within(hero).getByText(/based on season statistics and watch a simulated match/i)).toBeInTheDocument();
  await waitFor(()=>expect(container.querySelector('.vs')).not.toBeNull());
  expect(screen.getByRole('button',{name:'Play match'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/Watch the demo|More details/})).toBeNull();
  // TP248: motor y gráficos a la vista encima de «Jugar partido», no plegados en «Opciones».
  const graphics=screen.getByRole('group',{name:'Graphics'});
  expect(graphics.closest('details')).toBeNull();
  expect(within(graphics).getAllByRole('radio').map(r=>(r as HTMLInputElement).value)).toEqual(['retro16-1','stylized-3d-1']);
  expect(within(graphics).getByRole('radio',{name:/Retro 16-bit/})).toBeChecked();
  const engine=screen.getByRole('group',{name:'Engine'});
  expect(engine.closest('details')).toBeNull();
  expect(within(engine).getByRole('radio',{name:/Google Research Football/})).toBeInTheDocument();
  expect(screen.getByText('Tactics').closest('details')).not.toHaveAttribute('open');
  fireEvent.change(screen.getByRole('combobox',{name:'Language'}),{target:{value:'es'}});
  expect(within(hero).getByText(/basadas en estadísticas de temporada y mira un partido simulado/i)).toBeInTheDocument();
});

it('keeps legacy saved matches reachable from the compact navigation and returns to setup',async()=>{
  render(<LanguageProvider><App/></LanguageProvider>);
  await screen.findByRole('button',{name:'Play match'});
  const nav=screen.getByRole('navigation',{name:'Workspace'});
  fireEvent.click(within(nav).getByRole('button',{name:'Library'}));
  expect(await screen.findByRole('heading',{name:'Library'})).toBeVisible();
  fireEvent.click(within(nav).getByRole('button',{name:'New match'}));
  expect(await screen.findByRole('button',{name:'Play match'})).toBeVisible();
  expect(within(nav).getByRole('button',{name:'New match'})).toHaveAttribute('aria-current','page');
});
