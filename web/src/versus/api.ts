// TP213 · Lecturas de solo lectura para la pantalla VERSUS (balance de temporada y cara a cara).
import { ApiError, type TeamSummary } from '../api';
import type { components } from '../generated/api';

export type TeamSeasonRecord = components['schemas']['TeamSeasonRecord'];
export type HeadToHead = components['schemas']['HeadToHead'];
export type MatchResult = components['schemas']['MatchResult'];
export type PointsDeduction = components['schemas']['PointsDeduction'];

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const numbers = (v: Record<string, unknown>, keys: readonly string[]) => keys.every(k => typeof v[k] === 'number');

/** Respuesta con la forma esperada o error: una respuesta ajena nunca llega a pintarse como dato histórico. */
export function checkTeamRecord(v: unknown, key: string): TeamSeasonRecord {
  if (!isObject(v) || v.key !== key || !Array.isArray(v.results_sources)
    || !numbers(v, ['played', 'wins', 'draws', 'losses', 'goals_for', 'goals_against', 'goal_difference', 'points', 'raw_points', 'position', 'teams'])
    // TP214: sanción nula o con puntos y fuente; nunca una sanción sin procedencia.
    || !(v.deduction === null || (isObject(v.deduction) && typeof v.deduction.points === 'number' && isObject(v.deduction.source)
      && typeof v.deduction.source.title === 'string' && typeof v.deduction.source.url === 'string'))) {
    throw new Error('Unexpected season record');
  }
  return v as unknown as TeamSeasonRecord;
}

export function checkHeadToHead(v: unknown, home: string, away: string): HeadToHead {
  if (!isObject(v) || v.club_a !== home || v.club_b !== away || !Array.isArray(v.results_sources)
    || !numbers(v, ['played', 'wins_a', 'draws', 'wins_b', 'goals_a', 'goals_b'])) throw new Error('Unexpected head-to-head');
  return v as unknown as HeadToHead;
}

export const getTeamRecord = async (key: string, signal?: AbortSignal) =>
  checkTeamRecord(await read<unknown>(`/api/catalog/teams/${encodeURIComponent(key)}/record`, signal), key);

export const getHeadToHead = async (home: string, away: string, signal?: AbortSignal) =>
  checkHeadToHead(await read<unknown>(`/api/catalog/head-to-head?${new URLSearchParams({ home, away })}`, signal), home, away);

export type { TeamSummary };
