# Match engine

## Legacy engine-1 / rules-1 (preserved read/validation contract)

A single seeded action generator maintains the ball, carrier, possession, period and score. It uses statistical team profiles and estimated player attributes; it does not pick a final score and animate independently. Matches last exactly 5,400,000 virtual milliseconds, with an interval at 2,700,000, and no extra time.

Actions include kickoff/restart, pass, carry, pressure, tackle and shot. Selection depends on ball progress, attack strength and each side's tactic. Pass/carry success uses player estimates and opponent pressing. Shot probability uses position, estimated shooting, attacking record and opponent concession record; it is explicitly **simulated xG**, not historical xG. A shot resolves to goal, saved or off target. Goals and saves reference the original shot and are counted once.

Movement actions take 1.5–6 seconds, clamped at the period boundary. Goal/save/recovery markers have zero duration at resolution. This keeps a shot resolved exactly on the whistle from losing its goal or artificially extending the half. Rendering must handle several events at one timestamp. Halftime reverses direction, places both teams for kickoff and gives the second kickoff to the away side.

Every replay frame contains the same 22 side-scoped entities and a ball within 105×68 synthetic metres. Formation anchors, ball position and phase determine off-ball placement; the carrier occupies the ball's position. Pass, carry and shot move the ball between frame endpoints. The renderer interpolates those endpoints without changing events or rerolling outcomes. These are simplified positional rules, not precise physical collisions or an historical reconstruction.

Eleven unique players, one goalkeeper and the exact chosen formation are validated against the selected team-season before simulation. A mirror matchup is allowed because entities include home/away prefixes, even when source players coincide. Missing roles cannot fill a position.

The trace stores config, seed, dataset SHA-256, engine/rules/ratings versions, initial frame, events and derived metrics. SHA-256 covers canonical sorted JSON of that record excluding the hash itself. Storage timestamps and IDs are separate. Same input and versions therefore produce the same trace; playback speed never enters the engine.

The generator stops with an explicit error if it cannot reach fulltime within 4,000 events. The same generator can reduce metrics without allocating frame objects for batch tests; the fast and full paths are tested for identical outcomes. Validation checks clocks, participants, carrier/possession consistency, shot/goal/save references, score, metrics and integrity. Structural validation of replay inputs adds further checks before import.

Initial validation includes 200 paired seeds for normal/stronger attack/pressing, full replay checks, both periods, mirrored entities, incorrect lineups and tampered outcomes. This demonstrates useful model response and consistency; the distribution still needs broader calibration and does not establish real counterfactual probabilities between eras.

## Replay format 2 contract (TP009)

The versioned codec dispatches explicitly: missing format version is legacy 1; version 2 uses compact millimetre samples and resolved events; unknown versions are rejected. Legacy defaults and canonical hashes are unchanged. The frozen Arsenal 2003–City 2017 seed 42 fixture has hash `b6670fb5b528a3a2caf2a225cc69f24e9ed0673487b7a4b2db747cb94c064755`.

Static identities remain in `initial_frame`. Each motion tuple contains clock, period, score, possession, carrier, ball mode, reset code, ball XY and 44 player coordinates. Coordinates/indices/times reject coercion from strings, floats or booleans. Format 2 omits null extension fields in canonical encoding. Storage bounds decompression to 16 MiB and reads either format without rewriting previous rows or owners. HTTP import of format 2 remains disabled until the physical validator is connected (M3). The contract alone does not change match movement.

## Persistent movement primitives (TP010)

`spatial.py` owns body/ball state, `tactics.py` computes objectives and `motion.py` advances velocities/positions every 250 ms. Estimated bounds: max speed `min(7 + 3*pace, 10.5)` m/s, vector acceleration 4 m/s², braking 5 m/s². Predictive braking at targets/boundaries avoids clamping a moving body. Canonical samples round to integer millimetres without mutating state; verification tolerances are 0.01 m/s and 0.05 m/s².

The controlled settled midblock spans 28 m longitudinally and 36–38 m laterally (tactic-dependent), shifts with the ball and opens wider in attack. Pressure/cover objectives affect selected nearby defenders; keeper objectives remain independent. Possession/tactic changes update targets only. Four formations × three tactics, both halves and continuity tested. These primitives are not yet connected to production actions until M3.

## Active engine-2 / rules-2 / basic-2 (TP011)

The action engine now consumes the persistent world at 250 ms. Passes lead a moving receiver and fly at 15 m/s; shots fly at 26 m/s. Control changes require access within 1.8 m; the ball may settle at the controlling foot, never move the player's body to justify a recovery or save. Carry objectives are finite (3–10 m, counter multiplier 1.2); control alone does not command an endless sprint. Goalkeepers keep their goal-support objective. Parameters remain estimated.

`run_match` feeds the identical quantized samples/resolved events to observers. `simulate_match` stores the stream; `simulate_metrics` discards it. `BasicReducer` assigns each interval to its left sample's owner, skips zero-time duration and counts each action marker once. Seed/RNG order never depends on observer/storage. `ratings-1` unchanged.

Regular motion has exactly 21,601 clock instants (0–90 min); explicit same-time kickoff/halftime/shot restarts are separate and excluded from effort. All instantaneous resolutions finish before a canonical sample is published. Shot/goal/save share a resolved sample; halftime preserves the preceding 45:00 resolution and adds the period-2 reset. Events refer to their origin and resolution samples and carry possession/sequence IDs and explicit relations.

The catalogue-backed validator checks exact initial/reset layout, clocks, identity/side, access, field bounds, speed, vector acceleration/braking, carrier/ball, score/shot links, metrics and hash. Near-equal speed comparisons use 0.01 m/s quantization tolerance; acceleration tolerance is 0.05 m/s². Rehashing a fabricated jump, acceleration, reset, clock, side or event coordinate does not authorize it. V2 import requires the catalogue; V1 still uses its frozen validator.

HTTP import now accepts valid V2 and preserves V1. The existing agent windows use temporal adapters (brought forward from M4 so activation does not break explanation endpoints); no new tools/categories/budgets. No fouls, cards, corners, substitutions, full offside or added time. No claim of historical calibration or predictive ability. Browser replay adaptation is M4.
