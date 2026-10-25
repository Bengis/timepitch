import { expect, it } from 'vitest';
import { normalizeSequenceEvent, validateSequenceEvents } from './evidence';
import { action, sequenceDescriptor } from './test-fixtures';

it('keeps_source_ids_and_rejects_ambiguous_links', () => {
  const d = sequenceDescriptor();
  const event = action('pass',1684024,'Pass',3057,{ pass: { recipient: { id: 7063, name: 'Wrong name' }, assisted_shot_id: 'saved' } },['receipt']);
  const normalized = normalizeSequenceEvent(event,d);
  expect(normalized).toMatchObject({ id: 'historical:pass', refs: ['pass'], actorId: 'historical:statsbomb:3057',
    recipientId: 'historical:statsbomb:7063', relatedIds: ['historical:receipt'], assistedShotId: 'historical:saved', start: null, end: null, durationMs: null, xg: null });
  expect(() => validateSequenceEvents([normalized,normalized])).toThrow(/duplicate/i);
  const foreign = normalizeSequenceEvent({ ...event, details: { pass: { recipient: { id: 999, name: 'Montero' } } } },d);
  expect(foreign.recipientId).toBeNull();
  const ambiguous = { ...d, metadata: { ...d.metadata, playerIdentities: [{ sourceId:7063,key:'a' },{ sourceId:7063,key:'b' }] } };
  expect(normalizeSequenceEvent(event,ambiguous).recipientId).toBeNull();
  expect(normalizeSequenceEvent({ ...event, duration:0, possession:0, details:{shot:{statsbomb_xg:0}} },d)).toMatchObject({ durationMs:0,possessionId:0,xg:0 });
});
it('preserves precise action duration, canonical endpoints and source order at equal time', () => {
  const d = sequenceDescriptor();
  const raw = { ...action('carry',1685158,'Carry',7063), duration:7.012573, canonical_location:{x:32.375,y:66.045}, canonical_end_location:{x:7.7,y:56.865} };
  const e = normalizeSequenceEvent(raw,d);
  expect(e.durationMs).toBeCloseTo(7012.573,9); expect(e.start).toEqual(raw.canonical_location);
  const receipt = { ...e,id:'historical:receipt',sourceIndex:e.sourceIndex-1 };
  expect(validateSequenceEvents([e,receipt]).map(v => v.id)).toEqual(['historical:receipt',e.id]);
  expect(normalizeSequenceEvent({...raw,player_key:'statsbomb:foreign'},d).actorId).toBeNull();
});
