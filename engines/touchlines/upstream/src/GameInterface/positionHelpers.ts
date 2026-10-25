/**
 * Position helpers — single source of truth for role categorisation and display.
 *
 * Detailed roles (CB, LB, CDM …) are used in formation selection and the engine.
 * Main roles (GK / Defender / Midfielder / Forward) are used everywhere else in the UI.
 */

import ROLES from "@/Data/roles.json";

export type MainRole = "GK" | "Defender" | "Midfielder" | "Forward";

type RolesWithAttrWeights = Record<string, { attrWeights?: Record<string, number> }>;

/**
 * Resolves which `roles.json` entry to use for attribute weights (development UI, etc.).
 * - Any keeper (`GK` anywhere in the list) always uses GK weights.
 * - Otherwise uses the first position that exists in `roles.json` with attrWeights.
 * - Abstract pipeline labels (Defender / Midfielder / Forward) map to CB / CM / ST.
 */
export function roleForDevelopmentWeights(positions: string[]): string {
  const R = ROLES as RolesWithAttrWeights;
  if (positions.includes("GK")) return "GK";
  for (const p of positions) {
    if (R[p]?.attrWeights) return p;
  }
  const abstract: Record<string, string> = {
    Defender: "CB",
    Midfielder: "CM",
    Forward: "ST",
  };
  for (const p of positions) {
    const mapped = abstract[p];
    if (mapped && R[mapped]?.attrWeights) return mapped;
  }
  return "CM";
}

/** Map every detailed position code to its main role. */
const MAIN_ROLE_MAP: Record<string, MainRole> = {
  // Main roles pass through unchanged
  GK: "GK", Defender: "Defender", Midfielder: "Midfielder", Forward: "Forward",
  // Detailed roles
  CB:  "Defender", LB: "Defender", RB: "Defender", LWB: "Defender", RWB: "Defender",
  CDM: "Midfielder", DM: "Midfielder", CM: "Midfielder", CAM: "Midfielder",
  AM:  "Midfielder", LM: "Midfielder", RM: "Midfielder",
  LW:  "Forward", RW: "Forward", ST: "Forward", CF: "Forward",
};

/** Returns the main role for a position code (main or detailed). Falls back to "Forward". */
export function getMainRole(pos: string): MainRole {
  return MAIN_ROLE_MAP[pos] ?? "Forward";
}

/** Short label for compact display (e.g. badge in squad list). */
export const MAIN_ROLE_ABBR: Record<MainRole, string> = {
  GK:         "GK",
  Defender:   "DEF",
  Midfielder: "MID",
  Forward:    "FWD",
};

/** Pill bg + text + border — matches dashboard PlayerCard role badges. */
export const MAIN_ROLE_BADGE_CLASSES: Record<MainRole, string> = {
  GK:         "bg-chart-4/20 text-chart-4 border-chart-4/40",
  Defender:   "bg-blue-500/20 text-blue-400 border-blue-500/40",
  Midfielder: "bg-primary/20 text-primary border-primary/40",
  Forward:    "bg-destructive/20 text-destructive border-destructive/40",
};

/** Tailwind colour class per main role (and per detailed position for formation views). */
export function getPositionColor(pos: string): string {
  const main = getMainRole(pos);
  switch (main) {
    case "GK":         return "text-chart-4";
    case "Defender":   return "text-blue-400";
    case "Midfielder": return "text-primary";
    case "Forward":    return "text-destructive";
  }
}

/** Group label used to bucket players in squad / scout views. */
export function getPositionGroup(pos: string): string {
  const main = getMainRole(pos);
  switch (main) {
    case "GK":         return "Goalkeepers";
    case "Defender":   return "Defenders";
    case "Midfielder": return "Midfielders";
    case "Forward":    return "Forwards";
  }
}

/** Ordered section keys for squad / scout group rendering. */
export const POSITION_GROUP_ORDER = ["Goalkeepers", "Defenders", "Midfielders", "Forwards"] as const;
