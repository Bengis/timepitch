import type { PlayerStatsRecord } from "@/types/playerTypes";
import type { StatusLevel } from "@/Domain/Player";

export interface EffectTable {
  neg2: number;
  neg1: number;
  zero: number;
  pos1: number;
  pos2: number;
}

export const LEVEL_EFFECT: Record<StatusLevel, EffectTable> = {
  1: { neg2: 25, neg1: 40, zero: 35, pos1: 0, pos2: 0 },
  2: { neg2: 10, neg1: 35, zero: 45, pos1: 10, pos2: 0 },
  3: { neg2: 0, neg1: 15, zero: 70, pos1: 15, pos2: 0 },
  4: { neg2: 0, neg1: 5, zero: 55, pos1: 30, pos2: 10 },
  5: { neg2: 0, neg1: 0, zero: 40, pos1: 40, pos2: 20 },
};

export const FORM_BIAS: Record<StatusLevel, { neg: number; pos: number }> = {
  1: { neg: 10, pos: -10 },
  2: { neg: 5, pos: -5 },
  3: { neg: 0, pos: 0 },
  4: { neg: -5, pos: 5 },
  5: { neg: -10, pos: 10 },
};

export const TRAINING_ATTRS = [
  "speed",
  "acceleration",
  "stamina",
  "strength",
  "jump",
  "tackling",
  "pressing",
] as const satisfies readonly (keyof PlayerStatsRecord)[];

export const MORALE_ATTRS = [
  "passing",
  "vision",
  "finishing",
  "dribbling",
  "heading",
] as const satisfies readonly (keyof PlayerStatsRecord)[];

export const TRAINING_TARGET_COUNT = 2;
export const MORALE_TARGET_COUNT = 2;
export const TRAINING_APPLY_CHANCE = 0.6;
export const MORALE_APPLY_CHANCE = 0.7;

function clampStat(n: number): number {
  return n < 0 ? 0 : n > 10 ? 10 : n;
}

/** Copy of table with neg/pos probability shifted; `zero` unchanged; total stays 100. */
export function applyFormBias(table: EffectTable, formLevel: StatusLevel): EffectTable {
  const bias = FORM_BIAS[formLevel];
  const t: EffectTable = { ...table };

  if (bias.pos > 0) {
    let move = bias.pos;

    const takeNeg1 = Math.min(t.neg1, move);
    t.neg1 -= takeNeg1;
    t.pos1 += takeNeg1;
    move -= takeNeg1;

    const takeNeg2 = Math.min(t.neg2, move);
    t.neg2 -= takeNeg2;
    t.pos2 += takeNeg2;
  }

  if (bias.neg > 0) {
    let move = bias.neg;

    const takePos1 = Math.min(t.pos1, move);
    t.pos1 -= takePos1;
    t.neg1 += takePos1;
    move -= takePos1;

    const takePos2 = Math.min(t.pos2, move);
    t.pos2 -= takePos2;
    t.neg2 += takePos2;
  }

  return t;
}

/**
 * Roll a discrete delta from the table. `r` is in [0, 100).
 * @param random01 - returns value in [0, 1); defaults to Math.random
 */
export function roll(table: EffectTable, random01: () => number = Math.random): -2 | -1 | 0 | 1 | 2 {
  const r = random01() * 100;
  if (r < table.neg2) return -2;
  if (r < table.neg2 + table.neg1) return -1;
  if (r < table.neg2 + table.neg1 + table.zero) return 0;
  if (r < table.neg2 + table.neg1 + table.zero + table.pos1) return 1;
  return 2;
}

function pickRandomSubset<T>(items: readonly T[], count: number, random01: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random01() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function applyTraining(
  trainingLevel: StatusLevel,
  formLevel: StatusLevel,
  deltas: Partial<Record<keyof PlayerStatsRecord, number>>,
  random01: () => number,
): void {
  const base = LEVEL_EFFECT[trainingLevel];
  const table = applyFormBias(base, formLevel);
  const targets = pickRandomSubset(TRAINING_ATTRS, TRAINING_TARGET_COUNT, random01);
  for (const attr of targets) {
    if (random01() < TRAINING_APPLY_CHANCE) {
      deltas[attr] = (deltas[attr] ?? 0) + roll(table, random01);
    }
  }
}

function applyMorale(
  moraleLevel: StatusLevel,
  formLevel: StatusLevel,
  deltas: Partial<Record<keyof PlayerStatsRecord, number>>,
  random01: () => number,
): void {
  const base = LEVEL_EFFECT[moraleLevel];
  const table = applyFormBias(base, formLevel);
  const targets = pickRandomSubset(MORALE_ATTRS, MORALE_TARGET_COUNT, random01);
  for (const attr of targets) {
    if (random01() < MORALE_APPLY_CHANCE) {
      deltas[attr] = (deltas[attr] ?? 0) + roll(table, random01);
    }
  }
}

/**
 * One-shot pre-match buff: discrete deltas from training and morale tables, biased by form.
 * @param random01 - inject for tests; defaults to Math.random
 */
export function computeBuffedStats(
  stats: PlayerStatsRecord,
  trainingLevel: StatusLevel,
  moraleLevel: StatusLevel,
  formLevel: StatusLevel,
  random01: () => number = Math.random,
): PlayerStatsRecord {
  const deltas: Partial<Record<keyof PlayerStatsRecord, number>> = {};
  applyTraining(trainingLevel, formLevel, deltas, random01);
  applyMorale(moraleLevel, formLevel, deltas, random01);

  const out = { ...stats };
  for (const key of Object.keys(stats) as (keyof PlayerStatsRecord)[]) {
    const delta = deltas[key] ?? 0;
    out[key] = clampStat(stats[key] + delta);
  }
  return out;
}
