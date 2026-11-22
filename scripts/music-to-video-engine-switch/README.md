# MusicToVideo engine switch

Reviewable source package for the local program in `D:\Prog\MusicToVideo\Program`.
`engine-switch.patch` contains the six existing-file changes; `engine_selection.py`
is the new module. The installer validates all source hashes before writing and
keeps originals in `Program\_engine_switch_backup_20261122`.

The generation page and Clip Designer offer Wan 2.2 at 832×480 and LTX-2.3
Distilled 1.1 through Maestro at 1280×704/24 fps/eight steps. MiniMax H3 is a
disabled future option. Both pages remember the last choice. Jobs and saved
build settings retain the chosen engine for regeneration.

Shots are split on song beats before keyframe generation, with a ten-second
limit. Clip Designer splits its timeline before vocal analysis. Every video
shot requires a start keyframe; supplied end keyframes are retained. LTX
keyframes are padded to the requested canvas so source aspect ratio cannot
silently change the generated resolution. Maestro receives one settings JSON
per shot and a JSON manifest through its documented `wgp.py --process` CLI.

New engine queues require GPU utilization below 10% for sixty seconds and no
existing GPU runtime before launch. An external process using the GPU above
50% interrupts only this job's process tree. Installed WanGP/Maestro code and
settings remain intact.

Final assembly copies the original audio stream and discards generated audio.
MP3 stays in MP4; PCM WAV uses MOV to preserve the stream. Engine-generated
Designer timelines use the original song rather than the edited guide track.
Finished-video listing, playback, and thumbnails support those MOV exports.

## Local verification

Use the existing MusicToVideo Python environment:

```powershell
D:\Prog\_venv\Scripts\python.exe scripts/music-to-video-engine-switch/install.py
D:\Prog\_venv\Scripts\python.exe scripts/music-to-video-engine-switch/test_engine_selection.py
node scripts/music-to-video-engine-switch/test_ui.mjs
```

The installer defaults to validation and skips matching installed files. Add
`--apply` to install a matching original snapshot. It aborts when files have
changed since review. The Python suite covers beat splitting, keyframe and
engine validation, real queue generation/routing, regeneration after restoring
saved settings, GPU gating/interruption, and MP3/WAV packet preservation with
different generated audio in the video input. HTML checks cover JavaScript
syntax and shared engine preference behavior.

The GPU comparison evidence and final measurements are recorded in
`D:\Prog\MusicToVideo\Library\_agent\upscale_test\engine_test.md`.
