// TP213 · Estrella de cada equipo-temporada, con una regla determinista y documentada (docs/kb, case TP213).
//
// Regla: entre los jugadores con goles registrados, mayor «goles + asistencias» de la temporada en la fuente del
// catálogo (epldata: `assists`; FPL: `assists_fpl`, definición Fantasy; nunca se mezclan). Desempates: más goles,
// más minutos, clave de fuente ascendente. Si nadie suma > 0 (p. ej. solo porteros), el de más minutos.
// Una asistencia ausente cuenta como 0 para ordenar, pero se muestra «—»: nada se rellena en pantalla.
import type { PlayerSeason, Statistic, TeamSeason } from '../api';

export type StarRule = 'goals_assists' | 'minutes_fallback';
export type AssistsKey = 'assists' | 'assists_fpl';
export type Star = Readonly<{ player: PlayerSeason; rule: StarRule; score: number; assistsKey: AssistsKey }>;

const num = (stat: Statistic | undefined) => (stat?.value == null ? null : stat.value);

export function pickStar(team: Pick<TeamSeason, 'source' | 'players'>): Star | null {
  if (!team.players.length) return null;
  const assistsKey: AssistsKey = team.source === 'fpl' ? 'assists_fpl' : 'assists';
  const minutes = (p: PlayerSeason) => num(p.stats.minutes) ?? 0;
  const byKey = (a: PlayerSeason, b: PlayerSeason) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const scored = team.players
    .filter(p => num(p.stats.goals) != null)
    .map(p => ({ p, goals: num(p.stats.goals)!, score: num(p.stats.goals)! + (num(p.stats[assistsKey]) ?? 0) }))
    .sort((a, b) => b.score - a.score || b.goals - a.goals || minutes(b.p) - minutes(a.p) || byKey(a.p, b.p));
  if (scored.length && scored[0].score > 0) return { player: scored[0].p, rule: 'goals_assists', score: scored[0].score, assistsKey };
  const [first] = [...team.players].sort((a, b) => minutes(b) - minutes(a) || byKey(a, b));
  return { player: first, rule: 'minutes_fallback', score: minutes(first), assistsKey };
}

export type StarStat = Readonly<{ id: 'goals' | 'assists' | 'appearances' | 'minutes'; stat: Statistic | undefined }>;

/** Las cuatro cifras de temporada que muestra la tarjeta, con su estado de la fuente (medido/estimado/no disponible). */
export function starStats(player: PlayerSeason, assistsKey: AssistsKey): StarStat[] {
  return [
    { id: 'goals', stat: player.stats.goals },
    { id: 'assists', stat: player.stats[assistsKey] },
    { id: 'appearances', stat: player.stats.appearances },
    { id: 'minutes', stat: player.stats.minutes },
  ];
}
