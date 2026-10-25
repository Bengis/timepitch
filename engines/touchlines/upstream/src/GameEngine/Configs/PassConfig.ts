/**
 * PassConfig — all tunable weights and thresholds for pass scoring.
 *
 * Edit only here to tune passing behaviour — no weights are hardcoded in
 * PassLanes.ts or anywhere else in the engine.
 *
 * Source of truth: .claude/rules/game-engine/pass.md
 */

export const PASS_CONFIG = {
  /** Minimum total score a candidate must reach to be considered a good pass. */
  MIN_PASS_SCORE: 0.39,

  // ── Base score weights ───────────────────────────────────────────────────
  // Positive weights sum to 1.0 so baseScore cannot exceed 1.0.
  // Ratios preserved from original (7 : 6 : 4 : 6).
  PROGRESS_WEIGHT:         0.30,
  LANE_WEIGHT:             0.26,
  RECEIVER_SPACE_WEIGHT:   0.18,
  DISTANCE_PENALTY_WEIGHT: 0.13,
  GOAL_PROXIMITY_WEIGHT:   0.26,

  // ── Player modifier weights ──────────────────────────────────────────────
  PASSING_SKILL_WEIGHT:    0.15,
  VISION_WEIGHT:           0.15,
  RECEIVER_CONTROL_WEIGHT: 0.10,

  // ── Spatial preference (width) ───────────────────────────────────────────
  WIDTH_PREFERENCE_WEIGHT: 0.15,

  // ── Internal scoring constants ───────────────────────────────────────────
  /** Yards — a pass this far or longer gets the maximum distance penalty. */
  MAX_PASS_DISTANCE: 50,
  /**
   * Yards — perpendicular clearance at which a lane is fully open.
   * Below BLOCK_RADIUS → blocked; above CLEAR_RADIUS → fully open.
   */
  BLOCK_RADIUS: 3.0,
  CLEAR_RADIUS: 7.0,
  /** Yards — opponents within this radius around the receiver count as pressure. */
  RECEIVER_SPACE_RADIUS: 8,

  /**
   * Soft horizon for the goal-proximity score. Replaces the old hard cliff at
   * `PITCH_LENGTH/3`. Inside this distance a quadratic ramp rewards proximity
   * to goal; beyond it the bonus is 0. Wider value = softer cliff.
   *
   * 55 yds reaches roughly the halfway-line area when shooting at the far goal,
   * so a pass into space at x=74 (Team A) — previously zero-credited — now gets
   * partial goal threat. See `getGoalProximityBonus` in PassLanes.ts and
   * `goalThreatScore` in ThroughBallCells.ts.
   */
  GOAL_PROXIMITY_HORIZON: 55,

  /**
   * Exponent for proportional target selection in startPass().
   * Scores are raised to this power before weighted random roll.
   * Higher = stronger bias toward the top lane; lower = more even distribution.
   * 3 → [0.9,0.4,0.3] gives ~89/8/3%; [0.9,0.8,0.7] gives ~46/32/22%.
   */
  PASS_SELECTION_EXPONENT: 3,
} as const;
