// Habilidades de Capitán Hane (TP234): SOLO VISUALES. Cambian cómo se dramatiza una escena, nunca el resultado,
// que es siempre el que grabó el motor (este módulo no recibe ni devuelve eventos ni marcadores). Se derivan de
// datos reales del jugador con su procedencia: estadística de temporada del catálogo (histórica o estimada) o lo
// que el motor grabó en ESTE partido (simulado). Sin datos, sin habilidad. La nacionalidad solo tematiza el nombre
// del movimiento (moves.ts); aquí no se usa, y nunca nada de etnia ni de aspecto.
// Umbrales fijos (documentados en docs/kb/anime-cut-ins.md), así que el resultado es determinista por jugador y
// partido. Cada jugador tiene cero o una: la de mayor fuerza (valor / umbral); a igualdad, el orden de ABILITIES.
import type { MoveRole } from './moves';

export type AbilityId = 'ultimate-shot' | 'wall' | 'shield' | 'sky-pass' | 'phantom-sprint';
export const ABILITIES: readonly AbilityId[] = ['ultimate-shot', 'wall', 'shield', 'sky-pass', 'phantom-sprint'];
export type AbilityProvenance = 'historical' | 'estimated' | 'simulated';
/** Estadística de origen, para el texto «Fuente: <stat> = <valor> (<procedencia>)». */
export type AbilityStat = 'season_goals' | 'season_assists' | 'season_assists_fpl' | 'season_saves' | 'season_recoveries_per90'
  | 'match_saves' | 'match_tackles_won' | 'match_hsr_m';
export type Ability = Readonly<{ id: AbilityId; stat: AbilityStat; value: number; provenance: AbilityProvenance; strength: number }>;

/** Valor de temporada con su estado en el catálogo (`measured`, `estimated`, `partial`, `unavailable`). */
export type SeasonValue = Readonly<{ value: number | null; status: string }>;
export type AbilityInput = Readonly<{
  role: MoveRole | null;
  season?: Readonly<{
    goals?: SeasonValue; assists?: SeasonValue; assistsFpl?: SeasonValue; saves?: SeasonValue; recoveriesPer90?: SeasonValue;
    /** Máximo de goles de temporada entre los jugadores de su equipo-temporada en el catálogo. */
    teamTopGoals?: number | null;
  }> | null;
  /** Lo que el motor grabó en este partido (partido completo, no hasta el cursor). */
  match?: Readonly<{ saves?: number | null; tacklesWon?: number | null; hsrM?: number | null; matchTopHsrM?: number | null }> | null;
}>;

/**
 * Umbrales sacados del propio catálogo (686 equipos-temporada, 1992/93–2025/26; cálculo del 24-oct, ver la doc):
 * mediana del máximo goleador por equipo = 12; p95 de asistencias (≥ 900 min) = 11; p75 de paradas de portero
 * (≥ 1800 min, temporadas FPL) = 114; p75 de recuperaciones por 90 de defensas (≥ 1800 min) = 5,4.
 */
export const THRESHOLDS = {
  /** Máximo goleador de su equipo en la temporada con al menos 12 goles de liga. */
  ultimateShotGoals: 12,
  /** Al menos 11 asistencias de liga en la temporada (definición de la fuente; las de FPL se rotulan aparte). */
  skyPassAssists: 11,
  /** Portero: 114 paradas de temporada o, solo si la temporada no tiene ese dato, 4 paradas grabadas en este partido. */
  wallSeasonSaves: 114, wallMatchSaves: 4,
  /** Defensa: 5,4 recuperaciones por 90 en la temporada o, solo sin ese dato, 4 entradas ganadas grabadas en este partido. */
  shieldRecoveriesPer90: 5.4, shieldMatchTackles: 4,
  /** El que más metros a alta velocidad recorre en este partido (según el motor), con al menos 400 m. */
  phantomSprintHsrM: 400,
} as const;

const usable = (v: SeasonValue | undefined): v is Readonly<{ value: number; status: string }> =>
  !!v && typeof v.value === 'number' && Number.isFinite(v.value) && (v.status === 'measured' || v.status === 'estimated' || v.status === 'partial');
const seasonProvenance = (v: SeasonValue): AbilityProvenance => v.status === 'estimated' ? 'estimated' : 'historical';
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Todas las candidatas que cumplen su umbral (para pruebas y para documentar). */
export function abilityCandidates(input: AbilityInput): Ability[] {
  const out: Ability[] = [], s = input.season ?? {}, m = input.match ?? {};
  const add = (id: AbilityId, stat: AbilityStat, value: number, provenance: AbilityProvenance, threshold: number) =>
    out.push({ id, stat, value, provenance, strength: value / threshold });
  if (usable(s.goals) && finite(s.teamTopGoals) && s.goals.value >= THRESHOLDS.ultimateShotGoals && s.goals.value >= s.teamTopGoals)
    add('ultimate-shot', 'season_goals', s.goals.value, seasonProvenance(s.goals), THRESHOLDS.ultimateShotGoals);
  if (input.role === 'K') {
    if (usable(s.saves) && s.saves.value >= THRESHOLDS.wallSeasonSaves) add('wall', 'season_saves', s.saves.value, seasonProvenance(s.saves), THRESHOLDS.wallSeasonSaves);
    else if (!usable(s.saves) && finite(m.saves) && m.saves >= THRESHOLDS.wallMatchSaves) add('wall', 'match_saves', m.saves, 'simulated', THRESHOLDS.wallMatchSaves);
  }
  if (input.role === 'D') {
    if (usable(s.recoveriesPer90) && s.recoveriesPer90.value >= THRESHOLDS.shieldRecoveriesPer90)
      add('shield', 'season_recoveries_per90', s.recoveriesPer90.value, seasonProvenance(s.recoveriesPer90), THRESHOLDS.shieldRecoveriesPer90);
    else if (!usable(s.recoveriesPer90) && finite(m.tacklesWon) && m.tacklesWon >= THRESHOLDS.shieldMatchTackles)
      add('shield', 'match_tackles_won', m.tacklesWon, 'simulated', THRESHOLDS.shieldMatchTackles);
  }
  if (usable(s.assists) && s.assists.value >= THRESHOLDS.skyPassAssists) add('sky-pass', 'season_assists', s.assists.value, seasonProvenance(s.assists), THRESHOLDS.skyPassAssists);
  else if (usable(s.assistsFpl) && s.assistsFpl.value >= THRESHOLDS.skyPassAssists) add('sky-pass', 'season_assists_fpl', s.assistsFpl.value, seasonProvenance(s.assistsFpl), THRESHOLDS.skyPassAssists);
  if (finite(m.hsrM) && finite(m.matchTopHsrM) && m.hsrM >= THRESHOLDS.phantomSprintHsrM && m.hsrM >= m.matchTopHsrM)
    add('phantom-sprint', 'match_hsr_m', m.hsrM, 'simulated', THRESHOLDS.phantomSprintHsrM);
  return out;
}
/** Cero o una: la más fuerte; a igualdad, el orden de `ABILITIES`. */
export function abilityFor(input: AbilityInput): Ability | null {
  let best: Ability | null = null;
  for (const a of abilityCandidates(input))
    if (!best || a.strength > best.strength || a.strength === best.strength && ABILITIES.indexOf(a.id) < ABILITIES.indexOf(best.id)) best = a;
  return best;
}

const STAT_TEXT = {
  en: { season_goals: 'season league goals', season_assists: 'season league assists', season_assists_fpl: 'season assists (FPL definition)',
    season_saves: 'season saves', season_recoveries_per90: 'season recoveries per 90', match_saves: 'saves in this match',
    match_tackles_won: 'tackles won in this match', match_hsr_m: 'high-speed distance in this match (m)' },
  es: { season_goals: 'goles de liga en la temporada', season_assists: 'asistencias de liga en la temporada',
    season_assists_fpl: 'asistencias de la temporada (definición FPL)', season_saves: 'paradas en la temporada',
    season_recoveries_per90: 'recuperaciones por 90 en la temporada', match_saves: 'paradas en este partido',
    match_tackles_won: 'entradas ganadas en este partido', match_hsr_m: 'metros a alta velocidad en este partido' },
} as const;
const PROVENANCE_TEXT = { en: { historical: 'historical', estimated: 'estimated', simulated: 'simulated' },
  es: { historical: 'histórico', estimated: 'estimado', simulated: 'simulado' } } as const;
export const ABILITY_NAMES = {
  en: { 'ultimate-shot': 'Ultimate Shot', 'sky-pass': 'Sky Pass', wall: 'The Wall', shield: 'Shield', 'phantom-sprint': 'Phantom Sprint' },
  es: { 'ultimate-shot': 'Tiro definitivo', 'sky-pass': 'Pase del cielo', wall: 'Muro', shield: 'Escudo', 'phantom-sprint': 'Sprint fantasma' },
} as const;

const formatValue = (a: Ability, locale: 'en' | 'es') => {
  const digits = Number.isInteger(a.value) ? 0 : a.stat === 'match_hsr_m' ? 0 : 1;
  return a.value.toLocaleString(locale === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
};
/** «Source: season league goals = 30 (historical)» / «Fuente: goles de liga en la temporada = 30 (histórico)». */
export function abilitySourceText(a: Ability, locale: 'en' | 'es'): string {
  return `${locale === 'es' ? 'Fuente' : 'Source'}: ${STAT_TEXT[locale][a.stat]} = ${formatValue(a, locale)} (${PROVENANCE_TEXT[locale][a.provenance]})`;
}
