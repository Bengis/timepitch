// Datos de Capitán Hane por jugador (TP234): identidad del nombre de movimiento y habilidad visual. Solo se calcula
// con el modo activo. Temporada: fila del catálogo enlazada por la clave de fuente exacta del jugador (nunca por
// nombre). Partido: el análisis del partido COMPLETO grabado por el motor (determinista por partido), no el cursor.
import { useEffect, useMemo, useState } from 'react';
import { getTeam, type PlayerSeason, type TeamSeason } from '../../api';
import type { EventView, PlayerView } from '../../match-centre/session';
import { analyseUntil, type RecordedAnalysisModel } from '../../match-centre/analysis/recorded-analysis';
import type { MatchCast } from '../../presentation/types';
import { abilityFor, type Ability, type AbilityInput, type SeasonValue } from './abilities';
import { isWinningTackle } from './cutins';
import { roleFor, type MoveIdentity } from './moves';

const sourceKeyOf = (p: PlayerView) => typeof p.details?.sourceKey === 'string' ? p.details.sourceKey : null;
const teamKeyOf = (p: PlayerView) => typeof p.details?.teamKey === 'string' ? p.details.teamKey : null;
const value = (stat: { value: number | null; status: string } | undefined): SeasonValue | undefined => stat ? { value: stat.value, status: stat.status } : undefined;

/** Identidad para el nombre del movimiento: QID revisado si hay ficha; nacionalidad y posición de la ficha. */
export function moveIdentity(id: string, player: PlayerView | undefined, cast: MatchCast | null | undefined): MoveIdentity {
  const record = cast?.players.get(id)?.record ?? null;
  return { seedKey: record?.qid ?? id, nation: record?.nation ?? null, position: record?.position ?? player?.role.value ?? null };
}

export type MatchFacts = Readonly<{ saves: ReadonlyMap<string, number>; tackles: ReadonlyMap<string, number>; hsr: ReadonlyMap<string, number>; topHsr: number | null }>;
/** Hechos del partido completo grabado: paradas y entradas ganadas por jugador (eventos) y metros a alta velocidad. */
export function matchFacts(events: readonly EventView[], hsrByPlayer: ReadonlyMap<string, number>): MatchFacts {
  const saves = new Map<string, number>(), tackles = new Map<string, number>();
  for (const e of events) {
    if (!e.actorId) continue;
    if (e.kind === 'save' || e.kind === 'Goal Keeper' && /save/i.test(String((e.details.goalkeeper as { type?: { name?: string } } | undefined)?.type?.name ?? '')))
      saves.set(e.actorId, (saves.get(e.actorId) ?? 0) + 1);
    if (isWinningTackle(e)) tackles.set(e.actorId, (tackles.get(e.actorId) ?? 0) + 1);
  }
  const top = hsrByPlayer.size ? Math.max(...hsrByPlayer.values()) : null;
  return { saves, tackles, hsr: hsrByPlayer, topHsr: top };
}

/** Entrada de `abilityFor` para un jugador. Pura. */
export function abilityInputFor(player: PlayerView, identity: MoveIdentity, season: PlayerSeason | null, teamTopGoals: number | null, facts: MatchFacts | null): AbilityInput {
  const adv = season?.advanced_stats ?? {};
  return {
    role: roleFor(identity.position) ?? roleFor(season?.role) ?? roleFor(player.role.value),
    season: season ? { goals: value(season.stats.goals), assists: value(season.stats.assists), assistsFpl: value(season.stats.assists_fpl),
      saves: value(season.stats.saves), recoveriesPer90: value(adv.recoveries_per90), teamTopGoals } : null,
    match: facts ? { saves: facts.saves.get(player.id) ?? 0, tacklesWon: facts.tackles.get(player.id) ?? 0, hsrM: facts.hsr.get(player.id) ?? null, matchTopHsrM: facts.topHsr } : null,
  };
}
/** Máximo de goles de temporada (medidos o estimados) entre los jugadores del equipo-temporada. */
export function teamTopGoals(team: TeamSeason): number | null {
  const goals = team.players.map(p => p.stats.goals).filter(s => s && typeof s.value === 'number' && (s.status === 'measured' || s.status === 'estimated')).map(s => s!.value!);
  return goals.length ? Math.max(...goals) : null;
}

export type AnimePlayerData = Readonly<{ identity: MoveIdentity; ability: Ability | null }>;

export function useAnimeAbilities({ active, players, cast, analysis }: {
  active: boolean; players: readonly PlayerView[]; cast: MatchCast | null | undefined; analysis?: RecordedAnalysisModel | null;
}): ReadonlyMap<string, AnimePlayerData> {
  const teamKeys = useMemo(() => [...new Set(players.map(teamKeyOf).filter((k): k is string => !!k))].sort().join('\u0000'), [players]);
  const [teams, setTeams] = useState<ReadonlyMap<string, TeamSeason>>(new Map());
  useEffect(() => {
    if (!active || !teamKeys) return;
    const controller = new AbortController();
    void Promise.all(teamKeys.split('\u0000').map(key => getTeam(key, controller.signal).then(t => [key, t] as const, () => null)))
      .then(rows => { if (!controller.signal.aborted) setTeams(new Map(rows.filter((r): r is readonly [string, TeamSeason] => !!r && r[1].key === r[0]))); });
    return () => controller.abort();
  }, [active, teamKeys]);
  const facts = useMemo(() => {
    if (!active || !analysis) return null;
    const full = analyseUntil(analysis, analysis.track.durationMs);
    return matchFacts(analysis.events, new Map(full.players.map(p => [p.id, p.hsrM])));
  }, [active, analysis]);
  return useMemo(() => {
    const out = new Map<string, AnimePlayerData>();
    if (!active) return out;
    for (const p of players) {
      const identity = moveIdentity(p.id, p, cast), teamKey = teamKeyOf(p), sourceKey = sourceKeyOf(p);
      const team = teamKey ? teams.get(teamKey) : undefined, season = team && sourceKey ? team.players.find(s => s.key === sourceKey) ?? null : null;
      out.set(p.id, { identity, ability: abilityFor(abilityInputFor(p, identity, season, team ? teamTopGoals(team) : null, facts)) });
    }
    return out;
  }, [active, players, cast, teams, facts]);
}
