// TP213 · Lógica pura de la pantalla VERSUS: filtros del catálogo, atajos y tipo de enfrentamiento.
import type { TeamSummary } from '../api';

export type EraId = 'all' | '1990s' | '2000s' | '2010s' | '2020s';
export const ERAS: readonly Readonly<{ id: EraId; from: number; to: number }>[] = [
  { id: 'all', from: 1992, to: 2025 },
  { id: '1990s', from: 1992, to: 1999 },
  { id: '2000s', from: 2000, to: 2009 },
  { id: '2010s', from: 2010, to: 2019 },
  { id: '2020s', from: 2020, to: 2025 },
];

/**
 * Atajos a equipos-temporada conocidos. Solo comodidad: el selector siempre ofrece el catálogo completo
 * (686 combinaciones) y un atajo que no exista en el catálogo cargado no se muestra.
 */
export const QUICK_PICKS: readonly string[] = [
  'arsenal:2003', 'mancity:2024', 'manunited:1998', 'chelsea:2004', 'mancity:2017',
  'leicester:2015', 'liverpool:2019', 'blackburn:1994', 'newcastle:1995', 'tottenham:2016',
];

export type TeamFilter = Readonly<{ query: string; era: EraId; club: string; season: string }>;
export const EMPTY_FILTER: TeamFilter = { query: '', era: 'all', club: '', season: '' };

export function filterTeams(teams: readonly TeamSummary[], f: TeamFilter): TeamSummary[] {
  const needle = f.query.trim().toLocaleLowerCase();
  const era = ERAS.find(e => e.id === f.era) ?? ERAS[0];
  return teams.filter(t => t.season_start >= era.from && t.season_start <= era.to
    && (!f.club || t.club === f.club)
    && (!f.season || String(t.season_start) === f.season)
    && (!needle || `${t.name} ${t.club} ${t.season_label}`.toLocaleLowerCase().includes(needle)))
    // Más recientes primero, luego por nombre: orden estable para la rejilla.
    .sort((a, b) => b.season_start - a.season_start || a.name.localeCompare(b.name));
}

export function clubsOf(teams: readonly TeamSummary[]): { club: string; name: string }[] {
  const map = new Map<string, string>();
  for (const t of teams) map.set(t.club, t.name);
  return [...map].map(([club, name]) => ({ club, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export type MatchupKind = 'same_club' | 'cross_era' | 'same_season';
const clubOf = (key: string) => key.split(':')[0];
const yearOf = (key: string) => Number(key.split(':')[1]);

/** Mismo club (otra temporada) = «clásico de su propia historia»; temporadas distintas = partido ficticio entre épocas. */
export function matchupKind(homeKey: string, awayKey: string): MatchupKind {
  if (clubOf(homeKey) === clubOf(awayKey)) return 'same_club';
  return yearOf(homeKey) === yearOf(awayKey) ? 'same_season' : 'cross_era';
}

export function clubKey(teamKey: string): string { return clubOf(teamKey); }
