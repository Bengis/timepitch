/**
 * DefensivePositioning — target-position computation for players when their team
 * does NOT have the ball.
 *
 * Influences applied (in order):
 *   1. Formation slot for the defending phase (base anchor)
 *   2. Defensive line height — shift block forward (high line) or back (deep)
 *   3. Block shift — entire defensive shape slides toward the ball's Y
 *   4. Horizontal compactness — squeeze toward pitch centre
 *   5. Lane blocking — nudge toward the corridor between ball and own goal
 *   6. Intent-scored positioning — hold_shape / track_mark / press_holder (only if
 *      the ball holder is this defender's mark and within effective press range:
 *      base `pressRange` + team pressing_style ±4 yds) /
 *      step_into_carry_lane
 *
 * No side effects. No gameState imports (avoids circular deps).
 */

import type { GamePlayer, Formation, TeamId, TeamIntent } from '@/GameEngine/types';
import { resolveBasePosition } from '@/GameEngine/FormationSlots';
import { getDefenseConfig, getDefenseTacticKeys } from '@/GameEngine/Configs/DefenseConfig';
import type { DefenseConfigValues } from '@/GameEngine/Configs/DefenseConfig';
import { roleEngine } from '@/GameEngine/Domain/roleEngineData';
import { isDebugEnabled } from '@/GameEngine/Suport/DebugLog';
import { gameBus } from '@/GameEngine/Infrastructure/EventBus';
import {
  INTENT_PRESSING_STYLE,
  INTENT_DEFENSIVE_LINE,
  DEFENSIVE_INTENT_CONFIG,
  PRESS_HOLDER_SCORING,
  POSSESSION_PATIENCE,
  CROWD_AWARE_DEFENSE,
} from '@/GameEngine/Configs/DefensiveIntentConfig';
import { getPressingStyleOverride } from '@/GameEngine/Configs/IntentConfig';
import { sampleCellSumExcluding, type CrowdGrid, type GridMatrix } from '@/GameEngine/Infrastructure/CrowdGrid';
import { PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX } from '@/GameEngine/Domain/pitch';
import { GK_MIN_COME_OUT, GK_MAX_COME_OUT, GK_COME_OUT_DIST } from '@/GameEngine/Infrastructure/ActionOutcomes';
import type { PressingStyle } from '@/types/tacticsTypes';

const PITCH_CENTER_Y = 37;

/** Added to `player.runtimeStats.withoutBall.pressRange` from team `pressing_style`. */
const PRESS_RANGE_TACTIC_DELTA_YARDS: Record<PressingStyle, number> = {
  low_block:  -4,
  mid_block:  0,
  high_press: 4,
};

/**
 * Intent-aware pressing style: returns the team's static `pressing_style` tactic
 * key, or the intent's override when one is set (e.g. counter_attack defending
 * intent → high_press). Single source of truth for both intent-multiplier
 * lookup and effective press range.
 */
export function effectivePressingStyle(team: TeamId, intent: TeamIntent): PressingStyle {
  const baseStyle = getDefenseTacticKeys(team).pressingStyle;
  return getPressingStyleOverride(intent) ?? baseStyle;
}

/**
 * Yards a position lies outside a rectangular zone (0 if inside).
 * Used by both intent scoring and mark assignment to express bounds as a soft
 * cost rather than a hard wall.
 */
function outOfZoneDistance(
  pos: { x: number; y: number },
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): number {
  const dx = Math.max(0, bounds.minX - pos.x, pos.x - bounds.maxX);
  const dy = Math.max(0, bounds.minY - pos.y, pos.y - bounds.maxY);
  return Math.hypot(dx, dy);
}

/**
 * Base roster `pressRange` plus team pressing instruction (see DefenseConfig
 * tactic keys), with the active team intent layered on top so a counter_attack
 * team can dynamically widen press range when their intent fires defensively.
 *
 * `intent` defaults to 'balanced' so legacy callers (e.g. tests) keep their
 * previous static behaviour without having to thread the intent through.
 */
export function effectivePressRange(player: GamePlayer, intent: TeamIntent = 'balanced'): number {
  const base = player.runtimeStats.withoutBall.pressRange;
  const pressingStyle = effectivePressingStyle(player.team, intent);
  return base + PRESS_RANGE_TACTIC_DELTA_YARDS[pressingStyle];
}

/** Last-computed defensive intent per player id — written each tick, read by computeDefensivePosition. */
const _intentCache: Record<number, DefensiveIntent> = {};

/**
 * Ball-relative depth system:
 *
 * DEPTH_OFFSET_BASE  — minimum yards behind the ball (high press / high line)
 * DEPTH_OFFSET_RANGE — extra yards added for the deepest setting
 *   deep   (DLH=0.40): offset ≈ 34 yards behind ball
 *   normal (DLH=0.60): offset ≈ 26 yards behind ball
 *   high   (DLH=0.75): offset ≈ 20 yards behind ball
 */
const DEPTH_OFFSET_BASE  = 10;
const DEPTH_OFFSET_RANGE = 40;
const X_TRACK_WEIGHT     = 0.6;

// Minimum distance to mark before "too far" urgency kicks in
const MARK_FAR_DISTANCE = 15; // yards

// ── Soft-zone constants ──────────────────────────────────────────────────────
// Bounds are tactical zone-of-responsibility, not physical reach. They steer
// behaviour through scoring penalties (here) and the assignment cost (below),
// but never hard-stop a defender from following a mark that demands it.

// At this distance outside their bounds a low-threat mark fully discounts
// `track_mark` (defender prefers `hold_shape`). High-threat marks override
// this regardless of how far out of zone they are.
const OUT_OF_ZONE_RANGE = 15; // yards

// Maximum fraction of the track_mark score removed by the out-of-zone penalty
// (when the mark is at full OUT_OF_ZONE_RANGE and threat is 0).
const OUT_OF_ZONE_PENALTY_MAX = 0.5;

// Soft cost added to mark-assignment distance², so the *closest* defender still
// claims a dropping mark, but ties break toward the defender whose zone fits.
// Applied as `outOfZoneDist² * weight` (same units as distance²).
const ASSIGN_ZONE_COST_WEIGHT = 0.5;


// Pass reach: within this distance from holder the mark is a live threat
const MARK_PASS_REACH = 25; // yards

// Front-defender detection thresholds
const FRONT_DEF_LATERAL_LIMIT = 25; // yards — teammate must be within this Y-distance of holder
const FRONT_DEF_DEPTH_LIMIT   = 40; // yards — teammate must be within this X-distance ahead of holder

// ── Exported types ─────────────────────────────────────────────────────────────

export type DefensiveIntent =
  | 'hold_shape'
  | 'track_mark'
  | 'press_holder'
  | 'step_into_carry_lane';

// ── Internal context ───────────────────────────────────────────────────────────

interface DefensiveIntentContext {
  player: GamePlayer;
  ballHolder: GamePlayer | null;
  markTarget: GamePlayer | null;
  shapeAnchor: { x: number; y: number };
  cfg: DefenseConfigValues;
  allPlayers: GamePlayer[];
  /** `null` when built without formation (e.g. decision tick). */
  formation: Formation | null;
  ballPos: { x: number; y: number };
  ownGoalX: number;
  /** This player's team intent — drives effective pressing_style overrides. */
  teamIntent: TeamIntent;
  distToHolder: number;
  distToMark: number;
  holderThreat: number;
  markThreat: number;
  holderInMyCorridor: boolean;
  canGetGoalSideOfHolder: boolean;
  /**
   * 0..1 — how much goal-side coverage the carrier already faces.
   * Includes this player themselves; rises as more defenders are in front.
   * 0 = no one between carrier and goal → step-in urgency high.
   * 1 = well-covered from the front → urgency drops, switch to track/press.
   */
  frontBlocker: number;
  // Local mark quality signals
  markIsGoalSideDanger: boolean; // mark has gotten goal-side of this defender
  markIsPassReachable: boolean;  // mark is within passing reach of holder
  markDistFactor: number;        // 0..1, rises when defender is too far from mark
  carryLaneUrgency: number;      // 0..1 composite danger of the ball carrier penetrating
  /** True when this defender is already goal-side of the carrier AND within the
   *  lateral corridor — i.e. physically blocking the carry path. Phase 2: press. */
  isBlockingCarryLane: boolean;
  rolePressBias: number;
  roleCarryLaneBias: number;
  roleMarkBias: number;
  /**
   * Crowd-grid sample of defending team's outfield density around the ball
   * holder. Above CROWD_AWARE_DEFENSE.PRESS_SAT_THRESHOLD, additional pressers
   * get progressively damped to stop the swarm. The closest defender to the
   * holder is unaffected (damping scales with `distToHolder`).
   *
   * Direction-agnostic — every nearby teammate counts. Used by the general
   * press-saturation factor for press_holder and shape decisions.
   */
  pressLoad: number;
  /**
   * Direction-aware variant of pressLoad. Each teammate's contribution is
   * scaled by their press effectiveness — defenders behind the holder or
   * laterally off the holder→goal corridor contribute ~0. Used ONLY by the
   * step_into_carry_lane scorer, where the question isn't "is the holder
   * crowded?" but "is the carry path actually being blocked already?".
   */
  effectivePressLoad: number;
  /**
   * 0..1 — combined threat × isolation score for this defender's mark target.
   * 0   = no mark, or safe / well-covered mark.
   * 1   = lone attacker close to our goal — must be marked.
   * Used to boost track_mark score so dangerous marks beat hold_shape.
   */
  markDangerScore: number;
}

/** Role weights for the five defensive intents (from `roleEngine` / roles data). */
interface DefensiveIntentWeights {
  hold_shape: number;
  track_mark: number;
  press_holder: number;
  step_into_carry_lane: number;
}

/** Per-intent multipliers from pressing_style and defensive_line tactics. */
interface IntentTacticMult {
  hold_shape: number;
  track_mark: number;
  press_holder: number;
  step_into_carry_lane: number;
}

// Defenders pick first, then midfielders, then forwards.
const MARK_ROLE_PRIORITY: Record<string, number> = {
  Defender: 0, Midfielder: 1, Forward: 2,
};

/**
 * Greedy 1:1 mark assignment for a defending team.
 *
 * Defenders pick in defensive-role order (CBs first, then fullbacks, then mids).
 * Each defender is assigned their nearest unassigned opponent.
 * This prevents CBs from being dragged across the pitch to mark the opposing
 * team's deep defenders — CBs stay near their natural zone and claim whoever
 * is closest to them there, leaving the attacking players for the mids.
 */
export function assignMarkTargets(
  allPlayers: GamePlayer[],
  defendingTeam: TeamId,
  crowdGrid: CrowdGrid | null = null,
): Map<number, number> {
  const defenders = allPlayers.filter(p => p.team === defendingTeam && p.role !== 'GK');
  const opponents = allPlayers.filter(p => p.team !== defendingTeam && p.role !== 'GK');

  if (defenders.length === 0 || opponents.length === 0) return new Map();

  // Per-opp danger from crowd-aware threat × isolation. Computed once, used in
  // greedy + swap-improve. Empty fallback when no grid → all opps neutral.
  const oppDangerById = new Map<number, number>();
  {
    const cfg              = getDefenseConfig(defendingTeam);
    const defAttackDir     = defenders[0]!.attackDir;
    const defGoalX         = defAttackDir === 1 ? 0 : PITCH_LENGTH;
    const attackerOutfield = crowdGrid
      ? (defendingTeam === 'A' ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield)
      : null;
    for (const opp of opponents) {
      oppDangerById.set(opp.id, computeOppDanger(opp, defGoalX, cfg.THREAT_HORIZON, attackerOutfield));
    }
  }

  // Sort defenders by main-role priority so back-line picks before mids/forwards
  const sortedDefenders = [...defenders].sort((a, b) => {
    const pa = MARK_ROLE_PRIORITY[a.mainRole] ?? 9;
    const pb = MARK_ROLE_PRIORITY[b.mainRole] ?? 9;
    return pa - pb;
  });

  const assignments = new Map<number, number>();
  const assignedOpps = new Set<number>();

  for (const def of sortedDefenders) {
    // Assign this defender to their nearest unassigned opponent — with a soft
    // zone-fit bias and a danger discount so dangerous, isolated, near-goal
    // attackers attract a defender even if a closer / safer opp is available.
    let bestOppId = -1;
    let bestCost  = Infinity;
    for (const opp of opponents) {
      if (assignedOpps.has(opp.id)) continue;
      const cost = markAssignmentCost(def, opp, oppDangerById.get(opp.id) ?? 0);
      if (cost < bestCost) {
        bestCost  = cost;
        bestOppId = opp.id;
      }
    }

    if (bestOppId !== -1) {
      assignments.set(def.id, bestOppId);
      assignedOpps.add(bestOppId);
    }
  }

  // Swap-improve: if swapping any two defenders' marks reduces total distance, do it.
  // Converges in one pass for most real situations (rarely needs more than one).
  //
  // Hard pass cap: 2-opt on n=10 defenders converges in O(n²) ≈ 100 swaps in the
  // worst case. A cap of MAX_SWAP_PASSES=20 is ample — if we hit it, we accept the
  // current assignment (still valid, just sub-optimal). This prevents any chance
  // of an infinite loop from floating-point pathology or NaN propagation.
  const playerById = new Map(allPlayers.map(p => [p.id, p]));
  const defIds = [...assignments.keys()];
  const MAX_SWAP_PASSES = 20;
  let improved = true;
  let passCount = 0;
  // Track best-so-far cost so improvements must actually strictly decrease
  // total cost (not just pair cost). Robust against weird float edge cases.
  let bestCost = computeAssignmentCost(assignments, playerById, defIds, oppDangerById);
  while (improved && passCount < MAX_SWAP_PASSES) {
    improved = false;
    passCount++;
    for (let i = 0; i < defIds.length; i++) {
      for (let j = i + 1; j < defIds.length; j++) {
        const defA = playerById.get(defIds[i])!;
        const defB = playerById.get(defIds[j])!;
        const oppAId = assignments.get(defIds[i])!;
        const oppBId = assignments.get(defIds[j])!;
        const oppA = playerById.get(oppAId)!;
        const oppB = playerById.get(oppBId)!;

        // Danger discount is opp-only and each opp appears once on each side
        // of the swap → it cancels out, so we omit it here for cheaper math.
        const currentCost = markAssignmentCost(defA, oppA) + markAssignmentCost(defB, oppB);
        const swappedCost = markAssignmentCost(defA, oppB) + markAssignmentCost(defB, oppA);

        // Require a minimum improvement to avoid oscillation from float noise.
        // 1e-6 yards² is ~1 micrometer — orders of magnitude below gameplay scale.
        if (swappedCost < currentCost - 1e-6) {
          assignments.set(defIds[i], oppBId);
          assignments.set(defIds[j], oppAId);
          improved = true;
        }
      }
    }
    // Global invariant: total assignment cost must strictly decrease each pass.
    // If it doesn't, bail out — something is off (NaN positions, degenerate input).
    const newCost = computeAssignmentCost(assignments, playerById, defIds, oppDangerById);
    if (!(newCost < bestCost - 1e-6)) break;
    bestCost = newCost;
  }

  return assignments;
}

/**
 * Pair-cost for mark assignment: squared distance + soft zone-fit term −
 * danger discount.
 *
 * `outOfZoneDist²` is in yard² same as distance² — `ASSIGN_ZONE_COST_WEIGHT`
 * scales how much one yard out of zone "costs" relative to one yard of
 * physical distance. The closest defender still wins for big distance
 * differences; zone-fit only flips the choice when distances are similar.
 *
 * `oppDanger` (0..1) reduces the cost so dangerous, isolated, near-goal
 * opponents are picked first by greedy assignment. The discount is
 * opp-only (same regardless of defender), so it does not change swap-improve
 * dynamics — only the order in which opponents get claimed.
 */
function markAssignmentCost(def: GamePlayer, opp: GamePlayer, oppDanger = 0): number {
  const dx       = def.x - opp.x;
  const dy       = def.y - opp.y;
  const distSq   = dx * dx + dy * dy;
  const outDist  = outOfZoneDistance(opp, def.bounds);
  return distSq
    + outDist * outDist * ASSIGN_ZONE_COST_WEIGHT
    - oppDanger * CROWD_AWARE_DEFENSE.ASSIGN_DANGER_DISCOUNT;
}

/** Total cost of the current mark assignment (sum of pair costs). */
function computeAssignmentCost(
  assignments: Map<number, number>,
  playerById:  Map<number, GamePlayer>,
  defIds:      number[],
  oppDangerById: Map<number, number>,
): number {
  let total = 0;
  for (const defId of defIds) {
    const def = playerById.get(defId);
    const oppId = assignments.get(defId);
    if (oppId === undefined) continue;
    const opp = playerById.get(oppId);
    if (!def || !opp) continue;
    total += markAssignmentCost(def, opp, oppDangerById.get(opp.id) ?? 0);
  }
  return total;
}

/**
 * Per-opponent dangerousness signal — combines proximity to defending goal
 * (threat) with isolation from other attackers (lone runner = real danger).
 *
 * Returns 0..1. Used to (1) reduce mark-assignment cost so dangerous opps
 * are picked first, and (2) boost track_mark intent score for the assigned
 * defender so they push past hold_shape / nearby press alternatives.
 */
function computeOppDanger(
  opp: GamePlayer,
  defendingTeamGoalX: number,
  threatHorizon: number,
  attackerOutfield: GridMatrix | null,
): number {
  const distFromOwnGoal = Math.abs(opp.x - defendingTeamGoalX);
  const threat = Math.max(0, 1 - distFromOwnGoal / threatHorizon);
  if (threat <= 0) return 0;

  let isolation = 0.5; // neutral when no grid available
  if (attackerOutfield) {
    // Exact self-subtraction — opp's own footprint depends on subcell offset,
    // so the constant SAMPLE_PER_PLAYER_3x3 was a coarse approximation.
    const extra = sampleCellSumExcluding(attackerOutfield, opp.x, opp.y, opp.x, opp.y, 1);
    isolation   = Math.max(0, 1 - extra / CROWD_AWARE_DEFENSE.ISOLATION_FULL_RANGE);
  }
  return threat * isolation;
}

// ── Phase 1: Shape Anchor ──────────────────────────────────────────────────────

/**
 * Compute the raw defensive shape anchor for a player — formation slot + block
 * shift + compactness + lane blocking. Returns un-clamped raw coordinates.
 */
export function computeDefensiveShapeAnchor(
  player: GamePlayer,
  ballPos: { x: number; y: number },
  formation: Formation,
  cfg: DefenseConfigValues,
): { x: number; y: number } {
  const base = resolveBasePosition(player.slotIndex, player.attackDir, formation, 'defending');
  const ownGoalX = player.attackDir === 1 ? 0 : PITCH_LENGTH;

  let rawX = base.x;

  // ── X: defensive line tracks the ball depth — driven by tactic only ─────
  if (player.role !== 'GK') {
    const depthOffset = (1.0 - cfg.DEFENSIVE_LINE_HEIGHT) * DEPTH_OFFSET_RANGE + DEPTH_OFFSET_BASE;

    // Scale depth offset by how far the ball is from our own goal.
    // When the ball is near our goal there is no space to give — stay compact.
    // When the ball is far away the full tactical offset applies.
    const distBallFromOwnGoal = Math.abs(ballPos.x - ownGoalX);
    const ballDistScale = Math.min(1, distBallFromOwnGoal / 55);
    const scaledDepthOffset = depthOffset * ballDistScale;

    const ballLineX = ballPos.x - player.attackDir * scaledDepthOffset;
    rawX += (ballLineX - rawX) * X_TRACK_WEIGHT;
  }

  // ── Y: block shifts laterally with ball ─────────────────────────────────
  const blockShiftY = (ballPos.y - base.y)
    * cfg.BLOCK_SHIFT_WEIGHT
    * 0.15;
  let rawY = base.y + blockShiftY;

  // ── Y: horizontal compactness — squeeze toward pitch center ─────────────
  rawY += (PITCH_CENTER_Y - rawY) * cfg.HORIZONTAL_COMPACTNESS * 0.12;

  // ── X: lane blocking — nudge toward space between ball and own goal ─────
  const ballSide = ballPos.x - ownGoalX;
  if (Math.abs(ballSide) > 0.1) {
    const laneTarget = ownGoalX + ballSide * 0.7;
    rawX += (laneTarget - rawX) * cfg.LANE_BLOCK_WEIGHT * 0.15;
  }

  return { x: rawX, y: rawY };
}

// ── Phase 2: Track/Mark Target ─────────────────────────────────────────────────

/**
 * Compute the blended mark + lane-cut target when the player is tracking a
 * marked opponent.
 *
 * Changes vs original:
 * - Non-linear threat curve so medium threat engages defenders earlier.
 * - Extra pull when defender is too far from mark (urgency to close).
 */
export function computeTrackMarkTarget(
  shapeAnchor: { x: number; y: number },
  player: GamePlayer,
  ballHolder: GamePlayer,
  markTarget: GamePlayer,
  cfg: DefenseConfigValues,
): { x: number; y: number; threat: number; pull: number } {
  const ownGoalX = player.attackDir === 1 ? 0 : PITCH_LENGTH;
  const distFromOwnGoal = Math.abs(markTarget.x - ownGoalX);
  const threat = Math.max(0, 1 - distFromOwnGoal / cfg.THREAT_HORIZON);

  // Non-linear curve: more response at medium threat, less waiting for full danger.
  // threat=0.3 → curved≈0.41; threat=0.5 → curved≈0.65; threat=0.7 → curved≈0.84
  const threatCurved = 1 - Math.pow(1 - threat, 1.5);

  const laneT = cfg.MARK_LANE_T_FAR + (cfg.MARK_LANE_T_CLOSE - cfg.MARK_LANE_T_FAR) * threatCurved;
  const laneX = ballHolder.x + (markTarget.x - ballHolder.x) * laneT;
  const laneY = ballHolder.y + (markTarget.y - ballHolder.y) * laneT;

  const targetX = markTarget.x + (laneX - markTarget.x) * threat;
  const targetY = markTarget.y + (laneY - markTarget.y) * threat;

  let pull = cfg.MARK_PULL_MIN + (cfg.MARK_PULL_MAX - cfg.MARK_PULL_MIN) * threatCurved;

  // Urgency boost when defender has drifted too far from their mark
  const markDist = Math.hypot(markTarget.x - player.x, markTarget.y - player.y);
  if (markDist > MARK_FAR_DISTANCE) {
    pull = Math.min(cfg.MARK_PULL_MAX, pull * 1.3);
  }

  const rawX = shapeAnchor.x + (targetX - shapeAnchor.x) * pull;
  const rawY = shapeAnchor.y + (targetY - shapeAnchor.y) * pull;

  return { x: rawX, y: rawY, threat, pull };
}

// ── Phase 7: Carry Lane Intercept ──────────────────────────────────────────────

function computeCarryLaneIntercept(
  player: GamePlayer,
  ballHolder: GamePlayer,
  ownGoalX: number,
  lookahead: number,
): { x: number; y: number } {
  const goalDx = ownGoalX - ballHolder.x;
  const dist = Math.abs(goalDx);
  if (dist < 0.01) return { x: ballHolder.x, y: ballHolder.y };

  const ndx = goalDx / dist;

  // Project lookahead yards along the carry path toward own goal
  const projX = ballHolder.x + ndx * lookahead;
  const projY = ballHolder.y; // central carry assumed

  // Blend 70% projected point, 30% player's Y to avoid lateral extremes
  return {
    x: projX,
    y: projY * 0.7 + player.y * 0.3,
  };
}

// ── Context helpers ─────────────────────────────────────────────────────────────

/**
 * How much front coverage the ball carrier already faces from teammates (0..1).
 * Does NOT include the player themselves — this measures "are other defenders
 * already covering the run?" driving urgency for this player to step in.
 *
 * The transition "I've already arrived → switch to track/press" is handled
 * separately via `selfIsGoalSide` in the scorer.
 *
 * 0   = no teammates in front → carrier has a free run.
 * 0.5 = one teammate in front → partial coverage.
 * 1   = two or more teammates in front → well-covered.
 */
function computeFrontBlocker(
  player: GamePlayer,
  ballHolder: GamePlayer,
  allPlayers: GamePlayer[],
): number {
  const count = allPlayers.filter(p => {
    if (p.team !== player.team) return false;
    if (p.role === 'GK') return false;
    if (p.id === player.id) return false; // exclude self — use selfIsGoalSide for that

    const isGoalSide = player.attackDir === 1
      ? p.x < ballHolder.x
      : p.x > ballHolder.x;
    if (!isGoalSide) return false;

    const lateralDist = Math.abs(p.y - ballHolder.y);
    if (lateralDist > FRONT_DEF_LATERAL_LIMIT) return false;

    const depth = Math.abs(p.x - ballHolder.x);
    if (depth > FRONT_DEF_DEPTH_LIMIT) return false;

    return true;
  }).length;

  // 0 teammates → 0, 1 → 0.5, 2+ → 1.0
  return Math.min(1, count / 2);
}

/**
 * Composite carry-lane urgency signal.
 * 0 = holder is no real immediate threat for this defender.
 * 1 = full emergency — step into carry lane, abandon mark tracking.
 *
 * `frontBlocker` (0..1, teammates only) reduces urgency when others are
 * already covering the run. The self-transition (I've arrived goal-side)
 * is handled directly inside scoreStepIntoCarryLaneIntent via selfIsGoalSide.
 */
function computeCarryLaneUrgency(
  holderThreat: number,
  holderInMyCorridor: boolean,
  frontBlocker: number,
  canGetGoalSideOfHolder: boolean,
): number {
  let urgency = holderThreat * 0.35;
  if (holderInMyCorridor) urgency += 0.25;
  // Inversely proportional to front coverage: 0 blockers → full +0.70; fully covered → 0.
  urgency += (1 - frontBlocker) * 0.70;
  if (canGetGoalSideOfHolder) urgency += 0.10;
  return Math.min(1, urgency);
}

// ── Phase 3: Intent Context Builder ───────────────────────────────────────────

function buildDefensiveIntentContext(
  player: GamePlayer,
  ballHolder: GamePlayer | null,
  markTarget: GamePlayer | null,
  allPlayers: GamePlayer[],
  formation: Formation | null,
  ballPos: { x: number; y: number },
  cfg: DefenseConfigValues,
  crowdGrid: CrowdGrid | null,
  teamIntent: TeamIntent,
): DefensiveIntentContext {
  const ownGoalX = player.attackDir === 1 ? 0 : PITCH_LENGTH;
  const shapeAnchor = formation
    ? computeDefensiveShapeAnchor(player, ballPos, formation, cfg)
    : { x: player.x, y: player.y };

  const distToHolder = ballHolder
    ? Math.hypot(ballHolder.x - player.x, ballHolder.y - player.y)
    : Infinity;
  const distToMark = markTarget
    ? Math.hypot(markTarget.x - player.x, markTarget.y - player.y)
    : Infinity;

  const holderThreat = ballHolder
    ? Math.max(0, 1 - Math.abs(ballHolder.x - ownGoalX) / cfg.THREAT_HORIZON)
    : 0;
  const markThreat = markTarget
    ? Math.max(0, 1 - Math.abs(markTarget.x - ownGoalX) / cfg.THREAT_HORIZON)
    : 0;

  const holderInMyCorridor = ballHolder != null
    && Math.abs(ballHolder.y - player.y) < DEFENSIVE_INTENT_CONFIG.CORRIDOR_HALF_WIDTH;

  const canGetGoalSideOfHolder = ballHolder != null && (
    player.attackDir === 1
      ? player.x <= ballHolder.x
      : player.x >= ballHolder.x
  );

  const frontBlocker = ballHolder != null
    ? computeFrontBlocker(player, ballHolder, allPlayers)
    : 0;

  // Mark is goal-side of defender — mark has gotten behind (dangerous)
  const markIsGoalSideDanger = markTarget != null && (
    player.attackDir === 1
      ? markTarget.x < player.x  // own goal at x=0, mark is closer to it than defender
      : markTarget.x > player.x  // own goal at x=115, mark is closer to it than defender
  );

  // Mark is within passing reach of holder — live threat
  const markIsPassReachable = markTarget != null && ballHolder != null
    && Math.hypot(markTarget.x - ballHolder.x, markTarget.y - ballHolder.y) < MARK_PASS_REACH;

  // 0..1: rises when defender has drifted too far from mark
  const markDistFactor = markTarget != null && isFinite(distToMark)
    ? Math.min(1, Math.max(0, (distToMark - MARK_FAR_DISTANCE) / 20))
    : 0;

  const carryLaneUrgency = computeCarryLaneUrgency(
    holderThreat,
    holderInMyCorridor,
    frontBlocker,
    canGetGoalSideOfHolder,
  );

  const isBlockingCarryLane = ballHolder != null
    && canGetGoalSideOfHolder
    && Math.abs(player.y - ballHolder.y) < DEFENSIVE_INTENT_CONFIG.CARRY_BLOCK_WIDTH;

  // ── Crowd-grid signals (Stage 2) ─────────────────────────────────────────
  // pressLoad           : raw defending-team density around the holder. Used by
  //                       the general press-saturation factor. Direction-agnostic
  //                       on purpose — high density of any defenders nearby is
  //                       the right signal for "no need for more bodies here".
  // effectivePressLoad  : direction-aware variant. Each teammate's contribution
  //                       weighted by how effectively they block the carry path
  //                       (goal-side AND laterally on the corridor). Used ONLY
  //                       for step_into_carry_lane — that decision needs to
  //                       ignore teammates who are already beaten.
  // markDanger          : threat × isolation for this defender's mark target.
  let pressLoad = 0;
  let effectivePressLoad = 0;
  let markDangerScore = 0;
  if (crowdGrid && ballHolder) {
    const defenderOutfield = player.team === 'A' ? crowdGrid.teamAOutfield : crowdGrid.teamBOutfield;
    pressLoad = sampleCellSumExcluding(defenderOutfield, ballHolder.x, ballHolder.y, player.x, player.y, 1);
  }
  if (ballHolder) {
    effectivePressLoad = computeEffectivePressLoad(player, ballHolder, allPlayers);
  }
  if (markTarget) {
    const attackerOutfield = crowdGrid
      ? (player.team === 'A' ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield)
      : null;
    markDangerScore = computeOppDanger(markTarget, ownGoalX, cfg.THREAT_HORIZON, attackerOutfield);
  }

  const roleWeights = roleEngine(player.role).defensiveIntentWeights;

  return {
    player,
    ballHolder,
    markTarget,
    shapeAnchor,
    cfg,
    allPlayers,
    formation,
    ballPos,
    ownGoalX,
    teamIntent,
    distToHolder,
    distToMark,
    holderThreat,
    markThreat,
    holderInMyCorridor,
    canGetGoalSideOfHolder,
    frontBlocker,
    markIsGoalSideDanger,
    markIsPassReachable,
    markDistFactor,
    carryLaneUrgency,
    isBlockingCarryLane,
    rolePressBias:     roleWeights.press_holder,
    roleCarryLaneBias: roleWeights.step_into_carry_lane,
    roleMarkBias:      roleWeights.track_mark,
    pressLoad,
    effectivePressLoad,
    markDangerScore,
  };
}

// ── Phase 5: Intent scores (one function per intent) ───────────────────────────

/**
 * Effective press load on the ball holder from this defender's perspective.
 *
 * Replaces the direction-agnostic crowd-grid sample for press-saturation
 * decisions. Each teammate contributes proportionally to:
 *   • distance falloff (closer = more)
 *   • along-goal effectiveness (defender between holder and own goal counts;
 *     defender behind the holder doesn't — they're already beaten)
 *   • lateral effectiveness (defender on the holder→goal corridor counts;
 *     a teammate 20 yds laterally off the corridor doesn't actually block
 *     the carry, even if their x-position looks goal-side)
 *
 * Self is excluded — this is the load *other* teammates put on the holder.
 * GKs are excluded.
 *
 * Calibration: PRESS_LOAD_PER_PLAYER matches PRESS_SAT_PER_PLAYER so the
 * existing PRESS_SAT_THRESHOLD keeps its "≈ 1.5 effective pressers" meaning.
 */
function computeEffectivePressLoad(
  player: GamePlayer,
  ballHolder: GamePlayer,
  allPlayers: GamePlayer[],
): number {
  const {
    PRESS_LOAD_RADIUS,
    PRESS_LOAD_ALONG_FULL,
    PRESS_LOAD_LATERAL_RANGE,
    PRESS_LOAD_PER_PLAYER,
  } = CROWD_AWARE_DEFENSE;

  // Holder→own-goal direction (defending team's goal). The carry threat travels
  // along this vector, so "effective press" means standing on this corridor.
  const ownGoalX = player.attackDir === 1 ? 0 : PITCH_LENGTH;
  const goalCenterY = (GOAL_Y_MIN + GOAL_Y_MAX) / 2;
  const gx = ownGoalX - ballHolder.x;
  const gy = goalCenterY - ballHolder.y;
  const gLen = Math.hypot(gx, gy);
  if (gLen < 1e-6) return 0;
  const goalDirX = gx / gLen;
  const goalDirY = gy / gLen;

  let load = 0;
  for (const d of allPlayers) {
    if (d.team !== player.team) continue;
    if (d.id === player.id) continue;
    if (d.role === 'GK') continue;

    const dx = d.x - ballHolder.x;
    const dy = d.y - ballHolder.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= PRESS_LOAD_RADIUS) continue;

    // Project onto holder→goal axis: along (signed), lateral (absolute).
    const along   = dx * goalDirX + dy * goalDirY;
    const lateral = Math.abs(dx * (-goalDirY) + dy * goalDirX);

    // Along-goal factor: 0 at/behind holder, 1 when ≥ PRESS_LOAD_ALONG_FULL goal-side.
    // A defender level with the holder (along=0) contributes nothing because they
    // aren't blocking the carry path — they're beside it.
    const alongFactor = Math.max(0, Math.min(1, along / PRESS_LOAD_ALONG_FULL));

    // Lateral factor: 1 on the corridor centre, 0 when ≥ PRESS_LOAD_LATERAL_RANGE off.
    const lateralFactor = Math.max(0, 1 - lateral / PRESS_LOAD_LATERAL_RANGE);

    const effectiveness = alongFactor * lateralFactor;
    if (effectiveness <= 0) continue;

    const proximity = 1 - dist / PRESS_LOAD_RADIUS;

    load += proximity * effectiveness * PRESS_LOAD_PER_PLAYER;
  }
  return load;
}

/**
 * Press saturation damping multiplier (0..1).
 *
 * When several defenders already cluster around the ball holder, additional
 * defenders far from the holder should NOT also commit to pressing — they're
 * needed to mark unattended attackers elsewhere. The closest defender to the
 * holder is unaffected (proximityFactor → 0 at distToHolder=0) so there's
 * always at least one presser.
 *
 * @param pressLoad      effective-press-load value (see computeEffectivePressLoad)
 * @param distToHolder   this defender's distance to the holder (yards)
 * @param pressRangeYds  effective press range, used as the distance scale
 */
function pressSaturationFactor(
  pressLoad: number,
  distToHolder: number,
  pressRangeYds: number,
): number {
  const {
    PRESS_SAT_THRESHOLD, PRESS_SAT_PER_PLAYER,
    PRESS_SAT_DAMP_PER, PRESS_SAT_FLOOR,
  } = CROWD_AWARE_DEFENSE;
  if (pressLoad <= PRESS_SAT_THRESHOLD) return 1;
  // Approximate excess defenders beyond the threshold (in player-units).
  const excess = (pressLoad - PRESS_SAT_THRESHOLD) / PRESS_SAT_PER_PLAYER;
  // Closer to holder = less damping; far away = full damping.
  const proximityFactor = Math.max(0, Math.min(1, distToHolder / Math.max(pressRangeYds, 1e-6)));
  const damping = 1 - excess * proximityFactor * PRESS_SAT_DAMP_PER;
  return Math.max(PRESS_SAT_FLOOR, damping);
}


/** Structural fallback — wins when no direct local threat demands more. */
function scoreHoldShapeIntent(
  ctx: DefensiveIntentContext,
  w: DefensiveIntentWeights,
  press: IntentTacticMult,
  line: IntentTacticMult,
  patienceT: number,
): number {
  let s = w.hold_shape * press.hold_shape * line.hold_shape;
  if (ctx.holderThreat < 0.25) s *= 1.15;
  if (ctx.markTarget) {
    // Mark closer to our goal → care less about generic shape (track/press/cover win).
    const nearGoalFactor = Math.max(0.35, 1 - ctx.markThreat * 0.65);
    s *= nearGoalFactor;
  }
  if (ctx.holderInMyCorridor && ctx.distToHolder < 20) s *= 0.75;
  // Patience exhaustion erodes shape discipline — quadratic so the effect is slow
  // to start and accelerates the longer the opponent holds the ball.
  s *= (1 - patienceT * patienceT * POSSESSION_PATIENCE.SHAPE_PENALTY_MAX);
  return s;
}

/**
 * Default defensive behavior — always mark on the passing lane.
 * Pressing tactic controls HOW close (via MARK_LANE_T in cfg), not WHETHER.
 * Role has no influence here; tactic and situation drive the score.
 */
function scoreTrackMarkIntent(
  ctx: DefensiveIntentContext,
  w: DefensiveIntentWeights,
  press: IntentTacticMult,
  line: IntentTacticMult,
): number {
  let s = w.track_mark * press.track_mark * line.track_mark;
  s *= (0.60 + ctx.markThreat * 0.40);
  if (ctx.markDistFactor > 0) s *= (1 + ctx.markDistFactor * 0.5);
  if (ctx.markIsGoalSideDanger) s *= 1.20;
  if (ctx.markIsPassReachable) s *= 1.15;
  if (!ctx.markTarget) s *= 0.2;
  s *= Math.max(0.5, 1 - ctx.carryLaneUrgency * 0.35);

  // Soft out-of-zone cost: when the mark sits outside this defender's bounds,
  // discount track_mark — UNLESS the mark is a real threat. This lets a
  // hand-off happen for low-danger drifts (hold_shape wins) but forces the
  // defender to chase a dangerous mark even far outside their zone.
  if (ctx.markTarget) {
    const outDist = outOfZoneDistance(ctx.markTarget, ctx.player.bounds);
    if (outDist > 0) {
      const zonePenalty     = Math.min(1, outDist / OUT_OF_ZONE_RANGE);
      const threatRelief    = 1 - ctx.markThreat; // high threat → no discount
      const effectivePenalty = zonePenalty * threatRelief * OUT_OF_ZONE_PENALTY_MAX;
      s *= (1 - effectivePenalty);
    }
  }

  // Crowd-aware danger boost: a lone, near-goal mark gets priority. Pulls
  // freed-from-saturation defenders onto real threats instead of safe ones.
  s *= (1 + ctx.markDangerScore * CROWD_AWARE_DEFENSE.MARK_DANGER_BOOST_MAX);

  return s;
}

/** Only when our mark has the ball and within effective press range,
 *  OR when this defender is already physically blocking the carry lane. */
function scorePressHolderIntent(
  ctx: DefensiveIntentContext,
  w: DefensiveIntentWeights,
  press: IntentTacticMult,
  line: IntentTacticMult,
  pressRangeYds: number,
  holderIsMyMark: boolean,
  patienceT: number,
  rawPatienceT: number,
): number {
  let s = w.press_holder * press.press_holder * line.press_holder;
  // Range expansion uses rawPatienceT (not proximity-dampened) — patience exhaustion
  // should expand who is eligible to press regardless of their current distance.
  // The boost multiplier below still uses proximity-dampened patienceT so far-away
  // defenders don't get their scores artificially inflated by a single distractor.
  const effectiveOpportunisticRange = DEFENSIVE_INTENT_CONFIG.OPPORTUNISTIC_PRESS_RANGE
    + rawPatienceT * rawPatienceT * DEFENSIVE_INTENT_CONFIG.PATIENCE_OPPORTUNISTIC_BONUS;
  const opportunisticPress = ctx.distToHolder < effectiveOpportunisticRange;
  if (!ctx.ballHolder || (!holderIsMyMark && !ctx.isBlockingCarryLane && !opportunisticPress)) return 0;
  // Use the larger of pressRangeYds and effectiveOpportunisticRange as the distance gate —
  // otherwise the opportunistic patience expansion is immediately nullified by the base range check.
  const maxPressRange = opportunisticPress
    ? Math.max(pressRangeYds, effectiveOpportunisticRange)
    : pressRangeYds;
  if (ctx.distToHolder > maxPressRange) return 0;

  const { DISTANCE_AT_EDGE, DISTANCE_ON_HOLDER, INTENT_SCALE } = PRESS_HOLDER_SCORING;
  const r = Math.max(maxPressRange, 1e-6);
  const edgeToHolderT = ctx.distToHolder / r;
  const distanceFactor =
    DISTANCE_AT_EDGE + (DISTANCE_ON_HOLDER - DISTANCE_AT_EDGE) * (1 - edgeToHolderT);
  s *= distanceFactor;
  s *= (0.25 + ctx.holderThreat * 0.75);
  s *= INTENT_SCALE;
  // Patience exhaustion pushes the team to break shape and press — quadratic so
  // the boost is negligible for the first few seconds and grows sharply after.
  s *= (1 + patienceT * patienceT * POSSESSION_PATIENCE.PRESS_BOOST_MAX);
  // Catchability: project the defender onto the holder→goal axis. Defenders
  // ahead of the holder (positive projection) can intercept the path; defenders
  // behind cannot realistically catch a carrier moving toward goal — pressing
  // is futile and they should hold shape / track their mark instead.
  // This is the same direction-aware logic as tackleAngleModifier — pure x-axis
  // attackDir misclassifies edge cases (carrier near corner / wide channels).
  {
    const goalX = ctx.ballHolder.attackDir === 1 ? PITCH_LENGTH : 0;
    const goalY = (GOAL_Y_MIN + GOAL_Y_MAX) / 2;
    const fx = goalX - ctx.ballHolder.x;
    const fy = goalY - ctx.ballHolder.y;
    const fLen = Math.hypot(fx, fy);
    const forwardX = fLen > 1e-3 ? fx / fLen : ctx.ballHolder.attackDir;
    const forwardY = fLen > 1e-3 ? fy / fLen : 0;
    const dx = ctx.player.x - ctx.ballHolder.x;
    const dy = ctx.player.y - ctx.ballHolder.y;
    const along = dx * forwardX + dy * forwardY;
    // along ≥ 0 → defender ahead in progression direction → factor = 1
    // along = −FALLOFF → factor = 0 (clamped to FLOOR)
    const catchabilityFactor = Math.max(
      DEFENSIVE_INTENT_CONFIG.PRESS_CATCHABILITY_FLOOR,
      Math.min(1, 1 + along / DEFENSIVE_INTENT_CONFIG.PRESS_CATCHABILITY_FALLOFF),
    );
    s *= catchabilityFactor;
  }
  // Crowd-aware saturation: stop the swarm. Closest defender keeps full score;
  // further-away defenders get damped when many teammates already cluster on
  // the holder, freeing them to mark unattended attackers.
  s *= pressSaturationFactor(ctx.pressLoad, ctx.distToHolder, pressRangeYds);
  return s;
}

/** Step in to block a dangerous carry when corridor threat dominates. */
function scoreStepIntoCarryLaneIntent(
  ctx: DefensiveIntentContext,
  w: DefensiveIntentWeights,
  press: IntentTacticMult,
  line: IntentTacticMult,
): { score: number; carryLaneBonus: number } {
  if (!ctx.ballHolder) return { score: 0, carryLaneBonus: 0 };

  // Already in position — hand off to press_holder.
  if (ctx.isBlockingCarryLane) {
    return { score: 0, carryLaneBonus: 0 };
  }

  let s = w.step_into_carry_lane * press.step_into_carry_lane * line.step_into_carry_lane;

  // Two dominant signals:
  s *= (0.10 + ctx.holderThreat * 0.90);
  s *= Math.max(0.10, 1 - ctx.frontBlocker * 0.90);

  // Corridor gate: defenders far laterally from the carrier should hesitate before
  // abandoning shape — UNLESS the threat is high, in which case they must respond
  // regardless of lateral offset. At low threat: ×0.40 (same gate as before).
  // At max threat: ×1.0 (no penalty — a dangerous carry demands a response).
  if (!ctx.holderInMyCorridor) s *= Math.min(1.0, 0.40 + ctx.holderThreat * 0.60);

  // Goal-side position modifier: being already goal-side is ideal (+30%).
  // Not yet goal-side is NOT a disqualifier — penalise proportionally to how
  // far behind the defender is (0 yards behind = no penalty, 20+ yards = 0.2x).
  if (ctx.canGetGoalSideOfHolder) {
    s *= 1.3;
  } else {
    // How many yards the carrier is ahead of the defender (goal-side)
    const yardsBeind = Math.abs(ctx.ballHolder.x - ctx.player.x);
    const behindPenalty = Math.max(0.2, 1 - yardsBeind / 20);
    s *= behindPenalty;
  }

  const carryLaneBonus = 0.4;
  s *= 1.4;
  // Direction-aware saturation: only count teammates who are *actually* blocking
  // the carry path (goal-side and on the corridor). A teammate behind the
  // holder is already beaten — they shouldn't suppress this defender from
  // stepping in as the new last man.
  s *= pressSaturationFactor(ctx.effectivePressLoad, ctx.distToHolder, effectivePressRange(ctx.player, ctx.teamIntent));
  return { score: s, carryLaneBonus };
}

function selectDefensiveIntent(ctx: DefensiveIntentContext, possessionTime: number): {
  intent: DefensiveIntent;
  scores: Record<DefensiveIntent, number>;
  carryLaneBonus: number;
} {
  const tacticKeys    = getDefenseTacticKeys(ctx.player.team);
  const pressingStyle = effectivePressingStyle(ctx.player.team, ctx.teamIntent);
  const pressMult     = INTENT_PRESSING_STYLE[pressingStyle];
  const lineMult      = INTENT_DEFENSIVE_LINE[tacticKeys.defensiveLine];

  const pressRangeYds = effectivePressRange(ctx.player, ctx.teamIntent);
  const holderIsMyMark =
    ctx.ballHolder != null
    && ctx.markTarget != null
    && ctx.ballHolder.id === ctx.markTarget.id;

  const w = roleEngine(ctx.player.role).defensiveIntentWeights;

  // Quadratic patience ramp: slow at first, accelerates the longer the opponent
  // holds the ball. The existing intent scores already encode situational danger —
  // a dominant hold_shape score will resist the boost longer than a weak one.
  // Proximity gate: defenders far from the ball are unaffected — patience should
  // never break the shape of players on the opposite side of the pitch.
  const rawPatienceT = Math.min(1, possessionTime / POSSESSION_PATIENCE.BASE_SECONDS);
  const proximityFactor = Number.isFinite(ctx.distToHolder)
    ? Math.max(0, 1 - ctx.distToHolder / DEFENSIVE_INTENT_CONFIG.PATIENCE_INFLUENCE_RADIUS)
    : 0;
  const patienceT = rawPatienceT * proximityFactor;

  const holdShapeScore = scoreHoldShapeIntent(ctx, w, pressMult, lineMult, patienceT);
  const trackMarkScore = scoreTrackMarkIntent(ctx, w, pressMult, lineMult);
  const pressHolderScore = scorePressHolderIntent(ctx, w, pressMult, lineMult, pressRangeYds, holderIsMyMark, patienceT, rawPatienceT);
  const { score: stepIntoCarryLaneScore, carryLaneBonus } = scoreStepIntoCarryLaneIntent(ctx, w, pressMult, lineMult);

  const scores: Record<DefensiveIntent, number> = {
    hold_shape:           holdShapeScore,
    track_mark:           trackMarkScore,
    press_holder:         pressHolderScore,
    step_into_carry_lane: stepIntoCarryLaneScore,
  };

  // Tie-breaking priority: press_holder > step_into_carry_lane > track_mark > hold_shape
  let best: DefensiveIntent = 'hold_shape';
  let bestScore = -Infinity;
  const order: DefensiveIntent[] = [
    'press_holder',
    'step_into_carry_lane',
    'track_mark',
    'hold_shape',
  ];
  for (const intent of order) {
    if (scores[intent] > bestScore) {
      bestScore = scores[intent];
      best = intent;
    }
  }
  return { intent: best, scores, carryLaneBonus };
}

// ── Defensive decision — mirrors evaluateOffBall() pattern ────────────────────
//
// Called from DecisionTree.decide() for every defending player not in tackle
// range. Scores the five intents, writes the winner to _intentCache (for
// computeDefensivePosition to read), and returns the matching PlayerDecision.

export function evaluateDefensiveDecision(
  player: GamePlayer,
  ballHolder: GamePlayer,
  allPlayers: GamePlayer[],
  possessionTime: number,
  crowdGrid: CrowdGrid | null = null,
  teamIntent: TeamIntent = 'balanced',
): import('@/GameEngine/Domain/DecisionTree').PlayerDecision {
  const cfg = getDefenseConfig(player.team);

  const markAssignments = assignMarkTargets(allPlayers, player.team, crowdGrid);
  const markTargetId    = markAssignments.get(player.id);
  const markTarget      = markTargetId !== undefined
    ? allPlayers.find(p => p.id === markTargetId) ?? null
    : null;

  // Decision phase has no formation here — stub shape anchor (same as before).
  const ctx = buildDefensiveIntentContext(
    player,
    ballHolder,
    markTarget,
    allPlayers,
    null,
    { x: ballHolder.x, y: ballHolder.y },
    cfg,
    crowdGrid,
    teamIntent,
  );

  const { intent, scores, carryLaneBonus } = selectDefensiveIntent(ctx, possessionTime);

  // Cache intent — computeDefensivePosition reads this to position the player.
  _intentCache[player.id] = intent;

  if (isDebugEnabled()) {
    gameBus.emit('defensiveScores', {
      playerId:     player.id,
      playerName:   player.name,
      chosenIntent: intent,
      scores,
      holderThreat: ctx.holderThreat,
      markThreat:   ctx.markThreat,
      carryLaneBonus,
    });
  }

  switch (intent) {
    case 'press_holder':
      return { type: 'press', targetId: ballHolder.id };
    case 'track_mark':
      return { type: 'track_mark', markTargetId: markTargetId ?? -1 };
    case 'hold_shape':
      return { type: 'hold_shape' };
    case 'step_into_carry_lane':
      return { type: 'step_into_carry_lane' };
  }
}

// ── GK angle-bisector positioning ─────────────────────────────────────────────

/**
 * Returns the GK's optimal position on the angle-bisector arc.
 *
 * The GK moves along the line from the goal centre toward the ball,
 * stepping off the line by a come-out distance that scales with how
 * close the attacker is (closer → further out, narrowing the angle).
 */
function computeGKSemicirclePosition(
  gk: GamePlayer,
  ballPos: { x: number; y: number },
): { x: number; y: number } {
  const goalX       = gk.attackDir === 1 ? 0 : PITCH_LENGTH;
  const goalCenterY = (GOAL_Y_MIN + GOAL_Y_MAX) / 2;

  const dx   = ballPos.x - goalX;
  const dy   = ballPos.y - goalCenterY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const comeOut = GK_MIN_COME_OUT
    + (GK_MAX_COME_OUT - GK_MIN_COME_OUT) * Math.max(0, 1 - dist / GK_COME_OUT_DIST);

  let rawX: number;
  let rawY: number;

  if (dist > 0.01) {
    rawX = goalX + (dx / dist) * comeOut;
    rawY = goalCenterY + (dy / dist) * comeOut;
  } else {
    rawX = goalX + gk.attackDir * comeOut;
    rawY = goalCenterY;
  }

  const { bounds } = gk;
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, rawX)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, rawY)),
  };
}

// ── Main exported function ─────────────────────────────────────────────────────

export function computeDefensivePosition(
  player: GamePlayer,
  ballPos: { x: number; y: number },
  allPlayers: GamePlayer[],
  formation: Formation,
  ballHolderId: number,
  playerDecision: string | undefined,
  markTargetId: number | undefined,
): { x: number; y: number } {
  const { bounds } = player;
  const cfg      = getDefenseConfig(player.team);
  const ownGoalX = player.attackDir === 1 ? 0 : PITCH_LENGTH;

  // GK: angle-bisector semicircle positioning — replaces the outfield pipeline
  if (player.role === 'GK') {
    return computeGKSemicirclePosition(player, ballPos);
  }

  // Tackle path: keep shape anchor (tackle movement handled by gameState)
  if (playerDecision === 'tackle') {
    const anchor = computeDefensiveShapeAnchor(player, ballPos, formation, cfg);
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, anchor.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, anchor.y)),
    };
  }

  // Intent was already decided (and cached) in evaluateDefensiveDecision()
  // during the decision phase — we just read it here for positioning.
  const intent      = _intentCache[player.id] ?? 'hold_shape';
  const shapeAnchor = computeDefensiveShapeAnchor(player, ballPos, formation, cfg);

  const ballHolder = allPlayers.find(p => p.id === ballHolderId) ?? null;
  const markTarget = markTargetId !== undefined
    ? allPlayers.find(p => p.id === markTargetId) ?? null
    : null;

  let rawX = shapeAnchor.x;
  let rawY = shapeAnchor.y;

  if (intent === 'track_mark' && ballHolder && markTarget) {
    const result = computeTrackMarkTarget(shapeAnchor, player, ballHolder, markTarget, cfg);
    rawX = result.x;
    rawY = result.y;
  }

  if (intent === 'step_into_carry_lane' && ballHolder) {
    const intercept = computeCarryLaneIntercept(
      player, ballHolder, ownGoalX,
      DEFENSIVE_INTENT_CONFIG.CARRY_LANE_LOOKAHEAD,
    );
    rawX = intercept.x;
    rawY = intercept.y;
  }

  // Soft bounds: active engagement intents (track_mark / step_into_carry_lane)
  // clamp only to pitch — the player must be free to follow a mark or step into
  // a carry lane that exits their zone. The zone preference is already baked
  // into intent scoring (see scoreTrackMarkIntent's out-of-zone penalty).
  // hold_shape keeps the strict bounds clamp — its whole purpose is to stay home.
  const useSoftBounds = intent === 'track_mark' || intent === 'step_into_carry_lane';
  const minX = useSoftBounds ? 0 : bounds.minX;
  const maxX = useSoftBounds ? PITCH_LENGTH : bounds.maxX;
  const minY = useSoftBounds ? 0 : bounds.minY;
  const maxY = useSoftBounds ? PITCH_WIDTH : bounds.maxY;
  return {
    x: Math.max(minX, Math.min(maxX, rawX)),
    y: Math.max(minY, Math.min(maxY, rawY)),
  };
}
