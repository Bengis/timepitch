// G17 · useAnnouncer: búsqueda sin ráfagas y con datos que llegan tarde para el tramo saltado.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Announcement } from './announcements/announcements';
import { useAnnouncer } from './useAnnouncer';

const goal = (n: number, atMs: number): Announcement => ({ id: `goal:${n}`, kind: 'goal', priority: 100, durationMs: 6000, atMs, minuteLabel: `${n}'`,
  side: 'home', primaryPlayerId: null, scoreAfter: { home: n, away: 0 }, provenance: 'simulated' });

afterEach(() => vi.useRealTimers());

describe('useAnnouncer', () => {
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
