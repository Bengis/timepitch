import rolesJson from '@/Data/roles.json';
import type { PlayerRole } from '@/GameEngine/types';

/** Engine tuning for a pitch role — extends `roles.json` `engine` block. */
export interface RoleEngineTuning {
  ballSupportScale: number;
  yRange: number;
  bounds: { minX: number; maxX: number };
  /** 0..1 — tendency to carry when on the ball (DecisionTree). */
  carryBias: number;
  /** 0..1 — off-ball attacking movement / create-space threshold (OffBallMovement). */
  offBallBias: number;
  /** Added to team carry weights for off-ball lane scoring (clamped per weight). */
  offBallCarryDeltas: {
    clearance: number;
    progress: number;
    angle: number;
    crowd: number;
    dropLaneBias: number;
    widthBias: number;
  };
  /** Base weights for off-ball intent selection — scaled by tactic multipliers and context. */
  offBallIntentWeights: {
    offer_support: number;
    hold_space:    number;
    make_run:      number;
  };
  /** Base weights for defensive intent selection — scaled by tactic multipliers and context. */
  defensiveIntentWeights: {
    hold_shape:           number;
    track_mark:           number;
    press_holder:         number;
    step_into_carry_lane: number;
  };
}

const roles = rolesJson as Record<PlayerRole, { engine: RoleEngineTuning }>;

export function roleEngine(role: PlayerRole): RoleEngineTuning {
  return roles[role].engine;
}
