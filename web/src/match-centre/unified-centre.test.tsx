import statsbombIcon from '../assets/statsbomb.svg?no-inline';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { screenFixture } from './unified-screen-fixtures';
import type { MatchSource } from './session';
import { createHistoricalSession } from './adapters/historical';
import { createGrfSession } from './adapters/grf';
import { createTimePitchSession } from './adapters/timepitch';
import { bundle, legacyRecord, modernGrf, sourceReaders } from './adapters/test-fixtures';

vi.mock('../historical/HistoricalComparison', () => ({ HistoricalComparisonPanel: () => <div>Owned read-only comparison</div> }));

describe('one complete Match Centre', () => {
  it.each<MatchSource>(['historical', 'grf', 'timepitch'])('%s retains the common screen and attributes the recorded provider only for history', source => {
    const f = screenFixture(source); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    const logo = screen.queryByRole('img', { name: 'Hudl Statsbomb' });
    if (source === 'historical') expect(logo).toHaveAttribute('src', statsbombIcon);
    else expect(logo).not.toBeInTheDocument();
  });
  // TP226: GRF y TimePitch usan el armazón de emisión (tres pestañas + Análisis, barra bajo el campo); el histórico sigue con seis.
  it.each<MatchSource>(['historical', 'grf', 'timepitch'])('%s uses the same paused transport, scoreboard and pitch with its tabs', async source => {
    const f = screenFixture(source);
    const { container } = render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    expect(container.querySelectorAll('[data-unified-scoreboard]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-unified-transport]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-unified-events]')).toHaveLength(1);
    expect(screen.getAllByRole('tab').map(t => t.id.split('-').at(-1))).toEqual(source === 'historical' ? ['match', 'summary', 'players', 'maps', 'effort', 'data'] : ['broadcast', 'card', 'lineups', 'summary', 'maps', 'effort']);
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^1×/ })).toHaveAttribute('aria-pressed', 'true');
    // TP251: en la emisión el botón dice cuánto dura el partido; su nombre accesible empieza por la velocidad.
    expect(within(screen.getByRole('group', { name: 'Speed' })).getAllByRole('button').map(o => (o.getAttribute('aria-label') ?? o.textContent ?? '').split(':')[0])).toEqual(['1×', '5×', '10×', '20×', '60×', '120×']);
    expect(container.querySelector('[data-unified-transport]')!.compareDocumentPosition(container.querySelector('canvas')!) & (source === 'historical' ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING)).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Match position' })).toHaveValue('0');
    await waitFor(() => expect(f.adapter.loadPanel).toHaveBeenCalled());
  });

  it('navigates tabs with arrows/Home/End without losing keyboard focus', () => {
    const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    const first = screen.getByRole('tab', { name: 'Match' }); first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' }); expect(screen.getByRole('tab', { name: 'Data' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' }); expect(first).toHaveFocus();
  });

  it('filters and inspects an event, seeks its recorded time and opens the exact player', async () => {
    const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Event type' }), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /pass ·/ }));
    expect(screen.getByText('source:event')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Watch event' }));
    await waitFor(() => expect(f.adapter.ensure).toHaveBeenCalledWith(0, expect.any(AbortSignal), expect.objectContaining({ explicitSeek: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Synthetic home player' }));
    expect(screen.getByRole('dialog', { name: 'Player detail' })).toBeInTheDocument();
    expect(f.adapter.loadPlayer).toHaveBeenCalledWith('test:home:1', expect.any(AbortSignal));
    expect(screen.queryByText('future-card')).not.toBeInTheDocument();
  });

  it('seeks actual source phases and replays at the chosen speed, keeping section', async () => {
    const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^20×/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Phase' }), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('5000'));
    fireEvent.click(screen.getByRole('tab', { name: 'Maps' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '10000' } });
    await waitFor(() => expect(screen.getByText('Final analysis revealed')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Maps' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Replay' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('0'));
    expect(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^20×/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: 'Maps' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps focused filters and transport mounted across cutoff reads; passes explicit demand', async () => {
    const f = screenFixture('timepitch'); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    const filter = screen.getByRole('combobox', { name: 'Event type' }); filter.focus();
    const slider = screen.getByRole('slider');
    act(() => f.publish({ ...f.adapter.snapshot(), panels: { ...f.initial.panels, match: { ...f.panel, cutoff: { elapsedMs: 0, period: 1, periodMs: 0 } } } }));
    expect(filter).toHaveFocus(); expect(screen.getByRole('slider')).toBe(slider);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(f.adapter.loadPanel).toHaveBeenCalledWith('match', expect.any(Number), false, expect.any(AbortSignal), expect.objectContaining({ playback: 'playing' })));
  });

  it('requests an exact statistics cutoff for an explicit seek while playing, rather than pre-rounding it', async () => {
    const f = screenFixture('timepitch'); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '5200' } });
    await waitFor(() => expect(f.adapter.loadPanel).toHaveBeenCalledWith('match', 5200, false, expect.any(AbortSignal), expect.objectContaining({ explicitSeek: true, playback: 'playing' })));
  });

  it('hides synthetic players and ball without losing recorded anchors or the actual camera projection', () => {
    const f = screenFixture(); const { container } = render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Synthetic movement' }));
    expect(container.querySelector('[data-anchor="anchor-1"]')).toBeInTheDocument();
    expect(screen.getByText('Fixture cut')).toBeInTheDocument();
    expect(within(screen.getByRole('combobox', { name: 'Inspect player' })).getAllByRole('option')).toHaveLength(1);
    const old = container.querySelector('[data-anchor="anchor-1"] circle')!.getAttribute('cx');
    fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), { target: { value: 'overview' } });
    expect(container.querySelector('[data-anchor="anchor-1"] circle')!.getAttribute('cx')).not.toBe(old);
  });

  it.each<MatchSource>(['historical', 'grf', 'timepitch'])('renders the actual %s adapter through the same fixture screen', async source => {
    const fixture = sourceReaders();
    const adapter = source === 'historical' ? createHistoricalSession(fixture.match.id, 'v1', { readers: fixture.readers }) : source === 'grf' ? createGrfSession('saved-fixture', modernGrf()) : createTimePitchSession('saved-fixture', legacyRecord(), { statistics: async (_id, ms) => bundle(ms) });
    const { container } = render(<MatchCentre adapter={adapter} visible onBack={() => {}} />);
    await waitFor(() => expect(adapter.snapshot().loadState).toBe('ready'));
    expect(container.querySelectorAll('[data-unified-match-centre]')).toHaveLength(1);
    expect(screen.getAllByRole('tab')).toHaveLength(source === 'historical' ? 6 : 6);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('0');
  });

  it('does not require tracking or a known duration to inspect source facts', () => {
    const f = screenFixture();
    f.initial.descriptor.durationMs = null; f.initial.interval = null; f.initial.loadState = 'facts_only';
    f.initial.clockMs = null; f.initial.descriptor.periods = [{ period: 1, startMs: null, durationMs: null }];
    render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByText(/Movement is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pass ·/ })).toBeEnabled();
  });

  it('keeps a source participant with missing catalogue identity inspectable', () => {
    const f = screenFixture(); f.initial.events = [{ ...f.initial.events[0], actorId: 'source:missing', participantIds: ['source:missing'] }];
    render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pass ·/ }));
    fireEvent.click(screen.getByRole('button', { name: 'source:missing' }));
    expect(screen.getByRole('dialog', { name: 'Player detail' })).toBeInTheDocument();
    expect(screen.queryByText('Midfielder')).not.toBeInTheDocument();
  });

  it('exposes the recorded route and never fills a missing endpoint from a synthetic position', () => {
    const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pass ·/ }));
    expect(screen.getByRole('img', { name: /Recorded action route/ })).toBeInTheDocument();
    act(() => f.publish({ ...f.adapter.snapshot(), events: [{ ...f.initial.events[0], details: { location: { x: 10, y: 20 } } }] }));
    expect(screen.queryByRole('img', { name: /Recorded action route/ })).not.toBeInTheDocument();
  });

  it('keeps reached goal milestones inspectable beyond the current event window, without future goals', () => {
    const f = screenFixture();
    f.initial.events = [];
    f.initial.milestones = [{ ...screenFixture().initial.events[0], id: 'reached-goal', kind: 'goal', sourceIndex: null }, { ...screenFixture().initial.events[0], id: 'future-goal', kind: 'future-goal', elapsedMs: 9000 }];
    render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /goal ·/ }));
    expect(screen.getByRole('button', { name: 'Watch event' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /future-goal/ })).not.toBeInTheDocument();
  });

  it('returns focus to the active tab if the player opener becomes hidden', () => {
    const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    const opener = screen.getByRole('combobox', { name: 'Inspect player' }); opener.focus();
    fireEvent.change(opener, { target: { value: 'test:home:1' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close player detail' }));
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus();
  });
});
describe('TP226: simulated matches open in the broadcast shell and start by themselves', () => {
  const reduceMotion = (matches: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query.includes('reduce'), media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList);
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each<MatchSource>(['grf', 'timepitch'])('%s shows the shell bar, honest provenance and the events beside the pitch', source => {
    const f = screenFixture(source); const back = vi.fn();
    const { container } = render(<MatchCentre adapter={f.adapter} visible onBack={back} />);
    const bar = container.querySelector('[data-simulated-appbar]') as HTMLElement;
    // TP239: una sola fila: «Nuevo partido», el partido y un chip de procedencia.
    expect(within(bar).getByRole('button', { name: 'New match' })).toBeInTheDocument();
    expect(within(bar).getByText(`Fictional match · ${source === 'grf' ? 'GRF' : 'TimePitch'}`)).toBeInTheDocument();
    expect(container.querySelector('[data-simulated-side] [data-unified-events]')).toBeInTheDocument();
    expect(container.querySelector('.tp-shell [data-playback-panel] [data-unified-transport]')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'New match' })); expect(back).toHaveBeenCalledTimes(1);
  });
  it('historical reconstruction keeps its six tabs and no simulated bar', () => {
    const f = screenFixture('historical'); const { container } = render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} autoplay={false} />);
    expect(container.querySelector('.tp-shell')).toBeNull(); expect(screen.getAllByRole('tab')).toHaveLength(6);
  });
  it('autoplay starts once at 10× and does not restart after a pause', async () => {
    reduceMotion(false);
    const f = screenFixture('timepitch'); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} autoplay />);
    const pause = await screen.findByRole('button', { name: 'Pause' });
    expect(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^10×/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pause); await act(async () => {});
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play the match' })).not.toBeInTheDocument();
  });
  it('without autoplay the match opens paused at 1×', () => {
    const f = screenFixture('timepitch'); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^1×/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('with reduced motion it does not start and offers a big play button over the pitch', async () => {
    reduceMotion(true);
    const f = screenFixture('timepitch'); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} autoplay />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    const big = screen.getByRole('button', { name: 'Play the match' });
    fireEvent.click(big);
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play the match' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Speed' })).getByRole('button', { name: /^10×/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
