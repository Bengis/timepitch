import { describe, expect, it } from 'vitest';
import { elapsedForPlayhead, movementOptions, movementText, playheadAt, selectMovement, type MovementMatch } from './movement-selector';
import { ENGINE_PROFILES, parseReplayIndex, RECORDED_INDEX_SCHEMA } from './recorded-replay';
import { normalizeRecording } from './recorded-track';
import { entryFor, rawRecording } from './recorded-fixtures';

const match: MovementMatch = { home_key: 'chelsea:2015', away_key: 'swansea:2015', seed: 42 };
async function index(engines: ('grf' | 'touchlines' | 'open-football')[], extra: unknown[] = []) {
  return parseReplayIndex({ schema: RECORDED_INDEX_SCHEMA, recordings: [...await Promise.all(engines.map(e => entryFor(e))), ...extra] });
}

describe('movement selector model', () => {
  it('always offers GRF, TouchLines and open-football in that order; a missing recording is «no disponible»', async () => {
    const options = movementOptions(await index(['grf', 'open-football']), match);
    expect(options.map(o => [o.engine, o.label, o.status, o.reason])).toEqual([
      ['grf', 'GRF', 'available', null], ['touchlines', 'TouchLines', 'unavailable', 'no_recording'], ['open-football', 'open-football', 'available', null]]);
    expect(movementText('es')).toMatchObject({ title: 'Motor', unavailable: 'no disponible' });
    expect(movementText('en')).toMatchObject({ title: 'Engine', unavailable: 'not available' });
  });
  it('recordings of another match or seed are not offered; rejected entries say why', async () => {
    const other = { ...await entryFor('grf'), id: 'other', home_key: 'arsenal:2003' };
    const old = { ...await entryFor('touchlines'), id: 'old', engine_version: 'touchlines-0000000-freeplay' };
    const options = movementOptions(await index([], [other, old]), match);
    expect(options.find(o => o.engine === 'grf')).toMatchObject({ status: 'unavailable', reason: 'no_recording' });
    expect(options.find(o => o.engine === 'touchlines')).toMatchObject({ status: 'unavailable', reason: 'unsupported_version' });
    expect(movementOptions(await index(['grf']), { ...match, seed: 7 })[0].status).toBe('unavailable');
  });
  it('switching keeps the match and the playhead (period + time into the period), not the raw elapsed time', () => {
    const grf = normalizeRecording(rawRecording('grf'), ENGINE_PROFILES.grf);
    const tlRaw = rawRecording('touchlines'); tlRaw.samples.splice(1, 1); tlRaw.samples.forEach((s, i) => { s.index = i; });
    (tlRaw.touchlines as { events: unknown[] }).events = [{ tick: 1, type: 'goalScored', scorerId: 10 }];
    const tl = normalizeRecording(tlRaw, ENGINE_PROFILES.touchlines);
    const playhead = playheadAt(grf, 600);
    expect(playhead).toEqual({ period: 2, periodMs: 200 });
    expect(elapsedForPlayhead(tl, playhead)).toBe(500);
    expect(elapsedForPlayhead(tl, { period: 1, periodMs: 99999 })).toBe(200);
    expect(elapsedForPlayhead(tl, { period: 3, periodMs: 0 })).toBe(tl.durationMs);
  });
  it('selecting an unavailable engine keeps the current one and reports it; available switches keep the match', async () => {
    const options = movementOptions(await index(['grf', 'open-football']), match);
    const state = { match, engine: 'grf' as const, playhead: { period: 2, periodMs: 1000 } };
    expect(selectMovement(state, options, 'touchlines')).toEqual({ state, notice: 'unavailable' });
    expect(selectMovement(state, options, 'open-football')).toEqual({ state: { ...state, engine: 'open-football' }, notice: null });
    expect(selectMovement(state, options, 'grf')).toEqual({ state, notice: null });
  });
});
