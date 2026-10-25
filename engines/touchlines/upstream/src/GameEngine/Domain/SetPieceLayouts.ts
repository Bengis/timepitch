/**
 * SetPieceLayouts — positional data for set pieces.
 *
 * Set pieces define ONLY where players stand before restart.
 * The moment the ball is touched, the normal AI decision system takes over.
 *
 * All coordinates are in absolute yards, Team A reference frame (attackDir = +1).
 * Team B positions are mirrored automatically at runtime.
 *
 * Layouts are defined for: 4-3-3, 4-4-2, 3-5-2.
 */

import type { Formation, PlayerRole } from '@/GameEngine/types';
import { PITCH_LENGTH } from '@/GameEngine/Domain/pitch';

export interface SetPieceSlot {
  role: PlayerRole;
  /** Absolute yards from own goal line (Team A reference: 0 = own goal, PITCH_LENGTH = opponent goal). */
  x: number;
  /** Absolute yards from top touchline (0 = left, 74 = right). */
  y: number;
}

export interface SetPieceLayout {
  slots: SetPieceSlot[];
}

export interface FormationSetPieces {
  formationId: string;
  kickOff:         SetPieceLayout;
  kickOffDefend:   SetPieceLayout;
  goalKick:        SetPieceLayout;
  corner_Attack:   SetPieceLayout;
  corner_Defend:   SetPieceLayout;
  throwIn_Attack:  SetPieceLayout;
  throwIn_Defend:  SetPieceLayout;
  freeKick_Attack: SetPieceLayout;
  freeKick_Defend: SetPieceLayout;
  /**
   * Free-kick shape for the team AWARDED possession after an offside call.
   * Restart typically happens in their own defensive third — back line pushed
   * just past the offside location, midfield spread to receive the short pass.
   * The actual taker is whichever defender is closest to the ball at the
   * moment of the call; the `position` field on SetPiece overrides their slot.
   */
  offside_fk:      SetPieceLayout;
}

// ── 4-3-3 ────────────────────────────────────────────────────────────────────

const f433: FormationSetPieces = {
  formationId: '4-3-3',

  kickOff: { slots: [
    { role: 'GK',  x: 10, y: 37 },
    { role: 'LB',  x: 36, y: 11 },
    { role: 'CB',  x: 38, y: 28 },
    { role: 'CB',  x: 38, y: 46 },
    { role: 'RB',  x: 36, y: 63 },
    { role: 'CM',  x: 50, y: 24 },
    { role: 'CM',  x: 50, y: 50 },
    { role: 'CAM', x: 45, y: 37 },
    { role: 'LW',  x: 55, y:  9 },
    { role: 'ST',  x: 57, y: 37 }, // ball taker — closest to center circle
    { role: 'RW',  x: 55, y: 65 },
  ]},

  kickOffDefend: { slots: [
    { role: 'GK',  x: 5, y: 37 },
    { role: 'LB',  x: 13, y: 11 },
    { role: 'CB',  x: 14, y: 28 },
    { role: 'CB',  x: 14, y: 46 },
    { role: 'RB',  x: 13, y: 63 },
    { role: 'CM',  x: 38, y: 24 },
    { role: 'CM',  x: 38, y: 50 },
    { role: 'CAM', x: 36, y: 37 },
    { role: 'LW',  x: 50, y: 8  },
    { role: 'ST',  x: 45, y: 37 },
    { role: 'RW',  x: 50, y: 66 }
  ]},

  goalKick: { slots: [
    { role: 'GK',  x:  5, y: 37 }, // taker — closest to ball at goal
    { role: 'LB',  x: 13, y: 11 },
    { role: 'CB',  x: 15, y: 28 },
    { role: 'CB',  x: 15, y: 46 },
    { role: 'RB',  x: 13, y: 63 },
    { role: 'CM',  x: 38, y: 24 },
    { role: 'CM',  x: 38, y: 50 },
    { role: 'CAM', x: 50, y: 37 },
    { role: 'LW',  x: 55, y: 11 },
    { role: 'ST',  x: 60, y: 37 },
    { role: 'RW',  x: 55, y: 63 },
  ]},

  corner_Attack: { slots: [
    { role: 'LW',  x: PITCH_LENGTH, y:  3 }, // taker at corner flag
    { role: 'ST',  x: 103, y: 37 }, // central aerial threat
    { role: 'CAM', x: 100, y: 28 }, // near post run
    { role: 'CM',  x:  97, y: 50 }, // back post run
    { role: 'CB',  x:  93, y: 28 }, // late arrival
    { role: 'CB',  x:  90, y: 46 }, // support
    { role: 'CM',  x:  88, y: 20 }, // edge of box
    { role: 'RW',  x:  80, y: 65 }, // outside box
    { role: 'LB',  x:  75, y: 12 }, // safety
    { role: 'RB',  x:  75, y: 62 }, // safety
    { role: 'GK',  x:  10, y: 37 }, // stays back
  ]},

  corner_Defend: { slots: [
    { role: 'GK',  x:  5, y: 37 }, // organizing
    { role: 'LB',  x: 10, y: 12 }, // near post
    { role: 'CB',  x:  9, y: 28 }, // goal line
    { role: 'CB',  x:  9, y: 46 }, // goal line
    { role: 'RB',  x: 10, y: 62 }, // near post
    { role: 'CM',  x: 18, y: 22 }, // edge of box
    { role: 'CM',  x: 18, y: 52 }, // edge of box
    { role: 'CAM', x: 22, y: 37 }, // center box
    { role: 'LW',  x: 35, y:  8 }, // counter threat
    { role: 'ST',  x: 55, y: 37 }, // halfway (counter)
    { role: 'RW',  x: 35, y: 66 }, // counter threat
  ]},

  throwIn_Attack: { slots: [
    { role: 'LW',  x: 70, y:  2 }, // taker near touchline
    { role: 'ST',  x: 75, y: 37 },
    { role: 'CAM', x: 72, y: 25 },
    { role: 'CM',  x: 65, y: 30 },
    { role: 'CM',  x: 65, y: 50 },
    { role: 'CB',  x: 40, y: 32 },
    { role: 'CB',  x: 40, y: 42 },
    { role: 'LB',  x: 30, y: 12 },
    { role: 'RB',  x: 30, y: 62 },
    { role: 'RW',  x: 70, y: 65 },
    { role: 'GK',  x: 10, y: 37 },
  ]},

  throwIn_Defend: { slots: [
    { role: 'GK',  x: 10, y: 37 },
    { role: 'LB',  x: 15, y: 11 },
    { role: 'CB',  x: 18, y: 28 },
    { role: 'CB',  x: 18, y: 46 },
    { role: 'RB',  x: 15, y: 63 },
    { role: 'CM',  x: 40, y: 24 },
    { role: 'CM',  x: 40, y: 50 },
    { role: 'CAM', x: 45, y: 37 },
    { role: 'LW',  x: 50, y: 11 },
    { role: 'ST',  x: 55, y: 37 },
    { role: 'RW',  x: 50, y: 63 },
  ]},

  freeKick_Attack: { slots: [
    { role: 'ST',  x: 103, y: 37 }, // aerial target
    { role: 'CAM', x: 103, y: 28 }, // near post
    { role: 'LW',  x: 100, y: 46 }, // taker or target
    { role: 'RW',  x: 100, y: 28 }, // target
    { role: 'CM',  x:  95, y: 20 }, // edge of box
    { role: 'CM',  x:  95, y: 54 }, // edge of box
    { role: 'CB',  x:  90, y: 32 }, // comes up
    { role: 'CB',  x:  90, y: 42 }, // comes up
    { role: 'LB',  x:  75, y: 12 }, // safety
    { role: 'RB',  x:  75, y: 62 }, // safety
    { role: 'GK',  x:  10, y: 37 }, // stays back
  ]},

  freeKick_Defend: { slots: [
    { role: 'GK',  x:  5, y: 37 }, // organizing wall
    { role: 'LB',  x: 10, y: 15 }, // wall / defense
    { role: 'CB',  x:  8, y: 28 }, // goal line
    { role: 'CB',  x:  8, y: 46 }, // goal line
    { role: 'RB',  x: 10, y: 59 }, // wall / defense
    { role: 'CM',  x: 20, y: 22 }, // mark attacker
    { role: 'CM',  x: 20, y: 52 }, // mark attacker
    { role: 'CAM', x: 25, y: 37 }, // cover zone
    { role: 'LW',  x: 35, y:  8 }, // counter threat
    { role: 'ST',  x: 55, y: 37 }, // halfway
    { role: 'RW',  x: 35, y: 66 }, // counter threat
  ]},

  offside_fk: { slots: [
    { role: 'GK',  x:  8, y: 37 },
    { role: 'LB',  x: 22, y: 13 }, // wide outlet
    { role: 'CB',  x: 25, y: 28 }, // likely taker
    { role: 'CB',  x: 25, y: 46 }, // likely taker
    { role: 'RB',  x: 22, y: 61 }, // wide outlet
    { role: 'CM',  x: 42, y: 26 }, // short support
    { role: 'CM',  x: 42, y: 48 }, // short support
    { role: 'CAM', x: 52, y: 37 }, // central receiver
    { role: 'LW',  x: 62, y: 12 }, // stretch high
    { role: 'ST',  x: 68, y: 37 }, // pinned high
    { role: 'RW',  x: 62, y: 62 }, // stretch high
  ]},
};

// ── 4-4-2 ────────────────────────────────────────────────────────────────────

const f442: FormationSetPieces = {
  formationId: '4-4-2',

  kickOff: { slots: [
    { role: 'GK',  x: 10, y: 37 },
    { role: 'LB',  x: 36, y: 11 },
    { role: 'CB',  x: 38, y: 28 },
    { role: 'CB',  x: 38, y: 46 },
    { role: 'RB',  x: 36, y: 63 },
    { role: 'LM',  x: 52, y:  9 },
    { role: 'CM',  x: 50, y: 24 },
    { role: 'CM',  x: 50, y: 50 },
    { role: 'RM',  x: 52, y: 65 },
    { role: 'ST',  x: 57, y: 28 }, // ball taker
    { role: 'ST',  x: 57, y: 46 }, // partner
  ]},

  kickOffDefend: { slots: [
    { role: 'GK',  x:  5, y: 37 },
    { role: 'LB',  x: 13, y: 11 },
    { role: 'CB',  x: 14, y: 28 },
    { role: 'CB',  x: 14, y: 46 },
    { role: 'RB',  x: 13, y: 63 },
    { role: 'LM',  x: 40, y:  9 },
    { role: 'CM',  x: 38, y: 24 },
    { role: 'CM',  x: 38, y: 50 },
    { role: 'RM',  x: 40, y: 65 },
    { role: 'ST',  x: 60, y: 28 }, // circle rule will push to edge if inside
    { role: 'ST',  x: 60, y: 46 },
  ]},

  goalKick: { slots: [
    { role: 'GK',  x:  5, y: 37 }, // taker
    { role: 'LB',  x: 13, y: 11 },
    { role: 'CB',  x: 15, y: 28 },
    { role: 'CB',  x: 15, y: 46 },
    { role: 'RB',  x: 13, y: 63 },
    { role: 'LM',  x: 55, y:  9 },
    { role: 'CM',  x: 38, y: 24 },
    { role: 'CM',  x: 38, y: 50 },
    { role: 'RM',  x: 55, y: 65 },
    { role: 'ST',  x: 60, y: 28 },
    { role: 'ST',  x: 60, y: 46 },
  ]},

  corner_Attack: { slots: [
    { role: 'LM',  x: PITCH_LENGTH, y:  3 }, // taker
    { role: 'ST',  x: 103, y: 37 }, // central aerial
    { role: 'ST',  x: 100, y: 28 }, // near post
    { role: 'CM',  x:  97, y: 50 }, // back post
    { role: 'CM',  x:  90, y: 28 }, // edge of box
    { role: 'CB',  x:  88, y: 46 }, // arrives late
    { role: 'CB',  x:  85, y: 22 }, // late support
    { role: 'RM',  x:  80, y: 65 }, // outside box
    { role: 'LB',  x:  75, y: 18 }, // safety
    { role: 'RB',  x:  75, y: 56 }, // safety
    { role: 'GK',  x:  10, y: 37 }, // stays back
  ]},

  corner_Defend: { slots: [
    { role: 'GK',  x:  5, y: 37 },
    { role: 'LB',  x: 10, y: 12 },
    { role: 'CB',  x:  9, y: 28 },
    { role: 'CB',  x:  9, y: 46 },
    { role: 'RB',  x: 10, y: 62 },
    { role: 'LM',  x: 22, y:  8 }, // counter threat
    { role: 'CM',  x: 18, y: 22 },
    { role: 'CM',  x: 18, y: 52 },
    { role: 'RM',  x: 22, y: 66 }, // counter threat
    { role: 'ST',  x: 55, y: 28 }, // halfway (counter)
    { role: 'ST',  x: 55, y: 46 }, // halfway (counter)
  ]},

  throwIn_Attack: { slots: [
    { role: 'LM',  x: 70, y:  2 }, // taker
    { role: 'ST',  x: 75, y: 28 },
    { role: 'ST',  x: 72, y: 46 },
    { role: 'CM',  x: 65, y: 28 },
    { role: 'CM',  x: 65, y: 46 },
    { role: 'RM',  x: 70, y: 72 },
    { role: 'CB',  x: 40, y: 30 },
    { role: 'CB',  x: 40, y: 44 },
    { role: 'LB',  x: 30, y: 12 },
    { role: 'RB',  x: 30, y: 62 },
    { role: 'GK',  x: 10, y: 37 },
  ]},

  throwIn_Defend: { slots: [
    { role: 'GK',  x: 10, y: 37 },
    { role: 'LB',  x: 15, y: 11 },
    { role: 'CB',  x: 18, y: 28 },
    { role: 'CB',  x: 18, y: 46 },
    { role: 'RB',  x: 15, y: 63 },
    { role: 'LM',  x: 50, y:  9 },
    { role: 'CM',  x: 40, y: 24 },
    { role: 'CM',  x: 40, y: 50 },
    { role: 'RM',  x: 50, y: 65 },
    { role: 'ST',  x: 55, y: 28 },
    { role: 'ST',  x: 55, y: 46 },
  ]},

  freeKick_Attack: { slots: [
    { role: 'ST',  x: 103, y: 37 },
    { role: 'ST',  x: 100, y: 28 },
    { role: 'CM',  x:  95, y: 50 },
    { role: 'CM',  x:  95, y: 24 },
    { role: 'LM',  x: 100, y: 46 }, // taker or target
    { role: 'RM',  x:  98, y: 30 },
    { role: 'CB',  x:  88, y: 37 },
    { role: 'CB',  x:  85, y: 44 },
    { role: 'LB',  x:  75, y: 12 },
    { role: 'RB',  x:  75, y: 62 },
    { role: 'GK',  x:  10, y: 37 },
  ]},

  freeKick_Defend: { slots: [
    { role: 'GK',  x:  5, y: 37 },
    { role: 'LB',  x: 10, y: 15 },
    { role: 'CB',  x:  8, y: 28 },
    { role: 'CB',  x:  8, y: 46 },
    { role: 'RB',  x: 10, y: 59 },
    { role: 'LM',  x: 35, y:  8 },
    { role: 'CM',  x: 20, y: 22 },
    { role: 'CM',  x: 20, y: 52 },
    { role: 'RM',  x: 35, y: 66 },
    { role: 'ST',  x: 55, y: 28 },
    { role: 'ST',  x: 55, y: 46 },
  ]},

  offside_fk: { slots: [
    { role: 'GK',  x:  8, y: 37 },
    { role: 'LB',  x: 22, y: 13 },
    { role: 'CB',  x: 25, y: 28 }, // likely taker
    { role: 'CB',  x: 25, y: 46 }, // likely taker
    { role: 'RB',  x: 22, y: 61 },
    { role: 'LM',  x: 50, y: 11 }, // wide outlet
    { role: 'CM',  x: 42, y: 26 },
    { role: 'CM',  x: 42, y: 48 },
    { role: 'RM',  x: 50, y: 63 }, // wide outlet
    { role: 'ST',  x: 66, y: 30 }, // pinned high
    { role: 'ST',  x: 66, y: 44 }, // pinned high
  ]},
};

// ── 3-5-2 ────────────────────────────────────────────────────────────────────

const f352: FormationSetPieces = {
  formationId: '3-5-2',

  kickOff: { slots: [
    { role: 'GK',  x: 10, y: 37 },
    { role: 'CB',  x: 38, y: 18 },
    { role: 'CB',  x: 38, y: 37 },
    { role: 'CB',  x: 38, y: 56 },
    { role: 'LWB', x: 50, y:  8 },
    { role: 'CM',  x: 50, y: 26 },
    { role: 'CDM', x: 45, y: 37 },
    { role: 'CM',  x: 50, y: 48 },
    { role: 'RWB', x: 50, y: 66 },
    { role: 'ST',  x: 57, y: 28 }, // ball taker
    { role: 'ST',  x: 57, y: 46 }, // partner
  ]},

  kickOffDefend: { slots: [
    { role: 'GK',  x:  5, y: 37 },
    { role: 'CB',  x: 14, y: 18 },
    { role: 'CB',  x: 14, y: 37 },
    { role: 'CB',  x: 14, y: 56 },
    { role: 'LWB', x: 38, y:  8 },
    { role: 'CDM', x: 32, y: 37 },
    { role: 'CM',  x: 38, y: 26 },
    { role: 'CM',  x: 38, y: 48 },
    { role: 'RWB', x: 38, y: 66 },
    { role: 'ST',  x: 60, y: 28 }, // circle rule will push to edge if inside
    { role: 'ST',  x: 60, y: 46 },
  ]},

  goalKick: { slots: [
    { role: 'GK',  x:  5, y: 37 }, // taker
    { role: 'CB',  x: 15, y: 18 },
    { role: 'CB',  x: 15, y: 37 },
    { role: 'CB',  x: 15, y: 56 },
    { role: 'LWB', x: 13, y:  8 },
    { role: 'CM',  x: 38, y: 24 },
    { role: 'CDM', x: 28, y: 37 },
    { role: 'CM',  x: 38, y: 50 },
    { role: 'RWB', x: 13, y: 66 },
    { role: 'ST',  x: 60, y: 28 },
    { role: 'ST',  x: 60, y: 46 },
  ]},

  corner_Attack: { slots: [
    { role: 'LWB', x: PITCH_LENGTH, y:  3 }, // taker at corner
    { role: 'ST',  x: 103, y: 37 },
    { role: 'ST',  x: 100, y: 28 },
    { role: 'CM',  x:  97, y: 50 },
    { role: 'CM',  x:  93, y: 20 },
    { role: 'CDM', x:  90, y: 37 },
    { role: 'CB',  x:  88, y: 46 },
    { role: 'CB',  x:  85, y: 56 },
    { role: 'CB',  x:  85, y: 20 },
    { role: 'RWB', x:  78, y: 66 },
    { role: 'GK',  x:  10, y: 37 },
  ]},

  corner_Defend: { slots: [
    { role: 'GK',  x:  5, y: 37 },
    { role: 'CB',  x:  9, y: 18 },
    { role: 'CB',  x:  8, y: 37 },
    { role: 'CB',  x:  9, y: 56 },
    { role: 'LWB', x: 12, y:  8 },
    { role: 'CM',  x: 18, y: 24 },
    { role: 'CDM', x: 16, y: 37 },
    { role: 'CM',  x: 18, y: 50 },
    { role: 'RWB', x: 12, y: 66 },
    { role: 'ST',  x: 55, y: 28 },
    { role: 'ST',  x: 55, y: 46 },
  ]},

  throwIn_Attack: { slots: [
    { role: 'LWB', x: 70, y:  2 }, // taker
    { role: 'ST',  x: 75, y: 28 },
    { role: 'ST',  x: 72, y: 46 },
    { role: 'CM',  x: 65, y: 26 },
    { role: 'CDM', x: 62, y: 37 },
    { role: 'CM',  x: 65, y: 48 },
    { role: 'CB',  x: 45, y: 18 },
    { role: 'CB',  x: 45, y: 37 },
    { role: 'CB',  x: 45, y: 56 },
    { role: 'RWB', x: 70, y: 72 },
    { role: 'GK',  x: 10, y: 37 },
  ]},

  throwIn_Defend: { slots: [
    { role: 'GK',  x: 10, y: 37 },
    { role: 'CB',  x: 18, y: 18 },
    { role: 'CB',  x: 18, y: 37 },
    { role: 'CB',  x: 18, y: 56 },
    { role: 'LWB', x: 13, y:  8 },
    { role: 'CM',  x: 40, y: 24 },
    { role: 'CDM', x: 30, y: 37 },
    { role: 'CM',  x: 40, y: 50 },
    { role: 'RWB', x: 13, y: 66 },
    { role: 'ST',  x: 55, y: 28 },
    { role: 'ST',  x: 55, y: 46 },
  ]},

  freeKick_Attack: { slots: [
    { role: 'ST',  x: 103, y: 28 },
    { role: 'ST',  x: 100, y: 46 },
    { role: 'CM',  x:  98, y: 37 }, // taker zone
    { role: 'CM',  x:  95, y: 20 },
    { role: 'CDM', x:  92, y: 55 },
    { role: 'CB',  x:  88, y: 28 },
    { role: 'CB',  x:  85, y: 46 },
    { role: 'CB',  x:  82, y: 37 },
    { role: 'LWB', x:  78, y:  8 },
    { role: 'RWB', x:  78, y: 66 },
    { role: 'GK',  x:  10, y: 37 },
  ]},

  freeKick_Defend: { slots: [
    { role: 'GK',  x:  5, y: 37 },
    { role: 'CB',  x:  8, y: 18 },
    { role: 'CB',  x:  7, y: 37 },
    { role: 'CB',  x:  8, y: 56 },
    { role: 'LWB', x: 10, y:  8 },
    { role: 'CM',  x: 20, y: 24 },
    { role: 'CDM', x: 16, y: 37 },
    { role: 'CM',  x: 20, y: 50 },
    { role: 'RWB', x: 10, y: 66 },
    { role: 'ST',  x: 55, y: 28 },
    { role: 'ST',  x: 55, y: 46 },
  ]},

  offside_fk: { slots: [
    { role: 'GK',  x:  8, y: 37 },
    { role: 'CB',  x: 25, y: 18 }, // likely taker
    { role: 'CB',  x: 25, y: 37 }, // likely taker
    { role: 'CB',  x: 25, y: 56 }, // likely taker
    { role: 'LWB', x: 48, y: 10 }, // wide outlet
    { role: 'CM',  x: 42, y: 26 },
    { role: 'CDM', x: 38, y: 37 }, // short support
    { role: 'CM',  x: 42, y: 48 },
    { role: 'RWB', x: 48, y: 64 }, // wide outlet
    { role: 'ST',  x: 66, y: 30 }, // pinned high
    { role: 'ST',  x: 66, y: 44 }, // pinned high
  ]},
};

// ── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY: FormationSetPieces[] = [f433, f442, f352];

/** Formation IDs that have full set piece layouts defined and are ready to use. */
export const SUPPORTED_FORMATIONS = new Set<string>(['4-3-3', '4-4-2', '3-5-2']);

/**
 * Look up the set piece layouts for a formation by ID.
 * Returns null if no layout is defined for that formation.
 */
export function getFormationSetPieces(formationId: string): FormationSetPieces | null {
  return REGISTRY.find(l => l.formationId === formationId) ?? null;
}

/**
 * Generate a basic kickoff layout from a formation's defending slots.
 *
 * Defending slots are already within the team's own half (x ≤ 60 in Team A
 * reference frame). The forward-most player is capped at x=57 so no one
 * crosses the centre line before the ball is played.
 *
 * Used as fallback for formations without a defined kickoff layout.
 */
export function generateKickoffLayout(formation: Formation): SetPieceLayout {
  const CENTRE_LINE = 57; // just inside own half
  return {
    slots: formation.defending.map(slot => ({
      role: slot.role as PlayerRole,
      x:    Math.min(slot.x, CENTRE_LINE),
      y:    slot.y,
    })),
  };
}
