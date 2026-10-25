# TouchLines engine (AGPL-3.0-or-later)

TimePitch's "Play match" can run [TouchLines](https://github.com/brenosss/touchlines) (upstream commit
`5c5c71a8a2fb9a02591445cf9114229a4b218253`), an arcade football simulation licensed **AGPL-3.0-or-later** (see
`LICENSE`). Because TimePitch offers it to users over the network, the complete corresponding source of what runs is
here, and TimePitch itself is published under the AGPL (decision of the project owner, 22 Oct 2026, case TP189).

| Path | What it is |
| --- | --- |
| `upstream/src/**` | The 39 upstream files the engine bundle includes, unmodified. |
| `harness/` | TimePitch's free-play harness: reads a TimePitch line-up, seeds `Math.random`, runs the engine headless and writes a recording (`freeplay.ts`, `seed.ts`), plus calibration hooks (`calibration.ts`) and the rolldown config that routes four upstream expressions through them at bundle time (`rolldown.calibrated.config.mjs`). |
| `build/freeplay-calibrated.mjs` | That bundle as built on 2026-10-22 (SHA-256 `702b4754…`), used for the physical-clock demo recordings. |
| `make_native.py` | Rewrites five exact strings of the calibrated bundle to restore the upstream clock (TIME_SCALE 18, halves of 150 real seconds), let halves end and keep the match clock on every sample. |
| `build/freeplay-native.mjs` | Its output (SHA-256 `b01720c9…`), the bundle TimePitch runs live. |
| `cal-native.json` | Calibration values that reproduce upstream behaviour (no speed governor, upstream shooting and conversion). |

Rebuild the native bundle from the calibrated one:

```bash
python engines/touchlines/make_native.py
```

Rebuilding the calibrated bundle needs the upstream checkout and rolldown (`rolldown -c harness/rolldown.calibrated.config.mjs`
with `upstream/` next to `harness/`).

Movement and events are synthetic engine output, not tracking or historical data. Player attributes are estimated from
the TimePitch catalogue (`harness/freeplay.ts`, `estimateStats`).
