# MusicToVideo engine switch and three-shot test — 2026-11-22

Implemented locally and reloaded successfully. Source checkpoints: `ca8abf5` and `33c1ec5`.
The reviewed source package and guarded installer are in `scripts/music-to-video-engine-switch/`.

## Measured results

Hardware reported by nvidia-smi: NVIDIA GeForce RTX 5070 Ti Laptop GPU, 12,227 MiB, driver 621.14.
Three nominal five-second shots from “ან კი რად მოვიწყინო” were generated sequentially in each engine.
Every run passed thirteen GPU samples over at least sixty seconds below 10% utilization, with no pre-existing GPU runtime.
A monitor stopped only our job if a different GPU process appeared while utilization exceeded 50%; no such interruption occurred.

| Shot / action | Wan 2.2 seconds | Wan peak MiB | LTX-2.3 seconds | LTX peak MiB |
| --- | ---: | ---: | ---: | ---: |
| 1: Guitarist gently strums | 279.890 | 3590 | 162.375 | 4292 |
| 2: Woman holds umbrella in rain | 244.438 | 3590 | 117.500 | 2394 |
| 3: Leaves drift past empty bench | 273.781 | 3590 | 117.922 | 2668 |

Whole-process wall time: Wan **825.469 s**; LTX **425.781 s**. LTX was 1.94× faster for this input/settings combination.
Maximum sampled driver-reported VRAM: Wan **3590 MiB**, LTX **4292 MiB**.
VRAM was sampled about once per second, so these are sampled peaks rather than exact allocator high-water marks.
Per-shot time starts at the CLI Task banner; the first shot includes model loading. Process totals also include interpreter startup and shutdown. Idle preflight time is excluded.

Wan model: `i2v_2_2_Enhanced_Lightning_v2_svi2pro`, eight steps, 832×480, 16 fps.
LTX model: `ltx2_22B_distilled_1_1`, eight requested steps plus the installed pipeline’s three-step second pass, 1280×704, 24 fps.
The existing program default was VACE/FusioniX; the named Wan 2.2 choice now selects the actual installed Wan 2.2 model explicitly.

All six final benchmark outputs pass complete FFmpeg decode. Wan clips are 5.0625 s. LTX video streams are 4.958333 / 4.875 / 4.875 s; its raw generated audio streams are 5.01 s. These durations reflect the installed models’ frame grids, not a full-song edit.

## Files

### Wan 2.2

- Shot 1: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_probe_20261122\wan_outputs\mvaenginetest_c000.mp4`
- Shot 2: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_probe_20261122\wan_outputs\mvaenginetest_c001.mp4`
- Shot 3: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_probe_20261122\wan_outputs\mvaenginetest_c002.mp4`

Telemetry: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_probe_20261122\wan-benchmark.json`.
CLI log: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_probe_20261122\wan-generation.log`.
Settings manifest: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_probe_20261122\wan_three_shots.json`.

### LTX-2.3

- Shot 1: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_native_20261122\ltx_outputs\engine_ltx_c000.mp4`
- Shot 2: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_native_20261122\ltx_outputs\engine_ltx_c001.mp4`
- Shot 3: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_native_20261122\ltx_outputs\engine_ltx_c002.mp4`

Telemetry: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_native_20261122\ltx-benchmark.json`.
CLI log: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_native_20261122\ltx-generation.log`.
Settings manifest: `D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_native_20261122\ltx_three_shots.json`.

Each output also has a JPG showing its 2.5-second frame. Full-decode/probe records are `wan_outputs-verification.json` and `ltx_outputs-verification.json` beside the telemetry.

## Visual limitations

References were extracted from the owner-selected aafc6412 song render at approximately 40, 125 and 210 seconds (the second reference uses the 2.5-second point of its supplied cut). The source contains persistent guitarist overlays/double exposures; these are already present in the reference PNGs.
Inspection of the output midpoint frames shows that both engines reinterpret the third composite park/bench reference as an indoor guitarist/stage scene. The requested empty-bench action is not preserved in that case. This is a failed scene-fidelity example, not an approved release or an identity-quality verdict. Clean keyframes and the already-assigned follow-timeline/control-video task are needed before relying on those source composites.

## Application behavior and verification

The engine control is served at `http://127.0.0.1:8000/studio` and `/designer`. Both returned HTTP 200 after an idle server reload. The new split endpoint is in OpenAPI; an unsupported H3 request returns HTTP 400 before any upload or generation. The local server is left running.
The last engine choice is shared through browser storage. Jobs and saved build settings preserve it through regeneration. H3 remains disabled for later work.
Shots split on song beats to at most ten seconds before keyframes/generation. Start keyframes are required, end keyframes are included when available, and generated prompts receive a one-action/calm-camera instruction. LTX keyframes are padded to 1280×704 before inference so source aspect ratio cannot silently reduce the generated width.
Raw LTX diagnostic clips contain generated AAC audio. Final application assembly maps only their video and stream-copies the original song audio. Different generated/input tones in the regression fixture prove MP3 and WAV audio-packet hashes are preserved. MP3 exports remain MP4; PCM WAV exports use MOV, including history/playback/thumbnail routes. Engine-generated Designer timelines use the original song rather than an edited guide track.
Seven Python regression tests and both HTML syntax/preference checks pass. `pnpm typecheck`, all 456 repository tests and `pnpm build` pass. The guarded installer verifies all seven installed file hashes with zero pending changes.
Original application files are backed up in `D:\Prog\MusicToVideo\Program\_engine_switch_backup_20261122`. Maestro and WanGP code/settings were not updated or reinstalled. No production database rows, portfolio/covers or OneDrive checkout were changed.

## Runtime integration notes

Use the installed Maestro interpreter `app\env-rtx50\Scripts\python.exe` with `wgp.py --process <settings-or-manifest>.json --output-dir <project>`. Standalone settings JSONs are saved per shot and a JSON list lets one process reuse its loaded model.
This Maestro build requires `force_fps` as the string `"24"`. Its dry run accepts integer 24 but generation then fails in `get_computed_fps` with `TypeError: object of type 'int' has no len()`. Corrected settings rendered successfully.
A calibration pass using unpadded 832×480 references silently produced 1216×704 despite the requested 1280×704 setting. Those calibration assets remain under `engine_probe_20261122/ltx_outputs`; the measured LTX results above use the corrected native-size run under `engine_native_20261122`.
