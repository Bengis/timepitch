# TimePitch retro football art prototype

Original vector pixel art created for TimePitch on 2026-10-16. The visual direction uses small football sprites, a following camera, striped turf, pixel lettering and a compact scoreboard/minimap. Kits use red/white and sky blue/white, with two goalkeeper palettes. Faces, hair and animation are generic artistic choices, not player likenesses or historical motion capture.

## Assets

- `football-sprites.svg`: transparent 128 × 504 atlas, integer rectangles and `crispEdges`; 224 cells of 16 × 18 pixels. Editable vector source.
- `retro-preview.png`: 1536 × 1024 example from the recorded Arsenal–City probe, scaled exactly 4× with nearest-neighbour sampling.
- `manifest.json`: source-trace, SVG and video hashes, clip ranges, rendering dimensions and animation provenance.

Atlas columns are eight screen directions: E, SE, S, SW, W, NW, N, NE. Row groups are four palettes: red/white, sky blue/white, amber/dark goalkeeper, purple/light goalkeeper. Each group has seven rows: idle, run-1, run-2, run-3, run-4, kick, celebrate.

```text
cell_x = direction_index * 16
cell_y = (palette_index * 7 + state_index) * 18
foot_anchor = (8, 16)
```

Keep pixel coordinates aligned and scale with nearest-neighbour sampling. Draw a separate ground shadow. The preview adds generic skin/hair variations by slot; the atlas stores one representative appearance. This is an initial visual vocabulary rather than a complete animation set for tackles, dives, injuries or all player attributes.

## Recorded preview

Local video: `.local/retro-visual/arsenal-city-retro.mp4`, H.264, 1536 × 1024, 30 fps, 543 frames / 18.1 seconds, silent. Two excerpts from [the catalogue adapter probe](../../../docs/research/timepitch/2026-10-16-grf-catalogue-adapter-probe.md): steps 1370–1445 and 2290–2380, covering the two score changes. Each observation interval is shown over three frames; two short holds separate the clips. The HUD shows engine steps, preserving the probe's clock limitation.

The camera, legs, kick pose and goal celebration are display effects inferred from position differences, native ball contacts and score changes. Ball height controls its screen lift above the ground shadow. These animations do not provide new simulation events or alter the captured positions, ownership or score. The temporary renderer exports sprites from the same drawing definitions used in the video; it does not load the SVG back into the TimePitch application.

The original 2D preview renders at 384 × 256 and scales 4×. It follows the recorded ball, depth-sorts sprites and shows all 22 entities on the minimap. Its source match remains a separate GRF research probe.

The web replay now loads this SVG atlas directly through Vite, with follow-play and full-pitch cameras, existing playback controls and player inspection. This presentation change applies to current TimePitch V1/V2 replays; GRF engine integration remains separate. See [TP018](../../../docs/cases/case_TP018_retro_replay_2026-10-16_01.md).

## Verification

All 543 encoded frames decoded successfully at the expected dimensions. Six moments were visually inspected across approach, shot and goal states. The PNG is exactly nearest-neighbour 4×; the SVG parses with all 9,876 integer rectangles inside its atlas bounds. The recorded input trace hash remained unchanged. Disposable renderer, encoding log and inspection sheets were removed after review; editable assets, provenance and the local video remain.
