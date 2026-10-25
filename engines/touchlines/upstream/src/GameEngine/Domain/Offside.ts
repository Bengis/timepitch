/**
 * Offside — centralised offside-line computation.
 *
 * Single source of truth for the offside boundary. The returned X already
 * encodes every condition of the offside rule:
 *   - Must be in the opponent's half (pitch midline)
 *   - Must be ahead of the ball
 *   - Must be ahead of the second-last defender (GK counts)
 *
 * Callers only need: "is the player ahead of this X?"
 */

import type { GamePlayer, TeamId } from '@/GameEngine/types';
import { PITCH_MID_X } from '@/GameEngine/Domain/pitch';

/**
 * Returns the effective offside boundary X for the given attacking team.
 *
 * For attackDir +1 → max(pitchMid, ballX, secondLastDefender.x)
 * For attackDir -1 → min(pitchMid, ballX, secondLastDefender.x)
 *
 * A player whose x is ahead of this value (in the attack direction) is offside.
 * Returns `null` when there are fewer than 2 opposing players.
 */
export function computeOffsideLine(
  attackDir: 1 | -1,
  allPlayers: GamePlayer[],
  attackingTeam: TeamId,
  ballX: number,
): number | null {
  const defenders = allPlayers.filter(p => p.team !== attackingTeam);
  if (defenders.length < 2) return null;

  const sorted = defenders.slice().sort((a, b) => a.x * attackDir - b.x * attackDir);
  const secondLastX = sorted[sorted.length - 2]!.x;

  return attackDir === 1
    ? Math.max(PITCH_MID_X, ballX, secondLastX)
    : Math.min(PITCH_MID_X, ballX, secondLastX);
}
