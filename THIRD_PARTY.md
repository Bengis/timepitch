# Third-party notices

TimePitch's own code is licensed under the **GNU Affero General Public License v3.0 or later** (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). This file lists the third-party software, data and artwork that TimePitch uses, what is and is not included in this repository, and the attribution each one requires. Listing an item here does not place it under the TimePitch licence.

Licence fields for packages were read from the lockfiles and local package metadata in October 2026.

## 1. Software shipped in the web bundle

These packages are compiled into the browser build.

| Package | Version | Licence | Notice |
| --- | --- | --- | --- |
| three (Three.js) | 0.186.1 | MIT | © 2010-2026 three.js authors. Full text in `web/public/licenses/three.txt`, served with the app |
| react | 19.3.1 | MIT | © Meta Platforms, Inc. and affiliates |
| react-dom | 19.3.1 | MIT | © Meta Platforms, Inc. and affiliates |
| scheduler | 0.28.0 | MIT | © Meta Platforms, Inc. and affiliates (dependency of react-dom) |

## 2. Web development and test tools (not shipped)

Installed from `web/package-lock.json` for building and testing only: TypeScript 5.9.3 (Apache-2.0), Vite 8.3.4 (MIT), Vitest 5.0.5 (MIT), @vitejs/plugin-react 6.1.2 (MIT), Playwright 1.64.1 (Apache-2.0), Testing Library (jest-dom 7.0.1, react 16.3.3, user-event 14.6.8; MIT), jsdom 29.1.1 (MIT), openapi-typescript 7.13.0 (MIT), @types/react, @types/react-dom, @types/three (MIT).

Licence mix of the development packages in the lockfile: mostly MIT, plus MPL-2.0, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, MIT-0, BlueOak-1.0.0, CC0-1.0 and Python-2.0. None of them is shipped to users.

## 3. Backend (Python 3.12, `backend/uv.lock`)

| Package | Version | Licence |
| --- | --- | --- |
| fastapi | 0.143.2 | MIT |
| uvicorn[standard] | 0.54.0 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| jsonschema | ≥ 4.26.0 | MIT |
| openai (Python SDK, client for OpenAI-compatible endpoints: Foundry Local and Azure OpenAI) | 3.31.0 | Apache-2.0 |
| agent-framework-core, agent-framework-openai (Microsoft Agent Framework) | 1.22.0, 1.17.0 | MIT |
| agent-framework-foundry-local (Microsoft Agent Framework) | ≥ 1.0.0b261015 | MIT |
| pytest (dev) | 9.1.1 | MIT |
| httpx2 (dev) | from lockfile | BSD-3-Clause |

Optional groups, installed only where the AI match reports run: `crew` (azure-ai-evaluation 1.18.10, MIT; opentelemetry-sdk 1.45.1, Apache-2.0; azure-monitor-opentelemetry-exporter 1.0.0b58, MIT) and `crew-cloud` (azure-identity 1.26.0, azure-storage-queue 12.18.0, azure-storage-blob 12.31.0; MIT).

Transitive packages (from local metadata): agent-framework-core / -openai (MIT), foundry-local-sdk (MIT), starlette (BSD-3-Clause), pydantic / pydantic-core (MIT), anyio, h11, httptools, jiter, watchfiles, PyYAML, attrs, referencing, rpds-py, jsonschema-specifications, annotated-types, annotated-doc, typing-inspection, truststore, iniconfig, pluggy (MIT); click, httpcore, idna, msgspec, python-dotenv, websockets (BSD-3-Clause); Pygments (BSD-2-Clause); colorama (BSD); packaging (Apache-2.0 OR BSD-2-Clause); opentelemetry-api (Apache-2.0); regex (Apache-2.0 AND CNRI-Python); sniffio (MIT OR Apache-2.0); typing_extensions (PSF-2.0); certifi (MPL-2.0); tqdm (MPL-2.0 AND MIT). `uvloop` (Linux only) is MIT OR Apache-2.0 upstream.

## 4. Match engines

"Play match" runs **Google Research Football** (default) or **TouchLines** live on the demo server; the demo match also plays back recordings made beforehand with all three external engines (stored outside git, served as static files). Modifications made to each engine are described in [NOTICE](NOTICE).

| Engine | Source | Licence | In this repository | Used as |
| --- | --- | --- | --- | --- |
| TimePitch engine | this repository | AGPL-3.0-or-later | Yes | Built-in seeded simulation (fallback when GRF is unavailable) |
| Google Research Football (gfootball) | https://github.com/google-research/football | Python wrapper Apache-2.0 (© Google LLC); native engine based on GameplayFootball, The Unlicense; game assets under their own terms | TimePitch patches only (`backend/native/`); no engine source, binary or asset | Modified native build, live and recordings |
| open-football | https://github.com/ZOXEXIVO/open-football (commit bfb2273) | Apache-2.0 (© ZOXEXIVO and contributors) | No | Modified harness, recordings only |
| TouchLines | https://github.com/brenosss/touchlines (commit 5c5c71a) | AGPL-3.0-or-later (TouchLines authors, brenosss and contributors) | Yes: the 39 upstream source files the bundle uses, the TimePitch harness and the bundles (`engines/touchlines/`, see its README) | Live in "Play match" (upstream clock) and recordings |

## 5. Historical data

**None of the historical datasets is redistributed in this repository.** The public demo serves some of them, with attribution.

| Source | Licence / terms | In this repository? | Served by the public demo? |
| --- | --- | --- | --- |
| **StatsBomb Open Data** (match events: Premier League 2015/16 and Arsenal 2003/04), © StatsBomb / Hudl | StatsBomb Open Data user agreement: free use with attribution and logo; redistribution limited | No | Yes, with "Data: StatsBomb" credit and logo |
| epldata (pssguy/epldata) | Declared MIT; README asks to be contacted for commercial use | No | Yes (catalogue) |
| Fantasy Premier League history (vaastav/Fantasy-Premier-League) | Repository MIT, © 2017-19 Vaastav Anand; the underlying Premier League/FPL data is not licensed by it | No | Yes (catalogue, advanced statistics) |
| football-data.co.uk results | Site terms; redistribution not explicitly granted | No | Yes (catalogue) |
| footballcsv/england (1992/93 results) | CC0-1.0 | No | Yes (catalogue) |
| Squads from Samoilov2004/premier_league_dataset (from Transfermarkt) | The collector's licence does not settle Transfermarkt's rights | No | Yes (catalogue) |

Attribution text used by the app: *"Match event data: StatsBomb Open Data (Hudl). Historical results and statistics: epldata, Fantasy Premier League history (vaastav), football-data.co.uk, footballcsv, Transfermarkt via premier_league_dataset."*

### StatsBomb logo

`web/src/assets/statsbomb.svg` is the StatsBomb logo, a trademark of StatsBomb / Hudl. It is included only because the StatsBomb Open Data agreement asks for the logo to be shown next to analysis that uses their data.

## 6. Player cards (included)

`web/public/data/players/*.json` (four demo team-seasons) and the identifier map `web/src/catalog/player-links.json`:

- **Wikidata** (CC0 1.0): name label, date of birth, height, nationality and positions; each field records its item and revision.
- **English Wikipedia season articles** (CC BY-SA 4.0, Wikipedia contributors): shirt numbers, position codes and nationality flags; each file records the article title and revision. The derived files are released under CC BY-SA 4.0 as well.
- `player-links.json` holds only source identifiers mapped to Wikidata items (no statistics). No Transfermarkt, FPL, epldata or StatsBomb fields are included in the cards.

Players are shown by real name, number, position and statistics with an **original stylised avatar**; there are no photographs.

## 7. Club crests (included)

Crests are trademarks and remain the property of their clubs. They are shown for identification only; TimePitch is not endorsed by any club.

- `web/public/assets/crests/` (130 images), catalogued with source URL, SHA-256 and notes in `web/src/catalog/historical-crests.json`. Main source: **Historical Football Kits** (https://www.historicalkits.co.uk/), whose terms allow non-commercial use with a link and acknowledgement (https://www.historicalkits.co.uk/copyright.htm). Arsenal exceptions use per-file Arsenal/adidas and Wikimedia sources recorded in the same JSON.
- `web/public/assets/crests-hd/` (37 SVG files covering 38 crest eras), catalogued in `web/src/catalog/crests-hd.json` with the Wikipedia file page, original hash and the status copied from each file page: 35 are non-free logos hosted by English Wikipedia under fair use, 3 are public domain (below the threshold of originality). The files were sanitised (no scripts, external references or event handlers) and are served only through `<img>`.

## 8. Kits (included as data)

`web/src/catalog/historical-kits.json` and `web/src/catalog/kits-manual.json` contain season kit **colours** copied from the `{{Football kit}}` templates and infobox parameters of English Wikipedia season articles, by Wikipedia contributors, licensed **CC BY-SA 4.0**. Each entry links the article and revision used. Changes: colours normalised to `#RRGGBB`; missing values kept as null or estimated and labelled as such. These derived files are released under CC BY-SA 4.0. No kit images from Wikimedia Commons are included; kits are drawn procedurally by TimePitch.

## 9. TimePitch artwork

- `assets/art/timepitch-premier.png`: concept art generated for TimePitch with an AI image tool on 15 Oct 2026. It depicts real footballers in a stylised way; it is not a photograph and implies no endorsement.
- `assets/art/retro/**`: original vector pixel art made for TimePitch, covered by the project licence. Used only by the automatic 2D fallback when WebGL is not available.
- **3D players:** `web/public/assets/players/player.glb` and its textures (`player-*.jpg/png`) are trimmed from *Universal Base Characters* (Standard), and `animations.glb` from *Universal Animation Library* (Standard), both by **Quaternius**, **CC0 1.0** (https://quaternius.com/). Licence texts in `web/public/licenses/quaternius.txt`. TimePitch paints the kits, numbers, skin and hair over them at run time.
- **Captain Hane portraits** (`web/public/assets/hane/`): close-ups of the demo players generated with FLUX.2-pro on Azure AI Foundry from avatar traits only (no names, clubs or photographs); `manifest.json` records prompt, seed and review of each image. They are illustrations, not likenesses taken from photographs.
- Avatars, stadium and 3D kit colouring: procedural drawings made by TimePitch, not likenesses taken from photographs.

## 10. AI models (not distributed)

- Qwen2.5-1.5B-Instruct (Alibaba Cloud Qwen team, Apache-2.0), run locally through Microsoft Foundry Local for the optional AI analyst.
- GPT-4.1 mini (Azure OpenAI in Azure AI Foundry) for the optional AI match reports, only where they are configured.
- FLUX.2-pro (Black Forest Labs, through Azure AI Foundry) was used once to generate the Captain Hane portraits; it is not called by the app.

No model weights are included in this repository.

## 11. Acknowledgement (no code included)

*Historic Matchup Simulator* by Amy Marks (Google Cloud × MLB hackathon 2025; code MIT, © 2025 msamylea, https://github.com/msamylea/mlbhackathon) inspired the user flow (pick teams and years → data → match → events → summary). No code, video or images from that project are included.

## 12. Fonts

The interface uses system fonts (Segoe UI, Arial; Bahnschrift / Arial Narrow if installed). No font files are bundled.
