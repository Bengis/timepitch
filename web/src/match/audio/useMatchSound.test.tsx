import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView } from '../../match-centre/session';
import type { MatchAudio } from './engine';
import { useMatchSound } from './useMatchSound';

const ann = (kind: Announcement['kind'], atMs: number): Announcement => ({ id: `${kind}@${atMs}`, kind, priority: 50, minuteLabel: '', atMs, side: null,
  primaryPlayerId: null, provenance: 'simulated', durationMs: 3000 });
const events: EventView[] = [];
const announcements = [ann('kick_off', 0), ann('goal', 1000), ann('full_time', 3000)];
type Props = { cursorMs: number; playing?: boolean; speed?: number; seekToken?: number; seeking?: boolean; enabled?: boolean; active?: boolean };
function Probe({ audio, cursorMs, playing = true, speed = 1, seekToken = 0, seeking = false, enabled = true, active = true }: Props & { audio: MatchAudio }) {
  useMatchSound({ events, announcements, cursorMs, speed, playing, seekToken, seeking, enabled, active, audio }); return null;
}
const fakeAudio = () => ({ unlock: vi.fn(), play: vi.fn(), setAmbience: vi.fn() });

describe('useMatchSound', () => {
  it('plays what the clock crosses and keeps the crowd bed only while playing', () => {
    const audio = fakeAudio(), view = render(<Probe audio={audio} cursorMs={0} playing={false} />);
    expect(audio.setAmbience).toHaveBeenLastCalledWith(false);
    view.rerender(<Probe audio={audio} cursorMs={0} />); expect(audio.setAmbience).toHaveBeenLastCalledWith(true);
    view.rerender(<Probe audio={audio} cursorMs={16} />);
    view.rerender(<Probe audio={audio} cursorMs={1010} />);
    expect(audio.play.mock.calls.map(c => c[0])).toEqual(['whistle-kickoff', 'goal']);
    view.rerender(<Probe audio={audio} cursorMs={1010} playing={false} />); expect(audio.setAmbience).toHaveBeenLastCalledWith(false);
    view.unmount(); expect(audio.setAmbience).toHaveBeenLastCalledWith(false);
  });
  it('a seek over the goal is silent; a speed change keeps sync with the clock', () => {
    const audio = fakeAudio(), view = render(<Probe audio={audio} cursorMs={100} />);
    view.rerender(<Probe audio={audio} cursorMs={100} seekToken={1} seeking />);
    view.rerender(<Probe audio={audio} cursorMs={2000} seekToken={1} />);
    view.rerender(<Probe audio={audio} cursorMs={2016} seekToken={1} speed={20} />);
    view.rerender(<Probe audio={audio} cursorMs={3200} seekToken={1} speed={20} />);
    expect(audio.play.mock.calls.map(c => c[0])).toEqual(['whistle-full']);
  });
  it('muted: no cue and no ambience; unmuting later does not replay the backlog', () => {
    const audio = fakeAudio(), view = render(<Probe audio={audio} cursorMs={0} enabled={false} />);
    view.rerender(<Probe audio={audio} cursorMs={16} enabled={false} />);
    view.rerender(<Probe audio={audio} cursorMs={1010} enabled={false} />);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.setAmbience).not.toHaveBeenCalledWith(true);
    view.rerender(<Probe audio={audio} cursorMs={1010} />);
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('a hidden centre (other tab or engine) stays silent', () => {
    const audio = fakeAudio(), view = render(<Probe audio={audio} cursorMs={0} active={false} />);
    view.rerender(<Probe audio={audio} cursorMs={16} active={false} />);
    expect(audio.play).not.toHaveBeenCalled(); expect(audio.setAmbience).not.toHaveBeenCalledWith(true);
  });
});
