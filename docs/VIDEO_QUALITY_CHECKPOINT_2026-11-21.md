# Video quality comparison checkpoint — 2026-11-21

The first Codex task remains in progress. Six CPU A baselines now exist in `D:\Prog\MusicToVideo\Library\_agent\upscale_test\`, including the owner's newest c1db233c song inputs clip_0005, clip_0016 and clip_0031. Input files were read-only.

The three added previews use the existing lanczos + hqdn3d + unsharp recipe, CPU libx264 CRF 17/preset slow, two threads, no audio and no hardware decoding. Each output is 1920x1080, 30 fps, 223 frames (7.433333 seconds), and passes full FFmpeg decode. CPU render times: 23.598 / 22.357 / 23.828 seconds. Source metadata, output verification and timings are saved as selection-newest.json, verification-newest.json and baseline-timings.jsonl; report.md contains the combined checkpoint.

The GPU was free at the initial 20:43 +04 check: 0 MiB used, 0% utilization, no GPU processes. The blocker is now Pinokio connectivity: `pterm search ComfyUI` returned `AxiosError: connect ETIMEDOUT 192.168.1.16:42000`, including an unsandboxed retry. Loopback port 42000 refused connections; the configured LAN endpoint timed out. No GPU job, ComfyUI launch or Wan2GP modification occurred.

Next: restore Pinokio control-plane reachability, recheck the shared GPU gate, finish node dependencies/weights through the launcher-managed interface, then render B/C for all six clips with timings/peak VRAM and labeled A | B | C comparisons. No application code or production data changed. Code-change pnpm gates do not apply to this documentation/CPU-media checkpoint.
