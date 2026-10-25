/**
 * ThroughBallConfig — tunable weights and thresholds for through-ball scoring.
 *
 * A through ball is a pass played into space (not at a teammate's feet) that
 * becomes a contested loose ball. Scoring evaluates each candidate grid cell
 * for "would dropping the ball here win us the race?"
 *
 * Edit only here to tune through-ball behaviour — no weights are hardcoded in
 * ThroughBallCells.ts.
 *
 * Source of truth: this file + .claude/rules/game-engine/through-ball.md (TBD).
 */

export const THROUGH_BALL_CONFIG = {
  // ── Phase 1 cull thresholds ────────────────────────────────────────────────
  /** Cell must be at least this many yards ahead of the passer in attack dir. */
  MIN_FORWARD_PROGRESS: 5,
  /**
   * The intended runner must currently be at least this many yards BEHIND the
   * cell in attack direction — i.e. they must run *forward* onto it. A cell
   * that is level with or behind the attacker isn't a through ball; it's a
   * sideways/backward pass into space. Setting this slightly negative would
   * tolerate "the run was already starting" cases, but 2 yards forward is the
   * minimum to call it a through ball.
   */
  MIN_RUNNER_FORWARD_PROGRESS: 2,
  /** Vision = 0 sees this far for through-ball purposes. */
  VISION_HORIZON_MIN: 25,
  /** Vision = 1.0 sees this far. */
  VISION_HORIZON_MAX: 60,
  /** Cell density (opponent footprint, 3×3 sample) above which the cell is too crowded. */
  MAX_OPP_DENSITY: 12,

  // ── Phase 2 fine-score weights ─────────────────────────────────────────────
  /**
   * Race margin — necessary signal (we must reach before the defender) but
   * NOT the primary discriminator vs a regular pass. A pass to feet doesn't
   * need a race; only path-clearness sets a TB apart. So race is moderate.
   */
  W_RACE: 0.35,
  /** Open space — derived from the crowd grid. */
  W_SPACE: 0.20,
  /** Passer skill — vision + passingSkill blend. */
  W_SKILL: 0.10,
  /**
   * Path clearness — TB-only factor and the *primary* discriminator vs a
   * regular pass. Rewards cells with no defenders between them and the goal,
   * i.e. "the runner is through the line once they collect". This is what
   * makes a TB structurally different from a pass-to-feet — Santos with a
   * clean run scores high here; Santos with a CB ahead scores low.
   *
   * Heaviest TB weight: it's the answer to "does this play put the runner
   * through?" Without a strong path bonus, a tight pass to feet always wins
   * because race+space+goal saturate equally well for both pass kinds.
   */
  W_PATH: 0.40,
  /** Lane risk — penalty for opponents along the ball's flight path. */
  W_LANE_RISK: 0.10,
  /** Offside risk — soft penalty for cells past offside that the *intended runner* couldn't legally reach. */
  W_OFFSIDE: 0.05,

  /**
   * Goal-threat BUFF — multiplicative reward, NOT an additive weight and NOT a
   * penalty. Final cell score = viability × (1 + GOAL_THREAT_BUFF × goalThreat),
   * where goalThreat ∈ [0,1] blends goal proximity + open shooting angle.
   *
   * Why a buff and not a penalty: we sometimes WANT a pure progression ball into
   * open space with no immediate goal threat (e.g. springing a runner from
   * midfield). Penalising the bad-angle corner would kill those plays. Instead
   * we leave low-threat cells at their full viability and *lift* the cells that
   * also create a genuine goal threat above them. At GOAL_THREAT_BUFF = 0.6 a
   * cell with perfect goal threat (1.0) scores 1.6× a same-viability cell with
   * zero threat — enough to flip a central, good-angle cell ahead of a clean but
   * dead-corner channel, without ever pushing a no-threat progression ball below
   * the selection threshold.
   */
  GOAL_THREAT_BUFF: 0.6,

  // ── Path-clearness sampling ───────────────────────────────────────────────
  /** Y-axis cell band around the cell row to sample for forward-path defenders. */
  PATH_ROW_BAND: 5,
  /** Defending-grid density above which path-clearness saturates to 0. */
  PATH_DENSITY_SATURATION: 30,

  // ── Race / sprint mechanics ───────────────────────────────────────────────
  /**
   * Sprint speed boost from acceleration when chasing a loose ball.
   * Press uses 1.0 (PRESS_ACCEL_SPEED_BOOST); through-ball chase is more
   * urgent so we use a higher value.
   */
  SPRINT_ACCEL_BOOST: 1.5,
  /** Top-end speed contribution on a through-ball chase (yds/s per unit speed stat). */
  SPRINT_TOP_BOOST: 0.5,

  /** Race margin (s) at which we score 1.0 — being 1.0 s faster than the closest defender is decisive. */
  RACE_FAVOUR_HORIZON: 1.0,
  /** Race deficit (s) at which we score 0 — being 1.5 s slower fades the cell to zero. */
  RACE_LOSS_HORIZON: 1.5,

  // ── Space normalisation ───────────────────────────────────────────────────
  /** Crowd-grid 3×3 sum at which `spaceQualityScore` saturates to 0. */
  SPACE_DENSITY_SAT: 30,

  // ── Final compression ─────────────────────────────────────────────────────
  /** Raw cell score that maps to compressed score 0.632 (matches PASS_STRONG_RAW = 1). */
  THROUGH_BALL_STRONG_RAW: 0.9,
  /** Top-N candidate cells surfaced for debug overlay / event payload. */
  MAX_CANDIDATES: 30,

  // ── Pass-error model (Phase 3) ────────────────────────────────────────────
  /** Yards — std-dev radius of landing-point Gaussian noise at passingSkill = 0. */
  MAX_THROUGH_BALL_ERROR: 3,

  // ── Phase 4 chase commit ──────────────────────────────────────────────────
  /** Maximum chasers committed per team. */
  MAX_CHASERS_PER_TEAM: 2,
  /** Threshold (seconds): a candidate's ETA must be within (bestEta + this) to commit. */
  ETA_HORIZON: 0.6,
  /** Minimum role chase weight to be eligible to commit at all. */
  ROLE_CHASE_THRESHOLD: 0.1,

  // ── Phase 5 loose-ball resolution ────────────────────────────────────────
  /** Yards — a player within this distance of the loose ball can pick it up. */
  LOOSE_BALL_TOUCH_RADIUS: .5,
  /** Yards — both arrivals within this AND on opposing teams → contested duel. */
  DUEL_RADIUS: 2.0,
  /** Yards — arrival gap below which we duel instead of clean pickup. */
  DUEL_GAP_TRIGGER: 1,

  // ── Loose-ball drift physics ─────────────────────────────────────────────
  /**
   * Yds/s — initial residual speed when the through ball lands. The ball keeps
   * trickling forward in the same direction so it never appears frozen mid-pitch.
   * Slow enough that a chasing attacker reaches it within a tick or two, but
   * visible enough to feel realistic.
   */
  LOOSE_BALL_INITIAL_SPEED: 4,
  /**
   * Yds/s² — friction-style deceleration applied each tick (real seconds).
   * From INITIAL_SPEED=4 with DECEL=2 the ball comes to rest in ~2 real seconds.
   */
  LOOSE_BALL_DECELERATION: 2,
} as const;

import type { PlayerRole } from '@/GameEngine/types';

/**
 * Per-role attacker chase weight — how willing this role is to abandon their
 * formation slot and sprint to a loose ball that they'd be the closest to.
 *
 * GK is 0 (never). Forwards are 1.0 (always). Defenders are very low.
 *
 * NOTE: These constants live here rather than in `roles.json` for now to keep
 * Phase 4 minimal. Phase 6 polish can promote them to JSON to match the
 * `defensiveIntentWeights` / `offBallIntentWeights` pattern.
 */
export const CHASE_LOOSE_BALL_WEIGHT_ATTACK: Record<PlayerRole, number> = {
  GK:  0.00,
  CB:  0.05,
  LB:  0.20, RB:  0.20,
  LWB: 0.30, RWB: 0.30,
  CDM: 0.30,
  CM:  0.55,
  CAM: 0.80,
  LM:  0.55, RM:  0.55,
  LW:  0.95, RW:  0.95,
  ST:  1.00,
};

/**
 * Per-role defender chase weight — how willing this role is to step out of
 * shape to win a loose ball in their zone (clear it / regain possession).
 *
 * GK is gated separately — only chases if the ball is inside their own box
 * (sweeper-keeper). See `commitLooseBallChasers` in gameState.ts.
 */
export const CHASE_LOOSE_BALL_WEIGHT_DEFEND: Record<PlayerRole, number> = {
  GK:  0.00, // gated by goal-area check at commit time
  CB:  0.95,
  LB:  0.85, RB:  0.85,
  LWB: 0.80, RWB: 0.80,
  CDM: 0.85,
  CM:  0.70,
  CAM: 0.40,
  LM:  0.55, RM:  0.55,
  LW:  0.30, RW:  0.30,
  ST:  0.10,
};
