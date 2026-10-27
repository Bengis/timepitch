import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMatchPlayback } from './useMatchPlayback';
import { syntheticAdapter, syntheticSnapshot } from './unified-fixtures';
import type { PlaybackPolicy } from './sequence/types';
import { cursorAt } from './session';

let now = 0;
let callbacks: Map<number, FrameRequestCallback>;
let nextId = 0;
beforeEach(() => {
  now = 0; callbacks = new Map(); nextId = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.set(++nextId, cb); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function frame(ms: number) { act(() => { now += ms; const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(cb => cb(now)); }); }

describe('shared playback lifecycle', () => {
  it('publishes one coherent state, frame cursor and demand even while the wall clock advances on reads',async()=>{
    const f=syntheticAdapter();
    const {result}=renderHook(()=>useMatchPlayback(f.adapter,true),{wrapper:StrictMode});
    act(()=>result.current.play());
    vi.mocked(performance.now).mockImplementation(()=>now+=.1);
    frame(32);
    expect(result.current.view!.cursor.elapsedMs).toBe(result.current.state.elapsedMs);
  });
  it('does not advance the controller during a React rerender between published ticks',()=>{
    const f=syntheticAdapter();
    const {result,rerender}=renderHook(()=>useMatchPlayback(f.adapter,true),{wrapper:StrictMode});
    act(()=>result.current.play());frame(32);
    const presented=result.current.state.elapsedMs;
    now+=7;rerender();
    expect(result.current.state.elapsedMs).toBe(presented);
    frame(32);expect(result.current.state.elapsedMs).toBeGreaterThan(presented);
  });
  it('retains confirmed user seek provenance even if the clock advances before its render',async()=>{
    const f=syntheticAdapter();
    f.adapter.ensure=vi.fn(async(ms,_signal,demand)=>{
      const next=syntheticSnapshot();next.requestedCursor=next.presentedCursor=cursorAt(next.descriptor,ms,demand?.endingPeriod);f.publish(next);
    });
    const {result}=renderHook(()=>useMatchPlayback(f.adapter,true));
    let revision:unknown;
    act(()=>{revision=result.current.seek(0);result.current.play();});
    expect(result.current).toMatchObject({seekState:{revision:1,targetMs:0,status:'pending'}});
    await act(async()=>{});frame(1);
    expect(revision).toBe(1);expect(result.current.state.elapsedMs).toBe(1);
    expect(result.current).toMatchObject({seekState:{revision:1,targetMs:0,status:'settled'}});
    frame(50);expect(result.current).toMatchObject({seekState:{revision:1,targetMs:0,status:'settled'}});
  });
  it('only confirms the latest user seek and cancels pending provenance on a policy replacement',async()=>{
    const f=syntheticAdapter();let release!:(()=>void);
    f.adapter.ensure=vi.fn(async(ms,signal,demand)=>{
      if(ms===7000)await new Promise<void>(r=>{release=r;});
      if(signal.aborted)return;
      const next=syntheticSnapshot();next.requestedCursor=next.presentedCursor=cursorAt(next.descriptor,ms,demand?.endingPeriod);f.publish(next);
    });
    const {result,rerender}=renderHook(({policy}:{policy:PlaybackPolicy|undefined})=>useMatchPlayback(f.adapter,true,policy),{initialProps:{policy:undefined as PlaybackPolicy|undefined}});
    act(()=>result.current.seek(7000));await act(async()=>{});
    act(()=>result.current.seek(200));await act(async()=>{});
    expect(result.current).toMatchObject({seekState:{revision:2,targetMs:200,status:'settled'}});
    await act(async()=>release());expect(result.current).toMatchObject({seekState:{revision:2,targetMs:200,status:'settled'}});
    act(()=>result.current.seek(7000));await act(async()=>{});
    await act(async()=>rerender({policy:{id:'halftime-check-1',fromMs:0,toMs:9000,speeds:[1],pauseAt:[]}}));
    expect(result.current).toMatchObject({seekState:{revision:3,targetMs:7000,status:'cancelled'}});
  });
  it('equivalent policy rerenders while the wall clock advances do not buffer or request the source again', async () => {
    const f=syntheticAdapter();f.adapter.ensure=vi.fn(async()=>{});
    const policy:PlaybackPolicy={id:'ayew-equaliser-1',fromMs:1000,toMs:9000,speeds:[.5,1,2],pauseAt:[]};
    const {result,rerender}=renderHook(({p})=>useMatchPlayback(f.adapter,true,p),{initialProps:{p:policy}});
    await act(async()=>{});act(()=>result.current.play());frame(100);
    vi.spyOn(performance,'now').mockImplementation(()=>++now);
    await act(async()=>{rerender({p:{...policy}});});
    expect(f.adapter.ensure).toHaveBeenCalledOnce();expect(result.current.state.status).toBe('playing');
    expect(f.listeners.size).toBe(1);expect(callbacks.size).toBe(1);
  });
  it('policy identity changes do not remount and half-time demand resumes at the same cursor while waiting stays frozen', async () => {
    const initial=syntheticSnapshot();initial.descriptor.periods=[{period:1,startMs:0,durationMs:5000},{period:2,startMs:5000,durationMs:5000}];
    const f=syntheticAdapter(initial),ensure=vi.fn(f.adapter.ensure);f.adapter.ensure=ensure;
    const policy:PlaybackPolicy={id:'halftime-check-1',fromMs:4000,toMs:6000,speeds:[.5,1,2],pauseAt:[{atMs:5000,endingPeriod:1}]};
    let release:(()=>void)|null=null;
    ensure.mockImplementation(async(ms,signal,demand)=>{
      if(ms===5000 && demand?.endingPeriod===undefined)await new Promise<void>(resolve=>{release=resolve;});
      if(signal.aborted)return;
      const next=syntheticSnapshot();next.descriptor=initial.descriptor;
      next.requestedCursor=next.presentedCursor=cursorAt(next.descriptor,ms,demand?.endingPeriod);
      next.clockMs=next.presentedCursor.periodMs;
      next.interval={...initial.interval!,fromMs:ms,toMs:ms===5000&&demand?.endingPeriod===1?ms:10000,
        before:{...initial.interval!.before,period:next.presentedCursor.period,clock_ms:ms,score:{home:2,away:1}}};
      f.publish(next);
    });
    const {result,rerender}=renderHook(({p})=>useMatchPlayback(f.adapter,true,p),{initialProps:{p:policy}});
    await act(async()=>{});expect(result.current.state.elapsedMs).toBe(4000);
    act(()=>result.current.setSpeed(2));rerender({p:{...policy}});
    expect(result.current.state.speed).toBe(2);expect(f.listeners.size).toBe(1);
    act(()=>result.current.play());frame(10000);await act(async()=>{});
    expect(result.current.state).toMatchObject({elapsedMs:5000,stop:{kind:'halftime',endingPeriod:1}});
    expect(result.current.demand).toMatchObject({endingPeriod:1,playback:'paused'});
    expect(result.current.view?.cursor).toMatchObject({period:1,periodMs:5000});
    const endSnapshot=f.adapter.snapshot();
    await act(async()=>{result.current.continueAfterStop();});frame(2000);
    expect(result.current.state.elapsedMs).toBe(5000);expect(result.current.state.status).toBe('buffering');
    expect(result.current.view?.cursor.period).toBe(1);
    act(()=>f.publish(endSnapshot));expect(result.current.snapshot.presentedCursor.period).toBe(1);
    await act(async()=>{release!();});
    expect(result.current.view?.cursor).toMatchObject({elapsedMs:5000,period:2,periodMs:0});
    act(()=>f.publish(endSnapshot));expect(result.current.snapshot.presentedCursor.period).toBe(2);
    frame(100);expect(result.current.state.elapsedMs).toBe(5200);expect(callbacks.size).toBe(1);
  });
  it('removing a half-time policy re-resolves the shared boundary without stale ending context', async () => {
    const initial=syntheticSnapshot();initial.descriptor.periods=[{period:1,startMs:0,durationMs:5000},{period:2,startMs:5000,durationMs:5000}];
    const f=syntheticAdapter(initial);f.adapter.ensure=vi.fn(async(ms,_signal,demand)=>{
      const next={...initial,requestedCursor:cursorAt(initial.descriptor,ms,demand?.endingPeriod),presentedCursor:cursorAt(initial.descriptor,ms,demand?.endingPeriod)};
      f.publish(next);
    });
    const policy:PlaybackPolicy={id:'halftime-check-1',fromMs:4000,toMs:6000,speeds:[.5,1,2],pauseAt:[{atMs:5000,endingPeriod:1}]};
    const {result,rerender}=renderHook(({p}:{p:PlaybackPolicy|undefined})=>useMatchPlayback(f.adapter,true,p),{initialProps:{p:policy as PlaybackPolicy|undefined}});
    await act(async()=>{});act(()=>result.current.play());frame(1000);await act(async()=>{});
    expect(result.current.state.stop?.kind).toBe('halftime');
    await act(async()=>{rerender({p:undefined});});
    expect(result.current.state.stop).toBeNull();expect(result.current.demand.endingPeriod).toBeUndefined();
    expect(result.current.snapshot.presentedCursor.period).toBe(2);
  });
  it('starts paused; one RAF advances shared samples and previous poses, native clock stays separate', () => {
    const { adapter } = syntheticAdapter();
    const { result } = renderHook(() => useMatchPlayback(adapter, true));
    expect(result.current.state).toMatchObject({ status: 'paused', speed: 1 });
    act(() => result.current.play()); frame(137);
    expect(result.current.state.elapsedMs).toBe(137);
    expect(result.current.view!.frame.clock_ms).toBe(137);
    expect(result.current.view!.previous.clock_ms).toBe(37);
    expect(result.current.view!.clockMs).toBe(42_000);
    expect(callbacks.size).toBe(1);
    act(() => result.current.setSpeed(5)); frame(137);
    expect(result.current.state.elapsedMs).toBe(822);
  });
  it('hidden pauses/cancels pending demand without disposing; unmount unsubscribes and disposes', async () => {
    const fixture = syntheticAdapter(); const dispose = vi.spyOn(fixture.adapter, 'dispose');
    const signals: AbortSignal[] = [];
    fixture.adapter.ensure = vi.fn((_ms, signal) => { signals.push(signal); return new Promise<void>(() => {}); });
    const { result, rerender, unmount } = renderHook(({ visible }) => useMatchPlayback(fixture.adapter, visible), { initialProps: { visible: true } });
    act(() => result.current.play()); frame(137);
    await act(async () => { result.current.seek(7000); });
    rerender({ visible: false }); frame(1000);
    expect(signals).toHaveLength(1);
    expect(result.current.state.elapsedMs).toBe(137); expect(callbacks.size).toBe(0);
    expect(signals.every(s => s.aborted)).toBe(true); expect(dispose).not.toHaveBeenCalled();
    rerender({ visible: true }); expect(result.current.state.wantsPlay).toBe(false);
    await act(async () => { unmount(); }); expect(fixture.listeners.size).toBe(0); expect(dispose).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
  });
  it('buffered seek holds the old view, commits only the latest destination and does not charge waiting', async () => {
    const fixture = syntheticAdapter(); let resolveOld!: () => void;
    fixture.adapter.ensure = vi.fn((ms, signal) => {
      if (ms !== 7000) return Promise.resolve();
      return new Promise<void>(resolve => { resolveOld = () => {
        if (!signal.aborted) fixture.publish({ ...syntheticSnapshot(), requestedCursor: { elapsedMs: ms, period: 1, periodMs: ms } });
        resolve();
      }; });
    });
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    await act(async () => { result.current.play(); result.current.seek(7000); }); frame(1000);
    expect(result.current.state.pendingSeekMs).toBe(7000); expect(result.current.view!.cursor.elapsedMs).toBe(0);
    act(() => result.current.seek(200)); await act(async () => { resolveOld(); });
    expect(result.current.state).toMatchObject({ elapsedMs: 200, pendingSeekMs: null });
    frame(100); expect(result.current.state.elapsedMs).toBe(300);
  });
  it('identity replacement immediately resets and rejects late publications', async () => {
    const first = syntheticAdapter(); const second = syntheticAdapter(syntheticSnapshot({ source: 'grf', id: 'other', revision: '1' }));
    const dispose = vi.spyOn(first.adapter, 'dispose');
    const { result, rerender } = renderHook(({ adapter }) => useMatchPlayback(adapter, true), { initialProps: { adapter: first.adapter } });
    act(() => result.current.play()); frame(137); await act(async () => { rerender({ adapter: second.adapter }); });
    expect(result.current.state.elapsedMs).toBe(0); expect(result.current.snapshot.descriptor.identity.id).toBe('other');
    act(() => first.publish({ ...syntheticSnapshot(), clockMs: 999 }));
    expect(result.current.view!.clockMs).toBe(42_000); expect(dispose).toHaveBeenCalledOnce();
  });
  it('facts-only advances with unavailable pitch; null ball remains a valid ready sample', async () => {
    const fixture = syntheticAdapter();
    fixture.publish({ ...syntheticSnapshot(), loadState: 'facts_only', interval: null });
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    act(() => result.current.play()); frame(137); expect(result.current.state.elapsedMs).toBe(137); expect(result.current.view).toBeNull();
    await act(async () => {});
    const snapshot = syntheticSnapshot(); snapshot.interval!.before.ball = null;
    snapshot.requestedCursor = { elapsedMs: 137, period: 1, periodMs: 137 };
    snapshot.presentedCursor = { elapsedMs: 137, period: 1, periodMs: 137 };
    act(() => fixture.publish(snapshot)); frame(100);
    expect(result.current.state.isPlaying).toBe(true); expect(result.current.view!.frame.ball).toBeNull();
  });
  it('unknown metadata can become available without remounting or losing subscription', async () => {
    const fixture = syntheticAdapter(); const snapshot = syntheticSnapshot(); snapshot.descriptor.durationMs = null;
    fixture.publish(snapshot);
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    expect(result.current.state.status).toBe('unavailable');
    act(() => fixture.publish(syntheticSnapshot())); await act(async () => { result.current.seek(500); result.current.play(); });
    frame(100); expect(result.current.state.elapsedMs).toBe(600); expect(fixture.listeners.size).toBe(1);
  });
  it('StrictMode effect replay does not dispose an adapter which is still mounted', async () => {
    const fixture = syntheticAdapter(); const dispose = vi.spyOn(fixture.adapter, 'dispose');
    const { result, unmount } = renderHook(() => useMatchPlayback(fixture.adapter, true), { wrapper: StrictMode });
    await act(async () => {});
    expect(dispose).not.toHaveBeenCalled(); expect(fixture.listeners.size).toBe(1); expect(callbacks.size).toBe(1);
    act(() => result.current.play()); frame(137); expect(result.current.state.elapsedMs).toBe(137);
    await act(async () => { unmount(); }); expect(dispose).toHaveBeenCalledOnce();
  });
  it('rejects an obsolete seek publication even after the latest destination has settled', async () => {
    const fixture = syntheticAdapter();
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    await act(async () => { result.current.seek(7000); });
    await act(async () => { result.current.seek(200); });
    act(() => fixture.publish({ ...syntheticSnapshot(), requestedCursor: { elapsedMs: 7000, period: 1, periodMs: 7000 }, clockMs: 999 }));
    expect(result.current.view!.clockMs).toBe(42_000); expect(result.current.state.elapsedMs).toBe(200);
  });
  it('freezes automatic playback while the next interval loads, with one demand and no waiting drift', async () => {
    const fixture = syntheticAdapter(); const initial = syntheticSnapshot(); initial.interval!.toMs = 100;
    fixture.publish(initial);
    fixture.adapter.ensure = vi.fn(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    act(() => result.current.play()); frame(137); await act(async () => {});
    expect(result.current.state).toMatchObject({ elapsedMs: 0, pendingSeekMs: 137, status: 'buffering', wantsPlay: true });
    frame(1000); frame(1000); expect(fixture.adapter.ensure).toHaveBeenCalledOnce();
    const next = syntheticSnapshot(); next.requestedCursor = { elapsedMs: 137, period: 1, periodMs: 137 };
    act(() => fixture.publish(next));
    expect(result.current.state.elapsedMs).toBe(137); frame(100); expect(result.current.state.elapsedMs).toBe(237);
  });
  it('handles a loader failure without unhandled rejection or advancing an unavailable window', async () => {
    const fixture = syntheticAdapter(); fixture.adapter.ensure = vi.fn(async () => { throw new Error('Unavailable'); });
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    await act(async () => { result.current.seek(7000); result.current.play(); });
    frame(1000); expect(result.current.state.status).toBe('unavailable');
    expect(result.current.view).toBeNull(); expect(result.current.snapshot.reason).toBeTruthy();
    expect(fixture.adapter.ensure).toHaveBeenCalledOnce();
  });
  it('same identity rerenders retain the controller and subscription', () => {
    const fixture = syntheticAdapter();
    const { result, rerender } = renderHook(({ adapter }) => useMatchPlayback(adapter, true), { initialProps: { adapter: fixture.adapter } });
    act(() => result.current.play()); frame(137);
    rerender({ adapter: { ...fixture.adapter, identity: { ...fixture.adapter.identity } } });
    expect(result.current.state.elapsedMs).toBe(137); expect(fixture.listeners.size).toBe(1); expect(callbacks.size).toBe(1);
  });
  it('StrictMode immediate unmount disposes exactly once', async () => {
    const fixture = syntheticAdapter(); const dispose = vi.spyOn(fixture.adapter, 'dispose');
    const { unmount } = renderHook(() => useMatchPlayback(fixture.adapter, true), { wrapper: StrictMode });
    await act(async () => { unmount(); });
    expect(dispose).toHaveBeenCalledOnce(); expect(callbacks.size).toBe(0);
  });
  it('facts-only still resolves source facts while playing, without inventing a pitch', async () => {
    const fixture = syntheticAdapter(); const initial = syntheticSnapshot();
    initial.loadState = 'facts_only'; initial.interval = null; fixture.publish(initial);
    fixture.adapter.ensure = vi.fn(async ms => {
      fixture.publish({ ...initial, requestedCursor: { elapsedMs: ms, period: 1, periodMs: ms },
        presentedCursor: { elapsedMs: ms, period: 1, periodMs: ms },
        facts: { ...initial.facts, score: { value: { home: ms >= 100 ? 1 : 0, away: 0 }, provenance: 'derived_from_events', refs: ['test:goal'] } } });
    });
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    act(() => result.current.play()); frame(137); await act(async () => {});
    expect(result.current.snapshot.facts.score.value).toEqual({ home: 1, away: 0 });
    expect(result.current.view).toBeNull(); expect(result.current.state.elapsedMs).toBe(137);
  });
  it('resolves the discrete endpoint at full time before presenting the final state', async () => {
    const fixture = syntheticAdapter(); const initial = syntheticSnapshot();
    initial.descriptor.durationMs = 1000; initial.horizonMs = 1000; initial.interval!.toMs = 1000;
    fixture.publish(initial);
    fixture.adapter.ensure = vi.fn(async ms => {
      const final = syntheticSnapshot(); final.descriptor.durationMs = 1000; final.horizonMs = 1000;
      final.requestedCursor = final.presentedCursor = { elapsedMs: ms, period: 1, periodMs: ms };
      final.interval = { ...initial.interval!, fromMs: 1000, toMs: 1000, after: null,
        before: { ...initial.interval!.before, clock_ms: 1000, score: { home: 1, away: 0 } },
        continuousPlayers: new Set(), continuousBall: false };
      final.facts.score.value = { home: 1, away: 0 }; fixture.publish(final);
    });
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    act(() => result.current.play()); frame(1000); await act(async () => {});
    expect(fixture.adapter.ensure).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({ elapsedMs: 1000, status: 'ended', wantsPlay: false });
    expect(result.current.view!.frame.score).toEqual({ home: 1, away: 0 });
  });
  it('a ready notification must actually contain the pending destination, not merely advertise a horizon', async () => {
    const fixture = syntheticAdapter(); fixture.adapter.ensure = () => new Promise<void>(() => {});
    const { result } = renderHook(() => useMatchPlayback(fixture.adapter, true));
    await act(async () => { result.current.seek(7000); });
    const incomplete = syntheticSnapshot(); incomplete.requestedCursor = { elapsedMs: 7000, period: 1, periodMs: 7000 };
    incomplete.interval!.toMs = 1000;
    act(() => fixture.publish(incomplete));
    expect(result.current.state).toMatchObject({ elapsedMs: 0, pendingSeekMs: 7000, status: 'buffering' });
    const ready = syntheticSnapshot(); ready.requestedCursor = incomplete.requestedCursor;
    act(() => fixture.publish(ready)); expect(result.current.state.elapsedMs).toBe(7000);
  });
});
