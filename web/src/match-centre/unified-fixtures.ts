import type { SceneFrame } from '../match/retroScene';
import type { MatchSessionAdapter, SessionIdentity, SessionSnapshot } from './session';

// Deliberately synthetic boundary data, never a historical football record.
export function syntheticFrame(overrides: Partial<SceneFrame> = {}): SceneFrame {
  return {
    clock_ms: 0, period: 1, score: { home: 0, away: 0 }, possession: 'home', carrier: 'test:home:1',
    ball: { x: 10, y: 20 },
    players: [
      { key: 'test:home:1', name: 'Synthetic home player', side: 'home', role: 'MID', x: 10, y: 20 },
      { key: 'test:away:1', name: 'Synthetic away player', side: 'away', role: 'DEF', x: 30, y: 40 },
    ], ...overrides,
  };
}

export function syntheticSnapshot(identity: SessionIdentity = { source: 'historical', id: 'synthetic', revision: '1' }): SessionSnapshot {
  return {
    descriptor: {
      identity, home: { id: 'test:home', name: 'Synthetic home', crestUrl: null },
      away: { id: 'test:away', name: 'Synthetic away', crestUrl: null },
      periods: [{ period: 1, startMs: 0, durationMs: 10_000 }], durationMs: 10_000,
      export: { href: null, availability: { status: 'unavailable', reason: 'Synthetic fixture' } },
      capabilities: { sections: ['match'], playerDetails: false, events: true, layers: [] },
    },
    requestedCursor: { elapsedMs: 0, period: 1, periodMs: 0 },
    presentedCursor: { elapsedMs: 0, period: 1, periodMs: 0 },
    facts: {
      score: { value: { home: 0, away: 0 }, provenance: 'derived_from_events', refs: [] },
      possession: { value: null, provenance: 'unavailable', refs: [] },
      carrierId: { value: null, provenance: 'unavailable', refs: [] },
    },
    interval: {
      fromMs: 0, toMs: 10_000, before: syntheticFrame(),
      after: syntheticFrame({ clock_ms: 10_000, ball: { x: 30, y: 40 },
        players: syntheticFrame().players.map(p => ({ ...p, x: p.x + 20, y: p.y + 20 })) }),
      continuousPlayers: new Set(['test:home:1', 'test:away:1']), continuousBall: true,
    },
    previousInterval: null, cue: undefined, clockMs: 42_000, events: [], panels: {},
    loadState: 'ready', reason: null, horizonMs: 10_000,
  };
}

export function syntheticAdapter(initial = syntheticSnapshot()) {
  let value = initial;
  const listeners = new Set<() => void>();
  const adapter: MatchSessionAdapter = {
    identity: initial.descriptor.identity,
    snapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ensure: async () => {}, loadPanel: async () => {}, loadPlayer: async () => {}, loadEvents: async () => {},
    dispose: () => {},
  };
  return { adapter, publish: (next: SessionSnapshot) => { value = next; listeners.forEach(listener => listener()); }, listeners };
}

// Ordered equal-time facts must be resolved by the adapter, not by interpolation.
export const syntheticEqualTimeFacts = [
  { id: 'test:goal', sourceIndex: 10, elapsedMs: 1000 },
  { id: 'test:substitution', sourceIndex: 11, elapsedMs: 1000 },
  { id: 'test:period-end', sourceIndex: 12, elapsedMs: 1000 },
];
