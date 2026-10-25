/**
 * IntentDetection — pure functions that decide a team's transient intent.
 *
 * Called by `reevaluateTeamIntents` in gameState.ts on TWO triggers:
 *   1. Possession transfer (team change) — recompute for both teams
 *   2. Periodic tick (every INTENT_REEVAL_INTERVAL game-seconds) — recompute
 *      for both teams while possession persists, catching mid-possession
 *      situational shifts (opponent advances, our numerical advantage flips)
 *
 * switch_play is excluded from trigger 2: it is a per-possession commitment
 * decided at possession-change / reception, so the periodic timer passes
 * `allowSwitchPlay: false` and an in-progress switch is preserved by the caller.
 *
 * Each tactic gates its own intent — counter_attack tactic enables
 * counter_attack intent, etc. The same intent value may serve multiple
 * situations (offensive bias when in possession, defensive press boost when
 * defending — see counter_attack in IntentConfig). Future intents add a new
 * branch to detectTeamIntent and a new pure detector function.
 */

import type { GameState, TeamId, TeamIntent } from '@/GameEngine/types';
import type { TacticalStyle } from '@/types/tacticsTypes';
import { getTeamTacticalStyle } from '@/GameEngine/Configs/AttackConfig';
import { PITCH_LENGTH, PITCH_WIDTH, isInGoalScoreArea } from '@/GameEngine/Domain/pitch';

// ── Tunables ─────────────────────────────────────────────────────────────────

/**
 * Maximum number of opposing players allowed in the attacking 40 yards (their
 * attacking third) to trigger counter-attack. If more than this many are
 * committed forward, their defense is weak and we have space to exploit.
 */
const COUNTER_ATTACK_MAX_OPPONENTS_IN_ATTACKING_40 = 5;

/**
 * switch_play geometry gates. The holder must be genuinely wide AND the far
 * (opposite) touchline channel must be open near their x, otherwise switching
 * the ball over there gains nothing.
 */
/** Holder counts as "wide" when their distance from the centre line exceeds this. */
const SWITCH_PLAY_WIDE_THRESHOLD = 18;      // yds from y-centre (37) → y < 19 or y > 55
/** How deep the far wide channel reaches in from the opposite touchline. */
const SWITCH_PLAY_FAR_CHANNEL_WIDTH = 19;   // yds — far channel is within this of the touchline
/** Only opponents within this x-distance of the holder gate the "far flank open" check. */
const SWITCH_PLAY_FAR_X_WINDOW = 22;        // yds around holder.x
/** At most this many opponents may sit in the far channel for it to count as open. */
const SWITCH_PLAY_FAR_MAX_OPPONENTS = 1;

/**
 * Per-tactic probability of committing to a switch when the geometric gate is
 * met. switch_play is a GENERAL intent available to every tactic, but how often
 * a team takes the option depends on its identity: a patient possession side
 * switches readily; a counter_attack / direct_play side prefers to drive
 * forward and rarely bothers. The roll is seeded per-possession (see
 * shouldSwitchPlay) so it is stable across re-evals — no flicker, no latch.
 */
const SWITCH_PLAY_PROBABILITY: Partial<Record<TacticalStyle, number>> = {
  possession:     0.45,
  balanced:       0.35,
  high_press:     0.35,
  counter_attack: 0.12,
  direct_play:    0.12,
};
const SWITCH_PLAY_DEFAULT_PROBABILITY = 0.35;

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Decide the team's intent given the current state. Called for BOTH teams on
 * possession transfer and on the periodic re-evaluation tick — neither side is
 * forced to 'balanced' by the caller anymore.
 *
 * Each team holds exactly ONE intent at a time. Offensive intents fire when
 * the team has the ball; defensive intents fire when it doesn't.
 *
 * switch_play is the first GENERAL intent: it is available to every tactic
 * (with a per-tactic firing probability), not gated behind one tactical style.
 * Tactic-specific gating remains narrow — only counter_attack tactic uses the
 * counter/press/hold family today. Other tactics will gain access to more
 * intents incrementally — see .claude/rules/game-engine/tactics-as-intents.md.
 */
export function detectTeamIntent(
  state: GameState,
  team: TeamId,
  opts?: { allowSwitchPlay?: boolean },
): TeamIntent {
  // switch_play is a per-possession commitment, decided at possession-change /
  // reception — not re-judged against transient geometry on the periodic
  // re-eval. The periodic path passes allowSwitchPlay=false so the 3s timer
  // can neither newly trigger a switch nor flip an in-progress one to balanced.
  const allowSwitchPlay = opts?.allowSwitchPlay ?? true;
  const style = getTeamTacticalStyle(team);
  const holder = state.players.find(p => p.id === state.ballHolderId);
  const hasBall = holder?.team === team;

  // switch_play — general offensive intent for ALL tactics. Fires only when we
  // hold the ball wide with the far flank open, and only on a probabilistic
  // per-possession roll, so it does not trigger on every wide reception.
  if (allowSwitchPlay && hasBall && shouldSwitchPlay(state, team, style)) return 'switch_play';

  if (style === 'counter_attack') {
    return detectCounterAttackTacticIntent(state, team);
  }

  // Future: other tactic gates here. Today, every other tactic stays balanced
  // — they'll opt into specific intents one at a time as we balance them.
  return 'balanced';
}

// ── switch_play detector (offensive, general) ────────────────────────────────

/**
 * Decide whether to commit to a switch this possession. Two stages:
 *   1. Geometric gate — holder is wide and the far flank is open.
 *   2. Probabilistic roll — seeded per-possession so the result is stable
 *      across the many re-evals within one possession (no flicker, no latch
 *      field needed). The probability is the team's tactical appetite for
 *      switching.
 */
function shouldSwitchPlay(state: GameState, team: TeamId, style: TacticalStyle): boolean {
  if (!isSwitchPlayOpportunity(state, team)) return false;
  const probability = SWITCH_PLAY_PROBABILITY[style] ?? SWITCH_PLAY_DEFAULT_PROBABILITY;
  // possessionStartTime is stable across a possession (possessionTime resets to
  // 0 on team change), so the same possession always rolls the same number.
  // Rounded to absorb float drift between re-evals.
  const seed = Math.round(state.matchTime - state.possessionTime);
  return seededRandom(team, seed) < probability;
}

/**
 * Geometric gate: the holder must be genuinely wide AND the opposite (far)
 * touchline channel must be open near the holder's x. Without an open far
 * channel a switch just hands the ball into traffic, so we don't bother.
 */
function isSwitchPlayOpportunity(state: GameState, team: TeamId): boolean {
  const holder = state.players.find(p => p.id === state.ballHolderId);
  if (!holder || holder.team !== team) return false;

  const fromCentre = holder.y - PITCH_WIDTH / 2;
  if (Math.abs(fromCentre) < SWITCH_PLAY_WIDE_THRESHOLD) return false;

  // The far flank is the touchline opposite the holder. If the holder is on the
  // top side (y < centre), the far channel hugs the bottom touchline, and vice
  // versa.
  const holderOnTopSide = fromCentre < 0;
  const opponentTeam = team === 'A' ? 'B' : 'A';

  let oppInFarFlank = 0;
  for (const p of state.players) {
    if (p.team !== opponentTeam) continue;
    const inFarChannel = holderOnTopSide
      ? p.y > PITCH_WIDTH - SWITCH_PLAY_FAR_CHANNEL_WIDTH
      : p.y < SWITCH_PLAY_FAR_CHANNEL_WIDTH;
    if (!inFarChannel) continue;
    if (Math.abs(p.x - holder.x) > SWITCH_PLAY_FAR_X_WINDOW) continue;
    oppInFarFlank++;
    if (oppInFarFlank > SWITCH_PLAY_FAR_MAX_OPPONENTS) return false;
  }

  return true;
}

/**
 * Deterministic [0,1) hash of (team, seed). Team-salted so both teams holding
 * possessions that started at the same rounded match-time don't roll identically.
 */
function seededRandom(team: TeamId, seed: number): number {
  const salt = team === 'A' ? 0.1234 : 0.8765;
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Intent selector for the counter_attack tactic.
 *
 * • Has the ball + opponent committed forward → counter_attack (offensive bias)
 * • Defending + attackers progressed into our half + we have numerical
 *   advantage there → press_now (commit pressers, hunt the ball)
 * • Defending otherwise → hold_shape (deliberate low-line passive default)
 * • Has the ball but no counter opportunity → balanced (default attack)
 */
function detectCounterAttackTacticIntent(state: GameState, team: TeamId): TeamIntent {
  const holder = state.players.find(p => p.id === state.ballHolderId);
  const hasBall = holder?.team === team;

  if (hasBall) {
    if (isCounterAttackOpportunity(state, team)) return 'counter_attack';
    return 'balanced';
  }

  if (isPressNowOpportunity(state, team)) return 'press_now';
  return 'hold_shape';
}

// ── Counter-attack detector (offensive) ──────────────────────────────────────

/**
 * True when the opposing team has more than 5 players in the attacking 40 yards
 * (their attacking third). This means their defense is spread thin and we have
 * space to exploit on the counter-attack.
 */
function isCounterAttackOpportunity(state: GameState, team: TeamId): boolean {
  const holder = state.players.find(p => p.id === state.ballHolderId);
  if (!holder || holder.team !== team) return false;

  const opponentTeam = team === 'A' ? 'B' : 'A';
  let playersInAttacking40 = 0;

  for (const p of state.players) {
    if (p.team !== opponentTeam) continue;
    // Attacking 40 yards = last 40 yards in attacking direction
    // If attacking toward x=115: x > 75 (i.e., x - 75 > 0)
    // If attacking toward x=0: x < 40 (i.e., x - 75 < 0, but with their attackDir=-1)
    // General formula: (x - 75) * attackDir > 0
    if ((p.x - 75) * p.attackDir > 0) {
      playersInAttacking40++;
    }
  }

  return playersInAttacking40 > COUNTER_ATTACK_MAX_OPPONENTS_IN_ATTACKING_40;
}

// ── Press-now detector (defensive) ───────────────────────────────────────────

/**
 * True when the defending team should commit to pressing instead of holding
 * shape. Today the single trigger is: the ball holder has entered our
 * goal-score area (penalty box). At that moment the structured defense is
 * already collapsed around the box, so committing to high press is the right
 * answer — sitting in low block when the carrier is already in our box does
 * nothing.
 *
 * Future iterations may add escalation gates (numerical advantage, ball-side
 * support, etc.) but per current design the box entry alone is sufficient.
 *
 * Caller must already have established the team is defending; this only checks
 * the situational escalation gate.
 */
function isPressNowOpportunity(state: GameState, team: TeamId): boolean {
  const holder = state.players.find(p => p.id === state.ballHolderId);
  if (!holder || holder.team === team) return false;

  // Find this team's attack direction from any of its outfielders
  const sample = state.players.find(p => p.team === team && p.role !== 'GK');
  if (!sample) return false;
  const ownGoalX = sample.attackDir === 1 ? 0 : PITCH_LENGTH;

  return isInGoalScoreArea(holder.x, holder.y, ownGoalX);
}
