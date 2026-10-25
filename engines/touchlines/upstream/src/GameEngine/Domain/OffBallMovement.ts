import type { GamePlayer, PlayerRole, TeamIntent } from '@/GameEngine/types';
import type { PlayerDecision } from '@/GameEngine/Domain/DecisionTree';
import { scorePassToReceiver } from '@/GameEngine/Domain/PassLanes';
import { roleEngine } from '@/GameEngine/Domain/roleEngineData';
import { applyOffBallIntent } from '@/GameEngine/Configs/IntentConfig';
import {
  OFF_BALL_CONFIG,
  INTENT_BUILD_UP,
  INTENT_WIDTH,
} from '@/GameEngine/Configs/OffBallConfig';
import {
  getTeamBuildUp,
  getTeamWidth,
  ATTACK_CONFIG,
} from '@/GameEngine/Configs/AttackConfig';
import { isDebugEnabled } from '@/GameEngine/Suport/DebugLog';
import { gameBus } from '@/GameEngine/Infrastructure/EventBus';
import { PITCH_LENGTH, PITCH_WIDTH } from '@/GameEngine/Domain/pitch';
import {
  sampleCellSum,
  sampleCellSumExcluding,
  SAMPLE_PER_PLAYER_3x3,
  type CrowdGrid,
  type GridMatrix,
} from '@/GameEngine/Infrastructure/CrowdGrid';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Off-ball intents — answer "what is this player trying to do without the ball?"
 *
 *  • `offer_support` — receive now: become a clean passing option for the holder.
 *  • `hold_space`    — occupy a quiet zone in the team shape (ball-independent).
 *  • `make_run`      — break behind the defensive line into low-density space ahead.
 */
export type OffBallIntent = 'offer_support' | 'hold_space' | 'make_run';

const ALL_INTENTS: OffBallIntent[] = ['offer_support', 'hold_space', 'make_run'];

// ── Constants ─────────────────────────────────────────────────────────────────

const CREATE_SPACE_MIN_BIAS = 0.5;

// ── Public role helpers ───────────────────────────────────────────────────────

export function getOffBallBias(role: PlayerRole): number {
  return roleEngine(role).offBallBias;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface OffBallContext {
  player:        GamePlayer;
  ballHolder:    GamePlayer;
  allPlayers:    GamePlayer[];
  opponents:     GamePlayer[];
  offsideLine:   number | null;
  intent:        TeamIntent;

  /** Own-team outfield density grid. */
  teammatesGrid: GridMatrix;
  /** Opposing-team outfield density grid. */
  opponentsGrid: GridMatrix;

  // Derived signals
  currentPassScore: number;
  isAheadOfBall:    boolean;
  relativeAdvance:  number;
  localPressure:    number;
  buildUpTactic:    'possession' | 'balanced' | 'direct';
  widthTactic:      'narrow' | 'normal' | 'wide';
  attackDir:        number;
}

function buildContext(
  player:      GamePlayer,
  ballHolder:  GamePlayer,
  allPlayers:  GamePlayer[],
  opponents:   GamePlayer[],
  offsideLine: number | null,
  intent:      TeamIntent,
  crowdGrid:   CrowdGrid,
): OffBallContext {
  const relativeAdvance = (player.x - ballHolder.x) * player.attackDir;
  const isAheadOfBall   = relativeAdvance > 0;

  // Local pressure: opponent density near player (0..1)
  let pressureCount = 0;
  for (const opp of opponents) {
    const d = Math.sqrt((opp.x - player.x) ** 2 + (opp.y - player.y) ** 2);
    if (d < OFF_BALL_CONFIG.LOCAL_PRESSURE_RADIUS) pressureCount++;
  }
  const localPressure = Math.min(1, pressureCount / 2);

  const teammatesGrid = player.team === 'A' ? crowdGrid.teamAOutfield : crowdGrid.teamBOutfield;
  const opponentsGrid = player.team === 'A' ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield;

  return {
    player, ballHolder, allPlayers, opponents, offsideLine, intent,
    teammatesGrid, opponentsGrid,
    currentPassScore: scorePassToReceiver(ballHolder, player, opponents, intent),
    isAheadOfBall,
    relativeAdvance,
    localPressure,
    buildUpTactic: getTeamBuildUp(player.team),
    widthTactic:   getTeamWidth(player.team),
    attackDir:     player.attackDir,
  };
}

// ── Stage 1: Intent selection ─────────────────────────────────────────────────

function selectOffBallIntent(ctx: OffBallContext): {
  intent: OffBallIntent;
  scores: Record<OffBallIntent, number>;
} {
  const roleWeights     = roleEngine(ctx.player.role).offBallIntentWeights;
  const buildUpMult     = INTENT_BUILD_UP[ctx.buildUpTactic];
  const widthMult       = INTENT_WIDTH[ctx.widthTactic];
  const movementUrgency = Math.max(0, 1 - ctx.currentPassScore);

  const scores: Record<OffBallIntent, number> = {
    offer_support: 0,
    hold_space:    0,
    make_run:      0,
  };

  for (const i of ALL_INTENTS) {
    scores[i] = roleWeights[i] * buildUpMult[i] * widthMult[i];
  }

  // offer_support — primary answer to "I am a poor passing option / under pressure".
  if (ctx.currentPassScore < OFF_BALL_CONFIG.LOW_PASS_SCORE) {
    scores.offer_support *= 1 + (1 - ctx.currentPassScore) * 1.5;
  }
  scores.offer_support *= (0.4 + ctx.localPressure * 0.6 + movementUrgency * 0.5);

  // hold_space — wins when nothing is urgent (good pass score, low pressure).
  // This is the "team shape preserver" intent: passive presence in the role zone.
  scores.hold_space *= (0.6 + (1 - movementUrgency) * 0.6 + (1 - ctx.localPressure) * 0.3);

  // make_run — boost when holder just received (give-and-go pattern).
  if (ctx.ballHolder.justReceivedTicks > 0) {
    const distToHolder = Math.sqrt(
      (ctx.player.x - ctx.ballHolder.x) ** 2 + (ctx.player.y - ctx.ballHolder.y) ** 2,
    );
    if (distToHolder < 15) scores.make_run += 0.35;
  }

  // make_run — fade if already very far ahead (avoid blind charges past defenders).
  if (ctx.relativeAdvance > OFF_BALL_CONFIG.MAX_ADVANCE_THRESHOLD) {
    const excess = ctx.relativeAdvance - OFF_BALL_CONFIG.MAX_ADVANCE_THRESHOLD;
    const range  = OFF_BALL_CONFIG.MAX_ADVANCE_AHEAD - OFF_BALL_CONFIG.MAX_ADVANCE_THRESHOLD;
    const t      = Math.min(1, excess / range);
    scores.make_run *= (1 - t * 0.9);
  }
  // Too far behind to make a useful penetrating run.
  if (ctx.relativeAdvance < -20) scores.make_run *= 0.5;

  // ── Team intent multipliers (counter_attack, etc.) ────────────────────────
  const finalScores = applyOffBallIntent(scores, ctx.intent);

  let best: OffBallIntent = 'offer_support';
  let bestScore = -Infinity;
  for (const i of ALL_INTENTS) {
    if (finalScores[i] > bestScore) { bestScore = finalScores[i]; best = i; }
  }
  return { intent: best, scores: finalScores };
}

// ── Stage 2: Candidate generation ─────────────────────────────────────────────

interface Anchor {
  x: number;
  y: number;
  searchRadius: number;
}

/**
 * Anchor + search radius per intent. The anchor decides where the cell scan is
 * centred; the radius decides how far around it we look.
 */
function getAnchor(intent: OffBallIntent, ctx: OffBallContext): Anchor {
  const { player, ballHolder, attackDir } = ctx;

  switch (intent) {
    case 'offer_support': {
      // Midway between player and holder — biased slightly toward the player so
      // close support partners scan their own neighbourhood instead of the ball.
      return {
        x: player.x * 0.6 + ballHolder.x * 0.4,
        y: player.y * 0.6 + ballHolder.y * 0.4,
        searchRadius: OFF_BALL_CONFIG.SUPPORT_SEARCH_RADIUS,
      };
    }
    case 'hold_space': {
      // Formation slot — ball-independent. This is what stops everyone collapsing
      // toward the ball and lets wide players hold width when central play happens.
      return {
        x: player.basePosition.x,
        y: player.basePosition.y,
        searchRadius: OFF_BALL_CONFIG.HOLD_SEARCH_RADIUS,
      };
    }
    case 'make_run': {
      // Player position, biased forward by half the search radius so the scan
      // window lives ahead of the player.
      const fwd = OFF_BALL_CONFIG.RUN_SEARCH_RADIUS * 0.5;
      return {
        x: player.x + attackDir * fwd,
        y: player.y,
        searchRadius: OFF_BALL_CONFIG.RUN_SEARCH_RADIUS,
      };
    }
  }
}

/**
 * Sample candidate target cells in a square window around `anchor`. Candidates
 * are clamped to the pitch interior (1 yard from the touchlines). Step size
 * is grid-derived so candidates roughly align with crowd-grid resolution.
 */
function generateGridCandidates(
  anchor: Anchor,
): { x: number; y: number }[] {
  const step = OFF_BALL_CONFIG.CANDIDATE_STEP;
  const r    = anchor.searchRadius;
  const out: { x: number; y: number }[] = [];
  for (let dx = -r; dx <= r; dx += step) {
    for (let dy = -r; dy <= r; dy += step) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (x < 1 || x > PITCH_LENGTH - 1) continue;
      if (y < 1 || y > PITCH_WIDTH  - 1) continue;
      out.push({ x, y });
    }
  }
  return out;
}

// ── Stage 3: Cell scoring ─────────────────────────────────────────────────────

/**
 * 3×3 sample → approximate "nearby player count" (0 = empty).
 * When `excludeSelf` is given, the player's own footprint is subtracted so a
 * runner sampling its own teammate grid doesn't see itself as a teammate.
 */
function densityCount(
  grid: GridMatrix, x: number, y: number,
  excludeSelf: GamePlayer | null = null,
): number {
  const sum = excludeSelf
    ? sampleCellSumExcluding(grid, x, y, excludeSelf.x, excludeSelf.y, 1)
    : sampleCellSum(grid, x, y, 1);
  return sum / SAMPLE_PER_PLAYER_3x3;
}

/** Soft penalty for cells outside the player's role bounds. */
function getRoleFitPenalty(player: GamePlayer, target: { x: number; y: number }): number {
  const xOverrun = Math.max(0,
    target.x - player.bounds.maxX,
    player.bounds.minX - target.x,
  );
  const yOverrun = Math.max(0,
    target.y - player.bounds.maxY,
    player.bounds.minY - target.y,
  );
  return (xOverrun + yOverrun) * OFF_BALL_CONFIG.ROLE_FIT_PENALTY_SCALE;
}

/** Offside overrun penalty (0 when target is safely behind the line). */
function getOffsidePenalty(target: { x: number; y: number }, ctx: OffBallContext): number {
  if (ctx.offsideLine === null) return 0;
  const safeX   = ctx.offsideLine - ctx.attackDir * ATTACK_CONFIG.OFFSIDE_MARGIN;
  const overrun = (target.x - safeX) * ctx.attackDir;
  return overrun > 0 ? overrun * ATTACK_CONFIG.OFFSIDE_AWARENESS * 0.15 : 0;
}

/** Same-role cluster penalty (tightens the spread of duplicate roles). */
function sameRolePenalty(target: { x: number; y: number }, ctx: OffBallContext): number {
  let pen = 0;
  for (const p of ctx.allPlayers) {
    if (p.id === ctx.player.id || p.team !== ctx.player.team || p.role !== ctx.player.role) continue;
    const d = Math.sqrt((p.x - target.x) ** 2 + (p.y - target.y) ** 2);
    if (d < OFF_BALL_CONFIG.IDEAL_SPACING) {
      pen += (1 - d / OFF_BALL_CONFIG.IDEAL_SPACING) * OFF_BALL_CONFIG.CLUSTER_PENALTY_PER_PLAYER * 2;
    }
  }
  return pen;
}

/**
 * Score a single candidate cell for the chosen intent. Each intent reads
 * different signals from the crowd grid, so the formulas are intentionally
 * intent-specific instead of a giant single weighted sum.
 *
 * Returned score is roughly [-1, 2]. Compared across cells of the same intent.
 */
function scoreCell(
  intent: OffBallIntent,
  target: { x: number; y: number },
  ctx:    OffBallContext,
): number {
  // Exclude self from teammate density — otherwise the player's own footprint
  // bleeds into nearby cells and makes the central gap look "crowded with
  // teammates" when in fact it's just the player itself.
  const teammatesNear = densityCount(ctx.teammatesGrid, target.x, target.y, ctx.player);
  const opponentsNear = densityCount(ctx.opponentsGrid, target.x, target.y);

  // 0..1 — drops as teammates / opponents stack up nearby.
  const separation   = Math.max(0, 1 - teammatesNear / OFF_BALL_CONFIG.SEPARATION_NORM_PLAYERS);
  const markFreedom  = Math.max(0, 1 - opponentsNear / OFF_BALL_CONFIG.MARK_NORM_PLAYERS);

  const roleFitPen   = getRoleFitPenalty(ctx.player, target) * OFF_BALL_CONFIG.ROLE_FIT_WEIGHT;
  const offsidePen   = getOffsidePenalty(target, ctx);
  const sameRolePen  = sameRolePenalty(target, ctx);

  switch (intent) {
    case 'offer_support': {
      // Pass quality from holder to this cell — the dominant signal here.
      const passQ = scorePassToCell(ctx.ballHolder, target, ctx.opponents, ctx.intent);
      return passQ        * OFF_BALL_CONFIG.SUPPORT_PASS_W
           + markFreedom  * OFF_BALL_CONFIG.SUPPORT_MARK_W
           + separation   * OFF_BALL_CONFIG.SUPPORT_SEP_W
           - roleFitPen
           - sameRolePen
           - offsidePen;
    }

    case 'hold_space': {
      // Ball-independent: stay in role zone, away from teammates.
      const slotDx       = target.x - ctx.player.basePosition.x;
      const slotDy       = target.y - ctx.player.basePosition.y;
      const slotDist     = Math.sqrt(slotDx * slotDx + slotDy * slotDy);
      const slotProx     = Math.max(0, 1 - slotDist / OFF_BALL_CONFIG.HOLD_SLOT_SOFT_RADIUS);
      return separation  * OFF_BALL_CONFIG.HOLD_SEP_W
           + slotProx    * OFF_BALL_CONFIG.HOLD_SLOT_W
           + markFreedom * OFF_BALL_CONFIG.HOLD_MARK_W
           - roleFitPen
           - sameRolePen
           - offsidePen;
    }

    case 'make_run': {
      // Forward progress + open lane behind defenders.
      const dxFwd          = (target.x - ctx.player.x) * ctx.attackDir;
      const forwardProg    = Math.max(0, dxFwd) / OFF_BALL_CONFIG.RUN_SEARCH_RADIUS;
      // Light penalty for clustering with teammates — runs should split, not stack.
      const teammateLight  = separation * 0.5 + 0.5;
      return forwardProg   * OFF_BALL_CONFIG.RUN_PROGRESS_W
           + markFreedom   * OFF_BALL_CONFIG.RUN_CLEAR_W
           + teammateLight * OFF_BALL_CONFIG.RUN_SEP_W
           - roleFitPen
           - sameRolePen
           - offsidePen;
    }
  }
}

/**
 * Lightweight pass quality from `from` to a target *cell* (not a real teammate).
 * Builds a synthetic receiver-like object so we can reuse `scorePassToReceiver`
 * without spreading pass-scoring logic into this file.
 */
function scorePassToCell(
  from:      GamePlayer,
  target:    { x: number; y: number },
  opponents: GamePlayer[],
  intent:    TeamIntent,
): number {
  // Synthetic receiver inheriting from team data — only x/y differ from the
  // evaluating player. firstTouch defaults to a neutral 0.5 so cells aren't
  // scored as if a worldclass receiver lives there.
  const synthetic = {
    ...from,
    x: target.x,
    y: target.y,
    runtimeStats: {
      ...from.runtimeStats,
      withBall: { ...from.runtimeStats.withBall, firstTouch: 0.5 },
    },
  } as GamePlayer;
  return scorePassToReceiver(from, synthetic, opponents, intent);
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function createSpaceDirection(
  player: GamePlayer, allPlayers: GamePlayer[],
): { dx: number; dy: number } {
  let nearestOpp: GamePlayer | null = null;
  let nearestDist = Infinity;
  for (const p of allPlayers) {
    if (p.team === player.team) continue;
    const d = Math.sqrt((p.x - player.x) ** 2 + (p.y - player.y) ** 2);
    if (d < nearestDist) { nearestDist = d; nearestOpp = p; }
  }
  if (!nearestOpp || nearestDist < 0.1) return { dx: player.attackDir, dy: 0 };
  let awayDx = player.x - nearestOpp.x;
  let awayDy = player.y - nearestOpp.y;
  const len  = Math.sqrt(awayDx * awayDx + awayDy * awayDy);
  awayDx /= len; awayDy /= len;
  return { dx: awayDx, dy: awayDy };
}

// ── Main evaluator ────────────────────────────────────────────────────────────

export function evaluateOffBall(
  player:      GamePlayer,
  ballHolder:  GamePlayer,
  allPlayers:  GamePlayer[],
  offsideLine: number | null,
  teamIntent:  TeamIntent = 'balanced',
  crowdGrid:   CrowdGrid | null = null,
): PlayerDecision {
  // Without a crowd grid we have no candidate signal. Fall back to idle —
  // the only call site that can omit the grid is one-off MCP queries that
  // accept reduced fidelity.
  if (crowdGrid == null) return { type: 'idle' };

  const opponents = allPlayers.filter(p => p.team !== player.team);
  const ctx = buildContext(player, ballHolder, allPlayers, opponents, offsideLine, teamIntent, crowdGrid);

  const { intent, scores: intentScores } = selectOffBallIntent(ctx);

  const anchor     = getAnchor(intent, ctx);
  const candidates = generateGridCandidates(anchor);

  let bestScore  = -Infinity;
  let bestTarget = { x: player.x + ctx.attackDir, y: player.y };
  for (const cell of candidates) {
    const s = scoreCell(intent, cell, ctx);
    if (s > bestScore) { bestScore = s; bestTarget = cell; }
  }

  // Fallback when even the best cell fails the threshold.
  if (bestScore < OFF_BALL_CONFIG.MIN_SCORE_THRESHOLD) {
    const roleBias = getOffBallBias(player.role);
    if (roleBias >= CREATE_SPACE_MIN_BIAS) {
      const away = createSpaceDirection(player, allPlayers);
      if (isDebugEnabled()) {
        gameBus.emit('offBallScores', {
          playerId: player.id, playerName: player.name,
          bestScore, intent, intentScores, decision: 'create_space',
          currentPassScore: ctx.currentPassScore,
        });
      }
      return { type: 'create_space', dx: away.dx, dy: away.dy };
    }
    if (isDebugEnabled()) {
      gameBus.emit('offBallScores', {
        playerId: player.id, playerName: player.name,
        bestScore, intent, intentScores, decision: 'idle',
        currentPassScore: ctx.currentPassScore,
      });
    }
    return { type: 'idle' };
  }

  // Convert best cell into a direction vector toward it.
  const ddx   = bestTarget.x - player.x;
  const ddy   = bestTarget.y - player.y;
  const ddist = Math.sqrt(ddx * ddx + ddy * ddy);
  const dirX  = ddist > 0.1 ? ddx / ddist : ctx.attackDir;
  const dirY  = ddist > 0.1 ? ddy / ddist : 0;

  if (isDebugEnabled()) {
    gameBus.emit('offBallScores', {
      playerId: player.id, playerName: player.name,
      bestScore, intent, intentScores, decision: 'support_run',
      currentPassScore: ctx.currentPassScore,
    });
  }
  return { type: 'support_run', dx: dirX, dy: dirY };
}
