import { StrictMode,useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { Pitch } from './Pitch';
import { PitchHudEngine } from './PitchHud';
import { drawRetro } from './retroCanvas';
import { syntheticFrame } from '../match-centre/unified-fixtures';
import { screenFixture } from '../match-centre/unified-screen-fixtures';
import { MatchCentre } from '../match-centre/MatchCentre';
import type { PitchRenderInput, RendererFailure } from './renderers/types';
import type { MatchCast } from '../presentation/types';

const graphics = vi.hoisted(() => ({ failures: [] as ((reason: RendererFailure) => void)[] }));
it.each([undefined,'Display settings'])('graphics offer only Retro 16-bit (default) and 3D, never Captain Hane or the retired 2D styles (settings %s)',settingsLabel=>{
  localStorage.removeItem('timepitch.pitch.v1');
  render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A" settingsLabel={settingsLabel}/></LanguageProvider>);
  if(settingsLabel)fireEvent.click(screen.getByText(settingsLabel));
  const picker=screen.getByRole('combobox',{name:'Graphics'}) as HTMLSelectElement;
  expect(picker.value).toBe('retro16-1');
  expect(within(picker).getAllByRole('option').map(o=>(o as HTMLOptionElement).value)).toEqual(['retro16-1','stylized-3d-1']);
  for(const name of ['FC · Broadcast','Sensible · Pixel','Retro 2D'])expect(screen.queryByText(name)).toBeNull();
  expect(screen.getByRole('combobox',{name:'Lighting'})).toBeInTheDocument();
  expect(screen.getByRole('combobox',{name:'Camera'})).toBeInTheDocument();
});
it('a fresh profile requests Retro 16-bit; choosing 3D is saved as an explicit choice and remembered',()=>{
  localStorage.removeItem('timepitch.pitch.v1');
  const {container,unmount}=render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A"/></LanguageProvider>);
  expect(container.querySelector('.pitch-section')?.getAttribute('data-requested-renderer')).toBe('retro16-1');
  expect(JSON.parse(localStorage.getItem('timepitch.pitch.v1')!)).toMatchObject({version:2,renderer:'retro16-1',rendererChosen:false});
  fireEvent.change(screen.getByRole('combobox',{name:'Graphics'}),{target:{value:'stylized-3d-1'}});
  expect(container.querySelector('.pitch-section')?.getAttribute('data-requested-renderer')).toBe('stylized-3d-1');
  expect(JSON.parse(localStorage.getItem('timepitch.pitch.v1')!)).toMatchObject({version:2,renderer:'stylized-3d-1',rendererChosen:true});
  unmount();
  render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A"/></LanguageProvider>);
  expect((screen.getByRole('combobox',{name:'Graphics'}) as HTMLSelectElement).value).toBe('stylized-3d-1');
  localStorage.removeItem('timepitch.pitch.v1');
});
it('Inspect player uses the match cast numbers and names and drops the lineup-slot note',()=>{
  const entry={number:'14',displayName:'Thierry Henry',appearance:{},appearanceSource:'generic',record:null};
  const cast={kits:null,players:new Map([['test:home:1',entry]])} as unknown as MatchCast;
  render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A" cast={cast}/></LanguageProvider>);
  expect(within(screen.getByRole('combobox',{name:'Inspect player'})).getByRole('option',{name:/ · 14 Thierry Henry$/})).toBeInTheDocument();
  expect(screen.queryByText(/lineup slots/)).toBeNull();
});
it('pilot settings use the secondary details target without another canvas',async()=>{
  function Harness(){const [target,setTarget]=useState<HTMLDivElement|null>(null);return <><Pitch frame={syntheticFrame()} home="H" away="A" defaultCamera="overview" settingsLabel="Display settings" settingsTarget={target}/><div data-testid="secondary" ref={setTarget}/></>;}
  const {container}=render(<Harness/>);
  expect(container.querySelectorAll('canvas')).toHaveLength(1);expect(screen.getByRole('combobox',{name:'Lighting'}).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('combobox',{name:'Camera'}).closest('details')).toBeNull();
  fireEvent.click(screen.getByText('Display settings'));
  expect(screen.getByTestId('secondary')).toContainElement(screen.getByRole('combobox',{name:'Lighting'}));
  expect(screen.getByRole('combobox',{name:'Camera'})).toHaveValue('overview');
  expect(container.querySelectorAll('canvas')).toHaveLength(1);
});
it('reduced motion applies effective overview and preserves the stored Follow camera',()=>{
  const media={matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()};vi.stubGlobal('matchMedia',vi.fn(()=>media));
  localStorage.setItem('timepitch.pitch.v1',JSON.stringify({version:2,renderer:'stylized-3d-1',rendererChosen:true,camera:'follow'}));
  const frame=syntheticFrame();
  const {unmount}=render(<LanguageProvider><Pitch frame={frame} home="H" away="A" fieldFocus={{x:20,y:40}} /></LanguageProvider>);
  const scene=vi.mocked(drawRetro).mock.calls.at(-1)![2];
  expect(scene.transform.sx).toBeCloseTo(188/68);expect(screen.getByRole('combobox',{name:'Camera'})).toHaveValue('follow');
  expect(JSON.parse(localStorage.getItem('timepitch.pitch.v1')!).camera).toBe('follow');
  unmount();expect(media.removeEventListener).toHaveBeenCalledOnce();
});
vi.mock('./renderers/three', () => ({ createThreeRenderer: (_canvas: HTMLCanvasElement, _input: PitchRenderInput, failure: (reason: RendererFailure) => void) => {
  graphics.failures.push(failure);
  return { update: vi.fn(() => ({ viewport: { width: 384, height: 256 }, projectFieldPoint: () => ({ x: 30, y: 20 }) })),
    resize: vi.fn(), pickPlayer: vi.fn(() => 'test:home:1'), dispose: vi.fn() };
} }));

vi.mock('./retroCanvas', () => ({ atlasUrl: '/test-atlas.svg', drawRetro: vi.fn() }));
let images: HTMLImageElement[];
beforeEach(() => {
  vi.clearAllMocks(); images = []; graphics.failures.length = 0;
  // These lifecycle tests exercise the 3D path (and its 2D fallback): 3D is an explicit choice since TP223.
  localStorage.setItem('timepitch.pitch.v1', JSON.stringify({ version: 2, renderer: 'stylized-3d-1', rendererChosen: true }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.stubGlobal('Image', function () { const image = document.createElement('img'); images.push(image); return image; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('controlled_selection_updates_both_surfaces and None clears without fetching a player', async () => {
  const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /pass ·/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic home player' }));
  expect(screen.getByRole('dialog', { name: 'Player detail' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Inspect player' })).toHaveValue('test:home:1');
  const before = vi.mocked(f.adapter.loadPlayer).mock.calls.length;
  fireEvent.change(screen.getByRole('combobox', { name: 'Inspect player' }), { target: { value: '' } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(vi.mocked(f.adapter.loadPlayer).mock.calls).toHaveLength(before);
  await waitFor(() => expect(f.adapter.loadPanel).toHaveBeenCalled());
});

it('controlled value governs highlight while local fallback still supports the historical bridge', () => {
  const frame = syntheticFrame(), select = vi.fn();
  const view = render(<LanguageProvider><Pitch frame={frame} home="Home" away="Away" selectedPlayerKey="test:away:1" onPlayerSelect={select} /></LanguageProvider>);
  expect(screen.getByRole('combobox', { name: 'Inspect player' })).toHaveValue('test:away:1');
  fireEvent.change(screen.getByRole('combobox', { name: 'Inspect player' }), { target: { value: '' } });
  expect(select).toHaveBeenCalledWith(null);
  expect(screen.getByRole('combobox', { name: 'Inspect player' })).toHaveValue('test:away:1');
  view.rerender(<LanguageProvider><Pitch frame={frame} home="Home" away="Away" selectedPlayerKey={null} onPlayerSelect={select} /></LanguageProvider>);
  expect(screen.getByRole('combobox', { name: 'Inspect player' })).toHaveValue('');
  view.unmount();
  render(<LanguageProvider><Pitch frame={frame} home="Home" away="Away" /></LanguageProvider>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Inspect player' }), { target: { value: 'test:home:1' } });
  expect(screen.getByRole('combobox', { name: 'Inspect player' })).toHaveValue('test:home:1');
});

it('hidden_renderer_disposes_and_resumes_same_cursor, camera and selection with a fresh canvas', () => {
  const frame = syntheticFrame({ clock_ms: 2500 });
  const show = (active: boolean) => <LanguageProvider><Pitch frame={frame} home="Home" away="Away" active={active} /></LanguageProvider>;
  const view = render(show(true)), original = view.container.querySelector('canvas');
  fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), { target: { value: 'overview' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Inspect player' }), { target: { value: 'test:home:1' } });
  const old = images.at(-1)!; view.rerender(show(false));
  expect(view.container.querySelector('canvas')).toBeNull(); expect(old.onload).toBeNull(); expect(old.onerror).toBeNull();
  view.rerender(show(true));
  expect(view.container.querySelector('canvas')).not.toBe(original);
  expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveValue('overview');
  expect(screen.getByRole('combobox', { name: 'Inspect player' })).toHaveValue('test:home:1');
  expect(vi.mocked(drawRetro).mock.calls.at(-1)![1].clock_ms).toBe(2500);
});

it('StrictMode fences disposed art callbacks and leaves only one active canvas', () => {
  const view = render(<StrictMode><LanguageProvider><Pitch frame={syntheticFrame()} home="Home" away="Away" /></LanguageProvider></StrictMode>);
  expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
  expect(images).toHaveLength(2); expect(images[0].onload).toBeNull(); expect(images[0].onerror).toBeNull();
  act(() => images[1].dispatchEvent(new Event('error')));
  expect(screen.getByRole('status')).toHaveTextContent('Player art could not load');
  expect(within(screen.getByRole('combobox', { name: 'Inspect player' })).getAllByRole('option')).toHaveLength(3);
  view.unmount(); expect(images[1].onload).toBeNull(); expect(images[1].onerror).toBeNull();
});

it.each(['historical', 'grf', 'timepitch'] as const)('switch_preserves_controller_and_reveal for %s with no extra source reads', async source => {
  const f = screenFixture(source), before = JSON.stringify(f.initial);
  const view = render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
  await waitFor(() => expect(f.adapter.loadPanel).toHaveBeenCalled());
  // TP226: GRF y TimePitch usan el armazón de emisión: elegir jugador abre «Ficha» y la cámara va en las pestañas del HUD.
  const shell = source !== 'historical';
  fireEvent.change(screen.getByRole('combobox', { name: 'Inspect player' }), { target: { value: 'test:home:1' } });
  if (shell) fireEvent.click(screen.getByRole('tab', { name: 'Live broadcast' }));
  // TP254: en la emisión no hay velocidades sueltas (se elige la duración de cada parte); se comprueba en el histórico.
  if (!shell) fireEvent.click(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^20×/ }));
  if (shell) fireEvent.click(screen.getByRole('button', { name: 'Tactical' }));
  else fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), { target: { value: 'overview' } });
  await act(async () => {});
  const slider = screen.getByRole('slider'), play = screen.getByRole('button', { name: 'Play' });
  const readers = [f.adapter.ensure, f.adapter.loadPanel, f.adapter.loadEvents, f.adapter.loadPlayer].map(fn => vi.mocked(fn).mock.calls.length);
  await waitFor(() => expect(view.container.querySelector('[data-renderer-status="ready"]')).toHaveAttribute('data-effective-renderer', 'stylized-3d-1'));
  expect(screen.getByRole('slider')).toBe(slider); expect(slider).toHaveValue('0'); expect(screen.getByRole('button', { name: 'Play' })).toBe(play);
  if (!shell) expect(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^20×/ })).toHaveAttribute('aria-pressed', 'true');
  if (shell) expect(screen.getByRole('button', { name: 'Tactical' })).toHaveAttribute('aria-pressed', 'true');
  else expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveValue('overview');
  expect(screen.getByRole('combobox', { name: 'Inspect player' })).toHaveValue('test:home:1');
  expect(screen.queryByText('Full match')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Lighting' }), { target: { value: 'floodlights' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Detail' }), { target: { value: 'low' } });
  act(() => graphics.failures.at(-1)!('context_lost'));
  expect(view.container.querySelector('[data-renderer-status="fallback"]')).toHaveAttribute('data-effective-renderer', 'retro-1');
  expect(JSON.parse(localStorage.getItem('timepitch.pitch.v1')!).renderer).toBe('stylized-3d-1');
  fireEvent.click(screen.getByRole('button', { name: 'Retry 3D' }));
  await waitFor(() => expect(view.container.querySelector('[data-renderer-status="ready"]')).toHaveAttribute('data-effective-renderer', 'stylized-3d-1'));
  expect([f.adapter.ensure, f.adapter.loadPanel, f.adapter.loadEvents, f.adapter.loadPlayer].map(fn => vi.mocked(fn).mock.calls.length)).toEqual(readers);
  expect(JSON.stringify(f.initial)).toBe(before);
});

it('persists presentation across sources and exposes localized graphics help', async () => {
  localStorage.setItem('timepitch.locale', 'es');
  const frame = syntheticFrame();
  const show = (home: string) => <LanguageProvider><Pitch frame={frame} home={home} away="Away" /></LanguageProvider>;
  const view = render(show('Historical'));
  await waitFor(() => expect(view.container.querySelector('canvas')).toHaveAttribute('data-renderer', 'stylized-3d-1'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Iluminación' }), { target: { value: 'floodlights' } });
  view.unmount(); render(show('Simulation'));
  expect(screen.getByRole('combobox', { name: 'Iluminación' })).toHaveValue('floodlights');
  fireEvent.click(screen.getByText('Sobre los gráficos'));
  expect(screen.getByText(/Equipaciones y animaciones ilustrativas/)).toBeVisible();
});

it('changing graphics retains already revealed final analysis', async () => {
  const f = screenFixture('grf'), view = render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '10000' } });
  await waitFor(() => expect(screen.getAllByText('Full match')[0]).toBeVisible());
  const slider = screen.getByRole('slider');
  await waitFor(() => expect(view.container.querySelector('canvas')).toHaveAttribute('data-renderer', 'stylized-3d-1'));
  expect(screen.getByRole('slider')).toBe(slider); expect(slider).toHaveValue('10000');
  expect(screen.getAllByText('Full match')[0]).toBeVisible(); expect(screen.getByRole('button', { name: 'Replay' })).toBeEnabled();
});

it('changing graphics during playback preserves playback intent without an explicit seek', async () => {
  const f = screenFixture('timepitch'), view = render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  const pause = screen.getByRole('button', { name: 'Pause' }), slider = screen.getByRole('slider');
  const reads = vi.mocked(f.adapter.ensure).mock.calls.length;
  await waitFor(() => expect(view.container.querySelector('canvas')).toHaveAttribute('data-renderer', 'stylized-3d-1'));
  expect(screen.getByRole('button', { name: 'Pause' })).toBe(pause); expect(screen.getByRole('slider')).toBe(slider);
  expect(vi.mocked(f.adapter.ensure).mock.calls.slice(reads).some(call => call[2]?.explicitSeek)).toBe(false);
  fireEvent.click(pause);
});

it('broadcast HUD is opt-in: without its props the pitch keeps no overlay chips, caption or camera tabs', () => {
  const { container } = render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A" /></LanguageProvider>);
  expect(container.querySelector('.pitch-hud-overlay')).toBeNull();
  expect(container.querySelector('.pitch-hud-wrap')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Camera' })).toBeNull();
});

it('glass camera tabs reuse the stored camera: Broadcast = follow, Tactical = overview, no Overhead view', () => {
  const { container } = render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A" cameraTabs /></LanguageProvider>);
  expect(container.querySelector('.retro-field')).toHaveClass('pitch-hud-wrap');
  const tabs = screen.getByRole('group', { name: 'Camera' });
  expect(within(tabs).getAllByRole('button').map(b => b.textContent)).toEqual(['Broadcast', 'Tactical']);
  expect(within(tabs).getByRole('button', { name: 'Broadcast' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(tabs).getByRole('button', { name: 'Tactical' }));
  expect(within(tabs).getByRole('button', { name: 'Tactical' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(tabs).getByRole('button', { name: 'Broadcast' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveValue('overview');
  expect(JSON.parse(localStorage.getItem('timepitch.pitch.v1')!).camera).toBe('overview');
  fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), { target: { value: 'follow' } });
  expect(within(tabs).getByRole('button', { name: 'Broadcast' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: /Overhead|Cenital/ })).toBeNull();
});

it('top-left slot shows the shell chips and the scene caption uses the real recording clock', () => {
  localStorage.setItem('timepitch.locale', 'es');
  const { container } = render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A" displayClockLabel="28:17" sceneCaption
    hudTopLeft={<span className="chip sim">Movimiento sintético</span>} /></LanguageProvider>);
  expect(screen.getByText('Movimiento sintético')).toHaveClass('chip', 'sim');
  const caption = container.querySelector('.pitch-hud-caption')!;
  expect(caption).toHaveTextContent('Escena ilustrativa · 28:17 · Movimiento sintético del motor · no es seguimiento real');
  expect(within(caption as HTMLElement).getByText('28:17').tagName).toBe('B');
  // TP223: on the phone only the clock stays visible; the full text stays for screen readers and in the tooltip.
  expect(caption.querySelectorAll('.pitch-hud-caption-text')).toHaveLength(2);
  expect(caption).toHaveAttribute('title', 'Escena ilustrativa · Movimiento sintético del motor · no es seguimiento real');
  expect(screen.queryByRole('group', { name: 'Cámara' })).toBeNull();
});

it('scene caption falls back to the frame clock and accepts an honest source-specific note', () => {
  const { container } = render(<LanguageProvider><Pitch frame={syntheticFrame({ clock_ms: 65000 })} home="H" away="A" sceneCaption="Reconstructed positions · not tracking" /></LanguageProvider>);
  expect(container.querySelector('.pitch-hud-caption')).toHaveTextContent('Illustrative scene · 01:05 · Reconstructed positions · not tracking');
});

it('hidden pitch does not render the broadcast HUD', () => {
  const { container } = render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A" active={false} cameraTabs sceneCaption hudTopLeft={<span>chip</span>} /></LanguageProvider>);
  expect(container.querySelector('.pitch-hud-overlay')).toBeNull();
});

it('engine pill renders the engine name inside a glass pill that phones can hide', () => {
  render(<PitchHudEngine label="GRF / TouchLines" />);
  const name = screen.getByText('GRF / TouchLines');
  expect(name.tagName).toBe('B');
  expect(name.closest('.pitch-hud-engine')).toHaveClass('pitch-hud-glass');
});

// TP240: Captain Hane is no longer offered (its code stays, unreachable from the UI).
it('a stored Captain Hane choice is not offered and never mounts the anime layer (TP240)',()=>{
  localStorage.setItem('timepitch.pitch.v1',JSON.stringify({version:2,renderer:'anime-1',rendererChosen:true,appearance:'daylight',camera:'follow',detail:'standard'}));
  const layer=vi.fn(()=> <div data-testid="anime-layer"/>);
  render(<LanguageProvider><Pitch frame={syntheticFrame()} home="H" away="A" renderAnime={layer}/></LanguageProvider>);
  const picker=screen.getByRole('combobox',{name:'Graphics'}) as HTMLSelectElement;
  expect(picker.value).toBe('retro16-1');
  expect(within(picker).queryByRole('option',{name:'Captain Hane'})).toBeNull();
  expect(screen.queryByTestId('anime-layer')).toBeNull();
  expect(document.querySelector('[data-anime-intro]')).toBeNull();
  localStorage.removeItem('timepitch.pitch.v1');
});
