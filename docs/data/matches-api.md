# Local matches and replays

The immutable research database remains separate from `.local/runtime.sqlite`. A persistent random key in `.local/session.key` signs the anonymous browser session. Session cookies are HttpOnly, SameSite=Strict, Secure on HTTPS, and contain no identity or service key. Clearing cookies creates a different owner; export important replays before doing so.

| Route | Behaviour |
| --- | --- |
| `POST /api/matches` | Validated MatchConfig; 202 with an owner-scoped job |
| `GET /api/matches` | The session's thirty most recent jobs |
| `GET /api/matches/{id}` | Queued/running/ready/failed, config and lightweight result summary |
| `GET /api/matches/{id}/replay` | Completed MatchRecord as a downloadable JSON attachment |
| `POST /api/replays/import` | Validated supported V1/V2 trace; 201 with a new owner-scoped ID |
| `GET /api/matches/{id}/statistics?end_ms=...` | Owner-scoped temporal metrics; required integer 0..5,400,000, floor to 250 ms, no-store |
| `GET /api/matches/{id}/windows` | Three recorded explanation windows and bounded metric facts |
| `POST /api/matches/{id}/explanations` | Revision/window/locale/mode request; 202 with a persisted bounded job |
| `GET /api/matches/{id}/explanations/{job}` | Owner-scoped pending/ready/unavailable/rejected result |

Every repository lookup/update binds both ID and owner in SQLite. Foreign or unknown IDs return 404. A finished match is immutable: duplicate completion with the same hash is idempotent; a different result cannot replace it. Records are compressed internally after validating the 16MiB uncompressed budget.

The service runs one simulation and admits four additional queued configurations; further creation gets429. Input configurations are limited to32KiB; replay import to16MiB and4,000 events. The ASGI guard counts actual received bytes, including streamed bodies without a Content-Length. POST also requires the actual same-origin loopback Origin or an explicit Vite development origin. CORS methods and headers remain explicit.

Restart marks queued/running work failed with `interrupted`; it never presents a partial record as finished. The thirty most recently created jobs per session are listed and terminal jobs older than that are pruned after completion/failure. Active work is not deleted while running. This is anonymous local browser storage, not account login or public hosting.

Import checks Pydantic shape/limits, supported engine/rules/ratings versions, current dataset SHA-256, real team/lineup membership, trace clocks/participants/score/metrics and canonical hash. It creates a new ID instead of replacing an existing match. Fields never execute code or select files. Replacing/touching the installed immutable dataset while running is rejected until restart, avoiding new matches stamped with a stale cached version. Previously stored traces retain their original snapshot and can be viewed without recalculation.

Web/API share one origin. Host checks restrict loopback names; raw research, local secrets and runtime files are not static assets. AI tools receive only the already-authorized record/window, never a model-selected file or arbitrary match ID. Grounded-2 keeps four HTTP calls per job and twelve per match/revision/locale/mode across prompt versions. Saved older jobs retain their original text/version. Metric definitions, exposure and availability are documented in [advanced metrics](advanced-metrics.md).
