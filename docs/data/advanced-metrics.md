# Advanced metrics contract

`StatisticsBundle` uses `metrics-1`. Definitions carry an ID, definition version, unit, scope, denominator and variant parameters. Every value carries provenance, availability, evidence and the actual denominator. Zero denominators produce `null` with `zero_denominator`; unavailable observations are never replaced with a performance zero.

## Event metrics (`events-1`)

Implemented by `statistics.EventStatistics` from resolved `EventView` objects. Snapshots exclude events resolved after the cutoff, retain event IDs and never consult subsequent motion or model output. IDs with conflicting bodies or unknown players are rejected. Identical repeated markers are idempotent.

- **Simulated xG:** the engine's generative probability, summed once per shot; xGA is the rival sum, xGD the difference. Goals are counted from goal markers, not from a second xG addition. This is not an independent provider xG model.
- **Creation:** the last completed delivery to the shooter in the same possession/sequence; at most 5 seconds and 5 metres of subsequent carry, including successive carries. Only the first shot consumes that delivery. Rival control, another delivery or restart invalidates it. `key_passes` and `xg_assisted` retain both event IDs.
- **Progression:** distance reduction to (105,34), with thresholds 30/15/10 metres in own half/across halfway/opponent half. Attempted and completed counts are separate. Coordinates rotate both axes for away/second-half attacks.
- **Entries:** completed actions crossing into x≥70 or the opponent box (x≥88.5, 13.84≤y≤54.16); actions already inside do not add an entry.
- **Field tilt TP:** completed passes with both endpoints in the attacking third divided by eligible passes of both teams. The denominator and both teams' evidence are retained.
- **Passes per intervention TP:** rival completed passes with both endpoints within their initial 60% (x≤63) divided by unique own won tackles/interceptions in that zone. An associated recovery marker does not add another intervention. This deliberately limited taxonomy is not provider PPDA.
- **Recoveries:** completed loss–regain episodes determine the mean; open episodes have their own count/evidence. Counterpress recovery is strictly under 5 seconds. Restarts censor open episodes; the final whistle preserves their open status. A pressure-linked recovery requires a prior causal event reference, including within one tick.
- **Sequences:** completed passes, duration, net progress and direct speed. A shot closes at release/origin, not at flight arrival. An open sequence uses its last resolved action endpoint and elapsed time to the cutoff; the definition records this convention. Mean speed excludes zero-duration sequences.

Shot maps use the shot origin; xG curves, action maps and pass edges carry resolved timestamps and event/player IDs. These are action observations, not continuous occupancy maps. Goal/save markers do not create a second shot/action.

Team-only measures are not assigned artificial individual values. Missing legacy spatial context produces `legacy_no_context`.

## Motion and structure (`motion-1`, `shape-1`)

Distances and speeds use consecutive 250 ms canonical samples, independently of browser FPS. Zero-time resets add no distance and clear episode/derivative state. Rates use valid exposure: metres/seconds×60 and metres/seconds×5.4 for km/90. No participation defaults to 90 minutes. HSR is 20–25 km/h inclusive, sprint strictly above 25. Threshold distance/duration retain short bursts; episode counters require at least 1 continuous second. Acceleration is the causal change in speed magnitude per second (no filter), strictly above +3 or below −3 m/s² for at least one second. An unavailable derivative at startup/reset does not create an acceleration.

Role geometry excludes keepers: defensive height is the median defender x in attacking coordinates; gaps are longitudinal role-centroid differences; length/width are outfield extents. Means use elapsed-time weights from the left live sample, with phase-specific exposure and sample ranges. Zero-time resets and the immediate interval whose left sample is a reset contribute no stable geometry. Possession thirds use valid exposure and 35 m zones. Occupancy aggregates outfield player-seconds per 12×8 cell and phase, rather than exporting every frame as another point. Effort curves store cumulative metres at minute boundaries and the current cutoff.

`AdvancedReducer` consumes the same observer stream as stored replays. Queries reconstruct only through `floor(end_ms/250)×250`. `simulate_statistics` keeps reducers/events and plot aggregates without storing motion. A new V2 replay embeds its final bundle and `metrics-1` in the canonical hash; validation recomputes it and rejects forged metrics, plots, references or extra fields. Old V2 `basic-2` and V1 hashes remain unchanged. V1 exposes known xG curves but physical values use `legacy_no_motion` and spatial measures use `legacy_no_context`.

## Historical supplement (`historical-advanced-1`)

Build with `python -m timepitch.catalog.build_advanced --source research/data-audit/2026-10-16 --output data/advanced`. The immutable capture cannot be the output destination. Repeated builds produce identical canonical JSON. The manifest records input SHA-256/encodings, coverage, exact/postponed duplicate decisions, quarantine and snapshot discrepancies. Current data version is `sha256:0616ef708a3737e0e1873140b1cdadc7e76610620b2ec7023553bdf8f367108f`.

`HistoricalStatistic` extends the basic statistic with `definition_version`, `covered_minutes`, `fixtures_covered/total`, `coverage_from/to` and `reason`. Fields are xG, xA, starts, tackles, recoveries and aggregate CBI; each except starts has its per90 value. Numerators and minutes use that field's covered rows. Missing exposure produces unavailable rates; numeric individual zeros in valid coverage remain measured. 2022/23 xG/xA/starts begin at captured GW16, including valid postponed fixtures whose original round is earlier. The 244/380 coverage count describes fixtures, not a requirement for every player to have positive xG.

Membership is resolved per fixture; annual final team and player names cannot link or regroup records. The file contains 4,382 linked player-season-club keys and 3,182 explicitly unlinked aggregates, including the FPL/epldata overlap. Unlinked data is not returned as matched catalogue evidence. Exact duplicates are removed once, postponed duplicates use the actual fixture kickoff, and unresolved alternatives remain in non-consumable quarantine. A unique observation with valid fixture/club relationships and a different kickoff timestamp is retained with a manifest warning. The known three Latin-1 merged CSV captures are decoded explicitly, without rewriting their bytes.

The 2025/26 six-field totals reconcile exactly with the annual snapshot. Partial 2022 totals and the 0.01 xA discrepancy for FPL 2024 element123 stay reported. No snapshot total silently replaces covered observations. `TIMEPITCH_ADVANCED_DATASET` overrides the default supplement path; missing data leaves the basic catalogue usable with reasons. A changed supplement requires restart. Ratings and automatic lineups remain unchanged.

## Owned API and presentation

`GET /api/matches/{id}/statistics?end_ms=...` uses the existing signed owner session and returns 404 for another owner. The required integer clock is bounded to 0..5,400,000 and floored to 250 ms; the response reports that effective cutoff and is not cached. The final validated bundle is reused if present. Intermediate queries reconstruct only the requested prefix. No arbitrary file, dataset or field argument is accepted.

The UI queries only after **Inspect current statistics**, preserves numeric snapshots across label translation, cancels in-flight old-language/identity requests and clears data on rewinding below its cutoff. It binds accepted responses to match/hash/clock/request-language; final totals are gated at 90:00. Charts use server plots and offer equivalent tables. Event points navigate the existing event inspector. Historical source fields remain a separate selected-player section with covered exposure and availability.

The cumulative xG curve always shows whole-team totals, including when a player is selected elsewhere. Its table distinguishes the shooter at that event from the team's cumulative value. Individual xG totals remain in the metric table; no individual cumulative curve is inferred from team points. Completed-pass links use recorded `pass_edges`, with directed evidence navigation and incoming/outgoing player filtering. Node placement is a schematic by lineup slot; each line is one completed pass, without invented average positions or client-side metric weights.

Known minor: the final-whistle marker may close the last open sequence at the whistle ball position, rather than the declared last resolved action endpoint. This can change progress/direct speed of that final sequence. It does not change score or physical distance; a future correction must preserve versioned evidence.

Grounded-2 projects at most four supported metric facts into each explanation window, with bounded event IDs/sample ranges. The analyst selects an authorized observation ID; the server reconstructs the claim and revalidates xG advantage, field tilt TP or a unique distance leader before narration. Names/numbers come from those facts. The narrator cannot change metric, player, evidence or score. Existing jobs and budgets survive the prompt upgrade. No new real-model acceptance is claimed until the prepared-model probe passes.

The three-calendar retrospective uses the same world/reducers without AI, preserves configuration/lineups/exposure and never writes to the source capture or active runtime. These definitions describe simulated outputs and separately identified recorded historical data, not professionally measured tracking or calibrated predictive performance. Private research data redistribution remains a separate decision.
