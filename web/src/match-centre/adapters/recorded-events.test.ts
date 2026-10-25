import { describe, expect, it } from 'vitest';
import { loadRecordedEvents, parseRecordedEvents, RECORDED_EVENTS_SCHEMA } from './recorded-events';
import { parseReplayIndex, RECORDED_INDEX_SCHEMA, TRACKED_REPLAY_INDEX } from './recorded-replay';
import { RecordingError, RECORDED_ENGINE_IDS } from './recorded-track';
import { entryFor, eventsEntryFor, rawEvents } from './recorded-fixtures';

const signal = () => new AbortController().signal;
const reader = (bytes: Uint8Array) => async () => bytes.slice().buffer;
async function code(promise: Promise<unknown>) { try { await promise; return 'ok'; } catch (e) { return e instanceof RecordingError ? e.code : String(e); } }

describe('recorded events sidecar (recorded-events-1)', () => {
  for (const engine of RECORDED_ENGINE_IDS) it(`${engine}: loads, verifies bytes and binds to the indexed recording`, async () => {
    const { entry, bytes, events } = await eventsEntryFor(engine);
    const loaded = (await loadRecordedEvents(entry, reader(bytes), signal()))!;
    expect(loaded).toMatchObject({ engine, traceHash: entry.trace_hash, recordingSha256: entry.sha256, notExported: { 'touch:trap': 3 } });
    expect(loaded.events).toHaveLength(events.events.length);
    expect(loaded.events.find(e => e.kind === 'offside')).toMatchObject({ sampleIndex: 5, period: 2, tMs: 500, side: expect.any(String), slot: 10 });
  });
  it('absent sidecar: nothing is read and the result is null (current behaviour)', async () => {
    let reads = 0;
    expect(await loadRecordedEvents(await entryFor('grf'), async () => { reads++; return new ArrayBuffer(0); }, signal())).toBeNull();
    expect(reads).toBe(0);
  });
  it('a changed byte is a hash mismatch; a wrong length is a size mismatch', async () => {
    const { entry, bytes } = await eventsEntryFor('touchlines');
    const tampered = bytes.slice(); tampered[tampered.length - 5] ^= 1;
    expect(await code(loadRecordedEvents(entry, reader(tampered), signal()))).toBe('hash_mismatch');
    expect(await code(loadRecordedEvents({ ...entry, events: { ...entry.events, bytes: entry.events.bytes + 1 } }, reader(bytes), signal()))).toBe('size_mismatch');
  });
  it('rejects another schema, another recording or another engine', async () => {
    const cases: [(e: ReturnType<typeof rawEvents>) => void, string][] = [
      [e => { e.schema = 'recorded-events-2'; }, 'unsupported_schema'],
      [e => { (e.recording as Record<string, unknown>).trace_hash = 'ff'.repeat(32); }, 'identity_mismatch'],
      [e => { (e.recording as Record<string, unknown>).sha256 = 'ee'.repeat(32); }, 'identity_mismatch'],
      [e => { e.engine = 'touchlines'; }, 'identity_mismatch'],
      [e => { e.synthetic = false; }, 'not_synthetic'],
    ];
    for (const [mutate, expected] of cases) {
      const { entry, bytes } = await eventsEntryFor('grf', mutate);
      expect(await code(loadRecordedEvents(entry, reader(bytes), signal()))).toBe(expected);
    }
  });
  it('rejects unknown kinds, bad sides and slots out of range instead of guessing', async () => {
    const { entry } = await eventsEntryFor('grf');
    const bad = (patch: Record<string, unknown>) => { const e = rawEvents('grf'); (e.recording as Record<string, unknown>).sha256 = entry.sha256; Object.assign(e.events[1], patch); return e; };
    for (const patch of [{ kind: 'dive' }, { side: 'left' }, { slot: 11 }, { t_ms: -1 }, { sample_index: 1.5 }])
      expect(() => parseRecordedEvents(bad(patch), entry)).toThrow(RecordingError);
  });
  it('the index accepts a well-formed events descriptor and rejects a malformed one with its reason', async () => {
    const { entry } = await eventsEntryFor('open-football');
    const index = parseReplayIndex({ schema: RECORDED_INDEX_SCHEMA, recordings: [entry,
      { ...entry, id: 'bad-events', events: { ...entry.events, file: '../x.json' } }, { ...entry, id: 'bad-schema', events: { ...entry.events, schema: 'other' } }] });
    expect(index.recordings.map(r => r.id)).toEqual([entry.id]);
    expect(index.rejected.map(r => [r.id, r.code])).toEqual([['bad-events', 'invalid_recording'], ['bad-schema', 'unsupported_schema']]);
  });
  it('the tracked seed-43 demo recordings carry a gzip sidecar next to the recording', () => {
    const demo = TRACKED_REPLAY_INDEX.recordings.filter(r => r.home_key === 'arsenal:2003' && r.seed === 43);
    expect(demo.map(r => r.engine).sort()).toEqual(['grf', 'open-football', 'touchlines']);
    for (const r of demo) expect(r.events).toMatchObject({ schema: RECORDED_EVENTS_SCHEMA, encoding: 'gzip', file: r.file.replace(/\.json\.gz$/, '.events.json.gz') });
  });
});
