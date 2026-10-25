/**
 * SetPiecePositioning — applies a set piece layout to players.
 *
 * Slots are defined in the Team A (attackDir=+1) reference frame.
 * When a player's attackDir is -1, the x coordinate is mirrored:
 *   engineX = PITCH_LENGTH - slot.x
 *
 * Role assignment for multi-instance roles (e.g. two CBs, two STs):
 * Players are matched to slots in formation-slot-index order (slotIndex ascending).
 * First slot of a role → player with lowest slotIndex; second slot → next, etc.
 */

import type { GamePlayer, PlayerRole, TeamId } from '@/GameEngine/types';
import type { SetPieceLayout } from '@/GameEngine/Domain/SetPieceLayouts';
import { PITCH_LENGTH, PITCH_MID_X } from '@/GameEngine/Domain/pitch';

const CENTRE_X = PITCH_MID_X;
const CENTRE_Y = 37; // PITCH_WIDTH / 2
/** Centre circle radius in yards (9.15 m ≈ 10 yds, +0.5 buffer). */
const CIRCLE_RADIUS = 10.5;

/**
 * Apply a set piece layout to players of one team.
 * Returns the full player array (all 22) with the team's positions updated.
 */
export function applySetPieceToTeam(
  players: GamePlayer[],
  teamId: TeamId,
  layout: SetPieceLayout,
): GamePlayer[] {
  const teamPlayers = players.filter(p => p.team === teamId);
  if (teamPlayers.length === 0 || layout.slots.length === 0) return players;

  // All players on the same team share the same attackDir
  const attackDir = teamPlayers[0]!.attackDir;

  // Group slots by role (preserving order within each role group)
  const roleSlots = new Map<PlayerRole, typeof layout.slots>();
  for (const slot of layout.slots) {
    const list = roleSlots.get(slot.role) ?? [];
    list.push(slot);
    roleSlots.set(slot.role, list);
  }

  // Sort team players by slotIndex so multi-instance assignment is deterministic
  const sorted = [...teamPlayers].sort((a, b) => a.slotIndex - b.slotIndex);

  // Build a map of player id → new position
  const roleIndex = new Map<PlayerRole, number>();
  const updates = new Map<number, { x: number; y: number }>();

  for (const player of sorted) {
    const slots = roleSlots.get(player.role);
    if (!slots) continue;

    const idx = roleIndex.get(player.role) ?? 0;
    roleIndex.set(player.role, idx + 1);
    if (idx >= slots.length) continue;

    const slot = slots[idx]!;
    const engineX = attackDir === 1 ? slot.x : PITCH_LENGTH - slot.x;
    updates.set(player.id, { x: engineX, y: slot.y });
  }

  // Apply updates — players teleport to set piece position (deterministic, no randomness)
  return players.map(p => {
    const pos = updates.get(p.id);
    if (!pos) return p;
    return { ...p, x: pos.x, y: pos.y, targetPosition: { x: pos.x, y: pos.y } };
  });
}

/**
 * Enforce the kickoff centre-circle rule for the team WITHOUT the ball.
 *
 * Any defending-team player inside the centre circle (radius CIRCLE_RADIUS)
 * is pushed outward along the same direction from centre until they sit on
 * the circle edge.  Players already outside are untouched.
 *
 * If a player is exactly at the centre point, they are pushed toward their
 * own half (determined by attackDir) to guarantee a legal position.
 */
export function enforceKickoffCircleRule(
  players: GamePlayer[],
  defendingTeam: TeamId,
): GamePlayer[] {
  return players.map(p => {
    if (p.team !== defendingTeam) return p;

    const dx   = p.x - CENTRE_X;
    const dy   = p.y - CENTRE_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= CIRCLE_RADIUS) return p; // already outside — no change

    // Push outward to the circle edge in the same direction from centre.
    // Fallback when exactly at centre: push toward own half.
    const normX = dist < 0.01 ? (p.attackDir === -1 ? 1 : -1) : dx / dist;
    const normY = dist < 0.01 ? 0                              : dy / dist;
    const newX  = CENTRE_X + normX * CIRCLE_RADIUS;
    const newY  = CENTRE_Y + normY * CIRCLE_RADIUS;

    return { ...p, x: newX, y: newY, targetPosition: { x: newX, y: newY } };
  });
}
