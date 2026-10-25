import { describe, expect, it } from 'vitest';
import { GESTURE_MS, gestureFor } from './skeleton-players';
import type { VisualCue } from '../retroScene';
import type { PitchRenderInput } from './types';

// TP244: gestos de los jugadores con esqueleto a partir del aviso de jugada (la pose sobre los huesos se comprobó a ojo).
const ME = { key: 'h7', side: 'home' as const, x: 50, y: 30 };
function input(cue: Partial<VisualCue> | undefined, age: number, restarting = false, ball = { x: 52, y: 30 }): PitchRenderInput {
  const clock = 10_000 + age;
  const frame = { clock_ms: clock, period: 1, ball, players: [] };
  return { frame, previous: { ...frame, clock_ms: clock - 100 }, restarting,
    cue: cue ? { participants: ['h7'], t1_ms: 10_000, ...cue } as VisualCue : undefined } as unknown as PitchRenderInput;
}

describe('gestureFor', () => {
  it('kicks with the recorded foot for the passer or shooter, and only during the kick', () => {
    expect(gestureFor(input({ type: 'shot', bodyPart: 'left_foot' }, 100), ME, false, 0, 0)).toMatchObject({ kind: 'kick', foot: 'left', power: 1.2 });
    expect(gestureFor(input({ type: 'pass' }, 100), ME, false, 0, 0)).toMatchObject({ kind: 'kick', foot: 'right', power: .85 });
    expect(gestureFor(input({ type: 'pass' }, GESTURE_MS.kick + 1), ME, false, 0, 0)).toEqual({ kind: 'run' });
    expect(gestureFor(input({ type: 'pass', participants: ['a3'] }, 100), ME, false, 0, 0)).toEqual({ kind: 'run' });
  });
  it('heads the ball when the recorded body part is the head', () => {
    expect(gestureFor(input({ type: 'pass', bodyPart: 'head' }, 200), ME, false, 0, 0)).toMatchObject({ kind: 'header' });
  });
  it('slides in for the player who wins the ball in a tackle', () => {
    expect(gestureFor(input({ type: 'tackle' }, 300), ME, false, 0, 5)).toMatchObject({ kind: 'slide' });
    expect(gestureFor(input({ type: 'tackle', participants: ['a2', 'h7'] }, 300), ME, false, 0, 5)).toEqual({ kind: 'run' });
    expect(gestureFor(input({ type: 'tackle' }, GESTURE_MS.slide + 1), ME, false, 0, 5)).toEqual({ kind: 'run' });
  });
  it('dives towards a ball wide of the keeper and catches one at the body', () => {
    // Mirando a +y (f = 0) el +X local del cuerpo es +x del campo.
    expect(gestureFor(input({ type: 'save', at: { x: 53, y: 30 } }, 300), ME, true, 0, 0)).toMatchObject({ kind: 'dive', side: 1 });
    expect(gestureFor(input({ type: 'save', at: { x: 47, y: 30 } }, 300), ME, true, 0, 0)).toMatchObject({ kind: 'dive', side: -1 });
    expect(gestureFor(input({ type: 'save', at: { x: 50.2, y: 31 } }, 300), ME, true, 0, 0)).toMatchObject({ kind: 'catch' });
  });
  it('celebrates a goal through the kickoff reset: scorer, team-mates and the other side', () => {
    const goal = { type: 'goal' as const, side: 'home' as const };
    expect(gestureFor(input(goal, 500, true), ME, false, 0, 0)).toMatchObject({ kind: 'airplane' });
    expect(gestureFor(input(goal, GESTURE_MS.airplane + 100), ME, false, 0, 0)).toMatchObject({ kind: 'cheer' });
    expect(gestureFor(input({ ...goal, participants: ['h9'] }, 500), ME, false, 0, 0)).toMatchObject({ kind: 'cheer' });
    expect(gestureFor(input({ ...goal, participants: ['h9'] }, 500), { ...ME, key: 'a4', side: 'away' }, false, 0, 0)).toMatchObject({ kind: 'dejected' });
  });
  it('does not start a kick across a restart cut; an idle keeper waits ready', () => {
    expect(gestureFor(input({ type: 'pass' }, 100, true), ME, false, 0, 0)).toEqual({ kind: 'run' });
    expect(gestureFor(input(undefined, 0), ME, true, 0, 1)).toEqual({ kind: 'ready' });
    expect(gestureFor(input(undefined, 0), ME, true, 0, 4)).toEqual({ kind: 'run' });
  });
});
