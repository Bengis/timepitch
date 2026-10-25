/**
 * PassLanes — evaluates and scores every possible pass from the ball holder.
 *
 * Each candidate (teammate) receives a total score composed of:
 *   baseScore      = laneScore + progressScore + receiverSpaceScore + goalProximityBonus − distancePenalty
 *   playerModifier = passingSkill + vision + receiverControl
 *   tacticalModifier = 0 (reserved for future tactics system)
 *
 * Source of truth: .claude/rules/game-engine/pass.md
 *
 * Used by:
 *   - gameState.startPass()  → picks highest-scoring candidate
 *   - PixiPitch.tsx          → debug overlay (green = open, red = below threshold)
 */

import type { GamePlayer, GameState, TeamIntent } from '@/GameEngine/types';
import { normalizeGamePlayers } from '@/GameEngine/Domain/RuntimeLineup';
import { PASS_CONFIG } from '@/GameEngine/Configs/PassConfig';
import { getTeamPassConfig, getTeamWidth } from '@/GameEngine/Configs/AttackConfig';
import { applyPassIntent, getPassTargetBias } from '@/GameEngine/Configs/IntentConfig';
import { computeOpenAngle, MAX_OPEN_ANGLE } from '@/GameEngine/Infrastructure/ActionOutcomes';
import { PITCH_LENGTH, PITCH_WIDTH } from '@/GameEngine/Domain/pitch';

export interface PassLaneInfo {
  toId: number;
  /** Receiver's position at evaluation time */
  toX: number;
  toY: number;
  /** True when score ≥ MIN_PASS_SCORE — drives green/red debug overlay */
  open: boolean;
  /** 0..1 total pass score — higher is better */
  score: number;
  /**
   * True when this pass earned a positive far-flank (switch-of-play) bonus.
   * Derived generically from the active intent's `passTarget` descriptor, never
   * by naming an intent — so the startPass emission site can count switches
   * without re-deriving the geometry.
   */
  switchPass: boolean;
}

// ── Scoring components ────────────────────────────────────────────────────────

/**
 * Lane quality — 0..1 based on perpendicular clearance from opponents along the pass line.
 * 0 = fully blocked, 1 = fully clear.
 *
 * Distance-adaptive clearance: short passes use a smaller BLOCK_RADIUS so central
 * triangles remain viable. The scale factor is tied to the team's width tactic:
 *   narrow  → tacticFloor 0.25 — 5-yd pass uses blockR 0.75 yds
 *   normal  → tacticFloor 0.40 — 5-yd pass uses blockR 1.20 yds
 *   wide    → tacticFloor 0.55 — minimal change, width still rewarded
 *
 * At 30+ yards all tactics converge to shortFactor=1.0 (blockR = 3.0, unchanged).
 */
function getLaneScore(
  from:        { x: number; y: number },
  to:          { x: number; y: number },
  opponents:   GamePlayer[],
  widthTactic: 'narrow' | 'normal' | 'wide' = 'normal',
): number {
  const vx    = to.x - from.x;
  const vy    = to.y - from.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1) return 1; // same position

  // Shorter passes get more lenient clearance thresholds in central zones.
  // Tactic floor: narrow teams benefit most, wide teams benefit least.
  const tacticFloor = widthTactic === 'narrow' ? 0.25 : widthTactic === 'normal' ? 0.40 : 0.55;
  const passDist    = Math.sqrt(lenSq);
  const shortFactor = Math.max(tacticFloor, Math.min(1, passDist / 30));
  const blockR      = PASS_CONFIG.BLOCK_RADIUS * shortFactor;
  const clearR      = PASS_CONFIG.CLEAR_RADIUS * shortFactor;

  let minPerpDist = Infinity;
  for (const opp of opponents) {
    const ox = opp.x - from.x;
    const oy = opp.y - from.y;
    const t  = (ox * vx + oy * vy) / lenSq;
    if (t < 0.1 || t > 1.0) continue; // outside the relevant corridor

    const perpDist = Math.sqrt((ox - t * vx) ** 2 + (oy - t * vy) ** 2);
    minPerpDist = Math.min(minPerpDist, perpDist);
  }

  if (minPerpDist === Infinity) return 1;
  // Ramp from 0 (at blockR) to 1 (at clearR)
  return Math.max(0, Math.min(1, (minPerpDist - blockR) / (clearR - blockR)));
}

/**
 * Forward progress — 0..1 based on how much the pass advances toward the opponent's goal.
 * Lateral passes score ~0.5; backward passes trend toward 0; forward passes toward 1.
 *
 * Uses holder.attackDir (not team) so this stays correct after half-time side-switching.
 */
function getProgressScore(holder: GamePlayer, receiver: GamePlayer): number {
  const dx = (receiver.x - holder.x) * holder.attackDir;
  // 30+ yds forward = 1.0 | lateral = 0.5 | 30+ yds backward = 0.0
  return Math.max(0, Math.min(1, (dx + 30) / 60));
}

/**
 * Receiver space — 0..1 based on how much room the receiver has.
 * Combines nearest-opponent distance with crowding count.
 */
function getReceiverSpaceScore(receiver: GamePlayer, opponents: GamePlayer[]): number {
  let count   = 0;
  let minDist = Infinity;
  for (const opp of opponents) {
    const d = Math.sqrt((opp.x - receiver.x) ** 2 + (opp.y - receiver.y) ** 2);
    if (d < PASS_CONFIG.RECEIVER_SPACE_RADIUS) count++;
    minDist = Math.min(minDist, d);
  }
  const crowdingPenalty = Math.min(1, count / 3);
  const nearestScore    = Math.min(1, minDist / PASS_CONFIG.RECEIVER_SPACE_RADIUS);
  return (1 - crowdingPenalty) * 0.5 + nearestScore * 0.5;
}

/**
 * Distance penalty — 0..1 penalty that grows with pass length.
 * Longer passes are riskier and harder to execute.
 */
function getDistancePenalty(holder: GamePlayer, receiver: GamePlayer): number {
  const dist = Math.sqrt((receiver.x - holder.x) ** 2 + (receiver.y - holder.y) ** 2);
  return Math.min(1, dist / PASS_CONFIG.MAX_PASS_DISTANCE);
}

/**
 * Vision range penalty — penalises passes beyond the holder's vision horizon.
 *
 * A player with vision=10 has no extra penalty (horizon = MAX_PASS_DISTANCE).
 * A player with vision=1  starts getting penalised beyond 25 yards.
 *
 * horizon = 25 + (vision / 10) * (MAX_PASS_DISTANCE - 25)
 * penalty = clamp((dist - horizon) / horizon, 0, 1)
 */
const VISION_RANGE_MIN_HORIZON = 25; // yards — low-vision players see this far clearly

function getVisionRangePenalty(holder: GamePlayer, receiver: GamePlayer): number {
  const vision   = holder.runtimeStats.withBall.vision; // 0..1
  const horizon  = VISION_RANGE_MIN_HORIZON + vision * (PASS_CONFIG.MAX_PASS_DISTANCE - VISION_RANGE_MIN_HORIZON);
  const dist     = Math.sqrt((receiver.x - holder.x) ** 2 + (receiver.y - holder.y) ** 2);
  const overrun  = dist - horizon;
  return overrun <= 0 ? 0 : Math.min(1, overrun / horizon);
}

/**
 * Goal proximity bonus — 0..1 based on how dangerous the receiver's
 * position is relative to the opponent's goal.
 *
 * Combines two factors:
 *   - Distance to goal (quadratic ramp inside GOAL_PROXIMITY_HORIZON)
 *   - Open angle to goal (how central the receiver is — wider angle = better)
 *
 * Angle is weighted more heavily (0.65 vs 0.35) because two players at the
 * same distance can have vastly different threat levels based on their
 * lateral position — a central player near the posts has a far better
 * shooting opportunity than one out wide. The angle bonus is **also scaled
 * by proximity** — a clear view of goal from 50 yards away doesn't translate
 * to a real shooting threat (the receiver still has to cover that distance).
 * Without this gate, soft-cliff pass scoring overestimates passes into space
 * outside the box because of the open-angle bonus.
 *
 * Soft cliff: previously the function returned 0 for any receiver outside the
 * attacking third (38.33 yds). That binary cutoff penalised passes into space
 * just outside the third even when the receiver had a clear run to goal. The
 * horizon now extends to GOAL_PROXIMITY_HORIZON (55 yds) — same shape, just
 * stretched — so partial credit applies through the middle third.
 */
function getGoalProximityBonus(holder: GamePlayer, receiver: GamePlayer): number {
  const goalX = holder.attackDir === 1 ? PITCH_LENGTH : 0;
  const receiverDist = Math.abs(goalX - receiver.x);

  if (receiverDist > PASS_CONFIG.GOAL_PROXIMITY_HORIZON) return 0;

  const proximity = 1 - receiverDist / PASS_CONFIG.GOAL_PROXIMITY_HORIZON;
  const distFactor = proximity * proximity;

  const openAngle = computeOpenAngle(receiver.x, receiver.y, goalX);
  const angleFactor = Math.min(1, openAngle / MAX_OPEN_ANGLE);

  // Angle gated by proximity: a wide-open angle from 50 yds out is not the
  // same threat as the same angle from the penalty spot.
  return distFactor * 0.35 + angleFactor * proximity * 0.65;
}

/**
 * Width preference score — 0..1 based on lateral distance from pitch center.
 * Reserved for future tactical use; currently returns 0 (neutral).
 */
function getWidthScore(_receiver: GamePlayer): number {
  return 0;
}

/**
 * Far-flank reward — 0..1 for a receiver on the OPPOSITE side of the pitch
 * (relative to y-centre) from the holder. Ramps from 0 at the centre line to
 * 1 at the far touchline. Returns 0 when the receiver is on the holder's own
 * side, so it only rewards genuine switches of play.
 *
 * Generic geometric primitive — the consumer (scorePassToReceiverBreakdown)
 * applies it whenever an intent declares a `far_flank` passTarget bias, never
 * by naming a specific intent.
 */
function getFarFlankScore(holder: GamePlayer, receiver: GamePlayer): number {
  const holderFromCentre   = holder.y - PITCH_WIDTH / 2;
  const receiverFromCentre = receiver.y - PITCH_WIDTH / 2;
  if (holderFromCentre === 0) return 0;
  const onFarSide = Math.sign(receiverFromCentre) === -Math.sign(holderFromCentre);
  if (!onFarSide) return 0;
  return Math.min(1, Math.abs(receiverFromCentre) / (PITCH_WIDTH / 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score a single pass from `holder` to `receiver`.
 *
 * Single-receiver version of the full scoring logic — used by both
 * evaluatePassLanes (all teammates) and OffBallMovement (off-ball positioning).
 *
 * Formula (per pass.md):
 *   baseScore      = progress·W + lane·W + receiverSpace·W + goalProximity·W − distance·W
 *   playerModifier = passingSkill·W + vision·W + receiverControl·W
 *   tacticalModifier = widthScore × WIDTH_PREFERENCE_WEIGHT  (reserved)
 *
 * Weights come from getTeamPassConfig(holder.team) so build_up tactics apply.
 */
/** Per-component breakdown of a pass evaluation — used by the debug panel. */
export interface PassBreakdown {
  laneScore:          number;
  progressScore:      number;
  receiverSpaceScore: number;
  distancePenalty:    number;
  goalProximityBonus: number;
  visionRangePenalty: number;
  baseScore:          number;
  playerModifier:     number;
  tacticalModifier:   number;
  passTargetBonus:    number;
  score:              number;
}

export function scorePassToReceiverBreakdown(
  holder:    GamePlayer,
  receiver:  GamePlayer,
  opponents: GamePlayer[],
  intent:    TeamIntent = 'balanced',
): PassBreakdown {
  const baseCfg     = getTeamPassConfig(holder.team);
  const cfg         = { ...baseCfg, ...applyPassIntent(baseCfg, intent) };
  const widthTactic = getTeamWidth(holder.team);

  const laneScore          = getLaneScore(holder, receiver, opponents, widthTactic);
  const progressScore      = getProgressScore(holder, receiver);
  const receiverSpaceScore = getReceiverSpaceScore(receiver, opponents);
  const distancePenalty    = getDistancePenalty(holder, receiver);
  const goalProximityBonus = getGoalProximityBonus(holder, receiver);
  const visionRangePenalty = getVisionRangePenalty(holder, receiver);

  const baseScore =
    progressScore      * cfg.PROGRESS_WEIGHT         +
    laneScore          * cfg.LANE_WEIGHT              +
    receiverSpaceScore * cfg.RECEIVER_SPACE_WEIGHT    +
    goalProximityBonus * cfg.GOAL_PROXIMITY_WEIGHT    -
    distancePenalty    * cfg.DISTANCE_PENALTY_WEIGHT  -
    visionRangePenalty * cfg.DISTANCE_PENALTY_WEIGHT;

  // Gate playerModifier by laneScore — mirrors how carry gates its playerModifier
  // by clearanceScore. A blocked pass gets little player-skill bonus; a clear pass
  // gets the full bonus. Without gating, the unconditional +0.40 inflates every pass
  // score and pass wins regardless of carry quality.
  const rawModifier =
    holder.runtimeStats.withBall.passingSkill  * PASS_CONFIG.PASSING_SKILL_WEIGHT    +
    holder.runtimeStats.withBall.vision        * PASS_CONFIG.VISION_WEIGHT           +
    receiver.runtimeStats.withBall.firstTouch  * PASS_CONFIG.RECEIVER_CONTROL_WEIGHT;
  const playerModifier = rawModifier * laneScore;

  const tacticalModifier =
    getWidthScore(receiver) * PASS_CONFIG.WIDTH_PREFERENCE_WEIGHT;

  // Additive pass-target bias — declared by the intent's passTarget descriptor
  // and resolved generically here. switch_play declares { kind: 'far_flank' };
  // any future intent reusing this kind needs zero changes to this consumer.
  const passTargetBias = getPassTargetBias(intent);
  let passTargetBonus = 0;
  if (passTargetBias && passTargetBias.kind === 'far_flank') {
    passTargetBonus = getFarFlankScore(holder, receiver) * passTargetBias.weight;
  }

  return {
    laneScore, progressScore, receiverSpaceScore,
    distancePenalty, goalProximityBonus, visionRangePenalty,
    baseScore, playerModifier, tacticalModifier, passTargetBonus,
    score: Math.max(0, baseScore + playerModifier + tacticalModifier + passTargetBonus),
  };
}

export function scorePassToReceiver(
  holder:    GamePlayer,
  receiver:  GamePlayer,
  opponents: GamePlayer[],
  intent:    TeamIntent = 'balanced',
): number {
  return scorePassToReceiverBreakdown(holder, receiver, opponents, intent).score;
}

/**
 * Score all pass candidates from `holder` to each teammate.
 * Delegates to scorePassToReceiver for each candidate.
 */
export function evaluatePassLanes(
  holder:    GamePlayer,
  teammates: GamePlayer[],
  opponents: GamePlayer[],
  intent:    TeamIntent = 'balanced',
): PassLaneInfo[] {
  const baseCfg = getTeamPassConfig(holder.team);
  const cfg     = { ...baseCfg, ...applyPassIntent(baseCfg, intent) };

  return teammates.map(receiver => {
    const bd = scorePassToReceiverBreakdown(holder, receiver, opponents, intent);
    return {
      toId:       receiver.id,
      toX:        receiver.x,
      toY:        receiver.y,
      open:       bd.score >= cfg.MIN_PASS_SCORE,
      score:      bd.score,
      switchPass: bd.passTargetBonus > 0,
    };
  });
}

/** Convenience: derive pass lanes directly from a GameState. */
export function getPassLanes(state: GameState): PassLaneInfo[] {
  const players = normalizeGamePlayers(state.players);
  const holder = players.find(p => p.id === state.ballHolderId);
  if (!holder) return [];
  const teammates = players.filter(p => p.team === holder.team && p.id !== holder.id);
  const opponents = players.filter(p => p.team !== holder.team);
  const intent    = state.teamIntent?.[holder.team] ?? 'balanced';
  return evaluatePassLanes(holder, teammates, opponents, intent);
}

/**
 * isLaneOpen — kept for external callers that only need a boolean check.
 * Uses the existing BLOCK_RADIUS threshold (perpendicular distance).
 */
export function isLaneOpen(
  from:      { x: number; y: number },
  to:        { x: number; y: number },
  opponents: GamePlayer[],
): boolean {
  return getLaneScore(from, to, opponents) > 0;
}

