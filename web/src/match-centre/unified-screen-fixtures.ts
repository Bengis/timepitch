import { vi } from 'vitest';
import { syntheticAdapter, syntheticSnapshot } from './unified-fixtures';
import { cursorAt, type MatchSource, type PanelData, type PlayerView, type MetricView } from './session';

// UI boundary fixtures only: not sporting data or native/model execution.
export function screenFixture(source: MatchSource = 'historical', id = 'screen-fixture') {
  const snapshot = syntheticSnapshot({ source, id, revision: 'fixture-1' });
  const ok = { status: 'available' as const, reason: null };
  const missing = { status: 'unavailable' as const, reason: 'No measured tracking' };
  const metric: MetricView = { id: 'detail-only-new-metric', definition: 'fixture:distinct-definition', value: 0, unit: 'count', provenance: 'derived_from_events', availability: ok, evidenceIds: ['source:event'], subject: { kind: 'team', id: 'test:home' }, details: { numerator: 0, denominator: 10 } };
  const person: PlayerView = { id: 'test:home:1', name: 'Synthetic home player', side: 'home', sourceRefs: ['source:player'], role: { value: null, provenance: 'unavailable', refs: [] }, jersey: { value: null, provenance: 'unavailable', refs: [] }, intervals: { value: null, provenance: 'unavailable', refs: [] }, metrics: [metric], estimatedAttributes: [{ ...metric, id: 'input-estimate', provenance: 'estimated', value: 50 }], availability: ok, finalDetails: { cards: ['future-card'] } };
  const panel: PanelData = { availability: ok, scope: 'cursor', cutoff: snapshot.presentedCursor, metrics: [metric, { ...metric, id: 'distance_m', value: null, availability: missing, provenance: 'unavailable' }], players: [person, { ...person, id: 'unknown-subject', name: null, side: null }], playerDetails: [person], plots: ['actions', 'pass_network', 'occupancy', 'average_positions', 'xg', 'effort', 'action_zones', 'team_shape', 'future-kind'].map(kind => ({ id: `plot-${kind}`, kind, coordinateMeaning: `fixture meaning: ${kind}`, definition: `fixture:${kind}`, provenance: 'derived_from_events', availability: ok, points: kind === 'actions' ? [{ id: 'source:event', x: 30, y: 20, value: null, refs: ['source:event'] }] : [], edges: kind === 'pass_network' ? [{ from: person.id, to: 'unknown-subject', value: 2 }] : [], cells: kind === 'occupancy' ? [{ x: 10, y: 10, width: 5, height: 5, value: 2 }] : [], series: kind === 'xg' || kind === 'effort' ? [{ id: 'home', values: [{ elapsedMs: 0, value: 0 }, { elapsedMs: 1000, value: .1 }] }] : [], columns: ['source_id', 'value'], rows: [{ source_id: 'source:event', value: 0 }] })), standouts: [{ id: 'leaders', playerIds: [person.id], criterion: 'fixture criterion; ties retained', evidenceIds: ['source:event'], availability: ok }], definitions: [{ id: metric.id, text: metric.definition, provenance: metric.provenance, availability: ok }], sourceDetails: [{ id: 'fixture-data', value: 'source detail', provenance: 'source_recorded', refs: ['source:ref'], availability: ok }], finalDetails: { secret: 'future-final-data' } };
  snapshot.descriptor = { ...snapshot.descriptor, periods: [{ period: 1, startMs: 0, durationMs: 5000 }, { period: 2, startMs: 5000, durationMs: 5000 }], capabilities: { sections: ['match', 'summary', 'players', 'maps', 'effort', 'data'], playerDetails: true, events: true, layers: ['anchors', 'synthetic'] }, metadata: { finalResult: { score: { home: 2, away: 2 }, scope: 'final' } } };
  snapshot.panels = Object.fromEntries(snapshot.descriptor.capabilities.sections.map(section => [section, panel]));
  snapshot.events = [{ id: 'event-1', sourceIndex: 1, kind: 'pass', period: 1, periodMs: 0, elapsedMs: 0, side: 'home', actorId: person.id, participantIds: [person.id], outcome: 'complete', provenance: 'source_recorded', refs: ['source:event'], details: { location: { x: 10, y: 20 }, end_location: { x: 30, y: 20 } } }];
  snapshot.layers = { anchors: [{ id: 'anchor-1', eventId: 'event-1', entityId: person.id, elapsedMs: 0, point: { x: 30, y: 20 }, status: 'placed', reason: null, refs: ['source:event'], details: {} }], cuts: [{ id: 'cut-1', fromMs: 0, toMs: 100, entityIds: 'all', reason: 'Fixture cut', refs: [] }] };
  const store = syntheticAdapter(snapshot);
  store.adapter.ensure = vi.fn(async (time) => {
    const current = store.adapter.snapshot();
    store.publish({ ...current, requestedCursor: cursorAt(current.descriptor, time), presentedCursor: cursorAt(current.descriptor, time), interval: time === 10000 ? { ...current.interval!, fromMs: time, toMs: time, before: { ...current.interval!.before, clock_ms: time }, after: null } : { ...snapshot.interval! }, clockMs: time });
  });
  store.adapter.loadPanel = vi.fn(async () => {});
  store.adapter.loadPlayer = vi.fn(async () => {});
  store.adapter.loadEvents = vi.fn(async () => {});
  return { ...store, initial: snapshot, panel };
}
