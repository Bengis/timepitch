# Historical catalogue contract · phase 1

The application consumes `research/data-audit/2026-10-16/derived/coverage.sqlite` with SQLite `mode=ro`. Its SHA-256 identifies the dataset version. Only complete target seasons are exposed: 686 team-seasons, 51 clubs, season starts 1992–2025. Original captures are immutable.

| Request | Response |
| --- | --- |
| `GET /api/health` | Phase, counts and dataset SHA-256 |
| `GET /api/catalog/teams?query=Manchester&season_start=2017` | Matching `TeamSummary[]`, without player arrays |
| `GET /api/catalog/teams/arsenal:2003` | `TeamSeason` with league participants and optional statistics |

Queries are at most 100 characters; season starts range from 1992 to 2025. Unknown keys return 404, invalid query values 422. Values are bound SQL parameters; keys cannot select arbitrary files/tables. Only built assets and a fixed artwork file are exposed; research, dotfiles and automatic API docs are not served.

FastAPI/Pydantic defines the contract. `scripts/export_contracts.py` generates `web/src/generated/api.ts` using the locked `openapi-typescript`; regenerate after changing models. Summary/detail separation avoids downloading every roster for selectors.

## Identity and provenance

- Team key: `<canonical-club>:<season-start>`. Player key: `<source>:<season-start>:<canonical-club>:<source-id>`.
- epldata through 2017/18, FPL from 2018/19. The overlap stays separate in research. Never merge IDs by name.
- Fixture-club membership is preserved after transfers: Nathaniel Clyne 2018/19 has 1,142 Bournemouth minutes and 108 Liverpool minutes.
- `OWNGOAL` is excluded. Own goals are already counted in team results.
- Players are identified league participants, not a guaranteed complete registration list or a specific match's starting XI. Missing positions stay null and cannot fill an automatic eleven; all 686 teams still have a valid audited formation.
- `source` identifies the roster provider. `results_sources` separately identifies Football-Data/footballcsv from the actual match rows. Both are labelled independently in the UI.

Statistics carry `value`, `source`, `status`, `unit`. Status is measured, estimated, unavailable or partial. Missing stays null; measured zero stays zero. Reconstructed epldata minutes are estimated. Goal-event discrepancies and annual/per-fixture FPL minute differences stay flagged. FPL assists and historical assists remain separate.

Phase 1 connects appearances, available starts, minutes, goals, assists and FPL saves. Passes/tackles/xG/xA from deeper captures are not connected yet, rather than claiming that every source lacks them. The partial 2022/23 xG warning is retained: pre-GW16 zeros cannot become measurements.

## Local UI and HTTP

Normal binding: `127.0.0.1:8078`, same-origin web/API. Host validation accepts loopback names; development CORS allows only explicit Vite loopback origins with GET/OPTIONS. Responses use CSP, nosniff, frame denial, no-referrer and HSTS on HTTPS only. Phase 1 is read-only and creates no session/runtime database; mutations require owner-scoped checks before enabling them.

English is the fresh-browser default. The selector remembers language locally, preserves teams during language switches and cancels superseded requests. A failed load shows retry without presenting the previous roster under the new selection. Interface translations are compile-time checked; names retain source spelling.
