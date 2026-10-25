/**
 * AttackingPositioning — target-position computation for players when their team
 * has the ball.
 *
 * Influences applied (in order):
 *   1. Formation slot for the attacking phase (role anchor)
 *   2. Ball influence — nearby players drift toward the ball's Y/X
 *   3. Spacing — push away from close teammates to avoid crowding
 *   4. Positional freedom — blend anchor with dynamic target
 *   5. Offside awareness — try (imperfectly) to stay behind the offside line
 *
 * No side effects. No gameState imports (avoids circular deps).
 */

import type { GamePlayer, Formation } from '@/GameEngine/types';
import { resolveBasePosition } from '@/GameEngine/FormationSlots';
import { ATTACK_CONFIG, POSSESSION_PUSH_UP, PUSH_UP_ROLE_BIAS } from '@/GameEngine/Configs/AttackConfig';
import { PITCH_LENGTH } from '@/GameEngine/Domain/pitch';

export function computeAttackingPosition(
  player: GamePlayer,
  ballPos: { x: number; y: number },
  allPlayers: GamePlayer[],
  formation: Formation,
  offsideLine: number | null,
  possessionTime: number = 0,
): { x: number; y: number } {
  const { ballSupportScale, bounds } = player;

  const base    = resolveBasePosition(player.slotIndex, player.attackDir, formation, 'attacking');
  const anchorX = base.x;
  const anchorY = base.y;

  let rawX = anchorX;
  let rawY = anchorY;

  // ── Ball influence — pull toward ball support position ───────────────────
  const distToBall = Math.sqrt(
    (ballPos.x - player.x) ** 2 + (ballPos.y - player.y) ** 2,
  );
  const influenceRange  = ATTACK_CONFIG.SUPPORT_DISTANCE * 2;
  const proximityFactor = Math.max(0, 1 - distToBall / influenceRange);
  const influenceWeight = ballSupportScale * ATTACK_CONFIG.BALL_INFLUENCE_WEIGHT * proximityFactor;

  rawY += (ballPos.y - anchorY) * influenceWeight;
  rawX += (ballPos.x - anchorX) * influenceWeight * 0.25;

  // ── Spacing — push away from close teammates ─────────────────────────────
  const teammates = allPlayers.filter(p => p.team === player.team && p.id !== player.id);
  let pushX = 0;
  let pushY = 0;
  for (const tm of teammates) {
    const dx   = player.x - tm.x;
    const dy   = player.y - tm.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.1 || dist >= ATTACK_CONFIG.SUPPORT_DISTANCE) continue;
    const strength = (ATTACK_CONFIG.SUPPORT_DISTANCE - dist) / ATTACK_CONFIG.SUPPORT_DISTANCE;
    pushX += (dx / dist) * strength;
    pushY += (dy / dist) * strength;
  }
  rawX += pushX * ATTACK_CONFIG.SPACING_WEIGHT;
  rawY += pushY * ATTACK_CONFIG.SPACING_WEIGHT;

  // ── Positional freedom — blend anchor with dynamic target ────────────────
  rawX = anchorX + (rawX - anchorX) * ATTACK_CONFIG.POSITIONAL_FREEDOM;
  rawY = anchorY + (rawY - anchorY) * ATTACK_CONFIG.POSITIONAL_FREEDOM;

  // ── Possession push-up — sustained possession drives the defensive line up ─
  // Linear ramp: 50% effect at 5 s, full effect at 10 s.
  // Defenders push furthest; forwards are already in their attacking zone.
  const pushUpT    = Math.min(1, possessionTime / POSSESSION_PUSH_UP.BASE_SECONDS);
  const pushUpBias = PUSH_UP_ROLE_BIAS[player.role] ?? 0;
  if (pushUpBias > 0 && pushUpT > 0) {
    rawX += player.attackDir * pushUpT * POSSESSION_PUSH_UP.MAX_YARDS * pushUpBias;
  }

  // ── Offside awareness — try to stay behind the offside line ─────────────
  if (offsideLine !== null) {
    const fwd     = player.attackDir;
    const safeX   = offsideLine - fwd * ATTACK_CONFIG.OFFSIDE_MARGIN;
    const overrun = (rawX - safeX) * fwd;

    if (overrun > 0) {
      rawX -= overrun * ATTACK_CONFIG.OFFSIDE_AWARENESS * fwd;
    }
  }

  return {
    x: Math.max(0, Math.min(PITCH_LENGTH, rawX)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, rawY)),
  };
}
