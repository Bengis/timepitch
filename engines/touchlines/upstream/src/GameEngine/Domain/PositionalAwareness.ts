/**
 * PositionalAwareness — spatial relationship utilities.
 *
 * Pure math functions that compute relative positions between players, the ball,
 * and pass lines. No state, no side effects.
 *
 * These helpers are the foundation for:
 *   • Tackle success modifiers (front / side / behind)
 *   • Interception eligibility (defender between ball and receiver)
 *   • Carry vs pass pressure detection
 *   • Marking behaviour (future)
 *   • Defensive positioning (future)
 *
 * Used by: ActionOutcomes.ts, gameState.ts
 */

import { PITCH_LENGTH, GOAL_Y_MIN, GOAL_Y_MAX } from '@/GameEngine/Domain/pitch';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RelativePosition = 'front' | 'side' | 'behind';

// Minimal positional interfaces — avoids coupling to full GamePlayer type.
interface Pos   { x: number; y: number }
interface Actor { x: number; y: number; attackDir: 1 | -1 }

// ── Interception corridor ─────────────────────────────────────────────────────

/**
 * Maximum perpendicular distance (yards) from the pass line within which a
 * defender is considered close enough to intercept.
 *
 * Intentionally kept wide (4 yds) because the interceptionChance stat already
 * gates the probability. The spatial check is about validity, not difficulty.
 */
/** @deprecated Pass a per-player corridor computed by playerInterceptionCorridor() instead. */
// Kept only as a sentinel — do not use directly for game logic.
// The effective corridor is now dynamic per player (see ActionOutcomes.ts).

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Dot product of the direction A→B with A's attack axis (±x direction).
 *
 * Returns a value in −1..1:
 *   > 0   — B is in front of A (in the direction A is attacking)
 *   < 0   — B is behind A
 *
 * Used as the basis for all positional classifications.
 */
export function forwardDot(from: Actor, to: Pos): number {
  const dx   = to.x - from.x;
  const dy   = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return 0;
  // attackDir is the ±x unit component of the attack direction vector (0, ±1 on y ignored)
  return (dx / dist) * from.attackDir;
}

/**
 * Classify B's position relative to A's movement direction.
 *
 * Thresholds per positional-awareness.md:
 *   dot > 0.5       → front   (< 60° from attack direction)
 *   −0.5 ≤ dot ≤ 0.5 → side
 *   dot < −0.5      → behind  (> 120° from attack direction)
 */
export function classifyPosition(from: Actor, to: Pos): RelativePosition {
  const dot = forwardDot(from, to);
  if (dot >  0.5) return 'front';
  if (dot < -0.5) return 'behind';
  return 'side';
}

// ── Tackle angle modifier ─────────────────────────────────────────────────────

/**
 * Delta to add to a base tackle chance based on the tackler's approach angle
 * relative to the holder's direction of progress.
 *
 * "Forward" for the holder is the direction toward the **opponent's goal**, not
 * the team-wide attackDir constant. This matters when the holder is near a
 * corner or on the goal line — the goal can be to the side (or even behind in
 * pure x-axis terms), but it's still where they want to progress. A tackler
 * approaching from "behind in x" can actually be on the side of the holder's
 * real progression line.
 *
 * A defender positioned in **front** of the attacker has a positional advantage
 * (facing them, in their path) → success bonus.
 * A defender coming from **behind** is a desperate lunge → success penalty.
 *
 * Modifiers:
 *   front  → +0.30
 *   side   → +0.10
 *   behind → −0.30
 */
export function tackleAngleModifier(
  tackler: Pos,
  holder:  Actor,
): number {
  const goalX = holder.attackDir === 1 ? PITCH_LENGTH : 0;
  const goalY = (GOAL_Y_MIN + GOAL_Y_MAX) / 2;

  // Forward = unit vector from holder toward opponent goal centre.
  const fx = goalX - holder.x;
  const fy = goalY - holder.y;
  const fLen = Math.hypot(fx, fy);
  // Holder is on top of the goal (pathological case) — fall back to attackDir axis.
  const forwardX = fLen > 1e-3 ? fx / fLen : holder.attackDir;
  const forwardY = fLen > 1e-3 ? fy / fLen : 0;

  // Tackler vector from holder.
  const tx = tackler.x - holder.x;
  const ty = tackler.y - holder.y;
  const tLen = Math.hypot(tx, ty);
  if (tLen < 0.01) return +0.30; // tackler on top of holder — count as front

  const dot = (tx / tLen) * forwardX + (ty / tLen) * forwardY;

  if (dot >  0.5) return +0.30;  // front
  if (dot < -0.5) return -0.30;  // behind
  return +0.10;                   // side
}

// ── Interception validity ─────────────────────────────────────────────────────

/**
 * Return true when a defender is in a geometrically valid position to intercept
 * a pass in flight.
 *
 * Conditions (all must hold):
 *   1. Projection `t` onto the pass segment is between 0.05 and 0.95 — defender
 *      is ahead of the ball and has not overrun the receiver.
 *   2. Perpendicular distance from defender to the pass line is ≤ INTERCEPTION_CORRIDOR.
 *
 * This prevents unrealistic interceptions where a defender behind the receiver,
 * or wide of the line, steals the ball.
 *
 * @param defender  The player attempting the interception.
 * @param ballPos   Current ball position on the pass line (0 = passer, 1 = receiver).
 * @param receiver  The intended pass target.
 */
/**
 * Returns the perpendicular distance (yards) from the defender to the pass line
 * if the interception geometry is valid, or `null` if out of position.
 *
 * @param corridor  Player's effective interception corridor (yards) — computed by
 *                  `playerInterceptionCorridor()` in ActionOutcomes.ts.
 */
export function getInterceptionPerpDist(
  defender: Pos,
  ballPos:  Pos,
  receiver: Pos,
  corridor: number,
): number | null {
  const vx    = receiver.x - ballPos.x;
  const vy    = receiver.y - ballPos.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 0.01) return null;

  const ox = defender.x - ballPos.x;
  const oy = defender.y - ballPos.y;
  const t  = (ox * vx + oy * vy) / lenSq;

  if (t < 0.05 || t > 0.95) return null;

  const nearX    = ballPos.x + t * vx;
  const nearY    = ballPos.y + t * vy;
  const perpDist = Math.sqrt((defender.x - nearX) ** 2 + (defender.y - nearY) ** 2);

  return perpDist <= corridor ? perpDist : null;
}

// ── Pressure detection ────────────────────────────────────────────────────────

/**
 * Compute the intensity of forward pressure on a player (0 = none, 1 = very high).
 *
 * Only counts opponents that are ahead of the player (forwardDot > 0) and within
 * the given radius. Used by the decision tree to choose carry vs pass.
 *
 * @param player    The player under evaluation.
 * @param opponents All opponents.
 * @param radius    Awareness radius in yards.
 */
export function getFrontPressure(
  player:    Actor,
  opponents: Pos[],
  radius:    number,
): number {
  let pressure = 0;
  for (const opp of opponents) {
    const dx   = opp.x - player.x;
    const dy   = opp.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= radius || dist < 0.01) continue;
    const dot = (dx / dist) * player.attackDir;
    if (dot <= 0) continue; // behind player — ignore
    pressure = Math.max(pressure, dot * (1 - dist / radius));
  }
  return Math.min(1, pressure);
}
