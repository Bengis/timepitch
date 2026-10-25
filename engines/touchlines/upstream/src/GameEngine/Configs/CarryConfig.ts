/**
 * CarryConfig — all tunable weights and thresholds for carry lane evaluation.
 *
 * Edit only here to tune carry behaviour — no weights are hardcoded in
 * DecisionTree.ts or anywhere else in the engine.
 */

export const CARRY_CONFIG = {
  /** Yards ahead along the lane direction used for target crowding check. */
  LOOKAHEAD_DISTANCE: 10,
  /** Radius around the lane target position in which opponents count as crowding. */
  TARGET_CROWD_RADIUS: 8,
  /** Minimum total score a lane must reach for a carry to be chosen over a pass. */
  MIN_TOTAL_SCORE: 0.45,

  // ── Lane base score weights ──────────────────────────────────────────────
  CLEARANCE_WEIGHT:     0.40,
  PROGRESS_WEIGHT:      0.35,
  ANGLE_WEIGHT:         0.15,
  CROWD_PENALTY_WEIGHT: 0.30,

  // ── Player modifier weights ──────────────────────────────────────────────
  ROLE_BIAS_WEIGHT: 0.10,
  VISION_WEIGHT:    0.14,

  // ── Pressure thresholds / penalties ─────────────────────────────────────
  HARD_PRESSURE_DISTANCE:   4,   // yards — opponent this close = hard pressure
  MEDIUM_PRESSURE_DISTANCE: 8,   // yards — opponent this close = medium pressure
  HARD_PRESSURE_PENALTY:    0.40,
  MEDIUM_PRESSURE_PENALTY:  0.18,
  /** Maximum total pressure penalty (capped so stacking doesn't fully zero score). */
  MAX_PRESSURE_PENALTY:     0.65,

  // ── Vision modifier ──────────────────────────────────────────────────────
  /** Fraction by which high vision reduces the crowd penalty. */
  VISION_CROWD_REDUCTION: 0.25,

  // ── Role-fit penalty ─────────────────────────────────────────────────────
  /**
   * Score deducted per yard the projected lane target is outside the player's
   * role bounds. Penalises a CM carrying to 95 yds without hard-stopping them.
   * Clear-run-on-goal bypasses this — score is forced to 1.0 separately.
   */
  ROLE_FIT_PENALTY_SCALE: 0.05,

  // ── Byline penalty ───────────────────────────────────────────────────────
  /** Yards from the end line at which forward carry score starts decaying. */
  BYLINE_PENALTY_START: 10,
  /**
   * Maximum score penalty applied to a perfectly forward lane at the end line.
   * Lateral lanes (cross, cutback) are unaffected — only the forward component is penalised.
   */
  BYLINE_MAX_PENALTY: 0.8,

  // ── Clear run on goal ────────────────────────────────────────────────────
  /**
   * Lateral corridor width in yards. An outfield defender within this lateral
   * distance of the carrier — and ahead of them — blocks a clear run on goal.
   * Only the GK is allowed ahead without triggering a block.
   */
  CLEAR_RUN_CORRIDOR: 14,

  // ── Forward path clearness (crowd-grid based) ───────────────────────────
  /**
   * Number of grid rows on each side of the carrier's row to include in the
   * forward path scan. Total scanned band = 2 × FORWARD_PATH_ROW_BAND + 1 rows.
   * With CELL_H ≈ 1.85 yd at 64×40 resolution, a band of 4 ≈ ±7.5 yd vertical
   * corridor — covers a defender directly ahead plus immediate channel mates.
   */
  FORWARD_PATH_ROW_BAND: 4,
  /**
   * Defending-team density (sum across forward corridor cells) at which the
   * forward path is considered fully blocked → clearness = 0.
   *
   * One defender's full footprint sums to 4×2 + 12×1 + 20×0.5 = 30. When the
   * footprint sits entirely inside the scanned corridor, it contributes ~30 to
   * the density. Saturating at 30 means a single well-aligned defender fully
   * blocks the path; a defender at the edge of the corridor only contributes
   * the slice that overlaps, so partial blockers correctly produce a partial
   * clearness value rather than an all-or-nothing flip.
   */
  PATH_DENSITY_SATURATION: 30,
} as const;
