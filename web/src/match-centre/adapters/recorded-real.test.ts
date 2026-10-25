import { expect, it } from 'vitest';
import { createRecordedSession } from './recorded-session';
import { loadRecordedReplay, sha256Hex, TRACKED_REPLAY_INDEX, type RecordedReplayEntry } from './recorded-replay';
import { elapsedForPlayhead, playheadAt } from './movement-selector';
import type { RecordedEngineId } from './recorded-track';
import { sampleInterval } from '../sampling';
import { loadRecordedEvents } from './recorded-events';
import { buildAnnouncements, RECORDED_ENGINE_KINDS } from '../announcements/announcements';

// Grabaciones locales y sin versionar (`.local/freeplay`); el paquete web nunca las contiene.
const dir = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env.TIMEPITCH_RECORDED_REPLAY_DIR;
const FILES: readonly [RecordedEngineId, string, [number, number], string][] = [
  ['grf', 'grf/grf-chelsea-swansea-42-cal1.json', [3, 2], 'grf-2.10.2-activity-1'],
  ['touchlines', 'touchlines/tl-chelsea-swansea-42-cal3.json', [2, 2], 'touchlines-5c5c71a-freeplay'],
  ['open-football', 'openfootball/of-chelsea-swansea-42-cal3.json', [2, 0], 'open-football-bfb2273-harness'],
];

// Carpeta servida (`.local/replays-dist`): cada `.json.gz` del índice versionado debe cargar tal cual.
const dist = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env.TIMEPITCH_RECORDED_REPLAY_DIST;
it.runIf(Boolean(dist))('every recording of the tracked index loads from the served gzip folder', async () => {
  const moduleName = 'node:fs';
  const fs = await import(/* @vite-ignore */ moduleName) as { readFileSync: (p: string) => Uint8Array<ArrayBuffer> };
  for (const entry of TRACKED_REPLAY_INDEX.recordings) {
    const track = await loadRecordedReplay(entry, async file => fs.readFileSync(`${dist}/${file}`).slice().buffer, new AbortController().signal);
    expect(track).toMatchObject({ engine: entry.engine, traceHash: entry.trace_hash, seed: entry.seed });
    expect(track.periodStarts.map(p => p.period)).toEqual([1, 2]);
    // TP212: a 0:00 se dibujan los 22 (open-football descarta su muestra de 0 ms, anterior a su primer tick).
    const start = createRecordedSession(entry.id, track);
    expect(sampleInterval(start.resolveFrame(0).interval!, 0).players).toHaveLength(22);
    start.dispose();
    // Sidecar de acontecimientos (TP202): verificado, ligado a la grabación y anunciado solo con lo que el motor graba.
    const events = await loadRecordedEvents(entry, async file => fs.readFileSync(`${dist}/${file}`).slice().buffer, new AbortController().signal);
    if (!events) continue;
    expect(events.events.filter(e => e.kind === 'goal' || e.kind === 'own_goal')).toHaveLength(track.goals.length);
    const session = createRecordedSession(entry.id, track, events);
    const all = session.resolveFrame(track.durationMs).events;
    if (entry.engine === 'grf') expect(all.filter(e => e.kind === 'goal').every(e => e.actorId !== null)).toBe(true);
    const announced = buildAnnouncements('recorded', all);
    for (const a of announced) expect(RECORDED_ENGINE_KINDS[entry.engine].has(a.kind)).toBe(true);
    console.info(entry.id, JSON.stringify(Object.fromEntries([...new Set(announced.map(a => a.kind))].map(k => [k, announced.filter(a => a.kind === k).length]))));
    session.dispose();
  }
}, 300000);

// TP238: con los toques de la grabación, GRF da escenas de Capitán Hane deducidas (paradas, fuera y robos), no solo goles.
it.runIf(Boolean(dist))('GRF recordings yield deduced Captain Hane scenes from the recorded touches', async () => {
  const moduleName = 'node:fs';
  const fs = await import(/* @vite-ignore */ moduleName) as { readFileSync: (p: string) => Uint8Array<ArrayBuffer> };
  const { cutInSources } = await import('../../match/anime/cutins');
  const { keeperIdsFor } = await import('../../match/anime/spec');
  for (const entry of TRACKED_REPLAY_INDEX.recordings.filter(e => e.engine === 'grf')) {
    const read = async (file: string) => fs.readFileSync(`${dist}/${file}`).slice().buffer;
    const track = await loadRecordedReplay(entry, read, new AbortController().signal);
    const session = createRecordedSession(entry.id, track, await loadRecordedEvents(entry, read, new AbortController().signal));
    const end = session.resolveFrame(track.durationMs), players = end.panels.players?.players ?? [];
    const all = [...end.events, ...end.touches ?? []].sort((x, y) => x.elapsedMs! - y.elapsedMs! || x.sourceIndex - y.sourceIndex);
    const scenes = cutInSources(all, buildAnnouncements('recorded', end.events), keeperIdsFor(players, null));
    const count = (kind: string) => scenes.filter(s => s.kind === kind).length;
    console.info(entry.id, JSON.stringify({ goal: count('goal'), save: count('save'), miss: count('miss'), tackle: count('tackle') }));
    expect(count('goal')).toBe(track.goals.length);
    expect(count('save')).toBeGreaterThan(0); expect(count('miss')).toBeGreaterThan(10); expect(count('tackle')).toBeGreaterThan(10);
    // La lista de eventos no crece: los toques van aparte.
    expect(end.events.some(e => e.kind === 'pass')).toBe(false);
    session.dispose();
  }
}, 300000);

it.runIf(Boolean(dir))('real local recordings load, verify and play through the common contract', async () => {
  const moduleName = 'node:fs';
  const fs = await import(/* @vite-ignore */ moduleName) as { readFileSync: (p: string) => Uint8Array<ArrayBuffer> };
  for (const [engine, file, finalScore, version] of FILES) {
    const bytes = fs.readFileSync(`${dir}/${file}`), text = new TextDecoder().decode(bytes);
    const head = JSON.parse(text) as { trace_hash: string };
    const entry: RecordedReplayEntry = { id: `${engine}-chelsea-swansea-42`, engine, engine_version: version, schema_version: 'grf-experimental-1', file,
      encoding: 'identity', bytes: bytes.byteLength, sha256: await sha256Hex(bytes), trace_hash: head.trace_hash, seed: 42, synthetic: true,
      calibration: file.match(/cal\d/)![0], home_key: 'chelsea:2015', away_key: 'swansea:2015' };
    console.info(JSON.stringify(entry));
    if (engine === 'touchlines') {
      // TouchLines hashea su propio JSON sin `trace_hash`: se puede comprobar en el navegador.
      const { trace_hash, ...rest } = JSON.parse(text) as Record<string, unknown>;
      expect(await sha256Hex(new TextEncoder().encode(JSON.stringify(rest)))).toBe(trace_hash);
    }
    const track = await loadRecordedReplay(entry, async () => bytes.slice().buffer, new AbortController().signal);
    expect(track.sample(track.sampleCount - 1).score).toEqual(finalScore);
    expect(track.goals).toHaveLength(finalScore[0] + finalScore[1]);
    expect(track.periodStarts.map(p => p.period)).toEqual([1, 2]);
    for (const [k, p] of track.periodStarts.entries()) {
      const end = track.periodStarts[k + 1]?.index ?? track.sampleCount;
      for (let i = p.index + 1; i < end; i++) expect(track.sample(i).matchMs >= track.sample(i - 1).matchMs).toBe(true);
    }
    expect(track.units.ballHeight).toBe(engine === 'touchlines' ? 'absent' : 'metres');
    const session = createRecordedSession(entry.id, track);
    for (const g of track.goals) {
      const ms = g.sampleIndex * track.intervalMs, frame = sampleInterval(session.resolveFrame(ms).interval!, ms);
      expect(frame.score).toEqual({ home: g.score[0], away: g.score[1] });
      expect(elapsedForPlayhead(track, playheadAt(track, ms))).toBeLessThanOrEqual(ms);
    }
    session.dispose();
  }
}, 300000);
