// G17 · useAnnouncer: búsqueda sin ráfagas y con datos que llegan tarde para el tramo saltado.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Announcement } from './announcements/announcements';
import { useAnnouncer } from './useAnnouncer';

const goal = (n: number, atMs: number): Announcement => ({ id: `goal:${n}`, kind: 'goal', priority: 100, durationMs: 6000, atMs, minuteLabel: `${n}'`,
  side: 'home', primaryPlayerId: null, scoreAfter: { home: n, away: 0 }, provenance: 'simulated' });

afterEach(() => vi.useRealTimers());

describe('useAnnouncer', () => {
  it('clears the cut floor when the montage policy resets and announces the opening clip again',()=>{
    const {result,rerender}=renderHook(({cursor,cut})=>useAnnouncer([goal(1,500)],cursor,0,false,cut),
      {initialProps:{cursor:0,cut:null as {revision:number;toMs:number}|null}});
    rerender({cursor:5000,cut:{revision:1,toMs:5000}});
    rerender({cursor:0,cut:null});
    rerender({cursor:600,cut:null});
    expect(result.current?.id).toBe('goal:1');
  });
  it('suppresses a cut gap including high-priority and late arrivals, then announces a new event in the clip',()=>{
    const red={...goal(1,1000),id:'red:1',kind:'red' as const};
    const {result,rerender}=renderHook(({list,cursor,cut})=>useAnnouncer(list,cursor,0,false,cut),
      {initialProps:{list:[] as Announcement[],cursor:0,cut:null as {revision:number;toMs:number}|null}});
    // The cut reaches the clock before its destination frame/data have arrived.
    rerender({list:[red],cursor:0,cut:{revision:1,toMs:5000}});
    rerender({list:[red],cursor:5000,cut:{revision:1,toMs:5000}});
    expect(result.current).toBeNull();
    rerender({list:[red,goal(2,3000)],cursor:5000,cut:{revision:1,toMs:5000}});
    expect(result.current).toBeNull();
    rerender({list:[red,goal(2,3000),goal(3,5500)],cursor:5600,cut:{revision:1,toMs:5000}});
    expect(result.current?.id).toBe('goal:3');
  });
  it('a forward seek shows only the latest skipped goal, and redoes that summary when the skipped events arrive late', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ list, cursor, token }) => useAnnouncer(list, cursor, token),
      { initialProps: { list: [] as Announcement[], cursor: 0, token: 0 } });
    expect(result.current).toBeNull();
    rerender({ list: [goal(1, 1000)], cursor: 5000, token: 1 });
    expect(result.current?.id).toBe('goal:1');
    // La instantánea completa llega después: el resumen pasa al último gol, sin encadenar los dos.
    rerender({ list: [goal(1, 1000), goal(2, 3000)], cursor: 5000, token: 1 });
    expect(result.current?.id).toBe('goal:2');
    act(() => { vi.advanceTimersByTime(6100); });
    expect(result.current).toBeNull();
  });

  it('a seek whose cursor arrives a frame later still summarises instead of queueing every goal', () => {
    const list = [goal(1, 1000), goal(2, 3000)];
    const { result, rerender } = renderHook(({ cursor, token, seeking }) => useAnnouncer(list, cursor, token, seeking),
      { initialProps: { cursor: 0, token: 0, seeking: false } });
    rerender({ cursor: 0, token: 1, seeking: true });
    rerender({ cursor: 0, token: 1, seeking: false });
    expect(result.current).toBeNull();
    rerender({ cursor: 5000, token: 1, seeking: false });
    expect(result.current?.id).toBe('goal:2');
  });

  it('seeking back above a goal shows nothing; playing over it again announces it', () => {
    vi.useFakeTimers();
    const list = [goal(1, 1000)];
    const { result, rerender } = renderHook(({ cursor, token }) => useAnnouncer(list, cursor, token), { initialProps: { cursor: 2000, token: 0 } });
    expect(result.current).toBeNull();
    rerender({ cursor: 500, token: 1 });
    expect(result.current).toBeNull();
    rerender({ cursor: 1100, token: 1 });
    expect(result.current?.id).toBe('goal:1');
  });
});
