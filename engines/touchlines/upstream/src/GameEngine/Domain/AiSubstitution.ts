/**
 * AiSubstitution — decides which substitutions an AI-controlled team should make.
 *
 * Called periodically during the second half. Returns a list of { outId, inId }
 * pairs to push into the pending sub queue; the engine processes them at the next
 * dead-ball moment.
 */

import type { GamePlayer, GameState, PendingSub, TeamId } from '@/GameEngine/types';
import { Player } from '@/Domain/Player';
import { teamLineup } from '@/GameEngine/Domain/TeamLineup';

/** Game-seconds between AI sub evaluations (~5 game-minutes). */
const AI_SUB_CHECK_INTERVAL = 300;

/** Energy threshold below which a player is considered a substitution candidate. */
const LOW_ENERGY_THRESHOLD = 40;

/** Energy threshold below which a player is considered critically tired. */
const CRITICAL_ENERGY_THRESHOLD = 25;

/**
 * Returns all sub recommendations for the given AI team based on energy levels.
 * May return an empty array (nobody tired), or multiple entries (batch subs).
 * Capped by remaining substitutions.
 */
export function evaluateAiSubstitutions(
  state: GameState,
  team: TeamId,
): PendingSub[] {
  // Only sub during second half
  if (state.matchPhase !== 'secondHalf') return [];

  const subsRemaining = team === 'A' ? state.subsRemainingA : state.subsRemainingB;
  if (subsRemaining <= 0) return [];

  const bench = team === 'A' ? state.benchA : state.benchB;
  if (bench.length === 0) return [];

  const onPitch = state.players.filter(p => p.team === team && p.role !== 'GK');
  const usedBenchIds = new Set<number>();
  const subs: PendingSub[] = [];

  // Sort candidates: most tired first (critical first, then low energy)
  const candidates = onPitch
    .filter(p => p.energy < LOW_ENERGY_THRESHOLD)
    .sort((a, b) => a.energy - b.energy);

  for (const tired of candidates) {
    if (subs.length >= subsRemaining) break;

    // Find best bench player for this slot's role
    const slotRole = tired.role;
    const availableBench = bench.filter(p => !usedBenchIds.has(p.id));
    if (availableBench.length === 0) break;

    const best = findBestBenchForRole(availableBench, slotRole);
    if (!best) continue;

    // Only sub if the bench player is meaningfully better energetically
    // or the on-pitch player is critically low
    const worthSub = tired.energy < CRITICAL_ENERGY_THRESHOLD
      || best.energy > tired.energy + 20;
    if (!worthSub) continue;

    subs.push({ outId: tired.id, inId: best.id });
    usedBenchIds.add(best.id);
  }

  return subs;
}

/**
 * Find the best available bench player for a given role.
 * Priority: exact role match → same main role → any player.
 * Among equals, picks the one with better weighted score for the role.
 */
function findBestBenchForRole(bench: GamePlayer[], role: string): GamePlayer | null {
  if (bench.length === 0) return null;

  const exactMatch = bench
    .filter(p => p.role === role)
    .sort((a, b) => scoreForRole(b, role) - scoreForRole(a, role));
  if (exactMatch[0]) return exactMatch[0];

  const mainRoleMatch = bench
    .filter(p => sameMainRole(p.role, role))
    .sort((a, b) => scoreForRole(b, role) - scoreForRole(a, role));
  if (mainRoleMatch[0]) return mainRoleMatch[0];

  // Fall back to any bench player, highest overall
  return bench.sort((a, b) => scoreForRole(b, role) - scoreForRole(a, role))[0] ?? null;
}

function scoreForRole(player: GamePlayer, role: string): number {
  // Use a composite of energy and base stats proxy (withBall.speed as a crude overall)
  const statScore = player.baseStats.withBall.speed
    + player.baseStats.withBall.passingSkill
    + player.baseStats.withoutBall.tackleChance;
  return statScore * (player.energy / 100);
}

const MAIN_ROLE_BANDS: Record<string, string> = {
  GK: 'GK',
  LB: 'DEF', CB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'FWD', RW: 'FWD', ST: 'FWD',
};

function sameMainRole(roleA: string, roleB: string): boolean {
  return (MAIN_ROLE_BANDS[roleA] ?? roleA) === (MAIN_ROLE_BANDS[roleB] ?? roleB);
}

/**
 * Returns true if a 300-game-second check boundary was crossed this tick.
 *
 * `dt` is the game-time advance for this tick (already scaled by TIME_SCALE
 * by the caller). Callers pass `realDt * TIME_SCALE`.
 *
 * Previously re-multiplied `dt` by TIME_SCALE internally, which looked back
 * ~65 game-seconds instead of ~3.6, causing the check to fire ~18 consecutive
 * ticks at every interval boundary. That bloated pendingSubsA/B because each
 * firing re-queued the same recommended subs.
 */
export function shouldCheckAiSubs(matchTime: number, dt: number): boolean {
  const prev = matchTime - dt;
  const cur  = matchTime;
  return Math.floor(prev / AI_SUB_CHECK_INTERVAL) !== Math.floor(cur / AI_SUB_CHECK_INTERVAL);
}
