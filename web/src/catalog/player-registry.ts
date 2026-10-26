// G12 · Fichas públicas de jugador (subconjunto de los equipos de la demo) y enlaces revisados fila de fuente → QID.
// Fichas: `public/data/players/<club>-<season>.json`, solo campos de Wikidata (CC0) y del artículo de temporada de la
// Wikipedia inglesa (CC BY-SA 4.0). Nunca Transfermarkt, FPL, epldata ni StatsBomb. Identidad solo por QID.
import { fictional, fictionalPlayer } from './fictional';
import linksJson from './player-links.json';
import { assertNoTransfermarkt, isAssetSource } from '../presentation/registry-schema';
import type { PlayerLink, PlayerRecord } from '../presentation/types';

export type SquadNumber = Readonly<{ value: string; position: string | null; nationFlag: string | null }>;

/** `PlayerRecord` con los datos extra que muestra la ficha. */
export type PlayerCardRecord = PlayerRecord & Readonly<{
  numbers: readonly SquadNumber[];
  /** `sport` = Wikidata P1532; `citizenship` = P27 (sin P1532); `manual` = corrección aprobada, citada. */
  nationBasis: 'sport' | 'citizenship' | 'manual' | null;
  sportNationalities: readonly string[];
  citizenship: readonly string[];
  wikidataPositions: readonly string[];
  flags: readonly string[];
}>;

export type ReviewedLink = PlayerLink & Readonly<{ teamKey: string; confidence: 'high' | 'medium' | 'low' | null }>;

type LinksFile = Readonly<{ _meta: Readonly<{ teamKeys: readonly string[] }>; links: readonly ReviewedLink[] }>;

const METHODS: ReadonlySet<PlayerLink['method']> = new Set(['manual', 'jersey_club_season', 'dob_club_season', 'opta']);

export const PLAYER_LINKS = linksJson as unknown as LinksFile;
/** Equipos con ficha pública (los de la demo). */
export const CARD_TEAM_KEYS: readonly string[] = PLAYER_LINKS._meta.teamKeys;

const BY_KEY: ReadonlyMap<string, ReviewedLink> = new Map(
  PLAYER_LINKS.links.filter(l => l.reviewed && METHODS.has(l.method)).map(l => [`${l.source}\u0000${l.sourceKey}`, l]),
);

/** Enlace revisado para una fila de fuente (`epldata`, `fpl`, `statsbomb`); `null` si no hay uno aprobado. */
export function linkFor(source: string, sourceKey: string): ReviewedLink | null {
  return BY_KEY.get(`${source}\u0000${sourceKey}`) ?? null;
}

/** Ficha por QID dentro de la plantilla; nunca por nombre ni por dorsal. */
export function recordFor<T extends PlayerRecord>(squad: readonly T[], link: Pick<PlayerLink, 'qid'> | null): T | null {
  if (!link?.qid) return null;
  return squad.find(r => r.qid === link.qid) ?? null;
}

export function squadUrl(teamKey: string): string | null {
  const m = /^([a-z]+):(\d{4})$/.exec(teamKey);
  if (!m || !CARD_TEAM_KEYS.includes(teamKey)) return null;
  return `${import.meta.env.BASE_URL}data/players/${m[1]}-${m[2]}.json`;
}

/** Valida un fichero de plantilla y devuelve sus fichas; lanza si trae campos `tm_*` o fuentes no válidas. */
export function parseSquad(json: unknown): readonly PlayerCardRecord[] {
  assertNoTransfermarkt(json);
  const players = (json as { players?: unknown })?.players;
  if (!Array.isArray(players)) throw new Error('Player card file without players');
  for (const p of players as PlayerCardRecord[]) {
    if (typeof p.qid !== 'string' || !/^Q\d+$/.test(p.qid)) throw new Error(`Player card without QID: ${String(p.qid)}`);
    for (const [field, source] of Object.entries(p.fields ?? {})) {
      if (!isAssetSource(source)) throw new Error(`Invalid source for ${p.qid}.${field}`);
    }
  }
  return players as readonly PlayerCardRecord[];
}

/** Carga la plantilla pública de `teamKey`; `[]` si no es un equipo de la demo o el fichero no existe. */
export async function loadSquad(teamKey: string, signal: AbortSignal): Promise<readonly PlayerCardRecord[]> {
  const url = squadUrl(teamKey);
  if (!url) return [];
  const response = await fetch(url, { signal });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Player cards ${teamKey}: HTTP ${response.status}`);
  const squad = parseSquad(await response.json());
  // TP259: en la liga ficticia la ficha lleva el nombre inventado y no la nacionalidad ni la fecha de nacimiento reales.
  return fictional() ? squad.map(r => ({ ...r, display: fictionalPlayer(r.display), nation: null, dob: null, nationBasis: null })) : squad;
}
