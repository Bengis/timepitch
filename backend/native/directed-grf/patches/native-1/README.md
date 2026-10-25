# Directed GRF native 1

Source implementation of G3 initialisation, directed commands and native contact capture. This patch replaces the guard **only in a separately prepared fork**, not in production. Do not stack it on guard-1: both patches target the original pinned base. [TP186](../../../../../docs/cases/case_TP186_grf_native_initialization_and_controls_2026-10-22_01.md) records the checks and remaining gates.

`manifest.json` pins fourteen original files and two new sources by base/output SHA256. The patch adds `src/directed_reconstruction.hpp/.cpp` and guarded hooks in GameEnv, PlayerCommand, player/humanoid, controller and Match. `TIMEPITCH_DIRECTED_RECONSTRUCTION` defaults to OFF. Source syntax was checked with installed MSVC19.16/C++14, `/Zs`, on eight translation units; no object, linked library, engine import, environment or match was executed. Existing source notices remain in place; see [third-party notices](../../../../../THIRD_PARTY.md).

## Initial state

`directed_prepare_v1` takes a lowered packet from the existing G3 host, plus `nativeOptions` from the pure `lower_native_initial` helper. It requires an already created, fresh and unstepped world, matching complete active roster/slots, no external player controllers, period1/open play and explicit `grf-directed-cold-start-1` priors. The caller must create that world only under a later runtime admission. No factory, loader or worker entry point is added here.

The policy defines synthetic inferred roots, native reset caches/empty player memories, a free ball and standing/moving ground-root phases. It is not opaque state restoration or a claim that a recorded action point is a pelvis. Unrepresented retained-ball/airborne/saved-animation states, nonempty memories, unknown cache policies, incompatible energy/seed or incomplete rosters are rejected. No source value is replaced with a convenient default. Stationary facing/idle phase follows the declared seeded native cold-start policy; it is not historical tracking.

Validation precedes state mutation. One initialisation seeds the existing native RNG, resets the native situation/AI caches, sets physical positions, velocities and energy, selects a native movement animation, initialises the free ball and rebuilds mental images. Mirror flags are preserved; callbacks/export undo the current mirroring into one stable world basis. The original priors and UTF-8 packets remain separately recorded. No source clock is changed; a native epoch is mapped explicitly to the original source start. A failed prepare cannot retry on that world.

## Commands and capture

`lower_native_command` adds explicit synthetic director metadata: function, launch tick and power. These are separate from historical contact time, receiver, body part and outcome. No lead time or power is silently inferred from recorded facts. The native queue verifies actor/receiver against the source command and the prepared mapping, source time against the10ms grid, unique IDs and nonoverlapping actor windows. A contact at the terminal boundary or off the grid remains unsupported; the clip is not extended.

The named actor enters the real Eliza command queue. Nondirected actors use ordinary collective AI. Passes set the explicit `forcedTargetPlayer` and use native `AI_GetPass`; shots use native shot commands and the existing animation/ball physics. Trap, interfere and deflect use their native function paths. An explicit body constraint filters native animations by their actual `touch_bodypart` value; an unavailable animation fails naturally. A high pass does not imply a header. Launching a command does not guarantee a successful contact or outcome.

The common native contact callback records the actual actor, animation body variable, physical time, function/role, ball position and resulting velocity. A missing, late, wrong-body or wrong-actor directed contact fails, without relabelling its time. Native goal counts are sampled after each tick; the historical outcome is never assigned to the score. Inputs/commands and actual observations are exported separately in `grf-directed-native-export-1`.

No body-surface certificate is fabricated: the exported animation contact target is explicitly tagged as an animation target, and body surfaces/intervals remain unavailable. Native touch telemetry is evidence of the engine's callback, not proof of the0.08m physical surface bound. G4 still needs independent geometry/continuous checks and the export reader before any acceptance or viewer use.

After prepare, ordinary reset/restore/actions/compressed stepping are refused. Root/ball reposition or a situation reset after initialisation stops the directed capture. Dedicated stepping advances bounded physical ticks, records actual clock/goals/positions and stops on a discrepancy; there is no fixture, seek, retry, output warp or score overlay. A failure preserves the raw observations and first reason. The Python G3 host still runs controlled doubles only; this source patch does not enable native execution through it.

The [fractional time/contact proposal](../../../../../docs/superpowers/specs/2026-10-22-grf-directed-time-contact-design.md) remains unapproved. The13.826s historical pilot has not been run or certified. All runtime/model/root ledgers remain unchanged. Linking an artifact, authenticating its source/build identity, authorising a probe, physical validation and web integration remain separate gates.

## Subsequent isolated build

[TP187](../../../../../docs/cases/case_TP187_grf_native_binary_link_2026-10-22_01.md) and its [separate build receipt](../../../../../research/design-evaluation/2026-10-22-directed-engines/grf-g3-linked-build.json) record a successful full Release x64/v141 compile/link and static PE/symbol inspection. The source manifest above remains the historical TP186 source/syntax receipt. The new binary stays in the ignored isolated build; production is unchanged. No native import, capability call, environment, match or model was executed. Runtime ABI/dependency closure, G4 acceptance and physical feasibility remain unverified.
