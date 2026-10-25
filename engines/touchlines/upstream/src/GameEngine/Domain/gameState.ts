import type { GamePlayer, GameState, Formation, MovementBounds, PlayerRole, TeamId, TeamIntent } from '@/GameEngine/types';
import { decide, COMMIT_TICKS, EMPTY_DECISION_MEMORY, isPlayerInRecovery } from './DecisionTree';
import type { PlayerDecision, DecisionPath } from './DecisionTree';
import { gameBus } from '@/GameEngine/Infrastructure/EventBus';
import { roleEngine } from '@/GameEngine/Domain/roleEngineData';
import { resolveBasePosition } from '@/GameEngine/FormationSlots';
import { computeTargetPosition } from '@/GameEngine/Domain/Positioning';
import { assignMarkTargets } from '@/GameEngine/Domain/DefensivePositioning';
import { teamLineup } from '@/GameEngine/Domain/TeamLineup';
import {
  applyStaminaCost,
  consumeEnergy,
  getRuntimeLineup,
  normalizeGamePlayer,
  type StaminaAction,
} from '@/GameEngine/Domain/RuntimeLineup';
import { evaluatePassLanes } from '@/GameEngine/Domain/PassLanes';
import { PASS_CONFIG } from '@/GameEngine/Configs/PassConfig';
import {
  THROUGH_BALL_CONFIG,
  CHASE_LOOSE_BALL_WEIGHT_ATTACK,
  CHASE_LOOSE_BALL_WEIGHT_DEFEND,
} from '@/GameEngine/Configs/ThroughBallConfig';
import { isInGoalScoreArea } from '@/GameEngine/Domain/pitch';
import { debugLog, isDebugEnabled } from '@/GameEngine/Suport/DebugLog';
import type { RosterPlayer } from '@/types/playerTypes';
import { Player } from '@/Domain/Player';
import { computeBuffedStats } from '@/Domain/PlayerBuffs';
import { PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX } from '@/GameEngine/Domain/pitch';
import {
  SHOT_SPEED, TACKLE_COOLDOWN, TACKLE_RANGE,
  DUEL_RECOVERY_SPEED_FACTOR,
  DUEL_TACKLE_WIN_RECOVERY, DUEL_TACKLE_LOSS_RECOVERY, DUEL_TACKLE_FAILED_RECOVERY,
  DUEL_DRIBBLE_WIN_RECOVERY, DUEL_DRIBBLE_LOSS_RECOVERY,
  DRIBBLE_RESOLUTION_RANGE,
  CARRY_ACCEL_SPEED_BOOST,
  MAX_INTERCEPTION_CORRIDOR, playerInterceptionCorridor,
  computeShotAim, computeXG, computeOpenAngle, computeWeightedPressure,
  resolveShot, resolveTackle, resolveInterception, resolveDribble, resolveLooseBallDuel,
} from '@/GameEngine/Infrastructure/ActionOutcomes';
import { getInterceptionPerpDist } from './PositionalAwareness';
import { computeCrowdGrid } from '@/GameEngine/Infrastructure/CrowdGrid';
import { getDefenseConfig } from '@/GameEngine/Configs/DefenseConfig';
import { computeOffsideLine } from '@/GameEngine/Domain/Offside';
import { enumerateCandidateCells } from '@/GameEngine/Domain/ThroughBallCells';
import { getOffBallBias } from '@/GameEngine/Domain/OffBallMovement';
import { OFF_BALL_CONFIG } from '@/GameEngine/Configs/OffBallConfig';
import { ATTACK_CONFIG, POSSESSION_PUSH_UP, PUSH_UP_ROLE_BIAS } from '@/GameEngine/Configs/AttackConfig';
import { getFormationSetPieces, generateKickoffLayout } from '@/GameEngine/Domain/SetPieceLayouts';
import type { FormationSetPieces, SetPieceLayout } from '@/GameEngine/Domain/SetPieceLayouts';
import { applySetPieceToTeam, enforceKickoffCircleRule } from '@/GameEngine/Domain/SetPiecePositioning';
import { evaluateAiSubstitutions, shouldCheckAiSubs } from '@/GameEngine/Domain/AiSubstitution';
import { detectTeamIntent } from '@/GameEngine/Domain/IntentDetection';

export { PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX } from '@/GameEngine/Domain/pitch';

// ── Offside config ────────────────────────────────────────────────────────────

export const OFFSIDE_CONFIG = {
  /** Set to false to disable offside enforcement (useful for testing). */
  ENABLED: true,
} as const;

// ── Press intercept config ────────────────────────────────────────────────────
/**
 * Max yards to project the holder forward when computing a press intercept target.
 * Prevents extreme projections when the holder is very fast or the presser very slow.
 */
const PRESS_INTERCEPT_MAX_LOOKAHEAD = 14;

// ── Match clock constants ─────────────────────────────────────────────────────

// ── Tune match duration here ──────────────────────────────────────────────────
/** Real-world seconds per half. 150 = 2.5 min/half → 5 min total match. */
const REAL_HALF_DURATION = 150;
// ─────────────────────────────────────────────────────────────────────────────

/** Game-seconds per real-second: 45 game-minutes / REAL_HALF_DURATION. */
const TIME_SCALE = 2700 / REAL_HALF_DURATION;
/** Duration of one half in game-seconds (45 minutes). */
const HALF_DURATION = 2700;
/** Real-seconds the pre-match / half-time presentation freeze lasts. */
const PRESENTATION_DURATION = 4;

/**
 * Game-seconds between periodic team intent re-evaluations. Possession transfer
 * already triggers a recompute; this catches cases where the situation changes
 * mid-possession (opponent pushes forward, we lose a numerical advantage, etc.)
 * without churning every tick — 3 game-seconds is roughly 12 ticks at 0.25s dt.
 */
const INTENT_REEVAL_INTERVAL = 3;

// ── Team factory ─────────────────────────────────────────────────────────────

function mirrorBounds(b: MovementBounds): MovementBounds {
  return { minX: PITCH_LENGTH - b.maxX, maxX: PITCH_LENGTH - b.minX, minY: b.minY, maxY: b.maxY };
}

/** Preferred positions for each engine role, used when picking from a squad roster. */
const ROLE_POSITIONS: Partial<Record<PlayerRole, string[]>> = {
  GK:  ['GK'],
  LB:  ['LB', 'LWB', 'CB', 'RB'],
  RB:  ['RB', 'RWB', 'CB', 'LB'],
  CB:  ['CB', 'LB', 'RB'],
  LWB: ['LWB', 'LB', 'LM', 'CB'],
  RWB: ['RWB', 'RB', 'RM', 'CB'],
  CDM: ['CDM', 'CM', 'DM'],
  CM:  ['CM', 'CAM', 'AM', 'CDM'],
  CAM: ['CAM', 'AM', 'CM', 'LM', 'RM'],
  LM:  ['LM', 'LW', 'CM'],
  RM:  ['RM', 'RW', 'CM'],
  LW:  ['LW', 'LM', 'CM', 'ST'],
  RW:  ['RW', 'RM', 'CM', 'ST'],
  ST:  ['ST', 'CF', 'CAM', 'LW', 'RW'],
};

function pickForRole(players: RosterPlayer[], role: PlayerRole, used: Set<string>): RosterPlayer {
  const preferences = ROLE_POSITIONS[role] ?? [role];
  for (const pos of preferences) {
    const found = players.find(p => !used.has(p.id) && p.positions.includes(pos));
    if (found) return found;
  }
  return players.find(p => !used.has(p.id)) ?? players[0]!;
}

/**
 * Maps any position string (including abstract codes like "CF", "DM", "AM",
 * "Defender", "Midfielder", "Forward") to a valid engine PlayerRole.
 */
const POSITION_TO_ROLE: Record<string, PlayerRole> = {
  GK: 'GK',
  CB: 'CB', LB: 'LB', RB: 'RB', LWB: 'LWB', RWB: 'RWB',
  CDM: 'CDM', DM: 'CDM',
  CM: 'CM',
  CAM: 'CAM', AM: 'CAM',
  LM: 'LM', RM: 'RM',
  LW: 'LW', RW: 'RW',
  ST: 'ST', CF: 'ST',
  // Abstract labels from API Football pipeline
  Defender: 'CB', Midfielder: 'CM', Forward: 'ST', Attacker: 'ST',
};

function toValidPlayerRole(pos: string): PlayerRole {
  return POSITION_TO_ROLE[pos] ?? 'CM';
}

function buildGamePlayerForSlot(
  rp: RosterPlayer,
  slotDef: { role: PlayerRole; yRange?: number },
  slotIndex: number,
  formation: Formation,
  team: TeamId,
  engineId: number,
): GamePlayer {
  const attackDir = (team === 'A' ? 1 : -1) as 1 | -1;
  const buffed = computeBuffedStats(
    rp.stats,
    Player.trainingToStatus(rp.seasonLog?.trainingSessions ?? 0),
    Player.moraleToStatus(rp.seasonLog?.morale ?? 70),
    Player.formToStatus(rp.seasonLog?.recentRatings ?? []),
  );
  const roleEng  = roleEngine(slotDef.role);
  const startPos = resolveBasePosition(slotIndex, attackDir, formation, 'attacking');
  const yRange   = slotDef.yRange ?? roleEng.yRange;
  const slotY    = startPos.y;
  const xBoundsA = roleEng.bounds;
  const xBounds  = team === 'A' ? xBoundsA : mirrorBounds({ ...xBoundsA, minY: 0, maxY: 74 });
  const bounds   = {
    minX: xBounds.minX,
    maxX: xBounds.maxX,
    minY: Math.max(0,           slotY - yRange),
    maxY: Math.min(PITCH_WIDTH, slotY + yRange),
  };
  const baseStats = teamLineup(buffed, slotDef.role);
  // Use persisted fitness as starting energy (falls back to full if no history).
  const energy = Math.max(0, Math.min(100, rp.seasonLog?.fitness ?? 100));
  return {
    id:               engineId,
    rosterId:         rp.id,
    name:             rp.name,
    team,
    role:             slotDef.role,
    attackDir,
    x:                startPos.x,
    y:                startPos.y,
    baseStats,
    runtimeStats:     getRuntimeLineup(baseStats, { energy }),
    energy,
    startEnergy:      energy,
    stamina:          buffed.stamina,
    ballSupportScale: roleEng.ballSupportScale,
    slotIndex,
    basePosition:     startPos,
    targetPosition:   startPos,
    bounds,
    recoveryTime:     0,
    justReceivedTicks: 0,
    decisionMemory:   EMPTY_DECISION_MEMORY,
  };
}

function buildTeam(
  players: RosterPlayer[],
  formation: Formation,
  team: TeamId,
  idOffset: number,
  lineup?: string[],
): { starters: GamePlayer[]; bench: GamePlayer[]; usedIds: Set<string> } {
  const used  = new Set<string>();
  const byId  = new Map(players.map(p => [p.id, p]));
  const starters = formation.attacking.map((slotDef, i) => {
    // Use explicit lineup slot if valid, otherwise fall back to role-based pick
    const lineupId = lineup?.[i];
    const rp = (lineupId && byId.has(lineupId) && !used.has(lineupId))
      ? byId.get(lineupId)!
      : pickForRole(players, slotDef.role, used);
    used.add(rp.id);
    return buildGamePlayerForSlot(rp, slotDef, i, formation, team, idOffset + i + 1);
  });

  // Build bench from remaining squad members in squad order
  const bench: GamePlayer[] = [];
  let benchIdOffset = idOffset + 100; // bench IDs start well above the 11 starters
  for (const rp of players) {
    if (used.has(rp.id)) continue;
    const naturalRole = toValidPlayerRole(rp.positions?.[0] ?? 'CM');
    const roleEng = roleEngine(naturalRole);
    const attackDir = (team === 'A' ? 1 : -1) as 1 | -1;
    const buffed = computeBuffedStats(
      rp.stats,
      Player.trainingToStatus(rp.seasonLog?.trainingSessions ?? 0),
      Player.moraleToStatus(rp.seasonLog?.morale ?? 70),
      Player.formToStatus(rp.seasonLog?.recentRatings ?? []),
    );
    const baseStats = teamLineup(buffed, naturalRole);
    const energy = Math.max(0, Math.min(100, rp.seasonLog?.fitness ?? 100));
    // Bench players have placeholder positions — overwritten when they sub in
    const dummyPos = { x: 0, y: 0 };
    const dummyBounds = { minX: 0, maxX: PITCH_LENGTH, minY: 0, maxY: PITCH_WIDTH };
    bench.push({
      id:               benchIdOffset++,
      rosterId:         rp.id,
      name:             rp.name,
      team,
      role:             naturalRole,
      attackDir,
      x:                dummyPos.x,
      y:                dummyPos.y,
      baseStats,
      runtimeStats:     getRuntimeLineup(baseStats, { energy }),
      energy,
      startEnergy:      energy,
      stamina:          buffed.stamina,
      ballSupportScale: roleEng.ballSupportScale,
      slotIndex:        -1,
      basePosition:     dummyPos,
      targetPosition:   dummyPos,
      bounds:           dummyBounds,
      recoveryTime:     0,
      justReceivedTicks: 0,
      decisionMemory:   EMPTY_DECISION_MEMORY,
    });
  }

  return { starters, bench, usedIds: used };
}

/**
 * Create a live-match GameState from two squads and their formations.
 *
 * @param playersA    Roster of Team A (the user's club).
 * @param formationA  Formation object for Team A.
 * @param playersB    Roster of Team B (the opponent).
 * @param formationB  Formation object for Team B.
 * @param lineupA     Optional ordered player IDs for Team A (index = slot index).
 * @param lineupB     Optional ordered player IDs for Team B (index = slot index).
 */
export function createMatchState(
  playersA:   RosterPlayer[],
  formationA: Formation,
  playersB:   RosterPlayer[],
  formationB: Formation,
  lineupA?:   string[],
  lineupB?:   string[],
): GameState {
  const teamAResult = buildTeam(playersA, formationA, 'A', 0, lineupA);
  const teamBResult = buildTeam(playersB, formationB, 'B', 200, lineupB);
  const teamA = teamAResult.starters;
  const teamB = teamBResult.starters;

  // Team A kicks off — apply kickOff to A, kickOffDefend to B
  const spA = getFormationSetPieces(formationA.id);
  const spB = getFormationSetPieces(formationB.id);
  const kickoffLayoutA     = spA?.kickOff        ?? generateKickoffLayout(formationA);
  const kickoffDefendLayoutB = spB?.kickOffDefend ?? generateKickoffLayout(formationB);
  let players = [...teamA, ...teamB];
  players = applySetPieceToTeam(players, 'A', kickoffLayoutA);
  players = applySetPieceToTeam(players, 'B', kickoffDefendLayoutB);
  players = enforceKickoffCircleRule(players, 'B');

  const kickoffHolder = players.find(p => p.team === 'A' && p.role === 'ST') ?? teamA[teamA.length - 1]!;

  return {
    players,
    benchA:                teamAResult.bench,
    benchB:                teamBResult.bench,
    substitutions:         [],
    subsRemainingA:        5,
    subsRemainingB:        5,
    pendingSubsA:          [],
    pendingSubsB:          [],
    formationA,
    formationB,
    ballHolderId:          kickoffHolder.id,
    pass:                  null,
    shot:                  null,
    looseBall:             null,
    score:                 { A: 0, B: 0 },
    tackleCooldown:        0,
    setPiece:              { type: 'kickoff', takerId: kickoffHolder.id, countdown: 2 },
    decisions:             {},
    matchPhase:            'preMatch',
    matchTime:             0,
    extraTimeFirst:        Math.floor(Math.random() * 6) * 60,
    extraTimeSecond:       Math.floor(Math.random() * 6) * 60,
    presentationCountdown: PRESENTATION_DURATION,
    possessionTime:        0,
    lastPasserId:          null,
    teamIntent:            { A: 'balanced', B: 'balanced' },
    throughBallCellsCache: null,
  };
}

// ── Dead-ball detection ───────────────────────────────────────────────────────

/**
 * Returns true when play is suspended and substitutions can be executed.
 * Add new dead-ball conditions here as the game gains fouls, corners, etc.
 */
export function isDeadBall(state: GameState): boolean {
  // Active set-piece freeze (kickoff / goal kick / offside free kick)
  if (state.setPiece && state.setPiece.countdown > 0) return true;
  // Half-time presentation window
  if (state.matchPhase === 'halfTime') return true;
  // GK in possession — treat as a valid sub window
  const holder = state.players.find(p => p.id === state.ballHolderId);
  if (holder?.role === 'GK') return true;
  return false;
}

// ── Substitution execution ────────────────────────────────────────────────────

/**
 * Immediately swap `outPlayerId` (on-pitch) for `inPlayerId` (bench).
 * The incoming player inherits the outgoing player's slot, role, position, and bounds.
 * Does NOT check `subsRemaining` — callers must validate that themselves.
 */
export function performSubstitution(
  state: GameState,
  team: TeamId,
  outPlayerId: number,
  inPlayerId: number,
): GameState {
  const bench = team === 'A' ? state.benchA : state.benchB;
  const outPlayer = state.players.find(p => p.id === outPlayerId && p.team === team);
  const inPlayer  = bench.find(p => p.id === inPlayerId);
  if (!outPlayer || !inPlayer) return state;

  const formation = team === 'A' ? state.formationA : state.formationB;
  const slotDef   = formation.attacking[outPlayer.slotIndex];
  const role      = slotDef?.role ?? outPlayer.role;

  // Use the incoming player's existing baseStats (built at lineup time for their natural role).
  // We don't have their raw PlayerStatsRecord anymore so we keep the existing stats as-is.
  const newBaseStats = inPlayer.baseStats;

  const incoming: GamePlayer = {
    ...inPlayer,
    role,
    slotIndex:      outPlayer.slotIndex,
    attackDir:      outPlayer.attackDir,
    x:              outPlayer.x,
    y:              outPlayer.y,
    basePosition:   outPlayer.basePosition,
    targetPosition: outPlayer.targetPosition,
    bounds:         outPlayer.bounds,
    ballSupportScale: roleEngine(role).ballSupportScale,
    baseStats:      newBaseStats,
    runtimeStats:   getRuntimeLineup(newBaseStats, { energy: inPlayer.energy }),
    decisionMemory: EMPTY_DECISION_MEMORY,
    recoveryTime:   0,
    justReceivedTicks: 0,
  };

  const matchMinute = Math.floor(
    (state.matchTime / 2700) * 45 + (state.matchPhase === 'secondHalf' ? 45 : 0),
  );

  const record: import('../types').SubstitutionRecord = {
    team,
    playerOutId:       outPlayerId,
    playerOutName:     outPlayer.name,
    playerOutRosterId: outPlayer.rosterId,
    playerOutEnergy:   outPlayer.energy,
    playerInId:        inPlayerId,
    playerInName:      inPlayer.name,
    playerInRosterId:  inPlayer.rosterId,
    matchMinute,
  };

  gameBus.emit('playerSubstituted', { outId: outPlayerId, inId: inPlayerId, team });

  // Transfer ball if outgoing player held it
  let ballHolderId = state.ballHolderId;
  if (ballHolderId === outPlayerId) {
    const nearest = state.players
      .filter(p => p.team === team && p.id !== outPlayerId)
      .sort((a, b) => distSq(a, outPlayer) - distSq(b, outPlayer));
    ballHolderId = nearest[0]?.id ?? ballHolderId;
  }

  const newPlayers = state.players.map(p => p.id === outPlayerId ? incoming : p);
  const newBench   = bench.filter(p => p.id !== inPlayerId);

  return {
    ...state,
    players:         newPlayers,
    benchA:          team === 'A' ? newBench : state.benchA,
    benchB:          team === 'B' ? newBench : state.benchB,
    subsRemainingA:  team === 'A' ? state.subsRemainingA - 1 : state.subsRemainingA,
    subsRemainingB:  team === 'B' ? state.subsRemainingB - 1 : state.subsRemainingB,
    substitutions:   [...state.substitutions, record],
    ballHolderId,
  };
}

/**
 * Process all pending substitutions for a team, capped by remaining subs.
 */
function flushPendingSubs(state: GameState, team: TeamId): GameState {
  const pending = team === 'A' ? state.pendingSubsA : state.pendingSubsB;
  if (pending.length === 0) return state;

  let s = {
    ...state,
    pendingSubsA: team === 'A' ? [] : state.pendingSubsA,
    pendingSubsB: team === 'B' ? [] : state.pendingSubsB,
  };

  for (const req of pending) {
    const subsLeft = team === 'A' ? s.subsRemainingA : s.subsRemainingB;
    if (subsLeft <= 0) break;
    s = performSubstitution(s, team, req.outId, req.inId);
  }

  return s;
}

// ── Formation change mid-match ────────────────────────────────────────────────

/**
 * Swap one team's formation without substituting any players.
 * Each on-pitch player retains their current energy but gets a new role,
 * base position, bounds, and recomputed stats.
 */
export function changeFormation(
  state: GameState,
  team: TeamId,
  newFormation: Formation,
): GameState {
  const teamPlayers = state.players.filter(p => p.team === team);
  const attackDir   = (team === 'A' ? 1 : -1) as 1 | -1;

  const updated = teamPlayers.map((p, arrIndex) => {
    const slotIndex = p.slotIndex >= 0 ? p.slotIndex : arrIndex;
    const slotDef   = newFormation.attacking[slotIndex];
    if (!slotDef) return p;
    const role     = slotDef.role;
    const roleEng  = roleEngine(role);
    const startPos = resolveBasePosition(slotIndex, attackDir, newFormation, 'attacking');
    const yRange   = slotDef.yRange ?? roleEng.yRange;
    const xBoundsA = roleEng.bounds;
    const xBounds  = team === 'A' ? xBoundsA : mirrorBounds({ ...xBoundsA, minY: 0, maxY: 74 });
    const bounds   = {
      minX: xBounds.minX,
      maxX: xBounds.maxX,
      minY: Math.max(0,           startPos.y - yRange),
      maxY: Math.min(PITCH_WIDTH, startPos.y + yRange),
    };
    // Keep existing baseStats — we no longer have the raw PlayerStatsRecord post-lineup.
    // The formation change adjusts movement bounds and base positions; stats stay as-is.
    return {
      ...p,
      role,
      slotIndex,
      basePosition:    startPos,
      bounds,
      ballSupportScale: roleEng.ballSupportScale,
      runtimeStats:    getRuntimeLineup(p.baseStats, { energy: p.energy }),
    };
  });

  const otherPlayers = state.players.filter(p => p.team !== team);
  return {
    ...state,
    players:    [...otherPlayers, ...updated].sort((a, b) => a.id - b.id),
    formationA: team === 'A' ? newFormation : state.formationA,
    formationB: team === 'B' ? newFormation : state.formationB,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Apply intent detection on a possession transfer. Call this AFTER updating
 * `ballHolderId` to the new holder. When the team in possession changed,
 * recompute intent for BOTH teams — the new defender may also fire an intent
 * (e.g. counter_attack tactic going into high_press mode when their opponent
 * progresses with a numerical disadvantage).
 *
 * No-ops when possession stayed within the same team (e.g. a pass completion
 * to a teammate — periodic re-evaluation handles updates while possession
 * stays put; see `reevaluateTeamIntents`).
 */
function onPossessionTransfer(state: GameState, prevHolderId: number): GameState {
  if (state.ballHolderId === prevHolderId) return state;

  const prev = state.players.find(p => p.id === prevHolderId);
  const next = state.players.find(p => p.id === state.ballHolderId);
  if (!next) return state;
  if (prev && prev.team === next.team) return state; // same team — no recompute

  return reevaluateTeamIntents(state);
}

/**
 * Recompute team intent for both teams from current state and emit if changed.
 * Used by both possession transfer and the periodic in-tick re-evaluation —
 * intents are situational signals that can flip mid-possession (e.g. opponent
 * pushes into our half → defensive press intent fires).
 *
 * `lastIntentEvalTime` is bumped on every call so the periodic timer resets
 * even when nothing changed (cheap idempotency for the periodic tick path).
 *
 * `opts.includeSwitchPlay` (default true) controls whether switch_play may be
 * (re)assigned. The periodic in-tick re-eval passes false: a switch is a
 * per-possession commitment decided at possession-change / reception, so the
 * 3-second timer must neither newly trigger it nor clear an in-progress switch.
 * A team already on switch_play is therefore held untouched on the periodic path.
 */
function reevaluateTeamIntents(
  state: GameState,
  opts?: { includeSwitchPlay?: boolean },
): GameState {
  const includeSwitchPlay = opts?.includeSwitchPlay ?? true;

  const intentA = recomputeTeamIntent(state, 'A', includeSwitchPlay);
  const intentB = recomputeTeamIntent(state, 'B', includeSwitchPlay);

  const changed =
    state.teamIntent.A !== intentA ||
    state.teamIntent.B !== intentB;

  const teamIntent = changed
    ? { A: intentA, B: intentB }
    : state.teamIntent;

  if (changed) {
    gameBus.emit('teamIntentChanged', { teamIntent });
  }

  return { ...state, teamIntent, lastIntentEvalTime: state.matchTime };
}

/**
 * Resolve one team's intent for a re-eval pass. When switch_play is excluded
 * (periodic path) a team already switching holds that intent — the timer can't
 * clear an in-progress switch — and no team can newly acquire switch_play.
 */
function recomputeTeamIntent(
  state: GameState,
  team: TeamId,
  includeSwitchPlay: boolean,
): TeamIntent {
  if (!includeSwitchPlay && state.teamIntent[team] === 'switch_play') {
    return 'switch_play';
  }
  return detectTeamIntent(state, team, { allowSwitchPlay: includeSwitchPlay });
}

function teamHasBall(state: GameState, teamId: GamePlayer['team']): boolean {
  const holder = state.players.find(p => p.id === state.ballHolderId);
  if (!holder) return false;
  if (state.pass) {
    // Through ball — toId is null; possession during flight stays with the passer's team
    // until the loose ball is contested at landing.
    if (state.pass.kind === 'through' || state.pass.toId === null) {
      const passer = state.players.find(p => p.id === state.pass!.fromId);
      return passer?.team === teamId;
    }
    const receiver = state.players.find(p => p.id === state.pass!.toId);
    return receiver?.team === teamId;
  }
  // Loose ball — attribute "team with ball" to the team that played it
  // (so the off-ball / defensive paths still work; a chaser on the passer's
  // team is still in TEAM_WITH_BALL path during the wait, opposing chasers
  // stay in TEAM_WITHOUT_BALL).
  if (state.looseBall) {
    return state.looseBall.fromTeamLastTouch === teamId;
  }
  return holder.team === teamId;
}

function shouldDrainStamina(state: GameState): boolean {
  if (state.matchPhase !== 'firstHalf' && state.matchPhase !== 'secondHalf') return false;
  if (state.setPiece && state.setPiece.countdown > 0) return false;
  return true;
}

function resolveStaminaAction(
  p: GamePlayer,
  ballHolderId: number,
  holderTeam: TeamId,
  dec: PlayerDecision | undefined,
): StaminaAction {
  if (p.id === ballHolderId) {
    if (dec?.type === 'carry' || dec?.type === 'dribble') return 'carry';
    if (dec?.type === 'pass') return 'pass';
    if (dec?.type === 'shoot') return 'shot';
    return 'move';
  }
  if (p.team !== holderTeam && dec?.type === 'press') return 'press';
  return 'move';
}

function getTeammates(state: GameState, playerId: number): GamePlayer[] {
  const player = state.players.find(p => p.id === playerId)!;
  return state.players.filter(p => p.team === player.team && p.id !== playerId);
}

function resetToKickoff(state: GameState, kickoffTeam: import('../types').TeamId): GameState {
  const resetPlayers = state.players.map(p => ({
    ...p,
    x: p.basePosition.x,
    y: p.basePosition.y,
    targetPosition: { ...p.basePosition },
  }));

  // Kicking team uses kickOff layout; defending team uses kickOffDefend layout.
  // Falls back to generating positions from defending slots for unsupported formations.
  let positioned = resetPlayers;
  const defendingTeam: import('../types').TeamId = kickoffTeam === 'A' ? 'B' : 'A';
  const spA = getFormationSetPieces(state.formationA.id);
  const spB = getFormationSetPieces(state.formationB.id);
  const attackLayoutA  = spA?.kickOff        ?? generateKickoffLayout(state.formationA);
  const attackLayoutB  = spB?.kickOff        ?? generateKickoffLayout(state.formationB);
  const defendLayoutA  = spA?.kickOffDefend  ?? generateKickoffLayout(state.formationA);
  const defendLayoutB  = spB?.kickOffDefend  ?? generateKickoffLayout(state.formationB);
  positioned = applySetPieceToTeam(positioned, 'A', kickoffTeam === 'A' ? attackLayoutA : defendLayoutA);
  positioned = applySetPieceToTeam(positioned, 'B', kickoffTeam === 'B' ? attackLayoutB : defendLayoutB);
  // Defending team must stay outside the centre circle
  positioned = enforceKickoffCircleRule(positioned, defendingTeam);

  const kickoffHolder =
    positioned.find(p => p.team === kickoffTeam && p.role === 'ST') ??
    positioned.find(p => p.team === kickoffTeam) ??
    positioned[0]!; // fallback: test scenarios may only have one team
  gameBus.emit('kickOff', { team: kickoffTeam, phase: 'afterGoal' });
  const prevHolderId = state.ballHolderId;
  return onPossessionTransfer({
    ...state,
    players:       positioned,
    ballHolderId:  kickoffHolder.id,
    pass:          null,
    shot:          null,
    looseBall:     null,
    setPiece:      { type: 'kickoff', takerId: kickoffHolder.id, countdown: 2 },
    possessionTime: 0,
    lastPasserId: null,
  }, prevHolderId);
}

/**
 * Mirror all player positions/bounds across the centre line and flip attackDir.
 * Called at the end of the half-time presentation freeze.
 * Team B kicks off the second half (Team A kicked off the first).
 */

function switchSides(state: GameState): GameState {
  const switched = state.players.map(p => {
    const recoveryRate = 0.30 + (p.stamina / 10) * 0.30; // 30% at stamina 0 → 60% at stamina 10
    const recoveredEnergy = Math.min(p.startEnergy, p.energy + (p.startEnergy - p.energy) * recoveryRate);
    const energyChanged = recoveredEnergy !== p.energy;
    return {
      ...p,
      attackDir: (-p.attackDir) as 1 | -1,
      x:           PITCH_LENGTH - p.x,
      basePosition:   { x: PITCH_LENGTH - p.basePosition.x, y: p.basePosition.y },
      targetPosition: { x: PITCH_LENGTH - p.targetPosition.x, y: p.targetPosition.y },
      bounds: {
        minX: PITCH_LENGTH - p.bounds.maxX,
        maxX: PITCH_LENGTH - p.bounds.minX,
        minY: p.bounds.minY,
        maxY: p.bounds.maxY,
      },
      energy: recoveredEnergy,
      runtimeStats: energyChanged
        ? getRuntimeLineup(p.baseStats, { energy: recoveredEnergy })
        : p.runtimeStats,
    };
  });

  // Team B kicks off second half — B uses kickOff, A uses kickOffDefend.
  // attackDir is already flipped above, so applySetPieceToTeam mirrors correctly.
  let positioned = switched;
  const spA2 = getFormationSetPieces(state.formationA.id);
  const spB2 = getFormationSetPieces(state.formationB.id);
  positioned = applySetPieceToTeam(positioned, 'A', spA2?.kickOffDefend ?? generateKickoffLayout(state.formationA));
  positioned = applySetPieceToTeam(positioned, 'B', spB2?.kickOff       ?? generateKickoffLayout(state.formationB));
  // Team A must stay outside the centre circle
  positioned = enforceKickoffCircleRule(positioned, 'A');

  const kickoffHolder =
    positioned.find(p => p.team === 'B' && p.role === 'ST') ??
    positioned.find(p => p.team === 'B')!;

  gameBus.emit('kickOff', { team: 'B', phase: 'secondHalf' });

  const prevHolderId = state.ballHolderId;
  return onPossessionTransfer({
    ...state,
    players:               positioned,
    ballHolderId:          kickoffHolder.id,
    pass:                  null,
    shot:                  null,
    looseBall:             null,
    matchPhase:            'secondHalf',
    matchTime:             0,
    presentationCountdown: 0,
    setPiece:              { type: 'kickoff', takerId: kickoffHolder.id, countdown: 2 },
    possessionTime:        0,
    lastPasserId:          null,
  }, prevHolderId);
}


function startShot(state: GameState): GameState {
  const shooter = state.players.find(p => p.id === state.ballHolderId)!;
  const { toX, toY } = computeShotAim(shooter);

  // xG context: distance, open goal angle, and nearby defensive pressure
  const goalX     = shooter.attackDir === 1 ? PITCH_LENGTH : 0;
  const dist      = Math.abs(goalX - shooter.x);
  const openAngle = computeOpenAngle(shooter.x, shooter.y, goalX);
  const defenders = state.players.filter(p => p.team !== shooter.team);
  const pressure  = computeWeightedPressure(shooter, defenders);
  const xg = computeXG(dist, openAngle, pressure);

  gameBus.emit('shot', { player: shooter.id, xg });

  return {
    ...state,
    shot: { shooterId: shooter.id, fromX: shooter.x, fromY: shooter.y, toX, toY, t: 0, xg },
    // Clear any active set piece — once the ball is struck, play is live
    setPiece: null,
  };
}

/**
 * Determine whether a pass receiver is in an offside position at the instant
 * the pass is played. All conditions (opponent half, ahead of ball, ahead of
 * second-last defender) are encoded in the effective offside line.
 */
function checkReceiverOffside(
  holder:     GamePlayer,
  receiver:   GamePlayer,
  allPlayers: GamePlayer[],
): boolean {
  if (!OFFSIDE_CONFIG.ENABLED) return false;

  const fwd  = holder.attackDir;
  const line = computeOffsideLine(fwd, allPlayers, holder.team, holder.x);
  if (line === null) return false;

  return fwd === 1 ? receiver.x > line : receiver.x < line;
}

function startPass(state: GameState): GameState {
  const holder    = state.players.find(p => p.id === state.ballHolderId)!;
  const teammates = getTeammates(state, holder.id);
  if (teammates.length === 0) return state;

  const opponents = state.players.filter(p => p.team !== holder.team);
  const intent    = state.teamIntent[holder.team];
  const lanes     = evaluatePassLanes(holder, teammates, opponents, intent);

  // Proportional selection among top 3 lanes: score^k weighting.
  // Close scores (0.9/0.8/0.7) → competitive; large gap (0.9/0.4/0.3) → top dominates.
  const top3    = [...lanes].sort((a, b) => b.score - a.score).slice(0, 3);
  const k       = PASS_CONFIG.PASS_SELECTION_EXPONENT;
  const weights = top3.map(l => Math.pow(Math.max(0, l.score), k));
  const total   = weights.reduce((s, w) => s + w, 0);
  let chosen    = top3[0]; // fallback: best lane
  if (total > 0) {
    let roll = Math.random() * total;
    for (let i = 0; i < top3.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { chosen = top3[i]; break; }
    }
  }
  const to     = state.players.find(p => p.id === chosen.toId)!;

  // Snapshot offside position at the moment the pass is played (not at arrival)
  const receiverOffside = checkReceiverOffside(holder, to, state.players);

  const distance = Math.sqrt((to.x - holder.x) ** 2 + (to.y - holder.y) ** 2);

  gameBus.emit('passAttempted', { player: holder.id, toId: to.id, distance: distance });
  // Switch-of-play: the chosen lane earned a far-flank descriptor bonus. Detected
  // from the descriptor-derived flag on PassLaneInfo, never by naming the intent.
  if (chosen.switchPass) gameBus.emit('switchPlayPass', { player: holder.id, toId: to.id });
  // Clear any active set piece — once the pass leaves the taker's foot, play is live
  return {
    ...state,
    pass: {
      fromId: state.ballHolderId,
      toId: to.id,
      toX: to.x,
      toY: to.y,
      kind: 'regular',
      t: 0,
      distance,
      receiverOffside,
      intendedRunnerId: null,
    },
    setPiece: null,
  };
}

/**
 * Sprint speed for a chasing player (yards/second). Re-uses pressSpeed and
 * applies heavier acceleration / top-end boosts than press to model an all-out
 * sprint. Mirrors the formula in ThroughBallCells.effectiveSprintSpeed.
 */
function chaseSprintSpeed(p: GamePlayer): number {
  const wb = p.runtimeStats.withoutBall;
  return (
    wb.pressSpeed +
    wb.acceleration * THROUGH_BALL_CONFIG.SPRINT_ACCEL_BOOST +
    wb.speed        * THROUGH_BALL_CONFIG.SPRINT_TOP_BOOST
  );
}

/**
 * Override `state.decisions` for the top-N chasers from each team — they leave
 * their current decision (off-ball intent, defensive intent) to sprint to the
 * loose-ball landing point.
 *
 * Algorithm:
 *   1. Rank candidates by ETA (distance / sprint speed)
 *   2. Apply role weight (CHASE_LOOSE_BALL_WEIGHT_ATTACK/DEFEND) and ETA horizon gate
 *   3. Override the top MAX_CHASERS_PER_TEAM per team with `chase_loose_ball`
 *   4. Bump commitTicks so the chase doesn't flicker mid-sprint
 *
 * GK chase is permitted only when the landing point is inside that GK's own box.
 */
function commitLooseBallChasers(
  state:    GameState,
  passerId: number,
  toX:      number,
  toY:      number,
): GameState {
  const passer = state.players.find(p => p.id === passerId);
  if (!passer) return state;
  const passerTeam = passer.team;

  type Cand = { id: number; team: TeamId; eta: number; role: PlayerRole };
  const collect = (team: TeamId, isAttacking: boolean): Cand[] => {
    const out: Cand[] = [];
    for (const p of state.players) {
      if (p.team !== team) continue;
      if (p.id === passerId) continue;
      if (isPlayerInRecovery(p)) continue;
      // Role weight gate
      const weights = isAttacking ? CHASE_LOOSE_BALL_WEIGHT_ATTACK : CHASE_LOOSE_BALL_WEIGHT_DEFEND;
      let weight = weights[p.role];
      // Sweeper-keeper: only chase if the cell is in our own box
      if (p.role === 'GK') {
        const ownGoalX = p.attackDir === 1 ? 0 : PITCH_LENGTH;
        weight = isInGoalScoreArea(toX, toY, ownGoalX) ? 1.0 : 0;
      }
      if (weight < THROUGH_BALL_CONFIG.ROLE_CHASE_THRESHOLD) continue;
      const dist = Math.hypot(p.x - toX, p.y - toY);
      const speed = chaseSprintSpeed(p);
      const eta = speed > 0.01 ? dist / speed : Infinity;
      out.push({ id: p.id, team, eta, role: p.role });
    }
    out.sort((a, b) => a.eta - b.eta);
    return out;
  };

  const teamA = collect('A', passerTeam === 'A');
  const teamB = collect('B', passerTeam === 'B');

  const pickTop = (arr: Cand[]): Cand[] => {
    if (arr.length === 0) return [];
    const bestEta = arr[0]!.eta;
    return arr
      .filter(c => c.eta - bestEta <= THROUGH_BALL_CONFIG.ETA_HORIZON)
      .slice(0, THROUGH_BALL_CONFIG.MAX_CHASERS_PER_TEAM);
  };

  const chasers = [...pickTop(teamA), ...pickTop(teamB)];
  if (chasers.length === 0) return state;

  if (isDebugEnabled()) {
    gameBus.emit('chaseCommit', {
      toX, toY,
      chasers: chasers.map(c => ({ id: c.id, team: c.team, eta: c.eta })),
    });
  }

  const newDecisions = { ...state.decisions };
  const newPlayers = state.players.map(p => {
    const c = chasers.find(x => x.id === p.id);
    if (!c) return p;
    const chaseDecision: PlayerDecision = { type: 'chase_loose_ball', toX, toY };
    newDecisions[p.id] = chaseDecision;
    // Path must reflect the team relationship to the *passer* (current ballHolder)
    // so the next tick's commit-reuse path-check passes — without it pathChanged
    // would force a fresh decide() and lose the chase decision.
    const path: DecisionPath = p.team === passerTeam ? 'TEAM_WITH_BALL' : 'TEAM_WITHOUT_BALL';
    return {
      ...p,
      decisionMemory: {
        path,
        decision:    chaseDecision,
        commitTicks: COMMIT_TICKS.chase_loose_ball,
      },
    };
  });
  return { ...state, decisions: newDecisions, players: newPlayers };
}

/**
 * Start a through ball — pass into space at (cellX, cellY).
 *
 * The ball is in flight to a position, not a player. Phase 3: on landing the
 * nearest player picks it up. Phase 5 will replace this with a sprint race +
 * loose-ball duel.
 */
function startThroughBall(
  state:    GameState,
  decision: { cellX: number; cellY: number; intendedRunnerId: number | null },
): GameState {
  const holder = state.players.find(p => p.id === state.ballHolderId)!;

  // Pass-error model — Gaussian noise on landing point scaled by (1 − passingSkill).
  // Box-Muller approximation.
  const skill   = holder.runtimeStats.withBall.passingSkill;
  const sigma   = (1 - skill) * THROUGH_BALL_CONFIG.MAX_THROUGH_BALL_ERROR / 2;
  const u1      = Math.max(1e-6, Math.random());
  const u2      = Math.random();
  const z0      = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const z1      = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
  const landingX = decision.cellX + z0 * sigma;
  const landingY = decision.cellY + z1 * sigma;

  // Offside snapshot — for the intended runner, at kick time. Phase 3 v1: only
  // the intended runner's offside status is snapshotted. If a non-intended
  // teammate (who happened to be onside) ends up nearest at landing, no offside.
  const intendedRunner = decision.intendedRunnerId
    ? state.players.find(p => p.id === decision.intendedRunnerId) ?? null
    : null;
  const runnerOffside = intendedRunner
    ? checkReceiverOffside(holder, intendedRunner, state.players)
    : false;

  const distance = Math.sqrt((landingX - holder.x) ** 2 + (landingY - holder.y) ** 2);

  gameBus.emit('passAttempted', { player: holder.id, toId: holder.id, distance });
  gameBus.emit('throughBallStarted', {
    player:           holder.id,
    toX:              landingX,
    toY:              landingY,
    intendedRunnerId: decision.intendedRunnerId,
  });
  debugLog('throughBall', `${holder.name} plays through ball to (${landingX.toFixed(0)}, ${landingY.toFixed(0)})`, {
    playerId: holder.id,
    data:     { intendedRunnerId: decision.intendedRunnerId, distance: Math.round(distance) },
  });

  const stateWithPass: GameState = {
    ...state,
    pass: {
      fromId:           state.ballHolderId,
      toId:             null,
      toX:              landingX,
      toY:              landingY,
      kind:             'through',
      t:                0,
      distance,
      receiverOffside:  runnerOffside,
      intendedRunnerId: decision.intendedRunnerId,
    },
    setPiece: null,
  };

  // Phase 4: commit chasers from both teams. Their decisions are overridden to
  // `chase_loose_ball` so they sprint at full pace toward the landing point
  // (no formation pull, only pitch bounds).
  return commitLooseBallChasers(stateWithPass, holder.id, landingX, landingY);
}

// ── Out-of-bounds set-piece helpers ─────────────────────────────────────────
// Used by handleLooseBall when the drifting ball crosses a pitch boundary.
// Resolves into a throw-in (touchline), goal kick (defending byline) or
// corner (attacking team's own byline — rare for forward through balls but
// kept for completeness).

type OOBKind = 'throw_in' | 'goal_kick' | 'corner';

function nearestPlayerTo(pool: GamePlayer[], pos: { x: number; y: number }): GamePlayer {
  return pool.reduce((best, p) => {
    const d  = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2;
    const bd = (best.x - pos.x) ** 2 + (best.y - pos.y) ** 2;
    return d < bd ? p : best;
  });
}

function oobLayoutFor(
  kind:    OOBKind,
  side:    'attack' | 'defend',
  layouts: FormationSetPieces,
): SetPieceLayout {
  if (kind === 'throw_in') return side === 'attack' ? layouts.throwIn_Attack : layouts.throwIn_Defend;
  if (kind === 'corner')   return side === 'attack' ? layouts.corner_Attack  : layouts.corner_Defend;
  // goal_kick: only an attacking layout (the GK's team). Defending team has no
  // dedicated goalKick_Defend — they hold their kickoff defending shape.
  return side === 'attack' ? layouts.goalKick : layouts.kickOffDefend;
}

function oobCountdownFor(kind: OOBKind): number {
  if (kind === 'throw_in') return 1.5;
  if (kind === 'corner')   return 2;
  return 1; // goal_kick — matches the value used after saves/missed shots
}

/**
 * Compute the actual ball-restart position on the pitch boundary.
 *
 * - throw_in: clamp X, snap Y to whichever touchline was crossed.
 * - corner:   snap to the corner flag of the line crossed, on the side the ball went out.
 * - goal_kick: 6-yard box edge of the awarded team's goal, centred.
 */
function computeOOBRestartPosition(
  kind:        OOBKind,
  exitX:       number,
  exitY:       number,
  awardedTeam: TeamId,
  players:     GamePlayer[],
): { x: number; y: number } {
  if (kind === 'throw_in') {
    const x = Math.max(0, Math.min(PITCH_LENGTH, exitX));
    const y = exitY < 0 ? 0 : PITCH_WIDTH;
    return { x, y };
  }
  if (kind === 'corner') {
    const x = exitX < 0 ? 0 : PITCH_LENGTH;
    const y = exitY < PITCH_WIDTH / 2 ? 0 : PITCH_WIDTH;
    return { x, y };
  }
  // goal_kick — own goal line of the awarded team, six yards out, centred.
  const someAwardedPlayer = players.find(p => p.team === awardedTeam);
  const attackDir         = someAwardedPlayer?.attackDir ?? 1;
  const ownGoalX          = attackDir === 1 ? 0 : PITCH_LENGTH;
  const x                 = ownGoalX === 0 ? 6 : PITCH_LENGTH - 6;
  return { x, y: 37 };
}

/**
 * Pick which player on the awarded team takes the restart.
 *
 * - goal_kick: GK always.
 * - corner:    nearest winger / wide player to the corner flag side.
 * - throw_in:  nearest outfield player to the throw-in spot.
 */
function pickOOBTaker(
  kind:        OOBKind,
  awardedTeam: TeamId,
  position:    { x: number; y: number },
  players:     GamePlayer[],
): GamePlayer {
  const team = players.filter(p => p.team === awardedTeam);
  if (kind === 'goal_kick') {
    return team.find(p => p.role === 'GK') ?? nearestPlayerTo(team, position);
  }
  if (kind === 'corner') {
    const isLeftSide = position.y === 0;
    const preferred  = isLeftSide ? ['LW', 'LM', 'LWB', 'LB'] : ['RW', 'RM', 'RWB', 'RB'];
    for (const role of preferred) {
      const found = team.find(p => p.role === role as PlayerRole);
      if (found) return found;
    }
    return nearestPlayerTo(team, position);
  }
  // throw_in — outfield only, nearest to throw point.
  const outfield = team.filter(p => p.role !== 'GK');
  return nearestPlayerTo(outfield.length > 0 ? outfield : team, position);
}

/**
 * Resolve a ball-out-of-bounds event into a set-piece freeze.
 *
 * Full sequence:
 *   1. Choose restart position (corner flag / touchline / six-yard line).
 *   2. Pick taker (winger / GK / closest outfield).
 *   3. Apply the awarded team into _Attack layout, opposite team into _Defend layout.
 *   4. Move the taker on top of the ball position (overrides their layout slot).
 *   5. Emit existing TB-lost stat events so /lab still tracks the failed pass.
 *   6. Set state.setPiece with kind + taker + countdown + position.
 */
function resolveOOBSetPiece(
  s:             GameState,
  kind:          OOBKind,
  awardedTeam:   TeamId,
  exitX:         number,
  exitY:         number,
  fromPasserId:  number,
): TickResult {
  const oppositeTeam: TeamId = awardedTeam === 'A' ? 'B' : 'A';

  const position = computeOOBRestartPosition(kind, exitX, exitY, awardedTeam, s.players);
  const taker    = pickOOBTaker(kind, awardedTeam, position, s.players);

  // Layouts — awarded team plays the _Attack shape, opposite team plays _Defend.
  const awFmt = awardedTeam === 'A' ? s.formationA : s.formationB;
  const opFmt = awardedTeam === 'A' ? s.formationB : s.formationA;
  const aLay  = getFormationSetPieces(awFmt.id);
  const oLay  = getFormationSetPieces(opFmt.id);

  let players = s.players;
  if (aLay) players = applySetPieceToTeam(players, awardedTeam,  oobLayoutFor(kind, 'attack', aLay));
  if (oLay) players = applySetPieceToTeam(players, oppositeTeam, oobLayoutFor(kind, 'defend', oLay));

  // Move the taker on top of the actual ball position so they're holding it.
  players = players.map(p =>
    p.id === taker.id
      ? { ...p, x: position.x, y: position.y, targetPosition: { x: position.x, y: position.y } }
      : p,
  );

  gameBus.emit('throughBallLostInRace', { player: fromPasserId, defenderWinnerId: taker.id });
  debugLog('throughBall', `Ball OOB at (${exitX.toFixed(1)}, ${exitY.toFixed(1)}) → ${kind} for team ${awardedTeam} (taker ${taker.name})`, {
    playerId: taker.id,
    data:     { fromId: fromPasserId, kind, restart: position },
  });

  const prevHolderId = s.ballHolderId;
  return {
    state: onPossessionTransfer({
      ...s,
      players,
      looseBall:      null,
      ballHolderId:   taker.id,
      possessionTime: 0,
      lastPasserId:   null,
      setPiece: {
        type:      kind,
        takerId:   taker.id,
        countdown: oobCountdownFor(kind),
        position,
      },
    }, prevHolderId),
    passCompleted: false, tackled: false, goalScored: null,
  };
}

/**
 * Tick the loose-ball phase — the ball drifts in space at `state.looseBall.{x,y}`
 * after a through ball lands. Each tick we:
 *   1. Advance the ball by its current velocity.
 *   2. Decay velocity via LOOSE_BALL_DECELERATION (friction).
 *   3. If the ball crosses a pitch boundary → award to the opposing team.
 *   4. Otherwise check who's within LOOSE_BALL_TOUCH_RADIUS:
 *      • 0 players in touch → ball keeps drifting (or sits if velocity = 0).
 *      • 1 player in touch (or top-2 are same-team / gap > DUEL_GAP_TRIGGER) →
 *        clean pickup, possession transfers.
 *      • 2 opposing players within DUEL_RADIUS and gap ≤ DUEL_GAP_TRIGGER →
 *        contested duel (resolveLooseBallDuel), both enter recovery.
 *
 * Players continue sprinting because their `chase_loose_ball` decisions are
 * pinned by the decision loop with the *current* loose-ball position, so
 * chasers automatically track the drifting ball.
 *
 * Offside enforcement runs at pickup time only when the *intended runner* is
 * the one who collects. Out-of-bounds awards bypass offside entirely.
 */
function handleLooseBall(s: GameState, dt: number): TickResult {
  const cfg = THROUGH_BALL_CONFIG;
  let lb = s.looseBall!;

  // ── 1. Advance ball + decay velocity ─────────────────────────────────────
  let { x, y, vx, vy } = lb;
  const speed = Math.hypot(vx, vy);
  if (speed > 0) {
    const newSpeed = Math.max(0, speed - cfg.LOOSE_BALL_DECELERATION * dt);
    const factor   = newSpeed / speed;
    vx *= factor;
    vy *= factor;
    x  += lb.vx * dt;
    y  += lb.vy * dt;
  }

  // ── 2. Out of bounds → throw-in / goal-kick / corner ──────────────────────
  // Touchline crossing → throw-in. Goal-line crossing → goal kick if the passer's
  // team played it over the OPPONENT'S goal line (normal forward through ball);
  // corner if (rare) it crossed the passer's OWN goal line.
  if (x < 0 || x > PITCH_LENGTH || y < 0 || y > PITCH_WIDTH) {
    const passer       = s.players.find(p => p.id === lb.fromPasserId);
    const passerDir    = passer?.attackDir ?? 1;
    const awardedTeam: TeamId = lb.fromTeamLastTouch === 'A' ? 'B' : 'A';

    let kind: OOBKind;
    if (y < 0 || y > PITCH_WIDTH) {
      kind = 'throw_in';
    } else {
      const overOpponentsGoal =
        (passerDir === 1 && x > PITCH_LENGTH) ||
        (passerDir === -1 && x < 0);
      kind = overOpponentsGoal ? 'goal_kick' : 'corner';
    }

    return resolveOOBSetPiece(s, kind, awardedTeam, x, y, lb.fromPasserId);
  }

  // ── 3. Persist the new ball position + velocity for downstream lookups ────
  s = { ...s, looseBall: { ...lb, x, y, vx, vy } };
  lb = s.looseBall!;
  const passer = s.players.find(p => p.id === lb.fromPasserId);

  // Sort players by distance to the loose ball
  const ranked = s.players
    .filter(p => !isPlayerInRecovery(p))
    .map(p => ({ p, dist: Math.hypot(p.x - lb.x, p.y - lb.y) }))
    .sort((a, b) => a.dist - b.dist);

  // Players within touch radius — they can pick up
  const inTouch = ranked.filter(r => r.dist <= cfg.LOOSE_BALL_TOUCH_RADIUS);

  // ── 4. No one in reach yet — ball keeps drifting (or sits if v = 0) ──────
  if (inTouch.length === 0) {
    return { state: s, passCompleted: false, tackled: false, goalScored: null };
  }

  // ── Someone arrived — clean pickup OR contested duel ───────────────────
  let winner: GamePlayer;
  let duelLost = false;

  if (
    inTouch.length >= 2 &&
    inTouch[0]!.p.team !== inTouch[1]!.p.team &&
    inTouch[1]!.dist <= cfg.DUEL_RADIUS &&
    inTouch[1]!.dist - inTouch[0]!.dist <= cfg.DUEL_GAP_TRIGGER
  ) {
    const a = inTouch[0]!.p;
    const b = inTouch[1]!.p;
    const gap = inTouch[1]!.dist - inTouch[0]!.dist;
    const { winnerId, probA } = resolveLooseBallDuel(a, b, gap);
    winner = winnerId === a.id ? a : b;
    debugLog('throughBall', `Loose-ball duel: ${a.name} vs ${b.name} → ${winner.name} (probA=${probA.toFixed(2)})`, {
      playerId: winner.id, data: { fromId: lb.fromPasserId, gap: Math.round(gap * 10) / 10 },
    });
    s = {
      ...s,
      players: s.players.map(p => {
        if (p.id === a.id || p.id === b.id) return { ...p, recoveryTime: DUEL_TACKLE_WIN_RECOVERY };
        return p;
      }),
    };
    if (winner.team !== lb.fromTeamLastTouch) {
      gameBus.emit('throughBallLostInDuel', { player: lb.fromPasserId, defenderWinnerId: winner.id });
      duelLost = true;
    }
  } else {
    winner = inTouch[0]!.p;
  }

  // ── Offside enforcement — only if the intended runner is the one who collects
  const flaggedOffside =
    lb.receiverOffside &&
    lb.intendedRunnerId !== null &&
    winner.id === lb.intendedRunnerId;

  if (flaggedOffside) {
    gameBus.emit('offsideCalled', { team: winner.team, receiverId: winner.id });
    gameBus.emit('throughBallLostInFlight', { player: lb.fromPasserId, interceptorId: winner.id });
    const defenders = s.players.filter(p => p.team !== winner.team);
    const nearestDefender = defenders.reduce((best, p) => {
      const d  = (p.x - lb.x) ** 2 + (p.y - lb.y) ** 2;
      const bd = (best.x - lb.x) ** 2 + (best.y - lb.y) ** 2;
      return d < bd ? p : best;
    });
    const prevHolderId = s.ballHolderId;
    return {
      state: onPossessionTransfer({
        ...s,
        looseBall: null,
        ballHolderId: nearestDefender.id,
        possessionTime: 0,
        lastPasserId: null,
        setPiece: { type: 'offside_fk', takerId: nearestDefender.id, countdown: 2, position: { x: lb.x, y: lb.y } },
      }, prevHolderId),
      passCompleted: false, tackled: false, goalScored: null,
    };
  }

  const wonByTeam = winner.team === lb.fromTeamLastTouch;
  void passer;

  if (wonByTeam) {
    const isIntended = lb.intendedRunnerId === winner.id;
    gameBus.emit('throughBallCompleted', { player: lb.fromPasserId, winnerId: winner.id, intendedRunnerId: lb.intendedRunnerId });
    debugLog('throughBall', `Loose ball collected by ${winner.name}${isIntended ? ' (intended runner)' : ''}`, {
      playerId: winner.id, data: { fromId: lb.fromPasserId },
    });
    return {
      state: {
        ...s,
        ballHolderId: winner.id,
        looseBall: null,
        lastPasserId: lb.fromPasserId,
        players: s.players.map(p => p.id === winner.id ? { ...p, justReceivedTicks: 4 } : p),
      },
      passCompleted: true, tackled: false, goalScored: null,
    };
  }

  // Defender wins
  if (!duelLost) {
    gameBus.emit('throughBallLostInRace', { player: lb.fromPasserId, defenderWinnerId: winner.id });
  }
  debugLog('throughBall', `Loose ball won by defender ${winner.name}`, {
    playerId: winner.id, data: { fromId: lb.fromPasserId },
  });
  const prevHolderId = s.ballHolderId;
  return {
    state: onPossessionTransfer(
      { ...s, looseBall: null, ballHolderId: winner.id, possessionTime: 0, lastPasserId: null },
      prevHolderId,
    ),
    passCompleted: false, tackled: true, goalScored: null,
  };
}

// ── Tick ─────────────────────────────────────────────────────────────────────

export type TickResult = {
  state:         GameState;
  passCompleted: boolean;
  tackled:       boolean;
  goalScored:    import('../types').TeamId | null;
};

/**
 * Advance the simulation by `dt` seconds.
 *
 * Order of operations each tick (ball-held frame only):
 *   1. Apply formation/press movement — GK sprints to intercept during a shot
 *   2. Tackle check — closest opponent within tackleRange gets a 50 % attempt
 *   3. Shoot or pass decision — holder decides based on distance to goal
 *
 * During a pass or shot in flight, only ball advancement runs (no pressing/tackling).
 */
export function tickState(state: GameState, dt: number, passSpeed = 0.85): TickResult {
  const noop = (s: GameState): TickResult =>
    ({ state: s, passCompleted: false, tackled: false, goalScored: null });

  // ── Match phase gating ────────────────────────────────────────────────────
  if (state.matchPhase === 'preMatch') {
    const countdown = state.presentationCountdown - dt;
    if (countdown <= 0) {
      gameBus.emit('matchStart', { extraTime: Math.round(state.extraTimeFirst / 60) });
      gameBus.emit('kickOff', { team: 'A', phase: 'firstHalf' });
      return noop({ ...state, matchPhase: 'firstHalf', presentationCountdown: 0 });
    }
    return noop({ ...state, presentationCountdown: countdown });
  }

  if (state.matchPhase === 'halfTime') {
    const countdown = state.presentationCountdown - dt;
    if (countdown <= 0) {
      return noop(switchSides(state));
    }
    // Flush pending subs during the half-time window before the second half starts
    let htState = { ...state, presentationCountdown: countdown };
    if (htState.pendingSubsA.length > 0 || htState.pendingSubsB.length > 0) {
      htState = flushPendingSubs(htState, 'A');
      htState = flushPendingSubs(htState, 'B');
    }
    return noop(htState);
  }

  if (state.matchPhase === 'matchEnd') {
    return noop(state); // frozen — no further simulation
  }

  // ── Clock advancement (firstHalf / secondHalf only) ───────────────────────
  const newMatchTime  = state.matchTime + dt * TIME_SCALE;
  const extraTime     = state.matchPhase === 'firstHalf' ? state.extraTimeFirst : state.extraTimeSecond;
  const halfEnd       = HALF_DURATION + extraTime;

  if (!state.testMode && newMatchTime >= halfEnd) {
    if (state.matchPhase === 'firstHalf') {
      gameBus.emit('halfTime', {
        score:     state.score,
        extraTime: Math.round(state.extraTimeSecond / 60),
      });
      return noop({
        ...state, matchTime: newMatchTime,
        matchPhase: 'halfTime', presentationCountdown: PRESENTATION_DURATION,
        pass: null, shot: null, looseBall: null,
      });
    } else {
      // Second half over → match end
      gameBus.emit('matchEnd', { score: state.score });
      return noop({ ...state, matchTime: newMatchTime, matchPhase: 'matchEnd' });
    }
  }

  // Set-piece freeze (kickoff / goal kick / offside FK) — drain countdown,
  // hold all state; flush pending subs during the freeze. When countdown
  // reaches 0 the setPiece stays non-null (taker still cannot carry) until
  // the ball is played; it is cleared by startPass() / startShot().
  if (state.setPiece && state.setPiece.countdown > 0) {
    const nextCountdown = Math.max(0, state.setPiece.countdown - dt);
    let frozenState: GameState = {
      ...state,
      matchTime: newMatchTime,
      setPiece: { ...state.setPiece, countdown: nextCountdown },
    };
    if (frozenState.pendingSubsA.length > 0 || frozenState.pendingSubsB.length > 0) {
      frozenState = flushPendingSubs(frozenState, 'A');
      frozenState = flushPendingSubs(frozenState, 'B');
    }
    return noop(frozenState);
  }

  let s: GameState = {
    ...state,
    matchTime:      newMatchTime,
    tackleCooldown: Math.max(0, state.tackleCooldown - dt),
    // Drain per-player recovery debuffs
    players: state.players.map(p => {
      const updates: Partial<typeof p> = {};
      if (p.recoveryTime > 0) updates.recoveryTime = Math.max(0, p.recoveryTime - dt);
      if (p.justReceivedTicks > 0) updates.justReceivedTicks = p.justReceivedTicks - 1;
      return Object.keys(updates).length > 0 ? { ...p, ...updates } : p;
    }),
  };

  // GK fake-stop: flush pending subs when GK holds the ball (not while a pass/shot is in flight)
  if (s.pendingSubsA.length > 0 || s.pendingSubsB.length > 0) {
    const currentHolder = s.players.find(p => p.id === s.ballHolderId);
    if (currentHolder?.role === 'GK' && s.pass === null && s.shot === null) {
      s = flushPendingSubs(s, 'A');
      s = flushPendingSubs(s, 'B');
    }
  }

  // ── AI substitution evaluation (second half only, periodic) ───────────────
  // In live matches, only Team B (opponent) is AI-controlled; in headless mode,
  // SimulateMatch passes aiTeams = ['A', 'B'] via the optional parameter below.
  if (s.matchPhase === 'secondHalf' && shouldCheckAiSubs(s.matchTime, dt * TIME_SCALE)) {
    // Team B is always AI in live matches; `aiTeams` can override for headless sim
    const subsB = evaluateAiSubstitutions(s, 'B');
    if (subsB.length > 0) {
      s = { ...s, pendingSubsB: [...s.pendingSubsB, ...subsB] };
    }
  }

  const holder  = s.players.find(p => p.id === s.ballHolderId)!;
  const inFlight = s.pass !== null || s.shot !== null;

  // ── Possession timer ───────────────────────────────────────────────────
  // Always increment here. Individual possession-change handlers (tackle,
  // interception, dribble loss, offside, GK save) reset it to 0 when the
  // ball moves to the other team.
  s = { ...s, possessionTime: (state.possessionTime ?? 0) + dt };

  // ── Periodic team intent re-evaluation ────────────────────────────────
  // Possession-transfer recompute handles turnovers; this catches mid-possession
  // shifts (opponent advances, numbers change) without per-tick churn.
  const lastEval = s.lastIntentEvalTime ?? 0;
  if (s.matchTime - lastEval >= INTENT_REEVAL_INTERVAL) {
    // Periodic re-eval excludes switch_play — it is decided per-possession at
    // possession-change / reception, not re-judged on this timer (which would
    // flip it to balanced when the holder's wide-geometry goes momentarily stale).
    s = reevaluateTeamIntents(s, { includeSwitchPlay: false });
  }

  // ── Pre-compute shared values ──────────────────────────────────────────
  const ballPos       = getBallPos(s);
  const attackingTeam: TeamId = holder.team;
  const defendingTeam: TeamId = attackingTeam === 'A' ? 'B' : 'A';
  const offsideLine   = computeOffsideLine(
    holder.attackDir, s.players, attackingTeam, ballPos.x,
  );
  // One density grid per tick — passed into decide() so the carrier's clearness
  // check can fade role-fit/byline penalties when the path to goal is open.
  const crowdGrid     = computeCrowdGrid(s);

  // ── Through-ball cell cache (refresh every TB_CACHE_REFRESH_TICKS) ─────
  // The TB cell ranking is dominated by race-margin and path-clearness, both of
  // which shift slowly tick-to-tick. Recomputing the full 2560-cell grid every
  // tick is wasteful; reusing the previous tick's cells while the same player
  // holds the ball is safe. Cache invalidates on holder change.
  const TB_CACHE_REFRESH_TICKS = 2;
  let tbCachedCells: import('./ThroughBallCells').CandidateCell[] | null = null;
  // Loose `!= null` so a saved/loaded state without this field (`undefined`) is
  // treated identically to an explicit `null` — without it, accessing
  // `cache.holderId` on undefined crashes the tick.
  let nextTbCache = s.throughBallCellsCache ?? null;
  if (!inFlight && holder.role !== 'GK') {
    const cache = s.throughBallCellsCache;
    const sameHolder = cache != null && cache.holderId === s.ballHolderId;
    const fresh      = sameHolder && cache!.ticksSinceRefresh < TB_CACHE_REFRESH_TICKS;
    if (fresh) {
      tbCachedCells = cache!.cells;
      nextTbCache   = { ...cache!, ticksSinceRefresh: cache!.ticksSinceRefresh + 1 };
    } else {
      tbCachedCells = enumerateCandidateCells(holder, s.players, crowdGrid, offsideLine);
      nextTbCache   = {
        holderId:          s.ballHolderId,
        ticksSinceRefresh: 1,
        cells:             tbCachedCells,
      };
    }
  } else if (s.throughBallCellsCache != null) {
    // No valid TB context (in flight, or GK has the ball) — drop the cache so
    // the next holder gets a fresh enumeration.
    nextTbCache = null;
  }
  s = { ...s, throughBallCellsCache: nextTbCache };

  // ── Compute decisions with short-term memory ───────────────────────────
  // Each player has a DecisionPath (BALL_HOLDER | TEAM_WITH_BALL | TEAM_WITHOUT_BALL).
  // When the path is unchanged and commitTicks > 0, the previous decision is reused.
  // Path changes (e.g. possession switch) always force a fresh decision immediately.
  const newDecisions: Record<number, PlayerDecision> = {};
  const updatedMemory: Record<number, import('./DecisionTree').DecisionMemory> = {};

  // Through ball in flight OR loose ball sitting? Chasers stay PINNED to
  // chase_loose_ball — without this, decide() runs fresh next tick and replaces
  // the injected chase decision with a normal off-ball / defensive intent, so
  // the players never actually sprint and the duel resolves on whoever
  // happened to be near.
  const tbInFlight   = s.pass?.kind === 'through';
  const looseBallSit = s.looseBall != null;
  const chaseTarget = tbInFlight
    ? { x: s.pass!.toX, y: s.pass!.toY }
    : looseBallSit
      ? { x: s.looseBall!.x, y: s.looseBall!.y }
      : null;

  for (const p of s.players) {
    const isBallHolder = p.id === s.ballHolderId;
    const currentPath: DecisionPath = isBallHolder
      ? 'BALL_HOLDER'
      : p.team === holder.team
        ? 'TEAM_WITH_BALL'
        : 'TEAM_WITHOUT_BALL';

    const mem = p.decisionMemory ?? EMPTY_DECISION_MEMORY;

    // ── Pin chasers during through-ball flight + loose-ball wait ──────────
    // Override anything else: if this player was committed to chase, refresh
    // their commitment with the (possibly updated) target so they keep running.
    if (chaseTarget && !isBallHolder && mem.decision?.type === 'chase_loose_ball') {
      const chaseDecision: PlayerDecision = {
        type: 'chase_loose_ball',
        toX:  chaseTarget.x,
        toY:  chaseTarget.y,
      };
      newDecisions[p.id] = chaseDecision;
      updatedMemory[p.id] = {
        path:        currentPath,
        decision:    chaseDecision,
        commitTicks: COMMIT_TICKS.chase_loose_ball,
      };
      continue;
    }

    const pathChanged = mem.path !== currentPath;

    // Reuse committed decision if path is stable and ticks remain.
    // Ball holder is always re-evaluated (carries, shoots, passes change quickly).
    if (!isBallHolder && !pathChanged && mem.commitTicks > 0 && mem.decision !== null) {
      newDecisions[p.id] = mem.decision;
      updatedMemory[p.id] = { ...mem, commitTicks: mem.commitTicks - 1 };
      continue;
    }

    // Fresh decision — only the holder uses tbCachedCells (no-op for everyone else)
    const fresh = decide(
      p, holder, isBallHolder, inFlight, s.players, offsideLine, s.possessionTime,
      s.setPiece, crowdGrid, s.teamIntent,
      isBallHolder ? tbCachedCells : null,
    );
    newDecisions[p.id] = fresh;
    updatedMemory[p.id] = { path: currentPath, decision: fresh, commitTicks: COMMIT_TICKS[fresh.type] };
  }


  // Apply new memory to player objects
  const playersWithMemory = s.players.map(p => ({
    ...p,
    decisionMemory: updatedMemory[p.id] ?? p.decisionMemory,
  }));

  s = { ...s, decisions: newDecisions, players: playersWithMemory };

  if (shouldDrainStamina(s)) {
    s = {
      ...s,
      players: s.players.map(p => {
        const pl = normalizeGamePlayer(p);
        if (pl.baseStats == null) return p;
        const dec = newDecisions[pl.id];
        const action = resolveStaminaAction(pl, s.ballHolderId, holder.team, dec);
        const energy = consumeEnergy(pl.energy, pl.stamina, action, dt * TIME_SCALE);
        if (energy === pl.energy) return p;
        // getReductionFactor uses floor(energyLost / step) — the multipliers only
        // change when energy crosses multiples of 10, 20, or 40. Skip the expensive
        // getRuntimeLineup spread unless a threshold actually flipped.
        const oldLost = 100 - pl.energy;
        const newLost = 100 - energy;
        const factorsChanged =
          Math.floor(oldLost / 10) !== Math.floor(newLost / 10) ||
          Math.floor(oldLost / 20) !== Math.floor(newLost / 20) ||
          Math.floor(oldLost / 40) !== Math.floor(newLost / 40);
        if (!factorsChanged) return { ...pl, energy };
        return { ...pl, energy, runtimeStats: getRuntimeLineup(pl.baseStats, { energy }) };
      }),
    };
  }

  // ── 1. Formation movement — runs every tick, including during passes/shots ──
  {
    const markAssignments = assignMarkTargets(s.players, defendingTeam);

    const movedPlayers = s.players.map(player => {
      if (player.id === s.ballHolderId) return player;

      // GK override: sprint to intercept the shot target
      if (s.shot !== null && player.role === 'GK') {
        const shooter = s.players.find(p => p.id === s.shot!.shooterId);
        if (shooter && player.team !== shooter.team) {
          const gkTarget = { x: s.shot.toX, y: s.shot.toY };
          const dx = gkTarget.x - player.x;
          const dy = gkTarget.y - player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.01) return { ...player, targetPosition: gkTarget };
          const recoveryMult = player.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
          const step = Math.min(player.runtimeStats.withoutBall.pressSpeed * recoveryMult * dt, dist);
          return {
            ...player,
            x: player.x + (dx / dist) * step,
            y: player.y + (dy / dist) * step,
            targetPosition: gkTarget,
          };
        }
      }


      const decision = s.decisions[player.id];
      const phase = teamHasBall(s, player.team) ? 'attacking' : 'defending';
      const isPressing = decision?.type === 'press';
      const isOffBallRun = phase === 'attacking'
        && (decision?.type === 'support_run' || decision?.type === 'create_space');
      const isChasingLooseBall = decision?.type === 'chase_loose_ball';
      const formation = player.team === 'A' ? s.formationA : s.formationB;

      let target: { x: number; y: number };
      // Chase-loose-ball — sprint to a fixed point, no formation pull, only pitch bounds.
      if (isChasingLooseBall && (decision.type === 'chase_loose_ball')) {
        const sprintSpeed =
            player.runtimeStats.withoutBall.pressSpeed
          + player.runtimeStats.withoutBall.acceleration * THROUGH_BALL_CONFIG.SPRINT_ACCEL_BOOST
          + player.runtimeStats.withoutBall.speed        * THROUGH_BALL_CONFIG.SPRINT_TOP_BOOST;
        const targetPt = {
          x: Math.max(0, Math.min(PITCH_LENGTH, decision.toX)),
          y: Math.max(0, Math.min(PITCH_WIDTH,  decision.toY)),
        };
        const cdx = targetPt.x - player.x;
        const cdy = targetPt.y - player.y;
        const cdist = Math.hypot(cdx, cdy);
        if (cdist < 0.01) return { ...player, targetPosition: targetPt };
        const recoveryMult = player.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
        const step = Math.min(sprintSpeed * recoveryMult * dt, cdist);
        return {
          ...player,
          x: player.x + (cdx / cdist) * step,
          y: player.y + (cdy / cdist) * step,
          targetPosition: targetPt,
        };
      }
      if (isPressing) {
        const holderDecision = s.decisions[holder.id];
        if (holderDecision?.type === 'carry') {
          // Intercept-angle press: project holder forward along their carry direction
          // instead of chasing their current position. When the presser is behind the
          // carrier, aiming at the current position means the carrier is always ahead —
          // the presser needs to cut off the path.
          //
          // Lookahead = how far the holder travels while the presser closes the distance:
          //   lookahead = distToHolder × holderSpeed / (holderSpeed + presserSpeed)
          const { dx: cdx, dy: cdy } = holderDecision;
          const holderCarrySpeed = holder.runtimeStats.withBall.carrySpeed;
          const presserSpeed = player.runtimeStats.withoutBall.pressSpeed
            + player.runtimeStats.withoutBall.acceleration * getDefenseConfig(player.team).PRESS_ACCEL_SPEED_BOOST;
          const distToHolder = Math.hypot(holder.x - player.x, holder.y - player.y);
          const lookahead = Math.min(
            distToHolder * holderCarrySpeed / (holderCarrySpeed + presserSpeed),
            PRESS_INTERCEPT_MAX_LOOKAHEAD,
          );
          target = {
            x: Math.max(0, Math.min(PITCH_LENGTH, holder.x + cdx * lookahead)),
            y: Math.max(0, Math.min(PITCH_WIDTH,  holder.y + cdy * lookahead)),
          };
        } else {
          // Holder is not carrying (about to pass, shoot, or idle) — chase directly.
          target = { x: holder.x, y: holder.y };
        }
      } else if (isOffBallRun && (decision?.type === 'support_run' || decision?.type === 'create_space')) {
        const visionNorm = Math.min(1, player.runtimeStats.withBall.carryVision / 18);
        const roleBias   = getOffBallBias(player.role);
        const baseLookahead = OFF_BALL_CONFIG.BASE_LOOKAHEAD
          + (OFF_BALL_CONFIG.MAX_LOOKAHEAD - OFF_BALL_CONFIG.BASE_LOOKAHEAD) * visionNorm;
        const lookahead  = baseLookahead * roleBias;
        const rawX = player.x + decision.dx * lookahead;
        const rawY = player.y + decision.dy * lookahead;
        const base = resolveBasePosition(player.slotIndex, player.attackDir, formation, 'attacking');
        const pushUpT    = Math.min(1, s.possessionTime / POSSESSION_PUSH_UP.BASE_SECONDS);
        const pushUpBias = PUSH_UP_ROLE_BIAS[player.role] ?? 0;
        const pushedBaseX = base.x + player.attackDir * pushUpT * POSSESSION_PUSH_UP.MAX_YARDS * pushUpBias;
        const pull = 1 - OFF_BALL_CONFIG.FORMATION_PULL;
        let tx = pushedBaseX + (rawX - pushedBaseX) * pull;
        const ty = base.y + (rawY - base.y) * pull;

        // Clamp to stay onside
        if (offsideLine !== null) {
          const fwd   = player.attackDir;
          const safeX = offsideLine - fwd * ATTACK_CONFIG.OFFSIDE_MARGIN;
          if ((tx - safeX) * fwd > 0) {
            tx = safeX;
          }
        }

        // Only clamp to pitch boundary — bounds discipline is handled by getRoleFitPenalty
        // in scoring, so no hard wall here.
        target = {
          x: Math.max(0, Math.min(PITCH_LENGTH, tx)),
          y: Math.max(0, Math.min(PITCH_WIDTH,  ty)),
        };
      } else {
        const committedMarkId = decision?.type === 'track_mark' ? decision.markTargetId : undefined;
        const markTargetId = committedMarkId ?? markAssignments.get(player.id);
        target = computeTargetPosition(player, phase, ballPos, s.players, formation, s.ballHolderId, decision?.type, offsideLine, markTargetId, s.possessionTime);
      }

      const dx   = target.x - player.x;
      const dy   = target.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.01) return { ...player, targetPosition: target };

      const baseSpeed    = player.runtimeStats.withoutBall.pressSpeed;
      // Off-ball runners within 15 yards of a holder who just received get an
      // acceleration burst to model supporting players reading the reception.
      const holderJustReceived = holder.justReceivedTicks > 0
        && isOffBallRun
        && (holder.x - player.x) ** 2 + (holder.y - player.y) ** 2 < 225; // 15*15
      const accelBurst   = isPressing
        ? player.runtimeStats.withoutBall.acceleration * getDefenseConfig(player.team).PRESS_ACCEL_SPEED_BOOST
        : holderJustReceived
          ? player.runtimeStats.withoutBall.acceleration * CARRY_ACCEL_SPEED_BOOST
          : 0;
      const recoveryMult = player.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
      const step = Math.min((baseSpeed + accelBurst) * recoveryMult * dt, dist);
      return {
        ...player,
        x: player.x + (dx / dist) * step,
        y: player.y + (dy / dist) * step,
        targetPosition: target,
      };
    });

    s = { ...s, players: movedPlayers };
  }

  // ── Shot in flight ─────────────────────────────────────────────────────────
  if (s.shot) {
    const newT = s.shot.t + dt * SHOT_SPEED;

    if (newT >= 1) {
      const { toY, shooterId } = s.shot;
      const shooter     = s.players.find(p => p.id === shooterId)!;
      const defendingGK = s.players.find(p => p.team !== shooter.team && p.role === 'GK') ?? null;

      const { isGoal, inPosts, goalChance } = resolveShot(shooter, defendingGK, s.shot);
      gameBus.emit('shotResolved', { player: shooter.id, xg: s.shot.xg, goalChance, isGoal, inPosts });

      if (inPosts && isGoal) {
        const newScore = { ...s.score, [shooter.team]: s.score[shooter.team] + 1 };
        const assistId = s.lastPasserId !== null && s.lastPasserId !== shooter.id ? s.lastPasserId : undefined;
        gameBus.emit('goalScored', { team: shooter.team, score: newScore, scorerId: shooter.id, assistId });
        const concedingTeam = shooter.team === 'A' ? 'B' : 'A';
        return {
          state: resetToKickoff({ ...s, score: newScore }, concedingTeam),
          passCompleted: false, tackled: false, goalScored: shooter.team,
        };
      } else if (!inPosts && !defendingGK) {
        // No GK present and off target — give ball back to shooter (same team — no intent change)
        return {
          state: { ...s, shot: null, ballHolderId: shooter.id },
          passCompleted: false, tackled: false, goalScored: null,
        };
      } else {
        // GK save or shot off target — apply goal kick positioning for GK's team
        const gkOwner = defendingGK ?? shooter; // if no GK, shooter's team acts as "keeper"
        const gkFormation = gkOwner.team === 'A' ? s.formationA : s.formationB;
        const goalKickLayout = getFormationSetPieces(gkFormation.id)?.goalKick;
        let gkPlayers = s.players;
        if (defendingGK && inPosts && !isGoal) {
          gkPlayers = applyStaminaCost(gkPlayers, defendingGK.id, 'gkSave');
        }
        if (goalKickLayout && defendingGK) gkPlayers = applySetPieceToTeam(gkPlayers, defendingGK.team, goalKickLayout);
        const newHolder = defendingGK ?? shooter;
        const prevHolderId = s.ballHolderId;
        return {
          state: onPossessionTransfer({
            ...s,
            shot: null,
            ballHolderId: newHolder.id,
            possessionTime: 0,
            lastPasserId: null,
            players: gkPlayers,
            setPiece: { type: 'goal_kick', takerId: newHolder.id, countdown: 1 },
          }, prevHolderId),
          passCompleted: false, tackled: false, goalScored: null,
        };
      }
    }

    return {
      state: { ...s, shot: { ...s.shot, t: newT } },
      passCompleted: false, tackled: false, goalScored: null,
    };
  }

  // ── Loose-ball drift — ball trickles in space until someone arrives ─────
  // Replaces holder dispatch entirely while the through ball is uncollected.
  // Players' chase decisions are pinned by the decision loop above with the
  // current loose-ball position, so chasers track the drifting ball.
  if (s.looseBall) {
    return handleLooseBall(s, dt);
  }

  // Only evaluate press/tackle while the ball is held (not in flight)
  if (!s.pass) {
    // ── 2. Tackle check ───────────────────────────────────────────────────

    if (s.tackleCooldown === 0) {
      const updatedHolder = s.players.find(p => p.id === s.ballHolderId)!;

      let tackler: GamePlayer | null = null;
      let closestDist = Infinity;

      // When the carrier is actively dribbling at a specific defender, skip that
      // defender in the tackle check — resolveDribble() owns that 1v1 (attacker
      // initiative). Other nearby defenders can still tackle normally.
      const holderDec = s.decisions[s.ballHolderId];
      const dribbleTargetId = holderDec?.type === 'dribble' ? holderDec.targetId : null;

      for (const player of s.players) {
        if (player.team === updatedHolder.team) continue;
        if (player.id === dribbleTargetId) continue;
        if (isPlayerInRecovery(player)) continue; // still recovering from a duel — cannot tackle
        const d = distSq(player, updatedHolder);
        const dec = s.decisions[player.id]?.type;
        // A pressing defender that has closed to tackle range can tackle even while
        // their press decision is still committed (commit skips decide(), so 'tackle'
        // would never appear in decisions[] until the commit expires).
        const canTackle = dec === 'tackle' || (dec === 'press' && d <= TACKLE_RANGE * TACKLE_RANGE);
        if (canTackle && d < closestDist) {
          tackler = player;
          closestDist = d;
        }
      }

      if (tackler !== null) {
        s = {
          ...s,
          tackleCooldown: TACKLE_COOLDOWN,
          players: applyStaminaCost(s.players, tackler.id, 'tackle'),
        };
        const tacklerNow = s.players.find(p => p.id === tackler!.id)!;

        // Pressing load: nearby defenders (not the tackler) create crowd pressure.
        // Active pressers count fully; defenders holding shape/marking count at half
        // weight — they're close but not actively collapsing on the carrier.
        const PRESS_LOAD_RADIUS = 8; // yards — wide enough to capture compact blocks
        let pressingLoad = 0;
        for (const p of s.players) {
          if (p.team === updatedHolder.team) continue;
          if (p.id === tackler.id) continue;
          if (isPlayerInRecovery(p)) continue;
          const d = Math.sqrt((p.x - updatedHolder.x) ** 2 + (p.y - updatedHolder.y) ** 2);
          if (d >= PRESS_LOAD_RADIUS) continue;
          const decType = s.decisions[p.id]?.type;
          const weight = decType === 'press' ? 1.0 : 0.5; // shape/mark defenders count at half
          pressingLoad += weight * (1 - d / PRESS_LOAD_RADIUS); // linear falloff
        }
        pressingLoad = Math.min(1, pressingLoad); // cap at 1

        const { success, chance } = resolveTackle(tacklerNow, updatedHolder, pressingLoad);
        gameBus.emit('tackle', { player: tackler.id, targetId: updatedHolder.id, success, chance });
        if (success) {
          const prevHolderId = s.ballHolderId;
          s = onPossessionTransfer({
            ...s,
            ballHolderId: tackler.id,
            possessionTime: 0,
            lastPasserId: null,
            players: s.players.map(p => {
              if (p.id === tackler!.id)      return { ...p, recoveryTime: DUEL_TACKLE_WIN_RECOVERY };
              if (p.id === updatedHolder.id) return { ...p, recoveryTime: DUEL_TACKLE_LOSS_RECOVERY };
              return p;
            }),
          }, prevHolderId);
          return { state: s, passCompleted: false, tackled: true, goalScored: null };
        } else {
          s = {
            ...s,
            players: s.players.map(p =>
              p.id === tackler!.id ? { ...p, recoveryTime: DUEL_TACKLE_FAILED_RECOVERY } : p,
            ),
          };
        }
      }
    }
  }

  // ── 3. Execute holder decision (carry / shoot / pass) ────────────────────
  if (!s.pass) {
    const holderDecision = s.decisions[s.ballHolderId];

    if (holderDecision?.type === 'shoot') {
      return { state: startShot(s), passCompleted: false, tackled: false, goalScored: null };
    }

    // Through balls fire IMMEDIATELY — they're a release decision that doesn't
    // benefit from the post-reception burst (the burst exists to create space
    // before deciding what to play; TB has already decided to play into space).
    if (holderDecision?.type === 'through_ball') {
      return { state: startThroughBall(s, holderDecision), passCompleted: false, tackled: false, goalScored: null };
    }

    // ── Post-reception burst — "receive and turn" ─────────────────────────────
    // When a player just received a pass and has an opponent within 6 yards,
    // burst away from them to create the extra yard of space before deciding.
    {
      const carrier0 = s.players.find(p => p.id === s.ballHolderId)!;
      if (carrier0.justReceivedTicks > 0) {
        let nearestOpp: GamePlayer | null = null;
        let nearestDistSq = Infinity;
        for (const p of s.players) {
          if (p.team === carrier0.team) continue;
          const dSq = (p.x - carrier0.x) ** 2 + (p.y - carrier0.y) ** 2;
          if (dSq < nearestDistSq) { nearestDistSq = dSq; nearestOpp = p; }
        }

        if (nearestOpp && nearestDistSq < 36) { // 6*6 yards
          const odx = carrier0.x - nearestOpp.x;
          const ody = carrier0.y - nearestOpp.y;
          const olen = Math.sqrt(odx * odx + ody * ody);
          if (olen >= 0.01) {
            const burstSpeed = carrier0.runtimeStats.withBall.carrySpeed
              * (0.4 + carrier0.runtimeStats.withBall.dribbling * 0.6);
            const step = burstSpeed * dt;
            const newX = Math.max(0, Math.min(PITCH_LENGTH, carrier0.x + (odx / olen) * step));
            const newY = Math.max(0, Math.min(PITCH_WIDTH,  carrier0.y + (ody / olen) * step));
            const updated = { ...carrier0, x: newX, y: newY, targetPosition: { x: newX, y: newY } };
            s = { ...s, players: s.players.map(p => p.id === updated.id ? updated : p) };
            return { state: s, passCompleted: false, tackled: false, goalScored: null };
          }
        }
      }
    }

    if (holderDecision?.type === 'carry') {
      const carrier = s.players.find(p => p.id === s.ballHolderId)!;
      const wb      = carrier.runtimeStats.withBall;

      const isUnderPressure = s.players.some(p =>
        p.team !== carrier.team &&
        (s.decisions[p.id]?.type === 'press' || s.decisions[p.id]?.type === 'tackle'),
      );
      const accelBurst   = isUnderPressure ? wb.acceleration * CARRY_ACCEL_SPEED_BOOST : 0;
      const recoveryMult = carrier.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
      const step = (wb.carrySpeed + accelBurst) * recoveryMult * dt;
      // Role bounds don't restrict the ball carrier — only the pitch boundary does.
      // Off-ball positioning is where bounds apply.
      const newX = Math.max(0, Math.min(PITCH_LENGTH, carrier.x + holderDecision.dx * step));
      const newY = Math.max(0, Math.min(PITCH_WIDTH,  carrier.y + holderDecision.dy * step));

      const updatedCarrier = { ...carrier, x: newX, y: newY, targetPosition: { x: newX, y: newY } };
      s = { ...s, players: s.players.map(p => p.id === updatedCarrier.id ? updatedCarrier : p) };
      return { state: s, passCompleted: false, tackled: false, goalScored: null };
    }

    // ── Dribble ───────────────────────────────────────────────────────────────
    if (holderDecision?.type === 'dribble') {
      const attacker = s.players.find(p => p.id === s.ballHolderId)!;
      const defender = s.players.find(p => p.id === holderDecision.targetId) ?? null;

      if (defender) {
        const ddx  = defender.x - attacker.x;
        const ddy  = defender.y - attacker.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);

        if (dist > DRIBBLE_RESOLUTION_RANGE) {
          // Approach phase: drive toward the defender with ball at feet
          const recoveryMult = attacker.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
          const step = Math.min(attacker.runtimeStats.withBall.carrySpeed * recoveryMult * dt, dist);
          const newX = Math.max(0, Math.min(PITCH_LENGTH, attacker.x + (ddx / dist) * step));
          const newY = Math.max(0, Math.min(PITCH_WIDTH,  attacker.y + (ddy / dist) * step));
          const updatedAttacker = { ...attacker, x: newX, y: newY, targetPosition: { x: defender.x, y: defender.y } };
          s = { ...s, players: s.players.map(p => p.id === updatedAttacker.id ? updatedAttacker : p) };
          return { state: s, passCompleted: false, tackled: false, goalScored: null };
        }

        // Resolution phase: close enough — resolve the 1v1.
        // Compute crowd pressure from nearby defenders (not the dribble target).
        const DRIBBLE_CROWD_RADIUS = 8; // yards — same as tackle pressing load
        let dribblePressLoad = 0;
        for (const p of s.players) {
          if (p.team === attacker.team) continue;
          if (p.id === defender.id) continue;
          if (isPlayerInRecovery(p)) continue;
          const d = Math.sqrt((p.x - attacker.x) ** 2 + (p.y - attacker.y) ** 2);
          if (d >= DRIBBLE_CROWD_RADIUS) continue;
          const decType = s.decisions[p.id]?.type;
          const weight = decType === 'press' ? 1.0 : 0.5;
          dribblePressLoad += weight * (1 - d / DRIBBLE_CROWD_RADIUS);
        }
        dribblePressLoad = Math.min(1, dribblePressLoad);

        const { attackerWins, winProb } = resolveDribble(attacker, defender, dribblePressLoad);
        gameBus.emit('dribble', { player: attacker.id, targetId: defender.id, success: attackerWins, chance: winProb });
        if (attackerWins) {
          // Attacker beats the defender — defender frozen, attacker keeps the ball
          s = {
            ...s,
            players: s.players.map(p => {
              if (p.id === defender.id) return { ...p, recoveryTime: DUEL_DRIBBLE_LOSS_RECOVERY };
              if (p.id === attacker.id) return { ...p, recoveryTime: DUEL_DRIBBLE_WIN_RECOVERY };
              return p;
            }),
          };
          return { state: s, passCompleted: false, tackled: false, goalScored: null };
        } else {
          // Defender wins — attacker stumbles and loses possession
          const prevHolderId = s.ballHolderId;
          s = onPossessionTransfer({
            ...s,
            ballHolderId: defender.id,
            possessionTime: 0,
            players: s.players.map(p =>
              p.id === attacker.id ? { ...p, recoveryTime: DUEL_DRIBBLE_LOSS_RECOVERY } : p,
            ),
          }, prevHolderId);
          return { state: s, passCompleted: false, tackled: true, goalScored: null };
        }
      }
    }

    return { state: startPass(s), passCompleted: false, tackled: false, goalScored: null };
  }

  // ── Pass in flight ─────────────────────────────────────────────────────────
  // (Control flow guarantees s.pass is non-null here — capture it once for TS)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const activePass = s.pass!;

  // Speed scales with distance so longer passes take proportionally more time.
  const PASS_YARDS_PER_SEC = 28;
  const distanceSpeed = activePass.distance > 0
    ? PASS_YARDS_PER_SEC / activePass.distance
    : passSpeed;

  // Interception check — defender geometrically between ball and target gets a chance
  // scaled by how close they are to the passing lane (perpDist) and pass speed.
  // For through balls the "target" is the landing position, not a player.
  if (s.tackleCooldown === 0) {
    const ballPos      = getBallPos(s);
    const targetPos    = activePass.kind === 'through' || activePass.toId === null
      ? { x: activePass.toX, y: activePass.toY }
      : (s.players.find(p => p.id === activePass.toId) ?? { x: activePass.toX, y: activePass.toY });
    for (const player of s.players) {
      if (player.team === holder.team) continue;
      // Pre-filter: must be within the maximum possible corridor of the ball
      const d = Math.sqrt((player.x - ballPos.x) ** 2 + (player.y - ballPos.y) ** 2);
      if (d > MAX_INTERCEPTION_CORRIDOR) continue;

      const corridor = playerInterceptionCorridor(player);
      const perpDist = getInterceptionPerpDist(player, ballPos, targetPos, corridor);
      if (perpDist === null) continue; // outside this player's corridor or not on the pass line

      s = {
        ...s,
        tackleCooldown: TACKLE_COOLDOWN,
        players: applyStaminaCost(s.players, player.id, 'interception'),
      };
      const interceptorNow = s.players.find(p => p.id === player.id)!;
      const passer = s.players.find(p => p.id === activePass.fromId);
      const passerSkill = passer?.runtimeStats.withBall.passingSkill ?? 0;
      const { success, chance } = resolveInterception(interceptorNow, perpDist, corridor, passerSkill);
      gameBus.emit('interception', { player: player.id, success, chance });
      if (success) {
        if (activePass.kind === 'through') {
          gameBus.emit('throughBallLostInFlight', { player: activePass.fromId, interceptorId: player.id });
          debugLog('throughBall', `Through ball intercepted by ${interceptorNow.name}`, {
            playerId: player.id, data: { from: activePass.fromId },
          });
        } else {
          gameBus.emit('passFailed', { player: activePass.fromId, toId: activePass.toId ?? activePass.fromId });
        }
        const prevHolderId = s.ballHolderId;
        return {
          state: onPossessionTransfer(
            { ...s, pass: null, ballHolderId: player.id, possessionTime: 0, lastPasserId: null },
            prevHolderId,
          ),
          passCompleted: false, tackled: true, goalScored: null,
        };
      }
      break; // one attempt per cooldown window
    }
  }

  const newT = activePass.t + dt * distanceSpeed;
  if (newT >= 1) {
    // ── Through-ball landing — convert pass to LooseBallState ────────────────
    // The ball SITS at the landing point. Players' chase decisions are pinned by
    // the decision loop, so they keep sprinting. handleLooseBall (called at the
    // top of subsequent ticks) resolves possession when someone is within touch.
    if (activePass.kind === 'through') {
      const landingX = activePass.toX;
      const landingY = activePass.toY;
      const passer   = s.players.find(p => p.id === activePass.fromId);
      const passerTeam = passer?.team ?? 'A';

      // Residual velocity: same direction the pass was travelling, scaled to a
      // slow trickle. The ball decelerates each tick (LOOSE_BALL_DECELERATION)
      // until it comes to rest — never frozen instantly at the landing point.
      const dx = landingX - (passer?.x ?? landingX);
      const dy = landingY - (passer?.y ?? landingY);
      const len = Math.hypot(dx, dy);
      const initSpeed = THROUGH_BALL_CONFIG.LOOSE_BALL_INITIAL_SPEED;
      const vx = len > 0.001 ? (dx / len) * initSpeed : 0;
      const vy = len > 0.001 ? (dy / len) * initSpeed : 0;

      gameBus.emit('looseBallStarted', {
        x: landingX,
        y: landingY,
        fromPasserId: activePass.fromId,
      });
      debugLog('throughBall', `Through ball lands → loose ball at (${landingX.toFixed(1)}, ${landingY.toFixed(1)})`, {
        playerId: activePass.fromId,
      });

      return {
        state: {
          ...s,
          pass: null,
          looseBall: {
            x: landingX,
            y: landingY,
            vx, vy,
            startTime: s.matchTime,
            fromPasserId: activePass.fromId,
            fromTeamLastTouch: passerTeam,
            intendedRunnerId: activePass.intendedRunnerId,
            receiverOffside: activePass.receiverOffside,
          },
        },
        passCompleted: false, tackled: false, goalScored: null,
      };
    }

    // ── Regular pass landing ─────────────────────────────────────────────────
    const receiver = s.players.find(p => p.id === activePass.toId!)!;

    // ── Offside enforcement ─────────────────────────────────────────────────
    // The offside position was determined when the pass was played (at t=0).
    // Enforce only at the moment the receiver would touch the ball (t=1).
    if (activePass.receiverOffside) {
      gameBus.emit('offsideCalled', { team: receiver.team, receiverId: receiver.id });
      gameBus.emit('passFailed', { player: activePass.fromId, toId: activePass.toId! });
      // Award possession to the defending team's player nearest to the receiver
      const defenders = s.players.filter(p => p.team !== receiver.team);
      const nearestDefender = defenders.reduce((best, p) => {
        const d = (p.x - receiver.x) ** 2 + (p.y - receiver.y) ** 2;
        const bd = (best.x - receiver.x) ** 2 + (best.y - receiver.y) ** 2;
        return d < bd ? p : best;
      });
      // Apply offside_fk layout for the restarting team; fall back to no reposition
      // when a formation has no layout defined. The taker (nearestDefender) will
      // be spotted at the offside location — override their x/y after the layout.
      const defTeamFormation = nearestDefender.team === 'A' ? s.formationA : s.formationB;
      const offsideLayout = getFormationSetPieces(defTeamFormation.id)?.offside_fk;
      let players = s.players;
      if (offsideLayout) players = applySetPieceToTeam(players, nearestDefender.team, offsideLayout);
      // Move the taker to where offside was called (ball is spotted at the receiver's position)
      players = players.map(p =>
        p.id === nearestDefender.id
          ? { ...p, x: receiver.x, y: receiver.y, targetPosition: { x: receiver.x, y: receiver.y } }
          : p,
      );
      const prevHolderId = s.ballHolderId;
      return {
        state: onPossessionTransfer({
          ...s,
          pass: null,
          ballHolderId: nearestDefender.id,
          possessionTime: 0,
          lastPasserId: null,
          players,
          setPiece: {
            type: 'offside_fk',
            takerId: nearestDefender.id,
            countdown: 2,
            position: { x: receiver.x, y: receiver.y },
          },
        }, prevHolderId),
        passCompleted: false, tackled: false, goalScored: null,
      };
    }

    gameBus.emit('passCompleted', { player: activePass.fromId, toId: activePass.toId! });
    // Pass complete is same-team, so onPossessionTransfer would no-op — but the
    // new receiver may now be in a switch_play position (wide, far flank open),
    // so re-evaluate intents for both teams on reception. The roll is seeded
    // per-possession, so this can only confirm/clear switch_play, not flicker it.
    return {
      state: reevaluateTeamIntents({
        ...s,
        ballHolderId: activePass.toId!,
        pass: null,
        lastPasserId: activePass.fromId,
        players: s.players.map(p =>
          p.id === activePass.toId ? { ...p, justReceivedTicks: 4 } : p,
        ),
      }),
      passCompleted: true, tackled: false, goalScored: null,
    };
  }

  return {
    state: { ...s, pass: { ...activePass, t: newT } },
    passCompleted: false, tackled: false, goalScored: null,
  };
}

// ── Ball position ─────────────────────────────────────────────────────────────

/** Current ball position in yards. */
export function getBallPos(state: GameState): { x: number; y: number } {
  if (state.shot) {
    const { fromX, fromY, toX, toY, t } = state.shot;
    const eased = t * t * (3 - 2 * t);
    return {
      x: fromX + (toX - fromX) * eased,
      y: fromY + (toY - fromY) * eased,
    };
  }
  // Loose ball — ball is sitting in space at the through-ball landing point.
  if (state.looseBall) {
    return { x: state.looseBall.x, y: state.looseBall.y };
  }
  if (!state.pass) {
    const holder = state.players.find(p => p.id === state.ballHolderId);
    return holder ? { x: holder.x, y: holder.y } : { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 };
  }
  const from  = state.players.find(p => p.id === state.pass!.fromId)!;
  const t     = state.pass.t;
  const eased = t * t * (3 - 2 * t);
  // Through balls track to a position; regular passes track to the receiver's
  // current position (so the ball follows a moving runner).
  const toX = state.pass.kind === 'through' || state.pass.toId === null
    ? state.pass.toX
    : (state.players.find(p => p.id === state.pass!.toId)?.x ?? state.pass.toX);
  const toY = state.pass.kind === 'through' || state.pass.toId === null
    ? state.pass.toY
    : (state.players.find(p => p.id === state.pass!.toId)?.y ?? state.pass.toY);
  return {
    x: from.x + (toX - from.x) * eased,
    y: from.y + (toY - from.y) * eased,
  };
}
