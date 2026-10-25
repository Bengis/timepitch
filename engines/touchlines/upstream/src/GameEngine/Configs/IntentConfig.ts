/**
 * IntentConfig — central registry mapping each TeamIntent to its scoring effects.
 *
 * Intents are transient bias signals (recomputed on possession-gain) that sit
 * on top of static tactical weights. Each intent declares multipliers for the
 * pass / carry / off-ball scoring layers and an optional flat shoot bonus.
 *
 * Adding a new intent is a one-place change: extend `TeamIntent` in types.ts,
 * then add an entry to INTENT_EFFECTS below with whichever effects apply.
 * Score functions never need to change.
 *
 * Multiplier semantics: 1.0 = no change. Values are applied to the *tactic*
 * weights (e.g. PROGRESS_WEIGHT in TeamPassWeights), so intents stack on top
 * of the tactic without overwriting it.
 *
 * Two effect KINDS live in the same registry:
 *   1. Multiplier effects (pass / carry / offBall) — scale an existing weight.
 *      A multiplier of 0 still yields 0, so it can only damp dimensions that
 *      already exist in the scoring.
 *   2. Additive descriptors (carryLanes / passTarget) — declare NEW scoring
 *      dimensions that no tactic weight expresses (e.g. a lateral carry lane,
 *      a far-side pass reward). Consumers iterate these descriptors generically
 *      — they never name a specific intent. Adding an intent that reuses an
 *      existing descriptor `kind` requires zero consumer changes; only a brand
 *      new geometric primitive needs a new case in the consumer.
 */

import type { TeamIntent } from '@/GameEngine/types';
import type { TeamPassWeights, TeamCarryWeights } from '@/GameEngine/Configs/AttackConfig';
import type { PressingStyle } from '@/types/tacticsTypes';

/** Off-ball intent names (kept inline to avoid circular imports with OffBallMovement). */
type OffBallIntentName =
  | 'offer_support'
  | 'hold_space'
  | 'make_run';

/**
 * Named geometric carry-lane primitives an intent can request on top of the
 * default forward lanes. The registry declares WHICH primitive; the consumer
 * (getBestCarryLane) knows HOW to turn each into an actual {dx,dy} from the
 * holder's position and attack direction.
 *
 *   far_flank — lateral lane across the pitch toward the opposite touchline at
 *               roughly the holder's x (minimal forward component).
 */
export type ExtraCarryLaneDir = 'far_flank';

/**
 * An extra carry lane to inject, with a flat score bonus so a soft-biased
 * lateral lane can compete with — but not always beat — the forward lanes.
 */
export interface ExtraCarryLane {
  dir: ExtraCarryLaneDir;
  /** Flat bonus added to this lane's final score. Soft bias — keep modest. */
  scoreBonus: number;
}

/**
 * Named pass-target region an intent can reward on top of the default forward
 * bias. Like ExtraCarryLaneDir, the consumer (PassLanes) resolves the geometry.
 *
 *   far_flank — receivers on the opposite side of the pitch from the holder.
 */
export type PassTargetKind = 'far_flank';

/** A directional pass-target bias rewarding receivers in a named region. */
export interface PassTargetBias {
  kind: PassTargetKind;
  /** Weight of the additive bias term applied to the pass score. */
  weight: number;
}

/**
 * Effects an intent can declare. All fields optional — omitted fields mean
 * "no change". Numbers in pass/carry/offBall are multipliers (default 1.0).
 *
 * Intents can also affect defensive behaviour — when the team is defending,
 * `defense.pressingStyleOverride` replaces the static `pressing_style` tactic
 * key for both intent multiplier lookup (INTENT_PRESSING_STYLE) and effective
 * press range computation. This is how a `counter_attack` team can dynamically
 * switch from low_block to high_press when the situation warrants it.
 */
export interface IntentEffects {
  /** Multipliers applied to TeamPassWeights fields. */
  pass?: Partial<Record<keyof TeamPassWeights, number>>;
  /** Multipliers applied to TeamCarryWeights fields. */
  carry?: Partial<Record<keyof TeamCarryWeights, number>>;
  /** Flat add to the shoot ActionScore (after compression). Small values only — 0.05 is meaningful. */
  shoot?: { scoreBonus?: number };
  /** Multipliers applied to off-ball intent scores after tactic multipliers. */
  offBall?: Partial<Record<OffBallIntentName, number>>;
  /** Defensive overrides — applied only when the team is defending. */
  defense?: {
    /** Replaces the team's static pressing_style tactic key. */
    pressingStyleOverride?: PressingStyle;
  };
  /**
   * Additive descriptor — extra carry lanes to inject beyond the default
   * forward lanes. Each carries its own flat score bonus. The consumer
   * resolves the geometry from the named `dir`.
   */
  carryLanes?: ExtraCarryLane[];
  /**
   * Additive descriptor — a directional pass-target bias rewarding receivers
   * in a named region (e.g. the far flank). Consumed generically by PassLanes.
   */
  passTarget?: PassTargetBias;
}

const NO_EFFECT: IntentEffects = {};

/**
 * The intent registry.
 *
 * counter_attack — OFFENSIVE intent. Bias long forward passes, forward carries,
 *   and forward runs. Boost PROGRESS, tolerate longer DISTANCE, accept tighter
 *   LANE. Carry leans on PROGRESS over CLEARANCE. Off-ball strongly biases
 *   make_run over offer_support and hold_space. Tiny shoot bonus to keep
 *   behaviour predictable (no forced shooting). No defensive effects — defense
 *   has its own intents (hold_shape / press_now).
 *
 * switch_play — OFFENSIVE intent. Soft bias toward switching the ball to the far
 *   side. Damps the holder's forward carry pull (PROGRESS / ANGLE multipliers
 *   below 1) and injects an additive far_flank carry lane so a lateral move
 *   across the pitch becomes a real option. On the pass side, a far_flank target
 *   bias rewards switching to the opposite wide channel. Because it is additive
 *   and soft, a genuinely wide-open forward lane can still outscore the switch.
 *
 * hold_shape — DEFENSIVE intent. Default defending state for the counter_attack
 *   tactic. The static low_block tactic already produces the right base shape;
 *   this intent currently has no overrides and exists as a named slot so that
 *   future iterations can layer on stricter shape behaviour (e.g. tighter
 *   compactness, deeper line) without introducing a new intent value.
 *
 * press_now — DEFENSIVE intent. Upgrade pressing to high_press. Fires when
 *   the team is defending, attackers have progressed into our half, and we
 *   have a structured defense with numerical advantage. Commits the team to
 *   hunting the ball back instead of holding shape.
 */
const INTENT_EFFECTS: Record<TeamIntent, IntentEffects> = {
  balanced: NO_EFFECT,
  counter_attack: {
    pass: {
      PROGRESS_WEIGHT:         2.2,
      DISTANCE_PENALTY_WEIGHT: 0.4,
      LANE_WEIGHT:             0.8,
    },
    carry: {
      PROGRESS_WEIGHT:      0.7,
      CLEARANCE_WEIGHT:     0.7,
      ANGLE_WEIGHT:         0.7,
      CROWD_PENALTY_WEIGHT: 1.3,
      MIN_TOTAL_SCORE:      1.4,
    },
    shoot: { scoreBonus: 0.05 },
    offBall: {
      make_run:      1.4,
      hold_space:    0.8,
      offer_support: 0.8,
    },
  },
  switch_play: {
    carry: {
      PROGRESS_WEIGHT: 0.5,
      ANGLE_WEIGHT:    0.5,
    },
    carryLanes: [{ dir: 'far_flank', scoreBonus: 0.4 }],
    passTarget: { kind: 'far_flank', weight: 0.6 },
  },
  hold_shape: NO_EFFECT,
  press_now: {
    defense: {
      pressingStyleOverride: 'high_press',
    },
  },
};

/** Returns the registered effects for the given intent (or a frozen empty object). */
export function getIntentEffects(intent: TeamIntent): IntentEffects {
  return INTENT_EFFECTS[intent] ?? NO_EFFECT;
}

/**
 * Apply pass-multiplier overrides on top of the team's tactic weights.
 * Returns a new object — never mutates the input.
 */
export function applyPassIntent(
  weights: TeamPassWeights,
  intent:  TeamIntent,
): TeamPassWeights {
  const mults = getIntentEffects(intent).pass;
  if (!mults) return weights;
  const out = { ...weights };
  for (const [k, mult] of Object.entries(mults) as [keyof TeamPassWeights, number][]) {
    out[k] = out[k] * mult;
  }
  return out;
}

/**
 * Apply carry-multiplier overrides on top of the team's tactic weights.
 * Returns a new object — never mutates the input.
 */
export function applyCarryIntent(
  weights: TeamCarryWeights,
  intent:  TeamIntent,
): TeamCarryWeights {
  const mults = getIntentEffects(intent).carry;
  if (!mults) return weights;
  const out = { ...weights };
  for (const [k, mult] of Object.entries(mults) as [keyof TeamCarryWeights, number][]) {
    out[k] = out[k] * mult;
  }
  return out;
}

/**
 * Apply off-ball multiplier overrides to a per-intent score map.
 * Returns a new object — never mutates the input.
 */
export function applyOffBallIntent(
  scores: Record<OffBallIntentName, number>,
  intent: TeamIntent,
): Record<OffBallIntentName, number> {
  const mults = getIntentEffects(intent).offBall;
  if (!mults) return scores;
  const out = { ...scores };
  for (const [k, mult] of Object.entries(mults) as [OffBallIntentName, number][]) {
    out[k] = out[k] * mult;
  }
  return out;
}

/** Returns the flat shoot bonus for the given intent (0 when none). */
export function getShootIntentBonus(intent: TeamIntent): number {
  return getIntentEffects(intent).shoot?.scoreBonus ?? 0;
}

/**
 * Returns the extra carry lanes the intent requests (empty when none).
 * Consumed generically by getBestCarryLane — it resolves each `dir` into an
 * actual lane vector and adds the lane's `scoreBonus` to its score.
 */
export function getExtraCarryLanes(intent: TeamIntent): ExtraCarryLane[] {
  return getIntentEffects(intent).carryLanes ?? [];
}

/**
 * Returns the intent's directional pass-target bias, or null when none.
 * Consumed generically by PassLanes — it adds `weight × regionMatch` to the
 * pass score for receivers in the named region.
 */
export function getPassTargetBias(intent: TeamIntent): PassTargetBias | null {
  return getIntentEffects(intent).passTarget ?? null;
}

/**
 * Returns the intent's pressing-style override, or null when none.
 * Caller is responsible for applying it only in defending contexts —
 * the override has no meaning when the team has the ball.
 */
export function getPressingStyleOverride(intent: TeamIntent): PressingStyle | null {
  return getIntentEffects(intent).defense?.pressingStyleOverride ?? null;
}
