import { expect, it, vi } from 'vitest';
import { readAnimeScenes, readPitchPreferences, readSoundEnabled, writeAnimeScenes, writePitchPreferences, writeSoundEnabled } from './preferences';
import { drawingRendererFor } from './types';

// TP223: Retro 16 bits by default; 3D stays selectable and is kept only when the user chose it.
const defaults = { version: 2, renderer: 'retro16-1', rendererChosen: false, appearance: 'daylight', camera: 'follow', detail: 'standard' } as const;
const v1 = { version: 1, renderer: 'stylized-3d-1', appearance: 'daylight', camera: 'follow', detail: 'standard' } as const;
const read = (value: unknown, camera?: 'follow' | 'overview') => readPitchPreferences({ getItem: () => JSON.stringify(value) }, camera);

it('fresh profiles default to Retro 16 bits and storage_denied_or_corrupt_is_safe', () => {
  expect(readPitchPreferences(null)).toEqual(defaults);
  expect(readPitchPreferences({ getItem() { throw new Error('denied'); } })).toEqual(defaults);
  for (const value of ['bad JSON', 'null', '[]', '{"version":3,"renderer":"stylized-3d-1","rendererChosen":true}'])
    expect(readPitchPreferences({ getItem: () => value })).toEqual(defaults);
  expect(writePitchPreferences({ setItem() { throw new Error('denied'); } }, defaults)).toBe(false);
  expect(writePitchPreferences(null, defaults)).toBe(false);
});
it('v1 migration: 3D was the implicit default (Pitch saved it on mount), so it moves to Retro 16 bits keeping the rest', () => {
  const saved = { ...v1, appearance: 'floodlights', camera: 'overview', detail: 'low' } as const;
  expect(read(saved)).toEqual({ ...defaults, appearance: 'floodlights', camera: 'overview', detail: 'low' });
});
it.each(['fc-broadcast-1', 'sensible-1', 'retro-1'] as const)('v1 migration: a retired 2D %s choice moves to Retro 16 bits', renderer => {
  expect(read({ ...v1, renderer, detail: 'low' })).toEqual({ ...defaults, detail: 'low' });
});
it('v1 migration: Retro 16 bits was never the default, so it is an explicit choice and stays', () => {
  expect(read({ ...v1, renderer: 'retro16-1', camera: 'overview' })).toEqual({ ...defaults, rendererChosen: true, camera: 'overview' });
});
it('v2: an explicit 3D choice is kept; an unchosen or unknown renderer reads as the default', () => {
  expect(read({ ...defaults, renderer: 'stylized-3d-1', rendererChosen: true })).toEqual({ ...defaults, renderer: 'stylized-3d-1', rendererChosen: true });
  expect(read({ ...defaults, renderer: 'stylized-3d-1', rendererChosen: false })).toEqual(defaults);
  expect(read({ ...defaults, renderer: 'stylized-3d-1' , rendererChosen: 'yes' })).toEqual(defaults);
  for (const renderer of ['sensible-1', 'retro-1', 'fc-broadcast-1', 'retro16-2', 'RETRO16-1', '../remote.js'])
    expect(read({ ...defaults, renderer, rendererChosen: true })).toEqual(defaults);
  expect(read({ version: 2 })).toEqual(defaults);
  expect(read({ version: 1 })).toEqual(defaults);
});
it('pilot full-pitch fallback preserves a valid saved camera', () => {
  expect(readPitchPreferences(null, 'overview')).toEqual({ ...defaults, camera: 'overview' });
  expect(read(defaults, 'overview')).toEqual(defaults);
  expect(read({ version: 1, renderer: 'retro-1', camera: 'invalid' }, 'overview')).toEqual({ ...defaults, camera: 'overview' });
});
it('round trips only versioned presentation settings, always as v2, and whitelists every enum', () => {
  const setItem = vi.fn(), value = { ...defaults, renderer: 'stylized-3d-1', rendererChosen: true, appearance: 'floodlights', camera: 'overview', detail: 'low', matchId: 'must-not-persist' } as const;
  const stored = { version: 2, renderer: 'stylized-3d-1', rendererChosen: true, appearance: 'floodlights', camera: 'overview', detail: 'low' };
  expect(writePitchPreferences({ setItem }, value)).toBe(true);
  expect(setItem).toHaveBeenCalledWith('timepitch.pitch.v1', JSON.stringify(stored));
  expect(readPitchPreferences({ getItem: () => setItem.mock.calls[0][1] })).toEqual(stored);
  expect(read({ version: 2, renderer: 'retro16-1', rendererChosen: true, appearance: 'bad', camera: 'bad', detail: 'bad' })).toEqual({ ...defaults, rendererChosen: true });
});

// TP231: match sound, on by default, in its own key so Pitch's rewrite of the pitch preferences cannot clobber it.
it('match sound: on by default, an explicit off persists, and denied or corrupt storage reads as on', () => {
  const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  expect(readSoundEnabled(storage)).toBe(true);
  expect(writeSoundEnabled(storage, false)).toBe(true);
  expect(store.get('timepitch.sound.v1')).toBe(JSON.stringify({ version: 1, enabled: false }));
  expect(readSoundEnabled(storage)).toBe(false);
  writePitchPreferences(storage, defaults);
  expect(readSoundEnabled(storage)).toBe(false);
  expect(writeSoundEnabled(storage, true)).toBe(true); expect(readSoundEnabled(storage)).toBe(true);
  for (const value of ['bad JSON', '[]', '{"enabled":"no"}']) expect(readSoundEnabled({ getItem: () => value })).toBe(true);
  expect(readSoundEnabled({ getItem() { throw new Error('denied'); } })).toBe(true);
  expect(readSoundEnabled(null)).toBe(true);
  expect(writeSoundEnabled({ setItem() { throw new Error('denied'); } }, false)).toBe(false);
  expect(writeSoundEnabled(null, false)).toBe(false);
});

// TP234: Capitán Hane (`anime-1`) is a selectable choice drawn with Retro 16-bit; its scenes setting has its own key.
it('Captain Hane is no longer offered (TP240): a stored Hane choice falls back to Retro 16-bit', () => {
  const setItem = vi.fn();
  expect(writePitchPreferences({ setItem }, { ...defaults, renderer: 'anime-1', rendererChosen: true })).toBe(true);
  expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({ renderer: 'retro16-1', rendererChosen: false });
  expect(read({ ...defaults, renderer: 'anime-1', rendererChosen: true })).toEqual(defaults);
  expect(read({ ...v1, renderer: 'anime-1' })).toEqual(defaults);
  expect(drawingRendererFor('anime-1')).toBe('retro16-1');
  expect(drawingRendererFor('stylized-3d-1')).toBe('stylized-3d-1');
});
it('anime scenes: all by default, «goals only» and «none» persist, and Pitch rewriting its key does not clobber them', () => {
  const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  expect(readAnimeScenes(storage)).toBe('all');
  expect(writeAnimeScenes(storage, 'goals')).toBe(true);
  expect(store.get('timepitch.anime.v1')).toBe(JSON.stringify({ version: 1, scenes: 'goals' }));
  writePitchPreferences(storage, defaults);
  expect(readAnimeScenes(storage)).toBe('goals');
  writeAnimeScenes(storage, 'none'); expect(readAnimeScenes(storage)).toBe('none');
  for (const value of ['bad JSON', '[]', '{"scenes":"some"}', 'null']) expect(readAnimeScenes({ getItem: () => value })).toBe('all');
  expect(readAnimeScenes({ getItem() { throw new Error('denied'); } })).toBe('all');
  expect(readAnimeScenes(null)).toBe('all');
  expect(writeAnimeScenes(null, 'none')).toBe(false);
  expect(writeAnimeScenes({ setItem() { throw new Error('denied'); } }, 'none')).toBe(false);
});
