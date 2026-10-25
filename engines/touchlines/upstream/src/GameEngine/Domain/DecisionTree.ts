/**
 * DecisionTree — pure per-player decision evaluation.
 *
 * Imports types, CarryConfig, role data (`roleEngineData`), and configs — not
 * gameState — so there is no circular dependency with the match loop. All context needed for a
 * decision is passed as arguments.
 *
 * ALL player-level choices (shoot vs pass, tackle vs press, etc.) belong
 * here. The game loop in gameState.ts should never second-guess or override
 * a decision — it only *executes* whatever the tree returns.
 *
 * Adding a new decision:
 *   1. Add a new variant to PlayerDecision
 *   2. Add the evaluation condition inside decide()
 *   3. Handle the new decision type in gameState.ts tickState()
 *   4. Document it in project-structure.md
 */

import type { GamePlayer, SetPiece, TeamIntent } from '@/GameEngine/types';

/** A player in recovery from a duel (tackle or dribble) cannot make defensive decisions. */
export function isPlayerInRecovery(player: GamePlayer): boolean {
  return player.recoveryTime > 0;
}
import { roleEngine } from '@/GameEngine/Domain/roleEngineData';
import { CARRY_CONFIG } from '@/GameEngine/Configs/CarryConfig';
import { getTeamCarryConfig } from '@/GameEngine/Configs/AttackConfig';
import { applyCarryIntent, getShootIntentBonus, getExtraCarryLanes } from '@/GameEngine/Configs/IntentConfig';
import { evaluateDefensiveDecision } from '@/GameEngine/Domain/DefensivePositioning';
import { evaluateCarryLane, evaluateCarryLaneBreakdown, rot } from '@/GameEngine/Domain/CarryLaneEval';
import type { CarryLaneBreakdown } from '@/GameEngine/Domain/CarryLaneEval';
import { evaluateOffBall } from '@/GameEngine/Domain/OffBallMovement';
import {
  getCellIndex, GRID_COLS, GRID_ROWS, type CrowdGrid, type GridMatrix,
} from '@/GameEngine/Infrastructure/CrowdGrid';
import {
  TACKLE_RANGE, DRIBBLE_ATTEMPT_RANGE, DRIBBLE_MIN_BIAS,
  computeXG, MAX_XG, computeOpenAngle, computeWeightedPressure,
} from '@/GameEngine/Infrastructure/ActionOutcomes';
import { PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX } from '@/GameEngine/Domain/pitch';
import { evaluatePassLanes, scorePassToReceiverBreakdown } from '@/GameEngine/Domain/PassLanes';
import type { PassBreakdown } from '@/GameEngine/Domain/PassLanes';
import { enumerateCandidateCells } from '@/GameEngine/Domain/ThroughBallCells';
import { computeOffsideLine } from '@/GameEngine/Domain/Offside';
import { debugLog, isDebugEnabled } from '@/GameEngine/Suport/DebugLog';
import { gameBus } from '@/GameEngine/Infrastructure/EventBus';

export type PlayerDecision =
  | { type: 'carry'; dx: number; dy: number }          // withBall  → advancing with the ball
  | { type: 'shoot' }                                   // withBall  → will shoot
  | { type: 'pass' }                                    // withBall  → will pass to a teammate
  | { type: 'through_ball'; cellX: number; cellY: number; intendedRunnerId: number | null } // withBall → ball into space
  | { type: 'dribble'; targetId: number }               // withBall  → attempt to beat a close defender 1v1
  | { type: 'tackle'; targetId: number }                // withoutBall → close enough to attempt a tackle
  | { type: 'press';  targetId: number }                // withoutBall → sprinting toward the ball holder
  | { type: 'support_run';  dx: number; dy: number }   // offBall   → move into receiving position
  | { type: 'create_space'; dx: number; dy: number }   // offBall   → move away from pressure
  | { type: 'chase_loose_ball'; toX: number; toY: number } // both → sprint to a contested loose ball
  | { type: 'hold_shape' }                              // defending → maintain formation shape
  | { type: 'track_mark'; markTargetId: number }        // defending → track assigned mark
  | { type: 'step_into_carry_lane' }                    // defending → block carry path to goal
  | { type: 'idle' }                                    // fallback  → no action

// ── Decision short-term memory ────────────────────────────────────────────────

/** Which high-level role a player is playing this tick. */
export type DecisionPath = 'BALL_HOLDER' | 'TEAM_WITH_BALL' | 'TEAM_WITHOUT_BALL';

/** Per-player memory: the path and decision made last tick, plus remaining commitment ticks. */
export interface DecisionMemory {
  path:        DecisionPath | null;
  decision:    PlayerDecision | null;
  commitTicks: number;
}

export const EMPTY_DECISION_MEMORY: DecisionMemory = { path: null, decision: null, commitTicks: 0 };

/**
 * How many additional ticks a decision is held after it is made.
 * 0 = re-decide every tick. Higher values prevent flickering between decisions.
 */
export const COMMIT_TICKS: Record<PlayerDecision['type'], number> = {
  shoot:                0,
  carry:                5,
  pass:                 0,
  through_ball:         0,
  dribble:              4,
  tackle:               0,
  press:                8,
  support_run:          5,
  create_space:         5,
  chase_loose_ball:     6,
  hold_shape:           8,
  track_mark:           10,
  step_into_carry_lane: 6,
  idle:                 0,
};

// ── Action score compression ──────────────────────────────────────────────────

/**
 * Maps a raw action score [0, ∞) to (0, 1) with diminishing returns.
 * Score can never reach 1.0 — approaching it requires exponentially better
 * situations, so the decision space stays differentiated near the top.
 *
 * `strongRaw` is the raw value that represents "a strong action in this domain" —
 * at raw=strongRaw the score is always 0.632, regardless of domain.
 * This normalises action types with different raw ranges so they compete fairly.
 *
 * Per-action calibration (what raw=strongRaw means):
 *   SHOOT (1.5) — ST at xg/threshold=1.5 → xG=0.375 at threshold=0.25 — a clear good chance
 *   CARRY (0.9) — clear lane with decent player — a solid advancing opportunity
 *   PASS  (0.8) — open lane to a good receiver — a quality passing option
 *
 * Reference points at each STRONG_RAW:
 *   shoot: xg/thr=0.5→0.28  1.0→0.49  1.5→0.63  2.5→0.81  3.8→0.92
 *   carry: lane=0.5→0.43    0.9→0.63  1.1→0.71  1.5→0.81
 *   pass:  score=0.5→0.46   0.8→0.63  1.0→0.71  1.4→0.83
 */
function compress(raw: number, strongRaw: number = 1.0): number {
  return 1 - Math.exp(-raw / strongRaw);
}

const SHOOT_STRONG_RAW   = 1.8;
const CARRY_STRONG_RAW   = 0.8;
const PASS_STRONG_RAW    = 1;
/**
 * Dribble raw = roleTendency×0.6 + forwardBlock×0.4, max 1.0.
 * A winger (carryBias≈0.7) with defender fully ahead → raw≈0.82 → score 0.632.
 */
const DRIBBLE_STRONG_RAW      = 0.8;
/** Through-ball raw scoring: a strong cell (race margin ≈1s, open, central, skilled passer) ≈ 0.9 → 0.632. */
const THROUGH_BALL_STRONG_RAW = 0.9;

// ── Carry lane scoring (from CarryLaneEval) ───────────────────────────────────
// evaluateCarryLane and rot are imported from CarryLaneEval.ts and re-exported
// so that any existing callers of DecisionTree can still use them.
export { evaluateCarryLane, rot };

/**
 * Evaluate three carry lanes (straight to goal, ±30°) and return the best
 * direction — or null if all lanes score below MIN_TOTAL_SCORE.
 */
/**
 * How much the role-fit penalty is reduced when the whole team is advanced.
 * At full team advance (everyone in opponent half): penalty × (1 - MAX_ADVANCE_SOFTENING).
 * Prevents punishing a CB for stepping up when the entire team is pressing high.
 */
const MAX_ADVANCE_SOFTENING = 0.75;

/**
 * Forward path clearness for the carrier, in [0, 1].
 *
 *   1 = no defending outfielders between the carrier and the goal (wide-open run)
 *   0 = path is choked with defenders
 *
 * Sums the defending team's outfield density (GK excluded) in the cells ahead
 * of the carrier's row band, normalised by `PATH_DENSITY_SATURATION`. Used to
 * fade the role-fit and byline penalties — both penalties exist to discourage
 * out-of-position carries that lose the ball or get forced wide. Neither
 * failure mode applies when nobody is in the way.
 *
 * Returns 0 when no grid is available so existing penalties stay full strength
 * for any caller that hasn't been wired up yet.
 */
function forwardPathClearness(player: GamePlayer, defendingOutfield: GridMatrix | null): number {
  if (defendingOutfield == null) return 0;
  const cfg = getTeamCarryConfig(player.team);
  const me = getCellIndex(player.x, player.y);
  const startCol = player.attackDir === 1 ? me.col + 1 : 0;
  const endCol   = player.attackDir === 1 ? GRID_COLS  : me.col;
  if (endCol <= startCol) return 1; // already at the endline column

  const rowBand = cfg.FORWARD_PATH_ROW_BAND;
  const r0 = Math.max(0, me.row - rowBand);
  const r1 = Math.min(GRID_ROWS - 1, me.row + rowBand);

  let total = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = startCol; c < endCol; c++) total += defendingOutfield[r]![c]!;
  }
  return 1 - Math.min(1, total / cfg.PATH_DENSITY_SATURATION);
}

/** Best-lane carry result, including the underlying breakdown for debug emission. */
interface BestCarryLane {
  dx: number;
  dy: number;
  score: number;
  /** Component breakdown of the chosen lane (clearance/progress/angle/crowd/role/vision/pressure). */
  breakdown: CarryLaneBreakdown;
  /** Role-fit penalty applied (out-of-zone target softened by team advance + path clearness). */
  rolePenalty: number;
  /** Byline penalty applied (faded by path clearness). */
  bylinePenalty: number;
  /** Flat additive bonus from an intent's extra carry lane (e.g. switch_play far_flank); 0 for forward lanes. */
  laneBonus: number;
  /** Score before penalties — equals breakdown.score. */
  rawScore: number;
}

function getBestCarryLane(
  player: GamePlayer,
  opponents: GamePlayer[],
  allPlayers: GamePlayer[],
  defendingOutfield: GridMatrix | null,
  intent: TeamIntent = 'balanced',
): BestCarryLane | null {
  const baseCfg = getTeamCarryConfig(player.team);
  const cfg     = { ...baseCfg, ...applyCarryIntent(baseCfg, intent) };

  // How advanced is this team right now? Average outfield teammate X in attack direction,
  // normalised 0 (own goal) → 1 (opponent goal). Reduces role-fit penalty when pressing high.
  const teammates = allPlayers.filter(p => p.team === player.team && p.role !== 'GK');
  const avgX = teammates.length > 0
    ? teammates.reduce((s, p) => s + p.x, 0) / teammates.length
    : player.x;
  const teamAdvanceFactor = player.attackDir === 1
    ? Math.max(0, Math.min(1, (avgX - PITCH_LENGTH / 2) / (PITCH_LENGTH / 2)))
    : Math.max(0, Math.min(1, (PITCH_LENGTH / 2 - avgX) / (PITCH_LENGTH / 2)));
  const rolePenaltyScale = 1 - teamAdvanceFactor * MAX_ADVANCE_SOFTENING;
  const goalX       = player.attackDir === 1 ? PITCH_LENGTH : 0;
  const goalTargetY = Math.max(GOAL_Y_MIN, Math.min(GOAL_Y_MAX, player.y));
  const tgDx        = goalX - player.x;
  const tgDy        = goalTargetY - player.y;
  const tgDist      = Math.sqrt(tgDx * tgDx + tgDy * tgDy);
  if (tgDist < 0.01) return null;

  const baseDx = tgDx / tgDist;
  const baseDy = tgDy / tgDist;

  const lanes: { dx: number; dy: number; scoreBonus?: number }[] = [
    { dx: baseDx, dy: baseDy },
    rot(baseDx, baseDy, -Math.PI / 6),
    rot(baseDx, baseDy, +Math.PI / 6),
  ];

  // Additive carry lanes declared by the active intent (e.g. switch_play's far_flank).
  // Resolved generically here — the consumer turns each named primitive into a {dx,dy}
  // and carries the intent's flat scoreBonus so a soft-biased lateral lane can compete
  // with, but not always beat, the forward lanes.
  for (const extra of getExtraCarryLanes(intent)) {
    if (extra.dir === 'far_flank') {
      // Lateral lane across the pitch toward the opposite touchline at roughly the
      // holder's x. Minimal forward component so it reads as a switch, not a drive.
      const towardFar = player.y < PITCH_WIDTH / 2 ? 1 : -1;
      const fdx = player.attackDir * 0.2;
      const fdy = towardFar;
      const mag = Math.sqrt(fdx * fdx + fdy * fdy);
      lanes.push({ dx: fdx / mag, dy: fdy / mag, scoreBonus: extra.scoreBonus });
    }
  }

  let bestLane: BestCarryLane | null = null;
  let bestScore: number = cfg.MIN_TOTAL_SCORE;

  // Path clearness fades both penalties when no defender stands between the carrier
  // and goal — being out of zone or near the byline only matters when defenders can
  // punish it. Wide-open run → penalty fades to 0; choked path → penalty full strength.
  const clearness     = forwardPathClearness(player, defendingOutfield);
  const penaltyDamper = 1 - clearness;

  for (const lane of lanes) {
    const breakdown = evaluateCarryLaneBreakdown(player, lane.dx, lane.dy, goalTargetY, opponents, cfg);
    const rawScore  = breakdown.score;

    // Role-fit penalty — softened when the whole team is advanced (pressing high)
    // and faded when the forward path is clear (no defender to punish the gap).
    const targetX  = player.x + lane.dx * cfg.LOOKAHEAD_DISTANCE;
    const targetY  = player.y + lane.dy * cfg.LOOKAHEAD_DISTANCE;
    const xOverrun = Math.max(0, targetX - player.bounds.maxX, player.bounds.minX - targetX);
    const yOverrun = Math.max(0, targetY - player.bounds.maxY, player.bounds.minY - targetY);
    const rolePenalty = (xOverrun + yOverrun) * cfg.ROLE_FIT_PENALTY_SCALE * rolePenaltyScale * penaltyDamper;

    // Byline penalty: forward lanes lose score in the last BYLINE_PENALTY_START yards.
    // Faded by clearness — a clear run becomes a shot, not a forced cross.
    const endLineX        = player.attackDir === 1 ? PITCH_LENGTH : 0;
    const distToEndLine   = (endLineX - player.x) * player.attackDir;
    const forwardComp     = Math.max(0, lane.dx * player.attackDir);
    let bylinePenalty = 0;
    if (distToEndLine < cfg.BYLINE_PENALTY_START && forwardComp > 0) {
      const t = 1 - distToEndLine / cfg.BYLINE_PENALTY_START; // 0 at 5 yds, 1 at endline
      bylinePenalty = t * forwardComp * cfg.BYLINE_MAX_PENALTY * penaltyDamper;
    }

    const score = rawScore - rolePenalty - bylinePenalty + (lane.scoreBonus ?? 0);

    if (score > bestScore) {
      bestScore = score;
      bestLane  = { dx: lane.dx, dy: lane.dy, score, breakdown, rolePenalty, bylinePenalty, laneBonus: lane.scoreBonus ?? 0, rawScore };
    }
  }

  return bestLane;
}

// ── Ball-holder unified scoring ───────────────────────────────────────────────

const MIN_ACTION_SCORE = 0.15;

/** Shoot breakdown — debug-only view of how the shoot ActionScore is produced. */
interface ShootBreakdown {
  dist:        number;
  openAngle:   number;
  pressure:    number;
  xg:          number;
  threshold:   number;
  roleScore:   number;
  xgFloor:     number;
  intentBonus: number;
  score:       number;
}

/** Dribble breakdown — debug-only view of how the dribble ActionScore is produced. */
interface DribbleBreakdown {
  targetId:     number | null;
  roleTendency: number;
  forwardBlock: number;
  rawScore:     number;
  score:        number;
}

/** Carry breakdown attached to the carry ActionScore (best lane only). */
interface CarryActionBreakdown {
  dx:              number;
  dy:              number;
  clearanceScore:  number;
  progressScore:   number;
  angleScore:      number;
  crowdPenalty:    number;
  roleBias:        number;
  visionBonus:     number;
  pressurePenalty: number;
  baseScore:       number;
  playerModifier:  number;
  rolePenalty:     number;
  bylinePenalty:   number;
  laneBonus:       number;
  rawScore:        number;
  score:           number;
}

/** Pass breakdown attached to the pass ActionScore (best receiver only). */
interface PassActionBreakdown extends PassBreakdown {
  toId:     number | null;
  rawScore: number;
}

interface ActionScore {
  type: 'shoot' | 'pass' | 'carry' | 'dribble' | 'through_ball';
  score: number;
  targetId?: number;
  dx?: number;
  dy?: number;
  cellX?: number;
  cellY?: number;
  intendedRunnerId?: number | null;
  shootBreakdown?:   ShootBreakdown;
  passBreakdown?:    PassActionBreakdown;
  carryBreakdown?:   CarryActionBreakdown | null;
  dribbleBreakdown?: DribbleBreakdown;
}


/**
 * The xG value at which this role considers a shot "certain enough to take".
 * xG is divided by this threshold and clamped to 1 before quadratic scoring,
 * so ST will shoot eagerly at moderate xG while CB will only shoot at high xG.
 */
const SHOOT_THRESHOLD: Record<string, number> = {
  ST:  0.25,
  LW:  0.30, RW:  0.30,
  CAM: 0.29,
  LM:  0.42, RM:  0.42,
  CM:  0.50,
  CDM: 0.60,
  LWB: 0.65, RWB: 0.65,
  LB:  0.72, RB:  0.72,
  CB:  0.78,
  GK:  9.99, // effectively never
};

function evalShoot(player: GamePlayer, opponents: GamePlayer[], intent: TeamIntent): ActionScore {
  const goalX = player.attackDir === 1 ? PITCH_LENGTH : 0;
  const dist  = Math.abs(goalX - player.x);

  const openAngle = computeOpenAngle(player.x, player.y, goalX);
  const pressure  = computeWeightedPressure(player, opponents);
  const xg        = computeXG(dist, openAngle, pressure);

  // Compress xG relative to role eagerness.
  // SHOOT_STRONG_RAW=1.5: ST at xG=0.375 (threshold=0.25 → raw=1.5) scores 0.632.
  // ST at xG=0.80 → raw=3.2 → score≈0.88. ST at xG=0.25 → raw=1.0 → score≈0.49.
  const threshold = SHOOT_THRESHOLD[player.role] ?? 0.50;
  const roleScore = compress(xg / threshold, SHOOT_STRONG_RAW);
  // High-xG floor: at near-certain chances the role gate cannot suppress the shot.
  // xG² is gentle below ~0.7 (role still decides) but dominates above ~0.9.
  const xgFloor = xg * xg;
  // Intent flat bonus (small — never large enough to force a shot from nowhere)
  const intentBonus = getShootIntentBonus(intent);
  const score = Math.max(roleScore, xgFloor) + intentBonus;
  return {
    type: 'shoot',
    score,
    shootBreakdown: {
      dist, openAngle, pressure, xg, threshold,
      roleScore, xgFloor, intentBonus, score,
    },
  };
}

function evalPass(player: GamePlayer, opponents: GamePlayer[], allPlayers: GamePlayer[], intent: TeamIntent): ActionScore {
  const teammates = allPlayers.filter(p => p.team === player.team && p.id !== player.id);
  if (teammates.length === 0) {
    return {
      type: 'pass', score: 0,
      passBreakdown: {
        toId: null, laneScore: 0, progressScore: 0, receiverSpaceScore: 0,
        distancePenalty: 0, goalProximityBonus: 0, visionRangePenalty: 0,
        passTargetBonus: 0,
        baseScore: 0, playerModifier: 0, tacticalModifier: 0,
        rawScore: 0, score: 0,
      },
    };
  }

  const lanes = evaluatePassLanes(player, teammates, opponents, intent);
  const best  = lanes.reduce((a, b) => b.score > a.score ? b : a);
  const bestReceiver = teammates.find(p => p.id === best.toId);
  const breakdown = bestReceiver
    ? scorePassToReceiverBreakdown(player, bestReceiver, opponents, intent)
    : null;

  // PASS_STRONG_RAW=0.8: a clear lane to a good receiver (raw≈0.8) scores 0.632.
  const score = compress(best.score, PASS_STRONG_RAW);
  return {
    type: 'pass', score, targetId: best.toId,
    passBreakdown: breakdown
      ? { toId: best.toId, rawScore: best.score, ...breakdown }
      : {
          toId: best.toId, laneScore: 0, progressScore: 0, receiverSpaceScore: 0,
          distancePenalty: 0, goalProximityBonus: 0, visionRangePenalty: 0,
          baseScore: 0, playerModifier: 0, tacticalModifier: 0, passTargetBonus: 0,
          rawScore: best.score, score: best.score,
        },
  };
}

function evalCarry(
  player: GamePlayer,
  outfieldOpponents: GamePlayer[],
  allPlayers: GamePlayer[],
  defendingOutfield: GridMatrix | null,
  intent: TeamIntent,
): ActionScore {
  // GK is already excluded by the caller — handled by the shoot decision (xG + GK effect).
  const lane = getBestCarryLane(player, outfieldOpponents, allPlayers, defendingOutfield, intent);
  if (!lane) return { type: 'carry', score: 0, carryBreakdown: null };

  // CARRY_STRONG_RAW=0.9: a clear lane with a solid player (raw≈0.9) scores 0.632.
  const score = compress(lane.score, CARRY_STRONG_RAW);
  const b = lane.breakdown;
  return {
    type: 'carry',
    score, dx: lane.dx, dy: lane.dy,
    carryBreakdown: {
      dx: lane.dx, dy: lane.dy,
      clearanceScore:  b.clearanceScore,
      progressScore:   b.progressScore,
      angleScore:      b.angleScore,
      crowdPenalty:    b.crowdPenalty,
      roleBias:        b.roleBias,
      visionBonus:     b.visionBonus,
      pressurePenalty: b.pressurePenalty,
      baseScore:       b.baseScore,
      playerModifier:  b.playerModifier,
      rolePenalty:     lane.rolePenalty,
      bylinePenalty:   lane.bylinePenalty,
      laneBonus:       lane.laneBonus,
      rawScore:        lane.rawScore,
      score:           lane.score,
    },
  };
}

/**
 * Evaluate through-ball candidates for the holder. Returns an ActionScore with
 * the best cell + intended runner, plus the full ranked cell list so the debug
 * emit can reuse it without re-scoring.
 *
 * `cachedCells` — if provided (the engine's per-tick TB cache), skip the grid
 * enumeration and use the cached cells. Safe because the dominant ranking
 * signals (race margin, path clearness) shift slowly, and the cache is
 * invalidated on holder change. See `tickState` in gameState.ts.
 */
function evalThroughBall(
  player:      GamePlayer,
  allPlayers:  GamePlayer[],
  crowdGrid:   CrowdGrid | null,
  cachedCells: ReturnType<typeof enumerateCandidateCells> | null = null,
): { action: ActionScore; cells: ReturnType<typeof enumerateCandidateCells> } {
  let cells: ReturnType<typeof enumerateCandidateCells>;
  if (cachedCells !== null) {
    cells = cachedCells;
  } else {
    const offsideLine = computeOffsideLine(player.attackDir, allPlayers, player.team, player.x);
    cells = enumerateCandidateCells(player, allPlayers, crowdGrid, offsideLine);
  }
  if (cells.length === 0) {
    return { action: { type: 'through_ball', score: 0 }, cells };
  }
  const best = cells[0]!;
  const score = compress(best.score, THROUGH_BALL_STRONG_RAW);
  return {
    action: {
      type: 'through_ball',
      score,
      cellX: best.x,
      cellY: best.y,
      intendedRunnerId: best.components.bestAttackerId,
    },
    cells,
  };
}

function evalDribble(player: GamePlayer, opponents: GamePlayer[]): ActionScore {
  const roleTendency = roleEngine(player.role).carryBias;
  if (roleTendency < DRIBBLE_MIN_BIAS) {
    return {
      type: 'dribble', score: 0,
      dribbleBreakdown: { targetId: null, roleTendency, forwardBlock: 0, rawScore: 0, score: 0 },
    };
  }

  let closestDist = Infinity;
  let closest: GamePlayer | null = null;
  for (const opp of opponents) {
    if (opp.recoveryTime > 0) continue; // already beaten/stunned — don't target them
    const d = Math.sqrt((opp.x - player.x) ** 2 + (opp.y - player.y) ** 2);
    if (d < closestDist) { closestDist = d; closest = opp; }
  }

  if (!closest || closestDist > DRIBBLE_ATTEMPT_RANGE) {
    return {
      type: 'dribble', score: 0,
      dribbleBreakdown: {
        targetId: closest?.id ?? null,
        roleTendency, forwardBlock: 0, rawScore: 0, score: 0,
      },
    };
  }

  // How much the defender is blocking forward progress (0 = behind, 1 = directly ahead).
  // Only worth dribbling if the defender is actually in the way.
  const fwdDx        = (closest.x - player.x) * player.attackDir;
  const fwdDist      = Math.sqrt((closest.x - player.x) ** 2 + (closest.y - player.y) ** 2);
  const forwardBlock = fwdDist > 0 ? Math.max(0, fwdDx / fwdDist) : 0;

  // Score = role says "I like dribbling" AND the defender is actually blocking me.
  // No execution quality here — that belongs in resolveDribble (gameState.ts).
  const raw   = roleTendency * 0.6 + forwardBlock * 0.4;
  const score = compress(raw, DRIBBLE_STRONG_RAW);
  return {
    type: 'dribble', score, targetId: closest.id,
    dribbleBreakdown: { targetId: closest.id, roleTendency, forwardBlock, rawScore: raw, score },
  };
}

function decideBallHolder(
  player: GamePlayer,
  allPlayers: GamePlayer[],
  crowdGrid: CrowdGrid | null,
  intent: TeamIntent,
  tbCachedCells: ReturnType<typeof enumerateCandidateCells> | null = null,
): PlayerDecision {
  // Exclude recovering opponents — they are stumbling and pose no real threat to the carrier.
  const opponents         = allPlayers.filter(p => p.team !== player.team && !isPlayerInRecovery(p));
  const outfieldOpponents = opponents.filter(p => p.role !== 'GK');
  // Defending team's outfield density grid — used by the carry path-clearness check.
  const defendingOutfield: GridMatrix | null = crowdGrid == null
    ? null
    : (player.team === 'A' ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield);

  const sh = evalShoot(player, opponents, intent);          // GK included — affects pressure calc
  const ps = evalPass(player, opponents, allPlayers, intent);
  const ca = evalCarry(player, outfieldOpponents, allPlayers, defendingOutfield, intent);  // GK excluded — handled by shoot decision
  const dr = evalDribble(player, outfieldOpponents); // GK excluded — don't dribble the GK
  const tbResult = evalThroughBall(player, allPlayers, crowdGrid, tbCachedCells);
  const tb = tbResult.action;
  const actions: ActionScore[] = [sh, ca, ps, dr, tb];

  const best = actions.reduce((a, b) => b.score > a.score ? b : a);

  if (isDebugEnabled()) {
    // Defaults guarantee every breakdown is present in the event payload, even when
    // an action returns 0 because of a hard cull (e.g. dribble bias too low, no teammates).
    const shootBd   = sh.shootBreakdown   ?? {
      dist: 0, openAngle: 0, pressure: 0, xg: 0, threshold: 0,
      roleScore: 0, xgFloor: 0, intentBonus: 0, score: 0,
    };
    const passBd    = ps.passBreakdown    ?? {
      toId: null, laneScore: 0, progressScore: 0, receiverSpaceScore: 0,
      distancePenalty: 0, goalProximityBonus: 0, visionRangePenalty: 0,
      passTargetBonus: 0,
      baseScore: 0, playerModifier: 0, tacticalModifier: 0,
      rawScore: 0, score: 0,
    };
    const dribbleBd = dr.dribbleBreakdown ?? {
      targetId: null, roleTendency: 0, forwardBlock: 0, rawScore: 0, score: 0,
    };

    gameBus.emit('decisionScores', {
      playerName:  player.name,
      playerId:    player.id,
      shoot:       sh.score,
      pass:        ps.score,
      carry:       ca.score,
      dribble:     dr.score,
      throughBall: tb.score,
      best:        best.type,
      breakdowns: {
        shoot:   shootBd,
        pass:    passBd,
        carry:   ca.carryBreakdown ?? null,
        dribble: dribbleBd,
      },
    });

    // Emit through-ball candidate cells (re-uses the same cells already scored
    // by evalThroughBall — no double work).
    gameBus.emit('throughBallScores', {
      playerId:   player.id,
      playerName: player.name,
      bestScore:  tbResult.cells.length > 0 ? tbResult.cells[0]!.score : 0,
      cells: tbResult.cells.map(c => ({
        x:                  c.x,
        y:                  c.y,
        score:              c.score,
        raceMargin:         c.components.raceMargin,
        bestAttackerId:     c.components.bestAttackerId,
        bestAttackerEta:    c.components.bestAttackerEta,
        bestDefenderId:     c.components.bestDefenderId,
        bestDefenderEta:    c.components.bestDefenderEta,
        raceMarginScore:    c.components.raceMarginScore,
        spaceQualityScore:  c.components.spaceQualityScore,
        goalThreatScore:    c.components.goalThreatScore,
        passerSkillScore:   c.components.passerSkillScore,
        pathClearScore:     c.components.pathClearScore,
        laneRiskPenalty:    c.components.laneRiskPenalty,
        offsideRiskPenalty: c.components.offsideRiskPenalty,
      })),
    });
  }

  if (best.score < MIN_ACTION_SCORE) {
    const lane = getBestCarryLane(player, outfieldOpponents, allPlayers, defendingOutfield, intent);
    if (lane) return { type: 'carry', dx: lane.dx, dy: lane.dy };
    return { type: 'pass' };
  }

  switch (best.type) {
    case 'shoot':         return { type: 'shoot' };
    case 'pass':          return { type: 'pass' };
    case 'carry':         return { type: 'carry', dx: best.dx!, dy: best.dy! };
    case 'dribble':       return { type: 'dribble', targetId: best.targetId! };
    case 'through_ball':  return {
      type: 'through_ball',
      cellX:            best.cellX!,
      cellY:            best.cellY!,
      intendedRunnerId: best.intendedRunnerId ?? null,
    };
  }
}

// ── Public decision entry point ───────────────────────────────────────────────

/**
 * Evaluate what a single player should do this tick.
 *
 * @param player        The player being evaluated.
 * @param ballHolder    The player currently holding the ball (or last holder during flight).
 * @param hasBall       True if `player` is the ball holder.
 * @param ballInFlight  True if a pass or shot is currently in flight.
 * @param allPlayers    All players — used by the carry lane scan.
 * @param setPiece      Active set piece (kickoff / offside_fk / goal_kick) — forces the
 *                      taker to pass, never carry/dribble/shoot. Non-takers behave normally.
 * @param crowdGrid     Per-tick density grid; carry scoring uses the defending team's
 *                      outfield matrix to fade role-fit/byline penalties on a clear run.
 *                      Pass `null` to skip the clearness check (penalties stay full).
 */
export function decide(
  player: GamePlayer,
  ballHolder: GamePlayer,
  hasBall: boolean,
  ballInFlight: boolean,
  allPlayers: GamePlayer[],
  offsideLine: number | null,
  possessionTime: number,
  setPiece: SetPiece | null = null,
  crowdGrid: CrowdGrid | null = null,
  teamIntent: { A: TeamIntent; B: TeamIntent } = { A: 'balanced', B: 'balanced' },
  tbCachedCells: ReturnType<typeof enumerateCandidateCells> | null = null,
): PlayerDecision {

  // ── With ball — unified scoring ─────────────────────────────────────────
  if (hasBall) {
    // Set-piece taker must play the ball — no carrying, no dribbling, no shooting
    if (setPiece && player.id === setPiece.takerId) {
      return { type: 'pass' };
    }
    return decideBallHolder(player, allPlayers, crowdGrid, teamIntent[player.team], tbCachedCells);
  }

  // ── Attacking teammate (off-ball) ───────────────────────────────────────
  if (player.team === ballHolder.team) {
    if (player.role === 'GK') return { type: 'idle' };
    return evaluateOffBall(player, ballHolder, allPlayers, offsideLine, teamIntent[player.team], crowdGrid);
  }

  const dx   = ballHolder.x - player.x;
  const dy   = ballHolder.y - player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Players recovering from a duel cannot press or tackle — they're still stumbling.
  if (isPlayerInRecovery(player)) {
    return { type: 'idle' };
  }

  // Tackle is always available regardless of press rank
  if (dist <= TACKLE_RANGE) {
    return { type: 'tackle', targetId: ballHolder.id };
  }

  // GK never presses — always holds position.
  if (player.role === 'GK') {
    return { type: 'idle' };
  }

  // ── Defending decision (score-based, mirrors evaluateOffBall pattern) ────
  return evaluateDefensiveDecision(player, ballHolder, allPlayers, possessionTime, crowdGrid, teamIntent[player.team]);
}
