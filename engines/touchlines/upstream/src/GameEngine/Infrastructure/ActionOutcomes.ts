/**
 * ActionOutcomes — centralised outcome calculations for game actions.
 *
 * Every "what happens when X is attempted?" computation lives here so it's
 * easy to find, tune, and test in one place.
 *
 * Rules:
 *   - Pure functions only — no state mutation, no side-effects.
 *   - Randomness is allowed (Math.random) but all probability formulas
 *     must be co-located here, never scattered in gameState.ts.
 *   - Imports ONLY from types.ts (same rule as DecisionTree).
 */

import type { GamePlayer } from '@/GameEngine/types';
import { tackleAngleModifier } from '@/GameEngine/Domain/PositionalAwareness';
import {
  PITCH_LENGTH,
  PITCH_WIDTH,
  GOAL_Y_MIN,
  GOAL_Y_MAX,
} from '@/GameEngine/Domain/pitch';

export { PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX };

export const SHOT_SPEED      = 2.0;
export const TACKLE_COOLDOWN = 1.2;
/** Acceleration burst multiplier for a carrier being pressed — mirrors PRESS_ACCEL_SPEED_BOOST. */
export const CARRY_ACCEL_SPEED_BOOST = 0.8;  // reduced 20% to match narrowed speed range
/** Fixed physical tackle range in yards — all players are roughly the same size. */
export const TACKLE_RANGE    = 2.0;

// ── Interception corridor ────────────────────────────────────────────────────

/** Minimum interception corridor (yards) — even the slowest player can reach. */
export const BASE_INTERCEPTION_CORRIDOR  = 3.0;
/** Each point of normalised speed adds this many yards to the corridor. */
export const SPEED_CORRIDOR_FACTOR       = 2.0;
/** Each point of normalised acceleration adds this many yards to the corridor. */
export const ACCEL_CORRIDOR_FACTOR       = 2.0;
/** Maximum possible corridor — used as pre-filter in gameState.ts (all stats = 1.0). */
export const MAX_INTERCEPTION_CORRIDOR   = BASE_INTERCEPTION_CORRIDOR + SPEED_CORRIDOR_FACTOR + ACCEL_CORRIDOR_FACTOR;

/**
 * Compute the effective interception corridor (yards) for a specific player.
 * Faster and more explosive players can cover more ground to reach a passing lane.
 */
export function playerInterceptionCorridor(player: GamePlayer): number {
  const { speed, acceleration } = player.runtimeStats.withoutBall;
  return BASE_INTERCEPTION_CORRIDOR + speed * SPEED_CORRIDOR_FACTOR + acceleration * ACCEL_CORRIDOR_FACTOR;
}

// ── Duel recovery (shared by tackle and dribble outcomes) ────────────────────
/** Speed multiplier applied while a player is in recovery from any duel. */
export const DUEL_RECOVERY_SPEED_FACTOR  = 0.35;

// Tackle outcomes
export const DUEL_TACKLE_WIN_RECOVERY    = 0.3;   // tackler regains composure
export const DUEL_TACKLE_LOSS_RECOVERY   = 1.5;   // dispossessed player stumbles
export const DUEL_TACKLE_FAILED_RECOVERY = 1.0;   // missed lunge — off balance

// Dribble outcomes
export const DUEL_DRIBBLE_WIN_RECOVERY   = 0.4; // winner moves away before re-evaluating
export const DUEL_DRIBBLE_LOSS_RECOVERY  = 1;   // loser of 1v1 dribble duel is briefly frozen

// Backwards-compat aliases used in gameState.ts (remove once references are updated)
/** @deprecated Use DUEL_TACKLE_WIN_RECOVERY */
export const TACKLE_RECOVERY_WINNER_DURATION = DUEL_TACKLE_WIN_RECOVERY;
/** @deprecated Use DUEL_TACKLE_LOSS_RECOVERY */
export const TACKLE_RECOVERY_LOSER_DURATION  = DUEL_TACKLE_LOSS_RECOVERY;
/** @deprecated Use DUEL_TACKLE_FAILED_RECOVERY */
export const TACKLE_RECOVERY_FAILED_DURATION = DUEL_TACKLE_FAILED_RECOVERY;
/** @deprecated Use DUEL_RECOVERY_SPEED_FACTOR */
export const TACKLE_RECOVERY_SPEED_FACTOR    = DUEL_RECOVERY_SPEED_FACTOR;

// ── Shot aim ─────────────────────────────────────────────────────────────────

export interface ShotAim {
  toX: number;
  toY: number;
}

/**
 * Compute where a shot is aimed, given the shooter's accuracy.
 * Higher accuracy → tighter spread toward the centre of the goal.
 */
export function computeShotAim(shooter: GamePlayer): ShotAim {
  const { shootAccuracy } = shooter.runtimeStats.withBall;
  const toX = shooter.attackDir === 1 ? PITCH_LENGTH : 0;

  const spread    = (GOAL_Y_MAX - GOAL_Y_MIN) * (1 - shootAccuracy);
  const aimCenter = (GOAL_Y_MIN + GOAL_Y_MAX) / 2;
  const halfRange = (GOAL_Y_MAX - GOAL_Y_MIN) / 2 + spread;
  const toY       = aimCenter + (Math.random() * 2 - 1) * halfRange;

  return { toX, toY };
}

// ── xG / shot resolution ─────────────────────────────────────────────────────

/**
 * Angle (radians) subtended by the goal posts from a given position.
 * Used by computeXG and the scoring system to measure shot angle quality.
 */
export function computeOpenAngle(sx: number, sy: number, goalX: number): number {
  const ax = goalX - sx, ay = GOAL_Y_MIN - sy;
  const bx = goalX - sx, by = GOAL_Y_MAX - sy;
  const dot   = ax * bx + ay * by;
  const cross = Math.abs(ax * by - ay * bx);
  return Math.atan2(cross, dot);
}

/** Theoretical maximum spatial xG (used to normalise for shoot decision scoring). */
export const MAX_XG             = 1.0;
export const MAX_OPEN_ANGLE     = Math.PI / 4;   // ~45° — penalty-spot central shot as reference max
/** Scale (yards) for power-law distance falloff. Controls the "elbow" of the curve. */
export const XG_DIST_SCALE      = 40;
/** Exponent for power-law decay: exp(-(dist/scale)^power). Higher = steeper drop at distance. */
export const XG_DIST_POWER      = 10;
// Reference points: 7 yds → 0.98 | 12 yds → 0.92 | 18 yds → 0.74 | 25 yds → 0.45 | 35 yds → 0.11
/**
 * Radius (yards) within which defenders contribute pressure to xG.
 * Zero contribution at this distance; full contribution at 0 yards.
 */
export const XG_PRESS_RADIUS    = 5.0;
/**
 * How much one "full-strength-matched" defender at 0 yards reduces xG.
 * Calibrated so equal-strength, right-on-you → ~30% xG reduction.
 * High-strength mismatch (10 vs 1) at 0 yards → ~60% reduction.
 * Low-strength mismatch (1 vs 10) at 0 yards → ~2% reduction.
 */
export const XG_PRESSURE_SCALE  = 0.6;           // per unit of weighted pressure (see computeWeightedPressure)
/** Minimum pressureFactor — prevents xG dropping to absolute zero even under heavy press. */
export const XG_PRESSURE_FLOOR  = 0.10;
export const GK_DISTANCE_SCALE  = 20;            // yards — far vs close GK threshold
// Compressed range: finishing skill matters at the margins, not 2x. The squad
// data clusters finishing low (even elite forwards ~6-9, most players 0-3), so a
// wide [0.7,1.3] swing crushed low-rated teams' conversion. A poor finisher still
// buries a clear chance; an elite one gains ~30% over them, not 80%.
export const SHOOTER_EFFECT_MIN = 0.85;
export const SHOOTER_EFFECT_MAX = 1.2;
export const GK_EFFECT_MIN      = 0.55;
export const GK_EFFECT_MAX      = 0.9;

// ── GK semicircle positioning ─────────────────────────────────────────────────
/** Minimum yards off the goal line (always slightly advanced). */
export const GK_MIN_COME_OUT           = 0.5;
/** Maximum yards off the goal line (attacker inside the box). */
export const GK_MAX_COME_OUT           = 6.0;
/** Attacker distance at which the GK is fully extended; retreats linearly beyond. */
export const GK_COME_OUT_DIST          = 20;
/** Positional deviation (yards) at which position quality reaches 0. */
export const GK_MAX_POSITION_DEVIATION = 8.0;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Compute pure spatial xG from position and weighted pressure.
 * Does NOT include shooter or GK attributes — this is the true chance quality.
 * Range: 0..1  (naturally bounded by the formula; no artificial cap).
 *
 * `pressure` is the weighted pressure from `computeWeightedPressure`, not a raw count.
 */
export function computeXG(dist: number, openAngle: number, pressure: number): number {
  const distFactor     = Math.exp(-Math.pow(dist / XG_DIST_SCALE, XG_DIST_POWER));
  const angleFactor    = clamp(openAngle / MAX_OPEN_ANGLE, 0.2, 1);
  const pressureFactor = clamp(1 - pressure * XG_PRESSURE_SCALE, XG_PRESSURE_FLOOR, 1);
  return clamp(distFactor * angleFactor * pressureFactor, 0, 1);
}

/**
 * Compute weighted pressure on a shooter from a list of nearby defenders.
 *
 * Each defender contributes based on:
 *   - Distance: quadratic falloff from 0 yards (full) to XG_PRESS_RADIUS yards (zero).
 *     Squaring the linear falloff makes close defenders much more threatening.
 *   - Strength mismatch: defender.strength² / (defender.strength² + shooter.strength²).
 *     Uses raw 0–10 values to exaggerate mismatches — a 10-str defender on a 1-str
 *     shooter contributes ~99% while the reverse contributes ~1%.
 *
 * Reference points (XG_PRESSURE_SCALE = 0.6):
 *   Equal strength (5v5) at 0 yards  → contribution 0.50 → pressureFactor 0.70 (30% drop)
 *   Equal strength at 2 yards        → contribution 0.22 → pressureFactor 0.87 (13% drop)
 *   Strong def (10) vs weak att (1) at 0 yards → contribution 0.99 → pressureFactor 0.41 (59% drop)
 *   Weak def (1) vs strong att (10) at 0 yards → contribution 0.01 → pressureFactor 0.99 (~1% drop)
 *   Two strong defs on weak att      → total ≈ 1.98 → clamp to floor 0.10
 */
export function computeWeightedPressure(
  shooter: GamePlayer,
  defenders: GamePlayer[],
): number {
  const attStr = (shooter.runtimeStats.withBall.strength || 0.5) * 10; // fallback 5/10 if missing
  const attStr2 = attStr * attStr || 0.01; // guard div/0
  let total = 0;
  for (const def of defenders) {
    if (def.recoveryTime > 0) continue; // stumbling — not an active threat
    const d = Math.hypot(def.x - shooter.x, def.y - shooter.y);
    if (d >= XG_PRESS_RADIUS) continue;
    const linear      = 1 - d / XG_PRESS_RADIUS;
    const distFactor  = linear * linear;          // quadratic: close is very threatening
    const defStr      = (def.runtimeStats.withoutBall.strength || 0.5) * 10; // fallback 5/10 if missing
    const defStr2     = defStr * defStr;
    const strengthRatio = defStr2 / (defStr2 + attStr2);
    total += distFactor * strengthRatio;
  }
  return total;
}

/**
 * Shooter execution quality. Uses existing `shootAccuracy` (0..0.95) from TeamLineup.
 * Maps to a multiplier: average finisher ~1.0, elite ~1.3, poor ~0.7.
 */
export function computeShooterEffect(shooter: GamePlayer): number {
  const val = SHOOTER_EFFECT_MIN
    + shooter.runtimeStats.withBall.shootAccuracy * (SHOOTER_EFFECT_MAX - SHOOTER_EFFECT_MIN) / 0.95;
  return clamp(val, SHOOTER_EFFECT_MIN, SHOOTER_EFFECT_MAX);
}

/**
 * How well the GK is positioned on the ideal angle-bisector arc (0=poor, 1=perfect).
 * The optimal position sits on the line from the goal centre toward the ball,
 * at a come-out distance that scales with attacker proximity.
 */
export function computeGKPositionQuality(
  gk: GamePlayer,
  ballPos: { x: number; y: number },
): number {
  const goalX       = gk.attackDir === 1 ? 0 : PITCH_LENGTH;
  const goalCenterY = (GOAL_Y_MIN + GOAL_Y_MAX) / 2;

  const dx   = ballPos.x - goalX;
  const dy   = ballPos.y - goalCenterY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return 1.0;

  const comeOut = GK_MIN_COME_OUT
    + (GK_MAX_COME_OUT - GK_MIN_COME_OUT) * Math.max(0, 1 - dist / GK_COME_OUT_DIST);

  const optX = goalX + (dx / dist) * comeOut;
  const optY = goalCenterY + (dy / dist) * comeOut;

  const deviation = Math.hypot(gk.x - optX, gk.y - optY);
  return Math.max(0, 1 - deviation / GK_MAX_POSITION_DEVIATION);
}

/**
 * GK quality multiplier. Closer shots emphasise reflex; far shots emphasise diving.
 * Positioning is scaled by how close the GK is to the optimal angle-bisector arc.
 * Returns a value in [GK_EFFECT_MIN, GK_EFFECT_MAX] that reduces goalChance.
 *
 * Weights sum to 1.0:
 *   positioning (× arc quality): 0.50
 *   reflex/diving (distance-blended): 0.50
 *
 * Max-stat GK perfectly on arc → gkSkill=1.0 → gkEffect=0.40 (GK_EFFECT_MIN).
 */
export function computeGKEffect(
  gk: GamePlayer,
  distToGoal: number,
  ballPos: { x: number; y: number },
): number {
  const closeWeight = clamp(1 - distToGoal / GK_DISTANCE_SCALE, 0, 1);
  const farWeight   = 1 - closeWeight;
  const { gkPositioning, gkReflex, gkDiving } = gk.runtimeStats.withoutBall;

  const posQuality = computeGKPositionQuality(gk, ballPos);

  const gkSkill = gkPositioning * posQuality * 0.5
    + (gkReflex * closeWeight + gkDiving * farWeight) * 0.5;

  // gkSkill 0..1 → gkEffect 1.0..0.55  (max GK reduces goalChance by 45%)
  return clamp(1 - gkSkill * 0.45, GK_EFFECT_MIN, GK_EFFECT_MAX);
}

export interface ShotResult {
  isGoal:     boolean;
  goalChance: number;
  inPosts:    boolean;
}

/**
 * Resolve a shot outcome using xG × shooterEffect × gkEffect.
 * Pass `gk = null` to skip GK resistance (no GK present).
 */
export function resolveShot(
  shooter: GamePlayer,
  gk: GamePlayer | null,
  shot: import('@/GameEngine/types').ShotState,
): ShotResult {
  const inPosts = shot.toY >= GOAL_Y_MIN && shot.toY <= GOAL_Y_MAX;
  if (!inPosts) return { isGoal: false, goalChance: 0, inPosts };

  const shooterEffect = computeShooterEffect(shooter);
  const gkEffect      = gk
    ? computeGKEffect(gk, Math.hypot(shooter.x - shot.toX, shooter.y - shot.toY), { x: shooter.x, y: shooter.y })
    : 1.0;
  const goalChance = clamp(shot.xg * shooterEffect * gkEffect, 0, 1);
  return { isGoal: Math.random() < goalChance, goalChance, inPosts };
}

// ── Tackle ───────────────────────────────────────────────────────────────────

export interface TackleResult {
  success: boolean;
  chance: number;
}

// ── Dribble ───────────────────────────────────────────────────────────────────

/** Max yards between attacker and defender to score a dribble (outer detection radius). */
export const DRIBBLE_ATTEMPT_RANGE = 8.0;
/** Yards at which the attacker is close enough to actually resolve the 1v1 challenge. */
export const DRIBBLE_RESOLUTION_RANGE = 2.0;
/** Minimum carryBias (from roleEngine) needed for a player to attempt dribbling. */
export const DRIBBLE_MIN_BIAS = 0.25;

export interface DribbleResult {
  attackerWins: boolean;
  winProb: number;
}

/**
 * Resolve a 1v1 dribble contest.
 * Attacker has a slight initiative advantage (defender tackling scaled by 0.85).
 * Dribbling stat affects resolution, NOT the decision to attempt.
 *
 * `pressingLoad` (0–1): nearby defenders (not the target) create crowd pressure that
 * suppresses the attacker's effective dribbling, mirroring the tackle crowd effect.
 * A strong carrier (strength=1) is immune; a weak one (strength=0) loses full dribbling
 * protection at pressingLoad=1. Max effective dribbling reduction: 40%.
 */
export function resolveDribble(attacker: GamePlayer, defender: GamePlayer, pressingLoad = 0): DribbleResult {
  const holderStrength     = attacker.runtimeStats.withBall.strength ?? 0.5;
  const suppression        = pressingLoad * (1 - holderStrength);
  const effectiveDribbling = attacker.runtimeStats.withBall.dribbling * (1 - suppression);

  const attackerScore = effectiveDribbling;
  // Floorless tackling (not tackleChance, which carries a +0.1 offset) so a weak
  // defender scales toward zero — symmetric with the attacker's floorless dribbling.
  // Weak-vs-weak ≈ 50/50; the 0.85 keeps the attacker's slight initiative edge.
  const defenderScore = defender.runtimeStats.withoutBall.tackling * 0.85;
  const winProb = attackerScore / (attackerScore + defenderScore + 0.001); // guard div/0
  return { attackerWins: Math.random() < winProb, winProb };
}

// ── Loose-ball duel (through balls) ───────────────────────────────────────────

export interface LooseBallDuelResult {
  /** Player who wins possession. */
  winnerId: number;
  /** Win probability of `a` (the first player passed). */
  probA:    number;
}

/**
 * Resolve a contested loose-ball arrival — two opposing players reach the
 * landing point near-simultaneously. This is NOT a tackle (no ball-at-feet
 * angle modifiers, no role-fit) and NOT a dribble (no skill-vs-skill 1v1) —
 * it's a 50/50 collision weighted by physical traits + arrival margin.
 *
 *   playerScore =
 *       strength      × 0.40
 *     + dribbling     × 0.25  // first-touch control on the contested ball
 *     + acceleration  × 0.20
 *     + arrivalBonus          // +0..0.10 for arriving cleaner
 *     + 0.15                  // base parity
 *
 * Both participants enter brief recovery (handled by the caller).
 */
export function resolveLooseBallDuel(
  a:          GamePlayer,
  b:          GamePlayer,
  arrivalGap: number, // |distA - distB| in yards (smaller = closer arrival)
): LooseBallDuelResult {
  const score = (p: GamePlayer, distAdv: boolean): number => {
    const wb  = p.runtimeStats.withBall;
    const wnb = p.runtimeStats.withoutBall;
    const arrivalBonus = distAdv ? Math.max(0, 0.10 * (1 - Math.min(1, arrivalGap / 2))) : 0;
    return (
      (wnb.strength ?? 0.5) * 0.40 +
      wb.dribbling          * 0.25 +
      wnb.acceleration      * 0.20 +
      arrivalBonus +
      0.15
    );
  };
  const sA = score(a, true);
  const sB = score(b, false);
  const probA = sA / (sA + sB + 0.001);
  return { winnerId: Math.random() < probA ? a.id : b.id, probA };
}

// ── Tackle ───────────────────────────────────────────────────────────────────

/**
 * Roll whether a tackle attempt succeeds based on the tackler's tackling stat,
 * modified by their positional angle and relative physical strength.
 *
 * Base angle modifiers (equal strength):
 *   front  → +0.30   (facing the attacker, in their path)
 *   side   → +0.10   (shoulder challenge)
 *   behind → −0.30   (desperate lunge from behind)
 *
 * Strength scaling (defender.strength vs holder.strength, both 0–1):
 *   A stronger defender closes the gap between side/behind and the front bonus.
 *   At maximum advantage (+1.0):
 *     side   → +0.30  (debuff fully negated — brute-force shoulder challenge)
 *     behind → −0.05  (barely a penalty — overpowers the carrier from behind)
 *   At maximum disadvantage (−1.0):
 *     side   → −0.10  (shoulder challenge vs stronger attacker backfires)
 *     behind → −0.55  (desperate lunge against a powerful carrier)
 *   Front is unaffected — position already gives full advantage.
 *
 * `pressingLoad` (0–1): additional defenders pressing nearby (not the tackler).
 *   Has two independent effects on the holder, both mitigated by holder strength:
 *
 *   1. Suppresses dribbling resistance — holder can't focus on the 1v1 while bodies close in.
 *        pressingLoad=1, strength=0 → dribbling fully suppressed (×0)
 *        pressingLoad=1, strength=1 → no suppression
 *
 *   2. Boosts tackler's base+angle — crowd pressure directly improves the tackle attempt.
 *        Max bonus: +0.20 at pressingLoad=1, strength=0
 *        At strength=1: no bonus (strong carrier absorbs the crowd physically)
 *
 *   Reference (max-dribble holder, solo tackle vs crowd tackle):
 *     Solo,  strength=0 → dribbleReduction=0.60, pressBonus=0   → chance ≈ base×0.60
 *     Crowd, strength=0 → dribbleReduction=1.00, pressBonus=0.20 → chance ≈ (base+0.20)×1.00
 *     Crowd, strength=1 → dribbleReduction=0.60, pressBonus=0   → same as solo (immune)
 */
export function resolveTackle(tackler: GamePlayer, holder: GamePlayer, pressingLoad = 0): TackleResult {
  const base     = tackler.runtimeStats.withoutBall.tackleChance;
  const rawAngle = tackleAngleModifier(tackler, holder);

  // Strength advantage: −1 (hugely weaker defender) → 0 (equal) → +1 (hugely stronger)
  const defStr      = tackler.runtimeStats.withoutBall.strength ?? 0.5;
  const attStr      = holder.runtimeStats.withBall.strength     ?? 0.5;
  const strengthAdv = Math.max(-1, Math.min(1, defStr - attStr));

  // Strength adjusts the gap between the raw angle modifier and the front bonus (+0.30).
  // At full advantage the gap is closed entirely; front is left unchanged.
  const FRONT_BONUS = 0.30;
  const gap         = FRONT_BONUS - rawAngle;
  const angleMod    = rawAngle + strengthAdv * gap * 0.5;

  // Pressing load — two effects, both gated by holder strength.
  const holderStrength = holder.runtimeStats.withBall.strength ?? 0.5;
  const suppression    = pressingLoad * (1 - holderStrength); // 0..1

  // Effect 1: suppresses holder's effective dribbling resistance.
  const effectiveDribbling = holder.runtimeStats.withBall.dribbling * (1 - suppression);
  const dribbleReduction   = 1 - effectiveDribbling * 0.4;

  // Effect 2: direct boost to the tackler's base+angle score.
  const MAX_PRESS_TACKLE_BONUS = 0.20;
  const pressBonus = suppression * MAX_PRESS_TACKLE_BONUS;

  const chance  = Math.max(0, Math.min(1, (base + angleMod + pressBonus) * dribbleReduction));
  const success = Math.random() < chance;
  return { success, chance };
}

// ── Interception ─────────────────────────────────────────────────────────────

export interface InterceptionResult {
  success: boolean;
  chance: number;
}

/**
 * Roll whether a pass interception succeeds.
 *
 * Chance scales linearly from the player's base `interceptionChance` (at perpDist=0)
 * down to 0 at the edge of their personal corridor (perpDist=corridor).
 *
 * @param perpDist  Perpendicular distance in yards from the defender to the pass line.
 * @param corridor  The defender's effective interception corridor.
 */
export function resolveInterception(
  interceptor: GamePlayer,
  perpDist: number,
  corridor: number,
  /** 0..1 normalised passing skill of the player who made the pass. */
  passerSkill: number = 0,
): InterceptionResult {
  const baseChance   = interceptor.runtimeStats.withoutBall.interceptionChance;
  const distFactor   = Math.sqrt(Math.max(0, 1 - perpDist / corridor));
  // A 10/10 passer (passerSkill=1) reduces the final chance by 40%
  const passerFactor = 1 - passerSkill * 0.4;
  const chance       = baseChance * distFactor * passerFactor;
  const success      = Math.random() < chance;
  return { success, chance };
}
