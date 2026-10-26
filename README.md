# TimePitch · Football Across Eras

![TimePitch: football across eras](assets/art/timepitch-concept.png)

*Cover art is AI-generated concept art made for TimePitch. It is not a photograph and does not imply endorsement by any club or player.*

**What would happen if Arsenal 2003/04 played Manchester City 2024/25?** TimePitch lets you pick Premier League team-seasons from any era between 1992/93 and 2025/26 and watch them play a full match, in a stylised 3D broadcast or in retro 16-bit graphics. Every match is fictional; the history behind each side (squads and season statistics) is real. By default the app shows a **fictional league** with invented club and player names; one click switches to the real names. Outside the hackathon demo it can also replay real recorded matches from open event data, so you can compare what a simulator does with what actually happened.

- **Video (under 2 min):** https://youtu.be/Tj4HU7S_O_g
- **Live demo:** https://timepitch.livelywater-efc07e50.swedencentral.azurecontainerapps.io
- **Source code:** https://github.com/Bengis/timepitch (this repository, AGPL-3.0-or-later)

## Hackathon entry: Inside the Game (Microsoft + Premier League)

Challenge: *The Synthetic Match Insights Engine for Premier League Studio*.

- **Synthetic match data.** In the hackathon demo every match event is produced by a football engine (TimePitch, Google Research Football or TouchLines). No real match events, tracking data or footage are used. Historical season statistics only seed the simulation. The mode that replays real recorded matches is switched off in the hackathon demo.
- **Fictional league by default.** Clubs and players get invented names ("North London Reds 2003/04", "Nico Warburton"), with no real crests, nationality or date of birth on the player cards. A toggle next to the language switch shows the real names. The same name rules run in the web and in the backend, so the AI report names exactly what is on screen (`backend/src/timepitch/fictional`, `web/src/catalog/fictional.ts`).
- **Agent crew on Azure.** When a match ends, the recorded facts go to an Azure Storage queue. A KEDA-scaled Azure Container Apps job (managed identity, no keys) runs a Microsoft Agent Framework crew on Azure AI Foundry (gpt-4.1-mini): an analyst picks the facts, a writer drafts the report and a deterministic verifier checks every sentence. Failures go back for one revision, and otherwise the report falls back to text built only from facts. The server re-checks the sealed report before showing it. Readers choose a report for **fans** or for **analysts**; every plan includes the recorded team comparisons (shots, possession, passes, recoveries) to show how the result was reached. Code: `backend/src/timepitch/crew`.
- **Live during the match.** At half-time the same crew writes a report of the first half from the facts recorded so far (goals, shots and completed passes up to the break); the full-time report follows at the final whistle.
- **Ask the match.** After the final whistle, fans type a question. A Microsoft Agent Framework agent calls four read-only tools over the recorded facts (result, goals by half, leading players, team comparisons for the match or the first half) and answers in 1–4 sentences. Every sentence must cite facts the agent actually fetched and passes the same deterministic checks as the report, including a rule that each team's figure is its own; otherwise the fetched facts are shown as they are. The question is untrusted text: only checked sentences or fixed text reach the page. Each model request goes through the same spending gate and ledger, with its own envelope (`backend/src/timepitch/crew/ask.py`).
- **Whole app on Azure.** Web, API and the three engines run on Azure Container Apps (`deploy/azure-app`).
- **Measured.** 21 live reports: the first draft was rejected in 17, no unverified sentence was published, and 10 were published as verified AI prose. Cost averages $0.0028 per report. Azure AI evaluation gave groundedness 5/5 on two reports. About 2,400 backend tests.
- **History.** This repository is the public release of a private development repository (400+ commits since 16 October 2026). Each public commit groups several development cases, so the history here is short by design.

## Try it

1. **Pick two team-seasons and press "Play match".** The home screen pairs two Premier League team-seasons from any era (for example Arsenal 2003/04 v Manchester City 2024/25, shown as North London Reds v Mancunian Sky in the fictional league); change either side, then play. The match runs live on the server with **Google Research Football** by default; **TouchLines** is offered as a second engine under "⚙ Options", next to the graphics choice.
2. **Watch it.** Follow the plain-language commentary next to the pitch, switch cameras (broadcast, tactical), pause, change speed or jump to any moment. Open a player card from the line-ups and look at the analysis: summary, maps (heat, territory, shots, passes) and physical effort.
3. **Demo match** (`#/demo`): the same cross-era fixture recorded beforehand with Google Research Football, TouchLines and open-football, to compare engines.
4. **Reconstruction** (`#/reconstruction`, not available in the hackathon demo): a recorded 2015/16 Premier League match or one of Arsenal's 2003/04 matches, scrubbed through its real events (goals, saves, cards, substitutions).

## What is real, what is estimated, what is simulated

TimePitch labels every figure with its origin. The three categories are never mixed silently.

| Category | What it covers | Source |
| --- | --- | --- |
| **Historical data** | Results of 13,166 Premier League matches (34 seasons, 51 clubs, 686 team-seasons); players who appeared for each team-season; season statistics where a source exists; recorded match events for 418 matches | Public football datasets listed in [THIRD_PARTY.md](THIRD_PARTY.md); match events from StatsBomb Open Data; player cards from Wikidata and Wikipedia |
| **Estimates** | Player and team attributes (pace, shooting, passing, etc.) derived from historical statistics with era-aware priors and visible confidence; missing kit colours | TimePitch rating method ([docs/data/ratings-method.md](docs/data/ratings-method.md)) |
| **Simulated** | Every simulated match: movement, actions, goals, scores, chances and all post-match statistics. In reconstructions, **movement between recorded events is synthetic**, not real tracking data | TimePitch engine or one of the external engines below |

TimePitch does **not** claim to predict real results, and its reconstructions are partial: trajectories, distances, speeds and team shape between events are illustrative. In the fictional league (the default) players and clubs carry invented names and no crests. With real names switched on, players are recognisable by real name, shirt number, position and statistics and are drawn as **original stylised avatars**; there are no photographs. Crests and kits identify the clubs; they belong to their clubs.

## Features

- **3D broadcast** (Three.js): procedural stadium and **skeletal, motion-captured players** that wear their season kit, number, skin tone, hair and height. Stride follows the engine's speed; kicks, headers, slide tackles, keeper dives and goal celebrations are driven by the recorded events. TV camera with a close-up of the scorer; automatic quality reduction on slow devices.
- **Retro 16-bit graphics**: an original pixel-art pitch in the style of 16-bit console football, chosen under "⚙ Options → Graphics".
- **Live engines**: Google Research Football (compressed match clock) and TouchLines (upstream clock) run on the server in bounded worker processes. The built-in TimePitch engine is kept as a fallback.
- **Commentary next to the pitch**: who passes how far, who wins the ball, shots and their outcome, goals with the score, set pieces.
- **Recorded-match analysis**: possession, territory, field tilt, heat maps, shots, pass network (when the engine records receivers), distance and high-intensity running in five-minute blocks. Figures an engine did not record are shown as "not recorded", never as zero.
- **Broadcast layer**: scorebug, goal announcements, line-ups and **player cards** (name, number, position, nationality, date of birth and height from Wikidata/Wikipedia, with an original avatar).
- **Catalogue of 686 team-seasons** (1992/93–2025/26) with squads and season results.
- **Reproducibility**: the TimePitch engine is seeded; every live match stores its engine version and a trace hash with the recording.
- **Reconstruction mode**: 380 Premier League matches from 2015/16 plus 38 Arsenal matches from 2003/04, built from StatsBomb Open Data events.
- English and Spanish interface, and a fictional-league / real-names toggle.
- **AI at half-time and full time, and questions about the match** (see the hackathon section).
- **Optional AI**: a local analyst (Microsoft Agent Framework + Foundry Local) and AI match reports with Microsoft Agent Framework on Azure AI Foundry (`backend/src/timepitch/crew`, `chronicles`). The AI explains recorded events; it never decides goals or changes statistics. Both are off unless configured.

## Architecture

```text
Browser (React 19 + TypeScript + Vite; Three.js 3D renderer)
   │  JSON API, signed session cookie          │  static recordings (.json.gz, SHA-256 checked)
   ▼                                           ▼
FastAPI backend (Python 3.12)              /replays/ (outside git)
   ├── Catalogue: read-only SQLite built from historical sources (not distributed)
   ├── Ratings: era-aware attribute estimates with confidence
   ├── Live engines: GRF and TouchLines workers (separate bounded processes, never loaded into the API)
   ├── TimePitch engine: seeded, reproducible 90-minute simulation (fallback)
   ├── Reconstruction: read-only StatsBomb event snapshot + synthetic movement
   ├── Runtime store: per-session matches and replays (SQLite, outside the repo)
   └── Optional local AI tools (Agent Framework + Foundry Local), off by default
```

Design rules: **the engine decides, the AI explains**; **reproducibility** (seed, engine and data versions recorded); **provenance first** (missing data is shown as missing); **process isolation** for external engines.

| Path | Contents |
| --- | --- |
| `backend/src/timepitch/` | API, catalogue, ratings, engine, reconstruction, GRF worker integration, storage, optional AI tools |
| `backend/tests/` | Backend tests (tests that need non-distributed data are skipped, see below) |
| `web/src/` | React interface, renderers, match centre, recorded-engine adapters, analysis, translations |
| `web/tests/` | Playwright browser tests (need the full local dataset) |
| `web/public/` | Crests, player cards, 3D player models, licence texts |
| `engines/touchlines/` | TouchLines upstream sources, TimePitch harness and bundles (AGPL-3.0-or-later) |
| `backend/native/` | TimePitch patches for Google Research Football |
| `scripts/` | Local launcher, test runner, API contract export, recorded-events exporter |
| `docs/data/` | Data contracts and methods (ratings, engine, metrics, events) |

## Run locally (Windows)

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 24 and npm. Lockfiles are included; everything installs inside `backend/.venv` and `web/node_modules`. No cloud account or API key is needed.

```powershell
python -m uv sync --project backend --locked
npm.cmd --prefix web ci
```

### Without any private data: the 3D demo player

The historical datasets and the engine recordings are **not** in this repository (see below). The web app still builds and runs on its own:

```powershell
npm.cmd --prefix web run dev
```

Open http://127.0.0.1:5173/#/demo. The development server serves recordings from `.local/replays-dist/` (or the folder in `TIMEPITCH_REPLAYS_DIR`) under `/replays/`. Each file listed in `web/src/match-centre/adapters/recorded-replays.index.json` must have exactly the SHA-256 shown there; a missing recording is reported as unavailable instead of being replaced. Pages that need the API (catalogue, simulation, reconstruction) show an error until a backend with a catalogue is running.

### Full application

The API needs the historical catalogue, which is not distributed. If you build your own, point the backend at it and start the launcher:

```powershell
$env:TIMEPITCH_DATASET = 'C:\path\to\coverage.sqlite'              # SQLite catalogue
$env:TIMEPITCH_ADVANCED_DATASET = 'C:\path\to\advanced-1.json'     # advanced statistics
& .\backend\.venv\Scripts\python.exe .\scripts\export_contracts.py
& .\scripts\start-local.ps1
```

Open http://127.0.0.1:8078 and stop with Ctrl+C (`-Port 8079` if the port is busy). Without a catalogue the launcher's preflight stops with "Historical dataset is incomplete". The schema is described in [docs/data/catalog-contract.md](docs/data/catalog-contract.md). The optional GRF worker needs a separately built native runtime (`TIMEPITCH_GRF_PYTHON`, `TIMEPITCH_GRF_NATIVE_DIR`); the optional local AI needs Foundry Local and a prepared model (`-EnableLocalAI`). The launcher never installs software or downloads weights.

### Tests

```powershell
& .\backend\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd --prefix web exec tsc -- -b
npm.cmd --prefix web test
npm.cmd --prefix web run build
```

Tests that need non-distributed inputs (the catalogue, research captures, private recordings, native engine builds) are **skipped with the reason "private dataset not distributed"** when those inputs are absent. Browser tests (`npm.cmd --prefix web run test:e2e`, Microsoft Edge) need the full application.

## Data, licences and attribution

- **TimePitch code:** GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
- **Match events:** StatsBomb Open Data, © StatsBomb / Hudl. Not redistributed here; the demo serves them with StatsBomb attribution and logo.
- **Historical statistics:** epldata, Fantasy Premier League history (vaastav), football-data.co.uk, footballcsv and Transfermarkt-derived squads. Not redistributed here.
- **Player cards:** Wikidata (CC0) and English Wikipedia season articles (CC BY-SA 4.0).
- **Club crests:** trademarks of their clubs, shown for identification only. Sources: Historical Football Kits (non-commercial use with acknowledgement) and Wikipedia file pages (mostly non-free logos under fair use). No endorsement is implied.
- **Kits:** colours from the kit templates of English Wikipedia season articles (CC BY-SA 4.0), drawn procedurally by TimePitch.
- **Engines:** Google Research Football (Apache-2.0 / The Unlicense) and TouchLines (AGPL-3.0-or-later, source included in `engines/touchlines/`) run live; open-football (Apache-2.0) was used for recordings. Modifications are described in NOTICE.
- **3D players:** Universal Base Characters and Universal Animation Library by Quaternius (CC0 1.0).
- **Libraries:** Three.js, React, FastAPI and others, listed in [THIRD_PARTY.md](THIRD_PARTY.md).
- **Inspiration:** the user flow was inspired by *Historic Matchup Simulator* (Amy Marks, Google Cloud × MLB hackathon 2025). No code from that project is included.

Player and club names are used factually. TimePitch is an independent fan project and is not affiliated with the Premier League, any club, StatsBomb / Hudl, Google or the engine authors.

## Limitations

- External-engine matches, live or recorded, are **synthetic and cross-era**: only a few attributes are transferred and tactics are not mapped. TouchLines plays arcade-style halves of 150 real seconds and shoots little. Their statistics are simulated measurements. Some engines do not record cards, passes or shot outcomes; those figures are shown as not recorded.
- Starting XIs in simulation are chosen by the user or automatically; exact historical line-ups are only shown in Reconstruction. Player identities are never merged across sources by name.
- Ratings are estimates with uneven coverage across eras; older seasons have less individual data. No probability calibration: simulated scores are plausible outcomes, not forecasts.
- Reconstruction covers 2015/16 and Arsenal 2003/04 only, and its movement between events is synthetic.
- The public demo runs on Azure Container Apps with rate limits (and a mirror on a home server) and may answer "busy" under load. GRF matches take about 20 seconds to prepare. Live AI reports are capped per session, per IP and per day, and take 30–60 seconds after full time.
- The report verifier checks facts, not nuance: a phrase that misdescribes a correct fact can still pass.

## Credits

- **Ignacio** ([@Bengis](https://github.com/Bengis)): author.
- **Manuel** ([@ManuelAMS](https://github.com/ManuelAMS)): co-author; idea and design of the Retro 16-bit graphics.

Third-party data, engines, libraries and artwork are credited in [THIRD_PARTY.md](THIRD_PARTY.md) and [NOTICE](NOTICE).
