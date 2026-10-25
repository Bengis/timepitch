/**
 * TeamLineup — takes a player's base roster attributes and resolves them
 * into engine-ready `PlayerStats` in the context of their assigned role.
 *
 * The same player playing ST vs CB will get different game stats because
 * the role shapes how their attributes translate into engine behaviour.
 *
 * All output values are in engine units (yards, yards/second, 0..1 probabilities).
 */

import type { PlayerRole, PlayerStats } from '@/GameEngine/types';
import type { PlayerStatsRecord } from '@/types/playerTypes';
import { roleEngine } from '@/GameEngine/Domain/roleEngineData';

/** Base press engagement distance (yards). Team `pressing_style` adjusts this in DefensivePositioning. */
const PRESS_RANGE_BASE_YARDS = 8;

/**
 * Resolve a player's raw attributes into game stats for their assigned role.
 *
 * This is the lineup contract: the same player could be fielded in different
 * roles with different effective stats each time.
 *
 * Roster has no separate firstTouch — dribbling proxies close control for receiving.
 */
export function teamLineup(raw: PlayerStatsRecord, role: PlayerRole): PlayerStats {
  return {
    withBall: {
      // ── Shooting ─────────────────────────────────────────────────────
      shootAccuracy: role === 'GK' ? 0 : Math.min(0.95, raw.finishing / 10),

      // ── Carrying ─────────────────────────────────────────────────────
      // GK: carryVision/Chance = 0 → bestCarryLane always returns null → always passes
      carrySpeed:   5   + (raw.speed / 10) * 4.0,   // ~5–9 yds/s; acceleration burst added separately in gameState
      carryVision:  role === 'GK' ? 0 : 6 + raw.vision * 1.2,    // ~7–18 yds
      speed:        raw.speed        / 10,  // 0..1 normalised
      acceleration: raw.acceleration / 10,  // 0..1 normalised

      // ── Passing ──────────────────────────────────────────────────────
      passingSkill: raw.passing    / 10,  // 0..1 — execution quality
      vision:       raw.vision    / 10,  // 0..1 — spot best options
      firstTouch:   raw.dribbling / 10, // 0..1 — receiver control (from dribbling on roster)
      dribbling:    raw.dribbling  / 10, // 0..1 — 1v1 dribble resolution
      strength:     (raw.strength ?? 5) / 10, // 0..1 — resists press pressure when shooting
    },
    withoutBall: {
      // ── Pressing ────────────────────────────────────────────────────
      pressSpeed:   5 + (raw.speed / 10) * 4.0,   // ~5–9 yds/s; acceleration burst added separately in gameState
      pressRange:   PRESS_RANGE_BASE_YARDS,
      speed:        raw.speed        / 10,    // 0..1 normalised
      acceleration: raw.acceleration / 10,    // 0..1 normalised

      // ── Tackling ────────────────────────────────────────────────────
      tackleChance: 0.1 + raw.tackling * 0.07, // ~0.17–0.80
      tackling:     raw.tackling / 10,         // 0..1 floorless — symmetric with withBall.dribbling for 1v1 duels

      // ── Interception (pressing awareness + vision) ──────────────────
      interceptionChance: 0.05 + raw.pressing * 0.05 + raw.vision * 0.02, // ~0.17–0.75

      // ── GK attributes (0 for non-GKs) ───────────────────────────────
      gkPositioning: role === 'GK' ? raw.pressing / 10 : 0,
      gkReflex:      role === 'GK' ? raw.reflex   / 10 : 0,
      gkDiving:      role === 'GK' ? raw.jump     / 10 : 0,
      strength:      (raw.strength ?? 5) / 10, // 0..1 — physical presence when pressing
    },
  };
}
