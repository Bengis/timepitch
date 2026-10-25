import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
//#region .local/touchlines/harness/seed.ts
function argSeed() {
	const i = process.argv.indexOf("--seed");
	const raw = i >= 0 ? process.argv[i + 1] : void 0;
	const n = raw === void 0 ? 42 : Number(raw);
	if (!Number.isInteger(n)) throw new Error(`--seed must be an integer, got ${raw}`);
	return n >>> 0;
}
const SEED = argSeed();
let a = SEED;
let randomCalls = 0;
function seededRandom$1() {
	randomCalls++;
	a = a + 1831565813 >>> 0;
	let t = a;
	t = Math.imul(t ^ t >>> 15, t | 1);
	t ^= t + Math.imul(t ^ t >>> 7, t | 61);
	return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
Math.random = seededRandom$1;
function randomCallCount() {
	return randomCalls;
}
//#endregion
//#region .local/touchlines/harness/calibration.ts
const DEFAULTS$1 = {
	dead_yd: 1,
	gain_per_s: .8,
	walk_yd_s: 1.5,
	cruise_frac: .55,
	far_yd: 12,
	run_frac: .75,
	mark_full_yd: 5,
	shoot_threshold_scale: 2.5,
	xg_floor_pow: 3,
	goal_chance_scale: .3
};
function argv(name) {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : void 0;
}
const raw = argv("--cal") ?? (argv("--cal-file") ? readFileSync(argv("--cal-file"), "utf8") : void 0);
const overrides = raw ? JSON.parse(raw) : {};
for (const k of Object.keys(overrides)) if (!(k in DEFAULTS$1)) throw new Error(`unknown calibration key ${k}`);
const CAL = {
	...DEFAULTS$1,
	...overrides
};
for (const [k, v] of Object.entries(CAL)) if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`bad ${k}`);
const counts = {
	governed: 0,
	still: 0,
	full_far: 0,
	pressing: 0,
	run: 0,
	mark: 0
};
/** Off-ball speed (yd/s) replacing upstream `(baseSpeed + accelBurst) * recoveryMult`. */
function govern(decisionType, isPressing, isOffBallRun, dist, full) {
	counts.governed++;
	if (isPressing || decisionType === "tackle" || decisionType === "step_into_carry_lane") {
		counts.pressing++;
		return full;
	}
	if (isOffBallRun) {
		counts.run++;
		return full * CAL.run_frac;
	}
	if (decisionType === "track_mark" && dist > CAL.mark_full_yd) {
		counts.mark++;
		return full;
	}
	if (dist <= CAL.dead_yd) {
		counts.still++;
		return 0;
	}
	if (dist >= CAL.far_yd) {
		counts.full_far++;
		return full;
	}
	const cruise = full * CAL.cruise_frac;
	return Math.min(cruise, Math.max(Math.min(CAL.walk_yd_s, cruise), (dist - CAL.dead_yd) * CAL.gain_per_s));
}
const g = globalThis;
g.__tpGovern = govern;
g.__tpCal = CAL;
g.__tpCalibration = {
	schema: "timepitch-touchlines-calibration-1",
	params: CAL,
	defaults_overridden: Object.keys(overrides),
	governor_counts: counts
};
//#endregion
//#region .local/touchlines/upstream/src/Data/roles.json
var roles_default = {
	GK: {
		"mainRole": "GK",
		"position": {
			"x": 50,
			"y": 95
		},
		"dpWeights": {
			"shooting": 0,
			"passing": .15,
			"defending": .3,
			"technical": .25,
			"physical": .3
		},
		"attrWeights": {
			"passing": .6,
			"vision": 0,
			"finishing": 0,
			"dribbling": 0,
			"speed": 0,
			"acceleration": 0,
			"tackling": 0,
			"pressing": 0,
			"stamina": 0,
			"heading": 0,
			"strength": 0,
			"reflex": 1,
			"jump": 1
		},
		"engine": {
			"ballSupportScale": .1,
			"yRange": 8,
			"bounds": {
				"minX": 2,
				"maxX": 16
			},
			"carryBias": 0,
			"offBallBias": 0,
			"offBallCarryDeltas": {
				"clearance": 0,
				"progress": 0,
				"angle": 0,
				"crowd": 0,
				"dropLaneBias": 0,
				"widthBias": 0
			},
			"offBallIntentWeights": {
				"offer_support": 0,
				"hold_space": 0,
				"make_run": 0
			},
			"defensiveIntentWeights": {
				"hold_shape": 0,
				"track_mark": 0,
				"press_holder": 0,
				"step_into_carry_lane": 0
			}
		}
	},
	CB: {
		"mainRole": "Defender",
		"position": {
			"x": 50,
			"y": 78
		},
		"dpWeights": {
			"shooting": 0,
			"passing": .1,
			"defending": .45,
			"technical": .3,
			"physical": .15
		},
		"attrWeights": {
			"passing": .7,
			"vision": .6,
			"finishing": .2,
			"dribbling": .3,
			"speed": .7,
			"acceleration": .7,
			"tackling": 1,
			"pressing": .8,
			"stamina": .7,
			"heading": 1,
			"strength": 1,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .2,
			"yRange": 14,
			"bounds": {
				"minX": 8,
				"maxX": 50
			},
			"carryBias": .15,
			"offBallBias": .1,
			"offBallCarryDeltas": {
				"clearance": .18,
				"progress": -.22,
				"angle": -.05,
				"crowd": .12,
				"dropLaneBias": 0,
				"widthBias": 0
			},
			"offBallIntentWeights": {
				"offer_support": .3,
				"hold_space": .8,
				"make_run": .05
			},
			"defensiveIntentWeights": {
				"hold_shape": .7,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	LB: {
		"mainRole": "Defender",
		"position": {
			"x": 15,
			"y": 75
		},
		"dpWeights": {
			"shooting": .05,
			"passing": .2,
			"defending": .3,
			"technical": .2,
			"physical": .25
		},
		"attrWeights": {
			"passing": .8,
			"vision": .6,
			"finishing": .3,
			"dribbling": .6,
			"speed": .9,
			"acceleration": .9,
			"tackling": .8,
			"pressing": .8,
			"stamina": .9,
			"heading": .5,
			"strength": .6,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .1,
			"yRange": 50,
			"bounds": {
				"minX": 5,
				"maxX": 65
			},
			"carryBias": .4,
			"offBallBias": .15,
			"offBallCarryDeltas": {
				"clearance": .15,
				"progress": -.2,
				"angle": -.05,
				"crowd": .1,
				"dropLaneBias": .05,
				"widthBias": .15
			},
			"offBallIntentWeights": {
				"offer_support": .45,
				"hold_space": .55,
				"make_run": .2
			},
			"defensiveIntentWeights": {
				"hold_shape": .7,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	RB: {
		"mainRole": "Defender",
		"position": {
			"x": 85,
			"y": 75
		},
		"dpWeights": {
			"shooting": .05,
			"passing": .2,
			"defending": .3,
			"technical": .2,
			"physical": .25
		},
		"attrWeights": {
			"passing": .8,
			"vision": .6,
			"finishing": .3,
			"dribbling": .6,
			"speed": .9,
			"acceleration": .9,
			"tackling": .8,
			"pressing": .8,
			"stamina": .9,
			"heading": .5,
			"strength": .6,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .1,
			"yRange": 28,
			"bounds": {
				"minX": 5,
				"maxX": 65
			},
			"carryBias": .4,
			"offBallBias": .15,
			"offBallCarryDeltas": {
				"clearance": .15,
				"progress": -.2,
				"angle": -.05,
				"crowd": .1,
				"dropLaneBias": .05,
				"widthBias": .15
			},
			"offBallIntentWeights": {
				"offer_support": .45,
				"hold_space": .55,
				"make_run": .2
			},
			"defensiveIntentWeights": {
				"hold_shape": .7,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	LWB: {
		"mainRole": "Defender",
		"position": {
			"x": 12,
			"y": 62
		},
		"dpWeights": {
			"shooting": .05,
			"passing": .25,
			"defending": .2,
			"technical": .2,
			"physical": .3
		},
		"attrWeights": {
			"passing": .8,
			"vision": .7,
			"finishing": .4,
			"dribbling": .8,
			"speed": 1,
			"acceleration": 1,
			"tackling": .7,
			"pressing": .8,
			"stamina": 1,
			"heading": .4,
			"strength": .5,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .2,
			"yRange": 32,
			"bounds": {
				"minX": 5,
				"maxX": 90
			},
			"carryBias": .6,
			"offBallBias": .25,
			"offBallCarryDeltas": {
				"clearance": .12,
				"progress": -.15,
				"angle": -.05,
				"crowd": .08,
				"dropLaneBias": .05,
				"widthBias": .3
			},
			"offBallIntentWeights": {
				"offer_support": .4,
				"hold_space": .6,
				"make_run": .3
			},
			"defensiveIntentWeights": {
				"hold_shape": .7,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	RWB: {
		"mainRole": "Defender",
		"position": {
			"x": 88,
			"y": 62
		},
		"dpWeights": {
			"shooting": .05,
			"passing": .25,
			"defending": .2,
			"technical": .2,
			"physical": .3
		},
		"attrWeights": {
			"passing": .8,
			"vision": .7,
			"finishing": .4,
			"dribbling": .8,
			"speed": 1,
			"acceleration": 1,
			"tackling": .7,
			"pressing": .8,
			"stamina": 1,
			"heading": .4,
			"strength": .5,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .2,
			"yRange": 32,
			"bounds": {
				"minX": 5,
				"maxX": 90
			},
			"carryBias": .6,
			"offBallBias": .25,
			"offBallCarryDeltas": {
				"clearance": .12,
				"progress": -.15,
				"angle": -.05,
				"crowd": .08,
				"dropLaneBias": .05,
				"widthBias": .3
			},
			"offBallIntentWeights": {
				"offer_support": .4,
				"hold_space": .6,
				"make_run": .3
			},
			"defensiveIntentWeights": {
				"hold_shape": .7,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	CDM: {
		"mainRole": "Midfielder",
		"position": {
			"x": 50,
			"y": 62
		},
		"dpWeights": {
			"shooting": .05,
			"passing": .25,
			"defending": .4,
			"technical": .2,
			"physical": .1
		},
		"attrWeights": {
			"passing": .8,
			"vision": .7,
			"finishing": .3,
			"dribbling": .5,
			"speed": .6,
			"acceleration": .6,
			"tackling": 1,
			"pressing": 1,
			"stamina": .9,
			"heading": .7,
			"strength": .8,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .2,
			"yRange": 18,
			"bounds": {
				"minX": 18,
				"maxX": 68
			},
			"carryBias": .3,
			"offBallBias": .3,
			"offBallCarryDeltas": {
				"clearance": .15,
				"progress": -.15,
				"angle": -.05,
				"crowd": .1,
				"dropLaneBias": .95,
				"widthBias": 0
			},
			"offBallIntentWeights": {
				"offer_support": .7,
				"hold_space": .65,
				"make_run": .1
			},
			"defensiveIntentWeights": {
				"hold_shape": .5,
				"track_mark": .5,
				"press_holder": .7,
				"step_into_carry_lane": .5
			}
		}
	},
	CM: {
		"mainRole": "Midfielder",
		"position": {
			"x": 50,
			"y": 52
		},
		"dpWeights": {
			"shooting": .1,
			"passing": .35,
			"defending": .15,
			"technical": .25,
			"physical": .15
		},
		"attrWeights": {
			"passing": .9,
			"vision": .8,
			"finishing": .5,
			"dribbling": .6,
			"speed": .7,
			"acceleration": .7,
			"tackling": .7,
			"pressing": .8,
			"stamina": 1,
			"heading": .5,
			"strength": .6,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .35,
			"yRange": 28,
			"bounds": {
				"minX": 22,
				"maxX": 85
			},
			"carryBias": .5,
			"offBallBias": .6,
			"offBallCarryDeltas": {
				"clearance": .12,
				"progress": -.1,
				"angle": -.05,
				"crowd": .05,
				"dropLaneBias": .8,
				"widthBias": 0
			},
			"offBallIntentWeights": {
				"offer_support": .7,
				"hold_space": .5,
				"make_run": .3
			},
			"defensiveIntentWeights": {
				"hold_shape": .5,
				"track_mark": .5,
				"press_holder": .7,
				"step_into_carry_lane": .5
			}
		}
	},
	CAM: {
		"mainRole": "Midfielder",
		"position": {
			"x": 50,
			"y": 40
		},
		"dpWeights": {
			"shooting": .2,
			"passing": .35,
			"defending": .05,
			"technical": .3,
			"physical": .1
		},
		"attrWeights": {
			"passing": 1,
			"vision": 1,
			"finishing": .7,
			"dribbling": .8,
			"speed": .6,
			"acceleration": .7,
			"tackling": .3,
			"pressing": .5,
			"stamina": .7,
			"heading": .4,
			"strength": .4,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .4,
			"yRange": 24,
			"bounds": {
				"minX": 28,
				"maxX": 90
			},
			"carryBias": .5,
			"offBallBias": .8,
			"offBallCarryDeltas": {
				"clearance": 0,
				"progress": .05,
				"angle": 0,
				"crowd": 0,
				"dropLaneBias": .5,
				"widthBias": 0
			},
			"offBallIntentWeights": {
				"offer_support": .55,
				"hold_space": .4,
				"make_run": .55
			},
			"defensiveIntentWeights": {
				"hold_shape": .5,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	LM: {
		"mainRole": "Midfielder",
		"position": {
			"x": 15,
			"y": 48
		},
		"dpWeights": {
			"shooting": .15,
			"passing": .25,
			"defending": .1,
			"technical": .2,
			"physical": .3
		},
		"attrWeights": {
			"passing": .7,
			"vision": .7,
			"finishing": .7,
			"dribbling": .9,
			"speed": 1,
			"acceleration": 1,
			"tackling": .4,
			"pressing": .6,
			"stamina": .8,
			"heading": .4,
			"strength": .5,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .35,
			"yRange": 20,
			"bounds": {
				"minX": 16,
				"maxX": 75
			},
			"carryBias": .8,
			"offBallBias": .7,
			"offBallCarryDeltas": {
				"clearance": .1,
				"progress": -.08,
				"angle": -.05,
				"crowd": .05,
				"dropLaneBias": .15,
				"widthBias": .2
			},
			"offBallIntentWeights": {
				"offer_support": .55,
				"hold_space": .55,
				"make_run": .4
			},
			"defensiveIntentWeights": {
				"hold_shape": .5,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	RM: {
		"mainRole": "Midfielder",
		"position": {
			"x": 85,
			"y": 48
		},
		"dpWeights": {
			"shooting": .15,
			"passing": .25,
			"defending": .1,
			"technical": .2,
			"physical": .3
		},
		"attrWeights": {
			"passing": .7,
			"vision": .7,
			"finishing": .7,
			"dribbling": .9,
			"speed": 1,
			"acceleration": 1,
			"tackling": .4,
			"pressing": .6,
			"stamina": .9,
			"heading": .4,
			"strength": .5,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .35,
			"yRange": 20,
			"bounds": {
				"minX": 16,
				"maxX": 75
			},
			"carryBias": .8,
			"offBallBias": .7,
			"offBallCarryDeltas": {
				"clearance": .1,
				"progress": -.08,
				"angle": -.05,
				"crowd": .05,
				"dropLaneBias": .15,
				"widthBias": .2
			},
			"offBallIntentWeights": {
				"offer_support": .55,
				"hold_space": .55,
				"make_run": .4
			},
			"defensiveIntentWeights": {
				"hold_shape": .5,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	LW: {
		"mainRole": "Forward",
		"position": {
			"x": 15,
			"y": 28
		},
		"dpWeights": {
			"shooting": .3,
			"passing": .2,
			"defending": .05,
			"technical": .2,
			"physical": .25
		},
		"attrWeights": {
			"passing": .7,
			"vision": .7,
			"finishing": .8,
			"dribbling": 1,
			"speed": 1,
			"acceleration": 1,
			"tackling": .3,
			"pressing": .5,
			"stamina": .8,
			"heading": .3,
			"strength": .4,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .1,
			"yRange": 22,
			"bounds": {
				"minX": 35,
				"maxX": 105
			},
			"carryBias": .9,
			"offBallBias": .9,
			"offBallCarryDeltas": {
				"clearance": -.05,
				"progress": .1,
				"angle": -.05,
				"crowd": -.05,
				"dropLaneBias": .05,
				"widthBias": .35
			},
			"offBallIntentWeights": {
				"offer_support": .4,
				"hold_space": .55,
				"make_run": .65
			},
			"defensiveIntentWeights": {
				"hold_shape": .5,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	RW: {
		"mainRole": "Forward",
		"position": {
			"x": 85,
			"y": 28
		},
		"dpWeights": {
			"shooting": .3,
			"passing": .2,
			"defending": .05,
			"technical": .2,
			"physical": .25
		},
		"attrWeights": {
			"passing": .7,
			"vision": .7,
			"finishing": .8,
			"dribbling": 1,
			"speed": 1,
			"acceleration": 1,
			"tackling": .3,
			"pressing": .5,
			"stamina": .8,
			"heading": .3,
			"strength": .4,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .1,
			"yRange": 22,
			"bounds": {
				"minX": 35,
				"maxX": 105
			},
			"carryBias": .9,
			"offBallBias": .9,
			"offBallCarryDeltas": {
				"clearance": -.05,
				"progress": .1,
				"angle": -.05,
				"crowd": -.05,
				"dropLaneBias": .05,
				"widthBias": .35
			},
			"offBallIntentWeights": {
				"offer_support": .4,
				"hold_space": .55,
				"make_run": .65
			},
			"defensiveIntentWeights": {
				"hold_shape": .5,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	},
	ST: {
		"mainRole": "Forward",
		"position": {
			"x": 50,
			"y": 20
		},
		"dpWeights": {
			"shooting": .45,
			"passing": .1,
			"defending": .05,
			"technical": .25,
			"physical": .15
		},
		"attrWeights": {
			"passing": .4,
			"vision": .4,
			"finishing": 1,
			"dribbling": .6,
			"speed": .8,
			"acceleration": .8,
			"tackling": .2,
			"pressing": .7,
			"stamina": .7,
			"heading": .8,
			"strength": .8,
			"reflex": 0,
			"jump": 0
		},
		"engine": {
			"ballSupportScale": .5,
			"yRange": 22,
			"bounds": {
				"minX": 40,
				"maxX": 110
			},
			"carryBias": .6,
			"offBallBias": 1,
			"offBallCarryDeltas": {
				"clearance": -.1,
				"progress": .15,
				"angle": .05,
				"crowd": -.05,
				"dropLaneBias": 0,
				"widthBias": 0
			},
			"offBallIntentWeights": {
				"offer_support": .3,
				"hold_space": .4,
				"make_run": .8
			},
			"defensiveIntentWeights": {
				"hold_shape": .1,
				"track_mark": .5,
				"press_holder": .5,
				"step_into_carry_lane": .5
			}
		}
	}
};
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/roleEngineData.ts
const roles = roles_default;
function roleEngine(role) {
	return roles[role].engine;
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/PassConfig.ts
/**
* PassConfig — all tunable weights and thresholds for pass scoring.
*
* Edit only here to tune passing behaviour — no weights are hardcoded in
* PassLanes.ts or anywhere else in the engine.
*
* Source of truth: .claude/rules/game-engine/pass.md
*/
const PASS_CONFIG = {
	/** Minimum total score a candidate must reach to be considered a good pass. */
	MIN_PASS_SCORE: .39,
	PROGRESS_WEIGHT: .3,
	LANE_WEIGHT: .26,
	RECEIVER_SPACE_WEIGHT: .18,
	DISTANCE_PENALTY_WEIGHT: .13,
	GOAL_PROXIMITY_WEIGHT: .26,
	PASSING_SKILL_WEIGHT: .15,
	VISION_WEIGHT: .15,
	RECEIVER_CONTROL_WEIGHT: .1,
	WIDTH_PREFERENCE_WEIGHT: .15,
	/** Yards — a pass this far or longer gets the maximum distance penalty. */
	MAX_PASS_DISTANCE: 50,
	/**
	* Yards — perpendicular clearance at which a lane is fully open.
	* Below BLOCK_RADIUS → blocked; above CLEAR_RADIUS → fully open.
	*/
	BLOCK_RADIUS: 3,
	CLEAR_RADIUS: 7,
	/** Yards — opponents within this radius around the receiver count as pressure. */
	RECEIVER_SPACE_RADIUS: 8,
	/**
	* Soft horizon for the goal-proximity score. Replaces the old hard cliff at
	* `PITCH_LENGTH/3`. Inside this distance a quadratic ramp rewards proximity
	* to goal; beyond it the bonus is 0. Wider value = softer cliff.
	*
	* 55 yds reaches roughly the halfway-line area when shooting at the far goal,
	* so a pass into space at x=74 (Team A) — previously zero-credited — now gets
	* partial goal threat. See `getGoalProximityBonus` in PassLanes.ts and
	* `goalThreatScore` in ThroughBallCells.ts.
	*/
	GOAL_PROXIMITY_HORIZON: 55,
	/**
	* Exponent for proportional target selection in startPass().
	* Scores are raised to this power before weighted random roll.
	* Higher = stronger bias toward the top lane; lower = more even distribution.
	* 3 → [0.9,0.4,0.3] gives ~89/8/3%; [0.9,0.8,0.7] gives ~46/32/22%.
	*/
	PASS_SELECTION_EXPONENT: 3
};
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/CarryConfig.ts
/**
* CarryConfig — all tunable weights and thresholds for carry lane evaluation.
*
* Edit only here to tune carry behaviour — no weights are hardcoded in
* DecisionTree.ts or anywhere else in the engine.
*/
const CARRY_CONFIG = {
	/** Yards ahead along the lane direction used for target crowding check. */
	LOOKAHEAD_DISTANCE: 10,
	/** Radius around the lane target position in which opponents count as crowding. */
	TARGET_CROWD_RADIUS: 8,
	/** Minimum total score a lane must reach for a carry to be chosen over a pass. */
	MIN_TOTAL_SCORE: .45,
	CLEARANCE_WEIGHT: .4,
	PROGRESS_WEIGHT: .35,
	ANGLE_WEIGHT: .15,
	CROWD_PENALTY_WEIGHT: .3,
	ROLE_BIAS_WEIGHT: .1,
	VISION_WEIGHT: .14,
	HARD_PRESSURE_DISTANCE: 4,
	MEDIUM_PRESSURE_DISTANCE: 8,
	HARD_PRESSURE_PENALTY: .4,
	MEDIUM_PRESSURE_PENALTY: .18,
	/** Maximum total pressure penalty (capped so stacking doesn't fully zero score). */
	MAX_PRESSURE_PENALTY: .65,
	/** Fraction by which high vision reduces the crowd penalty. */
	VISION_CROWD_REDUCTION: .25,
	/**
	* Score deducted per yard the projected lane target is outside the player's
	* role bounds. Penalises a CM carrying to 95 yds without hard-stopping them.
	* Clear-run-on-goal bypasses this — score is forced to 1.0 separately.
	*/
	ROLE_FIT_PENALTY_SCALE: .05,
	/** Yards from the end line at which forward carry score starts decaying. */
	BYLINE_PENALTY_START: 10,
	/**
	* Maximum score penalty applied to a perfectly forward lane at the end line.
	* Lateral lanes (cross, cutback) are unaffected — only the forward component is penalised.
	*/
	BYLINE_MAX_PENALTY: .8,
	/**
	* Lateral corridor width in yards. An outfield defender within this lateral
	* distance of the carrier — and ahead of them — blocks a clear run on goal.
	* Only the GK is allowed ahead without triggering a block.
	*/
	CLEAR_RUN_CORRIDOR: 14,
	/**
	* Number of grid rows on each side of the carrier's row to include in the
	* forward path scan. Total scanned band = 2 × FORWARD_PATH_ROW_BAND + 1 rows.
	* With CELL_H ≈ 1.85 yd at 64×40 resolution, a band of 4 ≈ ±7.5 yd vertical
	* corridor — covers a defender directly ahead plus immediate channel mates.
	*/
	FORWARD_PATH_ROW_BAND: 4,
	/**
	* Defending-team density (sum across forward corridor cells) at which the
	* forward path is considered fully blocked → clearness = 0.
	*
	* One defender's full footprint sums to 4×2 + 12×1 + 20×0.5 = 30. When the
	* footprint sits entirely inside the scanned corridor, it contributes ~30 to
	* the density. Saturating at 30 means a single well-aligned defender fully
	* blocks the path; a defender at the edge of the corridor only contributes
	* the slice that overlaps, so partial blockers correctly produce a partial
	* clearness value rather than an all-or-nothing flip.
	*/
	PATH_DENSITY_SATURATION: 30
};
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/AttackConfig.ts
/**
* How far (in yards) each role pushes forward as a function of possession time.
* Effect ramps quadratically from 0 → MAX_YARDS over BASE_SECONDS.
* GK/forwards have zero bias — they're already in their target zone.
*/
const POSSESSION_PUSH_UP = {
	/** Game-seconds to reach full push-up effect (linear ramp). */
	BASE_SECONDS: 10,
	/** Maximum yards of forward shift at full effect. */
	MAX_YARDS: 28
};
/** Per-role forward push-up bias (0 = no push, 1 = full MAX_YARDS). */
const PUSH_UP_ROLE_BIAS = {
	GK: 0,
	CB: .9,
	LB: .8,
	RB: .8,
	LWB: .65,
	RWB: .65,
	CDM: .6,
	CM: .5,
	LM: .4,
	RM: .4,
	CAM: .2,
	LW: .08,
	RW: .08,
	ST: 0,
	CF: 0
};
const ATTACK_CONFIG = {
	/** 0..1 — how wide the team stretches when attacking. */
	ATTACK_WIDTH: .6,
	/** Yards — optimal spacing between support players. */
	SUPPORT_DISTANCE: 12,
	/** 0..1 — frequency of forward attacking runs (future use). */
	RUN_FREQUENCY: .4,
	/** 0..1 — how freely players move away from their formation anchor. */
	POSITIONAL_FREEDOM: .5,
	/** 0..1 — how strongly nearby players drift toward the ball to create support. */
	BALL_INFLUENCE_WEIGHT: .6,
	/** 0..1 — how strongly players push away from close teammates to maintain spacing. */
	SPACING_WEIGHT: .3,
	/** 0..1 — how well attackers correct their position to stay onside (1 = perfect, 0 = oblivious). */
	OFFSIDE_AWARENESS: .85,
	/** Yards — how far behind the offside line attackers aim to sit (small = aggressive, large = safe). */
	OFFSIDE_MARGIN: 1
};
const PASS_WEIGHT_DEFAULTS = {
	PROGRESS_WEIGHT: PASS_CONFIG.PROGRESS_WEIGHT,
	LANE_WEIGHT: PASS_CONFIG.LANE_WEIGHT,
	RECEIVER_SPACE_WEIGHT: PASS_CONFIG.RECEIVER_SPACE_WEIGHT,
	DISTANCE_PENALTY_WEIGHT: PASS_CONFIG.DISTANCE_PENALTY_WEIGHT,
	GOAL_PROXIMITY_WEIGHT: PASS_CONFIG.GOAL_PROXIMITY_WEIGHT,
	MIN_PASS_SCORE: PASS_CONFIG.MIN_PASS_SCORE
};
({ ...PASS_WEIGHT_DEFAULTS });
const TEAM_PASS_WEIGHTS = {
	A: { ...PASS_WEIGHT_DEFAULTS },
	B: { ...PASS_WEIGHT_DEFAULTS }
};
/**
* Returns the full pass scoring config for the given team.
* Spatial constants (BLOCK_RADIUS, CLEAR_RADIUS, etc.) are never overridden.
*/
function getTeamPassConfig(team) {
	return {
		...PASS_CONFIG,
		...TEAM_PASS_WEIGHTS[team]
	};
}
const CARRY_WEIGHT_DEFAULTS = {
	CLEARANCE_WEIGHT: CARRY_CONFIG.CLEARANCE_WEIGHT,
	PROGRESS_WEIGHT: CARRY_CONFIG.PROGRESS_WEIGHT,
	ANGLE_WEIGHT: CARRY_CONFIG.ANGLE_WEIGHT,
	CROWD_PENALTY_WEIGHT: CARRY_CONFIG.CROWD_PENALTY_WEIGHT,
	MIN_TOTAL_SCORE: CARRY_CONFIG.MIN_TOTAL_SCORE
};
({ ...CARRY_WEIGHT_DEFAULTS });
const TEAM_CARRY_WEIGHTS = {
	A: { ...CARRY_WEIGHT_DEFAULTS },
	B: { ...CARRY_WEIGHT_DEFAULTS }
};
/** Returns the full carry config for the given team (CARRY_CONFIG + per-team lane weight overrides). */
function getTeamCarryConfig(team) {
	return {
		...CARRY_CONFIG,
		...TEAM_CARRY_WEIGHTS[team]
	};
}
ATTACK_CONFIG.ATTACK_WIDTH, ATTACK_CONFIG.ATTACK_WIDTH;
const TEAM_BUILD_UP = {
	A: "balanced",
	B: "balanced"
};
const TEAM_WIDTH = {
	A: "normal",
	B: "normal"
};
/**
* The user-facing TacticalStyle currently active for each team.
* Stored alongside the derived axes so detectors (e.g. IntentDetection) can
* gate behaviour on the high-level style without re-deriving it.
*/
const TEAM_TACTICAL_STYLE = {
	A: "balanced",
	B: "balanced"
};
/** Returns the current build_up tactic name for the given team. */
function getTeamBuildUp(team) {
	return TEAM_BUILD_UP[team];
}
/** Returns the current width tactic name for the given team. */
function getTeamWidth(team) {
	return TEAM_WIDTH[team];
}
/** Returns the user-facing tactical style currently active for the given team. */
function getTeamTacticalStyle(team) {
	return TEAM_TACTICAL_STYLE[team];
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/IntentConfig.ts
const NO_EFFECT = {};
/**
* The intent registry.
*
* counter_attack — OFFENSIVE intent. Bias long forward passes, forward carries,
*   and forward runs. Boost PROGRESS, tolerate longer DISTANCE, accept tighter
*   LANE. Carry leans on PROGRESS over CLEARANCE. Off-ball strongly biases
*   make_run over offer_support and hold_space. Tiny shoot bonus to keep
*   behaviour predictable (no forced shooting). No defensive effects — defense
*   has its own intents (hold_shape / press_now).
*
* switch_play — OFFENSIVE intent. Soft bias toward switching the ball to the far
*   side. Damps the holder's forward carry pull (PROGRESS / ANGLE multipliers
*   below 1) and injects an additive far_flank carry lane so a lateral move
*   across the pitch becomes a real option. On the pass side, a far_flank target
*   bias rewards switching to the opposite wide channel. Because it is additive
*   and soft, a genuinely wide-open forward lane can still outscore the switch.
*
* hold_shape — DEFENSIVE intent. Default defending state for the counter_attack
*   tactic. The static low_block tactic already produces the right base shape;
*   this intent currently has no overrides and exists as a named slot so that
*   future iterations can layer on stricter shape behaviour (e.g. tighter
*   compactness, deeper line) without introducing a new intent value.
*
* press_now — DEFENSIVE intent. Upgrade pressing to high_press. Fires when
*   the team is defending, attackers have progressed into our half, and we
*   have a structured defense with numerical advantage. Commits the team to
*   hunting the ball back instead of holding shape.
*/
const INTENT_EFFECTS = {
	balanced: NO_EFFECT,
	counter_attack: {
		pass: {
			PROGRESS_WEIGHT: 2.2,
			DISTANCE_PENALTY_WEIGHT: .4,
			LANE_WEIGHT: .8
		},
		carry: {
			PROGRESS_WEIGHT: .7,
			CLEARANCE_WEIGHT: .7,
			ANGLE_WEIGHT: .7,
			CROWD_PENALTY_WEIGHT: 1.3,
			MIN_TOTAL_SCORE: 1.4
		},
		shoot: { scoreBonus: .05 },
		offBall: {
			make_run: 1.4,
			hold_space: .8,
			offer_support: .8
		}
	},
	switch_play: {
		carry: {
			PROGRESS_WEIGHT: .5,
			ANGLE_WEIGHT: .5
		},
		carryLanes: [{
			dir: "far_flank",
			scoreBonus: .4
		}],
		passTarget: {
			kind: "far_flank",
			weight: .6
		}
	},
	hold_shape: NO_EFFECT,
	press_now: { defense: { pressingStyleOverride: "high_press" } }
};
/** Returns the registered effects for the given intent (or a frozen empty object). */
function getIntentEffects(intent) {
	return INTENT_EFFECTS[intent] ?? NO_EFFECT;
}
/**
* Apply pass-multiplier overrides on top of the team's tactic weights.
* Returns a new object — never mutates the input.
*/
function applyPassIntent(weights, intent) {
	const mults = getIntentEffects(intent).pass;
	if (!mults) return weights;
	const out = { ...weights };
	for (const [k, mult] of Object.entries(mults)) out[k] = out[k] * mult;
	return out;
}
/**
* Apply carry-multiplier overrides on top of the team's tactic weights.
* Returns a new object — never mutates the input.
*/
function applyCarryIntent(weights, intent) {
	const mults = getIntentEffects(intent).carry;
	if (!mults) return weights;
	const out = { ...weights };
	for (const [k, mult] of Object.entries(mults)) out[k] = out[k] * mult;
	return out;
}
/**
* Apply off-ball multiplier overrides to a per-intent score map.
* Returns a new object — never mutates the input.
*/
function applyOffBallIntent(scores, intent) {
	const mults = getIntentEffects(intent).offBall;
	if (!mults) return scores;
	const out = { ...scores };
	for (const [k, mult] of Object.entries(mults)) out[k] = out[k] * mult;
	return out;
}
/** Returns the flat shoot bonus for the given intent (0 when none). */
function getShootIntentBonus(intent) {
	return getIntentEffects(intent).shoot?.scoreBonus ?? 0;
}
/**
* Returns the extra carry lanes the intent requests (empty when none).
* Consumed generically by getBestCarryLane — it resolves each `dir` into an
* actual lane vector and adds the lane's `scoreBonus` to its score.
*/
function getExtraCarryLanes(intent) {
	return getIntentEffects(intent).carryLanes ?? [];
}
/**
* Returns the intent's directional pass-target bias, or null when none.
* Consumed generically by PassLanes — it adds `weight × regionMatch` to the
* pass score for receivers in the named region.
*/
function getPassTargetBias(intent) {
	return getIntentEffects(intent).passTarget ?? null;
}
/**
* Returns the intent's pressing-style override, or null when none.
* Caller is responsible for applying it only in defending contexts —
* the override has no meaning when the team has the ball.
*/
function getPressingStyleOverride(intent) {
	return getIntentEffects(intent).defense?.pressingStyleOverride ?? null;
}
/** Centre line X for engine coordinates (halfway between goal lines). */
const PITCH_MID_X = 115 / 2;
/** True when (x, y) is inside the penalty area defended by `ownGoalX` (0 or PITCH_LENGTH). */
function isInGoalScoreArea(x, y, ownGoalX) {
	if (Math.abs(x - ownGoalX) > 18) return false;
	if (y < 15 || y > 59) return false;
	return true;
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/FormationSlots.ts
/**
* Compute the absolute field position for a player's formation slot in the given phase.
*
* Uses `attackDir` (not `team`) so the result is correct both at match start and after
* half-time side switching (when Team A's attackDir becomes -1).
*
* @param slotIndex  The player's stable slot index (0–10).
* @param attackDir  +1 = attacks toward x=115 (left-to-right); -1 = right-to-left.
* @param formation  The formation containing attacking and defending slot arrays.
* @param phase      Which shape to use.
*/
function resolveBasePosition(slotIndex, attackDir, formation, phase) {
	const slot = (phase === "attacking" ? formation.attacking : formation.defending)[slotIndex];
	if (!slot) return {
		x: 57,
		y: 37
	};
	return attackDir === -1 ? {
		x: 115 - slot.x,
		y: slot.y
	} : {
		x: slot.x,
		y: slot.y
	};
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/DefenseConfig.ts
const DEFAULTS = {
	/** 0..1 — how deep the team defends. 0 = own box, 1 = high line. */
	DEFENSIVE_LINE_HEIGHT: .5,
	/** 0..1 — how far up the field players trigger pressing shape. */
	PRESSING_LINE_HEIGHT: .55,
	/** 0..1 — how much the block narrows toward the pitch center Y when defending. */
	HORIZONTAL_COMPACTNESS: .6,
	/** 0..1 — how tightly the defensive lines stack vertically. */
	VERTICAL_COMPACTNESS: .6,
	/** 0..1 — probability modifier for step-out pressing (applied in DecisionTree). */
	PRESS_INTENSITY: .5,
	/** Yds/s — max speed burst from acceleration when actively pressing (scales by 0..1 accel). */
	PRESS_ACCEL_SPEED_BOOST: .8,
	/** 0..1 — aggression level for tackle attempts (applied in DecisionTree). */
	TACKLE_AGGRESSION: .4,
	/** 0..1 — how strongly the block follows the ball's lateral (Y) position. */
	BLOCK_SHIFT_WEIGHT: .8,
	/** 0..1 — how much defenders shift X toward blocking central passing lanes. */
	LANE_BLOCK_WEIGHT: .4,
	/** 0..1 — max pull strength toward mark when threat is highest (opponent near own goal). */
	MARK_PULL_MAX: .9,
	/** 0..1 — min pull strength toward mark when threat is lowest (opponent far from goal). */
	MARK_PULL_MIN: .3,
	/** 0..1 — where on the ball→mark lane to position when threat is high (1 = at the mark). */
	MARK_LANE_T_CLOSE: .75,
	/** 0..1 — where on the ball→mark lane to position when threat is low (0 = at the ball). */
	MARK_LANE_T_FAR: .3,
	/** Yards from own goal at which threat reaches 0. */
	THREAT_HORIZON: 100
};
const TEAM_CONFIGS = {
	A: { ...DEFAULTS },
	B: { ...DEFAULTS }
};
/** Stores the raw tactic key strings for each team so intent selection can look them up. */
const TEAM_TACTIC_KEYS = {
	A: {
		pressingStyle: "mid_block",
		defensiveLine: "normal"
	},
	B: {
		pressingStyle: "mid_block",
		defensiveLine: "normal"
	}
};
/** Returns the raw tactic key strings for intent multiplier lookup. */
function getDefenseTacticKeys(team) {
	return TEAM_TACTIC_KEYS[team];
}
/** Returns the defensive config for the given team. */
function getDefenseConfig(team) {
	return TEAM_CONFIGS[team];
}
TEAM_CONFIGS.A;
let enabled = false;
function isDebugEnabled() {
	return enabled;
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Infrastructure/EventBus.ts
var TypedEventBus = class {
	listeners = /* @__PURE__ */ new Map();
	on(event, fn) {
		if (!this.listeners.has(event)) this.listeners.set(event, /* @__PURE__ */ new Set());
		this.listeners.get(event).add(fn);
		return () => this.listeners.get(event)?.delete(fn);
	}
	emit(event, payload) {
		this.listeners.get(event)?.forEach((fn) => fn(payload));
	}
};
/**
* Singleton bus shared across the entire app.
* No React, no Pixi — any layer can import and use this.
*/
const gameBus = new TypedEventBus();
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/DefensiveIntentConfig.ts
const INTENT_PRESSING_STYLE = {
	low_block: {
		hold_shape: 1.4,
		track_mark: 1.2,
		press_holder: .3,
		step_into_carry_lane: .6
	},
	mid_block: {
		hold_shape: 1,
		track_mark: 1,
		press_holder: 1,
		step_into_carry_lane: 1
	},
	high_press: {
		hold_shape: .5,
		track_mark: .8,
		press_holder: 1.8,
		step_into_carry_lane: 1.2
	}
};
const INTENT_DEFENSIVE_LINE = {
	deep: {
		hold_shape: 1.3,
		track_mark: 1.2,
		press_holder: .6,
		step_into_carry_lane: 1.1
	},
	normal: {
		hold_shape: 1,
		track_mark: 1,
		press_holder: 1,
		step_into_carry_lane: 1
	},
	high: {
		hold_shape: .7,
		track_mark: .9,
		press_holder: 1.4,
		step_into_carry_lane: .9
	}
};
const DEFENSIVE_INTENT_CONFIG = {
	/**
	* Lateral distance used to decide if the ball carrier is in this defender's
	* general zone — drives holderInMyCorridor and the step_into_carry_lane penalty.
	* Wide enough to cover a defender's zone of responsibility (~1.5 pitch lanes).
	*/
	CORRIDOR_HALF_WIDTH: 12,
	/**
	* Narrower threshold for isBlockingCarryLane — the defender must be literally
	* in the carry path (goal-side AND laterally close) to hand off from
	* step_into_carry_lane to press_holder.
	*/
	CARRY_BLOCK_WIDTH: 6,
	CARRY_LANE_LOOKAHEAD: 15,
	PRESS_SCORE_THRESHOLD: .35,
	/**
	* Within this distance a defender presses regardless of mark assignment.
	* Prevents abandoning a chase when already right next to the ball holder
	* due to the greedy mark-reassignment algorithm stealing the "holder is my mark"
	* condition mid-pursuit.
	*/
	OPPORTUNISTIC_PRESS_RANGE: 6,
	/**
	* At full patience (patienceT=1), the opportunistic press range grows by this
	* many yards, letting more defenders become eligible to press even when the
	* holder isn't their assigned mark.
	* effectiveRange = OPPORTUNISTIC_PRESS_RANGE + patienceT² × this
	*/
	PATIENCE_OPPORTUNISTIC_BONUS: 20,
	/**
	* Patience effects (press boost, shape penalty, opportunistic range expansion)
	* fade linearly to zero at this distance from the ball holder.
	* Defenders beyond this radius keep their shape regardless of how long the
	* opponent has held the ball.
	*/
	PATIENCE_INFLUENCE_RADIUS: 25,
	/**
	* Press catchability falloff distance (yards). When the defender's projection
	* onto the holder→goal axis is this many yards BEHIND the holder, press_holder
	* eligibility falls to PRESS_CATCHABILITY_FLOOR. Defenders ahead of the holder
	* (positive projection) keep full eligibility — they can intercept the path.
	* Defenders behind cannot catch a forward-moving carrier and shouldn't press.
	*/
	PRESS_CATCHABILITY_FALLOFF: 5,
	/** Floor multiplier for defenders far behind the holder along the progression axis. */
	PRESS_CATCHABILITY_FLOOR: .1
};
/**
* Possession patience — how long the defending team tolerates the opponent holding
* the ball before time-pressure boosts pressing and erodes hold_shape.
*
* The influence ramps as t² (quadratic), so the effect is slow to start and
* accelerates the longer possession goes on. The existing intent scores already
* encode how dangerous the situation is — a high hold_shape score will naturally
* resist the time boost longer than a weak one.
*/
const POSSESSION_PATIENCE = {
	/** Seconds until the quadratic ramp reaches t=1 (full effect). */
	BASE_SECONDS: 15,
	/** Maximum boost applied to press_holder score at t=1. */
	PRESS_BOOST_MAX: .8,
	/** Maximum reduction applied to hold_shape score at t=1. */
	SHAPE_PENALTY_MAX: .4
};
/**
* Press intent: small role/tactic weights need a modest scale to matter vs track_mark.
* Keep INTENT_SCALE low enough that track_mark / carry_lane can still win.
*/
const PRESS_HOLDER_SCORING = {
	/** Weak at outer edge of press range — must close distance for a strong press score. */
	DISTANCE_AT_EDGE: .12,
	DISTANCE_ON_HOLDER: 1,
	/** Brings press into same ballpark as other intents (order of magnitude ~1–8). */
	INTENT_SCALE: 2
};
/**
* Crowd-grid driven defensive adjustments.
*
* Two signals from the per-tick crowd grid power these:
*  • pressLoad        — defending team density sampled around the ball holder.
*                       High = swarm forming; cap who else commits to pressing.
*  • markIsolation    — 1 minus attacking team density around an opponent.
*                       High = lone attacker; mark them — they're a real threat.
*  • markDangerScore  — markIsolation × markThreat (0..1).
*                       Drives both track_mark score boost and assignment discount.
*/
const CROWD_AWARE_DEFENSE = {
	/**
	* Pressers above this 3×3 crowd-sample value (≈ 1.5 defenders near holder)
	* trigger damping for further-away defenders. The closest one keeps full
	* score regardless — there must always be at least one presser.
	*/
	PRESS_SAT_THRESHOLD: 25,
	/** Approx 3×3 crowd contribution per nearby player — used to convert sample → count. */
	PRESS_SAT_PER_PLAYER: 17,
	/** Per excess defender, max fraction of press_holder/step score removed (at full distance). */
	PRESS_SAT_DAMP_PER: .4,
	/** Floor multiplier — even fully oversaturated and far away, score keeps this much. */
	PRESS_SAT_FLOOR: .2,
	/** Radius (yds) within which a teammate can contribute to press load. */
	PRESS_LOAD_RADIUS: 8,
	/** Yards goal-side of the holder at which along-goal effectiveness saturates to 1. */
	PRESS_LOAD_ALONG_FULL: 6,
	/** Yards perpendicular to the holder→own-goal line at which effectiveness drops to 0. */
	PRESS_LOAD_LATERAL_RANGE: 8,
	/**
	* Score added by a single perfectly-effective presser at point-blank range.
	* Calibrated to match PRESS_SAT_PER_PLAYER so PRESS_SAT_THRESHOLD keeps its meaning.
	*/
	PRESS_LOAD_PER_PLAYER: 17,
	/** Max boost added to track_mark score for a fully dangerous + isolated mark. */
	MARK_DANGER_BOOST_MAX: .5,
	/**
	* Below this attacker-crowd "extra" value (over self ≈ 17), the mark is
	* considered fully isolated. At 1.5× this value the mark is fully crowded.
	*/
	ISOLATION_FULL_RANGE: 25,
	/**
	* Squared-yards of cost reduction at full danger (markDangerScore = 1).
	* Equivalent to a defender being able to be ~9 yds farther from a
	* dangerous opponent and still preferring them over a safer closer one.
	*/
	ASSIGN_DANGER_DISCOUNT: 80
};
/** Score added to each cell of the 6×6 ring around the mid ring. */
const SCORE_OUTER = .5;
const CELL_W = 115 / 64;
const CELL_H = 74 / 40;
function createMatrix() {
	const m = new Array(40);
	for (let r = 0; r < 40; r++) m[r] = new Array(64).fill(0);
	return m;
}
function getCellIndex(x, y) {
	return {
		col: Math.max(0, Math.min(63, Math.floor(x / CELL_W))),
		row: Math.max(0, Math.min(39, Math.floor(y / CELL_H)))
	};
}
/**
* Top-left corner of the 2×2 core for a player at (x, y). The core is
* positioned so the grid intersection at the centre of the 2×2 sits as close
* as possible to the player's actual position — keeps the heat blob
* symmetrical regardless of where in a cell the player stands.
*
* Anchor cells are NOT clamped here — `applyInfluence` filters out-of-bounds
* cells per-step, so partial footprints near the touchline still draw the
* portion of the blob that falls inside the pitch.
*/
function getInfluenceAnchor(x, y) {
	return {
		col: Math.round(x / CELL_W) - 1,
		row: Math.round(y / CELL_H) - 1
	};
}
/**
* Apply a player's concentric footprint to `grid`, anchored on the 2×2 whose
* top-left cell is (anchorCol, anchorRow). Cells outside the grid are skipped.
*
* Layout:
*   dr / dc ∈ [ 0,  1] → core   (+SCORE_CORE)
*   dr / dc ∈ [-1,  2] → mid    (+SCORE_MID)   — minus the core square
*   dr / dc ∈ [-2,  3] → outer  (+SCORE_OUTER) — minus the mid square
*/
function applyInfluence(grid, anchorCol, anchorRow) {
	for (let dr = -2; dr <= 3; dr++) for (let dc = -2; dc <= 3; dc++) {
		const r = anchorRow + dr;
		const c = anchorCol + dc;
		if (r < 0 || r >= 40 || c < 0 || c >= 64) continue;
		const v = dr >= 0 && dr <= 1 && dc >= 0 && dc <= 1 ? 2 : dr >= -1 && dr <= 2 && dc >= -1 && dc <= 2 ? 1 : SCORE_OUTER;
		grid[r][c] += v;
	}
}
function computeCrowdGrid(state) {
	const teamA = createMatrix();
	const teamB = createMatrix();
	const teamAOutfield = createMatrix();
	const teamBOutfield = createMatrix();
	for (const p of state.players) {
		const { col, row } = getInfluenceAnchor(p.x, p.y);
		if (p.team === "A") {
			applyInfluence(teamA, col, row);
			if (p.role !== "GK") applyInfluence(teamAOutfield, col, row);
		} else {
			applyInfluence(teamB, col, row);
			if (p.role !== "GK") applyInfluence(teamBOutfield, col, row);
		}
	}
	const crowd = createMatrix();
	for (let r = 0; r < 40; r++) for (let c = 0; c < 64; c++) crowd[r][c] = teamA[r][c] + teamB[r][c];
	return {
		teamA,
		teamB,
		crowd,
		teamAOutfield,
		teamBOutfield
	};
}
/**
* Sum density inside a `(2·radius + 1)²` cell window around (x, y).
*
* One player contributes ≈ 17 to a 3×3 sample taken at their own position
* (8 from the 2×2 core overlapped + ~9 from mid ring). So `sampleCellSum / 17`
* approximates the count of nearby players regardless of subcell offset.
*/
function sampleCellSum(grid, x, y, radius = 1) {
	const { col, row } = getCellIndex(x, y);
	let total = 0;
	for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
		const r = row + dr, c = col + dc;
		if (r < 0 || r >= 40 || c < 0 || c >= 64) continue;
		total += grid[r][c];
	}
	return total;
}
/**
* Exact contribution that a player at (selfX, selfY) makes to a `(2·radius+1)²`
* cell window centred on (sampleX, sampleY). Computed by intersecting the
* sample window with the player's 6×6 concentric footprint — cells outside
* the footprint contribute 0; otherwise they contribute the matching ring
* score (CORE / MID / OUTER).
*
* Use when a player is sampling a grid they themselves contribute to (own
* teammate density, own pressing load) — subtracting this value gives the
* "everyone else" density. O(radius²) per call.
*/
function selfFootprintContribution(sampleX, sampleY, selfX, selfY, radius = 1) {
	const { col: sCol, row: sRow } = getCellIndex(sampleX, sampleY);
	const { col: aCol, row: aRow } = getInfluenceAnchor(selfX, selfY);
	let total = 0;
	for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
		const r = sRow + dr;
		const c = sCol + dc;
		if (r < 0 || r >= 40 || c < 0 || c >= 64) continue;
		const drP = r - aRow;
		const dcP = c - aCol;
		if (drP < -2 || drP > 3 || dcP < -2 || dcP > 3) continue;
		total += drP >= 0 && drP <= 1 && dcP >= 0 && dcP <= 1 ? 2 : drP >= -1 && drP <= 2 && dcP >= -1 && dcP <= 2 ? 1 : SCORE_OUTER;
	}
	return total;
}
/**
* Like `sampleCellSum` but subtracts the contribution of the player at
* (selfX, selfY). The result is clamped at 0 to guard against rounding.
*
* Use when a player is evaluating grid density for itself (e.g. an off-ball
* runner sampling teammate density to decide where to move) so the player's
* own footprint doesn't inflate the "crowding" signal.
*/
function sampleCellSumExcluding(grid, sampleX, sampleY, selfX, selfY, radius = 1) {
	const sum = sampleCellSum(grid, sampleX, sampleY, radius);
	const self = selfFootprintContribution(sampleX, sampleY, selfX, selfY, radius);
	return Math.max(0, sum - self);
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/PositionalAwareness.ts
/**
* PositionalAwareness — spatial relationship utilities.
*
* Pure math functions that compute relative positions between players, the ball,
* and pass lines. No state, no side effects.
*
* These helpers are the foundation for:
*   • Tackle success modifiers (front / side / behind)
*   • Interception eligibility (defender between ball and receiver)
*   • Carry vs pass pressure detection
*   • Marking behaviour (future)
*   • Defensive positioning (future)
*
* Used by: ActionOutcomes.ts, gameState.ts
*/
/**
* Delta to add to a base tackle chance based on the tackler's approach angle
* relative to the holder's direction of progress.
*
* "Forward" for the holder is the direction toward the **opponent's goal**, not
* the team-wide attackDir constant. This matters when the holder is near a
* corner or on the goal line — the goal can be to the side (or even behind in
* pure x-axis terms), but it's still where they want to progress. A tackler
* approaching from "behind in x" can actually be on the side of the holder's
* real progression line.
*
* A defender positioned in **front** of the attacker has a positional advantage
* (facing them, in their path) → success bonus.
* A defender coming from **behind** is a desperate lunge → success penalty.
*
* Modifiers:
*   front  → +0.30
*   side   → +0.10
*   behind → −0.30
*/
function tackleAngleModifier(tackler, holder) {
	const goalX = holder.attackDir === 1 ? 115 : 0;
	const goalY = 37;
	const fx = goalX - holder.x;
	const fy = goalY - holder.y;
	const fLen = Math.hypot(fx, fy);
	const forwardX = fLen > .001 ? fx / fLen : holder.attackDir;
	const forwardY = fLen > .001 ? fy / fLen : 0;
	const tx = tackler.x - holder.x;
	const ty = tackler.y - holder.y;
	const tLen = Math.hypot(tx, ty);
	if (tLen < .01) return .3;
	const dot = tx / tLen * forwardX + ty / tLen * forwardY;
	if (dot > .5) return .3;
	if (dot < -.5) return -.3;
	return .1;
}
/**
* Return true when a defender is in a geometrically valid position to intercept
* a pass in flight.
*
* Conditions (all must hold):
*   1. Projection `t` onto the pass segment is between 0.05 and 0.95 — defender
*      is ahead of the ball and has not overrun the receiver.
*   2. Perpendicular distance from defender to the pass line is ≤ INTERCEPTION_CORRIDOR.
*
* This prevents unrealistic interceptions where a defender behind the receiver,
* or wide of the line, steals the ball.
*
* @param defender  The player attempting the interception.
* @param ballPos   Current ball position on the pass line (0 = passer, 1 = receiver).
* @param receiver  The intended pass target.
*/
/**
* Returns the perpendicular distance (yards) from the defender to the pass line
* if the interception geometry is valid, or `null` if out of position.
*
* @param corridor  Player's effective interception corridor (yards) — computed by
*                  `playerInterceptionCorridor()` in ActionOutcomes.ts.
*/
function getInterceptionPerpDist(defender, ballPos, receiver, corridor) {
	const vx = receiver.x - ballPos.x;
	const vy = receiver.y - ballPos.y;
	const lenSq = vx * vx + vy * vy;
	if (lenSq < .01) return null;
	const ox = defender.x - ballPos.x;
	const oy = defender.y - ballPos.y;
	const t = (ox * vx + oy * vy) / lenSq;
	if (t < .05 || t > .95) return null;
	const nearX = ballPos.x + t * vx;
	const nearY = ballPos.y + t * vy;
	const perpDist = Math.sqrt((defender.x - nearX) ** 2 + (defender.y - nearY) ** 2);
	return perpDist <= corridor ? perpDist : null;
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Infrastructure/ActionOutcomes.ts
const TACKLE_COOLDOWN = 1.2;
/** Acceleration burst multiplier for a carrier being pressed — mirrors PRESS_ACCEL_SPEED_BOOST. */
const CARRY_ACCEL_SPEED_BOOST = .8;
/**
* Compute the effective interception corridor (yards) for a specific player.
* Faster and more explosive players can cover more ground to reach a passing lane.
*/
function playerInterceptionCorridor(player) {
	const { speed, acceleration } = player.runtimeStats.withoutBall;
	return 3 + speed * 2 + acceleration * 2;
}
/** Speed multiplier applied while a player is in recovery from any duel. */
const DUEL_RECOVERY_SPEED_FACTOR = .35;
const DUEL_TACKLE_WIN_RECOVERY = .3;
const DUEL_TACKLE_LOSS_RECOVERY = 1.5;
const DUEL_DRIBBLE_WIN_RECOVERY = .4;
/**
* Compute where a shot is aimed, given the shooter's accuracy.
* Higher accuracy → tighter spread toward the centre of the goal.
*/
function computeShotAim(shooter) {
	const { shootAccuracy } = shooter.runtimeStats.withBall;
	const toX = shooter.attackDir === 1 ? 115 : 0;
	const spread = 8 * (1 - shootAccuracy);
	const aimCenter = 37;
	const halfRange = 4 + spread;
	return {
		toX,
		toY: aimCenter + (Math.random() * 2 - 1) * halfRange
	};
}
/**
* Angle (radians) subtended by the goal posts from a given position.
* Used by computeXG and the scoring system to measure shot angle quality.
*/
function computeOpenAngle(sx, sy, goalX) {
	const ax = goalX - sx, ay = 33 - sy;
	const bx = goalX - sx, by = 41 - sy;
	const dot = ax * bx + ay * by;
	const cross = Math.abs(ax * by - ay * bx);
	return Math.atan2(cross, dot);
}
const MAX_OPEN_ANGLE = Math.PI / 4;
/**
* How much one "full-strength-matched" defender at 0 yards reduces xG.
* Calibrated so equal-strength, right-on-you → ~30% xG reduction.
* High-strength mismatch (10 vs 1) at 0 yards → ~60% reduction.
* Low-strength mismatch (1 vs 10) at 0 yards → ~2% reduction.
*/
const XG_PRESSURE_SCALE = .6;
/** Minimum pressureFactor — prevents xG dropping to absolute zero even under heavy press. */
const XG_PRESSURE_FLOOR = .1;
const SHOOTER_EFFECT_MIN = .85;
const SHOOTER_EFFECT_MAX = 1.2;
const GK_EFFECT_MIN = .55;
const GK_EFFECT_MAX = .9;
/** Minimum yards off the goal line (always slightly advanced). */
const GK_MIN_COME_OUT = .5;
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}
/**
* Compute pure spatial xG from position and weighted pressure.
* Does NOT include shooter or GK attributes — this is the true chance quality.
* Range: 0..1  (naturally bounded by the formula; no artificial cap).
*
* `pressure` is the weighted pressure from `computeWeightedPressure`, not a raw count.
*/
function computeXG(dist, openAngle, pressure) {
	const distFactor = Math.exp(-Math.pow(dist / 40, 10));
	const angleFactor = clamp(openAngle / MAX_OPEN_ANGLE, .2, 1);
	const pressureFactor = clamp(1 - pressure * XG_PRESSURE_SCALE, XG_PRESSURE_FLOOR, 1);
	return clamp(distFactor * angleFactor * pressureFactor, 0, 1);
}
/**
* Compute weighted pressure on a shooter from a list of nearby defenders.
*
* Each defender contributes based on:
*   - Distance: quadratic falloff from 0 yards (full) to XG_PRESS_RADIUS yards (zero).
*     Squaring the linear falloff makes close defenders much more threatening.
*   - Strength mismatch: defender.strength² / (defender.strength² + shooter.strength²).
*     Uses raw 0–10 values to exaggerate mismatches — a 10-str defender on a 1-str
*     shooter contributes ~99% while the reverse contributes ~1%.
*
* Reference points (XG_PRESSURE_SCALE = 0.6):
*   Equal strength (5v5) at 0 yards  → contribution 0.50 → pressureFactor 0.70 (30% drop)
*   Equal strength at 2 yards        → contribution 0.22 → pressureFactor 0.87 (13% drop)
*   Strong def (10) vs weak att (1) at 0 yards → contribution 0.99 → pressureFactor 0.41 (59% drop)
*   Weak def (1) vs strong att (10) at 0 yards → contribution 0.01 → pressureFactor 0.99 (~1% drop)
*   Two strong defs on weak att      → total ≈ 1.98 → clamp to floor 0.10
*/
function computeWeightedPressure(shooter, defenders) {
	const attStr = (shooter.runtimeStats.withBall.strength || .5) * 10;
	const attStr2 = attStr * attStr || .01;
	let total = 0;
	for (const def of defenders) {
		if (def.recoveryTime > 0) continue;
		const d = Math.hypot(def.x - shooter.x, def.y - shooter.y);
		if (d >= 5) continue;
		const linear = 1 - d / 5;
		const distFactor = linear * linear;
		const defStr = (def.runtimeStats.withoutBall.strength || .5) * 10;
		const defStr2 = defStr * defStr;
		const strengthRatio = defStr2 / (defStr2 + attStr2);
		total += distFactor * strengthRatio;
	}
	return total;
}
/**
* Shooter execution quality. Uses existing `shootAccuracy` (0..0.95) from TeamLineup.
* Maps to a multiplier: average finisher ~1.0, elite ~1.3, poor ~0.7.
*/
function computeShooterEffect(shooter) {
	return clamp(SHOOTER_EFFECT_MIN + shooter.runtimeStats.withBall.shootAccuracy * .35 / .95, SHOOTER_EFFECT_MIN, SHOOTER_EFFECT_MAX);
}
/**
* How well the GK is positioned on the ideal angle-bisector arc (0=poor, 1=perfect).
* The optimal position sits on the line from the goal centre toward the ball,
* at a come-out distance that scales with attacker proximity.
*/
function computeGKPositionQuality(gk, ballPos) {
	const goalX = gk.attackDir === 1 ? 0 : 115;
	const goalCenterY = 37;
	const dx = ballPos.x - goalX;
	const dy = ballPos.y - goalCenterY;
	const dist = Math.sqrt(dx * dx + dy * dy);
	if (dist < .01) return 1;
	const comeOut = GK_MIN_COME_OUT + 5.5 * Math.max(0, 1 - dist / 20);
	const optX = goalX + dx / dist * comeOut;
	const optY = goalCenterY + dy / dist * comeOut;
	const deviation = Math.hypot(gk.x - optX, gk.y - optY);
	return Math.max(0, 1 - deviation / 8);
}
/**
* GK quality multiplier. Closer shots emphasise reflex; far shots emphasise diving.
* Positioning is scaled by how close the GK is to the optimal angle-bisector arc.
* Returns a value in [GK_EFFECT_MIN, GK_EFFECT_MAX] that reduces goalChance.
*
* Weights sum to 1.0:
*   positioning (× arc quality): 0.50
*   reflex/diving (distance-blended): 0.50
*
* Max-stat GK perfectly on arc → gkSkill=1.0 → gkEffect=0.40 (GK_EFFECT_MIN).
*/
function computeGKEffect(gk, distToGoal, ballPos) {
	const closeWeight = clamp(1 - distToGoal / 20, 0, 1);
	const farWeight = 1 - closeWeight;
	const { gkPositioning, gkReflex, gkDiving } = gk.runtimeStats.withoutBall;
	return clamp(1 - (gkPositioning * computeGKPositionQuality(gk, ballPos) * .5 + (gkReflex * closeWeight + gkDiving * farWeight) * .5) * .45, GK_EFFECT_MIN, GK_EFFECT_MAX);
}
/**
* Resolve a shot outcome using xG × shooterEffect × gkEffect.
* Pass `gk = null` to skip GK resistance (no GK present).
*/
function resolveShot(shooter, gk, shot) {
	const inPosts = shot.toY >= 33 && shot.toY <= 41;
	if (!inPosts) return {
		isGoal: false,
		goalChance: 0,
		inPosts
	};
	const shooterEffect = computeShooterEffect(shooter);
	const gkEffect = gk ? computeGKEffect(gk, Math.hypot(shooter.x - shot.toX, shooter.y - shot.toY), {
		x: shooter.x,
		y: shooter.y
	}) : 1;
	const goalChance = clamp(shot.xg * shooterEffect * gkEffect * globalThis.__tpCal.goal_chance_scale, 0, 1);
	return {
		isGoal: Math.random() < goalChance,
		goalChance,
		inPosts
	};
}
/**
* Resolve a 1v1 dribble contest.
* Attacker has a slight initiative advantage (defender tackling scaled by 0.85).
* Dribbling stat affects resolution, NOT the decision to attempt.
*
* `pressingLoad` (0–1): nearby defenders (not the target) create crowd pressure that
* suppresses the attacker's effective dribbling, mirroring the tackle crowd effect.
* A strong carrier (strength=1) is immune; a weak one (strength=0) loses full dribbling
* protection at pressingLoad=1. Max effective dribbling reduction: 40%.
*/
function resolveDribble(attacker, defender, pressingLoad = 0) {
	const suppression = pressingLoad * (1 - (attacker.runtimeStats.withBall.strength ?? .5));
	const attackerScore = attacker.runtimeStats.withBall.dribbling * (1 - suppression);
	const winProb = attackerScore / (attackerScore + defender.runtimeStats.withoutBall.tackling * .85 + .001);
	return {
		attackerWins: Math.random() < winProb,
		winProb
	};
}
/**
* Resolve a contested loose-ball arrival — two opposing players reach the
* landing point near-simultaneously. This is NOT a tackle (no ball-at-feet
* angle modifiers, no role-fit) and NOT a dribble (no skill-vs-skill 1v1) —
* it's a 50/50 collision weighted by physical traits + arrival margin.
*
*   playerScore =
*       strength      × 0.40
*     + dribbling     × 0.25  // first-touch control on the contested ball
*     + acceleration  × 0.20
*     + arrivalBonus          // +0..0.10 for arriving cleaner
*     + 0.15                  // base parity
*
* Both participants enter brief recovery (handled by the caller).
*/
function resolveLooseBallDuel(a, b, arrivalGap) {
	const score = (p, distAdv) => {
		const wb = p.runtimeStats.withBall;
		const wnb = p.runtimeStats.withoutBall;
		const arrivalBonus = distAdv ? Math.max(0, .1 * (1 - Math.min(1, arrivalGap / 2))) : 0;
		return (wnb.strength ?? .5) * .4 + wb.dribbling * .25 + wnb.acceleration * .2 + arrivalBonus + .15;
	};
	const sA = score(a, true);
	const probA = sA / (sA + score(b, false) + .001);
	return {
		winnerId: Math.random() < probA ? a.id : b.id,
		probA
	};
}
/**
* Roll whether a tackle attempt succeeds based on the tackler's tackling stat,
* modified by their positional angle and relative physical strength.
*
* Base angle modifiers (equal strength):
*   front  → +0.30   (facing the attacker, in their path)
*   side   → +0.10   (shoulder challenge)
*   behind → −0.30   (desperate lunge from behind)
*
* Strength scaling (defender.strength vs holder.strength, both 0–1):
*   A stronger defender closes the gap between side/behind and the front bonus.
*   At maximum advantage (+1.0):
*     side   → +0.30  (debuff fully negated — brute-force shoulder challenge)
*     behind → −0.05  (barely a penalty — overpowers the carrier from behind)
*   At maximum disadvantage (−1.0):
*     side   → −0.10  (shoulder challenge vs stronger attacker backfires)
*     behind → −0.55  (desperate lunge against a powerful carrier)
*   Front is unaffected — position already gives full advantage.
*
* `pressingLoad` (0–1): additional defenders pressing nearby (not the tackler).
*   Has two independent effects on the holder, both mitigated by holder strength:
*
*   1. Suppresses dribbling resistance — holder can't focus on the 1v1 while bodies close in.
*        pressingLoad=1, strength=0 → dribbling fully suppressed (×0)
*        pressingLoad=1, strength=1 → no suppression
*
*   2. Boosts tackler's base+angle — crowd pressure directly improves the tackle attempt.
*        Max bonus: +0.20 at pressingLoad=1, strength=0
*        At strength=1: no bonus (strong carrier absorbs the crowd physically)
*
*   Reference (max-dribble holder, solo tackle vs crowd tackle):
*     Solo,  strength=0 → dribbleReduction=0.60, pressBonus=0   → chance ≈ base×0.60
*     Crowd, strength=0 → dribbleReduction=1.00, pressBonus=0.20 → chance ≈ (base+0.20)×1.00
*     Crowd, strength=1 → dribbleReduction=0.60, pressBonus=0   → same as solo (immune)
*/
function resolveTackle(tackler, holder, pressingLoad = 0) {
	const base = tackler.runtimeStats.withoutBall.tackleChance;
	const rawAngle = tackleAngleModifier(tackler, holder);
	const defStr = tackler.runtimeStats.withoutBall.strength ?? .5;
	const attStr = holder.runtimeStats.withBall.strength ?? .5;
	const angleMod = rawAngle + Math.max(-1, Math.min(1, defStr - attStr)) * (.3 - rawAngle) * .5;
	const suppression = pressingLoad * (1 - (holder.runtimeStats.withBall.strength ?? .5));
	const dribbleReduction = 1 - holder.runtimeStats.withBall.dribbling * (1 - suppression) * .4;
	const pressBonus = suppression * .2;
	const chance = Math.max(0, Math.min(1, (base + angleMod + pressBonus) * dribbleReduction));
	return {
		success: Math.random() < chance,
		chance
	};
}
/**
* Roll whether a pass interception succeeds.
*
* Chance scales linearly from the player's base `interceptionChance` (at perpDist=0)
* down to 0 at the edge of their personal corridor (perpDist=corridor).
*
* @param perpDist  Perpendicular distance in yards from the defender to the pass line.
* @param corridor  The defender's effective interception corridor.
*/
function resolveInterception(interceptor, perpDist, corridor, passerSkill = 0) {
	const baseChance = interceptor.runtimeStats.withoutBall.interceptionChance;
	const distFactor = Math.sqrt(Math.max(0, 1 - perpDist / corridor));
	const passerFactor = 1 - passerSkill * .4;
	const chance = baseChance * distFactor * passerFactor;
	return {
		success: Math.random() < chance,
		chance
	};
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/DefensivePositioning.ts
const PITCH_CENTER_Y = 37;
/** Added to `player.runtimeStats.withoutBall.pressRange` from team `pressing_style`. */
const PRESS_RANGE_TACTIC_DELTA_YARDS = {
	low_block: -4,
	mid_block: 0,
	high_press: 4
};
/**
* Intent-aware pressing style: returns the team's static `pressing_style` tactic
* key, or the intent's override when one is set (e.g. counter_attack defending
* intent → high_press). Single source of truth for both intent-multiplier
* lookup and effective press range.
*/
function effectivePressingStyle(team, intent) {
	const baseStyle = getDefenseTacticKeys(team).pressingStyle;
	return getPressingStyleOverride(intent) ?? baseStyle;
}
/**
* Yards a position lies outside a rectangular zone (0 if inside).
* Used by both intent scoring and mark assignment to express bounds as a soft
* cost rather than a hard wall.
*/
function outOfZoneDistance(pos, bounds) {
	const dx = Math.max(0, bounds.minX - pos.x, pos.x - bounds.maxX);
	const dy = Math.max(0, bounds.minY - pos.y, pos.y - bounds.maxY);
	return Math.hypot(dx, dy);
}
/**
* Base roster `pressRange` plus team pressing instruction (see DefenseConfig
* tactic keys), with the active team intent layered on top so a counter_attack
* team can dynamically widen press range when their intent fires defensively.
*
* `intent` defaults to 'balanced' so legacy callers (e.g. tests) keep their
* previous static behaviour without having to thread the intent through.
*/
function effectivePressRange(player, intent = "balanced") {
	const base = player.runtimeStats.withoutBall.pressRange;
	const pressingStyle = effectivePressingStyle(player.team, intent);
	return base + PRESS_RANGE_TACTIC_DELTA_YARDS[pressingStyle];
}
/** Last-computed defensive intent per player id — written each tick, read by computeDefensivePosition. */
const _intentCache = {};
/**
* Ball-relative depth system:
*
* DEPTH_OFFSET_BASE  — minimum yards behind the ball (high press / high line)
* DEPTH_OFFSET_RANGE — extra yards added for the deepest setting
*   deep   (DLH=0.40): offset ≈ 34 yards behind ball
*   normal (DLH=0.60): offset ≈ 26 yards behind ball
*   high   (DLH=0.75): offset ≈ 20 yards behind ball
*/
const DEPTH_OFFSET_BASE = 10;
const DEPTH_OFFSET_RANGE = 40;
const X_TRACK_WEIGHT = .6;
const MARK_FAR_DISTANCE = 15;
const OUT_OF_ZONE_RANGE = 15;
const OUT_OF_ZONE_PENALTY_MAX = .5;
const ASSIGN_ZONE_COST_WEIGHT = .5;
const MARK_PASS_REACH = 25;
const FRONT_DEF_LATERAL_LIMIT = 25;
const FRONT_DEF_DEPTH_LIMIT = 40;
const MARK_ROLE_PRIORITY = {
	Defender: 0,
	Midfielder: 1,
	Forward: 2
};
/**
* Greedy 1:1 mark assignment for a defending team.
*
* Defenders pick in defensive-role order (CBs first, then fullbacks, then mids).
* Each defender is assigned their nearest unassigned opponent.
* This prevents CBs from being dragged across the pitch to mark the opposing
* team's deep defenders — CBs stay near their natural zone and claim whoever
* is closest to them there, leaving the attacking players for the mids.
*/
function assignMarkTargets(allPlayers, defendingTeam, crowdGrid = null) {
	const defenders = allPlayers.filter((p) => p.team === defendingTeam && p.role !== "GK");
	const opponents = allPlayers.filter((p) => p.team !== defendingTeam && p.role !== "GK");
	if (defenders.length === 0 || opponents.length === 0) return /* @__PURE__ */ new Map();
	const oppDangerById = /* @__PURE__ */ new Map();
	{
		const cfg = getDefenseConfig(defendingTeam);
		const defGoalX = defenders[0].attackDir === 1 ? 0 : 115;
		const attackerOutfield = crowdGrid ? defendingTeam === "A" ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield : null;
		for (const opp of opponents) oppDangerById.set(opp.id, computeOppDanger(opp, defGoalX, cfg.THREAT_HORIZON, attackerOutfield));
	}
	const sortedDefenders = [...defenders].sort((a, b) => {
		return (MARK_ROLE_PRIORITY[a.mainRole] ?? 9) - (MARK_ROLE_PRIORITY[b.mainRole] ?? 9);
	});
	const assignments = /* @__PURE__ */ new Map();
	const assignedOpps = /* @__PURE__ */ new Set();
	for (const def of sortedDefenders) {
		let bestOppId = -1;
		let bestCost = Infinity;
		for (const opp of opponents) {
			if (assignedOpps.has(opp.id)) continue;
			const cost = markAssignmentCost(def, opp, oppDangerById.get(opp.id) ?? 0);
			if (cost < bestCost) {
				bestCost = cost;
				bestOppId = opp.id;
			}
		}
		if (bestOppId !== -1) {
			assignments.set(def.id, bestOppId);
			assignedOpps.add(bestOppId);
		}
	}
	const playerById = new Map(allPlayers.map((p) => [p.id, p]));
	const defIds = [...assignments.keys()];
	const MAX_SWAP_PASSES = 20;
	let improved = true;
	let passCount = 0;
	let bestCost = computeAssignmentCost(assignments, playerById, defIds, oppDangerById);
	while (improved && passCount < MAX_SWAP_PASSES) {
		improved = false;
		passCount++;
		for (let i = 0; i < defIds.length; i++) for (let j = i + 1; j < defIds.length; j++) {
			const defA = playerById.get(defIds[i]);
			const defB = playerById.get(defIds[j]);
			const oppAId = assignments.get(defIds[i]);
			const oppBId = assignments.get(defIds[j]);
			const oppA = playerById.get(oppAId);
			const oppB = playerById.get(oppBId);
			const currentCost = markAssignmentCost(defA, oppA) + markAssignmentCost(defB, oppB);
			if (markAssignmentCost(defA, oppB) + markAssignmentCost(defB, oppA) < currentCost - 1e-6) {
				assignments.set(defIds[i], oppBId);
				assignments.set(defIds[j], oppAId);
				improved = true;
			}
		}
		const newCost = computeAssignmentCost(assignments, playerById, defIds, oppDangerById);
		if (!(newCost < bestCost - 1e-6)) break;
		bestCost = newCost;
	}
	return assignments;
}
/**
* Pair-cost for mark assignment: squared distance + soft zone-fit term −
* danger discount.
*
* `outOfZoneDist²` is in yard² same as distance² — `ASSIGN_ZONE_COST_WEIGHT`
* scales how much one yard out of zone "costs" relative to one yard of
* physical distance. The closest defender still wins for big distance
* differences; zone-fit only flips the choice when distances are similar.
*
* `oppDanger` (0..1) reduces the cost so dangerous, isolated, near-goal
* opponents are picked first by greedy assignment. The discount is
* opp-only (same regardless of defender), so it does not change swap-improve
* dynamics — only the order in which opponents get claimed.
*/
function markAssignmentCost(def, opp, oppDanger = 0) {
	const dx = def.x - opp.x;
	const dy = def.y - opp.y;
	const distSq = dx * dx + dy * dy;
	const outDist = outOfZoneDistance(opp, def.bounds);
	return distSq + outDist * outDist * ASSIGN_ZONE_COST_WEIGHT - oppDanger * CROWD_AWARE_DEFENSE.ASSIGN_DANGER_DISCOUNT;
}
/** Total cost of the current mark assignment (sum of pair costs). */
function computeAssignmentCost(assignments, playerById, defIds, oppDangerById) {
	let total = 0;
	for (const defId of defIds) {
		const def = playerById.get(defId);
		const oppId = assignments.get(defId);
		if (oppId === void 0) continue;
		const opp = playerById.get(oppId);
		if (!def || !opp) continue;
		total += markAssignmentCost(def, opp, oppDangerById.get(opp.id) ?? 0);
	}
	return total;
}
/**
* Per-opponent dangerousness signal — combines proximity to defending goal
* (threat) with isolation from other attackers (lone runner = real danger).
*
* Returns 0..1. Used to (1) reduce mark-assignment cost so dangerous opps
* are picked first, and (2) boost track_mark intent score for the assigned
* defender so they push past hold_shape / nearby press alternatives.
*/
function computeOppDanger(opp, defendingTeamGoalX, threatHorizon, attackerOutfield) {
	const distFromOwnGoal = Math.abs(opp.x - defendingTeamGoalX);
	const threat = Math.max(0, 1 - distFromOwnGoal / threatHorizon);
	if (threat <= 0) return 0;
	let isolation = .5;
	if (attackerOutfield) {
		const extra = sampleCellSumExcluding(attackerOutfield, opp.x, opp.y, opp.x, opp.y, 1);
		isolation = Math.max(0, 1 - extra / CROWD_AWARE_DEFENSE.ISOLATION_FULL_RANGE);
	}
	return threat * isolation;
}
/**
* Compute the raw defensive shape anchor for a player — formation slot + block
* shift + compactness + lane blocking. Returns un-clamped raw coordinates.
*/
function computeDefensiveShapeAnchor(player, ballPos, formation, cfg) {
	const base = resolveBasePosition(player.slotIndex, player.attackDir, formation, "defending");
	const ownGoalX = player.attackDir === 1 ? 0 : 115;
	let rawX = base.x;
	if (player.role !== "GK") {
		const depthOffset = (1 - cfg.DEFENSIVE_LINE_HEIGHT) * DEPTH_OFFSET_RANGE + DEPTH_OFFSET_BASE;
		const distBallFromOwnGoal = Math.abs(ballPos.x - ownGoalX);
		const scaledDepthOffset = depthOffset * Math.min(1, distBallFromOwnGoal / 55);
		const ballLineX = ballPos.x - player.attackDir * scaledDepthOffset;
		rawX += (ballLineX - rawX) * X_TRACK_WEIGHT;
	}
	const blockShiftY = (ballPos.y - base.y) * cfg.BLOCK_SHIFT_WEIGHT * .15;
	let rawY = base.y + blockShiftY;
	rawY += (PITCH_CENTER_Y - rawY) * cfg.HORIZONTAL_COMPACTNESS * .12;
	const ballSide = ballPos.x - ownGoalX;
	if (Math.abs(ballSide) > .1) {
		const laneTarget = ownGoalX + ballSide * .7;
		rawX += (laneTarget - rawX) * cfg.LANE_BLOCK_WEIGHT * .15;
	}
	return {
		x: rawX,
		y: rawY
	};
}
/**
* Compute the blended mark + lane-cut target when the player is tracking a
* marked opponent.
*
* Changes vs original:
* - Non-linear threat curve so medium threat engages defenders earlier.
* - Extra pull when defender is too far from mark (urgency to close).
*/
function computeTrackMarkTarget(shapeAnchor, player, ballHolder, markTarget, cfg) {
	const ownGoalX = player.attackDir === 1 ? 0 : 115;
	const distFromOwnGoal = Math.abs(markTarget.x - ownGoalX);
	const threat = Math.max(0, 1 - distFromOwnGoal / cfg.THREAT_HORIZON);
	const threatCurved = 1 - Math.pow(1 - threat, 1.5);
	const laneT = cfg.MARK_LANE_T_FAR + (cfg.MARK_LANE_T_CLOSE - cfg.MARK_LANE_T_FAR) * threatCurved;
	const laneX = ballHolder.x + (markTarget.x - ballHolder.x) * laneT;
	const laneY = ballHolder.y + (markTarget.y - ballHolder.y) * laneT;
	const targetX = markTarget.x + (laneX - markTarget.x) * threat;
	const targetY = markTarget.y + (laneY - markTarget.y) * threat;
	let pull = cfg.MARK_PULL_MIN + (cfg.MARK_PULL_MAX - cfg.MARK_PULL_MIN) * threatCurved;
	if (Math.hypot(markTarget.x - player.x, markTarget.y - player.y) > MARK_FAR_DISTANCE) pull = Math.min(cfg.MARK_PULL_MAX, pull * 1.3);
	return {
		x: shapeAnchor.x + (targetX - shapeAnchor.x) * pull,
		y: shapeAnchor.y + (targetY - shapeAnchor.y) * pull,
		threat,
		pull
	};
}
function computeCarryLaneIntercept(player, ballHolder, ownGoalX, lookahead) {
	const goalDx = ownGoalX - ballHolder.x;
	const dist = Math.abs(goalDx);
	if (dist < .01) return {
		x: ballHolder.x,
		y: ballHolder.y
	};
	const ndx = goalDx / dist;
	return {
		x: ballHolder.x + ndx * lookahead,
		y: ballHolder.y * .7 + player.y * .3
	};
}
/**
* How much front coverage the ball carrier already faces from teammates (0..1).
* Does NOT include the player themselves — this measures "are other defenders
* already covering the run?" driving urgency for this player to step in.
*
* The transition "I've already arrived → switch to track/press" is handled
* separately via `selfIsGoalSide` in the scorer.
*
* 0   = no teammates in front → carrier has a free run.
* 0.5 = one teammate in front → partial coverage.
* 1   = two or more teammates in front → well-covered.
*/
function computeFrontBlocker(player, ballHolder, allPlayers) {
	const count = allPlayers.filter((p) => {
		if (p.team !== player.team) return false;
		if (p.role === "GK") return false;
		if (p.id === player.id) return false;
		if (!(player.attackDir === 1 ? p.x < ballHolder.x : p.x > ballHolder.x)) return false;
		if (Math.abs(p.y - ballHolder.y) > FRONT_DEF_LATERAL_LIMIT) return false;
		if (Math.abs(p.x - ballHolder.x) > FRONT_DEF_DEPTH_LIMIT) return false;
		return true;
	}).length;
	return Math.min(1, count / 2);
}
/**
* Composite carry-lane urgency signal.
* 0 = holder is no real immediate threat for this defender.
* 1 = full emergency — step into carry lane, abandon mark tracking.
*
* `frontBlocker` (0..1, teammates only) reduces urgency when others are
* already covering the run. The self-transition (I've arrived goal-side)
* is handled directly inside scoreStepIntoCarryLaneIntent via selfIsGoalSide.
*/
function computeCarryLaneUrgency(holderThreat, holderInMyCorridor, frontBlocker, canGetGoalSideOfHolder) {
	let urgency = holderThreat * .35;
	if (holderInMyCorridor) urgency += .25;
	urgency += (1 - frontBlocker) * .7;
	if (canGetGoalSideOfHolder) urgency += .1;
	return Math.min(1, urgency);
}
function buildDefensiveIntentContext(player, ballHolder, markTarget, allPlayers, formation, ballPos, cfg, crowdGrid, teamIntent) {
	const ownGoalX = player.attackDir === 1 ? 0 : 115;
	const shapeAnchor = formation ? computeDefensiveShapeAnchor(player, ballPos, formation, cfg) : {
		x: player.x,
		y: player.y
	};
	const distToHolder = ballHolder ? Math.hypot(ballHolder.x - player.x, ballHolder.y - player.y) : Infinity;
	const distToMark = markTarget ? Math.hypot(markTarget.x - player.x, markTarget.y - player.y) : Infinity;
	const holderThreat = ballHolder ? Math.max(0, 1 - Math.abs(ballHolder.x - ownGoalX) / cfg.THREAT_HORIZON) : 0;
	const markThreat = markTarget ? Math.max(0, 1 - Math.abs(markTarget.x - ownGoalX) / cfg.THREAT_HORIZON) : 0;
	const holderInMyCorridor = ballHolder != null && Math.abs(ballHolder.y - player.y) < DEFENSIVE_INTENT_CONFIG.CORRIDOR_HALF_WIDTH;
	const canGetGoalSideOfHolder = ballHolder != null && (player.attackDir === 1 ? player.x <= ballHolder.x : player.x >= ballHolder.x);
	const frontBlocker = ballHolder != null ? computeFrontBlocker(player, ballHolder, allPlayers) : 0;
	const markIsGoalSideDanger = markTarget != null && (player.attackDir === 1 ? markTarget.x < player.x : markTarget.x > player.x);
	const markIsPassReachable = markTarget != null && ballHolder != null && Math.hypot(markTarget.x - ballHolder.x, markTarget.y - ballHolder.y) < MARK_PASS_REACH;
	const markDistFactor = markTarget != null && isFinite(distToMark) ? Math.min(1, Math.max(0, (distToMark - MARK_FAR_DISTANCE) / 20)) : 0;
	const carryLaneUrgency = computeCarryLaneUrgency(holderThreat, holderInMyCorridor, frontBlocker, canGetGoalSideOfHolder);
	const isBlockingCarryLane = ballHolder != null && canGetGoalSideOfHolder && Math.abs(player.y - ballHolder.y) < DEFENSIVE_INTENT_CONFIG.CARRY_BLOCK_WIDTH;
	let pressLoad = 0;
	let effectivePressLoad = 0;
	let markDangerScore = 0;
	if (crowdGrid && ballHolder) pressLoad = sampleCellSumExcluding(player.team === "A" ? crowdGrid.teamAOutfield : crowdGrid.teamBOutfield, ballHolder.x, ballHolder.y, player.x, player.y, 1);
	if (ballHolder) effectivePressLoad = computeEffectivePressLoad(player, ballHolder, allPlayers);
	if (markTarget) {
		const attackerOutfield = crowdGrid ? player.team === "A" ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield : null;
		markDangerScore = computeOppDanger(markTarget, ownGoalX, cfg.THREAT_HORIZON, attackerOutfield);
	}
	const roleWeights = roleEngine(player.role).defensiveIntentWeights;
	return {
		player,
		ballHolder,
		markTarget,
		shapeAnchor,
		cfg,
		allPlayers,
		formation,
		ballPos,
		ownGoalX,
		teamIntent,
		distToHolder,
		distToMark,
		holderThreat,
		markThreat,
		holderInMyCorridor,
		canGetGoalSideOfHolder,
		frontBlocker,
		markIsGoalSideDanger,
		markIsPassReachable,
		markDistFactor,
		carryLaneUrgency,
		isBlockingCarryLane,
		rolePressBias: roleWeights.press_holder,
		roleCarryLaneBias: roleWeights.step_into_carry_lane,
		roleMarkBias: roleWeights.track_mark,
		pressLoad,
		effectivePressLoad,
		markDangerScore
	};
}
/**
* Effective press load on the ball holder from this defender's perspective.
*
* Replaces the direction-agnostic crowd-grid sample for press-saturation
* decisions. Each teammate contributes proportionally to:
*   • distance falloff (closer = more)
*   • along-goal effectiveness (defender between holder and own goal counts;
*     defender behind the holder doesn't — they're already beaten)
*   • lateral effectiveness (defender on the holder→goal corridor counts;
*     a teammate 20 yds laterally off the corridor doesn't actually block
*     the carry, even if their x-position looks goal-side)
*
* Self is excluded — this is the load *other* teammates put on the holder.
* GKs are excluded.
*
* Calibration: PRESS_LOAD_PER_PLAYER matches PRESS_SAT_PER_PLAYER so the
* existing PRESS_SAT_THRESHOLD keeps its "≈ 1.5 effective pressers" meaning.
*/
function computeEffectivePressLoad(player, ballHolder, allPlayers) {
	const { PRESS_LOAD_RADIUS, PRESS_LOAD_ALONG_FULL, PRESS_LOAD_LATERAL_RANGE, PRESS_LOAD_PER_PLAYER } = CROWD_AWARE_DEFENSE;
	const ownGoalX = player.attackDir === 1 ? 0 : 115;
	const goalCenterY = 37;
	const gx = ownGoalX - ballHolder.x;
	const gy = goalCenterY - ballHolder.y;
	const gLen = Math.hypot(gx, gy);
	if (gLen < 1e-6) return 0;
	const goalDirX = gx / gLen;
	const goalDirY = gy / gLen;
	let load = 0;
	for (const d of allPlayers) {
		if (d.team !== player.team) continue;
		if (d.id === player.id) continue;
		if (d.role === "GK") continue;
		const dx = d.x - ballHolder.x;
		const dy = d.y - ballHolder.y;
		const dist = Math.hypot(dx, dy);
		if (dist >= PRESS_LOAD_RADIUS) continue;
		const along = dx * goalDirX + dy * goalDirY;
		const lateral = Math.abs(dx * -goalDirY + dy * goalDirX);
		const effectiveness = Math.max(0, Math.min(1, along / PRESS_LOAD_ALONG_FULL)) * Math.max(0, 1 - lateral / PRESS_LOAD_LATERAL_RANGE);
		if (effectiveness <= 0) continue;
		const proximity = 1 - dist / PRESS_LOAD_RADIUS;
		load += proximity * effectiveness * PRESS_LOAD_PER_PLAYER;
	}
	return load;
}
/**
* Press saturation damping multiplier (0..1).
*
* When several defenders already cluster around the ball holder, additional
* defenders far from the holder should NOT also commit to pressing — they're
* needed to mark unattended attackers elsewhere. The closest defender to the
* holder is unaffected (proximityFactor → 0 at distToHolder=0) so there's
* always at least one presser.
*
* @param pressLoad      effective-press-load value (see computeEffectivePressLoad)
* @param distToHolder   this defender's distance to the holder (yards)
* @param pressRangeYds  effective press range, used as the distance scale
*/
function pressSaturationFactor(pressLoad, distToHolder, pressRangeYds) {
	const { PRESS_SAT_THRESHOLD, PRESS_SAT_PER_PLAYER, PRESS_SAT_DAMP_PER, PRESS_SAT_FLOOR } = CROWD_AWARE_DEFENSE;
	if (pressLoad <= PRESS_SAT_THRESHOLD) return 1;
	const damping = 1 - (pressLoad - PRESS_SAT_THRESHOLD) / PRESS_SAT_PER_PLAYER * Math.max(0, Math.min(1, distToHolder / Math.max(pressRangeYds, 1e-6))) * PRESS_SAT_DAMP_PER;
	return Math.max(PRESS_SAT_FLOOR, damping);
}
/** Structural fallback — wins when no direct local threat demands more. */
function scoreHoldShapeIntent(ctx, w, press, line, patienceT) {
	let s = w.hold_shape * press.hold_shape * line.hold_shape;
	if (ctx.holderThreat < .25) s *= 1.15;
	if (ctx.markTarget) {
		const nearGoalFactor = Math.max(.35, 1 - ctx.markThreat * .65);
		s *= nearGoalFactor;
	}
	if (ctx.holderInMyCorridor && ctx.distToHolder < 20) s *= .75;
	s *= 1 - patienceT * patienceT * POSSESSION_PATIENCE.SHAPE_PENALTY_MAX;
	return s;
}
/**
* Default defensive behavior — always mark on the passing lane.
* Pressing tactic controls HOW close (via MARK_LANE_T in cfg), not WHETHER.
* Role has no influence here; tactic and situation drive the score.
*/
function scoreTrackMarkIntent(ctx, w, press, line) {
	let s = w.track_mark * press.track_mark * line.track_mark;
	s *= .6 + ctx.markThreat * .4;
	if (ctx.markDistFactor > 0) s *= 1 + ctx.markDistFactor * .5;
	if (ctx.markIsGoalSideDanger) s *= 1.2;
	if (ctx.markIsPassReachable) s *= 1.15;
	if (!ctx.markTarget) s *= .2;
	s *= Math.max(.5, 1 - ctx.carryLaneUrgency * .35);
	if (ctx.markTarget) {
		const outDist = outOfZoneDistance(ctx.markTarget, ctx.player.bounds);
		if (outDist > 0) {
			const effectivePenalty = Math.min(1, outDist / OUT_OF_ZONE_RANGE) * (1 - ctx.markThreat) * OUT_OF_ZONE_PENALTY_MAX;
			s *= 1 - effectivePenalty;
		}
	}
	s *= 1 + ctx.markDangerScore * CROWD_AWARE_DEFENSE.MARK_DANGER_BOOST_MAX;
	return s;
}
/** Only when our mark has the ball and within effective press range,
*  OR when this defender is already physically blocking the carry lane. */
function scorePressHolderIntent(ctx, w, press, line, pressRangeYds, holderIsMyMark, patienceT, rawPatienceT) {
	let s = w.press_holder * press.press_holder * line.press_holder;
	const effectiveOpportunisticRange = DEFENSIVE_INTENT_CONFIG.OPPORTUNISTIC_PRESS_RANGE + rawPatienceT * rawPatienceT * DEFENSIVE_INTENT_CONFIG.PATIENCE_OPPORTUNISTIC_BONUS;
	const opportunisticPress = ctx.distToHolder < effectiveOpportunisticRange;
	if (!ctx.ballHolder || !holderIsMyMark && !ctx.isBlockingCarryLane && !opportunisticPress) return 0;
	const maxPressRange = opportunisticPress ? Math.max(pressRangeYds, effectiveOpportunisticRange) : pressRangeYds;
	if (ctx.distToHolder > maxPressRange) return 0;
	const { DISTANCE_AT_EDGE, DISTANCE_ON_HOLDER, INTENT_SCALE } = PRESS_HOLDER_SCORING;
	const r = Math.max(maxPressRange, 1e-6);
	const edgeToHolderT = ctx.distToHolder / r;
	const distanceFactor = DISTANCE_AT_EDGE + (DISTANCE_ON_HOLDER - DISTANCE_AT_EDGE) * (1 - edgeToHolderT);
	s *= distanceFactor;
	s *= .25 + ctx.holderThreat * .75;
	s *= INTENT_SCALE;
	s *= 1 + patienceT * patienceT * POSSESSION_PATIENCE.PRESS_BOOST_MAX;
	{
		const goalX = ctx.ballHolder.attackDir === 1 ? 115 : 0;
		const goalY = 37;
		const fx = goalX - ctx.ballHolder.x;
		const fy = goalY - ctx.ballHolder.y;
		const fLen = Math.hypot(fx, fy);
		const forwardX = fLen > .001 ? fx / fLen : ctx.ballHolder.attackDir;
		const forwardY = fLen > .001 ? fy / fLen : 0;
		const dx = ctx.player.x - ctx.ballHolder.x;
		const dy = ctx.player.y - ctx.ballHolder.y;
		const along = dx * forwardX + dy * forwardY;
		const catchabilityFactor = Math.max(DEFENSIVE_INTENT_CONFIG.PRESS_CATCHABILITY_FLOOR, Math.min(1, 1 + along / DEFENSIVE_INTENT_CONFIG.PRESS_CATCHABILITY_FALLOFF));
		s *= catchabilityFactor;
	}
	s *= pressSaturationFactor(ctx.pressLoad, ctx.distToHolder, pressRangeYds);
	return s;
}
/** Step in to block a dangerous carry when corridor threat dominates. */
function scoreStepIntoCarryLaneIntent(ctx, w, press, line) {
	if (!ctx.ballHolder) return {
		score: 0,
		carryLaneBonus: 0
	};
	if (ctx.isBlockingCarryLane) return {
		score: 0,
		carryLaneBonus: 0
	};
	let s = w.step_into_carry_lane * press.step_into_carry_lane * line.step_into_carry_lane;
	s *= .1 + ctx.holderThreat * .9;
	s *= Math.max(.1, 1 - ctx.frontBlocker * .9);
	if (!ctx.holderInMyCorridor) s *= Math.min(1, .4 + ctx.holderThreat * .6);
	if (ctx.canGetGoalSideOfHolder) s *= 1.3;
	else {
		const yardsBeind = Math.abs(ctx.ballHolder.x - ctx.player.x);
		const behindPenalty = Math.max(.2, 1 - yardsBeind / 20);
		s *= behindPenalty;
	}
	const carryLaneBonus = .4;
	s *= 1.4;
	s *= pressSaturationFactor(ctx.effectivePressLoad, ctx.distToHolder, effectivePressRange(ctx.player, ctx.teamIntent));
	return {
		score: s,
		carryLaneBonus
	};
}
function selectDefensiveIntent(ctx, possessionTime) {
	const tacticKeys = getDefenseTacticKeys(ctx.player.team);
	const pressingStyle = effectivePressingStyle(ctx.player.team, ctx.teamIntent);
	const pressMult = INTENT_PRESSING_STYLE[pressingStyle];
	const lineMult = INTENT_DEFENSIVE_LINE[tacticKeys.defensiveLine];
	const pressRangeYds = effectivePressRange(ctx.player, ctx.teamIntent);
	const holderIsMyMark = ctx.ballHolder != null && ctx.markTarget != null && ctx.ballHolder.id === ctx.markTarget.id;
	const w = roleEngine(ctx.player.role).defensiveIntentWeights;
	const rawPatienceT = Math.min(1, possessionTime / POSSESSION_PATIENCE.BASE_SECONDS);
	const patienceT = rawPatienceT * (Number.isFinite(ctx.distToHolder) ? Math.max(0, 1 - ctx.distToHolder / DEFENSIVE_INTENT_CONFIG.PATIENCE_INFLUENCE_RADIUS) : 0);
	const holdShapeScore = scoreHoldShapeIntent(ctx, w, pressMult, lineMult, patienceT);
	const trackMarkScore = scoreTrackMarkIntent(ctx, w, pressMult, lineMult);
	const pressHolderScore = scorePressHolderIntent(ctx, w, pressMult, lineMult, pressRangeYds, holderIsMyMark, patienceT, rawPatienceT);
	const { score: stepIntoCarryLaneScore, carryLaneBonus } = scoreStepIntoCarryLaneIntent(ctx, w, pressMult, lineMult);
	const scores = {
		hold_shape: holdShapeScore,
		track_mark: trackMarkScore,
		press_holder: pressHolderScore,
		step_into_carry_lane: stepIntoCarryLaneScore
	};
	let best = "hold_shape";
	let bestScore = -Infinity;
	for (const intent of [
		"press_holder",
		"step_into_carry_lane",
		"track_mark",
		"hold_shape"
	]) if (scores[intent] > bestScore) {
		bestScore = scores[intent];
		best = intent;
	}
	return {
		intent: best,
		scores,
		carryLaneBonus
	};
}
function evaluateDefensiveDecision(player, ballHolder, allPlayers, possessionTime, crowdGrid = null, teamIntent = "balanced") {
	const cfg = getDefenseConfig(player.team);
	const markTargetId = assignMarkTargets(allPlayers, player.team, crowdGrid).get(player.id);
	const ctx = buildDefensiveIntentContext(player, ballHolder, markTargetId !== void 0 ? allPlayers.find((p) => p.id === markTargetId) ?? null : null, allPlayers, null, {
		x: ballHolder.x,
		y: ballHolder.y
	}, cfg, crowdGrid, teamIntent);
	const { intent, scores, carryLaneBonus } = selectDefensiveIntent(ctx, possessionTime);
	_intentCache[player.id] = intent;
	if (isDebugEnabled()) gameBus.emit("defensiveScores", {
		playerId: player.id,
		playerName: player.name,
		chosenIntent: intent,
		scores,
		holderThreat: ctx.holderThreat,
		markThreat: ctx.markThreat,
		carryLaneBonus
	});
	switch (intent) {
		case "press_holder": return {
			type: "press",
			targetId: ballHolder.id
		};
		case "track_mark": return {
			type: "track_mark",
			markTargetId: markTargetId ?? -1
		};
		case "hold_shape": return { type: "hold_shape" };
		case "step_into_carry_lane": return { type: "step_into_carry_lane" };
	}
}
/**
* Returns the GK's optimal position on the angle-bisector arc.
*
* The GK moves along the line from the goal centre toward the ball,
* stepping off the line by a come-out distance that scales with how
* close the attacker is (closer → further out, narrowing the angle).
*/
function computeGKSemicirclePosition(gk, ballPos) {
	const goalX = gk.attackDir === 1 ? 0 : 115;
	const goalCenterY = 37;
	const dx = ballPos.x - goalX;
	const dy = ballPos.y - goalCenterY;
	const dist = Math.sqrt(dx * dx + dy * dy);
	const comeOut = GK_MIN_COME_OUT + 5.5 * Math.max(0, 1 - dist / 20);
	let rawX;
	let rawY;
	if (dist > .01) {
		rawX = goalX + dx / dist * comeOut;
		rawY = goalCenterY + dy / dist * comeOut;
	} else {
		rawX = goalX + gk.attackDir * comeOut;
		rawY = goalCenterY;
	}
	const { bounds } = gk;
	return {
		x: Math.max(bounds.minX, Math.min(bounds.maxX, rawX)),
		y: Math.max(bounds.minY, Math.min(bounds.maxY, rawY))
	};
}
function computeDefensivePosition(player, ballPos, allPlayers, formation, ballHolderId, playerDecision, markTargetId) {
	const { bounds } = player;
	const cfg = getDefenseConfig(player.team);
	const ownGoalX = player.attackDir === 1 ? 0 : 115;
	if (player.role === "GK") return computeGKSemicirclePosition(player, ballPos);
	if (playerDecision === "tackle") {
		const anchor = computeDefensiveShapeAnchor(player, ballPos, formation, cfg);
		return {
			x: Math.max(bounds.minX, Math.min(bounds.maxX, anchor.x)),
			y: Math.max(bounds.minY, Math.min(bounds.maxY, anchor.y))
		};
	}
	const intent = _intentCache[player.id] ?? "hold_shape";
	const shapeAnchor = computeDefensiveShapeAnchor(player, ballPos, formation, cfg);
	const ballHolder = allPlayers.find((p) => p.id === ballHolderId) ?? null;
	const markTarget = markTargetId !== void 0 ? allPlayers.find((p) => p.id === markTargetId) ?? null : null;
	let rawX = shapeAnchor.x;
	let rawY = shapeAnchor.y;
	if (intent === "track_mark" && ballHolder && markTarget) {
		const result = computeTrackMarkTarget(shapeAnchor, player, ballHolder, markTarget, cfg);
		rawX = result.x;
		rawY = result.y;
	}
	if (intent === "step_into_carry_lane" && ballHolder) {
		const intercept = computeCarryLaneIntercept(player, ballHolder, ownGoalX, DEFENSIVE_INTENT_CONFIG.CARRY_LANE_LOOKAHEAD);
		rawX = intercept.x;
		rawY = intercept.y;
	}
	const useSoftBounds = intent === "track_mark" || intent === "step_into_carry_lane";
	const minX = useSoftBounds ? 0 : bounds.minX;
	const maxX = useSoftBounds ? 115 : bounds.maxX;
	const minY = useSoftBounds ? 0 : bounds.minY;
	const maxY = useSoftBounds ? 74 : bounds.maxY;
	return {
		x: Math.max(minX, Math.min(maxX, rawX)),
		y: Math.max(minY, Math.min(maxY, rawY))
	};
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/CarryLaneEval.ts
function getClearanceScore(player, dirX, dirY, opponents) {
	const vision = player.runtimeStats.withBall.carryVision;
	if (vision <= 0) return 0;
	let minDist = vision;
	for (const opp of opponents) {
		const odx = opp.x - player.x;
		const ody = opp.y - player.y;
		const dist = Math.sqrt(odx * odx + ody * ody);
		if (dist > vision || dist < .1) continue;
		const dot = odx / dist * dirX + ody / dist * dirY;
		if (dot < 0) continue;
		if (Math.acos(Math.max(-1, Math.min(1, dot))) <= Math.PI / 4) minDist = Math.min(minDist, dist);
	}
	return Math.min(1, minDist / vision);
}
function getProgressScore$1(player, dirX) {
	return Math.max(0, dirX * player.attackDir);
}
function getAngleScore(player, dirX, dirY, goalTargetY) {
	const tgDx = (player.attackDir === 1 ? 115 : 0) - player.x;
	const tgDy = goalTargetY - player.y;
	const tgDist = Math.sqrt(tgDx * tgDx + tgDy * tgDy);
	if (tgDist < .01) return 1;
	return Math.max(0, dirX * (tgDx / tgDist) + dirY * (tgDy / tgDist));
}
function getCrowdPenalty(targetX, targetY, opponents, visionNorm) {
	let count = 0;
	for (const opp of opponents) if (Math.sqrt((opp.x - targetX) ** 2 + (opp.y - targetY) ** 2) <= CARRY_CONFIG.TARGET_CROWD_RADIUS) count++;
	return Math.min(1, count / 3) * (1 - visionNorm * CARRY_CONFIG.VISION_CROWD_REDUCTION);
}
function getVisionBonus(player, progressScore, angleScore) {
	return Math.min(1, player.runtimeStats.withBall.carryVision / 18) * ((progressScore + angleScore) / 2) * CARRY_CONFIG.VISION_WEIGHT;
}
function getPressurePenalty(player, opponents) {
	const fwd = player.attackDir;
	let penalty = 0;
	for (const opp of opponents) {
		const dx = opp.x - player.x;
		const dy = opp.y - player.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist >= CARRY_CONFIG.MEDIUM_PRESSURE_DISTANCE || dist < .01) continue;
		const forwardDot = dx / dist * fwd;
		const distFactor = 1 - dist / CARRY_CONFIG.MEDIUM_PRESSURE_DISTANCE;
		const dirWeight = Math.max(0, (forwardDot + 1) / 2);
		penalty += CARRY_CONFIG.HARD_PRESSURE_PENALTY * distFactor * dirWeight;
	}
	return Math.min(penalty, CARRY_CONFIG.MAX_PRESSURE_PENALTY);
}
/**
* Score a single carry lane direction with full component breakdown.
* Formula: baseScore + playerModifier, per carry.md.
*/
function evaluateCarryLaneBreakdown(player, dirX, dirY, goalTargetY, opponents, cfg) {
	const targetX = player.x + dirX * cfg.LOOKAHEAD_DISTANCE;
	const targetY = player.y + dirY * cfg.LOOKAHEAD_DISTANCE;
	const visionNorm = Math.min(1, player.runtimeStats.withBall.carryVision / 18);
	const clearanceScore = getClearanceScore(player, dirX, dirY, opponents);
	const progressScore = getProgressScore$1(player, dirX);
	const angleScore = getAngleScore(player, dirX, dirY, goalTargetY);
	const crowdPenalty = getCrowdPenalty(targetX, targetY, opponents, visionNorm);
	const baseScore = clearanceScore * cfg.CLEARANCE_WEIGHT + progressScore * cfg.PROGRESS_WEIGHT + angleScore * cfg.ANGLE_WEIGHT - crowdPenalty * cfg.CROWD_PENALTY_WEIGHT;
	const roleBias = roleEngine(player.role).carryBias;
	const visionBonus = getVisionBonus(player, progressScore, angleScore);
	const pressurePenalty = getPressurePenalty(player, opponents);
	const playerModifier = (roleBias * CARRY_CONFIG.ROLE_BIAS_WEIGHT + visionBonus) * clearanceScore - pressurePenalty;
	return {
		clearanceScore,
		progressScore,
		angleScore,
		crowdPenalty,
		roleBias,
		visionBonus,
		pressurePenalty,
		baseScore,
		playerModifier,
		score: baseScore + playerModifier
	};
}
/** Rotate a 2-D unit vector by `angle` radians. */
function rot(dx, dy, angle) {
	return {
		dx: dx * Math.cos(angle) - dy * Math.sin(angle),
		dy: dx * Math.sin(angle) + dy * Math.cos(angle)
	};
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/RuntimeLineup.ts
/**
* Energy drain per game-second (0–100 scale).
* These were originally per-live-game-tick at ~60fps (0.3 game-seconds/tick).
* Now stored as per-game-second so the drain is tick-rate-independent.
* Reference: move was 0.004/tick ÷ 0.3 game-s/tick ≈ 0.0133/game-s.
*/
const STAMINA_COST = {
	move: .0106,
	pass: .0267,
	shot: .1334,
	tackle: .1334,
	interception: .1334,
	gkSave: .2666,
	carry: .1334,
	press: .16
};
function clampEnergy(n) {
	return Math.max(0, Math.min(100, n));
}
/**
* Fatigue curve config — change these to tune how hard low energy hits stats.
*
* Formula: factor = 1 - MAX_REDUCTION * (energyLost / 100) ^ CURVE_POWER
*
* CURVE_POWER < 1 makes the curve concave: the first energy lost hurts more than the last,
* so a 90-energy player takes ~10% physical hit but a 10-energy player stays above 45%.
*
* Reference at 90 energy (10 energy lost):
*   physical → 90% stats  (−10%)
*   semi     → 94% stats  (−6%)
*   tech     → 96% stats  (−4%)
*
* Reference at 10 energy (90 energy lost):
*   physical → 45% stats
*   semi     → 68% stats
*   tech     → 82% stats
*/
const FATIGUE_MAX_REDUCTION_PHYSICAL = .55;
const FATIGUE_MAX_REDUCTION_SEMI = .35;
const FATIGUE_MAX_REDUCTION_TECH = .2;
const FATIGUE_CURVE_POWER = .75;
function getFatigueFactor(energy, maxReduction) {
	const lost = Math.max(0, Math.min(100, 100 - energy)) / 100;
	return Math.max(0, 1 - maxReduction * Math.pow(lost, FATIGUE_CURVE_POWER));
}
function consumeEnergy(energy, stamina, action, dtGame) {
	return clampEnergy(energy - STAMINA_COST[action] * (1 - stamina * .05) * dtGame);
}
function getRuntimeLineup(base, player) {
	const physicalRed = getFatigueFactor(player.energy, FATIGUE_MAX_REDUCTION_PHYSICAL);
	const semiRed = getFatigueFactor(player.energy, FATIGUE_MAX_REDUCTION_SEMI);
	const techRed = getFatigueFactor(player.energy, FATIGUE_MAX_REDUCTION_TECH);
	return {
		withBall: {
			...base.withBall,
			carrySpeed: base.withBall.carrySpeed * physicalRed,
			speed: base.withBall.speed * physicalRed,
			acceleration: base.withBall.acceleration * physicalRed,
			passingSkill: base.withBall.passingSkill * techRed,
			vision: base.withBall.vision * techRed,
			firstTouch: base.withBall.firstTouch * techRed,
			dribbling: base.withBall.dribbling * techRed
		},
		withoutBall: {
			...base.withoutBall,
			pressSpeed: base.withoutBall.pressSpeed * physicalRed,
			speed: base.withoutBall.speed * physicalRed,
			acceleration: base.withoutBall.acceleration * physicalRed,
			tackleChance: base.withoutBall.tackleChance * semiRed,
			tackling: base.withoutBall.tackling * semiRed,
			interceptionChance: base.withoutBall.interceptionChance * semiRed
		}
	};
}
/**
* Ensure lineup + stamina fields exist (e.g. after loading legacy JSON from localStorage).
*/
function normalizeGamePlayer(p) {
	if (p.runtimeStats != null && p.baseStats != null && typeof p.energy === "number" && typeof p.stamina === "number") return p;
	const legacy = p;
	const baseStats = legacy.baseStats ?? legacy.stats;
	if (!baseStats) return p;
	const energy = typeof legacy.energy === "number" ? legacy.energy : 100;
	const stamina = typeof legacy.stamina === "number" ? legacy.stamina : 7;
	return {
		...legacy,
		baseStats,
		runtimeStats: getRuntimeLineup(baseStats, { energy }),
		energy,
		stamina
	};
}
/** Apply one extra stamina hit (e.g. tackle burst) after the per-tick locomotion drain. */
function applyStaminaCost(players, playerId, action) {
	return players.map((p) => {
		if (p.id !== playerId) return p;
		const pl = normalizeGamePlayer(p);
		if (pl.baseStats == null) return p;
		const energy = consumeEnergy(pl.energy, pl.stamina, action, 1);
		return {
			...pl,
			energy,
			runtimeStats: getRuntimeLineup(pl.baseStats, { energy })
		};
	});
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/PassLanes.ts
/**
* Lane quality — 0..1 based on perpendicular clearance from opponents along the pass line.
* 0 = fully blocked, 1 = fully clear.
*
* Distance-adaptive clearance: short passes use a smaller BLOCK_RADIUS so central
* triangles remain viable. The scale factor is tied to the team's width tactic:
*   narrow  → tacticFloor 0.25 — 5-yd pass uses blockR 0.75 yds
*   normal  → tacticFloor 0.40 — 5-yd pass uses blockR 1.20 yds
*   wide    → tacticFloor 0.55 — minimal change, width still rewarded
*
* At 30+ yards all tactics converge to shortFactor=1.0 (blockR = 3.0, unchanged).
*/
function getLaneScore(from, to, opponents, widthTactic = "normal") {
	const vx = to.x - from.x;
	const vy = to.y - from.y;
	const lenSq = vx * vx + vy * vy;
	if (lenSq < 1) return 1;
	const shortFactor = Math.max(widthTactic === "narrow" ? .25 : widthTactic === "normal" ? .4 : .55, Math.min(1, Math.sqrt(lenSq) / 30));
	const blockR = PASS_CONFIG.BLOCK_RADIUS * shortFactor;
	const clearR = PASS_CONFIG.CLEAR_RADIUS * shortFactor;
	let minPerpDist = Infinity;
	for (const opp of opponents) {
		const ox = opp.x - from.x;
		const oy = opp.y - from.y;
		const t = (ox * vx + oy * vy) / lenSq;
		if (t < .1 || t > 1) continue;
		const perpDist = Math.sqrt((ox - t * vx) ** 2 + (oy - t * vy) ** 2);
		minPerpDist = Math.min(minPerpDist, perpDist);
	}
	if (minPerpDist === Infinity) return 1;
	return Math.max(0, Math.min(1, (minPerpDist - blockR) / (clearR - blockR)));
}
/**
* Forward progress — 0..1 based on how much the pass advances toward the opponent's goal.
* Lateral passes score ~0.5; backward passes trend toward 0; forward passes toward 1.
*
* Uses holder.attackDir (not team) so this stays correct after half-time side-switching.
*/
function getProgressScore(holder, receiver) {
	const dx = (receiver.x - holder.x) * holder.attackDir;
	return Math.max(0, Math.min(1, (dx + 30) / 60));
}
/**
* Receiver space — 0..1 based on how much room the receiver has.
* Combines nearest-opponent distance with crowding count.
*/
function getReceiverSpaceScore(receiver, opponents) {
	let count = 0;
	let minDist = Infinity;
	for (const opp of opponents) {
		const d = Math.sqrt((opp.x - receiver.x) ** 2 + (opp.y - receiver.y) ** 2);
		if (d < PASS_CONFIG.RECEIVER_SPACE_RADIUS) count++;
		minDist = Math.min(minDist, d);
	}
	const crowdingPenalty = Math.min(1, count / 3);
	const nearestScore = Math.min(1, minDist / PASS_CONFIG.RECEIVER_SPACE_RADIUS);
	return (1 - crowdingPenalty) * .5 + nearestScore * .5;
}
/**
* Distance penalty — 0..1 penalty that grows with pass length.
* Longer passes are riskier and harder to execute.
*/
function getDistancePenalty(holder, receiver) {
	const dist = Math.sqrt((receiver.x - holder.x) ** 2 + (receiver.y - holder.y) ** 2);
	return Math.min(1, dist / PASS_CONFIG.MAX_PASS_DISTANCE);
}
/**
* Vision range penalty — penalises passes beyond the holder's vision horizon.
*
* A player with vision=10 has no extra penalty (horizon = MAX_PASS_DISTANCE).
* A player with vision=1  starts getting penalised beyond 25 yards.
*
* horizon = 25 + (vision / 10) * (MAX_PASS_DISTANCE - 25)
* penalty = clamp((dist - horizon) / horizon, 0, 1)
*/
const VISION_RANGE_MIN_HORIZON = 25;
function getVisionRangePenalty(holder, receiver) {
	const vision = holder.runtimeStats.withBall.vision;
	const horizon = VISION_RANGE_MIN_HORIZON + vision * (PASS_CONFIG.MAX_PASS_DISTANCE - VISION_RANGE_MIN_HORIZON);
	const overrun = Math.sqrt((receiver.x - holder.x) ** 2 + (receiver.y - holder.y) ** 2) - horizon;
	return overrun <= 0 ? 0 : Math.min(1, overrun / horizon);
}
/**
* Goal proximity bonus — 0..1 based on how dangerous the receiver's
* position is relative to the opponent's goal.
*
* Combines two factors:
*   - Distance to goal (quadratic ramp inside GOAL_PROXIMITY_HORIZON)
*   - Open angle to goal (how central the receiver is — wider angle = better)
*
* Angle is weighted more heavily (0.65 vs 0.35) because two players at the
* same distance can have vastly different threat levels based on their
* lateral position — a central player near the posts has a far better
* shooting opportunity than one out wide. The angle bonus is **also scaled
* by proximity** — a clear view of goal from 50 yards away doesn't translate
* to a real shooting threat (the receiver still has to cover that distance).
* Without this gate, soft-cliff pass scoring overestimates passes into space
* outside the box because of the open-angle bonus.
*
* Soft cliff: previously the function returned 0 for any receiver outside the
* attacking third (38.33 yds). That binary cutoff penalised passes into space
* just outside the third even when the receiver had a clear run to goal. The
* horizon now extends to GOAL_PROXIMITY_HORIZON (55 yds) — same shape, just
* stretched — so partial credit applies through the middle third.
*/
function getGoalProximityBonus(holder, receiver) {
	const goalX = holder.attackDir === 1 ? 115 : 0;
	const receiverDist = Math.abs(goalX - receiver.x);
	if (receiverDist > PASS_CONFIG.GOAL_PROXIMITY_HORIZON) return 0;
	const proximity = 1 - receiverDist / PASS_CONFIG.GOAL_PROXIMITY_HORIZON;
	const distFactor = proximity * proximity;
	const openAngle = computeOpenAngle(receiver.x, receiver.y, goalX);
	const angleFactor = Math.min(1, openAngle / MAX_OPEN_ANGLE);
	return distFactor * .35 + angleFactor * proximity * .65;
}
/**
* Width preference score — 0..1 based on lateral distance from pitch center.
* Reserved for future tactical use; currently returns 0 (neutral).
*/
function getWidthScore(_receiver) {
	return 0;
}
/**
* Far-flank reward — 0..1 for a receiver on the OPPOSITE side of the pitch
* (relative to y-centre) from the holder. Ramps from 0 at the centre line to
* 1 at the far touchline. Returns 0 when the receiver is on the holder's own
* side, so it only rewards genuine switches of play.
*
* Generic geometric primitive — the consumer (scorePassToReceiverBreakdown)
* applies it whenever an intent declares a `far_flank` passTarget bias, never
* by naming a specific intent.
*/
function getFarFlankScore(holder, receiver) {
	const holderFromCentre = holder.y - 37;
	const receiverFromCentre = receiver.y - 37;
	if (holderFromCentre === 0) return 0;
	if (!(Math.sign(receiverFromCentre) === -Math.sign(holderFromCentre))) return 0;
	return Math.min(1, Math.abs(receiverFromCentre) / 37);
}
function scorePassToReceiverBreakdown(holder, receiver, opponents, intent = "balanced") {
	const baseCfg = getTeamPassConfig(holder.team);
	const cfg = {
		...baseCfg,
		...applyPassIntent(baseCfg, intent)
	};
	const laneScore = getLaneScore(holder, receiver, opponents, getTeamWidth(holder.team));
	const progressScore = getProgressScore(holder, receiver);
	const receiverSpaceScore = getReceiverSpaceScore(receiver, opponents);
	const distancePenalty = getDistancePenalty(holder, receiver);
	const goalProximityBonus = getGoalProximityBonus(holder, receiver);
	const visionRangePenalty = getVisionRangePenalty(holder, receiver);
	const baseScore = progressScore * cfg.PROGRESS_WEIGHT + laneScore * cfg.LANE_WEIGHT + receiverSpaceScore * cfg.RECEIVER_SPACE_WEIGHT + goalProximityBonus * cfg.GOAL_PROXIMITY_WEIGHT - distancePenalty * cfg.DISTANCE_PENALTY_WEIGHT - visionRangePenalty * cfg.DISTANCE_PENALTY_WEIGHT;
	const playerModifier = (holder.runtimeStats.withBall.passingSkill * PASS_CONFIG.PASSING_SKILL_WEIGHT + holder.runtimeStats.withBall.vision * PASS_CONFIG.VISION_WEIGHT + receiver.runtimeStats.withBall.firstTouch * PASS_CONFIG.RECEIVER_CONTROL_WEIGHT) * laneScore;
	const tacticalModifier = getWidthScore(receiver) * PASS_CONFIG.WIDTH_PREFERENCE_WEIGHT;
	const passTargetBias = getPassTargetBias(intent);
	let passTargetBonus = 0;
	if (passTargetBias && passTargetBias.kind === "far_flank") passTargetBonus = getFarFlankScore(holder, receiver) * passTargetBias.weight;
	return {
		laneScore,
		progressScore,
		receiverSpaceScore,
		distancePenalty,
		goalProximityBonus,
		visionRangePenalty,
		baseScore,
		playerModifier,
		tacticalModifier,
		passTargetBonus,
		score: Math.max(0, baseScore + playerModifier + tacticalModifier + passTargetBonus)
	};
}
function scorePassToReceiver(holder, receiver, opponents, intent = "balanced") {
	return scorePassToReceiverBreakdown(holder, receiver, opponents, intent).score;
}
/**
* Score all pass candidates from `holder` to each teammate.
* Delegates to scorePassToReceiver for each candidate.
*/
function evaluatePassLanes(holder, teammates, opponents, intent = "balanced") {
	const baseCfg = getTeamPassConfig(holder.team);
	const cfg = {
		...baseCfg,
		...applyPassIntent(baseCfg, intent)
	};
	return teammates.map((receiver) => {
		const bd = scorePassToReceiverBreakdown(holder, receiver, opponents, intent);
		return {
			toId: receiver.id,
			toX: receiver.x,
			toY: receiver.y,
			open: bd.score >= cfg.MIN_PASS_SCORE,
			score: bd.score,
			switchPass: bd.passTargetBonus > 0
		};
	});
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/OffBallConfig.ts
/**
* Build-up tactic multipliers — applied on top of role intent weights.
* Possession tilts toward support / shape; direct tilts toward runs.
*/
const INTENT_BUILD_UP = {
	possession: {
		offer_support: 1.4,
		hold_space: 1.2,
		make_run: .6
	},
	balanced: {
		offer_support: 1,
		hold_space: 1,
		make_run: 1
	},
	direct: {
		offer_support: .8,
		hold_space: .7,
		make_run: 1.5
	}
};
/**
* Width tactic multipliers — wide play slightly amplifies hold_space because
* stretching width means *not* collapsing toward the ball.
*/
const INTENT_WIDTH = {
	narrow: {
		offer_support: 1,
		hold_space: .95,
		make_run: 1
	},
	normal: {
		offer_support: 1,
		hold_space: 1,
		make_run: 1
	},
	wide: {
		offer_support: 1,
		hold_space: 1.15,
		make_run: 1
	}
};
const OFF_BALL_CONFIG = {
	/** Below this best-cell score → create_space (offensive roles) or idle. */
	MIN_SCORE_THRESHOLD: .2,
	/** Pass score below this → strong offer_support boost. */
	LOW_PASS_SCORE: .35,
	/** Yards radius for counting nearby opponents (local pressure signal). */
	LOCAL_PRESSURE_RADIUS: 6,
	/** Yards — optimal spacing baseline used by same-role cluster penalty. */
	IDEAL_SPACING: 15,
	/** Score reduction per same-role teammate inside IDEAL_SPACING (× 2 in formula). */
	CLUSTER_PENALTY_PER_PLAYER: .35,
	/** Weight of role-fit penalty subtracted from the cell score. */
	ROLE_FIT_WEIGHT: .2,
	/** Per-yard penalty scale for cells outside role bounds. */
	ROLE_FIT_PENALTY_SCALE: .05,
	/** Yards between candidate cells inside the search window. */
	CANDIDATE_STEP: 4,
	/** "Player count" that maps to full teammate-saturation (separation = 0). */
	SEPARATION_NORM_PLAYERS: 1.5,
	/** "Player count" that maps to full opponent-saturation (markFreedom = 0). */
	MARK_NORM_PLAYERS: 1.5,
	/** offer_support — radius around the midway-to-ball anchor. */
	SUPPORT_SEARCH_RADIUS: 12,
	/** hold_space — radius around the formation slot anchor. */
	HOLD_SEARCH_RADIUS: 16,
	/** make_run — radius around the player (anchor is biased forward). */
	RUN_SEARCH_RADIUS: 20,
	SUPPORT_PASS_W: .55,
	SUPPORT_MARK_W: .25,
	SUPPORT_SEP_W: .2,
	HOLD_SEP_W: .5,
	HOLD_SLOT_W: .3,
	HOLD_MARK_W: .2,
	/** Yards — beyond this distance from the slot the slot bonus reaches 0. */
	HOLD_SLOT_SOFT_RADIUS: 18,
	RUN_PROGRESS_W: .5,
	RUN_CLEAR_W: .35,
	RUN_SEP_W: .15,
	/** 0..1 — how strongly the formation slot pulls the off-ball target back. */
	FORMATION_PULL: .3,
	/** Yards — minimum projection distance (low vision). */
	BASE_LOOKAHEAD: 8,
	/** Yards — maximum projection distance (full vision). */
	MAX_LOOKAHEAD: 16,
	/** Yards ahead of holder — make_run penalty starts here. */
	MAX_ADVANCE_THRESHOLD: 10,
	/** Yards ahead of holder — penalty reaches floor here. */
	MAX_ADVANCE_AHEAD: 30,
	/** Minimum score multiplier at full advance. */
	MAX_ADVANCE_FLOOR: .1
};
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/OffBallMovement.ts
const ALL_INTENTS = [
	"offer_support",
	"hold_space",
	"make_run"
];
const CREATE_SPACE_MIN_BIAS = .5;
function getOffBallBias(role) {
	return roleEngine(role).offBallBias;
}
function buildContext(player, ballHolder, allPlayers, opponents, offsideLine, intent, crowdGrid) {
	const relativeAdvance = (player.x - ballHolder.x) * player.attackDir;
	const isAheadOfBall = relativeAdvance > 0;
	let pressureCount = 0;
	for (const opp of opponents) if (Math.sqrt((opp.x - player.x) ** 2 + (opp.y - player.y) ** 2) < OFF_BALL_CONFIG.LOCAL_PRESSURE_RADIUS) pressureCount++;
	const localPressure = Math.min(1, pressureCount / 2);
	return {
		player,
		ballHolder,
		allPlayers,
		opponents,
		offsideLine,
		intent,
		teammatesGrid: player.team === "A" ? crowdGrid.teamAOutfield : crowdGrid.teamBOutfield,
		opponentsGrid: player.team === "A" ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield,
		currentPassScore: scorePassToReceiver(ballHolder, player, opponents, intent),
		isAheadOfBall,
		relativeAdvance,
		localPressure,
		buildUpTactic: getTeamBuildUp(player.team),
		widthTactic: getTeamWidth(player.team),
		attackDir: player.attackDir
	};
}
function selectOffBallIntent(ctx) {
	const roleWeights = roleEngine(ctx.player.role).offBallIntentWeights;
	const buildUpMult = INTENT_BUILD_UP[ctx.buildUpTactic];
	const widthMult = INTENT_WIDTH[ctx.widthTactic];
	const movementUrgency = Math.max(0, 1 - ctx.currentPassScore);
	const scores = {
		offer_support: 0,
		hold_space: 0,
		make_run: 0
	};
	for (const i of ALL_INTENTS) scores[i] = roleWeights[i] * buildUpMult[i] * widthMult[i];
	if (ctx.currentPassScore < OFF_BALL_CONFIG.LOW_PASS_SCORE) scores.offer_support *= 1 + (1 - ctx.currentPassScore) * 1.5;
	scores.offer_support *= .4 + ctx.localPressure * .6 + movementUrgency * .5;
	scores.hold_space *= .6 + (1 - movementUrgency) * .6 + (1 - ctx.localPressure) * .3;
	if (ctx.ballHolder.justReceivedTicks > 0) {
		if (Math.sqrt((ctx.player.x - ctx.ballHolder.x) ** 2 + (ctx.player.y - ctx.ballHolder.y) ** 2) < 15) scores.make_run += .35;
	}
	if (ctx.relativeAdvance > OFF_BALL_CONFIG.MAX_ADVANCE_THRESHOLD) {
		const excess = ctx.relativeAdvance - OFF_BALL_CONFIG.MAX_ADVANCE_THRESHOLD;
		const range = OFF_BALL_CONFIG.MAX_ADVANCE_AHEAD - OFF_BALL_CONFIG.MAX_ADVANCE_THRESHOLD;
		const t = Math.min(1, excess / range);
		scores.make_run *= 1 - t * .9;
	}
	if (ctx.relativeAdvance < -20) scores.make_run *= .5;
	const finalScores = applyOffBallIntent(scores, ctx.intent);
	let best = "offer_support";
	let bestScore = -Infinity;
	for (const i of ALL_INTENTS) if (finalScores[i] > bestScore) {
		bestScore = finalScores[i];
		best = i;
	}
	return {
		intent: best,
		scores: finalScores
	};
}
/**
* Anchor + search radius per intent. The anchor decides where the cell scan is
* centred; the radius decides how far around it we look.
*/
function getAnchor(intent, ctx) {
	const { player, ballHolder, attackDir } = ctx;
	switch (intent) {
		case "offer_support": return {
			x: player.x * .6 + ballHolder.x * .4,
			y: player.y * .6 + ballHolder.y * .4,
			searchRadius: OFF_BALL_CONFIG.SUPPORT_SEARCH_RADIUS
		};
		case "hold_space": return {
			x: player.basePosition.x,
			y: player.basePosition.y,
			searchRadius: OFF_BALL_CONFIG.HOLD_SEARCH_RADIUS
		};
		case "make_run": {
			const fwd = OFF_BALL_CONFIG.RUN_SEARCH_RADIUS * .5;
			return {
				x: player.x + attackDir * fwd,
				y: player.y,
				searchRadius: OFF_BALL_CONFIG.RUN_SEARCH_RADIUS
			};
		}
	}
}
/**
* Sample candidate target cells in a square window around `anchor`. Candidates
* are clamped to the pitch interior (1 yard from the touchlines). Step size
* is grid-derived so candidates roughly align with crowd-grid resolution.
*/
function generateGridCandidates(anchor) {
	const step = OFF_BALL_CONFIG.CANDIDATE_STEP;
	const r = anchor.searchRadius;
	const out = [];
	for (let dx = -r; dx <= r; dx += step) for (let dy = -r; dy <= r; dy += step) {
		const x = anchor.x + dx;
		const y = anchor.y + dy;
		if (x < 1 || x > 114) continue;
		if (y < 1 || y > 73) continue;
		out.push({
			x,
			y
		});
	}
	return out;
}
/**
* 3×3 sample → approximate "nearby player count" (0 = empty).
* When `excludeSelf` is given, the player's own footprint is subtracted so a
* runner sampling its own teammate grid doesn't see itself as a teammate.
*/
function densityCount(grid, x, y, excludeSelf = null) {
	return (excludeSelf ? sampleCellSumExcluding(grid, x, y, excludeSelf.x, excludeSelf.y, 1) : sampleCellSum(grid, x, y, 1)) / 17;
}
/** Soft penalty for cells outside the player's role bounds. */
function getRoleFitPenalty(player, target) {
	return (Math.max(0, target.x - player.bounds.maxX, player.bounds.minX - target.x) + Math.max(0, target.y - player.bounds.maxY, player.bounds.minY - target.y)) * OFF_BALL_CONFIG.ROLE_FIT_PENALTY_SCALE;
}
/** Offside overrun penalty (0 when target is safely behind the line). */
function getOffsidePenalty(target, ctx) {
	if (ctx.offsideLine === null) return 0;
	const safeX = ctx.offsideLine - ctx.attackDir * ATTACK_CONFIG.OFFSIDE_MARGIN;
	const overrun = (target.x - safeX) * ctx.attackDir;
	return overrun > 0 ? overrun * ATTACK_CONFIG.OFFSIDE_AWARENESS * .15 : 0;
}
/** Same-role cluster penalty (tightens the spread of duplicate roles). */
function sameRolePenalty(target, ctx) {
	let pen = 0;
	for (const p of ctx.allPlayers) {
		if (p.id === ctx.player.id || p.team !== ctx.player.team || p.role !== ctx.player.role) continue;
		const d = Math.sqrt((p.x - target.x) ** 2 + (p.y - target.y) ** 2);
		if (d < OFF_BALL_CONFIG.IDEAL_SPACING) pen += (1 - d / OFF_BALL_CONFIG.IDEAL_SPACING) * OFF_BALL_CONFIG.CLUSTER_PENALTY_PER_PLAYER * 2;
	}
	return pen;
}
/**
* Score a single candidate cell for the chosen intent. Each intent reads
* different signals from the crowd grid, so the formulas are intentionally
* intent-specific instead of a giant single weighted sum.
*
* Returned score is roughly [-1, 2]. Compared across cells of the same intent.
*/
function scoreCell(intent, target, ctx) {
	const teammatesNear = densityCount(ctx.teammatesGrid, target.x, target.y, ctx.player);
	const opponentsNear = densityCount(ctx.opponentsGrid, target.x, target.y);
	const separation = Math.max(0, 1 - teammatesNear / OFF_BALL_CONFIG.SEPARATION_NORM_PLAYERS);
	const markFreedom = Math.max(0, 1 - opponentsNear / OFF_BALL_CONFIG.MARK_NORM_PLAYERS);
	const roleFitPen = getRoleFitPenalty(ctx.player, target) * OFF_BALL_CONFIG.ROLE_FIT_WEIGHT;
	const offsidePen = getOffsidePenalty(target, ctx);
	const sameRolePen = sameRolePenalty(target, ctx);
	switch (intent) {
		case "offer_support": return scorePassToCell(ctx.ballHolder, target, ctx.opponents, ctx.intent) * OFF_BALL_CONFIG.SUPPORT_PASS_W + markFreedom * OFF_BALL_CONFIG.SUPPORT_MARK_W + separation * OFF_BALL_CONFIG.SUPPORT_SEP_W - roleFitPen - sameRolePen - offsidePen;
		case "hold_space": {
			const slotDx = target.x - ctx.player.basePosition.x;
			const slotDy = target.y - ctx.player.basePosition.y;
			const slotDist = Math.sqrt(slotDx * slotDx + slotDy * slotDy);
			const slotProx = Math.max(0, 1 - slotDist / OFF_BALL_CONFIG.HOLD_SLOT_SOFT_RADIUS);
			return separation * OFF_BALL_CONFIG.HOLD_SEP_W + slotProx * OFF_BALL_CONFIG.HOLD_SLOT_W + markFreedom * OFF_BALL_CONFIG.HOLD_MARK_W - roleFitPen - sameRolePen - offsidePen;
		}
		case "make_run": {
			const dxFwd = (target.x - ctx.player.x) * ctx.attackDir;
			const forwardProg = Math.max(0, dxFwd) / OFF_BALL_CONFIG.RUN_SEARCH_RADIUS;
			const teammateLight = separation * .5 + .5;
			return forwardProg * OFF_BALL_CONFIG.RUN_PROGRESS_W + markFreedom * OFF_BALL_CONFIG.RUN_CLEAR_W + teammateLight * OFF_BALL_CONFIG.RUN_SEP_W - roleFitPen - sameRolePen - offsidePen;
		}
	}
}
/**
* Lightweight pass quality from `from` to a target *cell* (not a real teammate).
* Builds a synthetic receiver-like object so we can reuse `scorePassToReceiver`
* without spreading pass-scoring logic into this file.
*/
function scorePassToCell(from, target, opponents, intent) {
	return scorePassToReceiver(from, {
		...from,
		x: target.x,
		y: target.y,
		runtimeStats: {
			...from.runtimeStats,
			withBall: {
				...from.runtimeStats.withBall,
				firstTouch: .5
			}
		}
	}, opponents, intent);
}
function createSpaceDirection(player, allPlayers) {
	let nearestOpp = null;
	let nearestDist = Infinity;
	for (const p of allPlayers) {
		if (p.team === player.team) continue;
		const d = Math.sqrt((p.x - player.x) ** 2 + (p.y - player.y) ** 2);
		if (d < nearestDist) {
			nearestDist = d;
			nearestOpp = p;
		}
	}
	if (!nearestOpp || nearestDist < .1) return {
		dx: player.attackDir,
		dy: 0
	};
	let awayDx = player.x - nearestOpp.x;
	let awayDy = player.y - nearestOpp.y;
	const len = Math.sqrt(awayDx * awayDx + awayDy * awayDy);
	awayDx /= len;
	awayDy /= len;
	return {
		dx: awayDx,
		dy: awayDy
	};
}
function evaluateOffBall(player, ballHolder, allPlayers, offsideLine, teamIntent = "balanced", crowdGrid = null) {
	if (crowdGrid == null) return { type: "idle" };
	const ctx = buildContext(player, ballHolder, allPlayers, allPlayers.filter((p) => p.team !== player.team), offsideLine, teamIntent, crowdGrid);
	const { intent, scores: intentScores } = selectOffBallIntent(ctx);
	const candidates = generateGridCandidates(getAnchor(intent, ctx));
	let bestScore = -Infinity;
	let bestTarget = {
		x: player.x + ctx.attackDir,
		y: player.y
	};
	for (const cell of candidates) {
		const s = scoreCell(intent, cell, ctx);
		if (s > bestScore) {
			bestScore = s;
			bestTarget = cell;
		}
	}
	if (bestScore < OFF_BALL_CONFIG.MIN_SCORE_THRESHOLD) {
		if (getOffBallBias(player.role) >= CREATE_SPACE_MIN_BIAS) {
			const away = createSpaceDirection(player, allPlayers);
			if (isDebugEnabled()) gameBus.emit("offBallScores", {
				playerId: player.id,
				playerName: player.name,
				bestScore,
				intent,
				intentScores,
				decision: "create_space",
				currentPassScore: ctx.currentPassScore
			});
			return {
				type: "create_space",
				dx: away.dx,
				dy: away.dy
			};
		}
		if (isDebugEnabled()) gameBus.emit("offBallScores", {
			playerId: player.id,
			playerName: player.name,
			bestScore,
			intent,
			intentScores,
			decision: "idle",
			currentPassScore: ctx.currentPassScore
		});
		return { type: "idle" };
	}
	const ddx = bestTarget.x - player.x;
	const ddy = bestTarget.y - player.y;
	const ddist = Math.sqrt(ddx * ddx + ddy * ddy);
	const dirX = ddist > .1 ? ddx / ddist : ctx.attackDir;
	const dirY = ddist > .1 ? ddy / ddist : 0;
	if (isDebugEnabled()) gameBus.emit("offBallScores", {
		playerId: player.id,
		playerName: player.name,
		bestScore,
		intent,
		intentScores,
		decision: "support_run",
		currentPassScore: ctx.currentPassScore
	});
	return {
		type: "support_run",
		dx: dirX,
		dy: dirY
	};
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Configs/ThroughBallConfig.ts
/**
* ThroughBallConfig — tunable weights and thresholds for through-ball scoring.
*
* A through ball is a pass played into space (not at a teammate's feet) that
* becomes a contested loose ball. Scoring evaluates each candidate grid cell
* for "would dropping the ball here win us the race?"
*
* Edit only here to tune through-ball behaviour — no weights are hardcoded in
* ThroughBallCells.ts.
*
* Source of truth: this file + .claude/rules/game-engine/through-ball.md (TBD).
*/
const THROUGH_BALL_CONFIG = {
	/** Cell must be at least this many yards ahead of the passer in attack dir. */
	MIN_FORWARD_PROGRESS: 5,
	/**
	* The intended runner must currently be at least this many yards BEHIND the
	* cell in attack direction — i.e. they must run *forward* onto it. A cell
	* that is level with or behind the attacker isn't a through ball; it's a
	* sideways/backward pass into space. Setting this slightly negative would
	* tolerate "the run was already starting" cases, but 2 yards forward is the
	* minimum to call it a through ball.
	*/
	MIN_RUNNER_FORWARD_PROGRESS: 2,
	/** Vision = 0 sees this far for through-ball purposes. */
	VISION_HORIZON_MIN: 25,
	/** Vision = 1.0 sees this far. */
	VISION_HORIZON_MAX: 60,
	/** Cell density (opponent footprint, 3×3 sample) above which the cell is too crowded. */
	MAX_OPP_DENSITY: 12,
	/**
	* Race margin — necessary signal (we must reach before the defender) but
	* NOT the primary discriminator vs a regular pass. A pass to feet doesn't
	* need a race; only path-clearness sets a TB apart. So race is moderate.
	*/
	W_RACE: .35,
	/** Open space — derived from the crowd grid. */
	W_SPACE: .2,
	/** Passer skill — vision + passingSkill blend. */
	W_SKILL: .1,
	/**
	* Path clearness — TB-only factor and the *primary* discriminator vs a
	* regular pass. Rewards cells with no defenders between them and the goal,
	* i.e. "the runner is through the line once they collect". This is what
	* makes a TB structurally different from a pass-to-feet — Santos with a
	* clean run scores high here; Santos with a CB ahead scores low.
	*
	* Heaviest TB weight: it's the answer to "does this play put the runner
	* through?" Without a strong path bonus, a tight pass to feet always wins
	* because race+space+goal saturate equally well for both pass kinds.
	*/
	W_PATH: .4,
	/** Lane risk — penalty for opponents along the ball's flight path. */
	W_LANE_RISK: .1,
	/** Offside risk — soft penalty for cells past offside that the *intended runner* couldn't legally reach. */
	W_OFFSIDE: .05,
	/**
	* Goal-threat BUFF — multiplicative reward, NOT an additive weight and NOT a
	* penalty. Final cell score = viability × (1 + GOAL_THREAT_BUFF × goalThreat),
	* where goalThreat ∈ [0,1] blends goal proximity + open shooting angle.
	*
	* Why a buff and not a penalty: we sometimes WANT a pure progression ball into
	* open space with no immediate goal threat (e.g. springing a runner from
	* midfield). Penalising the bad-angle corner would kill those plays. Instead
	* we leave low-threat cells at their full viability and *lift* the cells that
	* also create a genuine goal threat above them. At GOAL_THREAT_BUFF = 0.6 a
	* cell with perfect goal threat (1.0) scores 1.6× a same-viability cell with
	* zero threat — enough to flip a central, good-angle cell ahead of a clean but
	* dead-corner channel, without ever pushing a no-threat progression ball below
	* the selection threshold.
	*/
	GOAL_THREAT_BUFF: .6,
	/** Y-axis cell band around the cell row to sample for forward-path defenders. */
	PATH_ROW_BAND: 5,
	/** Defending-grid density above which path-clearness saturates to 0. */
	PATH_DENSITY_SATURATION: 30,
	/**
	* Sprint speed boost from acceleration when chasing a loose ball.
	* Press uses 1.0 (PRESS_ACCEL_SPEED_BOOST); through-ball chase is more
	* urgent so we use a higher value.
	*/
	SPRINT_ACCEL_BOOST: 1.5,
	/** Top-end speed contribution on a through-ball chase (yds/s per unit speed stat). */
	SPRINT_TOP_BOOST: .5,
	/** Race margin (s) at which we score 1.0 — being 1.0 s faster than the closest defender is decisive. */
	RACE_FAVOUR_HORIZON: 1,
	/** Race deficit (s) at which we score 0 — being 1.5 s slower fades the cell to zero. */
	RACE_LOSS_HORIZON: 1.5,
	/** Crowd-grid 3×3 sum at which `spaceQualityScore` saturates to 0. */
	SPACE_DENSITY_SAT: 30,
	/** Raw cell score that maps to compressed score 0.632 (matches PASS_STRONG_RAW = 1). */
	THROUGH_BALL_STRONG_RAW: .9,
	/** Top-N candidate cells surfaced for debug overlay / event payload. */
	MAX_CANDIDATES: 30,
	/** Yards — std-dev radius of landing-point Gaussian noise at passingSkill = 0. */
	MAX_THROUGH_BALL_ERROR: 3,
	/** Maximum chasers committed per team. */
	MAX_CHASERS_PER_TEAM: 2,
	/** Threshold (seconds): a candidate's ETA must be within (bestEta + this) to commit. */
	ETA_HORIZON: .6,
	/** Minimum role chase weight to be eligible to commit at all. */
	ROLE_CHASE_THRESHOLD: .1,
	/** Yards — a player within this distance of the loose ball can pick it up. */
	LOOSE_BALL_TOUCH_RADIUS: .5,
	/** Yards — both arrivals within this AND on opposing teams → contested duel. */
	DUEL_RADIUS: 2,
	/** Yards — arrival gap below which we duel instead of clean pickup. */
	DUEL_GAP_TRIGGER: 1,
	/**
	* Yds/s — initial residual speed when the through ball lands. The ball keeps
	* trickling forward in the same direction so it never appears frozen mid-pitch.
	* Slow enough that a chasing attacker reaches it within a tick or two, but
	* visible enough to feel realistic.
	*/
	LOOSE_BALL_INITIAL_SPEED: 4,
	/**
	* Yds/s² — friction-style deceleration applied each tick (real seconds).
	* From INITIAL_SPEED=4 with DECEL=2 the ball comes to rest in ~2 real seconds.
	*/
	LOOSE_BALL_DECELERATION: 2
};
/**
* Per-role attacker chase weight — how willing this role is to abandon their
* formation slot and sprint to a loose ball that they'd be the closest to.
*
* GK is 0 (never). Forwards are 1.0 (always). Defenders are very low.
*
* NOTE: These constants live here rather than in `roles.json` for now to keep
* Phase 4 minimal. Phase 6 polish can promote them to JSON to match the
* `defensiveIntentWeights` / `offBallIntentWeights` pattern.
*/
const CHASE_LOOSE_BALL_WEIGHT_ATTACK = {
	GK: 0,
	CB: .05,
	LB: .2,
	RB: .2,
	LWB: .3,
	RWB: .3,
	CDM: .3,
	CM: .55,
	CAM: .8,
	LM: .55,
	RM: .55,
	LW: .95,
	RW: .95,
	ST: 1
};
/**
* Per-role defender chase weight — how willing this role is to step out of
* shape to win a loose ball in their zone (clear it / regain possession).
*
* GK is gated separately — only chases if the ball is inside their own box
* (sweeper-keeper). See `commitLooseBallChasers` in gameState.ts.
*/
const CHASE_LOOSE_BALL_WEIGHT_DEFEND = {
	GK: 0,
	CB: .95,
	LB: .85,
	RB: .85,
	LWB: .8,
	RWB: .8,
	CDM: .85,
	CM: .7,
	CAM: .4,
	LM: .55,
	RM: .55,
	LW: .3,
	RW: .3,
	ST: .1
};
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/Offside.ts
/**
* Returns the effective offside boundary X for the given attacking team.
*
* For attackDir +1 → max(pitchMid, ballX, secondLastDefender.x)
* For attackDir -1 → min(pitchMid, ballX, secondLastDefender.x)
*
* A player whose x is ahead of this value (in the attack direction) is offside.
* Returns `null` when there are fewer than 2 opposing players.
*/
function computeOffsideLine(attackDir, allPlayers, attackingTeam, ballX) {
	const defenders = allPlayers.filter((p) => p.team !== attackingTeam);
	if (defenders.length < 2) return null;
	const sorted = defenders.slice().sort((a, b) => a.x * attackDir - b.x * attackDir);
	const secondLastX = sorted[sorted.length - 2].x;
	return attackDir === 1 ? Math.max(PITCH_MID_X, ballX, secondLastX) : Math.min(PITCH_MID_X, ballX, secondLastX);
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/ThroughBallCells.ts
/**
* Sprint speed for chasing a loose ball — uses pressSpeed as the base and
* adds heavier acceleration / top-end boosts than press to model an all-out chase.
*
* yards/second.
*/
function effectiveSprintSpeed(p) {
	const wb = p.runtimeStats.withoutBall;
	return wb.pressSpeed + wb.acceleration * THROUGH_BALL_CONFIG.SPRINT_ACCEL_BOOST + wb.speed * THROUGH_BALL_CONFIG.SPRINT_TOP_BOOST;
}
/** Seconds for a player to reach a cell at sprint speed (straight-line). */
function etaToCell(p, cx, cy) {
	const dist = Math.hypot(cx - p.x, cy - p.y);
	const speed = effectiveSprintSpeed(p);
	if (speed < .01) return Infinity;
	return dist / speed;
}
/**
* Linear race-margin scorer.
*
*   margin > 0 (we win)  → min(1, margin / RACE_FAVOUR_HORIZON)
*   margin ≤ 0 (we lose) → max(0, 0.5 + margin / RACE_LOSS_HORIZON)
*
* At margin = 0 (perfect tie) the score is 0.5 — treated as a coin-flip cell
* that's worth scoring but not preferred.
*/
function raceMarginScore(margin) {
	if (margin > 0) return Math.min(1, margin / THROUGH_BALL_CONFIG.RACE_FAVOUR_HORIZON);
	return Math.max(0, .5 + margin / THROUGH_BALL_CONFIG.RACE_LOSS_HORIZON);
}
/**
* Open-space score — derived from a 3×3 crowd-grid sample at the cell.
* Saturates to 0 at SPACE_DENSITY_SAT.
*/
function spaceQualityScore(crowd, cx, cy) {
	const density = sampleCellSum(crowd, cx, cy, 1);
	return 1 - Math.min(1, density / THROUGH_BALL_CONFIG.SPACE_DENSITY_SAT);
}
/**
* Goal-threat score — adapted from PassLanes.getGoalProximityBonus.
* Soft horizon (PASS_CONFIG.GOAL_PROXIMITY_HORIZON, 55 yds) replaces the old
* hard cliff at 38.33 yds, so cells just outside the attacking third still
* earn partial goal credit.
*/
function goalThreatScore(holder, cx, cy) {
	const goalX = holder.attackDir === 1 ? 115 : 0;
	const dist = Math.abs(goalX - cx);
	if (dist > PASS_CONFIG.GOAL_PROXIMITY_HORIZON) return 0;
	const proximity = 1 - dist / PASS_CONFIG.GOAL_PROXIMITY_HORIZON;
	const angle = computeOpenAngle(cx, cy, goalX);
	return Math.min(1, angle / MAX_OPEN_ANGLE) * (.4 + .6 * proximity);
}
/**
* Path-clearness score — 0..1. Sums defending outfield density in cells AHEAD
* of (cx, cy) toward the attacking goal, within a vertical row band, normalised
* by PATH_DENSITY_SATURATION. 1 = no defenders between this cell and goal
* (runner is through the line). 0 = path is choked.
*
* This is the TB-only discriminator. A regular pass to feet doesn't get this
* bonus — the receiver still has to dribble past the defensive line — but a
* through ball lands the ball on the goal-side of those defenders.
*
* Adapted from `forwardPathClearness` in DecisionTree.ts (which takes a player
* position; we take a cell position here).
*/
function pathClearScoreForCell(cx, cy, attackDir, defOutfield) {
	const me = {
		col: Math.floor(cx / CELL_W),
		row: Math.floor(cy / CELL_H)
	};
	const startCol = attackDir === 1 ? me.col + 1 : 0;
	const endCol = attackDir === 1 ? 64 : me.col;
	if (endCol <= startCol) return 1;
	const rowBand = THROUGH_BALL_CONFIG.PATH_ROW_BAND;
	const r0 = Math.max(0, me.row - rowBand);
	const r1 = Math.min(39, me.row + rowBand);
	let total = 0;
	for (let r = r0; r <= r1; r++) for (let c = startCol; c < endCol; c++) total += defOutfield[r][c];
	return 1 - Math.min(1, total / THROUGH_BALL_CONFIG.PATH_DENSITY_SATURATION);
}
/**
* Passer-skill score — vision + passingSkill blend, 0..1.
* Unlike regular pass scoring, this is NOT gated by lane clearance — it captures
* the holder's *willingness* to attempt an ambitious through ball, regardless of
* how tight the trajectory is. Lane risk is already its own penalty term.
*/
function passerSkillScore(holder) {
	const wb = holder.runtimeStats.withBall;
	return wb.passingSkill * .5 + wb.vision * .5;
}
/**
* Lane-risk penalty — a defender close to the holder→cell flight path can
* intercept the ball mid-flight. Re-uses the perpendicular-distance check from
* PassLanes but inverts: blocked → penalty 1, clear → penalty 0.
*/
function laneRiskPenalty(holder, cx, cy, opponents) {
	const vx = cx - holder.x;
	const vy = cy - holder.y;
	const lenSq = vx * vx + vy * vy;
	if (lenSq < 1) return 0;
	const blockR = PASS_CONFIG.BLOCK_RADIUS;
	const clearR = PASS_CONFIG.CLEAR_RADIUS;
	let minPerp = Infinity;
	for (const opp of opponents) {
		if (opp.role === "GK") continue;
		const ox = opp.x - holder.x;
		const oy = opp.y - holder.y;
		const t = (ox * vx + oy * vy) / lenSq;
		if (t < .1 || t > 1) continue;
		const perp = Math.hypot(ox - t * vx, oy - t * vy);
		if (perp < minPerp) minPerp = perp;
	}
	if (minPerp === Infinity) return 0;
	return 1 - Math.max(0, Math.min(1, (minPerp - blockR) / (clearR - blockR)));
}
/**
* Offside-risk penalty — soft penalty for cells where the *intended runner*
* (best-ETA attacker) was offside at kick time. Engine enforcement happens
* later; this is a scoring nudge so the holder doesn't pick clearly illegal
* cells.
*/
function offsideRiskPenalty(holder, bestAttacker, offsideLine) {
	if (!bestAttacker || offsideLine === null) return 0;
	const overrun = (bestAttacker.x - offsideLine) * holder.attackDir;
	return overrun > 0 ? Math.min(1, overrun / 5) : 0;
}
function buildTeamSlice(holder, allPlayers, grid) {
	const myTeam = holder.team;
	return {
		attackers: allPlayers.filter((p) => p.team === myTeam && p.id !== holder.id && p.role !== "GK"),
		defenders: allPlayers.filter((p) => p.team !== myTeam && p.role !== "GK"),
		defendersAll: allPlayers.filter((p) => p.team !== myTeam),
		oppMatrix: grid ? myTeam === "A" ? grid.teamB : grid.teamA : null,
		crowdMatrix: grid ? grid.crowd : null,
		defOutfieldMatrix: grid ? myTeam === "A" ? grid.teamBOutfield : grid.teamAOutfield : null
	};
}
/**
* Enumerate and score through-ball candidate cells.
* Returns at most THROUGH_BALL_CONFIG.MAX_CANDIDATES cells, sorted by score desc.
*/
function enumerateCandidateCells(holder, allPlayers, grid, offsideLine) {
	const slice = buildTeamSlice(holder, allPlayers, grid);
	if (slice.attackers.length === 0) return [];
	const visionHorizon = THROUGH_BALL_CONFIG.VISION_HORIZON_MIN + holder.runtimeStats.withBall.vision * (THROUGH_BALL_CONFIG.VISION_HORIZON_MAX - THROUGH_BALL_CONFIG.VISION_HORIZON_MIN);
	const survivors = [];
	for (let r = 1; r < 39; r++) for (let c = 1; c < 63; c++) {
		const cx = (c + .5) * CELL_W;
		const cy = (r + .5) * CELL_H;
		if ((cx - holder.x) * holder.attackDir < THROUGH_BALL_CONFIG.MIN_FORWARD_PROGRESS) continue;
		if (!(holder.attackDir === 1 ? cx > 57.5 : cx < 57.5)) continue;
		if (Math.hypot(cx - holder.x, cy - holder.y) > visionHorizon) continue;
		if (slice.oppMatrix) {
			if (sampleCellSum(slice.oppMatrix, cx, cy, 1) > THROUGH_BALL_CONFIG.MAX_OPP_DENSITY) continue;
		}
		let bestAttackerId = null;
		let bestAttacker = null;
		let bestAttackerEta = Infinity;
		for (const a of slice.attackers) {
			if ((cx - a.x) * holder.attackDir < THROUGH_BALL_CONFIG.MIN_RUNNER_FORWARD_PROGRESS) continue;
			const eta = etaToCell(a, cx, cy);
			if (eta < bestAttackerEta) {
				bestAttackerEta = eta;
				bestAttackerId = a.id;
				bestAttacker = a;
			}
		}
		if (!bestAttacker) continue;
		let bestDefenderId = null;
		let bestDefenderEta = Infinity;
		for (const d of slice.defendersAll) {
			const eta = etaToCell(d, cx, cy);
			if (eta < bestDefenderEta) {
				bestDefenderEta = eta;
				bestDefenderId = d.id;
			}
		}
		const raceMargin = bestDefenderEta - bestAttackerEta;
		const raceScore = bestAttacker ? raceMarginScore(raceMargin) : 0;
		const spaceScore = slice.crowdMatrix ? spaceQualityScore(slice.crowdMatrix, cx, cy) : .5;
		const goalScore = goalThreatScore(holder, cx, cy);
		const skillScore = passerSkillScore(holder);
		const pathScore = slice.defOutfieldMatrix ? pathClearScoreForCell(cx, cy, holder.attackDir, slice.defOutfieldMatrix) : .5;
		const laneRisk = laneRiskPenalty(holder, cx, cy, slice.defendersAll);
		const offsideRisk = offsideRiskPenalty(holder, bestAttacker, offsideLine);
		const cfg = THROUGH_BALL_CONFIG;
		const viability = raceScore * cfg.W_RACE + spaceScore * cfg.W_SPACE + skillScore * cfg.W_SKILL + pathScore * cfg.W_PATH - laneRisk * cfg.W_LANE_RISK - offsideRisk * cfg.W_OFFSIDE;
		const score = Math.max(0, viability) * (1 + cfg.GOAL_THREAT_BUFF * goalScore * raceScore);
		survivors.push({
			col: c,
			row: r,
			x: cx,
			y: cy,
			score,
			components: {
				raceMarginScore: raceScore,
				spaceQualityScore: spaceScore,
				goalThreatScore: goalScore,
				passerSkillScore: skillScore,
				pathClearScore: pathScore,
				laneRiskPenalty: laneRisk,
				offsideRiskPenalty: offsideRisk,
				bestAttackerId,
				bestAttackerEta,
				bestDefenderId,
				bestDefenderEta,
				raceMargin
			}
		});
	}
	survivors.sort((a, b) => b.score - a.score);
	return survivors.slice(0, THROUGH_BALL_CONFIG.MAX_CANDIDATES);
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/DecisionTree.ts
/** A player in recovery from a duel (tackle or dribble) cannot make defensive decisions. */
function isPlayerInRecovery(player) {
	return player.recoveryTime > 0;
}
const EMPTY_DECISION_MEMORY = {
	path: null,
	decision: null,
	commitTicks: 0
};
/**
* How many additional ticks a decision is held after it is made.
* 0 = re-decide every tick. Higher values prevent flickering between decisions.
*/
const COMMIT_TICKS = {
	shoot: 0,
	carry: 5,
	pass: 0,
	through_ball: 0,
	dribble: 4,
	tackle: 0,
	press: 8,
	support_run: 5,
	create_space: 5,
	chase_loose_ball: 6,
	hold_shape: 8,
	track_mark: 10,
	step_into_carry_lane: 6,
	idle: 0
};
/**
* Maps a raw action score [0, ∞) to (0, 1) with diminishing returns.
* Score can never reach 1.0 — approaching it requires exponentially better
* situations, so the decision space stays differentiated near the top.
*
* `strongRaw` is the raw value that represents "a strong action in this domain" —
* at raw=strongRaw the score is always 0.632, regardless of domain.
* This normalises action types with different raw ranges so they compete fairly.
*
* Per-action calibration (what raw=strongRaw means):
*   SHOOT (1.5) — ST at xg/threshold=1.5 → xG=0.375 at threshold=0.25 — a clear good chance
*   CARRY (0.9) — clear lane with decent player — a solid advancing opportunity
*   PASS  (0.8) — open lane to a good receiver — a quality passing option
*
* Reference points at each STRONG_RAW:
*   shoot: xg/thr=0.5→0.28  1.0→0.49  1.5→0.63  2.5→0.81  3.8→0.92
*   carry: lane=0.5→0.43    0.9→0.63  1.1→0.71  1.5→0.81
*   pass:  score=0.5→0.46   0.8→0.63  1.0→0.71  1.4→0.83
*/
function compress(raw, strongRaw = 1) {
	return 1 - Math.exp(-raw / strongRaw);
}
const SHOOT_STRONG_RAW = 1.8;
const CARRY_STRONG_RAW = .8;
const PASS_STRONG_RAW = 1;
/**
* Dribble raw = roleTendency×0.6 + forwardBlock×0.4, max 1.0.
* A winger (carryBias≈0.7) with defender fully ahead → raw≈0.82 → score 0.632.
*/
const DRIBBLE_STRONG_RAW = .8;
/** Through-ball raw scoring: a strong cell (race margin ≈1s, open, central, skilled passer) ≈ 0.9 → 0.632. */
const THROUGH_BALL_STRONG_RAW = .9;
/**
* Evaluate three carry lanes (straight to goal, ±30°) and return the best
* direction — or null if all lanes score below MIN_TOTAL_SCORE.
*/
/**
* How much the role-fit penalty is reduced when the whole team is advanced.
* At full team advance (everyone in opponent half): penalty × (1 - MAX_ADVANCE_SOFTENING).
* Prevents punishing a CB for stepping up when the entire team is pressing high.
*/
const MAX_ADVANCE_SOFTENING = .75;
/**
* Forward path clearness for the carrier, in [0, 1].
*
*   1 = no defending outfielders between the carrier and the goal (wide-open run)
*   0 = path is choked with defenders
*
* Sums the defending team's outfield density (GK excluded) in the cells ahead
* of the carrier's row band, normalised by `PATH_DENSITY_SATURATION`. Used to
* fade the role-fit and byline penalties — both penalties exist to discourage
* out-of-position carries that lose the ball or get forced wide. Neither
* failure mode applies when nobody is in the way.
*
* Returns 0 when no grid is available so existing penalties stay full strength
* for any caller that hasn't been wired up yet.
*/
function forwardPathClearness(player, defendingOutfield) {
	if (defendingOutfield == null) return 0;
	const cfg = getTeamCarryConfig(player.team);
	const me = getCellIndex(player.x, player.y);
	const startCol = player.attackDir === 1 ? me.col + 1 : 0;
	const endCol = player.attackDir === 1 ? 64 : me.col;
	if (endCol <= startCol) return 1;
	const rowBand = cfg.FORWARD_PATH_ROW_BAND;
	const r0 = Math.max(0, me.row - rowBand);
	const r1 = Math.min(39, me.row + rowBand);
	let total = 0;
	for (let r = r0; r <= r1; r++) for (let c = startCol; c < endCol; c++) total += defendingOutfield[r][c];
	return 1 - Math.min(1, total / cfg.PATH_DENSITY_SATURATION);
}
function getBestCarryLane(player, opponents, allPlayers, defendingOutfield, intent = "balanced") {
	const baseCfg = getTeamCarryConfig(player.team);
	const cfg = {
		...baseCfg,
		...applyCarryIntent(baseCfg, intent)
	};
	const teammates = allPlayers.filter((p) => p.team === player.team && p.role !== "GK");
	const avgX = teammates.length > 0 ? teammates.reduce((s, p) => s + p.x, 0) / teammates.length : player.x;
	const rolePenaltyScale = 1 - (player.attackDir === 1 ? Math.max(0, Math.min(1, (avgX - 115 / 2) / (115 / 2))) : Math.max(0, Math.min(1, (115 / 2 - avgX) / (115 / 2)))) * MAX_ADVANCE_SOFTENING;
	const goalX = player.attackDir === 1 ? 115 : 0;
	const goalTargetY = Math.max(33, Math.min(41, player.y));
	const tgDx = goalX - player.x;
	const tgDy = goalTargetY - player.y;
	const tgDist = Math.sqrt(tgDx * tgDx + tgDy * tgDy);
	if (tgDist < .01) return null;
	const baseDx = tgDx / tgDist;
	const baseDy = tgDy / tgDist;
	const lanes = [
		{
			dx: baseDx,
			dy: baseDy
		},
		rot(baseDx, baseDy, -Math.PI / 6),
		rot(baseDx, baseDy, +Math.PI / 6)
	];
	for (const extra of getExtraCarryLanes(intent)) if (extra.dir === "far_flank") {
		const towardFar = player.y < 37 ? 1 : -1;
		const fdx = player.attackDir * .2;
		const fdy = towardFar;
		const mag = Math.sqrt(fdx * fdx + fdy * fdy);
		lanes.push({
			dx: fdx / mag,
			dy: fdy / mag,
			scoreBonus: extra.scoreBonus
		});
	}
	let bestLane = null;
	let bestScore = cfg.MIN_TOTAL_SCORE;
	const penaltyDamper = 1 - forwardPathClearness(player, defendingOutfield);
	for (const lane of lanes) {
		const breakdown = evaluateCarryLaneBreakdown(player, lane.dx, lane.dy, goalTargetY, opponents, cfg);
		const rawScore = breakdown.score;
		const targetX = player.x + lane.dx * cfg.LOOKAHEAD_DISTANCE;
		const targetY = player.y + lane.dy * cfg.LOOKAHEAD_DISTANCE;
		const rolePenalty = (Math.max(0, targetX - player.bounds.maxX, player.bounds.minX - targetX) + Math.max(0, targetY - player.bounds.maxY, player.bounds.minY - targetY)) * cfg.ROLE_FIT_PENALTY_SCALE * rolePenaltyScale * penaltyDamper;
		const distToEndLine = ((player.attackDir === 1 ? 115 : 0) - player.x) * player.attackDir;
		const forwardComp = Math.max(0, lane.dx * player.attackDir);
		let bylinePenalty = 0;
		if (distToEndLine < cfg.BYLINE_PENALTY_START && forwardComp > 0) bylinePenalty = (1 - distToEndLine / cfg.BYLINE_PENALTY_START) * forwardComp * cfg.BYLINE_MAX_PENALTY * penaltyDamper;
		const score = rawScore - rolePenalty - bylinePenalty + (lane.scoreBonus ?? 0);
		if (score > bestScore) {
			bestScore = score;
			bestLane = {
				dx: lane.dx,
				dy: lane.dy,
				score,
				breakdown,
				rolePenalty,
				bylinePenalty,
				laneBonus: lane.scoreBonus ?? 0,
				rawScore
			};
		}
	}
	return bestLane;
}
const MIN_ACTION_SCORE = .15;
/**
* The xG value at which this role considers a shot "certain enough to take".
* xG is divided by this threshold and clamped to 1 before quadratic scoring,
* so ST will shoot eagerly at moderate xG while CB will only shoot at high xG.
*/
const SHOOT_THRESHOLD = {
	ST: .25,
	LW: .3,
	RW: .3,
	CAM: .29,
	LM: .42,
	RM: .42,
	CM: .5,
	CDM: .6,
	LWB: .65,
	RWB: .65,
	LB: .72,
	RB: .72,
	CB: .78,
	GK: 9.99
};
function evalShoot(player, opponents, intent) {
	const goalX = player.attackDir === 1 ? 115 : 0;
	const dist = Math.abs(goalX - player.x);
	const openAngle = computeOpenAngle(player.x, player.y, goalX);
	const pressure = computeWeightedPressure(player, opponents);
	const xg = computeXG(dist, openAngle, pressure);
	const threshold = (SHOOT_THRESHOLD[player.role] ?? .5) * globalThis.__tpCal.shoot_threshold_scale;
	const roleScore = compress(xg / threshold, SHOOT_STRONG_RAW);
	const xgFloor = Math.pow(xg, globalThis.__tpCal.xg_floor_pow);
	const intentBonus = getShootIntentBonus(intent);
	const score = Math.max(roleScore, xgFloor) + intentBonus;
	return {
		type: "shoot",
		score,
		shootBreakdown: {
			dist,
			openAngle,
			pressure,
			xg,
			threshold,
			roleScore,
			xgFloor,
			intentBonus,
			score
		}
	};
}
function evalPass(player, opponents, allPlayers, intent) {
	const teammates = allPlayers.filter((p) => p.team === player.team && p.id !== player.id);
	if (teammates.length === 0) return {
		type: "pass",
		score: 0,
		passBreakdown: {
			toId: null,
			laneScore: 0,
			progressScore: 0,
			receiverSpaceScore: 0,
			distancePenalty: 0,
			goalProximityBonus: 0,
			visionRangePenalty: 0,
			passTargetBonus: 0,
			baseScore: 0,
			playerModifier: 0,
			tacticalModifier: 0,
			rawScore: 0,
			score: 0
		}
	};
	const best = evaluatePassLanes(player, teammates, opponents, intent).reduce((a, b) => b.score > a.score ? b : a);
	const bestReceiver = teammates.find((p) => p.id === best.toId);
	const breakdown = bestReceiver ? scorePassToReceiverBreakdown(player, bestReceiver, opponents, intent) : null;
	return {
		type: "pass",
		score: compress(best.score, PASS_STRONG_RAW),
		targetId: best.toId,
		passBreakdown: breakdown ? {
			toId: best.toId,
			rawScore: best.score,
			...breakdown
		} : {
			toId: best.toId,
			laneScore: 0,
			progressScore: 0,
			receiverSpaceScore: 0,
			distancePenalty: 0,
			goalProximityBonus: 0,
			visionRangePenalty: 0,
			baseScore: 0,
			playerModifier: 0,
			tacticalModifier: 0,
			passTargetBonus: 0,
			rawScore: best.score,
			score: best.score
		}
	};
}
function evalCarry(player, outfieldOpponents, allPlayers, defendingOutfield, intent) {
	const lane = getBestCarryLane(player, outfieldOpponents, allPlayers, defendingOutfield, intent);
	if (!lane) return {
		type: "carry",
		score: 0,
		carryBreakdown: null
	};
	const score = compress(lane.score, CARRY_STRONG_RAW);
	const b = lane.breakdown;
	return {
		type: "carry",
		score,
		dx: lane.dx,
		dy: lane.dy,
		carryBreakdown: {
			dx: lane.dx,
			dy: lane.dy,
			clearanceScore: b.clearanceScore,
			progressScore: b.progressScore,
			angleScore: b.angleScore,
			crowdPenalty: b.crowdPenalty,
			roleBias: b.roleBias,
			visionBonus: b.visionBonus,
			pressurePenalty: b.pressurePenalty,
			baseScore: b.baseScore,
			playerModifier: b.playerModifier,
			rolePenalty: lane.rolePenalty,
			bylinePenalty: lane.bylinePenalty,
			laneBonus: lane.laneBonus,
			rawScore: lane.rawScore,
			score: lane.score
		}
	};
}
/**
* Evaluate through-ball candidates for the holder. Returns an ActionScore with
* the best cell + intended runner, plus the full ranked cell list so the debug
* emit can reuse it without re-scoring.
*
* `cachedCells` — if provided (the engine's per-tick TB cache), skip the grid
* enumeration and use the cached cells. Safe because the dominant ranking
* signals (race margin, path clearness) shift slowly, and the cache is
* invalidated on holder change. See `tickState` in gameState.ts.
*/
function evalThroughBall(player, allPlayers, crowdGrid, cachedCells = null) {
	let cells;
	if (cachedCells !== null) cells = cachedCells;
	else cells = enumerateCandidateCells(player, allPlayers, crowdGrid, computeOffsideLine(player.attackDir, allPlayers, player.team, player.x));
	if (cells.length === 0) return {
		action: {
			type: "through_ball",
			score: 0
		},
		cells
	};
	const best = cells[0];
	return {
		action: {
			type: "through_ball",
			score: compress(best.score, THROUGH_BALL_STRONG_RAW),
			cellX: best.x,
			cellY: best.y,
			intendedRunnerId: best.components.bestAttackerId
		},
		cells
	};
}
function evalDribble(player, opponents) {
	const roleTendency = roleEngine(player.role).carryBias;
	if (roleTendency < .25) return {
		type: "dribble",
		score: 0,
		dribbleBreakdown: {
			targetId: null,
			roleTendency,
			forwardBlock: 0,
			rawScore: 0,
			score: 0
		}
	};
	let closestDist = Infinity;
	let closest = null;
	for (const opp of opponents) {
		if (opp.recoveryTime > 0) continue;
		const d = Math.sqrt((opp.x - player.x) ** 2 + (opp.y - player.y) ** 2);
		if (d < closestDist) {
			closestDist = d;
			closest = opp;
		}
	}
	if (!closest || closestDist > 8) return {
		type: "dribble",
		score: 0,
		dribbleBreakdown: {
			targetId: closest?.id ?? null,
			roleTendency,
			forwardBlock: 0,
			rawScore: 0,
			score: 0
		}
	};
	const fwdDx = (closest.x - player.x) * player.attackDir;
	const fwdDist = Math.sqrt((closest.x - player.x) ** 2 + (closest.y - player.y) ** 2);
	const forwardBlock = fwdDist > 0 ? Math.max(0, fwdDx / fwdDist) : 0;
	const raw = roleTendency * .6 + forwardBlock * .4;
	const score = compress(raw, DRIBBLE_STRONG_RAW);
	return {
		type: "dribble",
		score,
		targetId: closest.id,
		dribbleBreakdown: {
			targetId: closest.id,
			roleTendency,
			forwardBlock,
			rawScore: raw,
			score
		}
	};
}
function decideBallHolder(player, allPlayers, crowdGrid, intent, tbCachedCells = null) {
	const opponents = allPlayers.filter((p) => p.team !== player.team && !isPlayerInRecovery(p));
	const outfieldOpponents = opponents.filter((p) => p.role !== "GK");
	const defendingOutfield = crowdGrid == null ? null : player.team === "A" ? crowdGrid.teamBOutfield : crowdGrid.teamAOutfield;
	const sh = evalShoot(player, opponents, intent);
	const ps = evalPass(player, opponents, allPlayers, intent);
	const ca = evalCarry(player, outfieldOpponents, allPlayers, defendingOutfield, intent);
	const dr = evalDribble(player, outfieldOpponents);
	const tbResult = evalThroughBall(player, allPlayers, crowdGrid, tbCachedCells);
	const tb = tbResult.action;
	const best = [
		sh,
		ca,
		ps,
		dr,
		tb
	].reduce((a, b) => b.score > a.score ? b : a);
	if (isDebugEnabled()) {
		const shootBd = sh.shootBreakdown ?? {
			dist: 0,
			openAngle: 0,
			pressure: 0,
			xg: 0,
			threshold: 0,
			roleScore: 0,
			xgFloor: 0,
			intentBonus: 0,
			score: 0
		};
		const passBd = ps.passBreakdown ?? {
			toId: null,
			laneScore: 0,
			progressScore: 0,
			receiverSpaceScore: 0,
			distancePenalty: 0,
			goalProximityBonus: 0,
			visionRangePenalty: 0,
			passTargetBonus: 0,
			baseScore: 0,
			playerModifier: 0,
			tacticalModifier: 0,
			rawScore: 0,
			score: 0
		};
		const dribbleBd = dr.dribbleBreakdown ?? {
			targetId: null,
			roleTendency: 0,
			forwardBlock: 0,
			rawScore: 0,
			score: 0
		};
		gameBus.emit("decisionScores", {
			playerName: player.name,
			playerId: player.id,
			shoot: sh.score,
			pass: ps.score,
			carry: ca.score,
			dribble: dr.score,
			throughBall: tb.score,
			best: best.type,
			breakdowns: {
				shoot: shootBd,
				pass: passBd,
				carry: ca.carryBreakdown ?? null,
				dribble: dribbleBd
			}
		});
		gameBus.emit("throughBallScores", {
			playerId: player.id,
			playerName: player.name,
			bestScore: tbResult.cells.length > 0 ? tbResult.cells[0].score : 0,
			cells: tbResult.cells.map((c) => ({
				x: c.x,
				y: c.y,
				score: c.score,
				raceMargin: c.components.raceMargin,
				bestAttackerId: c.components.bestAttackerId,
				bestAttackerEta: c.components.bestAttackerEta,
				bestDefenderId: c.components.bestDefenderId,
				bestDefenderEta: c.components.bestDefenderEta,
				raceMarginScore: c.components.raceMarginScore,
				spaceQualityScore: c.components.spaceQualityScore,
				goalThreatScore: c.components.goalThreatScore,
				passerSkillScore: c.components.passerSkillScore,
				pathClearScore: c.components.pathClearScore,
				laneRiskPenalty: c.components.laneRiskPenalty,
				offsideRiskPenalty: c.components.offsideRiskPenalty
			}))
		});
	}
	if (best.score < MIN_ACTION_SCORE) {
		const lane = getBestCarryLane(player, outfieldOpponents, allPlayers, defendingOutfield, intent);
		if (lane) return {
			type: "carry",
			dx: lane.dx,
			dy: lane.dy
		};
		return { type: "pass" };
	}
	switch (best.type) {
		case "shoot": return { type: "shoot" };
		case "pass": return { type: "pass" };
		case "carry": return {
			type: "carry",
			dx: best.dx,
			dy: best.dy
		};
		case "dribble": return {
			type: "dribble",
			targetId: best.targetId
		};
		case "through_ball": return {
			type: "through_ball",
			cellX: best.cellX,
			cellY: best.cellY,
			intendedRunnerId: best.intendedRunnerId ?? null
		};
	}
}
/**
* Evaluate what a single player should do this tick.
*
* @param player        The player being evaluated.
* @param ballHolder    The player currently holding the ball (or last holder during flight).
* @param hasBall       True if `player` is the ball holder.
* @param ballInFlight  True if a pass or shot is currently in flight.
* @param allPlayers    All players — used by the carry lane scan.
* @param setPiece      Active set piece (kickoff / offside_fk / goal_kick) — forces the
*                      taker to pass, never carry/dribble/shoot. Non-takers behave normally.
* @param crowdGrid     Per-tick density grid; carry scoring uses the defending team's
*                      outfield matrix to fade role-fit/byline penalties on a clear run.
*                      Pass `null` to skip the clearness check (penalties stay full).
*/
function decide(player, ballHolder, hasBall, ballInFlight, allPlayers, offsideLine, possessionTime, setPiece = null, crowdGrid = null, teamIntent = {
	A: "balanced",
	B: "balanced"
}, tbCachedCells = null) {
	if (hasBall) {
		if (setPiece && player.id === setPiece.takerId) return { type: "pass" };
		return decideBallHolder(player, allPlayers, crowdGrid, teamIntent[player.team], tbCachedCells);
	}
	if (player.team === ballHolder.team) {
		if (player.role === "GK") return { type: "idle" };
		return evaluateOffBall(player, ballHolder, allPlayers, offsideLine, teamIntent[player.team], crowdGrid);
	}
	const dx = ballHolder.x - player.x;
	const dy = ballHolder.y - player.y;
	const dist = Math.sqrt(dx * dx + dy * dy);
	if (isPlayerInRecovery(player)) return { type: "idle" };
	if (dist <= 2) return {
		type: "tackle",
		targetId: ballHolder.id
	};
	if (player.role === "GK") return { type: "idle" };
	return evaluateDefensiveDecision(player, ballHolder, allPlayers, possessionTime, crowdGrid, teamIntent[player.team]);
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/AttackingPositioning.ts
function computeAttackingPosition(player, ballPos, allPlayers, formation, offsideLine, possessionTime = 0) {
	const { ballSupportScale, bounds } = player;
	const base = resolveBasePosition(player.slotIndex, player.attackDir, formation, "attacking");
	const anchorX = base.x;
	const anchorY = base.y;
	let rawX = anchorX;
	let rawY = anchorY;
	const distToBall = Math.sqrt((ballPos.x - player.x) ** 2 + (ballPos.y - player.y) ** 2);
	const influenceRange = ATTACK_CONFIG.SUPPORT_DISTANCE * 2;
	const proximityFactor = Math.max(0, 1 - distToBall / influenceRange);
	const influenceWeight = ballSupportScale * ATTACK_CONFIG.BALL_INFLUENCE_WEIGHT * proximityFactor;
	rawY += (ballPos.y - anchorY) * influenceWeight;
	rawX += (ballPos.x - anchorX) * influenceWeight * .25;
	const teammates = allPlayers.filter((p) => p.team === player.team && p.id !== player.id);
	let pushX = 0;
	let pushY = 0;
	for (const tm of teammates) {
		const dx = player.x - tm.x;
		const dy = player.y - tm.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < .1 || dist >= ATTACK_CONFIG.SUPPORT_DISTANCE) continue;
		const strength = (ATTACK_CONFIG.SUPPORT_DISTANCE - dist) / ATTACK_CONFIG.SUPPORT_DISTANCE;
		pushX += dx / dist * strength;
		pushY += dy / dist * strength;
	}
	rawX += pushX * ATTACK_CONFIG.SPACING_WEIGHT;
	rawY += pushY * ATTACK_CONFIG.SPACING_WEIGHT;
	rawX = anchorX + (rawX - anchorX) * ATTACK_CONFIG.POSITIONAL_FREEDOM;
	rawY = anchorY + (rawY - anchorY) * ATTACK_CONFIG.POSITIONAL_FREEDOM;
	const pushUpT = Math.min(1, possessionTime / POSSESSION_PUSH_UP.BASE_SECONDS);
	const pushUpBias = PUSH_UP_ROLE_BIAS[player.role] ?? 0;
	if (pushUpBias > 0 && pushUpT > 0) rawX += player.attackDir * pushUpT * POSSESSION_PUSH_UP.MAX_YARDS * pushUpBias;
	if (offsideLine !== null) {
		const fwd = player.attackDir;
		const safeX = offsideLine - fwd * ATTACK_CONFIG.OFFSIDE_MARGIN;
		const overrun = (rawX - safeX) * fwd;
		if (overrun > 0) rawX -= overrun * ATTACK_CONFIG.OFFSIDE_AWARENESS * fwd;
	}
	return {
		x: Math.max(0, Math.min(115, rawX)),
		y: Math.max(bounds.minY, Math.min(bounds.maxY, rawY))
	};
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/Positioning.ts
/**
* Returns the target position for `player` this tick.
*
* @param player          The player to position.
* @param phase           'attacking' | 'defending' — which team has the ball.
* @param ballPos         Current ball position in yards.
* @param allPlayers      All players — used by attacking spacing and lane gravity.
* @param formation       The player's team formation — provides slot anchor positions.
* @param ballHolderId    Id of the current ball holder — used for lane gravity.
* @param playerDecision  Current decision type for this player — pressing defenders skip lane gravity.
* @param offsideLine     Pre-computed offside line X for this player's team (null = not enough defenders).
* @param markTargetId    Pre-assigned opponent id for marking (defending only, from 1:1 assignment).
*/
function computeTargetPosition(player, phase, ballPos, allPlayers, formation, ballHolderId, playerDecision, offsideLine, markTargetId, possessionTime) {
	return phase === "defending" ? computeDefensivePosition(player, ballPos, allPlayers, formation, ballHolderId ?? -1, playerDecision, markTargetId) : computeAttackingPosition(player, ballPos, allPlayers, formation, offsideLine ?? null, possessionTime ?? 0);
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/TeamLineup.ts
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
function teamLineup(raw, role) {
	return {
		withBall: {
			shootAccuracy: role === "GK" ? 0 : Math.min(.95, raw.finishing / 10),
			carrySpeed: 5 + raw.speed / 10 * 4,
			carryVision: role === "GK" ? 0 : 6 + raw.vision * 1.2,
			speed: raw.speed / 10,
			acceleration: raw.acceleration / 10,
			passingSkill: raw.passing / 10,
			vision: raw.vision / 10,
			firstTouch: raw.dribbling / 10,
			dribbling: raw.dribbling / 10,
			strength: (raw.strength ?? 5) / 10
		},
		withoutBall: {
			pressSpeed: 5 + raw.speed / 10 * 4,
			pressRange: PRESS_RANGE_BASE_YARDS,
			speed: raw.speed / 10,
			acceleration: raw.acceleration / 10,
			tackleChance: .1 + raw.tackling * .07,
			tackling: raw.tackling / 10,
			interceptionChance: .05 + raw.pressing * .05 + raw.vision * .02,
			gkPositioning: role === "GK" ? raw.pressing / 10 : 0,
			gkReflex: role === "GK" ? raw.reflex / 10 : 0,
			gkDiving: role === "GK" ? raw.jump / 10 : 0,
			strength: (raw.strength ?? 5) / 10
		}
	};
}
//#endregion
//#region .local/touchlines/upstream/src/GameInterface/positionHelpers.ts
/** Map every detailed position code to its main role. */
const MAIN_ROLE_MAP = {
	GK: "GK",
	Defender: "Defender",
	Midfielder: "Midfielder",
	Forward: "Forward",
	CB: "Defender",
	LB: "Defender",
	RB: "Defender",
	LWB: "Defender",
	RWB: "Defender",
	CDM: "Midfielder",
	DM: "Midfielder",
	CM: "Midfielder",
	CAM: "Midfielder",
	AM: "Midfielder",
	LM: "Midfielder",
	RM: "Midfielder",
	LW: "Forward",
	RW: "Forward",
	ST: "Forward",
	CF: "Forward"
};
/** Returns the main role for a position code (main or detailed). Falls back to "Forward". */
function getMainRole(pos) {
	return MAIN_ROLE_MAP[pos] ?? "Forward";
}
//#endregion
//#region .local/touchlines/upstream/src/Domain/Player.ts
/** All detailed roles mapped to their main role band — used to find a player's best fit. */
const MAIN_ROLE_TO_SPECIFICS = {
	GK: ["GK"],
	Defender: [
		"CB",
		"LB",
		"RB",
		"LWB",
		"RWB"
	],
	Midfielder: [
		"CDM",
		"CM",
		"CAM",
		"LM",
		"RM"
	],
	Forward: [
		"LW",
		"RW",
		"ST"
	]
};
/**
* Roster player model: weighted overall, age, market value, wage, and status bands.
*/
var Player = class Player {
	overallRating;
	age;
	constructor(overallRating, age) {
		this.overallRating = overallRating;
		this.age = age;
	}
	/**
	* Weighted score for a single specific role (e.g. "CB", "CM").
	* Uses a quadratic mean (power mean, p=2) so high-end attributes outweigh
	* mid-range ones — e.g. acc 9 + speed 5 scores higher than acc 8 + speed 6,
	* because a point at the top of the scale is harder to get than one in the middle.
	*/
	static scoreForRole(stats, role) {
		const R = roles_default;
		const weights = R[role]?.attrWeights ?? R["CM"]?.attrWeights ?? {};
		let wSum = 0;
		let wTotal = 0;
		for (const [attr, val] of Object.entries(stats)) {
			const w = weights[attr] ?? 0;
			wSum += val * val * w;
			wTotal += w;
		}
		return wTotal > 0 ? Math.sqrt(wSum / wTotal) : 5;
	}
	/**
	* Weighted score for a role. If a main role (GK / Defender / Midfielder / Forward) is
	* passed, returns the best score across every specific role in that band. Specific roles
	* are scored directly.
	*/
	static weightedScore(stats, position) {
		const specifics = MAIN_ROLE_TO_SPECIFICS[position];
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
	static computeOverallAvg(player) {
		const main = getMainRole(player.positions[0] ?? "CM");
		return Player.weightedScore(player.stats, main);
	}
	/**
	* Returns the player's cached overall AVG, computing and storing it on first access.
	* The cache is invalidated whenever stats change (see `PlayerDevelopment.applyDevelopment`).
	*/
	static overallAvg(player) {
		if (typeof player.overallAvg === "number") return player.overallAvg;
		const v = Player.computeOverallAvg(player);
		player.overallAvg = v;
		return v;
	}
	/** Form band from last 5 ratings average; empty list uses 6.0 baseline. */
	static formToStatus(recentRatings) {
		const avg = recentRatings.length > 0 ? recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length : 6;
		if (avg >= 7.5) return 5;
		if (avg >= 7) return 4;
		if (avg >= 6.5) return 3;
		if (avg >= 6) return 2;
		return 1;
	}
	static moraleToStatus(morale) {
		if (morale >= 85) return 5;
		if (morale >= 70) return 4;
		if (morale >= 50) return 3;
		if (morale >= 30) return 2;
		return 1;
	}
	/** `points` is the accumulated training score (0–5). Maps directly to intensity bands. */
	static trainingToStatus(points) {
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
	get valueMillions() {
		const base = this.overallRating * this.overallRating * .8;
		const a = this.age;
		return base * (a <= 19 ? 2.4 : a <= 21 ? 2 : a <= 23 ? 1.6 : a <= 25 ? 1.3 : a <= 28 ? 1 : a <= 30 ? .75 : a <= 32 ? .5 : a <= 34 ? .3 : .15);
	}
	/** Estimated transfer value in whole pounds. */
	get price() {
		return Math.round(this.valueMillions) * 1e6;
	}
	/** Short label for cards / lists (e.g. `"12.5M"`). */
	get priceLabel() {
		const v = this.valueMillions;
		if (v >= 100) return `${Math.round(v)}M`;
		return `${v.toFixed(1)}M`;
	}
	/** Weekly wage label (e.g. `"45k"`). */
	get salaryLabel() {
		const weekly = Math.round(this.overallRating * this.overallRating * 350);
		if (weekly >= 1e3) return `${(weekly / 1e3).toFixed(0)}k`;
		return `${weekly}`;
	}
};
//#endregion
//#region .local/touchlines/upstream/src/Domain/PlayerBuffs.ts
const LEVEL_EFFECT = {
	1: {
		neg2: 25,
		neg1: 40,
		zero: 35,
		pos1: 0,
		pos2: 0
	},
	2: {
		neg2: 10,
		neg1: 35,
		zero: 45,
		pos1: 10,
		pos2: 0
	},
	3: {
		neg2: 0,
		neg1: 15,
		zero: 70,
		pos1: 15,
		pos2: 0
	},
	4: {
		neg2: 0,
		neg1: 5,
		zero: 55,
		pos1: 30,
		pos2: 10
	},
	5: {
		neg2: 0,
		neg1: 0,
		zero: 40,
		pos1: 40,
		pos2: 20
	}
};
const FORM_BIAS = {
	1: {
		neg: 10,
		pos: -10
	},
	2: {
		neg: 5,
		pos: -5
	},
	3: {
		neg: 0,
		pos: 0
	},
	4: {
		neg: -5,
		pos: 5
	},
	5: {
		neg: -10,
		pos: 10
	}
};
const TRAINING_ATTRS = [
	"speed",
	"acceleration",
	"stamina",
	"strength",
	"jump",
	"tackling",
	"pressing"
];
const MORALE_ATTRS = [
	"passing",
	"vision",
	"finishing",
	"dribbling",
	"heading"
];
function clampStat(n) {
	return n < 0 ? 0 : n > 10 ? 10 : n;
}
/** Copy of table with neg/pos probability shifted; `zero` unchanged; total stays 100. */
function applyFormBias(table, formLevel) {
	const bias = FORM_BIAS[formLevel];
	const t = { ...table };
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
function roll(table, random01 = Math.random) {
	const r = random01() * 100;
	if (r < table.neg2) return -2;
	if (r < table.neg2 + table.neg1) return -1;
	if (r < table.neg2 + table.neg1 + table.zero) return 0;
	if (r < table.neg2 + table.neg1 + table.zero + table.pos1) return 1;
	return 2;
}
function pickRandomSubset(items, count, random01) {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random01() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy.slice(0, Math.min(count, copy.length));
}
function applyTraining(trainingLevel, formLevel, deltas, random01) {
	const base = LEVEL_EFFECT[trainingLevel];
	const table = applyFormBias(base, formLevel);
	const targets = pickRandomSubset(TRAINING_ATTRS, 2, random01);
	for (const attr of targets) if (random01() < .6) deltas[attr] = (deltas[attr] ?? 0) + roll(table, random01);
}
function applyMorale(moraleLevel, formLevel, deltas, random01) {
	const base = LEVEL_EFFECT[moraleLevel];
	const table = applyFormBias(base, formLevel);
	const targets = pickRandomSubset(MORALE_ATTRS, 2, random01);
	for (const attr of targets) if (random01() < .7) deltas[attr] = (deltas[attr] ?? 0) + roll(table, random01);
}
/**
* One-shot pre-match buff: discrete deltas from training and morale tables, biased by form.
* @param random01 - inject for tests; defaults to Math.random
*/
function computeBuffedStats(stats, trainingLevel, moraleLevel, formLevel, random01 = Math.random) {
	const deltas = {};
	applyTraining(trainingLevel, formLevel, deltas, random01);
	applyMorale(moraleLevel, formLevel, deltas, random01);
	const out = { ...stats };
	for (const key of Object.keys(stats)) {
		const delta = deltas[key] ?? 0;
		out[key] = clampStat(stats[key] + delta);
	}
	return out;
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/SetPieceLayouts.ts
const REGISTRY = [
	{
		formationId: "4-3-3",
		kickOff: { slots: [
			{
				role: "GK",
				x: 10,
				y: 37
			},
			{
				role: "LB",
				x: 36,
				y: 11
			},
			{
				role: "CB",
				x: 38,
				y: 28
			},
			{
				role: "CB",
				x: 38,
				y: 46
			},
			{
				role: "RB",
				x: 36,
				y: 63
			},
			{
				role: "CM",
				x: 50,
				y: 24
			},
			{
				role: "CM",
				x: 50,
				y: 50
			},
			{
				role: "CAM",
				x: 45,
				y: 37
			},
			{
				role: "LW",
				x: 55,
				y: 9
			},
			{
				role: "ST",
				x: 57,
				y: 37
			},
			{
				role: "RW",
				x: 55,
				y: 65
			}
		] },
		kickOffDefend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 13,
				y: 11
			},
			{
				role: "CB",
				x: 14,
				y: 28
			},
			{
				role: "CB",
				x: 14,
				y: 46
			},
			{
				role: "RB",
				x: 13,
				y: 63
			},
			{
				role: "CM",
				x: 38,
				y: 24
			},
			{
				role: "CM",
				x: 38,
				y: 50
			},
			{
				role: "CAM",
				x: 36,
				y: 37
			},
			{
				role: "LW",
				x: 50,
				y: 8
			},
			{
				role: "ST",
				x: 45,
				y: 37
			},
			{
				role: "RW",
				x: 50,
				y: 66
			}
		] },
		goalKick: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 13,
				y: 11
			},
			{
				role: "CB",
				x: 15,
				y: 28
			},
			{
				role: "CB",
				x: 15,
				y: 46
			},
			{
				role: "RB",
				x: 13,
				y: 63
			},
			{
				role: "CM",
				x: 38,
				y: 24
			},
			{
				role: "CM",
				x: 38,
				y: 50
			},
			{
				role: "CAM",
				x: 50,
				y: 37
			},
			{
				role: "LW",
				x: 55,
				y: 11
			},
			{
				role: "ST",
				x: 60,
				y: 37
			},
			{
				role: "RW",
				x: 55,
				y: 63
			}
		] },
		corner_Attack: { slots: [
			{
				role: "LW",
				x: 115,
				y: 3
			},
			{
				role: "ST",
				x: 103,
				y: 37
			},
			{
				role: "CAM",
				x: 100,
				y: 28
			},
			{
				role: "CM",
				x: 97,
				y: 50
			},
			{
				role: "CB",
				x: 93,
				y: 28
			},
			{
				role: "CB",
				x: 90,
				y: 46
			},
			{
				role: "CM",
				x: 88,
				y: 20
			},
			{
				role: "RW",
				x: 80,
				y: 65
			},
			{
				role: "LB",
				x: 75,
				y: 12
			},
			{
				role: "RB",
				x: 75,
				y: 62
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		corner_Defend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 10,
				y: 12
			},
			{
				role: "CB",
				x: 9,
				y: 28
			},
			{
				role: "CB",
				x: 9,
				y: 46
			},
			{
				role: "RB",
				x: 10,
				y: 62
			},
			{
				role: "CM",
				x: 18,
				y: 22
			},
			{
				role: "CM",
				x: 18,
				y: 52
			},
			{
				role: "CAM",
				x: 22,
				y: 37
			},
			{
				role: "LW",
				x: 35,
				y: 8
			},
			{
				role: "ST",
				x: 55,
				y: 37
			},
			{
				role: "RW",
				x: 35,
				y: 66
			}
		] },
		throwIn_Attack: { slots: [
			{
				role: "LW",
				x: 70,
				y: 2
			},
			{
				role: "ST",
				x: 75,
				y: 37
			},
			{
				role: "CAM",
				x: 72,
				y: 25
			},
			{
				role: "CM",
				x: 65,
				y: 30
			},
			{
				role: "CM",
				x: 65,
				y: 50
			},
			{
				role: "CB",
				x: 40,
				y: 32
			},
			{
				role: "CB",
				x: 40,
				y: 42
			},
			{
				role: "LB",
				x: 30,
				y: 12
			},
			{
				role: "RB",
				x: 30,
				y: 62
			},
			{
				role: "RW",
				x: 70,
				y: 65
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		throwIn_Defend: { slots: [
			{
				role: "GK",
				x: 10,
				y: 37
			},
			{
				role: "LB",
				x: 15,
				y: 11
			},
			{
				role: "CB",
				x: 18,
				y: 28
			},
			{
				role: "CB",
				x: 18,
				y: 46
			},
			{
				role: "RB",
				x: 15,
				y: 63
			},
			{
				role: "CM",
				x: 40,
				y: 24
			},
			{
				role: "CM",
				x: 40,
				y: 50
			},
			{
				role: "CAM",
				x: 45,
				y: 37
			},
			{
				role: "LW",
				x: 50,
				y: 11
			},
			{
				role: "ST",
				x: 55,
				y: 37
			},
			{
				role: "RW",
				x: 50,
				y: 63
			}
		] },
		freeKick_Attack: { slots: [
			{
				role: "ST",
				x: 103,
				y: 37
			},
			{
				role: "CAM",
				x: 103,
				y: 28
			},
			{
				role: "LW",
				x: 100,
				y: 46
			},
			{
				role: "RW",
				x: 100,
				y: 28
			},
			{
				role: "CM",
				x: 95,
				y: 20
			},
			{
				role: "CM",
				x: 95,
				y: 54
			},
			{
				role: "CB",
				x: 90,
				y: 32
			},
			{
				role: "CB",
				x: 90,
				y: 42
			},
			{
				role: "LB",
				x: 75,
				y: 12
			},
			{
				role: "RB",
				x: 75,
				y: 62
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		freeKick_Defend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 10,
				y: 15
			},
			{
				role: "CB",
				x: 8,
				y: 28
			},
			{
				role: "CB",
				x: 8,
				y: 46
			},
			{
				role: "RB",
				x: 10,
				y: 59
			},
			{
				role: "CM",
				x: 20,
				y: 22
			},
			{
				role: "CM",
				x: 20,
				y: 52
			},
			{
				role: "CAM",
				x: 25,
				y: 37
			},
			{
				role: "LW",
				x: 35,
				y: 8
			},
			{
				role: "ST",
				x: 55,
				y: 37
			},
			{
				role: "RW",
				x: 35,
				y: 66
			}
		] },
		offside_fk: { slots: [
			{
				role: "GK",
				x: 8,
				y: 37
			},
			{
				role: "LB",
				x: 22,
				y: 13
			},
			{
				role: "CB",
				x: 25,
				y: 28
			},
			{
				role: "CB",
				x: 25,
				y: 46
			},
			{
				role: "RB",
				x: 22,
				y: 61
			},
			{
				role: "CM",
				x: 42,
				y: 26
			},
			{
				role: "CM",
				x: 42,
				y: 48
			},
			{
				role: "CAM",
				x: 52,
				y: 37
			},
			{
				role: "LW",
				x: 62,
				y: 12
			},
			{
				role: "ST",
				x: 68,
				y: 37
			},
			{
				role: "RW",
				x: 62,
				y: 62
			}
		] }
	},
	{
		formationId: "4-4-2",
		kickOff: { slots: [
			{
				role: "GK",
				x: 10,
				y: 37
			},
			{
				role: "LB",
				x: 36,
				y: 11
			},
			{
				role: "CB",
				x: 38,
				y: 28
			},
			{
				role: "CB",
				x: 38,
				y: 46
			},
			{
				role: "RB",
				x: 36,
				y: 63
			},
			{
				role: "LM",
				x: 52,
				y: 9
			},
			{
				role: "CM",
				x: 50,
				y: 24
			},
			{
				role: "CM",
				x: 50,
				y: 50
			},
			{
				role: "RM",
				x: 52,
				y: 65
			},
			{
				role: "ST",
				x: 57,
				y: 28
			},
			{
				role: "ST",
				x: 57,
				y: 46
			}
		] },
		kickOffDefend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 13,
				y: 11
			},
			{
				role: "CB",
				x: 14,
				y: 28
			},
			{
				role: "CB",
				x: 14,
				y: 46
			},
			{
				role: "RB",
				x: 13,
				y: 63
			},
			{
				role: "LM",
				x: 40,
				y: 9
			},
			{
				role: "CM",
				x: 38,
				y: 24
			},
			{
				role: "CM",
				x: 38,
				y: 50
			},
			{
				role: "RM",
				x: 40,
				y: 65
			},
			{
				role: "ST",
				x: 60,
				y: 28
			},
			{
				role: "ST",
				x: 60,
				y: 46
			}
		] },
		goalKick: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 13,
				y: 11
			},
			{
				role: "CB",
				x: 15,
				y: 28
			},
			{
				role: "CB",
				x: 15,
				y: 46
			},
			{
				role: "RB",
				x: 13,
				y: 63
			},
			{
				role: "LM",
				x: 55,
				y: 9
			},
			{
				role: "CM",
				x: 38,
				y: 24
			},
			{
				role: "CM",
				x: 38,
				y: 50
			},
			{
				role: "RM",
				x: 55,
				y: 65
			},
			{
				role: "ST",
				x: 60,
				y: 28
			},
			{
				role: "ST",
				x: 60,
				y: 46
			}
		] },
		corner_Attack: { slots: [
			{
				role: "LM",
				x: 115,
				y: 3
			},
			{
				role: "ST",
				x: 103,
				y: 37
			},
			{
				role: "ST",
				x: 100,
				y: 28
			},
			{
				role: "CM",
				x: 97,
				y: 50
			},
			{
				role: "CM",
				x: 90,
				y: 28
			},
			{
				role: "CB",
				x: 88,
				y: 46
			},
			{
				role: "CB",
				x: 85,
				y: 22
			},
			{
				role: "RM",
				x: 80,
				y: 65
			},
			{
				role: "LB",
				x: 75,
				y: 18
			},
			{
				role: "RB",
				x: 75,
				y: 56
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		corner_Defend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 10,
				y: 12
			},
			{
				role: "CB",
				x: 9,
				y: 28
			},
			{
				role: "CB",
				x: 9,
				y: 46
			},
			{
				role: "RB",
				x: 10,
				y: 62
			},
			{
				role: "LM",
				x: 22,
				y: 8
			},
			{
				role: "CM",
				x: 18,
				y: 22
			},
			{
				role: "CM",
				x: 18,
				y: 52
			},
			{
				role: "RM",
				x: 22,
				y: 66
			},
			{
				role: "ST",
				x: 55,
				y: 28
			},
			{
				role: "ST",
				x: 55,
				y: 46
			}
		] },
		throwIn_Attack: { slots: [
			{
				role: "LM",
				x: 70,
				y: 2
			},
			{
				role: "ST",
				x: 75,
				y: 28
			},
			{
				role: "ST",
				x: 72,
				y: 46
			},
			{
				role: "CM",
				x: 65,
				y: 28
			},
			{
				role: "CM",
				x: 65,
				y: 46
			},
			{
				role: "RM",
				x: 70,
				y: 72
			},
			{
				role: "CB",
				x: 40,
				y: 30
			},
			{
				role: "CB",
				x: 40,
				y: 44
			},
			{
				role: "LB",
				x: 30,
				y: 12
			},
			{
				role: "RB",
				x: 30,
				y: 62
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		throwIn_Defend: { slots: [
			{
				role: "GK",
				x: 10,
				y: 37
			},
			{
				role: "LB",
				x: 15,
				y: 11
			},
			{
				role: "CB",
				x: 18,
				y: 28
			},
			{
				role: "CB",
				x: 18,
				y: 46
			},
			{
				role: "RB",
				x: 15,
				y: 63
			},
			{
				role: "LM",
				x: 50,
				y: 9
			},
			{
				role: "CM",
				x: 40,
				y: 24
			},
			{
				role: "CM",
				x: 40,
				y: 50
			},
			{
				role: "RM",
				x: 50,
				y: 65
			},
			{
				role: "ST",
				x: 55,
				y: 28
			},
			{
				role: "ST",
				x: 55,
				y: 46
			}
		] },
		freeKick_Attack: { slots: [
			{
				role: "ST",
				x: 103,
				y: 37
			},
			{
				role: "ST",
				x: 100,
				y: 28
			},
			{
				role: "CM",
				x: 95,
				y: 50
			},
			{
				role: "CM",
				x: 95,
				y: 24
			},
			{
				role: "LM",
				x: 100,
				y: 46
			},
			{
				role: "RM",
				x: 98,
				y: 30
			},
			{
				role: "CB",
				x: 88,
				y: 37
			},
			{
				role: "CB",
				x: 85,
				y: 44
			},
			{
				role: "LB",
				x: 75,
				y: 12
			},
			{
				role: "RB",
				x: 75,
				y: 62
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		freeKick_Defend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "LB",
				x: 10,
				y: 15
			},
			{
				role: "CB",
				x: 8,
				y: 28
			},
			{
				role: "CB",
				x: 8,
				y: 46
			},
			{
				role: "RB",
				x: 10,
				y: 59
			},
			{
				role: "LM",
				x: 35,
				y: 8
			},
			{
				role: "CM",
				x: 20,
				y: 22
			},
			{
				role: "CM",
				x: 20,
				y: 52
			},
			{
				role: "RM",
				x: 35,
				y: 66
			},
			{
				role: "ST",
				x: 55,
				y: 28
			},
			{
				role: "ST",
				x: 55,
				y: 46
			}
		] },
		offside_fk: { slots: [
			{
				role: "GK",
				x: 8,
				y: 37
			},
			{
				role: "LB",
				x: 22,
				y: 13
			},
			{
				role: "CB",
				x: 25,
				y: 28
			},
			{
				role: "CB",
				x: 25,
				y: 46
			},
			{
				role: "RB",
				x: 22,
				y: 61
			},
			{
				role: "LM",
				x: 50,
				y: 11
			},
			{
				role: "CM",
				x: 42,
				y: 26
			},
			{
				role: "CM",
				x: 42,
				y: 48
			},
			{
				role: "RM",
				x: 50,
				y: 63
			},
			{
				role: "ST",
				x: 66,
				y: 30
			},
			{
				role: "ST",
				x: 66,
				y: 44
			}
		] }
	},
	{
		formationId: "3-5-2",
		kickOff: { slots: [
			{
				role: "GK",
				x: 10,
				y: 37
			},
			{
				role: "CB",
				x: 38,
				y: 18
			},
			{
				role: "CB",
				x: 38,
				y: 37
			},
			{
				role: "CB",
				x: 38,
				y: 56
			},
			{
				role: "LWB",
				x: 50,
				y: 8
			},
			{
				role: "CM",
				x: 50,
				y: 26
			},
			{
				role: "CDM",
				x: 45,
				y: 37
			},
			{
				role: "CM",
				x: 50,
				y: 48
			},
			{
				role: "RWB",
				x: 50,
				y: 66
			},
			{
				role: "ST",
				x: 57,
				y: 28
			},
			{
				role: "ST",
				x: 57,
				y: 46
			}
		] },
		kickOffDefend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "CB",
				x: 14,
				y: 18
			},
			{
				role: "CB",
				x: 14,
				y: 37
			},
			{
				role: "CB",
				x: 14,
				y: 56
			},
			{
				role: "LWB",
				x: 38,
				y: 8
			},
			{
				role: "CDM",
				x: 32,
				y: 37
			},
			{
				role: "CM",
				x: 38,
				y: 26
			},
			{
				role: "CM",
				x: 38,
				y: 48
			},
			{
				role: "RWB",
				x: 38,
				y: 66
			},
			{
				role: "ST",
				x: 60,
				y: 28
			},
			{
				role: "ST",
				x: 60,
				y: 46
			}
		] },
		goalKick: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "CB",
				x: 15,
				y: 18
			},
			{
				role: "CB",
				x: 15,
				y: 37
			},
			{
				role: "CB",
				x: 15,
				y: 56
			},
			{
				role: "LWB",
				x: 13,
				y: 8
			},
			{
				role: "CM",
				x: 38,
				y: 24
			},
			{
				role: "CDM",
				x: 28,
				y: 37
			},
			{
				role: "CM",
				x: 38,
				y: 50
			},
			{
				role: "RWB",
				x: 13,
				y: 66
			},
			{
				role: "ST",
				x: 60,
				y: 28
			},
			{
				role: "ST",
				x: 60,
				y: 46
			}
		] },
		corner_Attack: { slots: [
			{
				role: "LWB",
				x: 115,
				y: 3
			},
			{
				role: "ST",
				x: 103,
				y: 37
			},
			{
				role: "ST",
				x: 100,
				y: 28
			},
			{
				role: "CM",
				x: 97,
				y: 50
			},
			{
				role: "CM",
				x: 93,
				y: 20
			},
			{
				role: "CDM",
				x: 90,
				y: 37
			},
			{
				role: "CB",
				x: 88,
				y: 46
			},
			{
				role: "CB",
				x: 85,
				y: 56
			},
			{
				role: "CB",
				x: 85,
				y: 20
			},
			{
				role: "RWB",
				x: 78,
				y: 66
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		corner_Defend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "CB",
				x: 9,
				y: 18
			},
			{
				role: "CB",
				x: 8,
				y: 37
			},
			{
				role: "CB",
				x: 9,
				y: 56
			},
			{
				role: "LWB",
				x: 12,
				y: 8
			},
			{
				role: "CM",
				x: 18,
				y: 24
			},
			{
				role: "CDM",
				x: 16,
				y: 37
			},
			{
				role: "CM",
				x: 18,
				y: 50
			},
			{
				role: "RWB",
				x: 12,
				y: 66
			},
			{
				role: "ST",
				x: 55,
				y: 28
			},
			{
				role: "ST",
				x: 55,
				y: 46
			}
		] },
		throwIn_Attack: { slots: [
			{
				role: "LWB",
				x: 70,
				y: 2
			},
			{
				role: "ST",
				x: 75,
				y: 28
			},
			{
				role: "ST",
				x: 72,
				y: 46
			},
			{
				role: "CM",
				x: 65,
				y: 26
			},
			{
				role: "CDM",
				x: 62,
				y: 37
			},
			{
				role: "CM",
				x: 65,
				y: 48
			},
			{
				role: "CB",
				x: 45,
				y: 18
			},
			{
				role: "CB",
				x: 45,
				y: 37
			},
			{
				role: "CB",
				x: 45,
				y: 56
			},
			{
				role: "RWB",
				x: 70,
				y: 72
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		throwIn_Defend: { slots: [
			{
				role: "GK",
				x: 10,
				y: 37
			},
			{
				role: "CB",
				x: 18,
				y: 18
			},
			{
				role: "CB",
				x: 18,
				y: 37
			},
			{
				role: "CB",
				x: 18,
				y: 56
			},
			{
				role: "LWB",
				x: 13,
				y: 8
			},
			{
				role: "CM",
				x: 40,
				y: 24
			},
			{
				role: "CDM",
				x: 30,
				y: 37
			},
			{
				role: "CM",
				x: 40,
				y: 50
			},
			{
				role: "RWB",
				x: 13,
				y: 66
			},
			{
				role: "ST",
				x: 55,
				y: 28
			},
			{
				role: "ST",
				x: 55,
				y: 46
			}
		] },
		freeKick_Attack: { slots: [
			{
				role: "ST",
				x: 103,
				y: 28
			},
			{
				role: "ST",
				x: 100,
				y: 46
			},
			{
				role: "CM",
				x: 98,
				y: 37
			},
			{
				role: "CM",
				x: 95,
				y: 20
			},
			{
				role: "CDM",
				x: 92,
				y: 55
			},
			{
				role: "CB",
				x: 88,
				y: 28
			},
			{
				role: "CB",
				x: 85,
				y: 46
			},
			{
				role: "CB",
				x: 82,
				y: 37
			},
			{
				role: "LWB",
				x: 78,
				y: 8
			},
			{
				role: "RWB",
				x: 78,
				y: 66
			},
			{
				role: "GK",
				x: 10,
				y: 37
			}
		] },
		freeKick_Defend: { slots: [
			{
				role: "GK",
				x: 5,
				y: 37
			},
			{
				role: "CB",
				x: 8,
				y: 18
			},
			{
				role: "CB",
				x: 7,
				y: 37
			},
			{
				role: "CB",
				x: 8,
				y: 56
			},
			{
				role: "LWB",
				x: 10,
				y: 8
			},
			{
				role: "CM",
				x: 20,
				y: 24
			},
			{
				role: "CDM",
				x: 16,
				y: 37
			},
			{
				role: "CM",
				x: 20,
				y: 50
			},
			{
				role: "RWB",
				x: 10,
				y: 66
			},
			{
				role: "ST",
				x: 55,
				y: 28
			},
			{
				role: "ST",
				x: 55,
				y: 46
			}
		] },
		offside_fk: { slots: [
			{
				role: "GK",
				x: 8,
				y: 37
			},
			{
				role: "CB",
				x: 25,
				y: 18
			},
			{
				role: "CB",
				x: 25,
				y: 37
			},
			{
				role: "CB",
				x: 25,
				y: 56
			},
			{
				role: "LWB",
				x: 48,
				y: 10
			},
			{
				role: "CM",
				x: 42,
				y: 26
			},
			{
				role: "CDM",
				x: 38,
				y: 37
			},
			{
				role: "CM",
				x: 42,
				y: 48
			},
			{
				role: "RWB",
				x: 48,
				y: 64
			},
			{
				role: "ST",
				x: 66,
				y: 30
			},
			{
				role: "ST",
				x: 66,
				y: 44
			}
		] }
	}
];
/**
* Look up the set piece layouts for a formation by ID.
* Returns null if no layout is defined for that formation.
*/
function getFormationSetPieces(formationId) {
	return REGISTRY.find((l) => l.formationId === formationId) ?? null;
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
function generateKickoffLayout(formation) {
	const CENTRE_LINE = 57;
	return { slots: formation.defending.map((slot) => ({
		role: slot.role,
		x: Math.min(slot.x, CENTRE_LINE),
		y: slot.y
	})) };
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/SetPiecePositioning.ts
const CENTRE_X = PITCH_MID_X;
const CENTRE_Y = 37;
/** Centre circle radius in yards (9.15 m ≈ 10 yds, +0.5 buffer). */
const CIRCLE_RADIUS = 10.5;
/**
* Apply a set piece layout to players of one team.
* Returns the full player array (all 22) with the team's positions updated.
*/
function applySetPieceToTeam(players, teamId, layout) {
	const teamPlayers = players.filter((p) => p.team === teamId);
	if (teamPlayers.length === 0 || layout.slots.length === 0) return players;
	const attackDir = teamPlayers[0].attackDir;
	const roleSlots = /* @__PURE__ */ new Map();
	for (const slot of layout.slots) {
		const list = roleSlots.get(slot.role) ?? [];
		list.push(slot);
		roleSlots.set(slot.role, list);
	}
	const sorted = [...teamPlayers].sort((a, b) => a.slotIndex - b.slotIndex);
	const roleIndex = /* @__PURE__ */ new Map();
	const updates = /* @__PURE__ */ new Map();
	for (const player of sorted) {
		const slots = roleSlots.get(player.role);
		if (!slots) continue;
		const idx = roleIndex.get(player.role) ?? 0;
		roleIndex.set(player.role, idx + 1);
		if (idx >= slots.length) continue;
		const slot = slots[idx];
		const engineX = attackDir === 1 ? slot.x : 115 - slot.x;
		updates.set(player.id, {
			x: engineX,
			y: slot.y
		});
	}
	return players.map((p) => {
		const pos = updates.get(p.id);
		if (!pos) return p;
		return {
			...p,
			x: pos.x,
			y: pos.y,
			targetPosition: {
				x: pos.x,
				y: pos.y
			}
		};
	});
}
/**
* Enforce the kickoff centre-circle rule for the team WITHOUT the ball.
*
* Any defending-team player inside the centre circle (radius CIRCLE_RADIUS)
* is pushed outward along the same direction from centre until they sit on
* the circle edge.  Players already outside are untouched.
*
* If a player is exactly at the centre point, they are pushed toward their
* own half (determined by attackDir) to guarantee a legal position.
*/
function enforceKickoffCircleRule(players, defendingTeam) {
	return players.map((p) => {
		if (p.team !== defendingTeam) return p;
		const dx = p.x - CENTRE_X;
		const dy = p.y - CENTRE_Y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist >= CIRCLE_RADIUS) return p;
		const normX = dist < .01 ? p.attackDir === -1 ? 1 : -1 : dx / dist;
		const normY = dist < .01 ? 0 : dy / dist;
		const newX = CENTRE_X + normX * CIRCLE_RADIUS;
		const newY = CENTRE_Y + normY * CIRCLE_RADIUS;
		return {
			...p,
			x: newX,
			y: newY,
			targetPosition: {
				x: newX,
				y: newY
			}
		};
	});
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/AiSubstitution.ts
/** Game-seconds between AI sub evaluations (~5 game-minutes). */
const AI_SUB_CHECK_INTERVAL = 300;
/** Energy threshold below which a player is considered a substitution candidate. */
const LOW_ENERGY_THRESHOLD = 40;
/** Energy threshold below which a player is considered critically tired. */
const CRITICAL_ENERGY_THRESHOLD = 25;
/**
* Returns all sub recommendations for the given AI team based on energy levels.
* May return an empty array (nobody tired), or multiple entries (batch subs).
* Capped by remaining substitutions.
*/
function evaluateAiSubstitutions(state, team) {
	if (state.matchPhase !== "secondHalf") return [];
	const subsRemaining = team === "A" ? state.subsRemainingA : state.subsRemainingB;
	if (subsRemaining <= 0) return [];
	const bench = team === "A" ? state.benchA : state.benchB;
	if (bench.length === 0) return [];
	const onPitch = state.players.filter((p) => p.team === team && p.role !== "GK");
	const usedBenchIds = /* @__PURE__ */ new Set();
	const subs = [];
	const candidates = onPitch.filter((p) => p.energy < LOW_ENERGY_THRESHOLD).sort((a, b) => a.energy - b.energy);
	for (const tired of candidates) {
		if (subs.length >= subsRemaining) break;
		const slotRole = tired.role;
		const availableBench = bench.filter((p) => !usedBenchIds.has(p.id));
		if (availableBench.length === 0) break;
		const best = findBestBenchForRole(availableBench, slotRole);
		if (!best) continue;
		if (!(tired.energy < CRITICAL_ENERGY_THRESHOLD || best.energy > tired.energy + 20)) continue;
		subs.push({
			outId: tired.id,
			inId: best.id
		});
		usedBenchIds.add(best.id);
	}
	return subs;
}
/**
* Find the best available bench player for a given role.
* Priority: exact role match → same main role → any player.
* Among equals, picks the one with better weighted score for the role.
*/
function findBestBenchForRole(bench, role) {
	if (bench.length === 0) return null;
	const exactMatch = bench.filter((p) => p.role === role).sort((a, b) => scoreForRole(b, role) - scoreForRole(a, role));
	if (exactMatch[0]) return exactMatch[0];
	const mainRoleMatch = bench.filter((p) => sameMainRole(p.role, role)).sort((a, b) => scoreForRole(b, role) - scoreForRole(a, role));
	if (mainRoleMatch[0]) return mainRoleMatch[0];
	return bench.sort((a, b) => scoreForRole(b, role) - scoreForRole(a, role))[0] ?? null;
}
function scoreForRole(player, role) {
	return (player.baseStats.withBall.speed + player.baseStats.withBall.passingSkill + player.baseStats.withoutBall.tackleChance) * (player.energy / 100);
}
const MAIN_ROLE_BANDS = {
	GK: "GK",
	LB: "DEF",
	CB: "DEF",
	RB: "DEF",
	LWB: "DEF",
	RWB: "DEF",
	CDM: "MID",
	CM: "MID",
	CAM: "MID",
	LM: "MID",
	RM: "MID",
	LW: "FWD",
	RW: "FWD",
	ST: "FWD"
};
function sameMainRole(roleA, roleB) {
	return (MAIN_ROLE_BANDS[roleA] ?? roleA) === (MAIN_ROLE_BANDS[roleB] ?? roleB);
}
/**
* Returns true if a 300-game-second check boundary was crossed this tick.
*
* `dt` is the game-time advance for this tick (already scaled by TIME_SCALE
* by the caller). Callers pass `realDt * TIME_SCALE`.
*
* Previously re-multiplied `dt` by TIME_SCALE internally, which looked back
* ~65 game-seconds instead of ~3.6, causing the check to fire ~18 consecutive
* ticks at every interval boundary. That bloated pendingSubsA/B because each
* firing re-queued the same recommended subs.
*/
function shouldCheckAiSubs(matchTime, dt) {
	const prev = matchTime - dt;
	const cur = matchTime;
	return Math.floor(prev / AI_SUB_CHECK_INTERVAL) !== Math.floor(cur / AI_SUB_CHECK_INTERVAL);
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/IntentDetection.ts
/**
* Maximum number of opposing players allowed in the attacking 40 yards (their
* attacking third) to trigger counter-attack. If more than this many are
* committed forward, their defense is weak and we have space to exploit.
*/
const COUNTER_ATTACK_MAX_OPPONENTS_IN_ATTACKING_40 = 5;
/**
* switch_play geometry gates. The holder must be genuinely wide AND the far
* (opposite) touchline channel must be open near their x, otherwise switching
* the ball over there gains nothing.
*/
/** Holder counts as "wide" when their distance from the centre line exceeds this. */
const SWITCH_PLAY_WIDE_THRESHOLD = 18;
/** How deep the far wide channel reaches in from the opposite touchline. */
const SWITCH_PLAY_FAR_CHANNEL_WIDTH = 19;
/** Only opponents within this x-distance of the holder gate the "far flank open" check. */
const SWITCH_PLAY_FAR_X_WINDOW = 22;
/** At most this many opponents may sit in the far channel for it to count as open. */
const SWITCH_PLAY_FAR_MAX_OPPONENTS = 1;
/**
* Per-tactic probability of committing to a switch when the geometric gate is
* met. switch_play is a GENERAL intent available to every tactic, but how often
* a team takes the option depends on its identity: a patient possession side
* switches readily; a counter_attack / direct_play side prefers to drive
* forward and rarely bothers. The roll is seeded per-possession (see
* shouldSwitchPlay) so it is stable across re-evals — no flicker, no latch.
*/
const SWITCH_PLAY_PROBABILITY = {
	possession: .45,
	balanced: .35,
	high_press: .35,
	counter_attack: .12,
	direct_play: .12
};
const SWITCH_PLAY_DEFAULT_PROBABILITY = .35;
/**
* Decide the team's intent given the current state. Called for BOTH teams on
* possession transfer and on the periodic re-evaluation tick — neither side is
* forced to 'balanced' by the caller anymore.
*
* Each team holds exactly ONE intent at a time. Offensive intents fire when
* the team has the ball; defensive intents fire when it doesn't.
*
* switch_play is the first GENERAL intent: it is available to every tactic
* (with a per-tactic firing probability), not gated behind one tactical style.
* Tactic-specific gating remains narrow — only counter_attack tactic uses the
* counter/press/hold family today. Other tactics will gain access to more
* intents incrementally — see .claude/rules/game-engine/tactics-as-intents.md.
*/
function detectTeamIntent(state, team, opts) {
	const allowSwitchPlay = opts?.allowSwitchPlay ?? true;
	const style = getTeamTacticalStyle(team);
	const hasBall = state.players.find((p) => p.id === state.ballHolderId)?.team === team;
	if (allowSwitchPlay && hasBall && shouldSwitchPlay(state, team, style)) return "switch_play";
	if (style === "counter_attack") return detectCounterAttackTacticIntent(state, team);
	return "balanced";
}
/**
* Decide whether to commit to a switch this possession. Two stages:
*   1. Geometric gate — holder is wide and the far flank is open.
*   2. Probabilistic roll — seeded per-possession so the result is stable
*      across the many re-evals within one possession (no flicker, no latch
*      field needed). The probability is the team's tactical appetite for
*      switching.
*/
function shouldSwitchPlay(state, team, style) {
	if (!isSwitchPlayOpportunity(state, team)) return false;
	const probability = SWITCH_PLAY_PROBABILITY[style] ?? SWITCH_PLAY_DEFAULT_PROBABILITY;
	return seededRandom(team, Math.round(state.matchTime - state.possessionTime)) < probability;
}
/**
* Geometric gate: the holder must be genuinely wide AND the opposite (far)
* touchline channel must be open near the holder's x. Without an open far
* channel a switch just hands the ball into traffic, so we don't bother.
*/
function isSwitchPlayOpportunity(state, team) {
	const holder = state.players.find((p) => p.id === state.ballHolderId);
	if (!holder || holder.team !== team) return false;
	const fromCentre = holder.y - 37;
	if (Math.abs(fromCentre) < SWITCH_PLAY_WIDE_THRESHOLD) return false;
	const holderOnTopSide = fromCentre < 0;
	const opponentTeam = team === "A" ? "B" : "A";
	let oppInFarFlank = 0;
	for (const p of state.players) {
		if (p.team !== opponentTeam) continue;
		if (!(holderOnTopSide ? p.y > 55 : p.y < SWITCH_PLAY_FAR_CHANNEL_WIDTH)) continue;
		if (Math.abs(p.x - holder.x) > SWITCH_PLAY_FAR_X_WINDOW) continue;
		oppInFarFlank++;
		if (oppInFarFlank > SWITCH_PLAY_FAR_MAX_OPPONENTS) return false;
	}
	return true;
}
/**
* Deterministic [0,1) hash of (team, seed). Team-salted so both teams holding
* possessions that started at the same rounded match-time don't roll identically.
*/
function seededRandom(team, seed) {
	const salt = team === "A" ? .1234 : .8765;
	const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
	return x - Math.floor(x);
}
/**
* Intent selector for the counter_attack tactic.
*
* • Has the ball + opponent committed forward → counter_attack (offensive bias)
* • Defending + attackers progressed into our half + we have numerical
*   advantage there → press_now (commit pressers, hunt the ball)
* • Defending otherwise → hold_shape (deliberate low-line passive default)
* • Has the ball but no counter opportunity → balanced (default attack)
*/
function detectCounterAttackTacticIntent(state, team) {
	if (state.players.find((p) => p.id === state.ballHolderId)?.team === team) {
		if (isCounterAttackOpportunity(state, team)) return "counter_attack";
		return "balanced";
	}
	if (isPressNowOpportunity(state, team)) return "press_now";
	return "hold_shape";
}
/**
* True when the opposing team has more than 5 players in the attacking 40 yards
* (their attacking third). This means their defense is spread thin and we have
* space to exploit on the counter-attack.
*/
function isCounterAttackOpportunity(state, team) {
	const holder = state.players.find((p) => p.id === state.ballHolderId);
	if (!holder || holder.team !== team) return false;
	const opponentTeam = team === "A" ? "B" : "A";
	let playersInAttacking40 = 0;
	for (const p of state.players) {
		if (p.team !== opponentTeam) continue;
		if ((p.x - 75) * p.attackDir > 0) playersInAttacking40++;
	}
	return playersInAttacking40 > COUNTER_ATTACK_MAX_OPPONENTS_IN_ATTACKING_40;
}
/**
* True when the defending team should commit to pressing instead of holding
* shape. Today the single trigger is: the ball holder has entered our
* goal-score area (penalty box). At that moment the structured defense is
* already collapsed around the box, so committing to high press is the right
* answer — sitting in low block when the carrier is already in our box does
* nothing.
*
* Future iterations may add escalation gates (numerical advantage, ball-side
* support, etc.) but per current design the box entry alone is sufficient.
*
* Caller must already have established the team is defending; this only checks
* the situational escalation gate.
*/
function isPressNowOpportunity(state, team) {
	const holder = state.players.find((p) => p.id === state.ballHolderId);
	if (!holder || holder.team === team) return false;
	const sample = state.players.find((p) => p.team === team && p.role !== "GK");
	if (!sample) return false;
	const ownGoalX = sample.attackDir === 1 ? 0 : 115;
	return isInGoalScoreArea(holder.x, holder.y, ownGoalX);
}
//#endregion
//#region .local/touchlines/upstream/src/GameEngine/Domain/gameState.ts
const OFFSIDE_CONFIG = { 
/** Set to false to disable offside enforcement (useful for testing). */
ENABLED: true };
/**
* Max yards to project the holder forward when computing a press intercept target.
* Prevents extreme projections when the holder is very fast or the presser very slow.
*/
const PRESS_INTERCEPT_MAX_LOOKAHEAD = 14;
/** Game-seconds per real-second: 45 game-minutes / REAL_HALF_DURATION. */
const TIME_SCALE = 18; /* timepitch native: upstream clock, 150 s per half */
/** Duration of one half in game-seconds (45 minutes). */
const HALF_DURATION = 2700;
/** Real-seconds the pre-match / half-time presentation freeze lasts. */
const PRESENTATION_DURATION = 4;
/**
* Game-seconds between periodic team intent re-evaluations. Possession transfer
* already triggers a recompute; this catches cases where the situation changes
* mid-possession (opponent pushes forward, we lose a numerical advantage, etc.)
* without churning every tick — 3 game-seconds is roughly 12 ticks at 0.25s dt.
*/
const INTENT_REEVAL_INTERVAL = 3;
function mirrorBounds(b) {
	return {
		minX: 115 - b.maxX,
		maxX: 115 - b.minX,
		minY: b.minY,
		maxY: b.maxY
	};
}
/** Preferred positions for each engine role, used when picking from a squad roster. */
const ROLE_POSITIONS = {
	GK: ["GK"],
	LB: [
		"LB",
		"LWB",
		"CB",
		"RB"
	],
	RB: [
		"RB",
		"RWB",
		"CB",
		"LB"
	],
	CB: [
		"CB",
		"LB",
		"RB"
	],
	LWB: [
		"LWB",
		"LB",
		"LM",
		"CB"
	],
	RWB: [
		"RWB",
		"RB",
		"RM",
		"CB"
	],
	CDM: [
		"CDM",
		"CM",
		"DM"
	],
	CM: [
		"CM",
		"CAM",
		"AM",
		"CDM"
	],
	CAM: [
		"CAM",
		"AM",
		"CM",
		"LM",
		"RM"
	],
	LM: [
		"LM",
		"LW",
		"CM"
	],
	RM: [
		"RM",
		"RW",
		"CM"
	],
	LW: [
		"LW",
		"LM",
		"CM",
		"ST"
	],
	RW: [
		"RW",
		"RM",
		"CM",
		"ST"
	],
	ST: [
		"ST",
		"CF",
		"CAM",
		"LW",
		"RW"
	]
};
function pickForRole(players, role, used) {
	const preferences = ROLE_POSITIONS[role] ?? [role];
	for (const pos of preferences) {
		const found = players.find((p) => !used.has(p.id) && p.positions.includes(pos));
		if (found) return found;
	}
	return players.find((p) => !used.has(p.id)) ?? players[0];
}
/**
* Maps any position string (including abstract codes like "CF", "DM", "AM",
* "Defender", "Midfielder", "Forward") to a valid engine PlayerRole.
*/
const POSITION_TO_ROLE = {
	GK: "GK",
	CB: "CB",
	LB: "LB",
	RB: "RB",
	LWB: "LWB",
	RWB: "RWB",
	CDM: "CDM",
	DM: "CDM",
	CM: "CM",
	CAM: "CAM",
	AM: "CAM",
	LM: "LM",
	RM: "RM",
	LW: "LW",
	RW: "RW",
	ST: "ST",
	CF: "ST",
	Defender: "CB",
	Midfielder: "CM",
	Forward: "ST",
	Attacker: "ST"
};
function toValidPlayerRole(pos) {
	return POSITION_TO_ROLE[pos] ?? "CM";
}
function buildGamePlayerForSlot(rp, slotDef, slotIndex, formation, team, engineId) {
	const attackDir = team === "A" ? 1 : -1;
	const buffed = computeBuffedStats(rp.stats, Player.trainingToStatus(rp.seasonLog?.trainingSessions ?? 0), Player.moraleToStatus(rp.seasonLog?.morale ?? 70), Player.formToStatus(rp.seasonLog?.recentRatings ?? []));
	const roleEng = roleEngine(slotDef.role);
	const startPos = resolveBasePosition(slotIndex, attackDir, formation, "attacking");
	const yRange = slotDef.yRange ?? roleEng.yRange;
	const slotY = startPos.y;
	const xBoundsA = roleEng.bounds;
	const xBounds = team === "A" ? xBoundsA : mirrorBounds({
		...xBoundsA,
		minY: 0,
		maxY: 74
	});
	const bounds = {
		minX: xBounds.minX,
		maxX: xBounds.maxX,
		minY: Math.max(0, slotY - yRange),
		maxY: Math.min(74, slotY + yRange)
	};
	const baseStats = teamLineup(buffed, slotDef.role);
	const energy = Math.max(0, Math.min(100, rp.seasonLog?.fitness ?? 100));
	return {
		id: engineId,
		rosterId: rp.id,
		name: rp.name,
		team,
		role: slotDef.role,
		attackDir,
		x: startPos.x,
		y: startPos.y,
		baseStats,
		runtimeStats: getRuntimeLineup(baseStats, { energy }),
		energy,
		startEnergy: energy,
		stamina: buffed.stamina,
		ballSupportScale: roleEng.ballSupportScale,
		slotIndex,
		basePosition: startPos,
		targetPosition: startPos,
		bounds,
		recoveryTime: 0,
		justReceivedTicks: 0,
		decisionMemory: EMPTY_DECISION_MEMORY
	};
}
function buildTeam(players, formation, team, idOffset, lineup) {
	const used = /* @__PURE__ */ new Set();
	const byId = new Map(players.map((p) => [p.id, p]));
	const starters = formation.attacking.map((slotDef, i) => {
		const lineupId = lineup?.[i];
		const rp = lineupId && byId.has(lineupId) && !used.has(lineupId) ? byId.get(lineupId) : pickForRole(players, slotDef.role, used);
		used.add(rp.id);
		return buildGamePlayerForSlot(rp, slotDef, i, formation, team, idOffset + i + 1);
	});
	const bench = [];
	let benchIdOffset = idOffset + 100;
	for (const rp of players) {
		if (used.has(rp.id)) continue;
		const naturalRole = toValidPlayerRole(rp.positions?.[0] ?? "CM");
		const roleEng = roleEngine(naturalRole);
		const attackDir = team === "A" ? 1 : -1;
		const buffed = computeBuffedStats(rp.stats, Player.trainingToStatus(rp.seasonLog?.trainingSessions ?? 0), Player.moraleToStatus(rp.seasonLog?.morale ?? 70), Player.formToStatus(rp.seasonLog?.recentRatings ?? []));
		const baseStats = teamLineup(buffed, naturalRole);
		const energy = Math.max(0, Math.min(100, rp.seasonLog?.fitness ?? 100));
		const dummyPos = {
			x: 0,
			y: 0
		};
		bench.push({
			id: benchIdOffset++,
			rosterId: rp.id,
			name: rp.name,
			team,
			role: naturalRole,
			attackDir,
			x: dummyPos.x,
			y: dummyPos.y,
			baseStats,
			runtimeStats: getRuntimeLineup(baseStats, { energy }),
			energy,
			startEnergy: energy,
			stamina: buffed.stamina,
			ballSupportScale: roleEng.ballSupportScale,
			slotIndex: -1,
			basePosition: dummyPos,
			targetPosition: dummyPos,
			bounds: {
				minX: 0,
				maxX: 115,
				minY: 0,
				maxY: 74
			},
			recoveryTime: 0,
			justReceivedTicks: 0,
			decisionMemory: EMPTY_DECISION_MEMORY
		});
	}
	return {
		starters,
		bench,
		usedIds: used
	};
}
/**
* Create a live-match GameState from two squads and their formations.
*
* @param playersA    Roster of Team A (the user's club).
* @param formationA  Formation object for Team A.
* @param playersB    Roster of Team B (the opponent).
* @param formationB  Formation object for Team B.
* @param lineupA     Optional ordered player IDs for Team A (index = slot index).
* @param lineupB     Optional ordered player IDs for Team B (index = slot index).
*/
function createMatchState(playersA, formationA, playersB, formationB, lineupA, lineupB) {
	const teamAResult = buildTeam(playersA, formationA, "A", 0, lineupA);
	const teamBResult = buildTeam(playersB, formationB, "B", 200, lineupB);
	const teamA = teamAResult.starters;
	const teamB = teamBResult.starters;
	const spA = getFormationSetPieces(formationA.id);
	const spB = getFormationSetPieces(formationB.id);
	const kickoffLayoutA = spA?.kickOff ?? generateKickoffLayout(formationA);
	const kickoffDefendLayoutB = spB?.kickOffDefend ?? generateKickoffLayout(formationB);
	let players = [...teamA, ...teamB];
	players = applySetPieceToTeam(players, "A", kickoffLayoutA);
	players = applySetPieceToTeam(players, "B", kickoffDefendLayoutB);
	players = enforceKickoffCircleRule(players, "B");
	const kickoffHolder = players.find((p) => p.team === "A" && p.role === "ST") ?? teamA[teamA.length - 1];
	return {
		players,
		benchA: teamAResult.bench,
		benchB: teamBResult.bench,
		substitutions: [],
		subsRemainingA: 5,
		subsRemainingB: 5,
		pendingSubsA: [],
		pendingSubsB: [],
		formationA,
		formationB,
		ballHolderId: kickoffHolder.id,
		pass: null,
		shot: null,
		looseBall: null,
		score: {
			A: 0,
			B: 0
		},
		tackleCooldown: 0,
		setPiece: {
			type: "kickoff",
			takerId: kickoffHolder.id,
			countdown: 2
		},
		decisions: {},
		matchPhase: "preMatch",
		matchTime: 0,
		extraTimeFirst: Math.floor(Math.random() * 6) * 60,
		extraTimeSecond: Math.floor(Math.random() * 6) * 60,
		presentationCountdown: PRESENTATION_DURATION,
		possessionTime: 0,
		lastPasserId: null,
		teamIntent: {
			A: "balanced",
			B: "balanced"
		},
		throughBallCellsCache: null
	};
}
/**
* Immediately swap `outPlayerId` (on-pitch) for `inPlayerId` (bench).
* The incoming player inherits the outgoing player's slot, role, position, and bounds.
* Does NOT check `subsRemaining` — callers must validate that themselves.
*/
function performSubstitution(state, team, outPlayerId, inPlayerId) {
	const bench = team === "A" ? state.benchA : state.benchB;
	const outPlayer = state.players.find((p) => p.id === outPlayerId && p.team === team);
	const inPlayer = bench.find((p) => p.id === inPlayerId);
	if (!outPlayer || !inPlayer) return state;
	const role = (team === "A" ? state.formationA : state.formationB).attacking[outPlayer.slotIndex]?.role ?? outPlayer.role;
	const newBaseStats = inPlayer.baseStats;
	const incoming = {
		...inPlayer,
		role,
		slotIndex: outPlayer.slotIndex,
		attackDir: outPlayer.attackDir,
		x: outPlayer.x,
		y: outPlayer.y,
		basePosition: outPlayer.basePosition,
		targetPosition: outPlayer.targetPosition,
		bounds: outPlayer.bounds,
		ballSupportScale: roleEngine(role).ballSupportScale,
		baseStats: newBaseStats,
		runtimeStats: getRuntimeLineup(newBaseStats, { energy: inPlayer.energy }),
		decisionMemory: EMPTY_DECISION_MEMORY,
		recoveryTime: 0,
		justReceivedTicks: 0
	};
	const matchMinute = Math.floor(state.matchTime / 2700 * 45 + (state.matchPhase === "secondHalf" ? 45 : 0));
	const record = {
		team,
		playerOutId: outPlayerId,
		playerOutName: outPlayer.name,
		playerOutRosterId: outPlayer.rosterId,
		playerOutEnergy: outPlayer.energy,
		playerInId: inPlayerId,
		playerInName: inPlayer.name,
		playerInRosterId: inPlayer.rosterId,
		matchMinute
	};
	gameBus.emit("playerSubstituted", {
		outId: outPlayerId,
		inId: inPlayerId,
		team
	});
	let ballHolderId = state.ballHolderId;
	if (ballHolderId === outPlayerId) ballHolderId = state.players.filter((p) => p.team === team && p.id !== outPlayerId).sort((a, b) => distSq(a, outPlayer) - distSq(b, outPlayer))[0]?.id ?? ballHolderId;
	const newPlayers = state.players.map((p) => p.id === outPlayerId ? incoming : p);
	const newBench = bench.filter((p) => p.id !== inPlayerId);
	return {
		...state,
		players: newPlayers,
		benchA: team === "A" ? newBench : state.benchA,
		benchB: team === "B" ? newBench : state.benchB,
		subsRemainingA: team === "A" ? state.subsRemainingA - 1 : state.subsRemainingA,
		subsRemainingB: team === "B" ? state.subsRemainingB - 1 : state.subsRemainingB,
		substitutions: [...state.substitutions, record],
		ballHolderId
	};
}
/**
* Process all pending substitutions for a team, capped by remaining subs.
*/
function flushPendingSubs(state, team) {
	const pending = team === "A" ? state.pendingSubsA : state.pendingSubsB;
	if (pending.length === 0) return state;
	let s = {
		...state,
		pendingSubsA: team === "A" ? [] : state.pendingSubsA,
		pendingSubsB: team === "B" ? [] : state.pendingSubsB
	};
	for (const req of pending) {
		if ((team === "A" ? s.subsRemainingA : s.subsRemainingB) <= 0) break;
		s = performSubstitution(s, team, req.outId, req.inId);
	}
	return s;
}
function distSq(a, b) {
	return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
/**
* Apply intent detection on a possession transfer. Call this AFTER updating
* `ballHolderId` to the new holder. When the team in possession changed,
* recompute intent for BOTH teams — the new defender may also fire an intent
* (e.g. counter_attack tactic going into high_press mode when their opponent
* progresses with a numerical disadvantage).
*
* No-ops when possession stayed within the same team (e.g. a pass completion
* to a teammate — periodic re-evaluation handles updates while possession
* stays put; see `reevaluateTeamIntents`).
*/
function onPossessionTransfer(state, prevHolderId) {
	if (state.ballHolderId === prevHolderId) return state;
	const prev = state.players.find((p) => p.id === prevHolderId);
	const next = state.players.find((p) => p.id === state.ballHolderId);
	if (!next) return state;
	if (prev && prev.team === next.team) return state;
	return reevaluateTeamIntents(state);
}
/**
* Recompute team intent for both teams from current state and emit if changed.
* Used by both possession transfer and the periodic in-tick re-evaluation —
* intents are situational signals that can flip mid-possession (e.g. opponent
* pushes into our half → defensive press intent fires).
*
* `lastIntentEvalTime` is bumped on every call so the periodic timer resets
* even when nothing changed (cheap idempotency for the periodic tick path).
*
* `opts.includeSwitchPlay` (default true) controls whether switch_play may be
* (re)assigned. The periodic in-tick re-eval passes false: a switch is a
* per-possession commitment decided at possession-change / reception, so the
* 3-second timer must neither newly trigger it nor clear an in-progress switch.
* A team already on switch_play is therefore held untouched on the periodic path.
*/
function reevaluateTeamIntents(state, opts) {
	const includeSwitchPlay = opts?.includeSwitchPlay ?? true;
	const intentA = recomputeTeamIntent(state, "A", includeSwitchPlay);
	const intentB = recomputeTeamIntent(state, "B", includeSwitchPlay);
	const changed = state.teamIntent.A !== intentA || state.teamIntent.B !== intentB;
	const teamIntent = changed ? {
		A: intentA,
		B: intentB
	} : state.teamIntent;
	if (changed) gameBus.emit("teamIntentChanged", { teamIntent });
	return {
		...state,
		teamIntent,
		lastIntentEvalTime: state.matchTime
	};
}
/**
* Resolve one team's intent for a re-eval pass. When switch_play is excluded
* (periodic path) a team already switching holds that intent — the timer can't
* clear an in-progress switch — and no team can newly acquire switch_play.
*/
function recomputeTeamIntent(state, team, includeSwitchPlay) {
	if (!includeSwitchPlay && state.teamIntent[team] === "switch_play") return "switch_play";
	return detectTeamIntent(state, team, { allowSwitchPlay: includeSwitchPlay });
}
function teamHasBall(state, teamId) {
	const holder = state.players.find((p) => p.id === state.ballHolderId);
	if (!holder) return false;
	if (state.pass) {
		if (state.pass.kind === "through" || state.pass.toId === null) return state.players.find((p) => p.id === state.pass.fromId)?.team === teamId;
		return state.players.find((p) => p.id === state.pass.toId)?.team === teamId;
	}
	if (state.looseBall) return state.looseBall.fromTeamLastTouch === teamId;
	return holder.team === teamId;
}
function shouldDrainStamina(state) {
	if (state.matchPhase !== "firstHalf" && state.matchPhase !== "secondHalf") return false;
	if (state.setPiece && state.setPiece.countdown > 0) return false;
	return true;
}
function resolveStaminaAction(p, ballHolderId, holderTeam, dec) {
	if (p.id === ballHolderId) {
		if (dec?.type === "carry" || dec?.type === "dribble") return "carry";
		if (dec?.type === "pass") return "pass";
		if (dec?.type === "shoot") return "shot";
		return "move";
	}
	if (p.team !== holderTeam && dec?.type === "press") return "press";
	return "move";
}
function getTeammates(state, playerId) {
	const player = state.players.find((p) => p.id === playerId);
	return state.players.filter((p) => p.team === player.team && p.id !== playerId);
}
function resetToKickoff(state, kickoffTeam) {
	let positioned = state.players.map((p) => ({
		...p,
		x: p.basePosition.x,
		y: p.basePosition.y,
		targetPosition: { ...p.basePosition }
	}));
	const defendingTeam = kickoffTeam === "A" ? "B" : "A";
	const spA = getFormationSetPieces(state.formationA.id);
	const spB = getFormationSetPieces(state.formationB.id);
	const attackLayoutA = spA?.kickOff ?? generateKickoffLayout(state.formationA);
	const attackLayoutB = spB?.kickOff ?? generateKickoffLayout(state.formationB);
	const defendLayoutA = spA?.kickOffDefend ?? generateKickoffLayout(state.formationA);
	const defendLayoutB = spB?.kickOffDefend ?? generateKickoffLayout(state.formationB);
	positioned = applySetPieceToTeam(positioned, "A", kickoffTeam === "A" ? attackLayoutA : defendLayoutA);
	positioned = applySetPieceToTeam(positioned, "B", kickoffTeam === "B" ? attackLayoutB : defendLayoutB);
	positioned = enforceKickoffCircleRule(positioned, defendingTeam);
	const kickoffHolder = positioned.find((p) => p.team === kickoffTeam && p.role === "ST") ?? positioned.find((p) => p.team === kickoffTeam) ?? positioned[0];
	gameBus.emit("kickOff", {
		team: kickoffTeam,
		phase: "afterGoal"
	});
	const prevHolderId = state.ballHolderId;
	return onPossessionTransfer({
		...state,
		players: positioned,
		ballHolderId: kickoffHolder.id,
		pass: null,
		shot: null,
		looseBall: null,
		setPiece: {
			type: "kickoff",
			takerId: kickoffHolder.id,
			countdown: 2
		},
		possessionTime: 0,
		lastPasserId: null
	}, prevHolderId);
}
/**
* Mirror all player positions/bounds across the centre line and flip attackDir.
* Called at the end of the half-time presentation freeze.
* Team B kicks off the second half (Team A kicked off the first).
*/
function switchSides(state) {
	let positioned = state.players.map((p) => {
		const recoveryRate = .3 + p.stamina / 10 * .3;
		const recoveredEnergy = Math.min(p.startEnergy, p.energy + (p.startEnergy - p.energy) * recoveryRate);
		const energyChanged = recoveredEnergy !== p.energy;
		return {
			...p,
			attackDir: -p.attackDir,
			x: 115 - p.x,
			basePosition: {
				x: 115 - p.basePosition.x,
				y: p.basePosition.y
			},
			targetPosition: {
				x: 115 - p.targetPosition.x,
				y: p.targetPosition.y
			},
			bounds: {
				minX: 115 - p.bounds.maxX,
				maxX: 115 - p.bounds.minX,
				minY: p.bounds.minY,
				maxY: p.bounds.maxY
			},
			energy: recoveredEnergy,
			runtimeStats: energyChanged ? getRuntimeLineup(p.baseStats, { energy: recoveredEnergy }) : p.runtimeStats
		};
	});
	const spA2 = getFormationSetPieces(state.formationA.id);
	const spB2 = getFormationSetPieces(state.formationB.id);
	positioned = applySetPieceToTeam(positioned, "A", spA2?.kickOffDefend ?? generateKickoffLayout(state.formationA));
	positioned = applySetPieceToTeam(positioned, "B", spB2?.kickOff ?? generateKickoffLayout(state.formationB));
	positioned = enforceKickoffCircleRule(positioned, "A");
	const kickoffHolder = positioned.find((p) => p.team === "B" && p.role === "ST") ?? positioned.find((p) => p.team === "B");
	gameBus.emit("kickOff", {
		team: "B",
		phase: "secondHalf"
	});
	const prevHolderId = state.ballHolderId;
	return onPossessionTransfer({
		...state,
		players: positioned,
		ballHolderId: kickoffHolder.id,
		pass: null,
		shot: null,
		looseBall: null,
		matchPhase: "secondHalf",
		matchTime: 0,
		presentationCountdown: 0,
		setPiece: {
			type: "kickoff",
			takerId: kickoffHolder.id,
			countdown: 2
		},
		possessionTime: 0,
		lastPasserId: null
	}, prevHolderId);
}
function startShot(state) {
	const shooter = state.players.find((p) => p.id === state.ballHolderId);
	const { toX, toY } = computeShotAim(shooter);
	const goalX = shooter.attackDir === 1 ? 115 : 0;
	const xg = computeXG(Math.abs(goalX - shooter.x), computeOpenAngle(shooter.x, shooter.y, goalX), computeWeightedPressure(shooter, state.players.filter((p) => p.team !== shooter.team)));
	gameBus.emit("shot", {
		player: shooter.id,
		xg
	});
	return {
		...state,
		shot: {
			shooterId: shooter.id,
			fromX: shooter.x,
			fromY: shooter.y,
			toX,
			toY,
			t: 0,
			xg
		},
		setPiece: null
	};
}
/**
* Determine whether a pass receiver is in an offside position at the instant
* the pass is played. All conditions (opponent half, ahead of ball, ahead of
* second-last defender) are encoded in the effective offside line.
*/
function checkReceiverOffside(holder, receiver, allPlayers) {
	if (!OFFSIDE_CONFIG.ENABLED) return false;
	const fwd = holder.attackDir;
	const line = computeOffsideLine(fwd, allPlayers, holder.team, holder.x);
	if (line === null) return false;
	return fwd === 1 ? receiver.x > line : receiver.x < line;
}
function startPass(state) {
	const holder = state.players.find((p) => p.id === state.ballHolderId);
	const teammates = getTeammates(state, holder.id);
	if (teammates.length === 0) return state;
	const opponents = state.players.filter((p) => p.team !== holder.team);
	const intent = state.teamIntent[holder.team];
	const top3 = [...evaluatePassLanes(holder, teammates, opponents, intent)].sort((a, b) => b.score - a.score).slice(0, 3);
	const k = PASS_CONFIG.PASS_SELECTION_EXPONENT;
	const weights = top3.map((l) => Math.pow(Math.max(0, l.score), k));
	const total = weights.reduce((s, w) => s + w, 0);
	let chosen = top3[0];
	if (total > 0) {
		let roll = Math.random() * total;
		for (let i = 0; i < top3.length; i++) {
			roll -= weights[i];
			if (roll <= 0) {
				chosen = top3[i];
				break;
			}
		}
	}
	const to = state.players.find((p) => p.id === chosen.toId);
	const receiverOffside = checkReceiverOffside(holder, to, state.players);
	const distance = Math.sqrt((to.x - holder.x) ** 2 + (to.y - holder.y) ** 2);
	gameBus.emit("passAttempted", {
		player: holder.id,
		toId: to.id,
		distance
	});
	if (chosen.switchPass) gameBus.emit("switchPlayPass", {
		player: holder.id,
		toId: to.id
	});
	return {
		...state,
		pass: {
			fromId: state.ballHolderId,
			toId: to.id,
			toX: to.x,
			toY: to.y,
			kind: "regular",
			t: 0,
			distance,
			receiverOffside,
			intendedRunnerId: null
		},
		setPiece: null
	};
}
/**
* Sprint speed for a chasing player (yards/second). Re-uses pressSpeed and
* applies heavier acceleration / top-end boosts than press to model an all-out
* sprint. Mirrors the formula in ThroughBallCells.effectiveSprintSpeed.
*/
function chaseSprintSpeed(p) {
	const wb = p.runtimeStats.withoutBall;
	return wb.pressSpeed + wb.acceleration * THROUGH_BALL_CONFIG.SPRINT_ACCEL_BOOST + wb.speed * THROUGH_BALL_CONFIG.SPRINT_TOP_BOOST;
}
/**
* Override `state.decisions` for the top-N chasers from each team — they leave
* their current decision (off-ball intent, defensive intent) to sprint to the
* loose-ball landing point.
*
* Algorithm:
*   1. Rank candidates by ETA (distance / sprint speed)
*   2. Apply role weight (CHASE_LOOSE_BALL_WEIGHT_ATTACK/DEFEND) and ETA horizon gate
*   3. Override the top MAX_CHASERS_PER_TEAM per team with `chase_loose_ball`
*   4. Bump commitTicks so the chase doesn't flicker mid-sprint
*
* GK chase is permitted only when the landing point is inside that GK's own box.
*/
function commitLooseBallChasers(state, passerId, toX, toY) {
	const passer = state.players.find((p) => p.id === passerId);
	if (!passer) return state;
	const passerTeam = passer.team;
	const collect = (team, isAttacking) => {
		const out = [];
		for (const p of state.players) {
			if (p.team !== team) continue;
			if (p.id === passerId) continue;
			if (isPlayerInRecovery(p)) continue;
			let weight = (isAttacking ? CHASE_LOOSE_BALL_WEIGHT_ATTACK : CHASE_LOOSE_BALL_WEIGHT_DEFEND)[p.role];
			if (p.role === "GK") weight = isInGoalScoreArea(toX, toY, p.attackDir === 1 ? 0 : 115) ? 1 : 0;
			if (weight < THROUGH_BALL_CONFIG.ROLE_CHASE_THRESHOLD) continue;
			const dist = Math.hypot(p.x - toX, p.y - toY);
			const speed = chaseSprintSpeed(p);
			const eta = speed > .01 ? dist / speed : Infinity;
			out.push({
				id: p.id,
				team,
				eta,
				role: p.role
			});
		}
		out.sort((a, b) => a.eta - b.eta);
		return out;
	};
	const teamA = collect("A", passerTeam === "A");
	const teamB = collect("B", passerTeam === "B");
	const pickTop = (arr) => {
		if (arr.length === 0) return [];
		const bestEta = arr[0].eta;
		return arr.filter((c) => c.eta - bestEta <= THROUGH_BALL_CONFIG.ETA_HORIZON).slice(0, THROUGH_BALL_CONFIG.MAX_CHASERS_PER_TEAM);
	};
	const chasers = [...pickTop(teamA), ...pickTop(teamB)];
	if (chasers.length === 0) return state;
	if (isDebugEnabled()) gameBus.emit("chaseCommit", {
		toX,
		toY,
		chasers: chasers.map((c) => ({
			id: c.id,
			team: c.team,
			eta: c.eta
		}))
	});
	const newDecisions = { ...state.decisions };
	const newPlayers = state.players.map((p) => {
		if (!chasers.find((x) => x.id === p.id)) return p;
		const chaseDecision = {
			type: "chase_loose_ball",
			toX,
			toY
		};
		newDecisions[p.id] = chaseDecision;
		const path = p.team === passerTeam ? "TEAM_WITH_BALL" : "TEAM_WITHOUT_BALL";
		return {
			...p,
			decisionMemory: {
				path,
				decision: chaseDecision,
				commitTicks: COMMIT_TICKS.chase_loose_ball
			}
		};
	});
	return {
		...state,
		decisions: newDecisions,
		players: newPlayers
	};
}
/**
* Start a through ball — pass into space at (cellX, cellY).
*
* The ball is in flight to a position, not a player. Phase 3: on landing the
* nearest player picks it up. Phase 5 will replace this with a sprint race +
* loose-ball duel.
*/
function startThroughBall(state, decision) {
	const holder = state.players.find((p) => p.id === state.ballHolderId);
	const sigma = (1 - holder.runtimeStats.withBall.passingSkill) * THROUGH_BALL_CONFIG.MAX_THROUGH_BALL_ERROR / 2;
	const u1 = Math.max(1e-6, Math.random());
	const u2 = Math.random();
	const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
	const landingX = decision.cellX + z0 * sigma;
	const landingY = decision.cellY + z1 * sigma;
	const intendedRunner = decision.intendedRunnerId ? state.players.find((p) => p.id === decision.intendedRunnerId) ?? null : null;
	const runnerOffside = intendedRunner ? checkReceiverOffside(holder, intendedRunner, state.players) : false;
	const distance = Math.sqrt((landingX - holder.x) ** 2 + (landingY - holder.y) ** 2);
	gameBus.emit("passAttempted", {
		player: holder.id,
		toId: holder.id,
		distance
	});
	gameBus.emit("throughBallStarted", {
		player: holder.id,
		toX: landingX,
		toY: landingY,
		intendedRunnerId: decision.intendedRunnerId
	});
	`${holder.name}${landingX.toFixed(0)}${landingY.toFixed(0)}`, holder.id, decision.intendedRunnerId;
	return commitLooseBallChasers({
		...state,
		pass: {
			fromId: state.ballHolderId,
			toId: null,
			toX: landingX,
			toY: landingY,
			kind: "through",
			t: 0,
			distance,
			receiverOffside: runnerOffside,
			intendedRunnerId: decision.intendedRunnerId
		},
		setPiece: null
	}, holder.id, landingX, landingY);
}
function nearestPlayerTo(pool, pos) {
	return pool.reduce((best, p) => {
		return (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 < (best.x - pos.x) ** 2 + (best.y - pos.y) ** 2 ? p : best;
	});
}
function oobLayoutFor(kind, side, layouts) {
	if (kind === "throw_in") return side === "attack" ? layouts.throwIn_Attack : layouts.throwIn_Defend;
	if (kind === "corner") return side === "attack" ? layouts.corner_Attack : layouts.corner_Defend;
	return side === "attack" ? layouts.goalKick : layouts.kickOffDefend;
}
function oobCountdownFor(kind) {
	if (kind === "throw_in") return 1.5;
	if (kind === "corner") return 2;
	return 1;
}
/**
* Compute the actual ball-restart position on the pitch boundary.
*
* - throw_in: clamp X, snap Y to whichever touchline was crossed.
* - corner:   snap to the corner flag of the line crossed, on the side the ball went out.
* - goal_kick: 6-yard box edge of the awarded team's goal, centred.
*/
function computeOOBRestartPosition(kind, exitX, exitY, awardedTeam, players) {
	if (kind === "throw_in") return {
		x: Math.max(0, Math.min(115, exitX)),
		y: exitY < 0 ? 0 : 74
	};
	if (kind === "corner") return {
		x: exitX < 0 ? 0 : 115,
		y: exitY < 37 ? 0 : 74
	};
	return {
		x: ((players.find((p) => p.team === awardedTeam)?.attackDir ?? 1) === 1 ? 0 : 115) === 0 ? 6 : 109,
		y: 37
	};
}
/**
* Pick which player on the awarded team takes the restart.
*
* - goal_kick: GK always.
* - corner:    nearest winger / wide player to the corner flag side.
* - throw_in:  nearest outfield player to the throw-in spot.
*/
function pickOOBTaker(kind, awardedTeam, position, players) {
	const team = players.filter((p) => p.team === awardedTeam);
	if (kind === "goal_kick") return team.find((p) => p.role === "GK") ?? nearestPlayerTo(team, position);
	if (kind === "corner") {
		const preferred = position.y === 0 ? [
			"LW",
			"LM",
			"LWB",
			"LB"
		] : [
			"RW",
			"RM",
			"RWB",
			"RB"
		];
		for (const role of preferred) {
			const found = team.find((p) => p.role === role);
			if (found) return found;
		}
		return nearestPlayerTo(team, position);
	}
	const outfield = team.filter((p) => p.role !== "GK");
	return nearestPlayerTo(outfield.length > 0 ? outfield : team, position);
}
/**
* Resolve a ball-out-of-bounds event into a set-piece freeze.
*
* Full sequence:
*   1. Choose restart position (corner flag / touchline / six-yard line).
*   2. Pick taker (winger / GK / closest outfield).
*   3. Apply the awarded team into _Attack layout, opposite team into _Defend layout.
*   4. Move the taker on top of the ball position (overrides their layout slot).
*   5. Emit existing TB-lost stat events so /lab still tracks the failed pass.
*   6. Set state.setPiece with kind + taker + countdown + position.
*/
function resolveOOBSetPiece(s, kind, awardedTeam, exitX, exitY, fromPasserId) {
	const oppositeTeam = awardedTeam === "A" ? "B" : "A";
	const position = computeOOBRestartPosition(kind, exitX, exitY, awardedTeam, s.players);
	const taker = pickOOBTaker(kind, awardedTeam, position, s.players);
	const awFmt = awardedTeam === "A" ? s.formationA : s.formationB;
	const opFmt = awardedTeam === "A" ? s.formationB : s.formationA;
	const aLay = getFormationSetPieces(awFmt.id);
	const oLay = getFormationSetPieces(opFmt.id);
	let players = s.players;
	if (aLay) players = applySetPieceToTeam(players, awardedTeam, oobLayoutFor(kind, "attack", aLay));
	if (oLay) players = applySetPieceToTeam(players, oppositeTeam, oobLayoutFor(kind, "defend", oLay));
	players = players.map((p) => p.id === taker.id ? {
		...p,
		x: position.x,
		y: position.y,
		targetPosition: {
			x: position.x,
			y: position.y
		}
	} : p);
	gameBus.emit("throughBallLostInRace", {
		player: fromPasserId,
		defenderWinnerId: taker.id
	});
	`${exitX.toFixed(1)}${exitY.toFixed(1)}${kind}${awardedTeam}${taker.name}`, taker.id;
	const prevHolderId = s.ballHolderId;
	return {
		state: onPossessionTransfer({
			...s,
			players,
			looseBall: null,
			ballHolderId: taker.id,
			possessionTime: 0,
			lastPasserId: null,
			setPiece: {
				type: kind,
				takerId: taker.id,
				countdown: oobCountdownFor(kind),
				position
			}
		}, prevHolderId),
		passCompleted: false,
		tackled: false,
		goalScored: null
	};
}
/**
* Tick the loose-ball phase — the ball drifts in space at `state.looseBall.{x,y}`
* after a through ball lands. Each tick we:
*   1. Advance the ball by its current velocity.
*   2. Decay velocity via LOOSE_BALL_DECELERATION (friction).
*   3. If the ball crosses a pitch boundary → award to the opposing team.
*   4. Otherwise check who's within LOOSE_BALL_TOUCH_RADIUS:
*      • 0 players in touch → ball keeps drifting (or sits if velocity = 0).
*      • 1 player in touch (or top-2 are same-team / gap > DUEL_GAP_TRIGGER) →
*        clean pickup, possession transfers.
*      • 2 opposing players within DUEL_RADIUS and gap ≤ DUEL_GAP_TRIGGER →
*        contested duel (resolveLooseBallDuel), both enter recovery.
*
* Players continue sprinting because their `chase_loose_ball` decisions are
* pinned by the decision loop with the *current* loose-ball position, so
* chasers automatically track the drifting ball.
*
* Offside enforcement runs at pickup time only when the *intended runner* is
* the one who collects. Out-of-bounds awards bypass offside entirely.
*/
function handleLooseBall(s, dt) {
	const cfg = THROUGH_BALL_CONFIG;
	let lb = s.looseBall;
	let { x, y, vx, vy } = lb;
	const speed = Math.hypot(vx, vy);
	if (speed > 0) {
		const factor = Math.max(0, speed - cfg.LOOSE_BALL_DECELERATION * dt) / speed;
		vx *= factor;
		vy *= factor;
		x += lb.vx * dt;
		y += lb.vy * dt;
	}
	if (x < 0 || x > 115 || y < 0 || y > 74) {
		const passerDir = s.players.find((p) => p.id === lb.fromPasserId)?.attackDir ?? 1;
		const awardedTeam = lb.fromTeamLastTouch === "A" ? "B" : "A";
		let kind;
		if (y < 0 || y > 74) kind = "throw_in";
		else kind = passerDir === 1 && x > 115 || passerDir === -1 && x < 0 ? "goal_kick" : "corner";
		return resolveOOBSetPiece(s, kind, awardedTeam, x, y, lb.fromPasserId);
	}
	s = {
		...s,
		looseBall: {
			...lb,
			x,
			y,
			vx,
			vy
		}
	};
	lb = s.looseBall;
	s.players.find((p) => p.id === lb.fromPasserId);
	const inTouch = s.players.filter((p) => !isPlayerInRecovery(p)).map((p) => ({
		p,
		dist: Math.hypot(p.x - lb.x, p.y - lb.y)
	})).sort((a, b) => a.dist - b.dist).filter((r) => r.dist <= cfg.LOOSE_BALL_TOUCH_RADIUS);
	if (inTouch.length === 0) return {
		state: s,
		passCompleted: false,
		tackled: false,
		goalScored: null
	};
	let winner;
	let duelLost = false;
	if (inTouch.length >= 2 && inTouch[0].p.team !== inTouch[1].p.team && inTouch[1].dist <= cfg.DUEL_RADIUS && inTouch[1].dist - inTouch[0].dist <= cfg.DUEL_GAP_TRIGGER) {
		const a = inTouch[0].p;
		const b = inTouch[1].p;
		const gap = inTouch[1].dist - inTouch[0].dist;
		const { winnerId, probA } = resolveLooseBallDuel(a, b, gap);
		winner = winnerId === a.id ? a : b;
		`${a.name}${b.name}${winner.name}${probA.toFixed(2)}`, winner.id, lb.fromPasserId, Math.round(gap * 10) / 10;
		s = {
			...s,
			players: s.players.map((p) => {
				if (p.id === a.id || p.id === b.id) return {
					...p,
					recoveryTime: DUEL_TACKLE_WIN_RECOVERY
				};
				return p;
			})
		};
		if (winner.team !== lb.fromTeamLastTouch) {
			gameBus.emit("throughBallLostInDuel", {
				player: lb.fromPasserId,
				defenderWinnerId: winner.id
			});
			duelLost = true;
		}
	} else winner = inTouch[0].p;
	if (lb.receiverOffside && lb.intendedRunnerId !== null && winner.id === lb.intendedRunnerId) {
		gameBus.emit("offsideCalled", {
			team: winner.team,
			receiverId: winner.id
		});
		gameBus.emit("throughBallLostInFlight", {
			player: lb.fromPasserId,
			interceptorId: winner.id
		});
		const nearestDefender = s.players.filter((p) => p.team !== winner.team).reduce((best, p) => {
			return (p.x - lb.x) ** 2 + (p.y - lb.y) ** 2 < (best.x - lb.x) ** 2 + (best.y - lb.y) ** 2 ? p : best;
		});
		const prevHolderId = s.ballHolderId;
		return {
			state: onPossessionTransfer({
				...s,
				looseBall: null,
				ballHolderId: nearestDefender.id,
				possessionTime: 0,
				lastPasserId: null,
				setPiece: {
					type: "offside_fk",
					takerId: nearestDefender.id,
					countdown: 2,
					position: {
						x: lb.x,
						y: lb.y
					}
				}
			}, prevHolderId),
			passCompleted: false,
			tackled: false,
			goalScored: null
		};
	}
	if (winner.team === lb.fromTeamLastTouch) {
		lb.intendedRunnerId, winner.id;
		gameBus.emit("throughBallCompleted", {
			player: lb.fromPasserId,
			winnerId: winner.id,
			intendedRunnerId: lb.intendedRunnerId
		});
		`${winner.name}`, winner.id, lb.fromPasserId;
		return {
			state: {
				...s,
				ballHolderId: winner.id,
				looseBall: null,
				lastPasserId: lb.fromPasserId,
				players: s.players.map((p) => p.id === winner.id ? {
					...p,
					justReceivedTicks: 4
				} : p)
			},
			passCompleted: true,
			tackled: false,
			goalScored: null
		};
	}
	if (!duelLost) gameBus.emit("throughBallLostInRace", {
		player: lb.fromPasserId,
		defenderWinnerId: winner.id
	});
	`${winner.name}`, winner.id, lb.fromPasserId;
	const prevHolderId = s.ballHolderId;
	return {
		state: onPossessionTransfer({
			...s,
			looseBall: null,
			ballHolderId: winner.id,
			possessionTime: 0,
			lastPasserId: null
		}, prevHolderId),
		passCompleted: false,
		tackled: true,
		goalScored: null
	};
}
/**
* Advance the simulation by `dt` seconds.
*
* Order of operations each tick (ball-held frame only):
*   1. Apply formation/press movement — GK sprints to intercept during a shot
*   2. Tackle check — closest opponent within tackleRange gets a 50 % attempt
*   3. Shoot or pass decision — holder decides based on distance to goal
*
* During a pass or shot in flight, only ball advancement runs (no pressing/tackling).
*/
function tickState(state, dt, passSpeed = .85) {
	const noop = (s) => ({
		state: s,
		passCompleted: false,
		tackled: false,
		goalScored: null
	});
	if (state.matchPhase === "preMatch") {
		const countdown = state.presentationCountdown - dt;
		if (countdown <= 0) {
			gameBus.emit("matchStart", { extraTime: Math.round(state.extraTimeFirst / 60) });
			gameBus.emit("kickOff", {
				team: "A",
				phase: "firstHalf"
			});
			return noop({
				...state,
				matchPhase: "firstHalf",
				presentationCountdown: 0
			});
		}
		return noop({
			...state,
			presentationCountdown: countdown
		});
	}
	if (state.matchPhase === "halfTime") {
		const countdown = state.presentationCountdown - dt;
		if (countdown <= 0) return noop(switchSides(state));
		let htState = {
			...state,
			presentationCountdown: countdown
		};
		if (htState.pendingSubsA.length > 0 || htState.pendingSubsB.length > 0) {
			htState = flushPendingSubs(htState, "A");
			htState = flushPendingSubs(htState, "B");
		}
		return noop(htState);
	}
	if (state.matchPhase === "matchEnd") return noop(state);
	const newMatchTime = state.matchTime + dt * TIME_SCALE;
	const extraTime = state.matchPhase === "firstHalf" ? state.extraTimeFirst : state.extraTimeSecond;
	const halfEnd = HALF_DURATION + extraTime;
	if (!state.testMode && newMatchTime >= halfEnd) {
		if (state.matchPhase === "firstHalf") {
			gameBus.emit("halfTime", {
				score: state.score,
				extraTime: Math.round(state.extraTimeSecond / 60)
			});
			return noop({
				...state,
				matchTime: newMatchTime,
				matchPhase: "halfTime",
				presentationCountdown: PRESENTATION_DURATION,
				pass: null,
				shot: null,
				looseBall: null
			});
		} else {
			gameBus.emit("matchEnd", { score: state.score });
			return noop({
				...state,
				matchTime: newMatchTime,
				matchPhase: "matchEnd"
			});
		}
	}
	if (state.setPiece && state.setPiece.countdown > 0) {
		const nextCountdown = Math.max(0, state.setPiece.countdown - dt);
		let frozenState = {
			...state,
			matchTime: newMatchTime,
			setPiece: {
				...state.setPiece,
				countdown: nextCountdown
			}
		};
		if (frozenState.pendingSubsA.length > 0 || frozenState.pendingSubsB.length > 0) {
			frozenState = flushPendingSubs(frozenState, "A");
			frozenState = flushPendingSubs(frozenState, "B");
		}
		return noop(frozenState);
	}
	let s = {
		...state,
		matchTime: newMatchTime,
		tackleCooldown: Math.max(0, state.tackleCooldown - dt),
		players: state.players.map((p) => {
			const updates = {};
			if (p.recoveryTime > 0) updates.recoveryTime = Math.max(0, p.recoveryTime - dt);
			if (p.justReceivedTicks > 0) updates.justReceivedTicks = p.justReceivedTicks - 1;
			return Object.keys(updates).length > 0 ? {
				...p,
				...updates
			} : p;
		})
	};
	if (s.pendingSubsA.length > 0 || s.pendingSubsB.length > 0) {
		if (s.players.find((p) => p.id === s.ballHolderId)?.role === "GK" && s.pass === null && s.shot === null) {
			s = flushPendingSubs(s, "A");
			s = flushPendingSubs(s, "B");
		}
	}
	if (s.matchPhase === "secondHalf" && shouldCheckAiSubs(s.matchTime, dt * TIME_SCALE)) {
		const subsB = evaluateAiSubstitutions(s, "B");
		if (subsB.length > 0) s = {
			...s,
			pendingSubsB: [...s.pendingSubsB, ...subsB]
		};
	}
	const holder = s.players.find((p) => p.id === s.ballHolderId);
	const inFlight = s.pass !== null || s.shot !== null;
	s = {
		...s,
		possessionTime: (state.possessionTime ?? 0) + dt
	};
	const lastEval = s.lastIntentEvalTime ?? 0;
	if (s.matchTime - lastEval >= INTENT_REEVAL_INTERVAL) s = reevaluateTeamIntents(s, { includeSwitchPlay: false });
	const ballPos = getBallPos(s);
	const attackingTeam = holder.team;
	const defendingTeam = attackingTeam === "A" ? "B" : "A";
	const offsideLine = computeOffsideLine(holder.attackDir, s.players, attackingTeam, ballPos.x);
	const crowdGrid = computeCrowdGrid(s);
	const TB_CACHE_REFRESH_TICKS = 2;
	let tbCachedCells = null;
	let nextTbCache = s.throughBallCellsCache ?? null;
	if (!inFlight && holder.role !== "GK") {
		const cache = s.throughBallCellsCache;
		if (cache != null && cache.holderId === s.ballHolderId && cache.ticksSinceRefresh < TB_CACHE_REFRESH_TICKS) {
			tbCachedCells = cache.cells;
			nextTbCache = {
				...cache,
				ticksSinceRefresh: cache.ticksSinceRefresh + 1
			};
		} else {
			tbCachedCells = enumerateCandidateCells(holder, s.players, crowdGrid, offsideLine);
			nextTbCache = {
				holderId: s.ballHolderId,
				ticksSinceRefresh: 1,
				cells: tbCachedCells
			};
		}
	} else if (s.throughBallCellsCache != null) nextTbCache = null;
	s = {
		...s,
		throughBallCellsCache: nextTbCache
	};
	const newDecisions = {};
	const updatedMemory = {};
	const tbInFlight = s.pass?.kind === "through";
	const looseBallSit = s.looseBall != null;
	const chaseTarget = tbInFlight ? {
		x: s.pass.toX,
		y: s.pass.toY
	} : looseBallSit ? {
		x: s.looseBall.x,
		y: s.looseBall.y
	} : null;
	for (const p of s.players) {
		const isBallHolder = p.id === s.ballHolderId;
		const currentPath = isBallHolder ? "BALL_HOLDER" : p.team === holder.team ? "TEAM_WITH_BALL" : "TEAM_WITHOUT_BALL";
		const mem = p.decisionMemory ?? EMPTY_DECISION_MEMORY;
		if (chaseTarget && !isBallHolder && mem.decision?.type === "chase_loose_ball") {
			const chaseDecision = {
				type: "chase_loose_ball",
				toX: chaseTarget.x,
				toY: chaseTarget.y
			};
			newDecisions[p.id] = chaseDecision;
			updatedMemory[p.id] = {
				path: currentPath,
				decision: chaseDecision,
				commitTicks: COMMIT_TICKS.chase_loose_ball
			};
			continue;
		}
		const pathChanged = mem.path !== currentPath;
		if (!isBallHolder && !pathChanged && mem.commitTicks > 0 && mem.decision !== null) {
			newDecisions[p.id] = mem.decision;
			updatedMemory[p.id] = {
				...mem,
				commitTicks: mem.commitTicks - 1
			};
			continue;
		}
		const fresh = decide(p, holder, isBallHolder, inFlight, s.players, offsideLine, s.possessionTime, s.setPiece, crowdGrid, s.teamIntent, isBallHolder ? tbCachedCells : null);
		newDecisions[p.id] = fresh;
		updatedMemory[p.id] = {
			path: currentPath,
			decision: fresh,
			commitTicks: COMMIT_TICKS[fresh.type]
		};
	}
	const playersWithMemory = s.players.map((p) => ({
		...p,
		decisionMemory: updatedMemory[p.id] ?? p.decisionMemory
	}));
	s = {
		...s,
		decisions: newDecisions,
		players: playersWithMemory
	};
	if (shouldDrainStamina(s)) s = {
		...s,
		players: s.players.map((p) => {
			const pl = normalizeGamePlayer(p);
			if (pl.baseStats == null) return p;
			const dec = newDecisions[pl.id];
			const action = resolveStaminaAction(pl, s.ballHolderId, holder.team, dec);
			const energy = consumeEnergy(pl.energy, pl.stamina, action, dt * TIME_SCALE);
			if (energy === pl.energy) return p;
			const oldLost = 100 - pl.energy;
			const newLost = 100 - energy;
			if (!(Math.floor(oldLost / 10) !== Math.floor(newLost / 10) || Math.floor(oldLost / 20) !== Math.floor(newLost / 20) || Math.floor(oldLost / 40) !== Math.floor(newLost / 40))) return {
				...pl,
				energy
			};
			return {
				...pl,
				energy,
				runtimeStats: getRuntimeLineup(pl.baseStats, { energy })
			};
		})
	};
	{
		const markAssignments = assignMarkTargets(s.players, defendingTeam);
		const movedPlayers = s.players.map((player) => {
			if (player.id === s.ballHolderId) return player;
			if (s.shot !== null && player.role === "GK") {
				const shooter = s.players.find((p) => p.id === s.shot.shooterId);
				if (shooter && player.team !== shooter.team) {
					const gkTarget = {
						x: s.shot.toX,
						y: s.shot.toY
					};
					const dx = gkTarget.x - player.x;
					const dy = gkTarget.y - player.y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					if (dist < .01) return {
						...player,
						targetPosition: gkTarget
					};
					const recoveryMult = player.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
					const step = Math.min(player.runtimeStats.withoutBall.pressSpeed * recoveryMult * dt, dist);
					return {
						...player,
						x: player.x + dx / dist * step,
						y: player.y + dy / dist * step,
						targetPosition: gkTarget
					};
				}
			}
			const decision = s.decisions[player.id];
			const phase = teamHasBall(s, player.team) ? "attacking" : "defending";
			const isPressing = decision?.type === "press";
			const isOffBallRun = phase === "attacking" && (decision?.type === "support_run" || decision?.type === "create_space");
			const isChasingLooseBall = decision?.type === "chase_loose_ball";
			const formation = player.team === "A" ? s.formationA : s.formationB;
			let target;
			if (isChasingLooseBall && decision.type === "chase_loose_ball") {
				const sprintSpeed = player.runtimeStats.withoutBall.pressSpeed + player.runtimeStats.withoutBall.acceleration * THROUGH_BALL_CONFIG.SPRINT_ACCEL_BOOST + player.runtimeStats.withoutBall.speed * THROUGH_BALL_CONFIG.SPRINT_TOP_BOOST;
				const targetPt = {
					x: Math.max(0, Math.min(115, decision.toX)),
					y: Math.max(0, Math.min(74, decision.toY))
				};
				const cdx = targetPt.x - player.x;
				const cdy = targetPt.y - player.y;
				const cdist = Math.hypot(cdx, cdy);
				if (cdist < .01) return {
					...player,
					targetPosition: targetPt
				};
				const recoveryMult = player.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
				const step = Math.min(sprintSpeed * recoveryMult * dt, cdist);
				return {
					...player,
					x: player.x + cdx / cdist * step,
					y: player.y + cdy / cdist * step,
					targetPosition: targetPt
				};
			}
			if (isPressing) {
				const holderDecision = s.decisions[holder.id];
				if (holderDecision?.type === "carry") {
					const { dx: cdx, dy: cdy } = holderDecision;
					const holderCarrySpeed = holder.runtimeStats.withBall.carrySpeed;
					const presserSpeed = player.runtimeStats.withoutBall.pressSpeed + player.runtimeStats.withoutBall.acceleration * getDefenseConfig(player.team).PRESS_ACCEL_SPEED_BOOST;
					const distToHolder = Math.hypot(holder.x - player.x, holder.y - player.y);
					const lookahead = Math.min(distToHolder * holderCarrySpeed / (holderCarrySpeed + presserSpeed), PRESS_INTERCEPT_MAX_LOOKAHEAD);
					target = {
						x: Math.max(0, Math.min(115, holder.x + cdx * lookahead)),
						y: Math.max(0, Math.min(74, holder.y + cdy * lookahead))
					};
				} else target = {
					x: holder.x,
					y: holder.y
				};
			} else if (isOffBallRun && (decision?.type === "support_run" || decision?.type === "create_space")) {
				const visionNorm = Math.min(1, player.runtimeStats.withBall.carryVision / 18);
				const roleBias = getOffBallBias(player.role);
				const lookahead = (OFF_BALL_CONFIG.BASE_LOOKAHEAD + (OFF_BALL_CONFIG.MAX_LOOKAHEAD - OFF_BALL_CONFIG.BASE_LOOKAHEAD) * visionNorm) * roleBias;
				const rawX = player.x + decision.dx * lookahead;
				const rawY = player.y + decision.dy * lookahead;
				const base = resolveBasePosition(player.slotIndex, player.attackDir, formation, "attacking");
				const pushUpT = Math.min(1, s.possessionTime / POSSESSION_PUSH_UP.BASE_SECONDS);
				const pushUpBias = PUSH_UP_ROLE_BIAS[player.role] ?? 0;
				const pushedBaseX = base.x + player.attackDir * pushUpT * POSSESSION_PUSH_UP.MAX_YARDS * pushUpBias;
				const pull = 1 - OFF_BALL_CONFIG.FORMATION_PULL;
				let tx = pushedBaseX + (rawX - pushedBaseX) * pull;
				const ty = base.y + (rawY - base.y) * pull;
				if (offsideLine !== null) {
					const fwd = player.attackDir;
					const safeX = offsideLine - fwd * ATTACK_CONFIG.OFFSIDE_MARGIN;
					if ((tx - safeX) * fwd > 0) tx = safeX;
				}
				target = {
					x: Math.max(0, Math.min(115, tx)),
					y: Math.max(0, Math.min(74, ty))
				};
			} else {
				const markTargetId = (decision?.type === "track_mark" ? decision.markTargetId : void 0) ?? markAssignments.get(player.id);
				target = computeTargetPosition(player, phase, ballPos, s.players, formation, s.ballHolderId, decision?.type, offsideLine, markTargetId, s.possessionTime);
			}
			const dx = target.x - player.x;
			const dy = target.y - player.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < .01) return {
				...player,
				targetPosition: target
			};
			const baseSpeed = player.runtimeStats.withoutBall.pressSpeed;
			const holderJustReceived = holder.justReceivedTicks > 0 && isOffBallRun && (holder.x - player.x) ** 2 + (holder.y - player.y) ** 2 < 225;
			const accelBurst = isPressing ? player.runtimeStats.withoutBall.acceleration * getDefenseConfig(player.team).PRESS_ACCEL_SPEED_BOOST : holderJustReceived ? player.runtimeStats.withoutBall.acceleration * CARRY_ACCEL_SPEED_BOOST : 0;
			const recoveryMult = player.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
			const step = Math.min(globalThis.__tpGovern(decision?.type, isPressing, isOffBallRun, dist, (baseSpeed + accelBurst) * recoveryMult) * dt, dist);
			return {
				...player,
				x: player.x + dx / dist * step,
				y: player.y + dy / dist * step,
				targetPosition: target
			};
		});
		s = {
			...s,
			players: movedPlayers
		};
	}
	if (s.shot) {
		const newT = s.shot.t + dt * 2;
		if (newT >= 1) {
			const { toY, shooterId } = s.shot;
			const shooter = s.players.find((p) => p.id === shooterId);
			const defendingGK = s.players.find((p) => p.team !== shooter.team && p.role === "GK") ?? null;
			const { isGoal, inPosts, goalChance } = resolveShot(shooter, defendingGK, s.shot);
			gameBus.emit("shotResolved", {
				player: shooter.id,
				xg: s.shot.xg,
				goalChance,
				isGoal,
				inPosts
			});
			if (inPosts && isGoal) {
				const newScore = {
					...s.score,
					[shooter.team]: s.score[shooter.team] + 1
				};
				const assistId = s.lastPasserId !== null && s.lastPasserId !== shooter.id ? s.lastPasserId : void 0;
				gameBus.emit("goalScored", {
					team: shooter.team,
					score: newScore,
					scorerId: shooter.id,
					assistId
				});
				const concedingTeam = shooter.team === "A" ? "B" : "A";
				return {
					state: resetToKickoff({
						...s,
						score: newScore
					}, concedingTeam),
					passCompleted: false,
					tackled: false,
					goalScored: shooter.team
				};
			} else if (!inPosts && !defendingGK) return {
				state: {
					...s,
					shot: null,
					ballHolderId: shooter.id
				},
				passCompleted: false,
				tackled: false,
				goalScored: null
			};
			else {
				const goalKickLayout = getFormationSetPieces(((defendingGK ?? shooter).team === "A" ? s.formationA : s.formationB).id)?.goalKick;
				let gkPlayers = s.players;
				if (defendingGK && inPosts && !isGoal) gkPlayers = applyStaminaCost(gkPlayers, defendingGK.id, "gkSave");
				if (goalKickLayout && defendingGK) gkPlayers = applySetPieceToTeam(gkPlayers, defendingGK.team, goalKickLayout);
				const newHolder = defendingGK ?? shooter;
				const prevHolderId = s.ballHolderId;
				return {
					state: onPossessionTransfer({
						...s,
						shot: null,
						ballHolderId: newHolder.id,
						possessionTime: 0,
						lastPasserId: null,
						players: gkPlayers,
						setPiece: {
							type: "goal_kick",
							takerId: newHolder.id,
							countdown: 1
						}
					}, prevHolderId),
					passCompleted: false,
					tackled: false,
					goalScored: null
				};
			}
		}
		return {
			state: {
				...s,
				shot: {
					...s.shot,
					t: newT
				}
			},
			passCompleted: false,
			tackled: false,
			goalScored: null
		};
	}
	if (s.looseBall) return handleLooseBall(s, dt);
	if (!s.pass) {
		if (s.tackleCooldown === 0) {
			const updatedHolder = s.players.find((p) => p.id === s.ballHolderId);
			let tackler = null;
			let closestDist = Infinity;
			const holderDec = s.decisions[s.ballHolderId];
			const dribbleTargetId = holderDec?.type === "dribble" ? holderDec.targetId : null;
			for (const player of s.players) {
				if (player.team === updatedHolder.team) continue;
				if (player.id === dribbleTargetId) continue;
				if (isPlayerInRecovery(player)) continue;
				const d = distSq(player, updatedHolder);
				const dec = s.decisions[player.id]?.type;
				if ((dec === "tackle" || dec === "press" && d <= 4) && d < closestDist) {
					tackler = player;
					closestDist = d;
				}
			}
			if (tackler !== null) {
				s = {
					...s,
					tackleCooldown: TACKLE_COOLDOWN,
					players: applyStaminaCost(s.players, tackler.id, "tackle")
				};
				const tacklerNow = s.players.find((p) => p.id === tackler.id);
				const PRESS_LOAD_RADIUS = 8;
				let pressingLoad = 0;
				for (const p of s.players) {
					if (p.team === updatedHolder.team) continue;
					if (p.id === tackler.id) continue;
					if (isPlayerInRecovery(p)) continue;
					const d = Math.sqrt((p.x - updatedHolder.x) ** 2 + (p.y - updatedHolder.y) ** 2);
					if (d >= PRESS_LOAD_RADIUS) continue;
					const weight = s.decisions[p.id]?.type === "press" ? 1 : .5;
					pressingLoad += weight * (1 - d / PRESS_LOAD_RADIUS);
				}
				pressingLoad = Math.min(1, pressingLoad);
				const { success, chance } = resolveTackle(tacklerNow, updatedHolder, pressingLoad);
				gameBus.emit("tackle", {
					player: tackler.id,
					targetId: updatedHolder.id,
					success,
					chance
				});
				if (success) {
					const prevHolderId = s.ballHolderId;
					s = onPossessionTransfer({
						...s,
						ballHolderId: tackler.id,
						possessionTime: 0,
						lastPasserId: null,
						players: s.players.map((p) => {
							if (p.id === tackler.id) return {
								...p,
								recoveryTime: DUEL_TACKLE_WIN_RECOVERY
							};
							if (p.id === updatedHolder.id) return {
								...p,
								recoveryTime: DUEL_TACKLE_LOSS_RECOVERY
							};
							return p;
						})
					}, prevHolderId);
					return {
						state: s,
						passCompleted: false,
						tackled: true,
						goalScored: null
					};
				} else s = {
					...s,
					players: s.players.map((p) => p.id === tackler.id ? {
						...p,
						recoveryTime: 1
					} : p)
				};
			}
		}
	}
	if (!s.pass) {
		const holderDecision = s.decisions[s.ballHolderId];
		if (holderDecision?.type === "shoot") return {
			state: startShot(s),
			passCompleted: false,
			tackled: false,
			goalScored: null
		};
		if (holderDecision?.type === "through_ball") return {
			state: startThroughBall(s, holderDecision),
			passCompleted: false,
			tackled: false,
			goalScored: null
		};
		{
			const carrier0 = s.players.find((p) => p.id === s.ballHolderId);
			if (carrier0.justReceivedTicks > 0) {
				let nearestOpp = null;
				let nearestDistSq = Infinity;
				for (const p of s.players) {
					if (p.team === carrier0.team) continue;
					const dSq = (p.x - carrier0.x) ** 2 + (p.y - carrier0.y) ** 2;
					if (dSq < nearestDistSq) {
						nearestDistSq = dSq;
						nearestOpp = p;
					}
				}
				if (nearestOpp && nearestDistSq < 36) {
					const odx = carrier0.x - nearestOpp.x;
					const ody = carrier0.y - nearestOpp.y;
					const olen = Math.sqrt(odx * odx + ody * ody);
					if (olen >= .01) {
						const step = carrier0.runtimeStats.withBall.carrySpeed * (.4 + carrier0.runtimeStats.withBall.dribbling * .6) * dt;
						const newX = Math.max(0, Math.min(115, carrier0.x + odx / olen * step));
						const newY = Math.max(0, Math.min(74, carrier0.y + ody / olen * step));
						const updated = {
							...carrier0,
							x: newX,
							y: newY,
							targetPosition: {
								x: newX,
								y: newY
							}
						};
						s = {
							...s,
							players: s.players.map((p) => p.id === updated.id ? updated : p)
						};
						return {
							state: s,
							passCompleted: false,
							tackled: false,
							goalScored: null
						};
					}
				}
			}
		}
		if (holderDecision?.type === "carry") {
			const carrier = s.players.find((p) => p.id === s.ballHolderId);
			const wb = carrier.runtimeStats.withBall;
			const accelBurst = s.players.some((p) => p.team !== carrier.team && (s.decisions[p.id]?.type === "press" || s.decisions[p.id]?.type === "tackle")) ? wb.acceleration * CARRY_ACCEL_SPEED_BOOST : 0;
			const recoveryMult = carrier.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
			const step = (wb.carrySpeed + accelBurst) * recoveryMult * dt;
			const newX = Math.max(0, Math.min(115, carrier.x + holderDecision.dx * step));
			const newY = Math.max(0, Math.min(74, carrier.y + holderDecision.dy * step));
			const updatedCarrier = {
				...carrier,
				x: newX,
				y: newY,
				targetPosition: {
					x: newX,
					y: newY
				}
			};
			s = {
				...s,
				players: s.players.map((p) => p.id === updatedCarrier.id ? updatedCarrier : p)
			};
			return {
				state: s,
				passCompleted: false,
				tackled: false,
				goalScored: null
			};
		}
		if (holderDecision?.type === "dribble") {
			const attacker = s.players.find((p) => p.id === s.ballHolderId);
			const defender = s.players.find((p) => p.id === holderDecision.targetId) ?? null;
			if (defender) {
				const ddx = defender.x - attacker.x;
				const ddy = defender.y - attacker.y;
				const dist = Math.sqrt(ddx * ddx + ddy * ddy);
				if (dist > 2) {
					const recoveryMult = attacker.recoveryTime > 0 ? DUEL_RECOVERY_SPEED_FACTOR : 1;
					const step = Math.min(attacker.runtimeStats.withBall.carrySpeed * recoveryMult * dt, dist);
					const newX = Math.max(0, Math.min(115, attacker.x + ddx / dist * step));
					const newY = Math.max(0, Math.min(74, attacker.y + ddy / dist * step));
					const updatedAttacker = {
						...attacker,
						x: newX,
						y: newY,
						targetPosition: {
							x: defender.x,
							y: defender.y
						}
					};
					s = {
						...s,
						players: s.players.map((p) => p.id === updatedAttacker.id ? updatedAttacker : p)
					};
					return {
						state: s,
						passCompleted: false,
						tackled: false,
						goalScored: null
					};
				}
				const DRIBBLE_CROWD_RADIUS = 8;
				let dribblePressLoad = 0;
				for (const p of s.players) {
					if (p.team === attacker.team) continue;
					if (p.id === defender.id) continue;
					if (isPlayerInRecovery(p)) continue;
					const d = Math.sqrt((p.x - attacker.x) ** 2 + (p.y - attacker.y) ** 2);
					if (d >= DRIBBLE_CROWD_RADIUS) continue;
					const weight = s.decisions[p.id]?.type === "press" ? 1 : .5;
					dribblePressLoad += weight * (1 - d / DRIBBLE_CROWD_RADIUS);
				}
				dribblePressLoad = Math.min(1, dribblePressLoad);
				const { attackerWins, winProb } = resolveDribble(attacker, defender, dribblePressLoad);
				gameBus.emit("dribble", {
					player: attacker.id,
					targetId: defender.id,
					success: attackerWins,
					chance: winProb
				});
				if (attackerWins) {
					s = {
						...s,
						players: s.players.map((p) => {
							if (p.id === defender.id) return {
								...p,
								recoveryTime: 1
							};
							if (p.id === attacker.id) return {
								...p,
								recoveryTime: DUEL_DRIBBLE_WIN_RECOVERY
							};
							return p;
						})
					};
					return {
						state: s,
						passCompleted: false,
						tackled: false,
						goalScored: null
					};
				} else {
					const prevHolderId = s.ballHolderId;
					s = onPossessionTransfer({
						...s,
						ballHolderId: defender.id,
						possessionTime: 0,
						players: s.players.map((p) => p.id === attacker.id ? {
							...p,
							recoveryTime: 1
						} : p)
					}, prevHolderId);
					return {
						state: s,
						passCompleted: false,
						tackled: true,
						goalScored: null
					};
				}
			}
		}
		return {
			state: startPass(s),
			passCompleted: false,
			tackled: false,
			goalScored: null
		};
	}
	const activePass = s.pass;
	const distanceSpeed = activePass.distance > 0 ? 28 / activePass.distance : passSpeed;
	if (s.tackleCooldown === 0) {
		const ballPos = getBallPos(s);
		const targetPos = activePass.kind === "through" || activePass.toId === null ? {
			x: activePass.toX,
			y: activePass.toY
		} : s.players.find((p) => p.id === activePass.toId) ?? {
			x: activePass.toX,
			y: activePass.toY
		};
		for (const player of s.players) {
			if (player.team === holder.team) continue;
			if (Math.sqrt((player.x - ballPos.x) ** 2 + (player.y - ballPos.y) ** 2) > 7) continue;
			const corridor = playerInterceptionCorridor(player);
			const perpDist = getInterceptionPerpDist(player, ballPos, targetPos, corridor);
			if (perpDist === null) continue;
			s = {
				...s,
				tackleCooldown: TACKLE_COOLDOWN,
				players: applyStaminaCost(s.players, player.id, "interception")
			};
			const interceptorNow = s.players.find((p) => p.id === player.id);
			const { success, chance } = resolveInterception(interceptorNow, perpDist, corridor, s.players.find((p) => p.id === activePass.fromId)?.runtimeStats.withBall.passingSkill ?? 0);
			gameBus.emit("interception", {
				player: player.id,
				success,
				chance
			});
			if (success) {
				if (activePass.kind === "through") {
					gameBus.emit("throughBallLostInFlight", {
						player: activePass.fromId,
						interceptorId: player.id
					});
					`${interceptorNow.name}`, player.id, activePass.fromId;
				} else gameBus.emit("passFailed", {
					player: activePass.fromId,
					toId: activePass.toId ?? activePass.fromId
				});
				const prevHolderId = s.ballHolderId;
				return {
					state: onPossessionTransfer({
						...s,
						pass: null,
						ballHolderId: player.id,
						possessionTime: 0,
						lastPasserId: null
					}, prevHolderId),
					passCompleted: false,
					tackled: true,
					goalScored: null
				};
			}
			break;
		}
	}
	const newT = activePass.t + dt * distanceSpeed;
	if (newT >= 1) {
		if (activePass.kind === "through") {
			const landingX = activePass.toX;
			const landingY = activePass.toY;
			const passer = s.players.find((p) => p.id === activePass.fromId);
			const passerTeam = passer?.team ?? "A";
			const dx = landingX - (passer?.x ?? landingX);
			const dy = landingY - (passer?.y ?? landingY);
			const len = Math.hypot(dx, dy);
			const initSpeed = THROUGH_BALL_CONFIG.LOOSE_BALL_INITIAL_SPEED;
			const vx = len > .001 ? dx / len * initSpeed : 0;
			const vy = len > .001 ? dy / len * initSpeed : 0;
			gameBus.emit("looseBallStarted", {
				x: landingX,
				y: landingY,
				fromPasserId: activePass.fromId
			});
			`${landingX.toFixed(1)}${landingY.toFixed(1)}`, activePass.fromId;
			return {
				state: {
					...s,
					pass: null,
					looseBall: {
						x: landingX,
						y: landingY,
						vx,
						vy,
						startTime: s.matchTime,
						fromPasserId: activePass.fromId,
						fromTeamLastTouch: passerTeam,
						intendedRunnerId: activePass.intendedRunnerId,
						receiverOffside: activePass.receiverOffside
					}
				},
				passCompleted: false,
				tackled: false,
				goalScored: null
			};
		}
		const receiver = s.players.find((p) => p.id === activePass.toId);
		if (activePass.receiverOffside) {
			gameBus.emit("offsideCalled", {
				team: receiver.team,
				receiverId: receiver.id
			});
			gameBus.emit("passFailed", {
				player: activePass.fromId,
				toId: activePass.toId
			});
			const nearestDefender = s.players.filter((p) => p.team !== receiver.team).reduce((best, p) => {
				return (p.x - receiver.x) ** 2 + (p.y - receiver.y) ** 2 < (best.x - receiver.x) ** 2 + (best.y - receiver.y) ** 2 ? p : best;
			});
			const offsideLayout = getFormationSetPieces((nearestDefender.team === "A" ? s.formationA : s.formationB).id)?.offside_fk;
			let players = s.players;
			if (offsideLayout) players = applySetPieceToTeam(players, nearestDefender.team, offsideLayout);
			players = players.map((p) => p.id === nearestDefender.id ? {
				...p,
				x: receiver.x,
				y: receiver.y,
				targetPosition: {
					x: receiver.x,
					y: receiver.y
				}
			} : p);
			const prevHolderId = s.ballHolderId;
			return {
				state: onPossessionTransfer({
					...s,
					pass: null,
					ballHolderId: nearestDefender.id,
					possessionTime: 0,
					lastPasserId: null,
					players,
					setPiece: {
						type: "offside_fk",
						takerId: nearestDefender.id,
						countdown: 2,
						position: {
							x: receiver.x,
							y: receiver.y
						}
					}
				}, prevHolderId),
				passCompleted: false,
				tackled: false,
				goalScored: null
			};
		}
		gameBus.emit("passCompleted", {
			player: activePass.fromId,
			toId: activePass.toId
		});
		return {
			state: reevaluateTeamIntents({
				...s,
				ballHolderId: activePass.toId,
				pass: null,
				lastPasserId: activePass.fromId,
				players: s.players.map((p) => p.id === activePass.toId ? {
					...p,
					justReceivedTicks: 4
				} : p)
			}),
			passCompleted: true,
			tackled: false,
			goalScored: null
		};
	}
	return {
		state: {
			...s,
			pass: {
				...activePass,
				t: newT
			}
		},
		passCompleted: false,
		tackled: false,
		goalScored: null
	};
}
/** Current ball position in yards. */
function getBallPos(state) {
	if (state.shot) {
		const { fromX, fromY, toX, toY, t } = state.shot;
		const eased = t * t * (3 - 2 * t);
		return {
			x: fromX + (toX - fromX) * eased,
			y: fromY + (toY - fromY) * eased
		};
	}
	if (state.looseBall) return {
		x: state.looseBall.x,
		y: state.looseBall.y
	};
	if (!state.pass) {
		const holder = state.players.find((p) => p.id === state.ballHolderId);
		return holder ? {
			x: holder.x,
			y: holder.y
		} : {
			x: 115 / 2,
			y: 37
		};
	}
	const from = state.players.find((p) => p.id === state.pass.fromId);
	const t = state.pass.t;
	const eased = t * t * (3 - 2 * t);
	const toX = state.pass.kind === "through" || state.pass.toId === null ? state.pass.toX : state.players.find((p) => p.id === state.pass.toId)?.x ?? state.pass.toX;
	const toY = state.pass.kind === "through" || state.pass.toId === null ? state.pass.toY : state.players.find((p) => p.id === state.pass.toId)?.y ?? state.pass.toY;
	return {
		x: from.x + (toX - from.x) * eased,
		y: from.y + (toY - from.y) * eased
	};
}
//#endregion
//#region .local/touchlines/upstream/src/Data/formations/4-4-2.json
var _4_4_2_default = {
	id: "4-4-2",
	attacking: [
		{
			"role": "GK",
			"x": 10,
			"y": 37
		},
		{
			"role": "LB",
			"x": 36,
			"y": 11
		},
		{
			"role": "CB",
			"x": 38,
			"y": 28
		},
		{
			"role": "CB",
			"x": 38,
			"y": 46
		},
		{
			"role": "RB",
			"x": 36,
			"y": 63
		},
		{
			"role": "LM",
			"x": 72,
			"y": 8
		},
		{
			"role": "CM",
			"x": 72,
			"y": 24
		},
		{
			"role": "CM",
			"x": 72,
			"y": 50
		},
		{
			"role": "RM",
			"x": 72,
			"y": 66
		},
		{
			"role": "ST",
			"x": 98,
			"y": 28
		},
		{
			"role": "ST",
			"x": 98,
			"y": 46
		}
	],
	defending: [
		{
			"role": "GK",
			"x": 5,
			"y": 37
		},
		{
			"role": "LB",
			"x": 13,
			"y": 11
		},
		{
			"role": "CB",
			"x": 14,
			"y": 28
		},
		{
			"role": "CB",
			"x": 14,
			"y": 46
		},
		{
			"role": "RB",
			"x": 13,
			"y": 63
		},
		{
			"role": "LM",
			"x": 50,
			"y": 8
		},
		{
			"role": "CM",
			"x": 38,
			"y": 24
		},
		{
			"role": "CM",
			"x": 38,
			"y": 50
		},
		{
			"role": "RM",
			"x": 50,
			"y": 66
		},
		{
			"role": "ST",
			"x": 60,
			"y": 28
		},
		{
			"role": "ST",
			"x": 60,
			"y": 46
		}
	]
};
//#endregion
//#region .local/touchlines/upstream/src/Data/formations/4-3-3.json
var _4_3_3_default = {
	id: "4-3-3",
	attacking: [
		{
			"role": "GK",
			"x": 10,
			"y": 37
		},
		{
			"role": "LB",
			"x": 36,
			"y": 11
		},
		{
			"role": "CB",
			"x": 38,
			"y": 28
		},
		{
			"role": "CB",
			"x": 38,
			"y": 46
		},
		{
			"role": "RB",
			"x": 36,
			"y": 63
		},
		{
			"role": "CM",
			"x": 72,
			"y": 24
		},
		{
			"role": "CM",
			"x": 72,
			"y": 50
		},
		{
			"role": "CAM",
			"x": 78,
			"y": 37
		},
		{
			"role": "LW",
			"x": 95,
			"y": 8
		},
		{
			"role": "ST",
			"x": 98,
			"y": 37
		},
		{
			"role": "RW",
			"x": 95,
			"y": 66
		}
	],
	defending: [
		{
			"role": "GK",
			"x": 5,
			"y": 37
		},
		{
			"role": "LB",
			"x": 13,
			"y": 11
		},
		{
			"role": "CB",
			"x": 14,
			"y": 28
		},
		{
			"role": "CB",
			"x": 14,
			"y": 46
		},
		{
			"role": "RB",
			"x": 13,
			"y": 63
		},
		{
			"role": "CM",
			"x": 38,
			"y": 24
		},
		{
			"role": "CM",
			"x": 38,
			"y": 50
		},
		{
			"role": "CAM",
			"x": 36,
			"y": 37
		},
		{
			"role": "LW",
			"x": 50,
			"y": 8
		},
		{
			"role": "ST",
			"x": 60,
			"y": 37
		},
		{
			"role": "RW",
			"x": 50,
			"y": 66
		}
	]
};
//#endregion
//#region .local/touchlines/upstream/src/Data/formations/3-5-2.json
var _3_5_2_default = {
	id: "3-5-2",
	attacking: [
		{
			"role": "GK",
			"x": 10,
			"y": 37
		},
		{
			"role": "CB",
			"x": 38,
			"y": 18
		},
		{
			"role": "CB",
			"x": 38,
			"y": 37
		},
		{
			"role": "CB",
			"x": 38,
			"y": 56
		},
		{
			"role": "LWB",
			"x": 52,
			"y": 8
		},
		{
			"role": "CM",
			"x": 72,
			"y": 24
		},
		{
			"role": "CDM",
			"x": 46,
			"y": 37
		},
		{
			"role": "CM",
			"x": 72,
			"y": 50
		},
		{
			"role": "RWB",
			"x": 52,
			"y": 66
		},
		{
			"role": "ST",
			"x": 98,
			"y": 28
		},
		{
			"role": "ST",
			"x": 98,
			"y": 46
		}
	],
	defending: [
		{
			"role": "GK",
			"x": 5,
			"y": 37
		},
		{
			"role": "CB",
			"x": 14,
			"y": 18
		},
		{
			"role": "CB",
			"x": 14,
			"y": 37
		},
		{
			"role": "CB",
			"x": 14,
			"y": 56
		},
		{
			"role": "LWB",
			"x": 12,
			"y": 8
		},
		{
			"role": "CM",
			"x": 38,
			"y": 24
		},
		{
			"role": "CDM",
			"x": 28,
			"y": 37
		},
		{
			"role": "CM",
			"x": 38,
			"y": 50
		},
		{
			"role": "RWB",
			"x": 12,
			"y": 66
		},
		{
			"role": "ST",
			"x": 60,
			"y": 28
		},
		{
			"role": "ST",
			"x": 60,
			"y": 46
		}
	]
};
//#endregion
//#region .local/touchlines/upstream/src/Data/formations/4-5-1.json
var _4_5_1_default = {
	id: "4-5-1",
	attacking: [
		{
			"role": "GK",
			"x": 10,
			"y": 37
		},
		{
			"role": "LB",
			"x": 36,
			"y": 11
		},
		{
			"role": "CB",
			"x": 38,
			"y": 28
		},
		{
			"role": "CB",
			"x": 38,
			"y": 46
		},
		{
			"role": "RB",
			"x": 36,
			"y": 63
		},
		{
			"role": "LW",
			"x": 95,
			"y": 8
		},
		{
			"role": "CM",
			"x": 72,
			"y": 24
		},
		{
			"role": "CAM",
			"x": 78,
			"y": 37
		},
		{
			"role": "CM",
			"x": 72,
			"y": 50
		},
		{
			"role": "RW",
			"x": 95,
			"y": 66
		},
		{
			"role": "ST",
			"x": 98,
			"y": 37
		}
	],
	defending: [
		{
			"role": "GK",
			"x": 5,
			"y": 37
		},
		{
			"role": "LB",
			"x": 13,
			"y": 11
		},
		{
			"role": "CB",
			"x": 14,
			"y": 28
		},
		{
			"role": "CB",
			"x": 14,
			"y": 46
		},
		{
			"role": "RB",
			"x": 13,
			"y": 63
		},
		{
			"role": "LW",
			"x": 50,
			"y": 8
		},
		{
			"role": "CM",
			"x": 38,
			"y": 24
		},
		{
			"role": "CAM",
			"x": 36,
			"y": 37
		},
		{
			"role": "CM",
			"x": 38,
			"y": 50
		},
		{
			"role": "RW",
			"x": 50,
			"y": 66
		},
		{
			"role": "ST",
			"x": 60,
			"y": 37
		}
	]
};
//#endregion
//#region .local/touchlines/upstream/src/Data/squads/premier_league/49.json
var _49_default = {
	id: "49",
	slug: "chelsea",
	name: "Chelsea",
	colors: ["#034694", "#FFFFFF"],
	logo: "logos/premier_league/chelsea.svg",
	apiId: 49,
	code: "CHE",
	country: "England",
	founded: 1905,
	venue: {
		"name": "Stamford Bridge",
		"city": "London",
		"capacity": 41841,
		"surface": "grass"
	},
	coach: {
		"id": 13350,
		"name": "L. Rosenior",
		"firstname": "Liam James",
		"lastname": "Rosenior",
		"age": 41,
		"nationality": "England",
		"points": 0
	},
	players: [
		{
			"id": "player_3008",
			"name": "F. Jörgensen",
			"fullName": "Filip Jörgensen",
			"age": 23,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["GK"],
			"stats": {
				"passing": 3,
				"vision": 2,
				"finishing": 0,
				"dribbling": 0,
				"speed": 1,
				"acceleration": 2,
				"tackling": 0,
				"pressing": 1,
				"stamina": 3,
				"heading": 3,
				"strength": 3,
				"reflex": 7,
				"jump": 4
			},
			"profile": {
				"summary": "Agile shot-stopper comfortable playing out from the back.",
				"archetype": "Traditional goalkeeper"
			}
		},
		{
			"id": "player_3009",
			"name": "Max Merrick",
			"fullName": "Max Merrick",
			"age": 20,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["GK"],
			"stats": {
				"passing": 2,
				"vision": 2,
				"finishing": 0,
				"dribbling": 0,
				"speed": 1,
				"acceleration": 1,
				"tackling": 0,
				"pressing": 1,
				"stamina": 2,
				"heading": 1,
				"strength": 1,
				"reflex": 4,
				"jump": 4
			},
			"profile": {
				"summary": "Agile shot-stopper comfortable playing out from the back.",
				"archetype": "Ball-playing keeper"
			}
		},
		{
			"id": "player_3010",
			"name": "Robert Sánchez",
			"fullName": "Robert Lynch Sánchez",
			"age": 28,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["GK"],
			"stats": {
				"passing": 4,
				"vision": 2,
				"finishing": 0,
				"dribbling": 1,
				"speed": 2,
				"acceleration": 2,
				"tackling": 1,
				"pressing": 1,
				"stamina": 3,
				"heading": 3,
				"strength": 3,
				"reflex": 8,
				"jump": 5
			},
			"profile": {
				"summary": "Reliable keeper with good reflexes and presence in the box.",
				"archetype": "Traditional goalkeeper"
			}
		},
		{
			"id": "player_3011",
			"name": "T. Sharman-Lowe",
			"fullName": "Teddy Samuel Sharman-Lowe",
			"age": 22,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["GK"],
			"stats": {
				"passing": 4,
				"vision": 2,
				"finishing": 0,
				"dribbling": 0,
				"speed": 1,
				"acceleration": 1,
				"tackling": 1,
				"pressing": 1,
				"stamina": 3,
				"heading": 3,
				"strength": 2,
				"reflex": 4,
				"jump": 6
			},
			"profile": {
				"summary": "Commanding goalkeeper who organises the back line effectively.",
				"archetype": "Shot-stopper"
			}
		},
		{
			"id": "player_3012",
			"name": "G. Słonina",
			"fullName": "Gabriel Paweł Słonina",
			"age": 21,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["GK"],
			"stats": {
				"passing": 2,
				"vision": 2,
				"finishing": 0,
				"dribbling": 0,
				"speed": 1,
				"acceleration": 1,
				"tackling": 0,
				"pressing": 1,
				"stamina": 2,
				"heading": 2,
				"strength": 2,
				"reflex": 4,
				"jump": 4
			},
			"profile": {
				"summary": "Agile shot-stopper comfortable playing out from the back.",
				"archetype": "Traditional goalkeeper"
			}
		},
		{
			"id": "player_3013",
			"name": "Joshua Kofi Acheampong",
			"fullName": "Joshua Kofi Acheampong",
			"age": 19,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Defender"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 1,
				"dribbling": 1,
				"speed": 3,
				"acceleration": 3,
				"tackling": 5,
				"pressing": 4,
				"stamina": 3,
				"heading": 5,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "No-nonsense centre-back who clears danger and dominates duels.",
				"archetype": "Stopper"
			}
		},
		{
			"id": "player_3014",
			"name": "T. Adarabioyo",
			"fullName": "Abdul-Nasir Oluwatosin Oluwadoyinsolami Adarabioyo",
			"age": 28,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 4,
				"acceleration": 5,
				"tackling": 6,
				"pressing": 5,
				"stamina": 5,
				"heading": 8,
				"strength": 8,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed centre-back who reads the game well and is strong in the air.",
				"archetype": "Modern centre-back"
			}
		},
		{
			"id": "player_3015",
			"name": "B. Badiashile",
			"fullName": "Benoît Ntambue Badiashile Mukinayi Baya",
			"age": 24,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 4,
				"vision": 3,
				"finishing": 1,
				"dribbling": 1,
				"speed": 3,
				"acceleration": 3,
				"tackling": 5,
				"pressing": 4,
				"stamina": 3,
				"heading": 6,
				"strength": 7,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed centre-back who reads the game well and is strong in the air.",
				"archetype": "Ball-playing defender"
			}
		},
		{
			"id": "player_3016",
			"name": "T. Chalobah",
			"fullName": "Trevoh Thomas Chalobah",
			"age": 26,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 4,
				"acceleration": 5,
				"tackling": 5,
				"pressing": 4,
				"stamina": 4,
				"heading": 7,
				"strength": 7,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed centre-back who reads the game well and is strong in the air.",
				"archetype": "Ball-playing defender"
			}
		},
		{
			"id": "player_3017",
			"name": "Marc Cucurella",
			"fullName": "Marc Cucurella Saseta",
			"age": 27,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 6,
				"vision": 3,
				"finishing": 2,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 6,
				"tackling": 5,
				"pressing": 4,
				"stamina": 6,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Energetic full-back who contributes at both ends of the pitch.",
				"archetype": "Inverted full-back"
			}
		},
		{
			"id": "player_3018",
			"name": "W. Fofana",
			"fullName": "Wesley Tidjan Fofana",
			"age": 25,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 4,
				"acceleration": 5,
				"tackling": 6,
				"pressing": 5,
				"stamina": 5,
				"heading": 8,
				"strength": 8,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "No-nonsense centre-back who clears danger and dominates duels.",
				"archetype": "Stopper"
			}
		},
		{
			"id": "player_3019",
			"name": "M. Gusto",
			"fullName": "Malo Gusto",
			"age": 22,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 2,
				"dribbling": 3,
				"speed": 5,
				"acceleration": 5,
				"tackling": 4,
				"pressing": 4,
				"stamina": 5,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Energetic full-back who contributes at both ends of the pitch.",
				"archetype": "Wing-back"
			}
		},
		{
			"id": "player_3020",
			"name": "J. Hato",
			"fullName": "Jorrel Hato",
			"age": 19,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 6,
				"vision": 4,
				"finishing": 2,
				"dribbling": 4,
				"speed": 6,
				"acceleration": 6,
				"tackling": 4,
				"pressing": 4,
				"stamina": 5,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Quick full-back who overlaps and delivers crosses into the box.",
				"archetype": "Defensive full-back"
			}
		},
		{
			"id": "player_3021",
			"name": "R. James",
			"fullName": "Reece Lewis James",
			"age": 26,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 2,
				"dribbling": 3,
				"speed": 5,
				"acceleration": 6,
				"tackling": 4,
				"pressing": 4,
				"stamina": 5,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Quick full-back who overlaps and delivers crosses into the box.",
				"archetype": "Wing-back"
			}
		},
		{
			"id": "player_3022",
			"name": "M. Sarr",
			"fullName": "Mamadou Sarr",
			"age": 20,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 4,
				"acceleration": 5,
				"tackling": 5,
				"pressing": 4,
				"stamina": 4,
				"heading": 7,
				"strength": 8,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed centre-back who reads the game well and is strong in the air.",
				"archetype": "No-nonsense defender"
			}
		},
		{
			"id": "player_3023",
			"name": "Andrey Santos",
			"fullName": "Andrey Nascimento dos Santos",
			"age": 21,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 7,
				"vision": 5,
				"finishing": 4,
				"dribbling": 4,
				"speed": 4,
				"acceleration": 5,
				"tackling": 5,
				"pressing": 4,
				"stamina": 7,
				"heading": 3,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Mobile forward who can play across the front line.",
				"archetype": "Engine room"
			}
		},
		{
			"id": "player_3024",
			"name": "M. Caicedo",
			"fullName": "Moisés Isaac Caicedo Corozo",
			"age": 24,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 6,
				"vision": 4,
				"finishing": 2,
				"dribbling": 4,
				"speed": 4,
				"acceleration": 4,
				"tackling": 7,
				"pressing": 7,
				"stamina": 7,
				"heading": 6,
				"strength": 6,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Tenacious midfielder who breaks up play and recycles possession.",
				"archetype": "Ball-winning midfielder"
			}
		},
		{
			"id": "player_3025",
			"name": "J. Derry",
			"fullName": "Jesse Derry",
			"age": 18,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Forward"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 4,
				"dribbling": 7,
				"speed": 6,
				"acceleration": 7,
				"tackling": 2,
				"pressing": 3,
				"stamina": 5,
				"heading": 2,
				"strength": 3,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Direct winger who takes on defenders and creates chances from wide areas.",
				"archetype": "Wide forward"
			}
		},
		{
			"id": "player_3026",
			"name": "Dário Essugo",
			"fullName": "Dário Cassia Luís Essugo",
			"age": 20,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 7,
				"vision": 4,
				"finishing": 3,
				"dribbling": 4,
				"speed": 4,
				"acceleration": 5,
				"tackling": 4,
				"pressing": 4,
				"stamina": 6,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Mobile forward who can play across the front line.",
				"archetype": "Engine room"
			}
		},
		{
			"id": "player_3027",
			"name": "E. Fernández",
			"fullName": "Enzo Jeremías Fernández",
			"age": 24,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 6,
				"vision": 5,
				"finishing": 2,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 6,
				"pressing": 6,
				"stamina": 6,
				"heading": 5,
				"strength": 6,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Tenacious midfielder who breaks up play and recycles possession.",
				"archetype": "Anchor"
			}
		},
		{
			"id": "player_3028",
			"name": "O. Harrison",
			"fullName": "Ollie Harrison",
			"age": 18,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 4,
				"vision": 4,
				"finishing": 2,
				"dribbling": 3,
				"speed": 3,
				"acceleration": 3,
				"tackling": 3,
				"pressing": 4,
				"stamina": 5,
				"heading": 2,
				"strength": 3,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "All-round midfielder who links defence and attack. Covers a lot of ground.",
				"archetype": "Ball-winning midfielder"
			}
		},
		{
			"id": "player_3029",
			"name": "C. Holland",
			"fullName": "C. Holland",
			"age": 16,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 3,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 5,
				"tackling": 2,
				"pressing": 3,
				"stamina": 4,
				"heading": 2,
				"strength": 2,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Direct winger who takes on defenders and creates chances from wide areas.",
				"archetype": "Wide midfielder"
			}
		},
		{
			"id": "player_3030",
			"name": "R. Kavuma McQueen",
			"fullName": "R. Kavuma McQueen",
			"age": 16,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 2,
				"vision": 3,
				"finishing": 5,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 3,
				"stamina": 3,
				"heading": 4,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Clinical striker who thrives inside the penalty area.",
				"archetype": "Speed merchant"
			}
		},
		{
			"id": "player_3031",
			"name": "R. Lavia",
			"fullName": "Roméo Lavia",
			"age": 21,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 6,
				"vision": 4,
				"finishing": 1,
				"dribbling": 3,
				"speed": 3,
				"acceleration": 4,
				"tackling": 6,
				"pressing": 5,
				"stamina": 5,
				"heading": 4,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed passer who controls the tempo from a central position.",
				"archetype": "Deep-lying playmaker"
			}
		},
		{
			"id": "player_3032",
			"name": "C. Palmer",
			"fullName": "Cole Jermaine Palmer",
			"age": 23,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 7,
				"vision": 6,
				"finishing": 4,
				"dribbling": 5,
				"speed": 6,
				"acceleration": 5,
				"tackling": 4,
				"pressing": 5,
				"stamina": 6,
				"heading": 5,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Mobile forward who can play across the front line.",
				"archetype": "Central midfielder"
			}
		},
		{
			"id": "player_3033",
			"name": "R. Walsh",
			"fullName": "Reggie Walsh",
			"age": 17,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 5,
				"vision": 4,
				"finishing": 4,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 5,
				"tackling": 2,
				"pressing": 3,
				"stamina": 4,
				"heading": 2,
				"strength": 2,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Pacy wide player who stretches defences with off-the-ball runs.",
				"archetype": "Wide midfielder"
			}
		},
		{
			"id": "player_3034",
			"name": "L. Delap",
			"fullName": "Liam Rory Delap",
			"age": 22,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 6,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 4,
				"stamina": 5,
				"heading": 5,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Powerful striker who holds the ball up and brings others into play.",
				"archetype": "Fox in the box"
			}
		},
		{
			"id": "player_3035",
			"name": "Estêvão",
			"fullName": "Estêvão Willian Almeida de Oliveira Gonçalves",
			"age": 18,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 6,
				"vision": 5,
				"finishing": 4,
				"dribbling": 8,
				"speed": 6,
				"acceleration": 7,
				"tackling": 2,
				"pressing": 2,
				"stamina": 4,
				"heading": 1,
				"strength": 3,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Direct winger who takes on defenders and creates chances from wide areas.",
				"archetype": "Wide forward"
			}
		},
		{
			"id": "player_3036",
			"name": "A. Garnacho",
			"fullName": "Alejandro Garnacho Ferreyra",
			"age": 21,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 5,
				"vision": 4,
				"finishing": 8,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 6,
				"tackling": 1,
				"pressing": 4,
				"stamina": 5,
				"heading": 4,
				"strength": 6,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Clinical striker who thrives inside the penalty area.",
				"archetype": "Poacher"
			}
		},
		{
			"id": "player_3037",
			"name": "J. Bynoe-Gittens",
			"fullName": "Jamie Jermaine Bynoe-Gittens",
			"age": 21,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Forward"],
			"stats": {
				"passing": 4,
				"vision": 4,
				"finishing": 8,
				"dribbling": 6,
				"speed": 6,
				"acceleration": 7,
				"tackling": 1,
				"pressing": 4,
				"stamina": 4,
				"heading": 4,
				"strength": 7,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Clinical striker who thrives inside the penalty area.",
				"archetype": "Target man"
			}
		},
		{
			"id": "player_3038",
			"name": "Marc Guiu",
			"fullName": "Marc Guiu Paz",
			"age": 19,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Forward"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 5,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 3,
				"stamina": 3,
				"heading": 5,
				"strength": 6,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Mobile forward who can play across the front line.",
				"archetype": "Complete forward"
			}
		},
		{
			"id": "player_3039",
			"name": "João Pedro",
			"fullName": "João Pedro Junqueira de Jesus",
			"age": 24,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 4,
				"vision": 4,
				"finishing": 8,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 6,
				"tackling": 1,
				"pressing": 4,
				"stamina": 4,
				"heading": 5,
				"strength": 7,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Mobile forward who can play across the front line.",
				"archetype": "Speed merchant"
			}
		},
		{
			"id": "player_3040",
			"name": "Shumaira Mheuka",
			"fullName": "Shumaira Mheuka",
			"age": 18,
			"squadId": "49",
			"preferredFoot": "left",
			"positions": ["Forward"],
			"stats": {
				"passing": 2,
				"vision": 3,
				"finishing": 5,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 3,
				"stamina": 3,
				"heading": 4,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Mobile forward who can play across the front line.",
				"archetype": "Complete forward"
			}
		},
		{
			"id": "player_3041",
			"name": "Pedro Neto",
			"fullName": "Pedro Lomba Neto",
			"age": 25,
			"squadId": "49",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 5,
				"vision": 5,
				"finishing": 5,
				"dribbling": 8,
				"speed": 7,
				"acceleration": 8,
				"tackling": 2,
				"pressing": 3,
				"stamina": 5,
				"heading": 2,
				"strength": 3,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Pacy wide player who stretches defences with off-the-ball runs.",
				"archetype": "Inside forward"
			}
		}
	],
	finances: {
		"score": .8702,
		"broadcasting": 185447998,
		"commercial": 220070947,
		"total": 405518945,
		"budget": 332803155,
		"followers": 139772316
	}
};
//#endregion
//#region .local/touchlines/upstream/src/Data/squads/premier_league/51.json
var _51_default = {
	id: "51",
	slug: "brighton",
	name: "Brighton",
	colors: ["#0057B8", "#FFFFFF"],
	logo: "logos/premier_league/brighton.svg",
	apiId: 51,
	code: "BRI",
	country: "England",
	founded: 1901,
	venue: {
		"name": "American Express Stadium",
		"city": "Falmer, East Sussex",
		"capacity": 31872,
		"surface": "grass"
	},
	coach: {
		"id": 19253,
		"name": "F. Hürzeler",
		"firstname": "Fabian Marc",
		"lastname": "Hürzeler",
		"age": 32,
		"nationality": "Germany",
		"points": 2
	},
	players: [
		{
			"id": "player_3074",
			"name": "T. McGill",
			"fullName": "Thomas Peter Wayne McGill",
			"age": 25,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["GK"],
			"stats": {
				"passing": 2,
				"vision": 2,
				"finishing": 0,
				"dribbling": 0,
				"speed": 1,
				"acceleration": 1,
				"tackling": 0,
				"pressing": 1,
				"stamina": 2,
				"heading": 1,
				"strength": 1,
				"reflex": 4,
				"jump": 4
			},
			"profile": {
				"summary": "Agile shot-stopper comfortable playing out from the back.",
				"archetype": "Traditional goalkeeper"
			}
		},
		{
			"id": "player_3075",
			"name": "Nils Ramming",
			"fullName": "Nils Ramming",
			"age": 18,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["GK"],
			"stats": {
				"passing": 2,
				"vision": 2,
				"finishing": 0,
				"dribbling": 0,
				"speed": 1,
				"acceleration": 1,
				"tackling": 1,
				"pressing": 1,
				"stamina": 2,
				"heading": 3,
				"strength": 3,
				"reflex": 3,
				"jump": 5
			},
			"profile": {
				"summary": "Reliable keeper with good reflexes and presence in the box.",
				"archetype": "Shot-stopper"
			}
		},
		{
			"id": "player_3076",
			"name": "J. Steele",
			"fullName": "Jason Sean Steele",
			"age": 35,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["GK"],
			"stats": {
				"passing": 4,
				"vision": 2,
				"finishing": 0,
				"dribbling": 0,
				"speed": 1,
				"acceleration": 2,
				"tackling": 0,
				"pressing": 1,
				"stamina": 2,
				"heading": 3,
				"strength": 3,
				"reflex": 6,
				"jump": 4
			},
			"profile": {
				"summary": "Reliable keeper with good reflexes and presence in the box.",
				"archetype": "Shot-stopper"
			}
		},
		{
			"id": "player_3077",
			"name": "B. Verbruggen",
			"fullName": "Bart Verbruggen",
			"age": 23,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["GK"],
			"stats": {
				"passing": 3,
				"vision": 2,
				"finishing": 0,
				"dribbling": 1,
				"speed": 2,
				"acceleration": 2,
				"tackling": 1,
				"pressing": 1,
				"stamina": 3,
				"heading": 3,
				"strength": 2,
				"reflex": 5,
				"jump": 4
			},
			"profile": {
				"summary": "Commanding goalkeeper who organises the back line effectively.",
				"archetype": "Sweeper-keeper"
			}
		},
		{
			"id": "player_3078",
			"name": "O. Boscagli",
			"fullName": "Olivier Maxime Boscagli",
			"age": 28,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 4,
				"acceleration": 4,
				"tackling": 6,
				"pressing": 4,
				"stamina": 5,
				"heading": 7,
				"strength": 7,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed centre-back who reads the game well and is strong in the air.",
				"archetype": "Ball-playing defender"
			}
		},
		{
			"id": "player_3079",
			"name": "M. De Cuyper",
			"fullName": "Maxim De Cuyper",
			"age": 25,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 4,
				"finishing": 2,
				"dribbling": 4,
				"speed": 6,
				"acceleration": 5,
				"tackling": 4,
				"pressing": 4,
				"stamina": 5,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Quick full-back who overlaps and delivers crosses into the box.",
				"archetype": "Modern full-back"
			}
		},
		{
			"id": "player_3080",
			"name": "L. Dunk",
			"fullName": "Lewis Carl Dunk",
			"age": 34,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 4,
				"acceleration": 4,
				"tackling": 6,
				"pressing": 4,
				"stamina": 4,
				"heading": 7,
				"strength": 8,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed centre-back who reads the game well and is strong in the air.",
				"archetype": "Ball-playing defender"
			}
		},
		{
			"id": "player_3081",
			"name": "Igor",
			"fullName": "Igor Júlio dos Santos de Paulo",
			"age": 27,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 3,
				"acceleration": 3,
				"tackling": 4,
				"pressing": 4,
				"stamina": 5,
				"heading": 3,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Solid defender who gets forward to support attacks when possible.",
				"archetype": "Modern full-back"
			}
		},
		{
			"id": "player_3082",
			"name": "F. Kadıoğlu",
			"fullName": "Ferdi Erenay Kadıoğlu",
			"age": 26,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 6,
				"vision": 4,
				"finishing": 2,
				"dribbling": 4,
				"speed": 6,
				"acceleration": 6,
				"tackling": 4,
				"pressing": 4,
				"stamina": 5,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Solid defender who gets forward to support attacks when possible.",
				"archetype": "Wing-back"
			}
		},
		{
			"id": "player_3083",
			"name": "F. Simmonds",
			"fullName": "Freddie Simmonds",
			"age": 17,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 4,
				"vision": 3,
				"finishing": 2,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 5,
				"tackling": 3,
				"pressing": 4,
				"stamina": 4,
				"heading": 2,
				"strength": 2,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Quick full-back who overlaps and delivers crosses into the box.",
				"archetype": "Attacking wing-back"
			}
		},
		{
			"id": "player_3084",
			"name": "C. Tasker",
			"fullName": "Charlie Tasker",
			"age": 19,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Defender"],
			"stats": {
				"passing": 4,
				"vision": 3,
				"finishing": 2,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 5,
				"tackling": 3,
				"pressing": 4,
				"stamina": 5,
				"heading": 2,
				"strength": 2,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Quick full-back who overlaps and delivers crosses into the box.",
				"archetype": "Attacking wing-back"
			}
		},
		{
			"id": "player_3085",
			"name": "J. Veltman",
			"fullName": "Joël Ivo Veltman",
			"age": 33,
			"squadId": "51",
			"preferredFoot": "left",
			"positions": ["Defender"],
			"stats": {
				"passing": 5,
				"vision": 3,
				"finishing": 2,
				"dribbling": 4,
				"speed": 4,
				"acceleration": 5,
				"tackling": 4,
				"pressing": 4,
				"stamina": 4,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Energetic full-back who contributes at both ends of the pitch.",
				"archetype": "Defensive full-back"
			}
		},
		{
			"id": "player_3086",
			"name": "J. van Hecke",
			"fullName": "Jan Paul van Hecke",
			"age": 25,
			"squadId": "51",
			"preferredFoot": "left",
			"positions": ["Defender"],
			"stats": {
				"passing": 4,
				"vision": 3,
				"finishing": 1,
				"dribbling": 2,
				"speed": 4,
				"acceleration": 4,
				"tackling": 6,
				"pressing": 4,
				"stamina": 5,
				"heading": 7,
				"strength": 7,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Athletic defender comfortable bringing the ball out of defence.",
				"archetype": "No-nonsense defender"
			}
		},
		{
			"id": "player_3087",
			"name": "Y. Ayari",
			"fullName": "Yasin Abbas Ayari",
			"age": 22,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 6,
				"vision": 4,
				"finishing": 2,
				"dribbling": 3,
				"speed": 3,
				"acceleration": 4,
				"tackling": 6,
				"pressing": 5,
				"stamina": 5,
				"heading": 4,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Tenacious midfielder who breaks up play and recycles possession.",
				"archetype": "Deep-lying playmaker"
			}
		},
		{
			"id": "player_3088",
			"name": "C. Baleba",
			"fullName": "Carlos Noom Quomah Baleba",
			"age": 21,
			"squadId": "51",
			"preferredFoot": "left",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 4,
				"vision": 4,
				"finishing": 2,
				"dribbling": 3,
				"speed": 3,
				"acceleration": 3,
				"tackling": 6,
				"pressing": 6,
				"stamina": 6,
				"heading": 4,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Tenacious midfielder who breaks up play and recycles possession.",
				"archetype": "Defensive midfielder"
			}
		},
		{
			"id": "player_3089",
			"name": "D. Gómez",
			"fullName": "Diego Alexander Gómez Amarilla",
			"age": 22,
			"squadId": "51",
			"preferredFoot": "left",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 4,
				"vision": 4,
				"finishing": 6,
				"dribbling": 7,
				"speed": 6,
				"acceleration": 7,
				"tackling": 2,
				"pressing": 3,
				"stamina": 5,
				"heading": 2,
				"strength": 3,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Skilful winger who combines dribbling ability with end product.",
				"archetype": "Inverted winger"
			}
		},
		{
			"id": "player_3090",
			"name": "P. Groß",
			"fullName": "Pascal Groß",
			"age": 34,
			"squadId": "51",
			"preferredFoot": "left",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 7,
				"vision": 4,
				"finishing": 2,
				"dribbling": 3,
				"speed": 3,
				"acceleration": 4,
				"tackling": 6,
				"pressing": 6,
				"stamina": 5,
				"heading": 4,
				"strength": 6,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "All-round midfielder who links defence and attack. Covers a lot of ground.",
				"archetype": "Ball-winning midfielder"
			}
		},
		{
			"id": "player_3091",
			"name": "J. Hinshelwood",
			"fullName": "Jack Luca Hinshelwood",
			"age": 20,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 4,
				"vision": 3,
				"finishing": 1,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 5,
				"tackling": 4,
				"pressing": 4,
				"stamina": 5,
				"heading": 3,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Quick full-back who overlaps and delivers crosses into the box.",
				"archetype": "Defensive full-back"
			}
		},
		{
			"id": "player_3092",
			"name": "H. Howell",
			"fullName": "Harry Howell",
			"age": 17,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 4,
				"dribbling": 5,
				"speed": 5,
				"acceleration": 5,
				"tackling": 1,
				"pressing": 2,
				"stamina": 4,
				"heading": 1,
				"strength": 2,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Pacy wide player who stretches defences with off-the-ball runs.",
				"archetype": "Direct winger"
			}
		},
		{
			"id": "player_3093",
			"name": "J. Milner",
			"fullName": "James Philip Milner",
			"age": 39,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 5,
				"vision": 4,
				"finishing": 2,
				"dribbling": 3,
				"speed": 3,
				"acceleration": 4,
				"tackling": 5,
				"pressing": 5,
				"stamina": 4,
				"heading": 3,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Composed passer who controls the tempo from a central position.",
				"archetype": "Anchor"
			}
		},
		{
			"id": "player_3094",
			"name": "M. O&apos;Riley",
			"fullName": "Matthew Sean O'Riley",
			"age": 25,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 6,
				"vision": 6,
				"finishing": 3,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 4,
				"pressing": 4,
				"stamina": 6,
				"heading": 4,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Clinical striker who thrives inside the penalty area.",
				"archetype": "Central midfielder"
			}
		},
		{
			"id": "player_3095",
			"name": "M. Wieffer",
			"fullName": "Mats Wieffer",
			"age": 26,
			"squadId": "51",
			"preferredFoot": "left",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 6,
				"vision": 3,
				"finishing": 2,
				"dribbling": 3,
				"speed": 5,
				"acceleration": 6,
				"tackling": 5,
				"pressing": 4,
				"stamina": 5,
				"heading": 5,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Energetic full-back who contributes at both ends of the pitch.",
				"archetype": "Defensive full-back"
			}
		},
		{
			"id": "player_3096",
			"name": "C. Kostoulas",
			"fullName": "Charalampos Kostoulas",
			"age": 18,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 5,
				"dribbling": 4,
				"speed": 5,
				"acceleration": 5,
				"tackling": 1,
				"pressing": 4,
				"stamina": 4,
				"heading": 5,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Powerful striker who holds the ball up and brings others into play.",
				"archetype": "Target man"
			}
		},
		{
			"id": "player_3097",
			"name": "S. March",
			"fullName": "Solomon Benjamin March",
			"age": 31,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 4,
				"dribbling": 5,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 2,
				"stamina": 4,
				"heading": 1,
				"strength": 2,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Direct winger who takes on defenders and creates chances from wide areas.",
				"archetype": "Inverted winger"
			}
		},
		{
			"id": "player_3098",
			"name": "Y. Minteh",
			"fullName": "Yankuba Minteh Moat",
			"age": 21,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 5,
				"vision": 4,
				"finishing": 6,
				"dribbling": 8,
				"speed": 6,
				"acceleration": 7,
				"tackling": 2,
				"pressing": 3,
				"stamina": 5,
				"heading": 2,
				"strength": 3,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Skilful winger who combines dribbling ability with end product.",
				"archetype": "Inverted winger"
			}
		},
		{
			"id": "player_3099",
			"name": "K. Mitoma",
			"fullName": "Kaoru Mitoma",
			"age": 28,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Midfielder"],
			"stats": {
				"passing": 5,
				"vision": 4,
				"finishing": 7,
				"dribbling": 7,
				"speed": 6,
				"acceleration": 7,
				"tackling": 2,
				"pressing": 3,
				"stamina": 5,
				"heading": 2,
				"strength": 3,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Pacy wide player who stretches defences with off-the-ball runs.",
				"archetype": "Inside forward"
			}
		},
		{
			"id": "player_3100",
			"name": "N. Oriola",
			"fullName": "N. Oriola",
			"age": 18,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 2,
				"vision": 3,
				"finishing": 5,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 3,
				"stamina": 3,
				"heading": 4,
				"strength": 4,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Powerful striker who holds the ball up and brings others into play.",
				"archetype": "Speed merchant"
			}
		},
		{
			"id": "player_3101",
			"name": "G. Rutter",
			"fullName": "Georginio Rutter",
			"age": 23,
			"squadId": "51",
			"preferredFoot": "left",
			"positions": ["Forward"],
			"stats": {
				"passing": 7,
				"vision": 5,
				"finishing": 4,
				"dribbling": 4,
				"speed": 4,
				"acceleration": 6,
				"tackling": 5,
				"pressing": 4,
				"stamina": 6,
				"heading": 3,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Powerful striker who holds the ball up and brings others into play.",
				"archetype": "Box-to-box midfielder"
			}
		},
		{
			"id": "player_3102",
			"name": "S. Tzimas",
			"fullName": "Stefanos Tzimas",
			"age": 19,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 3,
				"vision": 4,
				"finishing": 6,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 4,
				"stamina": 4,
				"heading": 6,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Clinical striker who thrives inside the penalty area.",
				"archetype": "Fox in the box"
			}
		},
		{
			"id": "player_3103",
			"name": "D. Welbeck",
			"fullName": "Daniel Nii Tackie Mensah Welbeck",
			"age": 35,
			"squadId": "51",
			"preferredFoot": "right",
			"positions": ["Forward"],
			"stats": {
				"passing": 3,
				"vision": 3,
				"finishing": 6,
				"dribbling": 3,
				"speed": 4,
				"acceleration": 4,
				"tackling": 1,
				"pressing": 4,
				"stamina": 4,
				"heading": 5,
				"strength": 5,
				"reflex": 1,
				"jump": 1
			},
			"profile": {
				"summary": "Powerful striker who holds the ball up and brings others into play.",
				"archetype": "Fox in the box"
			}
		}
	],
	finances: {
		"score": .4217,
		"broadcasting": 131351080,
		"commercial": 59685717,
		"total": 191036797,
		"budget": 164273469,
		"followers": 8319178
	}
};
//#endregion
//#region .local/touchlines/harness/freeplay.ts
const UPSTREAM_COMMIT = "5c5c71a8a2fb9a02591445cf9114229a4b218253";
const ENGINE_VERSION = "touchlines-5c5c71a-native";
const DT = .1;
const WALL_LIMIT_MS = 6e5;
const RSS_LIMIT = 1073741824;
const FORMATIONS = {
	"4-4-2": _4_4_2_default,
	"4-3-3": _4_3_3_default,
	"3-5-2": _3_5_2_default,
	"4-5-1": _4_5_1_default
};
function arg(name) {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : void 0;
}
const flag = (name) => process.argv.includes(name);
const physicalClock = flag("--physical-clock");
const MAX_TICKS = physicalClock ? 66e3 : 54e3;
const ticks = Number(arg("--ticks") ?? 600);
if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) throw new Error(`--ticks must be an integer in 1..${MAX_TICKS}`);
const outPath = arg("--out");
if (!outPath) throw new Error("--out <replay.json> is required");
const lineupPath = arg("--lineup");
const useExample = flag("--upstream-example");
if (!useExample && !lineupPath) throw new Error("Pass --lineup <lineup.json> or --upstream-example");
if (Math.random !== seededRandom$1) throw new Error("Seeded PRNG not installed before engine imports");
const ROLE_PRIOR = {
	GK: {
		passing: .35,
		shooting: .08,
		defending: .2,
		keeping: .75,
		pace: .35,
		stamina: .65
	},
	DEF: {
		passing: .5,
		shooting: .25,
		defending: .68,
		keeping: .05,
		pace: .52,
		stamina: .7
	},
	MID: {
		passing: .65,
		shooting: .45,
		defending: .5,
		keeping: .05,
		pace: .6,
		stamina: .75
	},
	FWD: {
		passing: .55,
		shooting: .65,
		defending: .25,
		keeping: .05,
		pace: .65,
		stamina: .65
	}
};
const GRF_KEYS = {
	physical_velocity: "pace",
	technical_shot: "shooting",
	technical_shortpass: "passing"
};
const STRENGTH = {
	GK: 3.5,
	DEF: 5,
	MID: 4,
	FWD: 4.5
};
const POSITION_LABEL = {
	GK: "GK",
	DEF: "Defender",
	MID: "Midfielder",
	FWD: "Forward"
};
function normaliseAttributes(p) {
	const values = {}, provenance = {};
	for (const [k, v] of Object.entries(p.attributes ?? {})) {
		const key = GRF_KEYS[k] ?? k;
		if (typeof v === "number" && Number.isFinite(v)) {
			values[key] = v;
			provenance[key] = p.provenance?.[k] ?? "catalogue:unspecified";
		}
	}
	for (const [k, v] of Object.entries(ROLE_PRIOR[p.role])) if (!(k in values)) {
		values[k] = v;
		provenance[k] = "estimated:role_prior(harness-default)";
	}
	return {
		values,
		provenance
	};
}
function estimateStats(role, a) {
	const s = (v) => Math.max(0, Math.min(10, Math.round(v)));
	const gk = role === "GK";
	return {
		passing: s(a.passing * 10),
		vision: s(a.passing * 8),
		finishing: s(a.shooting * 10),
		dribbling: s((a.pace + a.passing) / 2 * 8),
		speed: s(a.pace * 8),
		acceleration: s(a.pace * 9),
		tackling: s(a.defending * 9),
		pressing: s((a.defending + a.stamina) / 2 * 7),
		stamina: s(a.stamina * 7),
		heading: s((a.defending + a.shooting) / 2 * 8),
		strength: s(STRENGTH[role]),
		reflex: gk ? s(a.keeping * 8) : 1,
		jump: gk ? s(a.keeping * 8) : 1
	};
}
const SLOT_CATEGORY = {
	GK: "GK",
	CB: "DEF",
	LB: "DEF",
	RB: "DEF",
	LWB: "DEF",
	RWB: "DEF",
	CDM: "MID",
	CM: "MID",
	CAM: "MID",
	LM: "MID",
	RM: "MID",
	LW: "FWD",
	RW: "FWD",
	ST: "FWD"
};
function prepareTeam(team, side, formationOverride) {
	const formationId = formationOverride ?? team.formation ?? "4-4-2";
	const formation = FORMATIONS[formationId];
	if (!formation) throw new Error(`Unsupported formation ${formationId}`);
	if (team.players.length < 11) throw new Error(`${side}: need 11 players, got ${team.players.length}`);
	const xi = [...team.players].sort((x, y) => (x.slot ?? 0) - (y.slot ?? 0)).slice(0, 11);
	const meta = /* @__PURE__ */ new Map();
	const roster = xi.map((p) => {
		const sourceKey = p.source_key ?? p.player_key ?? p.key ?? p.id;
		if (!sourceKey) throw new Error(`${side}: player ${p.name} has no key`);
		const id = `${side}:${sourceKey}`;
		const { values, provenance } = normaliseAttributes(p);
		meta.set(id, {
			sourceKey,
			name: p.name,
			role: p.role,
			attributes: values,
			provenance
		});
		return {
			id,
			name: p.name,
			age: 27,
			squadId: team.key,
			preferredFoot: "right",
			positions: [POSITION_LABEL[p.role]],
			stats: p.touchlines_stats ?? estimateStats(p.role, values),
			profile: {
				summary: "synthetic-estimate from TimePitch catalogue",
				archetype: "synthetic-estimate"
			}
		};
	});
	const free = new Set(roster.map((r) => r.id));
	const lineup = formation.attacking.map((slot) => {
		const want = SLOT_CATEGORY[slot.role] ?? "MID";
		const hit = roster.find((r) => free.has(r.id) && meta.get(r.id).role === want);
		if (hit) {
			free.delete(hit.id);
			return hit.id;
		}
		return "";
	});
	for (let i = 0; i < lineup.length; i++) if (!lineup[i]) {
		const next = [...free][0];
		free.delete(next);
		lineup[i] = next;
	}
	return {
		key: team.key,
		name: team.name,
		formationId,
		formation,
		roster,
		lineup,
		meta
	};
}
function exampleTeam(squad, side, formationId) {
	const formation = FORMATIONS[formationId];
	const meta = /* @__PURE__ */ new Map();
	const roster = squad.players.map((p) => ({
		...p,
		id: `${side}:${p.id}`
	}));
	for (const p of roster) {
		const pos = p.positions[0] ?? "Midfielder";
		const role = pos === "GK" ? "GK" : pos === "Defender" ? "DEF" : pos === "Forward" || pos === "Attacker" ? "FWD" : "MID";
		meta.set(p.id, {
			sourceKey: p.id.slice(side.length + 1),
			name: p.name,
			role,
			attributes: {},
			provenance: { all: "upstream-example-squad (modern, non-historical)" }
		});
	}
	return {
		key: `touchlines-example:${squad.id}`,
		name: `${squad.name} (TouchLines example squad)`,
		formationId,
		formation,
		roster,
		lineup: [],
		meta
	};
}
function readLineup(path) {
	let doc = JSON.parse(readFileSync(path, "utf8"));
	if (doc.input && !doc.home) doc = doc.input;
	if (doc.home && doc.away) return {
		home: doc.home,
		away: doc.away,
		dataset: doc.dataset_version
	};
	if (doc.config && Array.isArray(doc.players)) {
		const team = (side) => ({
			key: doc.config[`${side}_key`],
			name: doc[`${side}_name`] ?? doc.config[`${side}_key`],
			formation: doc.config[`${side}_formation`],
			players: doc.players.filter((p) => p.side === side)
		});
		return {
			home: team("home"),
			away: team("away"),
			dataset: doc.dataset_version
		};
	}
	throw new Error("Unrecognised lineup.json: expected {home,away} teams or a GrfInput-like {config,players}");
}
const formationOverride = arg("--formation");
let home;
let away;
let datasetVersion;
let lineupSha = null;
let source;
if (useExample) {
	home = exampleTeam(_49_default, "home", formationOverride ?? "4-4-2");
	away = exampleTeam(_51_default, "away", formationOverride ?? "4-4-2");
	datasetVersion = `touchlines-example_data@${UPSTREAM_COMMIT}`;
	source = "upstream-example-squads";
} else {
	const raw = readFileSync(lineupPath);
	lineupSha = createHash("sha256").update(raw).digest("hex");
	const parsed = readLineup(lineupPath);
	home = prepareTeam(parsed.home, "home", formationOverride);
	away = prepareTeam(parsed.away, "away", formationOverride);
	datasetVersion = parsed.dataset ?? "unknown";
	source = "timepitch-catalogue-lineup";
}
const events = [];
let tickIndex = 0;
for (const name of [
	"goalScored",
	"shot",
	"shotResolved",
	"passAttempted",
	"passCompleted",
	"passFailed",
	"tackle",
	"interception",
	"offsideCalled"
]) gameBus.on(name, (payload) => {
	events.push({
		tick: tickIndex,
		type: name,
		...payload
	});
});
const randomBeforeState = randomCallCount();
let s = {
	...createMatchState(home.roster, home.formation, away.roster, away.formation, home.lineup.length ? home.lineup : void 0, away.lineup.length ? away.lineup : void 0),
	matchPhase: "firstHalf",
	presentationCountdown: 0,
	testMode: false
};
const starters = {
	home: s.players.filter((p) => p.team === "A").sort((a, b) => a.slotIndex - b.slotIndex),
	away: s.players.filter((p) => p.team === "B").sort((a, b) => a.slotIndex - b.slotIndex)
};
if (starters.home.length !== 11 || starters.away.length !== 11) throw new Error("Expected 11 starters per side");
const slotOf = /* @__PURE__ */ new Map();
for (const side of ["home", "away"]) starters[side].forEach((p, i) => slotOf.set(p.id, {
	side,
	slot: i
}));
const NATIVE = {
	GK: "GK",
	DEF: "CB",
	MID: "CM",
	FWD: "CF"
};
const inputPlayers = ["home", "away"].flatMap((side) => starters[side].map((p, slot) => {
	const team = side === "home" ? home : away, m = team.meta.get(p.rosterId);
	return {
		id: p.rosterId,
		side,
		slot,
		source_key: m.sourceKey,
		name: m.name,
		role: m.role,
		native_role: NATIVE[m.role],
		touchlines_role: p.role,
		touchlines_engine_id: p.id,
		attributes: m.attributes,
		provenance: {
			...m.provenance,
			touchlines_stats: source === "upstream-example-squads" ? "upstream-example-squad" : "synthetic-estimate:timepitch-attributes->touchlines-stats(harness mapping)"
		},
		touchlines_stats: team.roster.find((r) => r.id === p.rosterId).stats
	};
}));
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const gx = (x) => r5(x / 115 * 2 - 1);
const gy = (y) => r5((y / 74 - .5) * .84);
const MODE = {
	kickoff: 1,
	goal_kick: 2,
	offside_fk: 3,
	corner: 4,
	throw_in: 5
};
const samples = [];
const t0 = Date.now();
function sample(state, index) {
	const byId = new Map(state.players.map((p) => [p.id, p]));
	const xy = (side) => starters[side].map((p) => {
		const q = byId.get(p.id) ?? p;
		return [gx(q.x), gy(q.y)];
	});
	const ball = getBallPos(state);
	const owner = !state.pass && !state.shot && !state.looseBall ? slotOf.get(state.ballHolderId) : void 0;
	const mode = state.setPiece && state.setPiece.countdown > 0 ? MODE[state.setPiece.type] ?? 9 : 0;
	const extra = {};
	if (true) { /* timepitch native: match clock on every sample */
		extra.physics_ms = index * 100;
		extra.match_time_ms = Math.round((state.matchTime + (state.matchPhase === "secondHalf" || state.matchPhase === "matchEnd" ? 2700 : 0)) * 1e3);
	}
	samples.push({
		index,
		engine_step: index,
		...extra,
		score: [state.score.A, state.score.B],
		owner_team: owner ? owner.side === "home" ? 0 : 1 : -1,
		owner_slot: owner ? owner.slot : -1,
		game_mode: mode,
		home_xy: xy("home"),
		away_xy: xy("away"),
		ball_xyz: [
			gx(ball.x),
			gy(ball.y),
			0
		],
		tl_match_time_s: Math.round(state.matchTime * 100) / 100,
		tl_match_phase: state.matchPhase,
		tl_ball_state: state.shot ? "shot" : state.looseBall ? "loose" : state.pass ? `pass:${state.pass.kind ?? "ground"}` : "held"
	});
}
sample(s, 0);
let stopReason = "ticks_completed";
let measuredTimeScale = null;
for (tickIndex = 1; tickIndex <= ticks; tickIndex++) {
	const before = s.matchTime;
	s = tickState(s, DT).state;
	if (tickIndex === 1) {
		measuredTimeScale = Math.round((s.matchTime - before) / DT * 1e6) / 1e6;
		if (physicalClock && measuredTimeScale !== 1) throw new Error(`--physical-clock needs the fair bundle: measured TIME_SCALE ${measuredTimeScale}`);
	}
	sample(s, tickIndex);
	if (s.matchPhase === "matchEnd") {
		stopReason = "match_end";
		break;
	}
	if (tickIndex % 10 === 0) {
		if (Date.now() - t0 > WALL_LIMIT_MS) {
			stopReason = "watchdog_wall";
			break;
		}
		if (process.memoryUsage().rss > RSS_LIMIT) {
			stopReason = "watchdog_rss";
			break;
		}
	}
}
const bundleSha = (() => {
	try {
		return createHash("sha256").update(readFileSync(process.argv[1])).digest("hex");
	} catch {
		return "unavailable";
	}
})();
const record = {
	schema_version: "grf-experimental-1",
	engine_version: ENGINE_VERSION,
	synthetic: true,
	synthetic_notice: "SYNTHETIC: movement generated by TouchLines free play; not historical tracking. Attributes are synthetic estimates from the TimePitch catalogue.",
	input: {
		config: {
			home_key: home.key,
			away_key: away.key,
			home_players: inputPlayers.filter((p) => p.side === "home").map((p) => p.source_key),
			away_players: inputPlayers.filter((p) => p.side === "away").map((p) => p.source_key),
			home_formation: home.formationId,
			away_formation: away.formationId,
			home_tactic: "balanced",
			away_tactic: "balanced",
			seed: SEED
		},
		dataset_version: datasetVersion,
		ratings_version: "ratings-1",
		home_name: home.name,
		away_name: away.name,
		players: inputPlayers,
		input_hash: lineupSha ?? ""
	},
	native_binary_sha256: bundleSha,
	attribute_readbacks: [],
	observation_interval_ms: 100,
	metres_per_unit: {
		x: 105.156 / 2,
		y: 67.6656 / .84,
		basis: "touchlines yards -> metres (harness inverse of gx/gy)"
	},
	duration_ms: (samples.length - 1) * 100,
	steps_left: 0,
	samples,
	touchlines: {
		upstream: "https://github.com/brenosss/touchlines",
		commit: UPSTREAM_COMMIT,
		licence: "AGPL-3.0-or-later",
		source,
		lineup_sha256: lineupSha,
		dt_real_s: DT,
		ticks_requested: ticks,
		ticks_run: samples.length - 1,
		stop_reason: stopReason,
		time_note: physicalClock ? "physical clock: TIME_SCALE neutralised to 1 at bundle time; 0.1 s per tick = 0.1 s of match clock, stamina and intent timers (see match_time_ms)" : "sample clock = engine real-time (0.1 s per tick); engine match clock runs at TIME_SCALE=18x (see tl_match_time_s)",
		measured_time_scale: measuredTimeScale,
		physical_clock: physicalClock,
		native_clock: true,
		match_phase: s.matchPhase,
		test_mode: !physicalClock,
		prng: "mulberry32 replacing Math.random before engine import",
		random_calls_before_state: randomBeforeState,
		random_calls_total: randomCallCount(),
		buffs_note: "upstream computeBuffedStats applied at construction with seeded Math.random (no seasonLog)",
		wall_ms: Date.now() - t0,
		peak_rss_bytes_sampled: process.memoryUsage().rss,
		calibration: globalThis.__tpCalibration ?? null,
		events
	}
};
record.trace_hash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
const out = resolve(outPath);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(record));
console.log(JSON.stringify({
	out,
	stop_reason: stopReason,
	samples: samples.length,
	score: s.score,
	wall_ms: Date.now() - t0,
	rss: process.memoryUsage().rss,
	events: events.length,
	trace_hash: record.trace_hash
}));
if (stopReason.startsWith("watchdog")) process.exitCode = 3;
//#endregion
export {};
