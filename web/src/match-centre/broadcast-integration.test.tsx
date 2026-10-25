// G17 · Integración de la capa de emisión en el Match Centre: rótulos por stepAnnouncer, marcador de emisión,
// chip del motor grabado, créditos, alineaciones y la demo con selector de movimiento.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { DemoMatch, DEMO_MATCH } from './DemoMatch';
import { createRecordedSession } from './adapters/recorded-session';
import { ENGINE_PROFILES, type RecordedReplayIndex } from './adapters/recorded-replay';
import { normalizeRecording, type RecordedEngineId } from './adapters/recorded-track';
import { bytesOf, entryFor, rawRecording } from './adapters/recorded-fixtures';
import { buildAnnouncements, minuteLabel, SOURCE_KINDS } from './announcements/announcements';
import { parseWorkspaceHash, formatWorkspaceHash } from './navigation';

afterEach(() => vi.restoreAllMocks());

const touchlines = () => createRecordedSession('touchlines-fixture', normalizeRecording(rawRecording('touchlines'), ENGINE_PROFILES.touchlines));
const slider = () => screen.getByRole('slider', { name: 'Match position' });
const banner = () => document.querySelector('.tp-banner') as HTMLElement | null;

describe('recorded source family', () => {
  it('announces goals and period ends always, the rest only per engine (TP202), with absolute-clock minutes', () => {
    expect([...SOURCE_KINDS.recorded].sort()).toEqual(['corner', 'foul', 'full_time', 'goal', 'half_time', 'kick_off', 'offside', 'own_goal', 'penalty', 'shot_off_target', 'shot_saved']);
    for (const k of ['yellow', 'second_yellow', 'red', 'substitution', 'shot_blocked'] as const) expect(SOURCE_KINDS.recorded.has(k)).toBe(false);
    expect(minuteLabel('recorded', 2, 46 * 60000)).toBe("47'");
  });
});

describe('Match Centre broadcast layer', () => {
  it('shows the engine chip, no chronicle and the credits for a recorded match', async () => {
    render(<MatchCentre adapter={touchlines()} visible onBack={() => {}} />);
    expect(screen.getByText(/Movement: TouchLines/)).toBeInTheDocument();
    expect(document.querySelector('[data-unified-scoreboard] .tp-scorebug')).toBeInTheDocument();
    expect(screen.queryByText(/chronicle/i)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Credits and licences' }));
    const dialog = screen.getByRole('dialog', { name: 'Credits and licences' });
    expect(dialog.querySelector('[data-attribution="engine:touchlines"]')).toHaveTextContent(/^Engine: TouchLines/);
    expect(dialog.querySelector('[data-attribution="statsbomb"]')).not.toBeInTheDocument();
  });

  it('a forward seek over a goal shows its banner once; seeking back above it shows none', async () => {
    render(<MatchCentre adapter={touchlines()} visible onBack={() => {}} />);
    await waitFor(() => expect(document.querySelector('canvas, .pitch-canvas-container')).toBeInTheDocument());
    expect(banner()?.textContent ?? '').toBe('');
    fireEvent.change(slider(), { target: { value: '300' } });
    await waitFor(() => expect(banner()).toHaveTextContent('GOAL'));
    expect(banner()).toHaveTextContent('Simulated · TouchLines');
    expect(banner()).toHaveTextContent('1–0');
    expect(banner()).toHaveAttribute('aria-live', 'assertive');
    fireEvent.change(slider(), { target: { value: '100' } });
    await waitFor(() => expect(banner()?.textContent ?? '').toBe(''));
    await waitFor(() => expect(document.querySelector('[data-unified-scoreboard] .tp-sb-digits')).toHaveTextContent('0–0'));
  });

  it('players section shows both line-ups; an unlinked player keeps the source jersey or «—»', async () => {
    render(<MatchCentre adapter={touchlines()} visible onBack={() => {}} initialSection="players" />);
    const home = await screen.findByRole('region', { name: 'Chelsea 2015/16' });
    expect(within(home).getAllByRole('button', { name: /home 0/ }).length).toBeGreaterThan(0);
    expect(within(home).getByText('Starting XI')).toBeInTheDocument();
    const row = within(home).getAllByRole('button', { name: /home 3/ }).find(b => b.classList.contains('tp-lu-row'))!;
    expect(row.querySelector('.tp-lu-n')).toHaveTextContent('—');
    fireEvent.click(row);
    // Sin ficha ni aspecto asignado: se abre el detalle técnico, no una ficha inventada.
    expect(screen.getByRole('dialog', { name: 'Player detail' })).toBeInTheDocument();
  });

  it('recorded announcements carry the absolute-clock minute and score', () => {
    const adapter = touchlines();
    return adapter.ensure(700, new AbortController().signal).then(() => {
      const [goal] = buildAnnouncements('recorded', adapter.snapshot().events);
      expect(goal).toMatchObject({ kind: 'goal', side: 'home', scoreAfter: { home: 1, away: 0 }, minuteLabel: "1'", provenance: 'simulated' });
    });
  });
});

describe('demo match', () => {
  it('routes #/demo', () => {
    expect(parseWorkspaceHash('#/demo')).toEqual({ mode: 'demo' });
    expect(formatWorkspaceHash({ mode: 'demo' })).toBe('#/demo');
  });

  async function demoIndex() {
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    const recordings = [];
    for (const engine of ['touchlines', 'open-football'] as RecordedEngineId[]) {
      const raw = rawRecording(engine), config = (raw.input as { config: Record<string, unknown> }).config;
      config.home_key = DEMO_MATCH.home_key; config.away_key = DEMO_MATCH.away_key; config.seed = DEMO_MATCH.seed;
      const bytes = bytesOf(raw), entry = await entryFor(engine, raw, bytes);
      const demo = { ...entry, id: `demo:${engine}`, file: `demo/${engine}.json`, home_key: DEMO_MATCH.home_key, away_key: DEMO_MATCH.away_key, seed: DEMO_MATCH.seed };
      files[demo.file] = bytes; recordings.push(demo);
    }
    const index: RecordedReplayIndex = { recordings, rejected: [] };
    const read = vi.fn(async (file: string) => files[file].slice().buffer);
    return { index, read };
  }

  it('labels the fictional match, offers the three engines in order and keeps the playhead when switching', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const { index, read } = await demoIndex();
    render(<DemoMatch visible onBack={() => {}} index={index} read={read} />);
    expect(screen.getAllByText('Fictional cross-era simulation')[0]).toBeInTheDocument();
    const selector = document.querySelector('[data-movement-selector]') as HTMLElement;
    const buttons = within(selector).getAllByRole('button');
    expect(buttons.map(b => b.textContent?.split('·')[0])).toEqual(['GRF', 'TouchLines', 'open-football']);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0]).toHaveTextContent('not available');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    await screen.findByText(/Movement: TouchLines/);
    // Segunda parte, 100 ms dentro de ella (muestra 5 de la grabación de TouchLines).
    fireEvent.change(slider(), { target: { value: '500' } });
    await waitFor(() => expect(slider()).toHaveValue('500'));
    await act(async () => { fireEvent.click(buttons[2]); });
    await screen.findByText(/Movement: open-football/);
    expect(read).toHaveBeenLastCalledWith('demo/open-football.json', expect.any(AbortSignal));
    await waitFor(() => expect(slider()).toHaveValue('500'));
  });

  it('wraps the demo in the broadcast shell: appbar, three screens and a secondary analysis group (mockup v1-2d)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const { index, read } = await demoIndex();
    const onBack = vi.fn();
    render(<DemoMatch visible onBack={onBack} index={index} read={read} />);
    await screen.findByText(/Movement: TouchLines/);
    const appbar = document.querySelector('[data-demo-appbar]') as HTMLElement;
    // TP211: sin segunda marca (la cabecera global ya la lleva) y un único chip de procedencia con su explicación.
    expect(within(appbar).queryByText('TimePitch')).toBeNull();
    const chip = within(appbar).getByRole('button', { name: /^Fictional\s*·\s*simulated$/ });
    expect(chip).toHaveClass('chip', 'ph');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    const explanation = document.getElementById(chip.getAttribute('aria-controls')!) as HTMLElement;
    expect(chip).toHaveAccessibleDescription(/Fictional cross-era simulation.*Synthetic movement.*Simulated events.*Not a real match and not historical tracking/);
    expect(explanation).toHaveTextContent('Synthetic movement recorded from a football engine');
    fireEvent.click(chip); expect(chip).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(chip, { key: 'Escape' }); expect(chip).toHaveAttribute('aria-expanded', 'false');
    // «Volver» vive solo en la barra superior, como botón de icono con nombre accesible.
    expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1);
    fireEvent.click(within(appbar).getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    const tabs = within(document.querySelector('[data-broadcast-tabs]') as HTMLElement).getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Live broadcast', 'Player card', 'Line-ups', 'Summary', 'Maps', 'Effort']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('[data-unified-scoreboard]')).toBeInTheDocument();
    expect(within(document.querySelector('[data-playback-panel]') as HTMLElement).getByRole('slider')).toBeInTheDocument();
    // Alineaciones: cabecera del partido, sin marcador de emisión ni barra de reproducción.
    fireEvent.click(tabs[2]);
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Match details' })).toBeInTheDocument();
    expect(document.querySelector('[data-unified-scoreboard]')).toBeNull();
    expect(document.querySelector('[data-playback-panel]')).toBeNull();
    // Elegir un jugador en las alineaciones abre la pestaña Ficha, con su selector.
    fireEvent.click(within(document.querySelector('[data-lineups-screen]') as HTMLElement).getAllByRole('button', { name: /^home 3$|home 3\b/ })[0]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    const card = document.querySelector('[data-card-screen]') as HTMLElement;
    expect(within(card).getByRole('navigation', { name: 'Choose player' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /home 3/, pressed: true })).toBeInTheDocument();
    // Sin cajón flotante: la ficha va dentro de la pestaña.
    expect(document.querySelector('.unified-card-drawer')).toBeNull();
  });

  it.each(['retro-1', 'stylized-3d-1'])('opens the demo in 3D and migrates an implicit v1 %s preference', async renderer => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    localStorage.setItem('timepitch.pitch.v1', JSON.stringify({ version: 1, renderer, appearance: 'daylight', camera: 'follow', detail: 'standard' }));
    try {
      const { index, read } = await demoIndex();
      render(<DemoMatch visible onBack={() => {}} index={index} read={read} />);
      await screen.findByText(/Movement: TouchLines/);
      expect(document.querySelector('.pitch-section')).toHaveAttribute('data-requested-renderer', 'stylized-3d-1');
      expect(JSON.parse(localStorage.getItem('timepitch.pitch.v1')!)).toMatchObject({ version: 2, renderer: 'stylized-3d-1', rendererChosen: false });
      expect(screen.getByRole('combobox', { name: 'Graphics', hidden: true })).toHaveValue('stylized-3d-1');
    } finally { localStorage.removeItem('timepitch.pitch.v1'); }
  });

  it('keeps an explicit 3D choice in the demo', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    localStorage.setItem('timepitch.pitch.v1', JSON.stringify({ version: 2, renderer: 'stylized-3d-1', rendererChosen: true, appearance: 'daylight', camera: 'follow', detail: 'standard' }));
    try {
      const { index, read } = await demoIndex();
      render(<DemoMatch visible onBack={() => {}} index={index} read={read} />);
      await screen.findByText(/Movement: TouchLines/);
      expect(document.querySelector('.pitch-section')).toHaveAttribute('data-requested-renderer', 'stylized-3d-1');
      expect(screen.getByRole('combobox', { name: 'Graphics', hidden: true })).toHaveValue('stylized-3d-1');
    } finally { localStorage.removeItem('timepitch.pitch.v1'); }
  });
});
