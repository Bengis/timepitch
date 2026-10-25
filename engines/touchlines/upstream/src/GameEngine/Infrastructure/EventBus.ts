import type { GameState, TeamId } from '@/GameEngine/types';

/** All game events the engine can emit. Add new ones here as the engine grows. */
export interface GameEvents {
  /** Emitted whenever possession or pass state changes significantly. */
  stateChanged: GameState;
  /** Emitted the moment a goal is scored. */
  goalScored: { team: TeamId; score: { A: number; B: number }; scorerId: number; assistId?: number };
  /** Emitted when a shot resolves (goal or save/miss), with full probability breakdown. */
  shotResolved: { player: number; xg: number; goalChance: number; isGoal: boolean; inPosts: boolean };

  // ── Pass events ──────────────────────────────────────────────────────────
  /** Emitted when the holder starts a pass. */
  passAttempted: { player: number; toId: number; distance: number };
  /** Emitted when the receiver collects the pass successfully. */
  passCompleted:  { player: number; toId: number };
  /** Emitted when an opponent intercepts the pass in flight. */
  passFailed:     { player: number; toId: number };
  /**
   * Emitted at kick time when the chosen pass earned a positive far-flank
   * (switch-of-play) bonus. Derived generically from the active intent's
   * `passTarget` descriptor — never by naming an intent — so the counter
   * tracks "switch passes played" without re-deriving the geometry.
   */
  switchPlayPass: { player: number; toId: number };

  // ── Through-ball events ──────────────────────────────────────────────────
  /** Emitted when the holder plays a through ball. `toX`/`toY` is the landing point (post-error). */
  throughBallStarted:      { player: number; toX: number; toY: number; intendedRunnerId: number | null };
  /** Emitted when the through ball lands and becomes a loose ball — players continue sprinting until one arrives. */
  looseBallStarted:        { x: number; y: number; fromPasserId: number };
  /** Emitted when an attacker collects the loose ball. `winnerId` may differ from intendedRunnerId. */
  throughBallCompleted:    { player: number; winnerId: number; intendedRunnerId: number | null };
  /** Emitted when an opponent intercepts the through ball mid-flight. */
  throughBallLostInFlight: { player: number; interceptorId: number };
  /** Emitted when a defender collects the loose ball at landing (Phase 3) or wins the race (Phase 5). */
  throughBallLostInRace:   { player: number; defenderWinnerId: number };
  /** Emitted when a contested loose-ball duel resolves against the through-ball team (Phase 5). */
  throughBallLostInDuel:   { player: number; defenderWinnerId: number };
  /** Emitted whenever any player wins a contested loose ball — counts both intended and unexpected runners. */
  looseBallWon:            { winnerId: number; team: TeamId; fromPasserId: number };
  /** Emitted when chasers are committed to a through ball — debug-only payload for the /test sprint-path overlay. */
  chaseCommit: {
    toX: number;
    toY: number;
    chasers: Array<{ id: number; team: TeamId; eta: number }>;
  };

  // ── Shot event ───────────────────────────────────────────────────────────
  /** Emitted the moment a player takes a shot. */
  shot: { player: number; xg: number };

  // ── Defensive events ─────────────────────────────────────────────────────
  /** Emitted on every tackle attempt (success or failure). */
  tackle: { player: number; targetId: number; success: boolean; chance: number };
  /** Emitted on every interception attempt (success or failure). */
  interception: { player: number; success: boolean; chance: number };
  /** Emitted on every dribble attempt (success = attacker beats defender). */
  dribble: { player: number; targetId: number; success: boolean; chance: number };

  // ── Rating events ─────────────────────────────────────────────────────────
  /** Emitted after any rating change. Payload is a full snapshot of all ratings. */
  ratingsUpdated: Record<number, number>;

  // ── Statistics events ─────────────────────────────────────────────────────
  /** Emitted after any stat change. Payload is a full snapshot of all player stats. */
  statsUpdated: Record<number, import('./Statistics').PlayerStats>;

  // ── Offside event ─────────────────────────────────────────────────────────
  /** Emitted when a pass completion is cancelled due to the receiver being offside. */
  offsideCalled: { team: TeamId; receiverId: number };

  // ── Debug events ──────────────────────────────────────────────────────────
  /** Emitted every tick for the ball holder when debug mode is on. */
  decisionScores: {
    playerName: string;
    playerId: number;
    shoot: number;
    pass: number;
    carry: number;
    dribble: number;
    throughBall: number;
    best: 'shoot' | 'pass' | 'carry' | 'dribble' | 'through_ball';
    /** Component breakdown for each action's chosen target (best lane / best receiver). */
    breakdowns: {
      shoot: {
        dist:        number;
        openAngle:   number;
        pressure:    number;
        xg:          number;
        threshold:   number;
        roleScore:   number;
        xgFloor:     number;
        intentBonus: number;
        score:       number;
      };
      pass: {
        toId:               number | null;
        laneScore:          number;
        progressScore:      number;
        receiverSpaceScore: number;
        distancePenalty:    number;
        goalProximityBonus: number;
        visionRangePenalty: number;
        passTargetBonus:    number;
        baseScore:          number;
        playerModifier:     number;
        tacticalModifier:   number;
        rawScore:           number;
        score:              number;
      };
      carry: {
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
      } | null;
      dribble: {
        targetId:     number | null;
        roleTendency: number;
        forwardBlock: number;
        rawScore:     number;
        score:        number;
      };
    };
  };
  /** Emitted every tick for each defending player when debug mode is on. */
  defensiveScores: {
    playerId:     number;
    playerName:   string;
    chosenIntent: import('@/GameEngine/Domain/DefensivePositioning').DefensiveIntent;
    scores: {
      hold_shape:           number;
      track_mark:           number;
      press_holder:         number;
      step_into_carry_lane: number;
    };
    holderThreat:   number;
    markThreat:     number;
    carryLaneBonus: number;
  };
  /** Emitted every tick for each off-ball attacker when debug mode is on. */
  offBallScores: {
    playerId:         number;
    playerName:       string;
    bestScore:        number;
    currentPassScore: number;
    intent:           'offer_support' | 'hold_space' | 'make_run';
    intentScores: {
      offer_support: number;
      hold_space:    number;
      make_run:      number;
    };
    decision:         'support_run' | 'create_space' | 'idle';
  };

  /**
   * Emitted every tick for the ball holder when debug mode is on — top-N
   * through-ball candidate cells with full score breakdowns. Drives the
   * /test screen heatmap overlay and the score-breakdown panel.
   */
  throughBallScores: {
    playerId:    number;
    playerName:  string;
    /** Highest cell score across all candidates. 0 when no candidate is viable. */
    bestScore:   number;
    /** Up to MAX_CANDIDATES cells, sorted by score descending. */
    cells: Array<{
      x:                  number;
      y:                  number;
      score:              number;
      raceMargin:         number;
      bestAttackerId:     number | null;
      bestAttackerEta:    number;
      bestDefenderId:     number | null;
      bestDefenderEta:    number;
      raceMarginScore:    number;
      spaceQualityScore:  number;
      goalThreatScore:    number;
      passerSkillScore:   number;
      pathClearScore:     number;
      laneRiskPenalty:    number;
      offsideRiskPenalty: number;
    }>;
  };

  // ── Test / debug commands ────────────────────────────────────────────────
  /** Emitted by the TestScreen to directly mutate engine state for debugging. */
  testCommand:
    | { type: 'movePlayer';    id: number; x: number; y: number }
    | { type: 'giveBall';      id: number }
    | { type: 'patchPlayers';  players: import('@/GameEngine/types').GamePlayer[] }
    | { type: 'triggerPhase';  phase: 'halfTime' | 'matchEnd' }
    | { type: 'setTeamIntent'; team: import('@/GameEngine/types').TeamId; intent: import('@/GameEngine/types').TeamIntent };

  /**
   * Emitted when team tactics change at runtime (TestScreen tactic buttons).
   * PixiPitch listens and re-runs decide() for the ball holder so the debug
   * panel reflects the new weights immediately, even while paused.
   */
  tacticsChanged: { team: import('@/GameEngine/types').TeamId };

  /**
   * Emitted whenever a possession transfer changes the per-team intent.
   * Carries the full `{ A, B }` map so debug surfaces don't need to track
   * previous values. Fires zero or one times per possession transfer.
   */
  teamIntentChanged: { teamIntent: { A: import('@/GameEngine/types').TeamIntent; B: import('@/GameEngine/types').TeamIntent } };

  // ── Substitution event ────────────────────────────────────────────────────
  /**
   * Emitted when a substitution is executed so Statistics and PlayerRating
   * can register the incoming player under their own engine id.
   */
  playerSubstituted: { outId: number; inId: number; team: TeamId };

  // ── Match flow events ─────────────────────────────────────────────────────
  /**
   * Emitted when play restarts from the centre: opening kickoff, second half, or after a goal.
   */
  kickOff: { team: TeamId; phase: 'firstHalf' | 'secondHalf' | 'afterGoal' };
  /** Emitted once when the match clock starts (preMatch countdown ends). */
  matchStart: { extraTime: number };
  /** Emitted when the first half clock expires. Engine will auto-switch sides. */
  halfTime: { score: { A: number; B: number }; extraTime: number };
  /** Emitted when the second half clock expires. Simulation freezes. */
  matchEnd: { score: { A: number; B: number } };

  /**
   * Full engine snapshot from React (MatchScreen) so PixiPitch can keep its internal
   * stateRef in sync with UI-driven updates (pending subs, formation changes) that
   * never go through tickState alone.
   */
  matchStateSync: GameState;
}

type Listener<T> = (payload: T) => void;
type Unsubscribe = () => void;

class TypedEventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  on<K extends keyof GameEvents>(event: K, fn: Listener<GameEvents[K]>): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<unknown>);
    return () => this.listeners.get(event)?.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    this.listeners.get(event)?.forEach(fn => fn(payload));
  }
}

/**
 * Singleton bus shared across the entire app.
 * No React, no Pixi — any layer can import and use this.
 */
export const gameBus = new TypedEventBus();
