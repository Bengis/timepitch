// G04 · Apariencia asignada a mano para los equipos de la demo (Arsenal 2003/04 y Manchester City 2024/25).
// Clave por QID (enumerado desde el dorsal de la temporada en Wikipedia; nunca por nombre). Fuera del registro,
// siempre el mismo GENERIC_APPEARANCE: no se deriva aspecto de nombres ni hashes.
import registry from './appearance-demo.json';
import {
  GENERIC_APPEARANCE, type AppearanceParams, type Beard, type EyeColour, type HairColour, type HairStyle,
  type PlayerRecord, type SkinTone,
} from '../presentation/types';

export const HAND_ASSIGNED_PROVENANCE = 'asignado a mano · rasgos sin fuente';

export type AppearanceEntry = Readonly<{
  club: string; season: number; number: number; display: string;
  skin: SkinTone; hairStyle: HairStyle; hairColour: HairColour; beard: Beard; eyes: EyeColour;
  boots: string; build: number;
  /** Respaldo de Wikidata P2048; manda `record.heightCm` cuando existe. */
  heightCm: number | null;
  heightSource: Readonly<{ kind: 'wikidata'; qid: string; revision: number; licence: string }> | null;
  confidence: 'media' | 'baja';
  provenance: string;
  numberShared?: boolean;
}>;

export type AppearanceRegistry = Readonly<{
  _meta: Readonly<Record<string, string>>;
  squads: Readonly<Record<string, Readonly<{ kind: 'wikipedia'; title: string; revid: number; licence: string }>>>;
  players: Readonly<Record<string, AppearanceEntry>>;
}>;

export const APPEARANCE_REGISTRY = registry as unknown as AppearanceRegistry;

export type AppearanceResult = Readonly<{ params: AppearanceParams; source: 'hand_assigned' | 'generic' }>;

const GENERIC_RESULT: AppearanceResult = Object.freeze({ params: GENERIC_APPEARANCE, source: 'generic' });

export function appearanceFor(qid: string | null, record: PlayerRecord | null): AppearanceResult {
  const entry = qid ? APPEARANCE_REGISTRY.players[qid] : undefined;
  if (!entry) return GENERIC_RESULT;
  const params: AppearanceParams = Object.freeze({
    skin: entry.skin, hairStyle: entry.hairStyle, hairColour: entry.hairColour, beard: entry.beard, eyes: entry.eyes,
    boots: entry.boots, build: entry.build,
    heightCm: record?.heightCm ?? entry.heightCm ?? null,
  });
  return { params, source: 'hand_assigned' };
}
