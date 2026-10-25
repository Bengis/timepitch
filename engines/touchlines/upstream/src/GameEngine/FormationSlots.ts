/**
 * FormationSlots — resolves absolute player positions from formation slot definitions.
 *
 * Each formation JSON defines attacking and defending slot arrays. Each slot names a role
 * and provides absolute x/y position (Team A reference frame).
 *
 * resolveBasePosition() is called every tick by Positioning.ts to get the phase-appropriate
 * anchor for a player.
 */

import type { Formation, FormationSlotDef, Phase } from '@/GameEngine/types';
import { PITCH_LENGTH } from '@/GameEngine/Domain/pitch';

/**
 * Compute the absolute field position for a player's formation slot in the given phase.
 *
 * Uses `attackDir` (not `team`) so the result is correct both at match start and after
 * half-time side switching (when Team A's attackDir becomes -1).
 *
 * @param slotIndex  The player's stable slot index (0–10).
 * @param attackDir  +1 = attacks toward x=115 (left-to-right); -1 = right-to-left.
 * @param formation  The formation containing attacking and defending slot arrays.
 * @param phase      Which shape to use.
 */
export function resolveBasePosition(
  slotIndex: number,
  attackDir: 1 | -1,
  formation: Formation,
  phase: Phase,
): { x: number; y: number } {
  const slots: FormationSlotDef[] = phase === 'attacking' ? formation.attacking : formation.defending;
  const slot = slots[slotIndex];
  if (!slot) return { x: 57, y: 37 };
  return attackDir === -1
    ? { x: PITCH_LENGTH - slot.x, y: slot.y }
    : { x: slot.x, y: slot.y };
}
