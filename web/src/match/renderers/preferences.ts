import type { CameraMode } from '../retroScene';
import type { Appearance, DetailLevel, SelectableRendererId } from './types';

/**
 * «Retro 16 bits» (`retro16-1`) de serie desde TP223; el 3D (`stylized-3d-1`, de serie en TP205–TP222) sigue elegible.
 * `rendererChosen` dice si el gráfico lo eligió el usuario en «Gráficos»: solo entonces se respeta el guardado.
 *
 * Migración del registro v1 (TP223). `Pitch` guardaba las preferencias al montarse, así que un v1 con 3D no distingue
 * a quien eligió 3D de quien nunca tocó «Gráficos» (era el valor de serie). Regla:
 * - v1 con `retro16-1`: elección explícita (no era el de serie) → se conserva;
 * - v1 con `stylized-3d-1` o con un 2D retirado (`retro-1`, `fc-broadcast-1`, `sensible-1`): implícito → Retro 16 bits.
 *   Quien quiera 3D lo elige una vez y desde entonces queda guardado como elección (v2).
 * Iluminación, cámara y detalle se conservan siempre.
 */
export type PitchPreferences = Readonly<{
  version: 2; renderer: SelectableRendererId; rendererChosen: boolean; appearance: Appearance; camera: CameraMode; detail: DetailLevel;
}>;
const KEY = 'timepitch.pitch.v1';
export const DEFAULT_RENDERER: SelectableRendererId = 'retro16-1';
const defaults: PitchPreferences = { version: 2, renderer: DEFAULT_RENDERER, rendererChosen: false, appearance: 'daylight', camera: 'follow', detail: 'standard' };
// TP240 («quita la UI de Hane»): Capitán Hane ya no se ofrece; un `anime-1` guardado vuelve a Retro 16 bits.
const selectable = (value: unknown): value is SelectableRendererId => value === 'retro16-1' || value === 'stylized-3d-1';
function normalize(raw: unknown, defaultCamera:CameraMode=defaults.camera): PitchPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('version' in raw) || (raw.version !== 1 && raw.version !== 2)) return { ...defaults,camera:defaultCamera };
  const value = raw as Record<string, unknown>;
  const chosen = value.version === 2 ? value.rendererChosen === true && selectable(value.renderer) : value.renderer === 'retro16-1';
  return { version: 2, renderer: chosen ? value.renderer as SelectableRendererId : DEFAULT_RENDERER, rendererChosen: chosen,
    appearance: value.appearance === 'floodlights' ? 'floodlights' : 'daylight',
    camera: value.camera === 'overview'||value.camera==='follow' ? value.camera : defaultCamera, detail: value.detail === 'low' ? 'low' : 'standard' };
}
export function readPitchPreferences(storage: Pick<Storage, 'getItem'> | null, defaultCamera?:CameraMode): PitchPreferences {
  try { return normalize(JSON.parse(storage?.getItem(KEY) ?? 'null'),defaultCamera); } catch { return { ...defaults,camera:defaultCamera??defaults.camera }; }
}
export function writePitchPreferences(storage: Pick<Storage, 'setItem'> | null, value: PitchPreferences): boolean {
  try { if (!storage) return false; storage.setItem(KEY, JSON.stringify(normalize(value))); return true; } catch { return false; }
}
export function pitchStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * Sonido del partido (TP231): clave propia para que `Pitch`, que reescribe `timepitch.pitch.v1` con su estado, no la
 * pise. Activado de serie; solo un `false` guardado lo apaga. Almacenamiento denegado o corrupto: activado.
 */
const SOUND_KEY = 'timepitch.sound.v1';
export function readSoundEnabled(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { const raw = JSON.parse(storage?.getItem(SOUND_KEY) ?? 'null'); return !(raw && typeof raw === 'object' && raw.enabled === false); } catch { return true; }
}
/**
 * Escenas de Capitán Hane (TP234): «todas / solo goles / ninguna», en clave propia por la misma razón que el sonido.
 * De serie, todas; cualquier valor desconocido, almacenamiento denegado o corrupto: todas.
 */
const ANIME_KEY = 'timepitch.anime.v1';
export type AnimeScenesSetting = 'all' | 'goals' | 'none';
export function readAnimeScenes(storage: Pick<Storage, 'getItem'> | null): AnimeScenesSetting {
  try { const raw = JSON.parse(storage?.getItem(ANIME_KEY) ?? 'null'); return raw?.scenes === 'goals' || raw?.scenes === 'none' ? raw.scenes : 'all'; } catch { return 'all'; }
}
export function writeAnimeScenes(storage: Pick<Storage, 'setItem'> | null, scenes: AnimeScenesSetting): boolean {
  try { if (!storage) return false; storage.setItem(ANIME_KEY, JSON.stringify({ version: 1, scenes: scenes === 'goals' || scenes === 'none' ? scenes : 'all' })); return true; } catch { return false; }
}
export function writeSoundEnabled(storage: Pick<Storage, 'setItem'> | null, enabled: boolean): boolean {
  try { if (!storage) return false; storage.setItem(SOUND_KEY, JSON.stringify({ version: 1, enabled })); return true; } catch { return false; }
}
