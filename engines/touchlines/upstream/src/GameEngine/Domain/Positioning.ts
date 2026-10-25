/**
 * Positioning — public API that delegates to the phase-specific modules.
 *
 * Attacking logic → AttackingPositioning.ts
 * Defensive logic → DefensivePositioning.ts
 *
 * gameState.ts imports only this file; the phase modules remain independent
 * so each can grow without touching the other.
 */

import type { GamePlayer, Formation, Phase } from '@/GameEngine/types';
import { computeAttackingPosition } from '@/GameEngine/Domain/AttackingPositioning';
import { computeDefensivePosition } from '@/GameEngine/Domain/DefensivePositioning';

/**
 * Returns the target position for `player` this tick.
 *
 * @param player          The player to position.
 * @param phase           'attacking' | 'defending' — which team has the ball.
 * @param ballPos         Current ball position in yards.
 * @param allPlayers      All players — used by attacking spacing and lane gravity.
 * @param formation       The player's team formation — provides slot anchor positions.
 * @param ballHolderId    Id of the current ball holder — used for lane gravity.
 * @param playerDecision  Current decision type for this player — pressing defenders skip lane gravity.
 * @param offsideLine     Pre-computed offside line X for this player's team (null = not enough defenders).
 * @param markTargetId    Pre-assigned opponent id for marking (defending only, from 1:1 assignment).
 */
export function computeTargetPosition(
  player: GamePlayer,
  phase: Phase,
  ballPos: { x: number; y: number },
  allPlayers: GamePlayer[],
  formation: Formation,
  ballHolderId?: number,
  playerDecision?: string,
  offsideLine?: number | null,
  markTargetId?: number,
  possessionTime?: number,
): { x: number; y: number } {
  return phase === 'defending'
    ? computeDefensivePosition(player, ballPos, allPlayers, formation, ballHolderId ?? -1, playerDecision, markTargetId)
    : computeAttackingPosition(player, ballPos, allPlayers, formation, offsideLine ?? null, possessionTime ?? 0);
}
