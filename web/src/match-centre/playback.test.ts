import { describe, expect, it } from 'vitest';
import { MatchPlaybackController } from './playback';
import { cursorAt } from './session';
import { syntheticSnapshot } from './unified-fixtures';
import { AYEW_POLICY } from './sequence/pilot';
import { halftimeMs, stepTarget, transportTargets } from './transport';

describe('optional sequence policy', () => {
  it('bounds the clip, pauses at clip end and preserves legacy speeds when removed', () => {
    const {player,advance}=clock(5851968);player.setPolicy(AYEW_POLICY);
    expect(player.snapshot()).toMatchObject({elapsedMs:1684024,speed:1,status:'paused',stop:null,isMatchEnd:false});
    for(const speed of [.5,1,2])player.setSpeed(speed);
    expect(()=>player.setSpeed(5)).toThrow();player.play();advance(100000);
    expect(player.snapshot()).toMatchObject({elapsedMs:1697850,status:'paused',wantsPlay:false,isMatchEnd:false,stop:{kind:'clip-end',atMs:1697850}});
    player.setPolicy({...AYEW_POLICY});expect(player.currentTime()).toBe(1697850);
    player.seek(1685000);player.setSpeed(.5);player.setPolicy({...AYEW_POLICY});
    expect(player.snapshot()).toMatchObject({elapsedMs:1685000,speed:.5});
    expect(()=>player.setPolicy({pauseAt:[],speeds:[.5,1,2],toMs:1697850,fromMs:1684024,id:'ayew-equaliser-1'})).not.toThrow();
    player.setPolicy(null);player.setSpeed(120);player.replay();expect(player.snapshot()).toMatchObject({elapsedMs:0,status:'playing',speed:120});
  });
  it('rejects invalid policies atomically, including malformed stops and out-of-source bounds', () => {
    const {player}=clock(5851968);player.setPolicy(AYEW_POLICY);player.seek(1685000);
    const before=player.snapshot();
    for(const p of [{...AYEW_POLICY,fromMs:NaN},{...AYEW_POLICY,toMs:Infinity},{...AYEW_POLICY,toMs:1},
      {...AYEW_POLICY,toMs:5851969},{...AYEW_POLICY,speeds:[0]},
      {...AYEW_POLICY,pauseAt:[{atMs:1685000,endingPeriod:0}]}]){
      expect(()=>player.setPolicy(p)).toThrow();expect(player.snapshot()).toEqual(before);
    }
    expect(()=>clock(null).player.setPolicy(AYEW_POLICY)).toThrow();
  });
  it('stops delayed ticks at the first boundary; continuing/rewinding/seeking use exact source time', () => {
    const {player,advance}=clock(5851968);
    player.setPolicy({id:'halftime-check-1',fromMs:2878495,toMs:2882495,speeds:[.5,1,2],pauseAt:[{atMs:2880495,endingPeriod:1}]});
    player.play();advance(10000);
    expect(player.snapshot()).toMatchObject({elapsedMs:2880495,status:'paused',stop:{kind:'halftime',endingPeriod:1},isMatchEnd:false});
    player.continueAfterStop();advance(100);expect(player.snapshot()).toMatchObject({elapsedMs:2880595,status:'playing',stop:null});
    player.seek(2880000);advance(1000);expect(player.snapshot().stop?.kind).toBe('halftime');
    player.seek(2881000);expect(player.snapshot().stop).toBeNull();player.play();advance(100);expect(player.currentTime()).toBe(2881100);
  });
});

function clock(duration: number | null = 10_000) {
  let now = 0;
  const player = new MatchPlaybackController(duration, () => now);
  return { player, advance: (ms: number) => { now += ms; } };
}

describe('one monotonic match clock', () => {
  it('starts paused at zero and 1×; rebases speed/pause without jumps', () => {
    const { player, advance } = clock();
    expect(player.snapshot()).toMatchObject({ elapsedMs: 0, speed: 1, status: 'paused', wantsPlay: false });
    player.play(); advance(137); expect(player.currentTime()).toBe(137);
    player.setSpeed(5); expect(player.currentTime()).toBe(137);
    advance(137); expect(player.currentTime()).toBe(822);
    player.pause(); advance(500); expect(player.currentTime()).toBe(822);
  });
  it('accepts precisely the six common speeds', () => {
    const { player } = clock();
    for (const speed of [1, 5, 10, 20, 60, 120]) { player.setSpeed(speed); expect(player.snapshot().speed).toBe(speed); }
    for (const speed of [3, NaN, Infinity, 0, -1]) expect(() => player.setSpeed(speed)).toThrow();
  });
  it('clamps seeks including nonfinite input and rebases playing seeks', () => {
    const { player, advance } = clock();
    for (const value of [-1, NaN, Infinity, -Infinity]) { player.seek(value); expect(player.currentTime()).toBe(0); }
    player.seek(20_000); expect(player.currentTime()).toBe(10_000);
    player.seek(100); player.play(); advance(100); player.seek(3000); advance(100);
    expect(player.currentTime()).toBe(3100);
  });
  it('ends at the recorded extent and replay retains the selected speed', () => {
    const { player, advance } = clock(5_623_400);
    player.setSpeed(120); player.play(); advance(45_000);
    expect(player.snapshot()).toMatchObject({ elapsedMs: 5_400_000, isPlaying: true });
    advance(2000); expect(player.snapshot()).toMatchObject({ elapsedMs: 5_623_400, status: 'ended', wantsPlay: false });
    player.replay(); expect(player.snapshot()).toMatchObject({ elapsedMs: 0, speed: 120, status: 'playing' });
  });
  it('unknown duration disables playback without resetting the cursor on metadata changes', () => {
    const { player, advance } = clock(null);
    player.play(); advance(100); expect(player.snapshot()).toMatchObject({ status: 'unavailable', elapsedMs: 0 });
    player.setDuration(10_000); player.seek(500); player.play(); advance(100);
    player.setDuration(null); advance(100);
    expect(player.snapshot()).toMatchObject({ elapsedMs: 600, status: 'unavailable', wantsPlay: false });
    player.setDuration(20_000); expect(player.currentTime()).toBe(600);
  });
  it('freezes at the horizon without charging time spent buffering', () => {
    const { player, advance } = clock();
    player.setHorizon(1000, 'ready'); player.play(); advance(1500);
    expect(player.snapshot()).toMatchObject({ elapsedMs: 1000, status: 'buffering', wantsPlay: true, isPlaying: false });
    advance(500); player.setHorizon(5000, 'ready'); expect(player.currentTime()).toBe(1000);
    advance(100); expect(player.currentTime()).toBe(1100);
  });
  it('pause while buffering cancels automatic resume', () => {
    const { player, advance } = clock();
    player.setHorizon(1000, 'ready'); player.play(); advance(1500); player.pause();
    player.setHorizon(5000, 'ready'); advance(100);
    expect(player.snapshot()).toMatchObject({ elapsedMs: 1000, status: 'paused', wantsPlay: false });
  });
  it('pending seeks keep a coherent cursor; the latest seek wins', () => {
    const { player } = clock();
    player.setHorizon(1000, 'ready'); player.seek(3000);
    expect(player.snapshot()).toMatchObject({ elapsedMs: 0, pendingSeekMs: 3000, status: 'buffering' });
    player.seek(7000); player.setHorizon(4000, 'ready');
    expect(player.snapshot()).toMatchObject({ elapsedMs: 0, pendingSeekMs: 7000 });
    player.setHorizon(8000, 'ready'); expect(player.snapshot()).toMatchObject({ elapsedMs: 7000, pendingSeekMs: null, status: 'paused' });
  });
  it('a backwards seek also waits if its destination window is not ready', () => {
    const { player } = clock(); player.seek(5000);
    player.setHorizon(10_000, 'buffering'); player.seek(500);
    expect(player.snapshot()).toMatchObject({ elapsedMs: 5000, pendingSeekMs: 500 });
    player.setHorizon(10_000, 'ready'); expect(player.currentTime()).toBe(500);
  });
  it('facts-only is playable and unavailable data can recover without charging a wait', () => {
    const { player, advance } = clock();
    player.setHorizon(10_000, 'facts_only'); player.play(); advance(100); expect(player.currentTime()).toBe(100);
    player.setHorizon(100, 'unavailable'); advance(1000); expect(player.currentTime()).toBe(100);
    player.setHorizon(10_000, 'ready'); advance(100); expect(player.currentTime()).toBe(200);
  });
  it('maps periods using recorded offsets only, including exact boundaries and unknown extents', () => {
    const descriptor = syntheticSnapshot().descriptor;
    descriptor.periods = [{ period: 1, startMs: 0, durationMs: 2_850_123 },
      { period: 2, startMs: 2_850_123, durationMs: 2_773_277 }, { period: 3, startMs: null, durationMs: null }];
    expect(cursorAt(descriptor, 2_850_122)).toMatchObject({ period: 1, periodMs: 2_850_122 });
    expect(cursorAt(descriptor, 2_850_123)).toMatchObject({ period: 2, periodMs: 0 });
    expect(cursorAt(descriptor, 5_623_400)).toMatchObject({ period: 2, periodMs: 2_773_277 });
    descriptor.periods = [{ period: 2, startMs: null, durationMs: null }];
    expect(cursorAt(descriptor, 500)).toMatchObject({ period: 0, periodMs: 0 });
  });
  it('replay can preserve play intent while loading the start from an ended cursor', () => {
    const { player, advance } = clock(1000); player.play(); advance(1000);
    expect(player.snapshot().status).toBe('ended');
    player.setHorizon(1000, 'buffering'); player.replay();
    expect(player.snapshot()).toMatchObject({ elapsedMs: 1000, pendingSeekMs: 0, wantsPlay: true, status: 'buffering' });
    player.setHorizon(1000, 'ready'); advance(100);
    expect(player.snapshot()).toMatchObject({ elapsedMs: 100, status: 'playing' });
  });
});

describe('transport targets (barra de reproducción)', () => {
  const marks = [{ id: 'g2', atMs: 60_000, seekMs: 57_000 }, { id: 'g1', atMs: 20_000, seekMs: 17_000 }, { id: 'ht', atMs: 40_000, seekMs: 40_000 }];
  it('jumps to the previous/next mark by seek time, ignoring order and the mark just landed on', () => {
    expect(transportTargets(marks, 0)).toEqual({ previous: null, next: 17_000 });
    expect(transportTargets(marks, 17_000)).toEqual({ previous: null, next: 40_000 });
    expect(transportTargets(marks, 17_400)).toEqual({ previous: null, next: 40_000 });
    expect(transportTargets(marks, 45_000)).toEqual({ previous: 40_000, next: 57_000 });
    expect(transportTargets(marks, 57_000)).toEqual({ previous: 40_000, next: null });
    expect(transportTargets([], 5_000)).toEqual({ previous: null, next: null });
  });
  it('steps ten seconds within the known duration and refuses without one', () => {
    expect(stepTarget(5_000, -10_000, 90_000)).toBe(0);
    expect(stepTarget(85_000, 10_000, 90_000)).toBe(90_000);
    expect(stepTarget(30_000, 10_000, 90_000)).toBe(40_000);
    expect(stepTarget(30_000, 10_000, null)).toBeNull();
  });
  it('places half-time at the first known start after period one, never invented', () => {
    const p = (period: number, startMs: number | null) => ({ period, startMs, durationMs: null });
    expect(halftimeMs([p(1, 0), p(2, 2_880_000)], 5_760_000)).toBe(2_880_000);
    expect(halftimeMs([p(2, 2_880_000), p(1, 0), p(3, 5_000_000)], 5_760_000)).toBe(2_880_000);
    expect(halftimeMs([p(1, 0), p(2, null)], 5_760_000)).toBeNull();
    expect(halftimeMs([p(1, 0)], 5_760_000)).toBeNull();
    expect(halftimeMs([p(1, 0), p(2, 9_000_000)], 5_760_000)).toBeNull();
    expect(halftimeMs([p(1, 0), p(2, 100)], null)).toBeNull();
  });
});
