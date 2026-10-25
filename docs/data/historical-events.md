# Historical events — phases 1–2 contract

This is recorded event data, not continuous tracking. Phase 1 provides an audited local dataset and read-only API. Phase 2 adds period clocks, event-led participation and cutoff-bound historical statistics. Reconstruction motion and the new UI are later phases.

## Source and terms

- Provider: StatsBomb Open Data, repository `hudl/open-data`.
- Fixed revision: `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`.
- Competition 2, seasons 27 (2015/16) and 44 (2003/04, Arsenal matches only).
- Source closure: both calendars, requested lineups/events, README, LICENSE.pdf and event/lineup/match specification PDFs. Every available file has its byte count and SHA-256; the selected revision is never `main`/`master`.
- The pinned public-data agreement supports research/analysis but restricts redistribution of provider data and commercial exploitation. Its clauses 1.2.1/1.2.2 require resolving permissions before the planned public data/reconstruction service. Section 1.4 and README require StatsBomb attribution and its brand logo for published analysis. This is not an MIT dataset.
- No automatic registration, external contact or sharing of the user's details is performed. Local research use and potential public delivery are separate decisions. `publication_status=blocked_pending_permission`, `local_use_only=true`; a configured `TIMEPITCH_PUBLIC_ORIGIN` disables historical serving even if the feature flag is set.

Original JSON and documents remain ignored under `.local/historical/statsbomb/<revision>/source`. The downloader makes one bounded request per missing/unverified file per invocation, with a 30-second timeout and 16 MiB cap. It never retries automatically. A valid cached file is reused only after checking its recorded size and digest. An altered cached file is refused, not overwritten. Unverified existing files are compared with a fresh immutable source read. Requests accept no arbitrary host, URL or file path.

## Candidate construction

Run from the repository root, in the existing backend environment:

```powershell
& ./backend/.venv/Scripts/python.exe -m timepitch.historical.import_dataset --source-root .local/historical/statsbomb/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb/source --output-dir .local/historical/statsbomb/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb/pilot-dataset --download --pilot
```

The pilot fetches only fixture 3754217 in addition to calendars/documents. Other calendar rows are explicitly partial. Omit `--pilot` for the approved 418-fixture audit. Omit `--download` to build solely from an already verified source manifest. Each `--output-dir` must be new; no existing candidate or original file is overwritten. The application never downloads or builds datasets on HTTP requests.

Each candidate has `historical.sqlite` and `manifest.json`. The manifest binds snapshot, source-manifest hash, document/source hashes, database bytes/hash, fixture audits and status totals to a deterministic dataset version. No build timestamp changes that version. The SQLite schema has `user_version=1`; the repository verifies hash/size/count at startup, opens `mode=ro&immutable=1`, and checks database/manifest file identity before and after reads. A replacement requires restart. A damaged/missing dataset yields historical unavailability; the existing simulator remains usable.

## Identities and availability

Fixtures, teams and players use `statsbomb:<source_id>`. Player names never join StatsBomb to FPL/epldata. Lineups include only name, shirt number, provider positions/intervals and cards; unnecessary player birth dates and country metadata are not projected into the API.

- `facts_ready`: both files parsed and core identities, references and Starting XI shape validated. This is structural availability, **not** phase-2 score/participation reconciliation or proof of complete measured football.
- `partial`: missing source, unresolved reference, out-of-nominal coordinate or incomplete Starting XI; incidents retained with explicit reasons.
- `excluded`: integrity failure, conflicting UUID/index or invalid required shape. No half-normalized event rows are served for that fixture.
- `metadata_only`: reserved for a catalogue-only record; the current builder labels absent files as partial with their missing reasons.

Missing events have `event_count=null`, not zero. Identical duplicate UUID/body pairs are idempotent and reported; conflicting bodies exclude only that fixture. Calendar identity/scope or source-document integrity failure rejects the dataset construction. Malformed event UUIDs/nested objects cannot abort another valid fixture's import. A valid source UUID remains unchanged.

A Starting XI needs eleven distinct player IDs belonging to the listed team. A foreign possession team is retained but flagged `unknown_possession_team`, making the fixture partial. Related event references are checked within that match. Structural incidents do not get silently filled with invented events.

## Event projection

`HistoricalEvent` retains source UUID/index, event type, team/player keys, period, exact millisecond `period_ms`, source minute/second labels, optional duration, related IDs and event details needed for subsequent phases. All are marked `source_recorded`; normalization does not make them measured tracking.

`location_source` and `end_location_source` retain provider coordinates, including the optional third shot coordinate. `location` and `end_location` are **only scaled projections in the provider event's frame**, using x×105/120 and y×68/80. They are not yet the canonical home/away/half orientation and do not represent measured stadium dimensions. Phase 2 must orient them consistently before combining teams on a field. Coordinates outside the nominal source rectangle remain in the source field and have null projection plus an issue. Nonfinite numbers are rejected. Missing endpoints/durations remain null, never an invented receipt or flight.

`duration_source` preserves the provider's optional duration. A finite negative value is retained there, while usable `duration` becomes null and `invalid_source_duration` marks that fixture partial. This is a missing usable measurement, not a reason to discard thousands of other recorded actions or silently turn a negative number positive.

Period milliseconds come from `timestamp`; they are not total match elapsed time. For example, second-half timestamp 00:50:38.204 may carry football label 95:38. Phase 2 will build the composite clock, coalesce repeated half boundaries and reconcile paired own-goal markers. Phase 1 preserves those source events separately.

No continuous player movement is produced in this phase. Later animation must keep “Real match events · Synthetic tracking” / “Eventos reales · Tracking sintético” visible and must not promote synthetic distances, speed or team shape into historical observations.

## Read-only HTTP surface

Select a verified candidate before starting a **separate local** instance:

```powershell
$env:TIMEPITCH_HISTORICAL_DATASET = '<path-to-your-statsbomb-snapshot>/dataset-2'
$env:TIMEPITCH_RECONSTRUCTION_ENABLED = '1'
$env:TIMEPITCH_LOCAL_MODEL = ''
```

Do not reuse/kill an occupied service port or enable a public origin. The actual accepted candidate path is recorded in the phase case/receipt; the example is a candidate name, not an instruction to overwrite an active selection. `TIMEPITCH_TWO_MODES_UI` is an advertised server flag; phase 1 does not implement its UI.

| Route | Bounds and result |
| --- | --- |
| `GET /api/historical/capabilities` | Always 200; flags, selected dataset state/version, blocked publication status |
| `GET /api/historical/seasons` | Actual calendar/facts-ready counts and full-season/Arsenal-only/partial-calendar scope |
| `GET /api/historical/matches?season_id=27` | Optional team ID, offset≥0, limit 1–50 (default 24) |
| `GET /api/historical/matches/{id}` | Positive source ID, metadata/final score explicitly separate, sanitized lineups/incidents and a derived `clock` |
| `GET /api/historical/matches/{id}/events?period=1&from_ms=0&to_ms=60000` | Period 1–5; half-open `[from_ms,to_ms)`; at most 60 seconds; offset≥0, limit 1–200 (default 100) |
| `GET /api/historical/matches/{id}/statistics?period=2&at_ms=3038204` | Inclusive event-time cutoff; period 1–5; nonnegative milliseconds within the recorded period; dataset version and definitions included |

Unknown fixture: 404. Invalid bounds: 422. Dataset absent/disabled/changed or serving configured as public: 503. No historical generation POST, simulator invocation, model call, source download or arbitrary path argument. Existing CORS/host/security headers apply. Cache policy remains the application's conservative `no-store`; dataset-version fields allow later client-side identity binding without a global cache-policy change.

Generated OpenAPI types include the current complete backend surface. `HistoricalPoint` deliberately has a distinct name: using another `Point` causes Pydantic schema-name splitting and breaks existing simulation types. The regression pins `MatchRecord`, `MatchRecordV2`, `MatchEvent`, `RenderFrame` and `Point` names.

## Validation boundary

Offline importer/repository/API tests, catalogue/security regressions, generated contracts and web build are phase-1 checks. Source coverage/audit is a real-file check. Neither is a native simulated match, an AI acceptance, a validated synthetic reconstruction or a public deployment. See [phase case](../cases/case_TP092_statsbomb_historical_catalog_2026-10-19_01.md) and [plan](../superpowers/plans/2026-10-19-two-modes-statsbomb.md).

## Phase 2: chronology and coordinates

The selected phase-1 database is unchanged; no source download or dataset rebuild is needed. Read-time event analysis has its own definition version. A match detail's `clock` keeps each observed period, exact whistle extent, last observation, boundary event IDs and incidents. Coincident Half End records define one extent while both original UUIDs remain accessible. Playback concatenates valid periods without the dressing-room interval. It does not impose 45:00 halves or a 90:00 final whistle.

`(period=2, period_ms=3038204)` displays `95:38`; the pilot playback ends at 5,956,530 ms because its first half lasted 48:38.326 and its second 50:38.204. Event `minute` and `second` are preserved unchanged. Conflicting ends have no usable final extent. A unique Half End can reconcile a score even if Half Start is absent, but that period cannot claim playback continuity. Events timestamped after a recorded whistle stay in the source; the whistle is not stretched to include them, an incident is emitted, and continuity across that period is unavailable. Queries cannot silently clamp times or invent an unobserved end.

The existing `location`/`end_location` remain provider-frame scaled points. Additional `canonical_location`/`canonical_end_location` use `display-home-right-first-half-105x68`, explicitly marked `derived_from_events`. The home side attacks right in periods 1/3, left in 2/4; the away side is the inverse. This is a **chosen display convention**, not evidence of which goal the real home team chose. Both x and y are reflected together using the **event's team**, independently of `possession_team_key`. Missing/invalid points remain null. The inverse transform and both sides/halves are tested. Raw shot freeze-frame context remains in its event frame; do not combine it with canonical points without the same event-frame transform.

## Phase 2: appearances and event definitions

Starting XI establishes membership. Substitution, Player Off/On and Red Card/Second Yellow change event-led intervals at exact milliseconds. A bench listing alone supplies no appearance. A temporary exit is excluded from on-pitch time; halftime is excluded, while stoppages and added time inside periods are included. `played_ms` is **elapsed on-pitch appearance time**, not effective ball-in-play time or measured effort. Substituted or dismissed identities never reappear because a Tactical Shift lists them. A known outgoing player leaves even if the replacement ID is unresolved; that uncertainty remains visible.

Provider position annotations are retained separately. Reversed period intervals, unresolved entries and formations listing inactive players produce incidents rather than rewriting membership. Missing rosters/Starting XI produce partial or unavailable participation, never a complete empty lineup. Player objects used by the participation timeline omit future lineup cards/positions; the original sanitized roster remains available in match metadata.

`HistoricalStatistics` uses `definition_version=statsbomb-events-1`. Event values are attributed to their source event timestamp, including the outcome embedded in that event. The cutoff is inclusive in `(period, period_ms, source_index)` order; all coincident events through that millisecond are included. Later goals, substitutions, cards, formations and evidence IDs cannot enter earlier totals. Appearance intervals are clipped at the cursor and late exit references are excluded. A repeated earlier query remains identical after querying the end.

| Metric | Definition and missing-data rule |
| --- | --- |
| Goals | Shot with outcome Goal; paired Own Goal For/Against contributes once to the beneficiary with both evidence UUIDs. A calendar score is a comparison target, never an extra goal. An own goal belongs in the defender's `own_goals`, not their scoring tally. Ambiguous pairing yields unavailable affected totals. |
| Shots | Recorded Shot events; own-goal markers are separate. Shootouts are excluded from match totals and flagged. |
| xG | Sum of provider `shot.statsbomb_xg`, variant `statsbomb-shot-xg`; never the simulator's xG. No shots is a mathematical sum of zero; a missing/invalid shot value gives `value=null`, `observed_value` and `missing_count`. |
| Passes | Every Pass attempt, including set plays/throw-ins. A present pass object with missing/null outcome is completed; Incomplete/Injury Clearance/Out/Pass Offside are unsuccessful; Unknown or an unrecognized outcome is unresolved. Missing pass detail is unresolved. These are event annotations, not inferred tracking receipts. |
| Pass network | Completed passes with an explicit recipient belonging to the same roster team. An intended recipient on a failed pass creates no completed edge. |
| Cards | Only recorded Foul Committed/Bad Behaviour cards; do not count lineup copies again. `yellow_cards` counts Yellow Card; `second_yellows` and direct `red_cards` are separate categories. Either dismissal ends membership. |
| Pressures / action map | Counts and positions of recorded events. These do not measure collective pressure, occupation, defensive shape or the positions of 22 players. |
| Possession, distance, defensive line | Unavailable; overlapping durations and possession sequence IDs are not measured time percentages or tracking. |

[The provider's own tutorial](https://statsbomb.com/wp-content/uploads/2019/12/Using-StatsBomb-Data-In-R.pdf) documents missing pass outcome as a completed pass; the pinned event specification supplies outcome/card types, event timestamps, coordinate axes and relationships.

Missing event sources do not yield a scoreless match. Unattributed actions preserve their visible source incidents; affected team metrics are null with observed totals, missing counts and evidence, while independent metrics remain usable. `reconciliation` compares event score with the calendar only at an identifiable recorded final whistle, independently of continuity. `clock_status` and `participation_status` state their separate availability. `summary_reconciled` requires a matching final score and no clock, participation or visible source incidents; a matching score alone is insufficient. Source labels/positions are data-quality diagnostics, not evidence that synthetic motion is already validated.

Actual phase-2 acceptance: 418 event scores match; 405 clocks without incidents/13 partial, 384 participation timelines without incidents/34 partial, and **368 summaries reconciled/50 with incidents** after overlap and the five phase-1 measurement anomalies. All 1,443,174 events and all source/database hashes are retained. See [TP093](../cases/case_TP093_historical_facts_analysis_2026-10-19_01.md) and [receipt](../../research/historical-reconstruction/2026-10-19/phase2-acceptance.json). No new UI, movement, native match, inference or public deployment is claimed.
