import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PlaybackControls, realDuration, type TransportMark } from './PlaybackControls';
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
