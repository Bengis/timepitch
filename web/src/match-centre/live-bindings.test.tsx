import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import * as api from '../api';
import * as historical from '../historical/api';
import { LanguageProvider } from '../i18n';
import { legacyRecord, bundle, modernGrf, sourceReaders, deferred } from './adapters/test-fixtures';
import { parseWorkspaceHash } from './navigation';
import {MatchView} from '../match/MatchView';

vi.mock('../api', async () => ({ ...await vi.importActual('../api'), getTeams: vi.fn(), getTeam: vi.fn(), getMatches: vi.fn(), getGrfMatches: vi.fn(), getMatch: vi.fn(), getReplay: vi.fn(), getGrfMatch: vi.fn(), getGrfReplay: vi.fn(), getEngines: vi.fn(), getStatistics: vi.fn(), getWindows: vi.fn(), getExplanation:vi.fn(), createExplanation: vi.fn(), createMatch: vi.fn(), createGrfMatch: vi.fn(), importReplay: vi.fn() }));
vi.mock('../historical/api', async () => ({ ...await vi.importActual('../historical/api'), readCapabilities: vi.fn(), readSeasons: vi.fn(), readMatch: vi.fn(), readManifest: vi.fn(), readEvents: vi.fn(), readStatistics: vi.fn(), readSegment: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks(); window.location.hash = ''; vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.mocked(api.getTeams).mockResolvedValue([]); vi.mocked(api.getTeam).mockRejectedValue(new Error('No catalogue'));
  vi.mocked(api.getEngines).mockResolvedValue([]); vi.mocked(api.getWindows).mockResolvedValue([]);
  vi.mocked(api.getMatches).mockResolvedValue([]); vi.mocked(api.getGrfMatches).mockResolvedValue([]);
  vi.mocked(api.getStatistics).mockImplementation(async (_id, ms) => bundle(ms));
  const f = sourceReaders();
  vi.mocked(historical.readCapabilities).mockImplementation(f.readers.capabilities);
  vi.mocked(historical.readMatch).mockImplementation(f.readers.match);
  vi.mocked(historical.readManifest).mockImplementation(f.readers.manifest);
  vi.mocked(historical.readEvents).mockImplementation(f.readers.events);
  vi.mocked(historical.readStatistics).mockImplementation(f.readers.statistics);
  vi.mocked(historical.readSegment).mockImplementation(f.readers.segment);
  vi.mocked(historical.readSeasons).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

function mount() { return render(<LanguageProvider><App /></LanguageProvider>); }
function route(hash: string) { act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); }

it('preserves an explicitly requested explanation job across tabs without another create or budget reset',async()=>{
  const window={id:'moment',end_ms:1000,score:{home:1,away:0},metrics:{home:{},away:{}},event_ids:['goal']} as api.MatchWindow;
  const job={id:'mock-job',state:'pending',window} as api.ExplanationJob;
  vi.mocked(api.getWindows).mockResolvedValue([window]);vi.mocked(api.createExplanation).mockResolvedValue(job);vi.mocked(api.getExplanation).mockResolvedValue(job);
  render(<LanguageProvider><MatchView id="saved" record={legacyRecord()} onBack={()=>{}}/></LanguageProvider>);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'1000'}});fireEvent.click(screen.getByRole('tab',{name:'Summary'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Generate local explanation'})).toBeEnabled());
  expect(api.createExplanation).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Generate local explanation'}));
  await screen.findByText('Local agents are reading the recorded evidence…');
  fireEvent.click(screen.getByRole('tab',{name:'Line-ups'}));fireEvent.click(screen.getByRole('tab',{name:'Summary'}));
  expect(await screen.findByText('Local agents are reading the recorded evidence…')).toBeVisible();expect(api.createExplanation).toHaveBeenCalledTimes(1);
});

it('opens a bare reconstruction link in the real common Match tab and preserves canonical/legacy navigation', async () => {
  window.location.hash = '#/reconstruction/9'; const view = mount();
  await waitFor(() => expect(view.container.querySelector('[data-unified-match-centre][data-source=historical]')).toBeVisible());
  await waitFor(() => expect(historical.readMatch).toHaveBeenCalled());
  expect(screen.getByRole('tab', { name: 'Match' })).toHaveAttribute('aria-selected', 'true');
  route('#/reconstruction/9?tab=analysis'); await waitFor(() => expect(screen.getByRole('tab', { name: 'Maps' })).toHaveAttribute('aria-selected', 'true'));
  route('#/reconstruction/9?tab=players'); await waitFor(() => expect(screen.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true'));
  route('#/reconstruction/9?tab=events'); await waitFor(() => expect(view.container.querySelector('[data-unified-events] h2')).toHaveFocus());
  fireEvent.click(screen.getByRole('tab', { name: 'Data' })); expect(window.location.hash).toContain('tab=data');
  fireEvent.click(screen.getByRole('button', { name: 'Back' })); expect(parseWorkspaceHash(window.location.hash)).toEqual({ mode: 'reconstruction' });
});

it.each(['timepitch', 'grf'] as const)('opens saved %s through the common screen with flags off and no source/create/model read', async engine => {
  vi.mocked(historical.readCapabilities).mockResolvedValue({ two_modes_ui: false, reconstruction_enabled: false, dataset_state: 'absent', dataset_version: null, publication_status: 'blocked_pending_permission' });
  const record = engine === 'grf' ? modernGrf() : legacyRecord();
  const config = 'input' in record ? record.input.config : record.config;
  const job = { id: 'saved', state: 'ready', config };
  if (engine === 'grf') { vi.mocked(api.getGrfMatches).mockResolvedValue([job as api.GrfJob]); vi.mocked(api.getGrfMatch).mockResolvedValue(job as api.GrfJob); vi.mocked(api.getGrfReplay).mockResolvedValue(record as api.GrfReplay); }
  else { vi.mocked(api.getMatches).mockResolvedValue([job as api.MatchJob]); vi.mocked(api.getMatch).mockResolvedValue(job as api.MatchJob); vi.mocked(api.getReplay).mockResolvedValue(record as api.MatchRecord); }
  const view = mount(); const nav = await screen.findByRole('navigation', { name: 'Workspace' });
  fireEvent.click(within(nav).getByRole('button', { name: 'Library' }));
  const library = view.container.querySelector('.library-view') as HTMLElement;
  fireEvent.click(await within(library).findByRole('button', { name: new RegExp(`${config.home_key}.*${config.away_key}`) }));
  await waitFor(() => expect(view.container.querySelector(`[data-unified-match-centre][data-source=${engine}]`)).toBeVisible());
  // TP226: al abrir un partido simulado la reproducción arranca sola a 10× (con una grabación corta puede acabar enseguida,
  // así que se comprueba la velocidad elegida por el arranque y que el reloj ha avanzado).
  await waitFor(() => expect(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: '10×' })).toHaveAttribute('aria-pressed', 'true'));
  await waitFor(() => expect(Number((screen.getByRole('slider') as HTMLInputElement).value)).toBeGreaterThan(0));
  expect(historical.readMatch).not.toHaveBeenCalled(); expect(historical.readManifest).not.toHaveBeenCalled();
  expect(api.createMatch).not.toHaveBeenCalled(); expect(api.createGrfMatch).not.toHaveBeenCalled(); expect(api.createExplanation).not.toHaveBeenCalled(); expect(api.importReplay).not.toHaveBeenCalled();
});

it('keeps the common source session paused at its cursor when switching modes and does not let a late saved replay navigate', async () => {
  window.location.hash = '#/reconstruction/9'; const saved = modernGrf();
  const job = { id: 'pending', state: 'ready', config: saved.input.config } as api.GrfJob;
  vi.mocked(api.getGrfMatches).mockResolvedValue([job]); const pending = deferred<api.GrfJob>();
  vi.mocked(api.getGrfMatch).mockReturnValue(pending.promise); vi.mocked(api.getGrfReplay).mockResolvedValue(saved);
  const view = mount(); await waitFor(() => expect(historical.readMatch).toHaveBeenCalled());
  fireEvent.change(await screen.findByRole('slider'), { target: { value: 1000 } });
  await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('1000'));
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  // TP240: sin pestañas; se cambia de espacio por enlace directo.
  const go = (hash: string) => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); };
  go('#/library');
  const cursor = (view.container.querySelector('[data-source=historical] input[type=range]') as HTMLInputElement).value;
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${saved.input.config.home_key}.*${saved.input.config.away_key}`) }));
  go('#/reconstruction/9');
  await act(async () => { pending.resolve(job); });
  await waitFor(() => expect(api.getGrfReplay).toHaveBeenCalled());
  expect(window.location.hash).toBe('#/reconstruction/9');
  expect(screen.getByRole('slider')).toHaveValue(cursor); expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
});
