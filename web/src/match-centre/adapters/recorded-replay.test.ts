import { describe, expect, it } from 'vitest';
import { DEFAULT_REPLAYS_BASE, httpReplayReader, loadRecordedReplay, parseReplayIndex, replayUrl, TRACKED_REPLAY_INDEX, validateRecording, RECORDED_INDEX_SCHEMA } from './recorded-replay';
import { RecordingError, RECORDED_ENGINE_IDS, type RecordedEngineId } from './recorded-track';
import { bytesOf, entryFor, rawRecording, sha256 } from './recorded-fixtures';

const signal = () => new AbortController().signal;
const reader = (bytes: Uint8Array) => async () => bytes.slice().buffer;
async function code(promise: Promise<unknown>) { try { await promise; return 'ok'; } catch (e) { return e instanceof RecordingError ? e.code : String(e); } }

describe('recorded replay index', () => {
  it('keeps the three registered engines and rejects unknown engines/versions honestly, without throwing', async () => {
    const entries = await Promise.all(RECORDED_ENGINE_IDS.map(e => entryFor(e)));
    const index = parseReplayIndex({ schema: RECORDED_INDEX_SCHEMA, recordings: [...entries,
      { ...entries[0], id: 'fifa', engine: 'fifa' }, { ...entries[1], id: 'tl-old', engine_version: 'touchlines-0000000-freeplay' }] });
    expect(index.recordings.map(r => r.engine)).toEqual(['grf', 'touchlines', 'open-football']);
    expect(index.rejected).toEqual([{ id: 'fifa', engine: 'fifa', code: 'unknown_engine' }, { id: 'tl-old', engine: 'touchlines', code: 'unsupported_version' }]);
  });
  it('rejects an index with another schema or a malformed hash', async () => {
    expect(() => parseReplayIndex({ schema: 'other', recordings: [] })).toThrow(RecordingError);
    const bad = { ...await entryFor('grf'), sha256: 'nothex' };
    expect(parseReplayIndex({ schema: RECORDED_INDEX_SCHEMA, recordings: [bad] }).rejected[0].code).toBe('invalid_recording');
  });
});

describe('loading a recorded replay', () => {
  for (const engine of RECORDED_ENGINE_IDS) it(`${engine}: verifies the file hash and binds trace hash, version and seed`, async () => {
    const raw = rawRecording(engine), bytes = bytesOf(raw), entry = await entryFor(engine, raw, bytes);
    const track = await loadRecordedReplay(entry, reader(bytes), signal());
    expect(track).toMatchObject({ engine, engineVersion: entry.engine_version, traceHash: entry.trace_hash, seed: 42, synthetic: true });
  });
  it('a changed byte is a hash mismatch; a wrong length is a size mismatch', async () => {
    const raw = rawRecording('grf'), bytes = bytesOf(raw), entry = await entryFor('grf', raw, bytes);
    const tampered = bytes.slice(); tampered[tampered.length - 3] ^= 1;
    expect(await code(loadRecordedReplay(entry, reader(tampered), signal()))).toBe('hash_mismatch');
    expect(await code(loadRecordedReplay({ ...entry, bytes: entry.bytes + 1 }, reader(bytes), signal()))).toBe('size_mismatch');
  });
  it('a valid file that is not the indexed recording is an identity mismatch', async () => {
    const raw = rawRecording('touchlines'); raw.trace_hash = 'ff'.repeat(32);
    const bytes = bytesOf(raw), entry = { ...await entryFor('touchlines', raw, bytes), trace_hash: '76'.repeat(32) };
    expect(await code(loadRecordedReplay(entry, reader(bytes), signal()))).toBe('identity_mismatch');
    const seed = { ...await entryFor('touchlines', raw, bytes), seed: 7 };
    expect(await code(loadRecordedReplay(seed, reader(bytes), signal()))).toBe('identity_mismatch');
  });
  it('rejects unregistered versions, other schemas and recordings that do not declare themselves synthetic', async () => {
    const cases: [RecordedEngineId, (r: Record<string, unknown>) => void, string][] = [
      ['grf', r => { r.engine_version = 'grf-2.10.2-stats-1'; }, 'unsupported_version'],
      ['open-football', r => { r.schema_version = 'grf-experimental-3'; }, 'unsupported_schema'],
      ['touchlines', r => { r.synthetic = false; }, 'not_synthetic'],
      ['touchlines', r => { (r.touchlines as Record<string, unknown>).physical_clock = false; }, 'unsupported_version'],
    ];
    for (const [engine, mutate, expected] of cases) {
      const raw = rawRecording(engine); mutate(raw);
      const entry = { ...await entryFor(engine, raw), engine_version: rawRecording(engine).engine_version as string };
      expect(() => validateRecording(raw, entry)).toThrow(expected);
    }
  });
  it('decodes gzip recordings and hashes the bytes as served', async () => {
    const raw = rawRecording('open-football'), plain = bytesOf(raw);
    const gz = new Uint8Array(await new Response(new Response(plain).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const entry = { ...await entryFor('open-football', raw, plain), encoding: 'gzip' as const, bytes: gz.byteLength, sha256: await sha256(gz) };
    expect((await loadRecordedReplay(entry, reader(gz), signal())).engine).toBe('open-football');
  });
  it('reads served gzip bytes over HTTP from the configured base, without credentials', async () => {
    const raw = rawRecording('touchlines'), plain = bytesOf(raw);
    const gz = new Uint8Array(await new Response(new Response(plain).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const entry = { ...await entryFor('touchlines', raw, plain), file: 'm-42/touchlines-cal3.json.gz', encoding: 'gzip' as const, bytes: gz.byteLength, sha256: await sha256(gz) };
    const calls: [string, RequestInit | undefined][] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response(gz.slice()); }) as unknown as typeof fetch;
    expect((await loadRecordedReplay(entry, httpReplayReader('https://cdn.example/replays', fetchImpl), signal())).engine).toBe('touchlines');
    expect(calls[0][0]).toBe('https://cdn.example/replays/m-42/touchlines-cal3.json.gz');
    expect(calls[0][1]?.credentials).toBe('omit');
    expect(replayUrl('a/b.json.gz', DEFAULT_REPLAYS_BASE)).toBe('/replays/a/b.json.gz');
    expect(() => replayUrl('../x.json.gz', '/replays/')).toThrow(RecordingError);
    const missing = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
    expect(await code(loadRecordedReplay(entry, httpReplayReader('/replays/', missing), signal()))).toBe('unavailable');
  });
  it('the tracked index lists every published recording as gzip, accepted, with distinct files', () => {
    expect(TRACKED_REPLAY_INDEX.rejected).toEqual([]);
    expect(TRACKED_REPLAY_INDEX.recordings.length).toBeGreaterThan(0);
    expect(TRACKED_REPLAY_INDEX.recordings.every(r => r.encoding === 'gzip' && r.file.endsWith('.json.gz'))).toBe(true);
    expect(new Set(TRACKED_REPLAY_INDEX.recordings.map(r => r.file)).size).toBe(TRACKED_REPLAY_INDEX.recordings.length);
    const keys = TRACKED_REPLAY_INDEX.recordings.map(r => `${r.engine}|${r.home_key}|${r.away_key}|${r.seed}`);
    expect(new Set(keys).size).toBe(keys.length); // el selector toma una grabación por motor y partido
  });
  it('an aborted load does not read', async () => {
    const control = new AbortController(); control.abort();
    let reads = 0;
    await expect(loadRecordedReplay(await entryFor('grf'), async () => { reads++; return new ArrayBuffer(0); }, control.signal)).rejects.toThrow(/Abort/);
    expect(reads).toBe(0);
  });
});
