import { describe, expect, it } from 'vitest';
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView } from '../../match-centre/session';
import { cueSources, initialSoundState, kickGapMs, stepSounds, type CueSource, type SoundStepInput, type SoundStepState } from './cues';

const ann = (kind: Announcement['kind'], atMs: number): Announcement => ({ id: `${kind}@${atMs}`, kind, priority: 50, minuteLabel: '', atMs, side: null,
  primaryPlayerId: null, provenance: 'simulated', durationMs: 3000 });
const ev = (kind: string, elapsedMs: number | null): EventView => ({ id: `${kind}#${elapsedMs}`, sourceIndex: 0, kind, period: 1, periodMs: elapsedMs ?? 0,
  elapsedMs, side: 'home', actorId: null, participantIds: [], outcome: null, provenance: 'simulated', refs: [], details: {} });
const input = (over: Partial<SoundStepInput> = {}): SoundStepInput => ({ cursorMs: 0, wallMs: 0, speed: 1, playing: true, seekToken: 0, seeking: false, ...over });
/** Avanza el cursor por los puntos dados (pared a 16 ms por paso) y devuelve lo que sonó en cada paso no vacío. */
function run(sources: readonly CueSource[], cursors: readonly number[], over: Partial<SoundStepInput> = {}, start: SoundStepState = initialSoundState()) {
  let state = start; const heard: string[][] = [];
  cursors.forEach((cursorMs, i) => {
    const step = stepSounds(state, sources, input({ cursorMs, wallMs: i * 16, ...over })); state = step.state;
    if (step.cues.length) heard.push(step.cues);
  });
  return { state, heard };
}

describe('event → sound mapping', () => {
  it('maps whistles, goals and chances from announcements and kicks from raw pass/shot events of every engine', () => {
    const sources = cueSources(
      [ev('pass', 100), ev('Pass', 200), ev('Shot', 300), ev('shot_on_target', 400), ev('carry', 500), ev('pass', null), ev('tackle', 600)],
      [ann('kick_off', 0), ann('half_time', 2700000), ann('full_time', 5400000), ann('goal', 300), ann('own_goal', 900),
        ann('shot_saved', 1000), ann('shot_off_target', 1100), ann('shot_blocked', 1200), ann('foul', 1300), ann('yellow', 1400)]);
    expect(sources.map(s => `${s.cue}@${s.atMs}`).sort()).toEqual([
      'goal@300', 'goal@900', 'kick@100', 'kick@200', 'ooh@1000', 'ooh@1100', 'ooh@1200', 'shot@300', 'shot@400',
      'whistle-full@5400000', 'whistle-half@2700000', 'whistle-kickoff@0'].sort());
  });
  it('fires what the playing cursor crosses, including the kick-off whistle at 0', () => {
    const sources = cueSources([ev('pass', 500)], [ann('kick_off', 0), ann('goal', 1000)]);
    expect(run(sources, [0, 16, 520, 1010]).heard).toEqual([['whistle-kickoff'], ['kick'], ['goal']]);
  });
  it('a goal swallows the "ooh" of the same step and orders whistles before the goal', () => {
    const sources = cueSources([ev('shot', 1000)], [ann('shot_saved', 1000), ann('goal', 1000), ann('half_time', 1000)]);
    expect(run(sources, [900, 1000]).heard).toEqual([['whistle-half', 'goal', 'shot']]);
  });
});

describe('throttling at speed', () => {
  // Un pase cada 200 ms de partido durante 60 s.
  const passes = cueSources(Array.from({ length: 300 }, (_, i) => ev('pass', i * 200 + 100)), [ann('goal', 30_050), ann('shot_saved', 20_050)]);
  const steps = (speed: number) => Array.from({ length: Math.ceil(60_000 / (16 * speed)) + 1 }, (_, i) => Math.min(60_000, i * 16 * speed));
  it('at 1× each kick sounds, but never two within the minimum gap', () => {
    const { heard } = run(passes, steps(1), { speed: 1 });
    expect(heard.flat().filter(c => c === 'kick').length).toBeGreaterThan(250);
  });
  it('at 10× kicks are thinned to one per ~0.7 s of real time', () => {
    const { heard } = run(passes, steps(10), { speed: 10 });
    const kicks = heard.flat().filter(c => c === 'kick').length, realSeconds = 60 / 10;
    expect(kickGapMs(10)).toBe(700);
    expect(kicks).toBeGreaterThan(4); expect(kicks).toBeLessThanOrEqual(Math.ceil(realSeconds * 1000 / 700) + 1);
    expect(heard.flat()).toContain('ooh'); expect(heard.flat()).toContain('goal');
  });
  it.each([20, 60, 120])('above 10× (%i×) only goals and whistles sound', speed => {
    const { heard } = run(passes, steps(speed), { speed });
    expect(heard).toEqual([['goal']]);
  });
});

describe('seek and pause', () => {
  const sources = cueSources([ev('pass', 5000)], [ann('goal', 10_000), ann('full_time', 20_000)]);
  it('paused: nothing sounds even if the cursor is moved', () => {
    expect(run(sources, [0, 12_000, 21_000], { playing: false }).heard).toEqual([]);
  });
  it('a seek (new token, settling move or pending seek) jumps over events silently; play resumes from there', () => {
    let state = run(sources, [0, 100]).state;
    let step = stepSounds(state, sources, input({ cursorMs: 100, seekToken: 1 })); expect(step.cues).toEqual([]);
    step = stepSounds(step.state, sources, input({ cursorMs: 12_000, seekToken: 1 })); expect(step.cues).toEqual([]);
    step = stepSounds(step.state, sources, input({ cursorMs: 12_016, seekToken: 1 })); expect(step.cues).toEqual([]);
    step = stepSounds(step.state, sources, input({ cursorMs: 13_000, seekToken: 1, seeking: true })); expect(step.cues).toEqual([]);
    state = step.state;
    expect(run(sources, [19_990, 20_005], { seekToken: 1 }, state).heard).toEqual([['whistle-full']]);
  });
  it('going backwards or jumping further than the speed allows is a seek', () => {
    expect(run(sources, [11_000, 4_000, 4_016]).heard).toEqual([]);
    expect(run(sources, [0, 16, 10_500]).heard).toEqual([]);
    expect(run(sources, [0, 16, 10_500], { speed: 10 }).heard).toEqual([['goal', 'kick']]);
  });
  it('a fresh state (engine switch remounts the centre) only takes its bearings on the first step', () => {
    expect(run(sources, [10_000, 10_016]).heard).toEqual([]);
  });
});
