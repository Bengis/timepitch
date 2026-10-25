// Installs a seeded PRNG in place of Math.random. Imported FIRST by freeplay.ts so it is
// evaluated before any TouchLines module (ESM evaluation order is preserved by the bundle).
// SYNTHETIC: the generated movement is engine output, not tracking data.
function argSeed(): number {
  const i = process.argv.indexOf('--seed');
  const raw = i >= 0 ? process.argv[i + 1] : undefined;
  const n = raw === undefined ? 42 : Number(raw);
  if (!Number.isInteger(n)) throw new Error(`--seed must be an integer, got ${raw}`);
  return n >>> 0;
}
export const SEED = argSeed();
let a = SEED;
export let randomCalls = 0;
// mulberry32
export function seededRandom(): number {
  randomCalls++;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const nativeRandom = Math.random;
Math.random = seededRandom;
export function randomCallCount(): number { return randomCalls; }
