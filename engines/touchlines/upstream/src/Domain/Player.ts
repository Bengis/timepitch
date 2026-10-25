import type { PlayerStatsRecord, RosterPlayer } from "@/types/playerTypes";
import ROLES from "@/Data/roles.json";
import { getMainRole, type MainRole } from "@/GameInterface/positionHelpers";

/** All detailed roles mapped to their main role band — used to find a player's best fit. */
export const MAIN_ROLE_TO_SPECIFICS: Record<MainRole, string[]> = {
  GK:         ["GK"],
  Defender:   ["CB", "LB", "RB", "LWB", "RWB"],
  Midfielder: ["CDM", "CM", "CAM", "LM", "RM"],
  Forward:    ["LW", "RW", "ST"],
};

type RolesWithAttrWeights = Record<string, { attrWeights?: Record<string, number> }>;

export type StatusLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Roster player model: weighted overall, age, market value, wage, and status bands.
 */
export class Player {
  constructor(
    readonly overallRating: number,
    readonly age: number,
  ) {}

  /**
   * Weighted score for a single specific role (e.g. "CB", "CM").
   * Uses a quadratic mean (power mean, p=2) so high-end attributes outweigh
   * mid-range ones — e.g. acc 9 + speed 5 scores higher than acc 8 + speed 6,
   * because a point at the top of the scale is harder to get than one in the middle.
   */
  private static scoreForRole(stats: PlayerStatsRecord, role: string): number {
    const R = ROLES as RolesWithAttrWeights;
    const weights = R[role]?.attrWeights ?? R["CM"]?.attrWeights ?? {};
    let wSum = 0;
    let wTotal = 0;
    for (const [attr, val] of Object.entries(stats)) {
      const w = weights[attr] ?? 0;
      wSum += val * val * w;
      wTotal += w;
    }
    return wTotal > 0 ? Math.sqrt(wSum / wTotal) : 5.0;
  }

  /**
   * Weighted score for a role. If a main role (GK / Defender / Midfielder / Forward) is
   * passed, returns the best score across every specific role in that band. Specific roles
   * are scored directly.
   */
  static weightedScore(stats: PlayerStatsRecord, position: string): number {
    const specifics = MAIN_ROLE_TO_SPECIFICS[position as MainRole];
    if (specifics) {
      let best = 0;
      for (const role of specifics) {
        const s = Player.scoreForRole(stats, role);
        if (s > best) best = s;
      }
      return best;
    }
    return Player.scoreForRole(stats, position);
  }

  /** Computes a player's overall AVG — best weighted score across their main role's specifics. */
  static computeOverallAvg(player: RosterPlayer): number {
    const main = getMainRole(player.positions[0] ?? "CM");
    return Player.weightedScore(player.stats, main);
  }

  /**
   * Returns the player's cached overall AVG, computing and storing it on first access.
   * The cache is invalidated whenever stats change (see `PlayerDevelopment.applyDevelopment`).
   */
  static overallAvg(player: RosterPlayer): number {
    if (typeof player.overallAvg === "number") return player.overallAvg;
    const v = Player.computeOverallAvg(player);
    player.overallAvg = v;
    return v;
  }

  /** Form band from last 5 ratings average; empty list uses 6.0 baseline. */
  static formToStatus(recentRatings: number[]): StatusLevel {
    const avg =
      recentRatings.length > 0
        ? recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length
        : 6.0;
    if (avg >= 7.5) return 5;
    if (avg >= 7.0) return 4;
    if (avg >= 6.5) return 3;
    if (avg >= 6.0) return 2;
    return 1;
  }

  static moraleToStatus(morale: number): StatusLevel {
    if (morale >= 85) return 5;
    if (morale >= 70) return 4;
    if (morale >= 50) return 3;
    if (morale >= 30) return 2;
    return 1;
  }

  /** `points` is the accumulated training score (0–5). Maps directly to intensity bands. */
  static trainingToStatus(points: number): StatusLevel {
    if (points > 4) return 5;
    if (points > 2) return 4;
    if (points > 1) return 3;
    if (points > 0) return 2;
    return 1;
  }

  /**
   * Estimated value in millions of £ (float), before rounding to whole pounds.
   *
   * Age curve is biased toward youth: a 19-year-old with decent ability commands
   * a steep premium over the same rating at peak, reflecting years of expected
   * growth. Veterans decline sharply after 30.
   */
  get valueMillions(): number {
    const base = this.overallRating * this.overallRating * 0.8;
    const a = this.age;
    const ageFactor =
      a <= 19 ? 2.4 :
      a <= 21 ? 2.0 :
      a <= 23 ? 1.6 :
      a <= 25 ? 1.3 :
      a <= 28 ? 1.0 :
      a <= 30 ? 0.75 :
      a <= 32 ? 0.50 :
      a <= 34 ? 0.30 :
      0.15;
    return base * ageFactor;
  }

  /** Estimated transfer value in whole pounds. */
  get price(): number {
    return Math.round(this.valueMillions) * 1_000_000;
  }

  /** Short label for cards / lists (e.g. `"12.5M"`). */
  get priceLabel(): string {
    const v = this.valueMillions;
    if (v >= 100) return `${Math.round(v)}M`;
    return `${v.toFixed(1)}M`;
  }

  /** Weekly wage label (e.g. `"45k"`). */
  get salaryLabel(): string {
    const weekly = Math.round(this.overallRating * this.overallRating * 350);
    if (weekly >= 1000) return `${(weekly / 1000).toFixed(0)}k`;
    return `${weekly}`;
  }
}
