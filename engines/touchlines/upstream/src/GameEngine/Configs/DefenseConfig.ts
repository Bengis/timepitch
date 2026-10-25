/**
 * DefenseConfig — per-team weights and thresholds for defensive shape.
 *
 * Covers: pressing_style, defensive_line, width.
 * build_up (passing / attack) lives in AttackConfig.ts.
 *
 * Consumers should call getDefenseConfig(team) rather than the legacy singleton.
 */

import type { TeamId } from '@/GameEngine/types';
import type { PressingStyle, DefensiveLine, TeamWidth, TacticalStyle, TacticalAxes } from '@/types/tacticsTypes';
import { axesFor } from '@/types/tacticsTypes';

// ── Default values ────────────────────────────────────────────────────────────

const DEFAULTS = {
  /** 0..1 — how deep the team defends. 0 = own box, 1 = high line. */
  DEFENSIVE_LINE_HEIGHT:  0.5,
  /** 0..1 — how far up the field players trigger pressing shape. */
  PRESSING_LINE_HEIGHT:   0.55,

  /** 0..1 — how much the block narrows toward the pitch center Y when defending. */
  HORIZONTAL_COMPACTNESS: 0.6,
  /** 0..1 — how tightly the defensive lines stack vertically. */
  VERTICAL_COMPACTNESS:   0.6,

  /** 0..1 — probability modifier for step-out pressing (applied in DecisionTree). */
  PRESS_INTENSITY:         0.5,
  /** Yds/s — max speed burst from acceleration when actively pressing (scales by 0..1 accel). */
  PRESS_ACCEL_SPEED_BOOST: 0.8,  // reduced 20% — matches CARRY_ACCEL_SPEED_BOOST
  /** 0..1 — aggression level for tackle attempts (applied in DecisionTree). */
  TACKLE_AGGRESSION:       0.4,

  /** 0..1 — how strongly the block follows the ball's lateral (Y) position. */
  BLOCK_SHIFT_WEIGHT: 0.8,
  /** 0..1 — how much defenders shift X toward blocking central passing lanes. */
  LANE_BLOCK_WEIGHT:  0.4,

  /** 0..1 — max pull strength toward mark when threat is highest (opponent near own goal). */
  MARK_PULL_MAX: 0.90,
  /** 0..1 — min pull strength toward mark when threat is lowest (opponent far from goal). */
  MARK_PULL_MIN: 0.30,
  /** 0..1 — where on the ball→mark lane to position when threat is high (1 = at the mark). */
  MARK_LANE_T_CLOSE: 0.75,
  /** 0..1 — where on the ball→mark lane to position when threat is low (0 = at the ball). */
  MARK_LANE_T_FAR: 0.30,
  /** Yards from own goal at which threat reaches 0. */
  THREAT_HORIZON: 100,
};

export type DefenseConfigValues = { [K in keyof typeof DEFAULTS]: number };

// ── Per-team storage ──────────────────────────────────────────────────────────

const TEAM_CONFIGS: Record<TeamId, DefenseConfigValues> = {
  A: { ...DEFAULTS },
  B: { ...DEFAULTS },
};

/** Stores the raw tactic key strings for each team so intent selection can look them up. */
const TEAM_TACTIC_KEYS: Record<TeamId, {
  pressingStyle: PressingStyle;
  defensiveLine: DefensiveLine;
}> = {
  A: { pressingStyle: 'mid_block', defensiveLine: 'normal' },
  B: { pressingStyle: 'mid_block', defensiveLine: 'normal' },
};

/** Returns the raw tactic key strings for intent multiplier lookup. */
export function getDefenseTacticKeys(team: TeamId) {
  return TEAM_TACTIC_KEYS[team];
}

/** Returns the defensive config for the given team. */
export function getDefenseConfig(team: TeamId): DefenseConfigValues {
  return TEAM_CONFIGS[team];
}

// ── TacticalAxes → engine values ──────────────────────────────────────────────

function mapAxesToDefense(t: TacticalAxes): Partial<DefenseConfigValues> {
  const pressingMap: Record<PressingStyle, Partial<DefenseConfigValues>> = {
    // MARK_LANE_T: how far along ball→mark line the defender positions (0=at ball, 1=at mark)
    // MARK_PULL:   how strongly they commit to that position vs shape anchor
    // low_block  → block passing lane, stay back from mark (small laneT)
    // high_press → tight man-marking, very close to mark (large laneT)
    low_block:  { PRESSING_LINE_HEIGHT: 0.28, PRESS_INTENSITY: 0.20, TACKLE_AGGRESSION: 0.25,
                  MARK_LANE_T_FAR: 0.15, MARK_LANE_T_CLOSE: 0.40, MARK_PULL_MIN: 0.50, MARK_PULL_MAX: 0.80 },
    mid_block:  { PRESSING_LINE_HEIGHT: 0.55, PRESS_INTENSITY: 0.50, TACKLE_AGGRESSION: 0.40,
                  MARK_LANE_T_FAR: 0.30, MARK_LANE_T_CLOSE: 0.65, MARK_PULL_MIN: 0.40, MARK_PULL_MAX: 0.88 },
    high_press: { PRESSING_LINE_HEIGHT: 0.80, PRESS_INTENSITY: 0.85, TACKLE_AGGRESSION: 0.65,
                  MARK_LANE_T_FAR: 0.60, MARK_LANE_T_CLOSE: 0.95, MARK_PULL_MIN: 0.65, MARK_PULL_MAX: 0.95 },
  };
  const lineMap: Record<DefensiveLine, Partial<DefenseConfigValues>> = {
    deep:   { DEFENSIVE_LINE_HEIGHT: 0.40 },
    normal: { DEFENSIVE_LINE_HEIGHT: 0.60 },
    high:   { DEFENSIVE_LINE_HEIGHT: 0.75 },
  };
  const widthMap: Record<TeamWidth, Partial<DefenseConfigValues>> = {
    narrow: { HORIZONTAL_COMPACTNESS: 0.80, BLOCK_SHIFT_WEIGHT: 0.70 },
    normal: { HORIZONTAL_COMPACTNESS: 0.60, BLOCK_SHIFT_WEIGHT: 0.80 },
    wide:   { HORIZONTAL_COMPACTNESS: 0.30, BLOCK_SHIFT_WEIGHT: 0.90 },
  };
  return {
    ...pressingMap[t.pressing_style],
    ...lineMap[t.defensive_line],
    ...widthMap[t.width],
  };
}

/** Apply defense-side tactics (derived from a TacticalStyle) to the given team. */
export function applyTeamTacticsConfig(team: TeamId, style: TacticalStyle): void {
  const axes = axesFor(style);
  Object.assign(TEAM_CONFIGS[team], mapAxesToDefense(axes));
  TEAM_TACTIC_KEYS[team].pressingStyle = axes.pressing_style;
  TEAM_TACTIC_KEYS[team].defensiveLine = axes.defensive_line;
}

// Keep DEFENSE_CONFIG exported for any legacy import that hasn't migrated yet.
export const DEFENSE_CONFIG: DefenseConfigValues = TEAM_CONFIGS.A;
