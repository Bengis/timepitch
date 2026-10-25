import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { audioContextCtor, createMatchAudio, installGestureUnlock } from './engine';
import type { SoundCue } from './cues';

// AudioContext de mentira: registra qué nodos se crean y arrancan. jsdom no trae Web Audio.
const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
function fakeContext(initial: AudioContextState = 'suspended', resumes = true) {
  const log: string[] = [];
  const node = (kind: string, extra: object = {}) => ({ kind, connect: vi.fn((n: unknown) => n), disconnect: vi.fn(), ...extra });
  const scheduled = (kind: string) => node(kind, { frequency: param(), Q: param(), gain: param(), type: '', buffer: null, loop: false,
    start: vi.fn(() => log.push(`start:${kind}`)), stop: vi.fn() });
  class Fake {
    state: AudioContextState = initial; currentTime = 1; sampleRate = 8000; destination = node('destination'); onstatechange: (() => void) | null = null;
    resume = vi.fn(async () => { if (resumes) { this.state = 'running'; this.onstatechange?.(); } });
    createGain() { return node('gain', { gain: param() }); }
    createBiquadFilter() { return node('filter', { frequency: param(), Q: param(), type: '' }); }
    createDynamicsCompressor() { return node('compressor', { threshold: param(), ratio: param() }); }
    createOscillator() { return scheduled('osc'); }
    createBufferSource() { return scheduled('noise'); }
    createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
    constructor() { instances.push(this); }
  }
  const instances: Fake[] = [];
  return { Ctor: Fake as unknown as new () => AudioContext, instances, log };
}

describe('match audio engine', () => {
  it('jsdom has no AudioContext: every call is a silent no-op', () => {
    expect(audioContextCtor()).toBeNull();
    const audio = createMatchAudio();
    expect(() => { audio.unlock(); audio.play('goal'); audio.setAmbience(true); audio.setAmbience(false); }).not.toThrow();
  });
  it('creates no context before a gesture (unlock), then plays every cue', async () => {
    const fake = fakeContext(), audio = createMatchAudio(() => fake.Ctor);
    audio.play('goal'); audio.setAmbience(true);
    expect(fake.instances).toHaveLength(0);
    audio.unlock(); expect(fake.instances).toHaveLength(1);
    await Promise.resolve(); await Promise.resolve();
    expect(fake.instances[0].state).toBe('running');
    // El ambiente pedido antes del gesto arranca al desbloquear.
    expect(fake.log.filter(l => l === 'start:noise').length).toBeGreaterThan(0);
    const before = fake.log.length;
    for (const cue of ['kick', 'shot', 'ooh', 'goal', 'whistle-kickoff', 'whistle-half', 'whistle-full'] as SoundCue[]) audio.play(cue);
    expect(fake.log.length).toBeGreaterThan(before + 7);
    audio.unlock(); expect(fake.instances).toHaveLength(1);
  });
  it('page-wide gesture unlock: pointer or key unlock only while sound is on, and the listener can be removed', () => {
    const audio = { unlock: vi.fn(), play: vi.fn(), setAmbience: vi.fn() };
    let on = false; const remove = installGestureUnlock(audio, () => on);
    fireEvent.pointerDown(window); expect(audio.unlock).not.toHaveBeenCalled();
    on = true; fireEvent.pointerDown(window); fireEvent.keyDown(window, { key: 'Enter' }); expect(audio.unlock).toHaveBeenCalledTimes(2);
    remove(); fireEvent.pointerDown(window); expect(audio.unlock).toHaveBeenCalledTimes(2);
    const broken = installGestureUnlock({ ...audio, unlock: () => { throw new Error('x'); } }, () => true);
    expect(() => fireEvent.pointerDown(window)).not.toThrow(); broken();
  });
  it('a context in a suspended state does not play', () => {
    const fake = fakeContext('suspended', false), audio = createMatchAudio(() => fake.Ctor);
    audio.unlock(); audio.setAmbience(true); audio.play('kick'); expect(fake.log).toEqual([]);
  });
  it('audio errors never escape: a throwing constructor or node factory degrades silently', async () => {
    const throwing = createMatchAudio(() => class { constructor() { throw new Error('blocked'); } } as unknown as new () => AudioContext);
    expect(() => { throwing.unlock(); throwing.play('goal'); throwing.setAmbience(true); }).not.toThrow();
    const fake = fakeContext('running'), audio = createMatchAudio(() => fake.Ctor);
    audio.unlock();
    (fake.instances[0] as unknown as { createOscillator: () => never }).createOscillator = () => { throw new Error('node'); };
    expect(() => { audio.play('whistle-full'); audio.play('kick'); audio.setAmbience(true); audio.setAmbience(false); }).not.toThrow();
  });
});
