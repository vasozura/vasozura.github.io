# Video quality comparison checkpoint — 2026-11-21

The first Codex task remains in progress. Six CPU A baselines now exist in `D:\Prog\MusicToVideo\Library\_agent\upscale_test\`, including the owner's newest c1db233c song inputs clip_0005, clip_0016 and clip_0031. Input files were read-only.

The three added previews use the existing lanczos + hqdn3d + unsharp recipe, CPU libx264 CRF 17/preset slow, two threads, no audio and no hardware decoding. Each output is 1920x1080, 30 fps, 223 frames (7.433333 seconds), and passes full FFmpeg decode. CPU render times: 23.598 / 22.357 / 23.828 seconds. Source metadata, output verification and timings are saved as selection-newest.json, verification-newest.json and baseline-timings.jsonl; report.md contains the combined checkpoint.

The GPU was free at the initial 20:43 +04 check: 0 MiB used, 0% utilization, no GPU processes. The blocker is now Pinokio connectivity: `pterm search ComfyUI` returned `AxiosError: connect ETIMEDOUT 192.168.1.16:42000`, including an unsandboxed retry. Loopback port 42000 refused connections; the configured LAN endpoint timed out. No GPU job, ComfyUI launch or Wan2GP modification occurred.

Next: restore Pinokio control-plane reachability, recheck the shared GPU gate, finish node dependencies/weights through the launcher-managed interface, then render B/C for all six clips with timings/peak VRAM and labeled A | B | C comparisons. No application code or production data changed. Code-change pnpm gates do not apply to this documentation/CPU-media checkpoint.

## Scheduled continuation - 21:27-21:35 +04

Claude's latest owner-selected inputs supersede the c1db233c clips for B/C: `inputs_aafc6412/aafc6412_t40s.mp4`, `aafc6412_t125s.mp4`, `aafc6412_t210s.mp4`. The original three market inputs remain selected. The older three c1db233c A previews are retained as historical outputs.

Created and fully decoded three replacement CPU A previews in the external upscale_test folder. All sources were read-only, 832x480/16 fps/80 frames/5 seconds. All outputs are 1920x1080/30 fps/150 frames/5 seconds, silent H.264, using the same CPU baseline recipe. Wall times: t40s 16.461 s, t125s 21.079 s, t210s 17.098 s. See external `verification-aafc6412.json` and `report.md`. There are nine historical A files and six currently selected A previews.

Pinokio is reachable again. GPU checks before launcher starts were clear (0 MiB, no GPU processes). ComfyUI starts and its API is online; RIFE/FlashVSR/VHS register. Manager's SeedVR2 dependency repair ran at startup but left a package conflict: diffusers 0.41.0 requires huggingface-hub >=1.32.0,<2.0; Transformers 4.57.3 requires >=0.34.0,<1.0; the resulting hub is 0.36.2. SeedVR2 fails to register with `ImportError: cannot import name 'resolve_revision' from 'huggingface_hub'`.

A targeted Manager pip repair request with candidate pins (`diffusers==0.35.1 huggingface-hub==0.36.2`, not installed/validated) was denied: HTTP 403, `{"error":"security_level"}`. Manager reports this requires an administrator-enabled security configuration. No policy change or internal-CLI bypass was attempted. App-specific API notes are saved under `pinokio_agent/skills/api/comfy.git/SKILL.md`. External evidence: `node-status-2026-11-21.json`, `comfyui-startup-2026-11-21.log`.

Task remains [~], blocked on compatible SeedVR2 dependencies and the denied Manager package-repair route. Resolve that installation blocker, verify node registration, then recheck GPU and finish weights/B/C/comparisons for the six current inputs. ComfyUI is left online. No inference job or model-weight download was submitted, and no per-job GPU timings/peaks exist. No application code, Wan2GP, MusicToVideo, production data or publication changed; pnpm code-change gates do not apply to this documentation/media checkpoint.
