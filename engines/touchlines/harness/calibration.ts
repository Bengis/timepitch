// TimePitch calibration hooks for the TouchLines free-play harness (local evaluation only).
// Imported BEFORE freeplay.ts by freeplay-calibrated.ts. The calibrated bundle
// (rolldown.calibrated.config.mjs) rewrites four upstream expressions at bundle time so they call
// these hooks; upstream files (commit 5c5c71a, AGPL-3.0-or-later) are NOT modified.
// SYNTHETIC: movement and events remain engine output, not tracking data.
//
// --cal '<json>' or --cal-file <path> overrides any of DEFAULTS below. Units: TouchLines yards, seconds.
import { readFileSync } from 'node:fs';

export interface Calibration {
  // Off-ball speed governor (formation / marking / support runs). Pressing, tackling, chasing loose
  // balls, GK shot reaction and the ball carrier keep upstream speeds (sprints stay possible).
  dead_yd: number;          // within this distance of the tactical target the player stands still
  gain_per_s: number;       // arrival law: speed = (dist - dead) * gain, clamped to [walk, cruise]
  walk_yd_s: number;        // floor once outside the dead band
  cruise_frac: number;      // ceiling for repositioning, as a fraction of the upstream full speed
  far_yd: number;           // beyond this distance from the target: upstream full speed (recovery run)
  run_frac: number;         // support_run / create_space speed as fraction of full speed
  mark_full_yd: number;     // track_mark: full speed beyond this distance, arrival law below it
  // Chance / goal rate (multipliers on upstream values).
  shoot_threshold_scale: number; // SHOOT_THRESHOLD[role] *= scale (fewer, closer shots)
  xg_floor_pow: number;          // upstream high-xG floor xg^2 -> xg^pow
  goal_chance_scale: number;     // resolveShot goalChance *= scale (conversion only; decisions unchanged)
}
export const DEFAULTS: Calibration = {
  dead_yd: 1.0, gain_per_s: 0.8, walk_yd_s: 1.5, cruise_frac: 0.55, far_yd: 12, run_frac: 0.75, mark_full_yd: 5,
  shoot_threshold_scale: 2.5, xg_floor_pow: 3, goal_chance_scale: 0.3,
};

function argv(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const raw = argv('--cal') ?? (argv('--cal-file') ? readFileSync(argv('--cal-file')!, 'utf8') : undefined);
const overrides = raw ? JSON.parse(raw) as Partial<Calibration> : {};
for (const k of Object.keys(overrides)) if (!(k in DEFAULTS)) throw new Error(`unknown calibration key ${k}`);
export const CAL: Calibration = { ...DEFAULTS, ...overrides };
for (const [k, v] of Object.entries(CAL)) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`bad ${k}`);

const counts = { governed: 0, still: 0, full_far: 0, pressing: 0, run: 0, mark: 0 };

/** Off-ball speed (yd/s) replacing upstream `(baseSpeed + accelBurst) * recoveryMult`. */
function govern(decisionType: string | undefined, isPressing: boolean, isOffBallRun: boolean, dist: number, full: number): number {
  counts.governed++;
  if (isPressing || decisionType === 'tackle' || decisionType === 'step_into_carry_lane') { counts.pressing++; return full; }
  if (isOffBallRun) { counts.run++; return full * CAL.run_frac; }
  if (decisionType === 'track_mark' && dist > CAL.mark_full_yd) { counts.mark++; return full; }
  if (dist <= CAL.dead_yd) { counts.still++; return 0; }
  if (dist >= CAL.far_yd) { counts.full_far++; return full; }
  const cruise = full * CAL.cruise_frac;
  return Math.min(cruise, Math.max(Math.min(CAL.walk_yd_s, cruise), (dist - CAL.dead_yd) * CAL.gain_per_s));
}

const g = globalThis as Record<string, unknown>;
g.__tpGovern = govern;
g.__tpCal = CAL;
g.__tpCalibration = { schema: 'timepitch-touchlines-calibration-1', params: CAL, defaults_overridden: Object.keys(overrides), governor_counts: counts };
