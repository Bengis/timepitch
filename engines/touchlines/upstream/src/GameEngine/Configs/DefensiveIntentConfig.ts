/**
 * DefensiveIntentConfig — static constants for scored defensive intent selection.
 * Analogous to OffBallConfig.ts for the attacking side.
 */
import type { PressingStyle, DefensiveLine } from '@/types/tacticsTypes';

type DefIntentKey = 'hold_shape' | 'track_mark' | 'press_holder' | 'step_into_carry_lane';
type DefIntentMultMap = Record<DefIntentKey, number>;

export const INTENT_PRESSING_STYLE: Record<PressingStyle, DefIntentMultMap> = {
  low_block:  { hold_shape: 1.4, track_mark: 1.2, press_holder: 0.3, step_into_carry_lane: 0.6 },
  mid_block:  { hold_shape: 1.0, track_mark: 1.0, press_holder: 1.0, step_into_carry_lane: 1.0 },
  high_press: { hold_shape: 0.5, track_mark: 0.8, press_holder: 1.8, step_into_carry_lane: 1.2 },
};

export const INTENT_DEFENSIVE_LINE: Record<DefensiveLine, DefIntentMultMap> = {
  deep:   { hold_shape: 1.3, track_mark: 1.2, press_holder: 0.6, step_into_carry_lane: 1.1 },
  normal: { hold_shape: 1.0, track_mark: 1.0, press_holder: 1.0, step_into_carry_lane: 1.0 },
  high:   { hold_shape: 0.7, track_mark: 0.9, press_holder: 1.4, step_into_carry_lane: 0.9 },
};

export const DEFENSIVE_INTENT_CONFIG = {
  /**
   * Lateral distance used to decide if the ball carrier is in this defender's
   * general zone — drives holderInMyCorridor and the step_into_carry_lane penalty.
   * Wide enough to cover a defender's zone of responsibility (~1.5 pitch lanes).
   */
  CORRIDOR_HALF_WIDTH:         12,    // yds — lateral width for holderInMyCorridor
  /**
   * Narrower threshold for isBlockingCarryLane — the defender must be literally
   * in the carry path (goal-side AND laterally close) to hand off from
   * step_into_carry_lane to press_holder.
   */
  CARRY_BLOCK_WIDTH:           6,     // yds — lateral width for isBlockingCarryLane
  CARRY_LANE_LOOKAHEAD:        15,    // yds — how far ahead to project holder's path
  PRESS_SCORE_THRESHOLD:       0.35, // minimum press_holder score to trigger press
  /**
   * Within this distance a defender presses regardless of mark assignment.
   * Prevents abandoning a chase when already right next to the ball holder
   * due to the greedy mark-reassignment algorithm stealing the "holder is my mark"
   * condition mid-pursuit.
   */
  OPPORTUNISTIC_PRESS_RANGE:   6,    // yds
  /**
   * At full patience (patienceT=1), the opportunistic press range grows by this
   * many yards, letting more defenders become eligible to press even when the
   * holder isn't their assigned mark.
   * effectiveRange = OPPORTUNISTIC_PRESS_RANGE + patienceT² × this
   */
  PATIENCE_OPPORTUNISTIC_BONUS: 20,  // yds
  /**
   * Patience effects (press boost, shape penalty, opportunistic range expansion)
   * fade linearly to zero at this distance from the ball holder.
   * Defenders beyond this radius keep their shape regardless of how long the
   * opponent has held the ball.
   */
  PATIENCE_INFLUENCE_RADIUS:   25,  // yds
  /**
   * Press catchability falloff distance (yards). When the defender's projection
   * onto the holder→goal axis is this many yards BEHIND the holder, press_holder
   * eligibility falls to PRESS_CATCHABILITY_FLOOR. Defenders ahead of the holder
   * (positive projection) keep full eligibility — they can intercept the path.
   * Defenders behind cannot catch a forward-moving carrier and shouldn't press.
   */
  PRESS_CATCHABILITY_FALLOFF:  5,    // yds
  /** Floor multiplier for defenders far behind the holder along the progression axis. */
  PRESS_CATCHABILITY_FLOOR:    0.10,
} as const;

/**
 * Possession patience — how long the defending team tolerates the opponent holding
 * the ball before time-pressure boosts pressing and erodes hold_shape.
 *
 * The influence ramps as t² (quadratic), so the effect is slow to start and
 * accelerates the longer possession goes on. The existing intent scores already
 * encode how dangerous the situation is — a high hold_shape score will naturally
 * resist the time boost longer than a weak one.
 */
export const POSSESSION_PATIENCE = {
  /** Seconds until the quadratic ramp reaches t=1 (full effect). */
  BASE_SECONDS:          15,
  /** Maximum boost applied to press_holder score at t=1. */
  PRESS_BOOST_MAX:       0.8,
  /** Maximum reduction applied to hold_shape score at t=1. */
  SHAPE_PENALTY_MAX:     0.4,
} as const;

/**
 * Press intent: small role/tactic weights need a modest scale to matter vs track_mark.
 * Keep INTENT_SCALE low enough that track_mark / carry_lane can still win.
 */
export const PRESS_HOLDER_SCORING = {
  /** Weak at outer edge of press range — must close distance for a strong press score. */
  DISTANCE_AT_EDGE:   0.12,
  DISTANCE_ON_HOLDER: 1.0,
  /** Brings press into same ballpark as other intents (order of magnitude ~1–8). */
  INTENT_SCALE:       2,
} as const;

/**
 * Crowd-grid driven defensive adjustments.
 *
 * Two signals from the per-tick crowd grid power these:
 *  • pressLoad        — defending team density sampled around the ball holder.
 *                       High = swarm forming; cap who else commits to pressing.
 *  • markIsolation    — 1 minus attacking team density around an opponent.
 *                       High = lone attacker; mark them — they're a real threat.
 *  • markDangerScore  — markIsolation × markThreat (0..1).
 *                       Drives both track_mark score boost and assignment discount.
 */
export const CROWD_AWARE_DEFENSE = {
  // ── Press saturation ─────────────────────────────────────────────────────
  /**
   * Pressers above this 3×3 crowd-sample value (≈ 1.5 defenders near holder)
   * trigger damping for further-away defenders. The closest one keeps full
   * score regardless — there must always be at least one presser.
   */
  PRESS_SAT_THRESHOLD:    25,
  /** Approx 3×3 crowd contribution per nearby player — used to convert sample → count. */
  PRESS_SAT_PER_PLAYER:   17,
  /** Per excess defender, max fraction of press_holder/step score removed (at full distance). */
  PRESS_SAT_DAMP_PER:     0.40,
  /** Floor multiplier — even fully oversaturated and far away, score keeps this much. */
  PRESS_SAT_FLOOR:        0.20,

  // ── Effective press load (replaces raw crowd-grid sample for saturation) ─
  /** Radius (yds) within which a teammate can contribute to press load. */
  PRESS_LOAD_RADIUS:           8,
  /** Yards goal-side of the holder at which along-goal effectiveness saturates to 1. */
  PRESS_LOAD_ALONG_FULL:       6,
  /** Yards perpendicular to the holder→own-goal line at which effectiveness drops to 0. */
  PRESS_LOAD_LATERAL_RANGE:    8,
  /**
   * Score added by a single perfectly-effective presser at point-blank range.
   * Calibrated to match PRESS_SAT_PER_PLAYER so PRESS_SAT_THRESHOLD keeps its meaning.
   */
  PRESS_LOAD_PER_PLAYER:       17,

  // ── Mark danger / isolation ─────────────────────────────────────────────
  /** Max boost added to track_mark score for a fully dangerous + isolated mark. */
  MARK_DANGER_BOOST_MAX:  0.50,
  /**
   * Below this attacker-crowd "extra" value (over self ≈ 17), the mark is
   * considered fully isolated. At 1.5× this value the mark is fully crowded.
   */
  ISOLATION_FULL_RANGE:   25,

  // ── Mark assignment ─────────────────────────────────────────────────────
  /**
   * Squared-yards of cost reduction at full danger (markDangerScore = 1).
   * Equivalent to a defender being able to be ~9 yds farther from a
   * dangerous opponent and still preferring them over a safer closer one.
   */
  ASSIGN_DANGER_DISCOUNT: 80,
} as const;
