// "Calibrated" bundle (2026-10-22 'Calibrar ambos'): fair physical clock (TIME_SCALE 18 -> 1) plus four
// bundle-time rewrites that route upstream expressions through harness hooks (calibration.ts):
//   gameState.ts      off-ball step speed            -> globalThis.__tpGovern(...)
//   DecisionTree.ts   SHOOT_THRESHOLD[role]          -> * __tpCal.shoot_threshold_scale
//   DecisionTree.ts   high-xG floor xg*xg            -> xg ** __tpCal.xg_floor_pow
//   ActionOutcomes.ts resolveShot goalChance         -> * __tpCal.goal_chance_scale
// Upstream files (5c5c71a, AGPL-3.0-or-later) are NOT modified; the build fails unless every target
// is found exactly once. With all hook values at 1/2/1 and the governor bypassed, behaviour equals the fair bundle.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const upstreamSrc = resolve(here, '../upstream/src');
const G = '(globalThis as any)';
const RULES = {
  '/GameEngine/Domain/gameState.ts': [
    ['const TIME_SCALE = 2700 / REAL_HALF_DURATION;',
     'const TIME_SCALE = 1; /* timepitch calibrated harness: was 2700 / REAL_HALF_DURATION (18) */'],
    ['const step = Math.min((baseSpeed + accelBurst) * recoveryMult * dt, dist);',
     `const step = Math.min(${G}.__tpGovern(decision?.type, isPressing, isOffBallRun, dist, (baseSpeed + accelBurst) * recoveryMult) * dt, dist); /* timepitch governor */`],
  ],
  '/GameEngine/Domain/DecisionTree.ts': [
    ['const threshold = SHOOT_THRESHOLD[player.role] ?? 0.50;',
     `const threshold = (SHOOT_THRESHOLD[player.role] ?? 0.50) * ${G}.__tpCal.shoot_threshold_scale; /* timepitch */`],
    ['const xgFloor = xg * xg;', `const xgFloor = Math.pow(xg, ${G}.__tpCal.xg_floor_pow); /* timepitch */`],
  ],
  '/GameEngine/Infrastructure/ActionOutcomes.ts': [
    ['const goalChance = clamp(shot.xg * shooterEffect * gkEffect, 0, 1);',
     `const goalChance = clamp(shot.xg * shooterEffect * gkEffect * ${G}.__tpCal.goal_chance_scale, 0, 1); /* timepitch */`],
  ],
};
const applied = new Map();
export default {
  input: resolve(here, 'freeplay-calibrated.ts'),
  platform: 'node',
  resolve: { alias: { '@': upstreamSrc } },
  tsconfig: false,
  plugins: [{
    name: 'timepitch-calibration-rewrites',
    transform(code, id) {
      const norm = id.split(String.fromCharCode(92)).join('/');
      const key = Object.keys(RULES).find(k => norm.endsWith(k));
      if (!key) return null;
      for (const [from, to] of RULES[key]) {
        const n = code.split(from).length - 1;
        if (n !== 1) throw new Error(`${key}: expected exactly one '${from}', found ${n}`);
        code = code.replace(from, to);
        applied.set(from, (applied.get(from) ?? 0) + 1);
      }
      return { code, map: null };
    },
    buildEnd() {
      const total = Object.values(RULES).flat().length;
      if (applied.size !== total || [...applied.values()].some(v => v !== 1)) throw new Error(`rewrite count mismatch ${JSON.stringify([...applied])}`);
    },
  }],
  output: { file: resolve(here, '../build/freeplay-calibrated.mjs'), format: 'esm', sourcemap: false },
};
