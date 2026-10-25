import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { MatchAudio } from '../audio/engine';
import { GENERIC_APPEARANCE } from '../../presentation/types';
import { NEUTRAL_KIT } from '../../presentation/avatar/portrait-svg';
import { AnimeCutIns } from './AnimeCutIns';
import type { CutIn } from './cutins';
import type { CutInSpec } from './scene';

// TP234 · Capitán Hane: the layer pauses the clock for the scene, resumes it after, and a click or a key skips it.
const goal: Announcement = { id: 'goal@1000', kind: 'goal', priority: 100, minuteLabel: "1'", atMs: 1000, side: 'home', primaryPlayerId: 'home:9',
  provenance: 'simulated', durationMs: 6000 };
const spec = (cut: CutIn): CutInSpec => ({ kind: cut.kind, actor: { appearance: GENERIC_APPEARANCE, kit: NEUTRAL_KIT, number: '9', name: 'Test Nine' }, keeper: null,
  moveName: 'POLAR STORM', ability: null, keeperAbility: null, skyPassFrom: null, outcomeText: 'GOAL!!' });
const labels = { dialog: 'Captain Hane scene', skip: 'Click or press any key to skip', describe: (s: CutInSpec) => `${s.actor?.name} · ${s.moveName}` };
type Props = { cursorMs: number; playing: boolean; speed?: number; scenes?: 'all' | 'goals' | 'none'; reducedMotion?: boolean };

function setup(soundOn = true) {
  const pause = vi.fn(), play = vi.fn(), audio: MatchAudio = { unlock: vi.fn(), play: vi.fn(), setAmbience: vi.fn(), playAnime: vi.fn() };
  const ui = (p: Props) => <AnimeCutIns events={[]} announcements={[goal]} cursorMs={p.cursorMs} speed={p.speed ?? 1} playing={p.playing} seekToken={0} seeking={false}
    scenes={p.scenes ?? 'all'} reducedMotion={p.reducedMotion ?? false} soundOn={soundOn} pause={pause} play={play} specFor={spec} labels={labels} audio={audio} />;
  const view = render(ui({ cursorMs: 800, playing: true }));
  view.rerender(ui({ cursorMs: 900, playing: true }));
  return { pause, play, audio, view, ui };
}

describe('AnimeCutIns', () => {
  it('pauses on the recorded goal, shows the scene, plays whoosh/charge/impact, and resumes after its duration', async () => {
    vi.useFakeTimers();
    try {
      const { pause, play, audio, view, ui } = setup();
      view.rerender(ui({ cursorMs: 1010, playing: true }));
      expect(pause).toHaveBeenCalledTimes(1);
      view.rerender(ui({ cursorMs: 1010, playing: false }));
      await act(async () => { await vi.dynamicImportSettled?.(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(audio.playAnime).toHaveBeenCalledWith({ kind: 'whoosh' });
      expect(audio.playAnime).toHaveBeenCalledWith(expect.objectContaining({ kind: 'charge' }));
      expect(play).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      expect(audio.playAnime).toHaveBeenCalledWith({ kind: 'impact' });
      expect(play).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-anime-cutin]')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('a click on the scene skips it and resumes at once; a key does too', async () => {
    for (const how of ['click', 'key'] as const) {
      const { play, view, ui } = setup(false);
      view.rerender(ui({ cursorMs: 1010, playing: true }));
      view.rerender(ui({ cursorMs: 1010, playing: false }));
      const scene = await screen.findByRole('dialog', { name: 'Captain Hane scene' });
      expect(scene.querySelector('svg.hane-cutin')).not.toBeNull();
      expect(scene.textContent).toContain('Test Nine · POLAR STORM');
      if (how === 'click') fireEvent.click(scene); else fireEvent.keyDown(window, { key: ' ' });
      expect(play).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Captain Hane scene' })).toBeNull();
      view.unmount();
    }
  });
  it('no scene above 20×, none with «none», and reduced motion uses the static card', async () => {
    const fast = setup(false);
    fast.view.rerender(fast.ui({ cursorMs: 900, playing: true, speed: 25 }));
    fast.view.rerender(fast.ui({ cursorMs: 1010, playing: true, speed: 25 }));
    expect(fast.pause).not.toHaveBeenCalled(); fast.view.unmount();
    const off = setup(false);
    off.view.rerender(off.ui({ cursorMs: 1010, playing: true, scenes: 'none' }));
    expect(off.pause).not.toHaveBeenCalled(); off.view.unmount();
    const still = setup(false);
    still.view.rerender(still.ui({ cursorMs: 1010, playing: true, reducedMotion: true }));
    const scene = await screen.findByRole('dialog', { name: 'Captain Hane scene' });
    expect(scene.className).toContain('hane-reduced');
    expect(scene.querySelector('svg.hane-card')).not.toBeNull();
    expect(scene.getAttribute('style')).toContain('1200ms');
    still.view.unmount();
  });
  it('leaving the mode during a scene resumes the match', () => {
    const { play, view, ui } = setup(false);
    view.rerender(ui({ cursorMs: 1010, playing: true }));
    view.unmount();
    expect(play).toHaveBeenCalledTimes(1);
  });
});
