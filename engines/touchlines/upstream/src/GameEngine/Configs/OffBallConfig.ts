import type { PlayerRole } from '@/GameEngine/types';
import { roleEngine } from '@/GameEngine/Domain/roleEngineData';

// ── Intent multiplier types ───────────────────────────────────────────────────

type OffBallIntentKey = 'offer_support' | 'hold_space' | 'make_run';
type IntentMultMap = Record<OffBallIntentKey, number>;

/**
 * Build-up tactic multipliers — applied on top of role intent weights.
 * Possession tilts toward support / shape; direct tilts toward runs.
 */
export const INTENT_BUILD_UP: Record<'possession' | 'balanced' | 'direct', IntentMultMap> = {
  possession: { offer_support: 1.4, hold_space: 1.2, make_run: 0.6 },
  balanced:   { offer_support: 1.0, hold_space: 1.0, make_run: 1.0 },
  direct:     { offer_support: 0.8, hold_space: 0.7, make_run: 1.5 },
};

/**
 * Width tactic multipliers — wide play slightly amplifies hold_space because
 * stretching width means *not* collapsing toward the ball.
 */
export const INTENT_WIDTH: Record<'narrow' | 'normal' | 'wide', IntentMultMap> = {
  narrow: { offer_support: 1.0, hold_space: 0.95, make_run: 1.0 },
  normal: { offer_support: 1.0, hold_space: 1.0,  make_run: 1.0 },
  wide:   { offer_support: 1.0, hold_space: 1.15, make_run: 1.0 },
};

// ── Main config ───────────────────────────────────────────────────────────────

export const OFF_BALL_CONFIG = {
  // ── Decision threshold ────────────────────────────────────────────────────
  /** Below this best-cell score → create_space (offensive roles) or idle. */
  MIN_SCORE_THRESHOLD: 0.2,

  // ── Context thresholds (intent selection) ─────────────────────────────────
  /** Pass score below this → strong offer_support boost. */
  LOW_PASS_SCORE: 0.35,
  /** Yards radius for counting nearby opponents (local pressure signal). */
  LOCAL_PRESSURE_RADIUS: 6,

  // ── Separation / clustering (used by score formulas + same-role penalty) ──
  /** Yards — optimal spacing baseline used by same-role cluster penalty. */
  IDEAL_SPACING: 15,
  /** Score reduction per same-role teammate inside IDEAL_SPACING (× 2 in formula). */
  CLUSTER_PENALTY_PER_PLAYER: 0.35,

  // ── Role-fit ──────────────────────────────────────────────────────────────
  /** Weight of role-fit penalty subtracted from the cell score. */
  ROLE_FIT_WEIGHT:        0.20,
  /** Per-yard penalty scale for cells outside role bounds. */
  ROLE_FIT_PENALTY_SCALE: 0.05,

  // ── Crowd grid sampling ───────────────────────────────────────────────────
  /** Yards between candidate cells inside the search window. */
  CANDIDATE_STEP: 4,
  /** "Player count" that maps to full teammate-saturation (separation = 0). */
  SEPARATION_NORM_PLAYERS: 1.5,
  /** "Player count" that maps to full opponent-saturation (markFreedom = 0). */
  MARK_NORM_PLAYERS: 1.5,

  // ── Per-intent search radii (yards) ───────────────────────────────────────
  /** offer_support — radius around the midway-to-ball anchor. */
  SUPPORT_SEARCH_RADIUS: 12,
  /** hold_space — radius around the formation slot anchor. */
  HOLD_SEARCH_RADIUS:    16,
  /** make_run — radius around the player (anchor is biased forward). */
  RUN_SEARCH_RADIUS:     20,

  // ── offer_support cell-score weights ─────────────────────────────────────
  SUPPORT_PASS_W: 0.55,
  SUPPORT_MARK_W: 0.25,
  SUPPORT_SEP_W:  0.20,

  // ── hold_space cell-score weights ────────────────────────────────────────
  HOLD_SEP_W:              0.50,
  HOLD_SLOT_W:             0.30,
  HOLD_MARK_W:             0.20,
  /** Yards — beyond this distance from the slot the slot bonus reaches 0. */
  HOLD_SLOT_SOFT_RADIUS:   18,

  // ── make_run cell-score weights ──────────────────────────────────────────
  RUN_PROGRESS_W: 0.50,
  RUN_CLEAR_W:    0.35,
  RUN_SEP_W:      0.15,

  // ── Formation pull (used by gameState.ts movement execution) ─────────────
  /** 0..1 — how strongly the formation slot pulls the off-ball target back. */
  FORMATION_PULL: 0.3,

  // ── Lookahead (used by gameState.ts movement execution) ──────────────────
  /** Yards — minimum projection distance (low vision). */
  BASE_LOOKAHEAD: 8,
  /** Yards — maximum projection distance (full vision). */
  MAX_LOOKAHEAD:  16,

  // ── Ball advance penalty (make_run intent shaping) ───────────────────────
  /** Yards ahead of holder — make_run penalty starts here. */
  MAX_ADVANCE_THRESHOLD: 10,
  /** Yards ahead of holder — penalty reaches floor here. */
  MAX_ADVANCE_AHEAD:     30,
  /** Minimum score multiplier at full advance. */
  MAX_ADVANCE_FLOOR:     0.1,
} as const;

/**
 * Returns a carry config for off-ball spatial scoring that layers role-specific
 * weight adjustments on top of the team's tactical carry config.
 *
 * Kept for any external caller that still wants a role-tuned carry config —
 * the new grid-driven OffBallMovement no longer uses it directly.
 */
export function getOffBallCarryConfig<T extends {
  CLEARANCE_WEIGHT: number;
  PROGRESS_WEIGHT: number;
  ANGLE_WEIGHT: number;
  CROWD_PENALTY_WEIGHT: number;
}>(role: PlayerRole, teamCfg: T): T {
  const d = roleEngine(role).offBallCarryDeltas;
  return {
    ...teamCfg,
    CLEARANCE_WEIGHT:     Math.max(0, Math.min(1, teamCfg.CLEARANCE_WEIGHT     + d.clearance)),
    PROGRESS_WEIGHT:      Math.max(0, Math.min(1, teamCfg.PROGRESS_WEIGHT      + d.progress)),
    ANGLE_WEIGHT:         Math.max(0, Math.min(1, teamCfg.ANGLE_WEIGHT         + d.angle)),
    CROWD_PENALTY_WEIGHT: Math.max(0, Math.min(1, teamCfg.CROWD_PENALTY_WEIGHT + d.crowd)),
  };
}
