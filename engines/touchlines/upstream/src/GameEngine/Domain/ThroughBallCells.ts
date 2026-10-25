/**
 * ThroughBallCells — candidate-cell enumeration and scoring for through balls.
 *
 * A through ball is a pass into space (not to a teammate's feet) that becomes
 * a contested loose ball. We pick the *cell* — a grid square — and the engine
 * later resolves which player wins the race to it.
 *
 * Pipeline:
 *   1. Phase 1 cull       — quick reject of cells that are obviously not viable
 *                           (own half, behind passer, too crowded, beyond vision)
 *   2. Phase 2 fine score — race margin + space + goal threat + skill − risk
 *   3. Top-N return       — sorted by score, capped at MAX_CANDIDATES
 *
 * No weights are hardcoded here — see ThroughBallConfig.ts.
 *
 * Layer: Domain. Pure module — no Pixi, React, or DOM imports.
 */

import type { GamePlayer, GameState, TeamId } from '@/GameEngine/types';
import {
  CELL_W, CELL_H, GRID_COLS, GRID_ROWS,
  computeCrowdGrid, sampleCellSum, type CrowdGrid, type GridMatrix,
} from '@/GameEngine/Infrastructure/CrowdGrid';
import { THROUGH_BALL_CONFIG } from '@/GameEngine/Configs/ThroughBallConfig';
import { PITCH_LENGTH, PITCH_MID_X } from '@/GameEngine/Domain/pitch';
import { computeOffsideLine } from '@/GameEngine/Domain/Offside';
import { PASS_CONFIG } from '@/GameEngine/Configs/PassConfig';
import { computeOpenAngle, MAX_OPEN_ANGLE } from '@/GameEngine/Infrastructure/ActionOutcomes';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Per-cell score breakdown. Populated by `enumerateCandidateCells`. */
export interface ThroughBallCellComponents {
  raceMarginScore:    number;
  spaceQualityScore:  number;
  goalThreatScore:    number;
  passerSkillScore:   number;
  /**
   * Path clearness — 0 (defenders blocking the cell→goal corridor) to 1 (clear
   * run on goal once collected). The TB-specific discriminator that captures
   * "the runner is through the line".
   */
  pathClearScore:     number;
  laneRiskPenalty:    number;
  offsideRiskPenalty: number;
  bestAttackerId:     number | null;
  bestAttackerEta:    number;     // seconds; +Infinity if no attacker can reach
  bestDefenderId:     number | null;
  bestDefenderEta:    number;
  raceMargin:         number;     // bestDefenderEta − bestAttackerEta (positive = we win)
}

export interface CandidateCell {
  /** Cell column index in CrowdGrid. */
  col: number;
  /** Cell row index in CrowdGrid. */
  row: number;
  /** Cell centre X in yards. */
  x:   number;
  /** Cell centre Y in yards. */
  y:   number;
  /** 0..1 raw composite score (uncompressed). 0 = unviable, 1 = excellent. */
  score: number;
  /** Detailed score breakdown — populated when scoring is run. */
  components: ThroughBallCellComponents;
}

// ── ETA helpers ───────────────────────────────────────────────────────────────

/**
 * Sprint speed for chasing a loose ball — uses pressSpeed as the base and
 * adds heavier acceleration / top-end boosts than press to model an all-out chase.
 *
 * yards/second.
 */
function effectiveSprintSpeed(p: GamePlayer): number {
  const wb = p.runtimeStats.withoutBall;
  return (
    wb.pressSpeed +
    wb.acceleration * THROUGH_BALL_CONFIG.SPRINT_ACCEL_BOOST +
    wb.speed        * THROUGH_BALL_CONFIG.SPRINT_TOP_BOOST
  );
}

/** Seconds for a player to reach a cell at sprint speed (straight-line). */
function etaToCell(p: GamePlayer, cx: number, cy: number): number {
  const dist  = Math.hypot(cx - p.x, cy - p.y);
  const speed = effectiveSprintSpeed(p);
  if (speed < 0.01) return Infinity;
  return dist / speed;
}

// ── Phase 2 score components ──────────────────────────────────────────────────

/**
 * Linear race-margin scorer.
 *
 *   margin > 0 (we win)  → min(1, margin / RACE_FAVOUR_HORIZON)
 *   margin ≤ 0 (we lose) → max(0, 0.5 + margin / RACE_LOSS_HORIZON)
 *
 * At margin = 0 (perfect tie) the score is 0.5 — treated as a coin-flip cell
 * that's worth scoring but not preferred.
 */
function raceMarginScore(margin: number): number {
  if (margin > 0) {
    return Math.min(1, margin / THROUGH_BALL_CONFIG.RACE_FAVOUR_HORIZON);
  }
  return Math.max(0, 0.5 + margin / THROUGH_BALL_CONFIG.RACE_LOSS_HORIZON);
}

/**
 * Open-space score — derived from a 3×3 crowd-grid sample at the cell.
 * Saturates to 0 at SPACE_DENSITY_SAT.
 */
function spaceQualityScore(crowd: GridMatrix, cx: number, cy: number): number {
  const density = sampleCellSum(crowd, cx, cy, 1);
  return 1 - Math.min(1, density / THROUGH_BALL_CONFIG.SPACE_DENSITY_SAT);
}

/**
 * Goal-threat score — adapted from PassLanes.getGoalProximityBonus.
 * Soft horizon (PASS_CONFIG.GOAL_PROXIMITY_HORIZON, 55 yds) replaces the old
 * hard cliff at 38.33 yds, so cells just outside the attacking third still
 * earn partial goal credit.
 */
function goalThreatScore(holder: GamePlayer, cx: number, cy: number): number {
  const goalX = holder.attackDir === 1 ? PITCH_LENGTH : 0;
  const dist  = Math.abs(goalX - cx);
  if (dist > PASS_CONFIG.GOAL_PROXIMITY_HORIZON) return 0;
  const proximity  = 1 - dist / PASS_CONFIG.GOAL_PROXIMITY_HORIZON;
  const angle      = computeOpenAngle(cx, cy, goalX);
  const angleFac   = Math.min(1, angle / MAX_OPEN_ANGLE);
  // Angle GATES the whole score; proximity only modulates within angled
  // positions. A ball into the byline corner is geometrically close to the goal
  // line but has ~no shooting angle — it is NOT a goal threat and must score
  // near 0, otherwise the multiplicative goal-threat buff would pull through-ball
  // targets into the dead corner (raw proximity used to grant 0.35 there
  // regardless of angle). With this form the byline corner ≈ 0, the penalty spot
  // ≈ 0.7, and a square ball across the open goal mouth ≈ 1.0.
  return angleFac * (0.4 + 0.6 * proximity);
}

/**
 * Path-clearness score — 0..1. Sums defending outfield density in cells AHEAD
 * of (cx, cy) toward the attacking goal, within a vertical row band, normalised
 * by PATH_DENSITY_SATURATION. 1 = no defenders between this cell and goal
 * (runner is through the line). 0 = path is choked.
 *
 * This is the TB-only discriminator. A regular pass to feet doesn't get this
 * bonus — the receiver still has to dribble past the defensive line — but a
 * through ball lands the ball on the goal-side of those defenders.
 *
 * Adapted from `forwardPathClearness` in DecisionTree.ts (which takes a player
 * position; we take a cell position here).
 */
function pathClearScoreForCell(
  cx:        number,
  cy:        number,
  attackDir: 1 | -1,
  defOutfield: GridMatrix,
): number {
  const me = { col: Math.floor(cx / CELL_W), row: Math.floor(cy / CELL_H) };
  const startCol = attackDir === 1 ? me.col + 1 : 0;
  const endCol   = attackDir === 1 ? GRID_COLS  : me.col;
  if (endCol <= startCol) return 1; // already at the endline column

  const rowBand = THROUGH_BALL_CONFIG.PATH_ROW_BAND;
  const r0 = Math.max(0, me.row - rowBand);
  const r1 = Math.min(GRID_ROWS - 1, me.row + rowBand);

  let total = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = startCol; c < endCol; c++) total += defOutfield[r]![c]!;
  }
  return 1 - Math.min(1, total / THROUGH_BALL_CONFIG.PATH_DENSITY_SATURATION);
}

/**
 * Passer-skill score — vision + passingSkill blend, 0..1.
 * Unlike regular pass scoring, this is NOT gated by lane clearance — it captures
 * the holder's *willingness* to attempt an ambitious through ball, regardless of
 * how tight the trajectory is. Lane risk is already its own penalty term.
 */
function passerSkillScore(holder: GamePlayer): number {
  const wb = holder.runtimeStats.withBall;
  return wb.passingSkill * 0.5 + wb.vision * 0.5;
}

/**
 * Lane-risk penalty — a defender close to the holder→cell flight path can
 * intercept the ball mid-flight. Re-uses the perpendicular-distance check from
 * PassLanes but inverts: blocked → penalty 1, clear → penalty 0.
 */
function laneRiskPenalty(
  holder:    GamePlayer,
  cx:        number,
  cy:        number,
  opponents: GamePlayer[],
): number {
  const vx = cx - holder.x;
  const vy = cy - holder.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1) return 0;
  const blockR = PASS_CONFIG.BLOCK_RADIUS;
  const clearR = PASS_CONFIG.CLEAR_RADIUS;
  let minPerp = Infinity;
  for (const opp of opponents) {
    if (opp.role === 'GK') continue;
    const ox = opp.x - holder.x;
    const oy = opp.y - holder.y;
    const t  = (ox * vx + oy * vy) / lenSq;
    if (t < 0.1 || t > 1.0) continue;
    const perp = Math.hypot(ox - t * vx, oy - t * vy);
    if (perp < minPerp) minPerp = perp;
  }
  if (minPerp === Infinity) return 0;
  // ramp from 1 at blockR → 0 at clearR (the inverse of getLaneScore)
  return 1 - Math.max(0, Math.min(1, (minPerp - blockR) / (clearR - blockR)));
}

/**
 * Offside-risk penalty — soft penalty for cells where the *intended runner*
 * (best-ETA attacker) was offside at kick time. Engine enforcement happens
 * later; this is a scoring nudge so the holder doesn't pick clearly illegal
 * cells.
 */
function offsideRiskPenalty(
  holder:        GamePlayer,
  bestAttacker:  GamePlayer | null,
  offsideLine:   number | null,
): number {
  if (!bestAttacker || offsideLine === null) return 0;
  const overrun = (bestAttacker.x - offsideLine) * holder.attackDir;
  return overrun > 0 ? Math.min(1, overrun / 5) : 0;
}

// ── Phase 1 cull + Phase 2 score ─────────────────────────────────────────────

/** Per-team list cached across Phase 1 → Phase 2 to avoid re-filtering. */
interface TeamSlice {
  attackers: GamePlayer[];   // attacking team minus holder, minus GK
  defenders: GamePlayer[];   // defending team minus GK
  defendersAll: GamePlayer[]; // includes GK — used for lane risk
  oppMatrix: GridMatrix | null;
  crowdMatrix: GridMatrix | null;
  defOutfieldMatrix: GridMatrix | null;
}

function buildTeamSlice(holder: GamePlayer, allPlayers: GamePlayer[], grid: CrowdGrid | null): TeamSlice {
  const myTeam: TeamId = holder.team;
  return {
    attackers:  allPlayers.filter(p => p.team === myTeam && p.id !== holder.id && p.role !== 'GK'),
    defenders:  allPlayers.filter(p => p.team !== myTeam && p.role !== 'GK'),
    defendersAll: allPlayers.filter(p => p.team !== myTeam),
    oppMatrix:  grid ? (myTeam === 'A' ? grid.teamB : grid.teamA) : null,
    crowdMatrix: grid ? grid.crowd : null,
    defOutfieldMatrix: grid ? (myTeam === 'A' ? grid.teamBOutfield : grid.teamAOutfield) : null,
  };
}

/**
 * Enumerate and score through-ball candidate cells.
 * Returns at most THROUGH_BALL_CONFIG.MAX_CANDIDATES cells, sorted by score desc.
 */
export function enumerateCandidateCells(
  holder:      GamePlayer,
  allPlayers:  GamePlayer[],
  grid:        CrowdGrid | null,
  offsideLine: number | null,
): CandidateCell[] {
  const slice = buildTeamSlice(holder, allPlayers, grid);
  if (slice.attackers.length === 0) return [];

  const visionHorizon =
    THROUGH_BALL_CONFIG.VISION_HORIZON_MIN +
    holder.runtimeStats.withBall.vision *
      (THROUGH_BALL_CONFIG.VISION_HORIZON_MAX - THROUGH_BALL_CONFIG.VISION_HORIZON_MIN);

  const survivors: CandidateCell[] = [];

  // Skip the outermost cell ring on every side — a through ball that lands in
  // the boundary cells almost always drifts out of bounds (touchline → throw-in,
  // goal-line → goal kick or corner) which means we lose possession.
  for (let r = 1; r < GRID_ROWS - 1; r++) {
    for (let c = 1; c < GRID_COLS - 1; c++) {
      const cx = (c + 0.5) * CELL_W;
      const cy = (r + 0.5) * CELL_H;

      // Phase 1 cull — fast rejects
      const forwardOffset = (cx - holder.x) * holder.attackDir;
      if (forwardOffset < THROUGH_BALL_CONFIG.MIN_FORWARD_PROGRESS) continue;

      const inOpponentHalf = holder.attackDir === 1 ? cx > PITCH_MID_X : cx < PITCH_MID_X;
      if (!inOpponentHalf) continue;

      const distToPasser = Math.hypot(cx - holder.x, cy - holder.y);
      if (distToPasser > visionHorizon) continue;

      if (slice.oppMatrix) {
        const oppDensity = sampleCellSum(slice.oppMatrix, cx, cy, 1);
        if (oppDensity > THROUGH_BALL_CONFIG.MAX_OPP_DENSITY) continue;
      }

      // Phase 2 fine score
      // Restrict candidate runners to attackers currently behind the cell in
      // attack direction — a through ball is a *forward* run into space. An
      // attacker who is level with or ahead of the cell would be running
      // sideways/backward to receive it, which makes the play a regular pass
      // (handled by PassLanes), not a through ball.
      let bestAttackerId: number | null = null;
      let bestAttacker:   GamePlayer | null = null;
      let bestAttackerEta = Infinity;
      for (const a of slice.attackers) {
        const runnerForwardProgress = (cx - a.x) * holder.attackDir;
        if (runnerForwardProgress < THROUGH_BALL_CONFIG.MIN_RUNNER_FORWARD_PROGRESS) continue;
        const eta = etaToCell(a, cx, cy);
        if (eta < bestAttackerEta) {
          bestAttackerEta = eta;
          bestAttackerId  = a.id;
          bestAttacker    = a;
        }
      }
      // No attacker has a forward run available — defenders are higher than
      // every attacker. Through ball isn't viable; let the carry/pass paths
      // handle this state.
      if (!bestAttacker) continue;

      let bestDefenderId: number | null = null;
      let bestDefenderEta = Infinity;
      // Include GK in the race — the GK will sweep balls played into their range,
      // so a deep cell isn't "free" just because no outfield defender can reach it.
      for (const d of slice.defendersAll) {
        const eta = etaToCell(d, cx, cy);
        if (eta < bestDefenderEta) {
          bestDefenderEta = eta;
          bestDefenderId  = d.id;
        }
      }

      const raceMargin = bestDefenderEta - bestAttackerEta;
      const raceScore  = bestAttacker ? raceMarginScore(raceMargin) : 0;
      const spaceScore = slice.crowdMatrix ? spaceQualityScore(slice.crowdMatrix, cx, cy) : 0.5;
      const goalScore  = goalThreatScore(holder, cx, cy);
      const skillScore = passerSkillScore(holder);
      const pathScore  = slice.defOutfieldMatrix
        ? pathClearScoreForCell(cx, cy, holder.attackDir, slice.defOutfieldMatrix)
        : 0.5;
      const laneRisk   = laneRiskPenalty(holder, cx, cy, slice.defendersAll);
      const offsideRisk = offsideRiskPenalty(holder, bestAttacker, offsideLine);

      const cfg = THROUGH_BALL_CONFIG;
      // Viability — "can we win this ball cleanly and progress?" race + space +
      // skill + path, minus the lane/offside penalties. Lower-clamped to 0 but
      // NOT upper-clamped: a wide-open channel can saturate every viability term
      // to ~1.0, so clamping here would erase the discriminator between two
      // equally-open cells. Goal threat is applied as a multiplicative BUFF, not
      // an additive term, so a pure-progression play into open space keeps its
      // full viability while a cell that also creates a real goal threat gets
      // lifted above it. We never penalise a low-threat cell — we only reward a
      // high-threat one.
      const viability =
        raceScore  * cfg.W_RACE        +
        spaceScore * cfg.W_SPACE       +
        skillScore * cfg.W_SKILL       +
        pathScore  * cfg.W_PATH        -
        laneRisk   * cfg.W_LANE_RISK   -
        offsideRisk * cfg.W_OFFSIDE;

      // Goal threat is only worth buffing on a ball we actually win first — a
      // cell the defender/GK reaches before our runner is a turnover, no matter
      // how dangerous the spot would be. Gate the buff by raceScore so a lost
      // race earns no goal lift (otherwise a hopeless ball into the goal mouth,
      // collected by the keeper, would outrank a clean channel ball the runner
      // wins). This is still a buff, never a penalty: low threat or lost race
      // simply leaves the cell at its full viability.
      const score = Math.max(0, viability) * (1 + cfg.GOAL_THREAT_BUFF * goalScore * raceScore);

      survivors.push({
        col: c, row: r, x: cx, y: cy, score,
        components: {
          raceMarginScore:    raceScore,
          spaceQualityScore:  spaceScore,
          goalThreatScore:    goalScore,
          passerSkillScore:   skillScore,
          pathClearScore:     pathScore,
          laneRiskPenalty:    laneRisk,
          offsideRiskPenalty: offsideRisk,
          bestAttackerId,
          bestAttackerEta,
          bestDefenderId,
          bestDefenderEta,
          raceMargin,
        },
      });
    }
  }

  survivors.sort((a, b) => b.score - a.score);
  return survivors.slice(0, THROUGH_BALL_CONFIG.MAX_CANDIDATES);
}

/**
 * Convenience — derive candidate cells directly from a GameState. Handles the
 * holder lookup, offside-line computation, and crowd-grid build.
 *
 * Returns [] when the ball is in flight or no holder can be resolved.
 */
export function getThroughBallCells(state: GameState): CandidateCell[] {
  if (state.pass || state.shot) return [];
  const holder = state.players.find(p => p.id === state.ballHolderId);
  if (!holder) return [];
  if (holder.role === 'GK') return []; // GKs don't play through balls in v1

  const grid = computeCrowdGrid(state);
  const offsideLine = computeOffsideLine(holder.attackDir, state.players, holder.team, holder.x);
  return enumerateCandidateCells(holder, state.players, grid, offsideLine);
}
