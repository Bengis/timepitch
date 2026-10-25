/**
 * AttackConfig — base constants for attacking positioning, and per-team
 * pass / carry scoring weights driven by the build_up tactic.
 *
 * Per-team configs are stored separately so Team A and Team B can use
 * different tactical settings simultaneously.
 *
 * Consumers:
 *   ATTACK_CONFIG            → Positioning.ts (positioning weights, global)
 *   getTeamPassConfig(team)  → PassLanes.ts   (pass scoring weights, per-team)
 *   getTeamCarryConfig(team) → DecisionTree.ts (carry lane weights, per-team)
 *
 * Updated by applyTeamAttackConfig(team, tactics) — call alongside
 * applyTeamTacticsConfig(team, tactics) when tactics change.
 */

import type { TeamId } from '@/GameEngine/types';
import type { TacticalStyle, BuildUpStyle, TeamWidth } from '@/types/tacticsTypes';
import { axesFor } from '@/types/tacticsTypes';
import { PASS_CONFIG } from '@/GameEngine/Configs/PassConfig';
import { CARRY_CONFIG } from '@/GameEngine/Configs/CarryConfig';

// ── Possession push-up — drives the defensive line forward during sustained possession ──

/**
 * How far (in yards) each role pushes forward as a function of possession time.
 * Effect ramps quadratically from 0 → MAX_YARDS over BASE_SECONDS.
 * GK/forwards have zero bias — they're already in their target zone.
 */
export const POSSESSION_PUSH_UP = {
  /** Game-seconds to reach full push-up effect (linear ramp). */
  BASE_SECONDS: 10,
  /** Maximum yards of forward shift at full effect. */
  MAX_YARDS:    28,
} as const;

/** Per-role forward push-up bias (0 = no push, 1 = full MAX_YARDS). */
export const PUSH_UP_ROLE_BIAS: Record<string, number> = {
  GK:  0.00,
  CB:  0.90,
  LB:  0.80,
  RB:  0.80,
  LWB: 0.65,
  RWB: 0.65,
  CDM: 0.60,
  CM:  0.50,
  LM:  0.40,
  RM:  0.40,
  CAM: 0.20,
  LW:  0.08,
  RW:  0.08,
  ST:  0.00,
  CF:  0.00,
};

// ── Global positioning constants (not per-team yet) ───────────────────────────

export const ATTACK_CONFIG = {
  /** 0..1 — how wide the team stretches when attacking. */
  ATTACK_WIDTH: 0.6,
  /** Yards — optimal spacing between support players. */
  SUPPORT_DISTANCE: 12,
  /** 0..1 — frequency of forward attacking runs (future use). */
  RUN_FREQUENCY: 0.4,
  /** 0..1 — how freely players move away from their formation anchor. */
  POSITIONAL_FREEDOM: 0.5,
  /** 0..1 — how strongly nearby players drift toward the ball to create support. */
  BALL_INFLUENCE_WEIGHT: 0.6,
  /** 0..1 — how strongly players push away from close teammates to maintain spacing. */
  SPACING_WEIGHT: 0.3,
  /** 0..1 — how well attackers correct their position to stay onside (1 = perfect, 0 = oblivious). */
  OFFSIDE_AWARENESS: 0.85,
  /** Yards — how far behind the offside line attackers aim to sit (small = aggressive, large = safe). */
  OFFSIDE_MARGIN: 1.0,
} as const;

// ── Per-team pass scoring weights (driven by build_up) ────────────────────────

/** Subset of PASS_CONFIG scoring weights that build_up tactics override. */
export interface TeamPassWeights {
  /** How much forward progress matters in pass selection. */
  PROGRESS_WEIGHT:         number;
  /** How much lane clarity matters (risk of interception). */
  LANE_WEIGHT:             number;
  /** How much open space around the receiver matters. */
  RECEIVER_SPACE_WEIGHT:   number;
  /** How heavily long passes are penalised. */
  DISTANCE_PENALTY_WEIGHT: number;
  /** How much passing into dangerous positions near goal is rewarded. */
  GOAL_PROXIMITY_WEIGHT:   number;
  /** Minimum score a pass must reach to be selected over other actions. */
  MIN_PASS_SCORE:          number;
}

const PASS_WEIGHT_DEFAULTS: TeamPassWeights = {
  PROGRESS_WEIGHT:         PASS_CONFIG.PROGRESS_WEIGHT,
  LANE_WEIGHT:             PASS_CONFIG.LANE_WEIGHT,
  RECEIVER_SPACE_WEIGHT:   PASS_CONFIG.RECEIVER_SPACE_WEIGHT,
  DISTANCE_PENALTY_WEIGHT: PASS_CONFIG.DISTANCE_PENALTY_WEIGHT,
  GOAL_PROXIMITY_WEIGHT:   PASS_CONFIG.GOAL_PROXIMITY_WEIGHT,
  MIN_PASS_SCORE:          PASS_CONFIG.MIN_PASS_SCORE,
};

/**
 * Pass scoring weights per build_up style.
 *
 * possession — safe, patient: lane clarity and receiver space dominate;
 *              forward progress less valued; long passes penalised more.
 * balanced   — PASS_CONFIG defaults.
 * direct     — progressive: forward progress dominates; long balls and
 *              tighter lanes are acceptable; lower threshold to pass.
 */
const BUILD_UP_PASS: Record<BuildUpStyle, TeamPassWeights> = {
  // All positive weights (PROGRESS + LANE + SPACE + GOAL) sum to 1.0 per style.
  // Ratios preserved; DISTANCE_PENALTY and MIN_PASS_SCORE scaled by the same factor.
  possession: {
    // Original positives summed to 1.30; scale factor 1/1.30.
    // Ratios: PROGRESS=GOAL=0.15, LANE=SPACE=0.50 → 3:10:10:3.
    PROGRESS_WEIGHT:         0.12,
    LANE_WEIGHT:             0.38,
    RECEIVER_SPACE_WEIGHT:   0.38,
    DISTANCE_PENALTY_WEIGHT: 0.19,
    GOAL_PROXIMITY_WEIGHT:   0.12,
    MIN_PASS_SCORE:          0.38,
  },
  balanced: { ...PASS_WEIGHT_DEFAULTS },
  direct: {
    // Original positives summed to 1.35; scale factor 1/1.35.
    // Ratios: PROGRESS=0.60, LANE=0.20, SPACE=0.15, GOAL=0.40 → 12:4:3:8.
    PROGRESS_WEIGHT:         0.44,
    LANE_WEIGHT:             0.15,
    RECEIVER_SPACE_WEIGHT:   0.11,
    DISTANCE_PENALTY_WEIGHT: 0.04,
    GOAL_PROXIMITY_WEIGHT:   0.30,
    MIN_PASS_SCORE:          0.26,
  },
};

const TEAM_PASS_WEIGHTS: Record<TeamId, TeamPassWeights> = {
  A: { ...PASS_WEIGHT_DEFAULTS },
  B: { ...PASS_WEIGHT_DEFAULTS },
};

/**
 * Returns the full pass scoring config for the given team.
 * Spatial constants (BLOCK_RADIUS, CLEAR_RADIUS, etc.) are never overridden.
 */
export function getTeamPassConfig(team: TeamId): { [K in keyof typeof PASS_CONFIG]: number } {
  return { ...PASS_CONFIG, ...TEAM_PASS_WEIGHTS[team] };
}

// ── Per-team carry lane weights (driven by build_up) ──────────────────────────

/** Subset of CARRY_CONFIG lane weights that build_up tactics override. */
export interface TeamCarryWeights {
  CLEARANCE_WEIGHT:     number;
  PROGRESS_WEIGHT:      number;
  ANGLE_WEIGHT:         number;
  CROWD_PENALTY_WEIGHT: number;
  /** Minimum total score a lane must reach to choose carry over pass. */
  MIN_TOTAL_SCORE:      number;
}

const CARRY_WEIGHT_DEFAULTS: TeamCarryWeights = {
  CLEARANCE_WEIGHT:     CARRY_CONFIG.CLEARANCE_WEIGHT,
  PROGRESS_WEIGHT:      CARRY_CONFIG.PROGRESS_WEIGHT,
  ANGLE_WEIGHT:         CARRY_CONFIG.ANGLE_WEIGHT,
  CROWD_PENALTY_WEIGHT: CARRY_CONFIG.CROWD_PENALTY_WEIGHT,
  MIN_TOTAL_SCORE:      CARRY_CONFIG.MIN_TOTAL_SCORE,
};

/**
 * Carry lane weights per build_up style.
 *
 * direct     — progress dominates; less worried about clearance / crowd.
 *              Lower MIN_TOTAL_SCORE = more willing to carry in tight situations.
 * balanced   — CARRY_CONFIG defaults.
 * possession — safety first; clearance and crowd avoidance dominate.
 *              Higher MIN_TOTAL_SCORE = only carry when clearly safe.
 */
const BUILD_UP_CARRY: Record<BuildUpStyle, TeamCarryWeights> = {
  direct: {
    CLEARANCE_WEIGHT:     0.25,
    PROGRESS_WEIGHT:      0.50,
    ANGLE_WEIGHT:         0.15,
    CROWD_PENALTY_WEIGHT: 0.15,
    MIN_TOTAL_SCORE:      0.35,
  },
  balanced: { ...CARRY_WEIGHT_DEFAULTS },
  possession: {
    // Higher clearance weight so truly open lanes score above MIN_TOTAL_SCORE (0.55).
    // Moderate carries (clearance ~0.60) still fail the threshold — only clearly
    // open space qualifies. Progress is de-emphasised; possession carries sideways
    // or slightly backward when space is genuinely there.
    CLEARANCE_WEIGHT:     0.65,
    PROGRESS_WEIGHT:      0.15,
    ANGLE_WEIGHT:         0.10,
    CROWD_PENALTY_WEIGHT: 0.45,
    MIN_TOTAL_SCORE:      0.55,
  },
};

const TEAM_CARRY_WEIGHTS: Record<TeamId, TeamCarryWeights> = {
  A: { ...CARRY_WEIGHT_DEFAULTS },
  B: { ...CARRY_WEIGHT_DEFAULTS },
};

/** Returns the full carry config for the given team (CARRY_CONFIG + per-team lane weight overrides). */
export function getTeamCarryConfig(team: TeamId): { [K in keyof typeof CARRY_CONFIG]: number } {
  return { ...CARRY_CONFIG, ...TEAM_CARRY_WEIGHTS[team] };
}

// ── Per-team attacking width (driven by width tactic) ────────────────────────

const WIDTH_ATTACK_WIDTH: Record<TeamWidth, number> = {
  narrow: 0.3,
  normal: 0.6,
  wide:   0.9,
};

const TEAM_ATTACK_WIDTH: Record<TeamId, number> = {
  A: ATTACK_CONFIG.ATTACK_WIDTH,
  B: ATTACK_CONFIG.ATTACK_WIDTH,
};

/** Returns the attacking width multiplier for the given team (0..1). */
export function getTeamAttackWidth(team: TeamId): number {
  return TEAM_ATTACK_WIDTH[team];
}

// ── Per-team tactic name storage (for off-ball intent selection) ──────────────

const TEAM_BUILD_UP: Record<TeamId, BuildUpStyle> = {
  A: 'balanced',
  B: 'balanced',
};

const TEAM_WIDTH: Record<TeamId, TeamWidth> = {
  A: 'normal',
  B: 'normal',
};

/**
 * The user-facing TacticalStyle currently active for each team.
 * Stored alongside the derived axes so detectors (e.g. IntentDetection) can
 * gate behaviour on the high-level style without re-deriving it.
 */
const TEAM_TACTICAL_STYLE: Record<TeamId, TacticalStyle> = {
  A: 'balanced',
  B: 'balanced',
};

/** Returns the current build_up tactic name for the given team. */
export function getTeamBuildUp(team: TeamId): BuildUpStyle {
  return TEAM_BUILD_UP[team];
}

/** Returns the current width tactic name for the given team. */
export function getTeamWidth(team: TeamId): TeamWidth {
  return TEAM_WIDTH[team];
}

/** Returns the user-facing tactical style currently active for the given team. */
export function getTeamTacticalStyle(team: TeamId): TacticalStyle {
  return TEAM_TACTICAL_STYLE[team];
}

/** Apply attack-side tactics (derived from a TacticalStyle) to the given team. */
export function applyTeamAttackConfig(team: TeamId, style: TacticalStyle): void {
  const axes = axesFor(style);
  Object.assign(TEAM_PASS_WEIGHTS[team], BUILD_UP_PASS[axes.build_up]);
  Object.assign(TEAM_CARRY_WEIGHTS[team], BUILD_UP_CARRY[axes.build_up]);
  TEAM_ATTACK_WIDTH[team]    = WIDTH_ATTACK_WIDTH[axes.width];
  TEAM_BUILD_UP[team]        = axes.build_up;
  TEAM_WIDTH[team]           = axes.width;
  TEAM_TACTICAL_STYLE[team]  = style;
}
