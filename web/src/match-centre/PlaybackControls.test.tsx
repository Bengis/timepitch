import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { PlaybackControls, realDuration, transportMarkGroups, type TransportMark } from './PlaybackControls';
import { LanguageProvider } from '../i18n';
import type { PlaybackState } from './playback';
import type { SessionDescriptor } from './session';

const state = (over: Partial<PlaybackState> = {}) => ({ elapsedMs: 30_000, pendingSeekMs: null, speed: 1, wantsPlay: false, isPlaying: false, status: 'paused', ...over }) as PlaybackState;
const descriptor = (over: Partial<SessionDescriptor> = {}) => ({ durationMs: 120_000, periods: [{ period: 1, startMs: 0, durationMs: 60_000 }, { period: 2, startMs: 60_000, durationMs: 60_000 }], ...over }) as SessionDescriptor;
const marks: TransportMark[] = [{ id: 'g', atMs: 20_000, seekMs: 17_000, label: 'Goal 20\'', kind: 'goal', icon: <svg data-testid="goal-icon" /> }, { id: 'r', atMs: 90_000, seekMs: 87_000, label: 'Red card 90\'', kind: 'card_red' }];

function setup(props: { s?: PlaybackState; d?: SessionDescriptor; marks?: TransportMark[] } = {}) {
  const fn = { onPlay: vi.fn(), onPause: vi.fn(), onSeek: vi.fn(), onSpeed: vi.fn(), onReplay: vi.fn() };
  const view = render(<PlaybackControls state={props.s ?? state()} descriptor={props.d ?? descriptor()} cursor={{ elapsedMs: 30_000, period: 1, periodMs: 30_000 }} marks={props.marks} {...fn} />);
  return { ...fn, view };
}

describe('PlaybackControls (barra de emisión)', () => {
  it('shows zero time left once ended even when the presented frame trails the playback clock', () => {
    const view = render(<PlaybackControls state={state({ status: 'ended', isMatchEnd: true, elapsedMs: 119_990 })} descriptor={descriptor()}
      cursor={{ elapsedMs: 119_990, period: 2, periodMs: 59_990 }} clock={{ now: '93:05', end: "90'" }}
      onPlay={vi.fn()} onPause={vi.fn()} onSeek={vi.fn()} onSpeed={vi.fn()} onReplay={vi.fn()} />);
    expect(view.container.querySelector('.unified-playback-time')).toHaveTextContent('93:05 · left 0 s');
    expect(realDuration(0, 1)).toBe('0 s');
  });
  it('separates half-time from nearby goals and preserves every clustered event destination', () => {
    const close: TransportMark[] = [
      { id: 'g44', atMs: 44_000, seekMs: 41_000, label: "Goal 44'", kind: 'goal' },
      { id: 'g44b', atMs: 44_500, seekMs: 41_500, label: "Goal 44.5'", kind: 'goal' },
      { id: 'ht', atMs: 45_000, seekMs: 45_000, label: 'Half-time', kind: 'halftime' },
      { id: 'g80', atMs: 80_000, seekMs: 77_000, label: "Goal 80'", kind: 'goal' },
    ];
    const groups = transportMarkGroups(close, 90_000, 280);
    expect(groups.map(g => g.marks.map(m => m.id))).toEqual([['g44', 'g44b'], ['g80']]);
    for (let i = 1; i < groups.length; i++) expect((groups[i].atMs - groups[i - 1].atMs) / 90_000 * 280).toBeGreaterThanOrEqual(44);
    const { view, onSeek } = setup({ marks: close, d: descriptor({ durationMs: 90_000 }) });
    expect(view.container.querySelector('.pbk-marks [data-kind="halftime"]')).toBeNull();
    expect(view.container.querySelector('.pbk-meta')).toContainElement(screen.getByRole('button', { name: 'Half-time' }));
    const select = screen.getByRole('combobox', { name: 'Choose an event' });
    fireEvent.change(select, { target: { value: 'g44' } }); expect(onSeek).toHaveBeenLastCalledWith(41_000);
    fireEvent.change(select, { target: { value: 'g44b' } }); expect(onSeek).toHaveBeenLastCalledWith(41_500);
    fireEvent.click(screen.getByRole('button', { name: 'Half-time' })); expect(onSeek).toHaveBeenLastCalledWith(45_000);
  });
  it('puts the rail before the transport actions and briefly confirms real event seeks', () => {
    vi.useFakeTimers();
    try {
      const { onSeek, view } = setup({ marks });
      const rail = view.container.querySelector('.pbk-scrub')!, buttons = view.container.querySelector('.pbk-btns')!;
      expect(rail.compareDocumentPosition(buttons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(view.container.querySelector('.pbk-feedback')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: "Goal 20'" }));
      expect(onSeek).toHaveBeenLastCalledWith(17_000);
      expect(view.container.querySelector('.pbk-feedback')).toHaveTextContent("Goal 20'");
      expect(view.container.querySelector('.unified-playback-time')).toHaveAttribute('data-seek-feedback');
      act(() => { vi.advanceTimersByTime(700); });
      expect(view.container.querySelector('.pbk-feedback')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('icon buttons keep accessible names: play/pause, ±10 s and previous/next event over the marks', () => {
    const { onPlay, onSeek } = setup({ marks });
    fireEvent.click(screen.getByRole('button', { name: 'Play' })); expect(onPlay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 s' })); expect(onSeek).toHaveBeenLastCalledWith(20_000);
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 s' })); expect(onSeek).toHaveBeenLastCalledWith(40_000);
    fireEvent.click(screen.getByRole('button', { name: 'Previous event' })); expect(onSeek).toHaveBeenLastCalledWith(17_000);
    fireEvent.click(screen.getByRole('button', { name: 'Next event' })); expect(onSeek).toHaveBeenLastCalledWith(87_000);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('unified-play');
  });
  it('shows pause while playing and hides event jumps when the mode has no marks', () => {
    const { onPause } = setup({ s: state({ wantsPlay: true, status: 'playing' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' })); expect(onPause).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Previous event' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next event' })).toBeNull();
  });
  it('native slider stays the scrubber; marks seek and labels show start, half-time from the periods and the end', () => {
    const { onSeek, view } = setup({ marks });
    const slider = screen.getByRole('slider', { name: 'Match position' });
    expect(slider).toHaveValue('30000'); fireEvent.change(slider, { target: { value: '45000' } }); expect(onSeek).toHaveBeenLastCalledWith(45_000);
    fireEvent.click(screen.getByRole('button', { name: 'Goal 20\'' })); expect(onSeek).toHaveBeenLastCalledWith(17_000);
    expect(view.container.querySelector('.unified-mark[data-kind="goal"]')).toContainElement(screen.getByTestId('goal-icon'));
    const labels = view.container.querySelector('.pbk-lbls')!;
    expect(labels).toHaveTextContent("0'Half-time2:00");
    expect(view.container.querySelector<HTMLElement>('.pbk-ht')!.style.getPropertyValue('--pbk-at')).toBe('50%');
    expect(view.container.querySelector<HTMLElement>('.pbk-scrub')!.style.getPropertyValue('--pbk-fill')).toBe('25%');
  });
  it('never invents half-time or jumps without a known duration', () => {
    const { view } = setup({ d: descriptor({ durationMs: null, periods: [{ period: 1, startMs: 0, durationMs: null }] }), marks });
    expect(view.container.querySelector('.pbk-ht')).toBeNull(); expect(view.container.querySelector('.pbk-lbl-ht')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back 10 s' })).toBeDisabled(); expect(screen.getByRole('slider')).toBeDisabled();
    expect(view.container.querySelector('.unified-mark')).toBeNull();
  });
  it('speeds are a segmented group with the pressed state; replay, phase and the playback clock stay', () => {
    const { onSpeed, onReplay, view } = setup({ s: state({ speed: 20 }) });
    const group = screen.getByRole('group', { name: 'Speed' });
    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual(['1×', '5×', '10×', '20×', '60×', '120×']);
    expect(within(group).getByRole('button', { name: '20×' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: '60×' })); expect(onSpeed).toHaveBeenCalledWith(60);
    fireEvent.click(screen.getByRole('button', { name: 'Replay' })); expect(onReplay).toHaveBeenCalledOnce();
    expect(screen.getByRole('combobox', { name: 'Phase' })).toHaveValue('1');
    expect(view.container.querySelector('.unified-playback-time')).toHaveTextContent(/^Playback 0:30 \/ 2:00$/);
  });
  it('TP231: the sound toggle shows its state, is localized and only appears when wired', () => {
    const onToggle = vi.fn(), props = { state: state(), descriptor: descriptor(), cursor: { elapsedMs: 30_000, period: 1, periodMs: 30_000 },
      onPlay: vi.fn(), onPause: vi.fn(), onSeek: vi.fn(), onSpeed: vi.fn(), onReplay: vi.fn() };
    const view = render(<PlaybackControls {...props} />);
    expect(screen.queryByRole('button', { name: 'Sound' })).toBeNull();
    view.rerender(<PlaybackControls {...props} sound={{ enabled: true, onToggle }} />);
    const toggle = screen.getByRole('button', { name: 'Sound' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true'); expect(toggle).toHaveAttribute('title', 'Mute match sound');
    fireEvent.click(toggle); expect(onToggle).toHaveBeenCalledOnce();
    view.rerender(<PlaybackControls {...props} sound={{ enabled: false, onToggle }} />);
    expect(screen.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sound' })).toHaveAttribute('title', 'Turn match sound on');
    view.unmount();
    localStorage.setItem('timepitch.locale', 'es');
    try {
      render(<LanguageProvider><PlaybackControls {...props} sound={{ enabled: true, onToggle }} /></LanguageProvider>);
      expect(screen.getByRole('button', { name: 'Sonido' })).toHaveAttribute('title', 'Silenciar el sonido del partido');
    } finally { localStorage.removeItem('timepitch.locale'); }
  });
});

// TP251: las velocidades se muestran como lo que dura de verdad el partido entero.
it('realDuration turns a recording and a speed into real minutes or seconds', () => {
  expect(realDuration(5_811_700, 1)).toBe('97 min');   // demo GRF, 96:51 de grabación
  expect(realDuration(5_811_700, 20)).toBe('5 min');
  expect(realDuration(300_000, 1)).toBe('5 min');      // TouchLines: 5:00 de grabación para 90'
  expect(realDuration(300_000, 10)).toBe('30 s');
  expect(realDuration(300_000, 120)).toBe('3 s');
});

// TP252: el arranque automático deja el partido en unos 5 minutos, con cualquier motor.
it('autoplaySpeedFor leaves the match at 5 minutes, never in slow motion (TP254)', async () => {
  const { autoplaySpeedFor } = await import('./MatchCentre');
  expect(autoplaySpeedFor(5_811_700)).toBeCloseTo(19.3723, 3); // demo GRF: 96:51 → 5 min
  expect(autoplaySpeedFor(300_000)).toBe(1);                   // TouchLines: 5:00 → 5 min
  expect(autoplaySpeedFor(60_000)).toBe(1);                    // más corta que 5 min: 1×, sin cámara lenta
});

it('TP254: halfOptions offers FIFA-style half lengths that fit the recording, plus its natural length', async () => {
  const { halfOptions } = await import('./PlaybackControls');
  expect(halfOptions(5_811_700, 2).map(o => o.minutes)).toEqual([2, 2.5, 3, 5, 10, 48]); // 48: la demo a 1×
  expect(halfOptions(300_000, 2).map(o => [o.minutes, o.speed])).toEqual([[2, 1.25], [2.5, 1]]);
  expect(halfOptions(308_000, 2).map(o => o.minutes)).toEqual([2, 2.5]); // 2:34 por parte: sin un «2,6» casi igual
});
