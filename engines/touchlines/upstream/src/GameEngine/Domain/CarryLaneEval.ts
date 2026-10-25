/**
 * CarryLaneEval — carry lane scoring primitives shared by DecisionTree and OffBallMovement.
 *
 * Extracted here to break the circular dependency:
 *   DecisionTree  ← OffBallMovement  (OffBallMovement needs evaluateCarryLane + rot)
 *   OffBallMovement ← DecisionTree   (would be circular)
 *
 * Both DecisionTree and OffBallMovement import from here instead.
 */

import type { GamePlayer } from '@/GameEngine/types';
import { CARRY_CONFIG } from '@/GameEngine/Configs/CarryConfig';
import { roleEngine } from '@/GameEngine/Domain/roleEngineData';
import { PITCH_LENGTH } from '@/GameEngine/Domain/pitch';

// ── Scoring helpers ───────────────────────────────────────────────────────────

function getClearanceScore(
  player: GamePlayer,
  dirX: number, dirY: number,
  opponents: GamePlayer[],
): number {
  const vision = player.runtimeStats.withBall.carryVision;
  if (vision <= 0) return 0;

  let minDist = vision;
  for (const opp of opponents) {
    const odx  = opp.x - player.x;
    const ody  = opp.y - player.y;
    const dist = Math.sqrt(odx * odx + ody * ody);
    if (dist > vision || dist < 0.1) continue;
    const dot   = (odx / dist) * dirX + (ody / dist) * dirY;
    if (dot < 0) continue;
    // Widen cone to 45° so defenders slightly off-axis still reduce clearance
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (angle <= Math.PI / 4) minDist = Math.min(minDist, dist);
  }
  return Math.min(1, minDist / vision);
}

function getProgressScore(player: GamePlayer, dirX: number): number {
  return Math.max(0, dirX * player.attackDir);
}

function getAngleScore(
  player: GamePlayer,
  dirX: number, dirY: number,
  goalTargetY: number,
): number {
  const goalX  = player.attackDir === 1 ? PITCH_LENGTH : 0;
  const tgDx   = goalX - player.x;
  const tgDy   = goalTargetY - player.y;
  const tgDist = Math.sqrt(tgDx * tgDx + tgDy * tgDy);
  if (tgDist < 0.01) return 1;
  return Math.max(0, dirX * (tgDx / tgDist) + dirY * (tgDy / tgDist));
}

function getCrowdPenalty(
  targetX: number, targetY: number,
  opponents: GamePlayer[],
  visionNorm: number,
): number {
  let count = 0;
  for (const opp of opponents) {
    const d = Math.sqrt((opp.x - targetX) ** 2 + (opp.y - targetY) ** 2);
    if (d <= CARRY_CONFIG.TARGET_CROWD_RADIUS) count++;
  }
  const raw = Math.min(1, count / 3);
  return raw * (1 - visionNorm * CARRY_CONFIG.VISION_CROWD_REDUCTION);
}

function getVisionBonus(player: GamePlayer, progressScore: number, angleScore: number): number {
  const visionNorm = Math.min(1, player.runtimeStats.withBall.carryVision / 18);
  return visionNorm * ((progressScore + angleScore) / 2) * CARRY_CONFIG.VISION_WEIGHT;
}

function getPressurePenalty(player: GamePlayer, opponents: GamePlayer[]): number {
  const fwd = player.attackDir;
  let penalty = 0;

  for (const opp of opponents) {
    const dx   = opp.x - player.x;
    const dy   = opp.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= CARRY_CONFIG.MEDIUM_PRESSURE_DISTANCE || dist < 0.01) continue;
    const forwardDot = (dx / dist) * fwd;

    // Distance decay: linear falloff from 0 to MEDIUM_PRESSURE_DISTANCE.
    // An opponent at 0 yards = full weight; at MEDIUM_PRESSURE_DISTANCE = 0.
    const distFactor = 1 - dist / CARRY_CONFIG.MEDIUM_PRESSURE_DISTANCE;

    // Direction weight: opponent directly ahead (forwardDot=1) = full weight.
    // Beside (forwardDot=0) = half weight. Behind (forwardDot=-1) = 0 weight.
    const dirWeight = Math.max(0, (forwardDot + 1) / 2);

    penalty += CARRY_CONFIG.HARD_PRESSURE_PENALTY * distFactor * dirWeight;
  }

  return Math.min(penalty, CARRY_CONFIG.MAX_PRESSURE_PENALTY);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Per-component breakdown of a carry lane evaluation — used by the debug panel. */
export interface CarryLaneBreakdown {
  clearanceScore:  number;
  progressScore:   number;
  angleScore:      number;
  crowdPenalty:    number;
  roleBias:        number;
  visionBonus:     number;
  pressurePenalty: number;
  baseScore:       number;
  playerModifier:  number;
  score:           number;
}

/**
 * Score a single carry lane direction with full component breakdown.
 * Formula: baseScore + playerModifier, per carry.md.
 */
export function evaluateCarryLaneBreakdown(
  player: GamePlayer,
  dirX: number, dirY: number,
  goalTargetY: number,
  opponents: GamePlayer[],
  cfg: { [K in keyof typeof CARRY_CONFIG]: number },
): CarryLaneBreakdown {
  const targetX    = player.x + dirX * cfg.LOOKAHEAD_DISTANCE;
  const targetY    = player.y + dirY * cfg.LOOKAHEAD_DISTANCE;
  const visionNorm = Math.min(1, player.runtimeStats.withBall.carryVision / 18);

  const clearanceScore = getClearanceScore(player, dirX, dirY, opponents);
  const progressScore  = getProgressScore(player, dirX);
  const angleScore     = getAngleScore(player, dirX, dirY, goalTargetY);
  const crowdPenalty   = getCrowdPenalty(targetX, targetY, opponents, visionNorm);

  const baseScore =
    clearanceScore * cfg.CLEARANCE_WEIGHT +
    progressScore  * cfg.PROGRESS_WEIGHT  +
    angleScore     * cfg.ANGLE_WEIGHT      -
    crowdPenalty   * cfg.CROWD_PENALTY_WEIGHT;

  const roleBias        = roleEngine(player.role).carryBias;
  const visionBonus     = getVisionBonus(player, progressScore, angleScore);
  const pressurePenalty = getPressurePenalty(player, opponents);

  // Speed and acceleration are execution qualities (how fast the player moves
  // once carrying), not decision inputs — they belong in the physics/movement
  // layer, not here. Only role tendency and vision influence the decision.
  // Both are gated by clearanceScore so they contribute nothing in blocked lanes.
  const playerModifier =
    (roleBias * CARRY_CONFIG.ROLE_BIAS_WEIGHT + visionBonus) * clearanceScore
    - pressurePenalty;

  return {
    clearanceScore, progressScore, angleScore, crowdPenalty,
    roleBias, visionBonus, pressurePenalty,
    baseScore, playerModifier,
    score: baseScore + playerModifier,
  };
}

/**
 * Score a single carry lane direction.
 * Formula: baseScore + playerModifier, per carry.md.
 */
export function evaluateCarryLane(
  player: GamePlayer,
  dirX: number, dirY: number,
  goalTargetY: number,
  opponents: GamePlayer[],
  cfg: { [K in keyof typeof CARRY_CONFIG]: number },
): number {
  return evaluateCarryLaneBreakdown(player, dirX, dirY, goalTargetY, opponents, cfg).score;
}

/** Rotate a 2-D unit vector by `angle` radians. */
export function rot(dx: number, dy: number, angle: number): { dx: number; dy: number } {
  return {
    dx: dx * Math.cos(angle) - dy * Math.sin(angle),
    dy: dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}
