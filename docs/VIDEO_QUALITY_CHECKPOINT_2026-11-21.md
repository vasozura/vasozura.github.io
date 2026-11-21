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

## Wan2GP-only continuation - 2026-11-21 21:51-21:54 +04

The owner's 21:49 decision supersedes the ComfyUI repair plan above: stay on the laptop, use the existing Wan2GP, and do not update/reinstall its code. This run inspected its installed files read-only and made no launcher, package, model, configuration, or process changes.

Pinokio search/status identifies local `D:\pinokio\api\wan.git` as Wan2GP, currently offline. Installed app revision: `bd1ff5903cbc18b46c3cce3b75bd140870b536a2`. The launcher starts `wgp.py --multiple-images --advanced` through its managed venv. Do not replace that launcher with another installation.

GPU gate blocked launch/inference at both 21:51:09 and 21:51:57: 194 MiB / 12,227 MiB, 0% utilization, but CUDA Python PID 24268 remains listed. Read-only process inspection reports `python.exe` with command line `"D:\pinokio\bin\miniconda\python.exe" main.py`; its working directory and exact application identity were not established. Low utilization does not satisfy the task's explicit no-Python-process gate. No process was stopped. Leave GPU work for the next scheduled run unless a later gate clears.

Read-only resume findings from the installed app:

- `docs/TEMPORAL_UPSAMPLERS.md`: RIFE uses `rife*2`, returning twice the source fps (16 to 32).
- `docs/SPATIAL_UPSAMPLERS.md`: native late postprocessing includes SeedVR2 3B (`seedvr2`), 7B (`seedvr2_7b`), FlashVSR v1.1 (`flashvsr`) and FlashVSR+ Turbo (`flashvsrplus`), including two-pass variants. The docs default SeedVR2 to 3B. These are installed-source capabilities, not verified runtime/model readiness or measured quality rankings.
- `docs/API.md`, Image And Video Postprocessing: supported `submit_media_postprocessing` accepts `temporal_upsampling` and `spatial_upsampling`; late tasks use `mode=edit_postprocessing` and `video_source`. The Post Processing tab supports existing media. The WebUI can expose an MCP API, off by default; its queue is scoped to that WebUI. Do not assume an endpoint or start a second standalone runtime. After the gate clears, launch through pterm, inspect the live API/processor discovery and owner's queue before submitting anything.
- Preferred comparison candidates, subject to runtime availability and 12 GB fit: B = RIFE x2 plus SeedVR2 3B; C = RIFE x2 plus FlashVSR (Turbo if available). Confirm tiling/offload in the live interface. Use CPU FFmpeg afterward for exact 1920x1080/30 fps and A|B|C labels; preserve full duration. No method can yet be called best by observed quality.

The latest owner scope targets the three `inputs_aafc6412` files (t40s/t125s/t210s) first. Their A previews already pass decode; no duplicate baseline rendering was needed. B/C, side-by-sides, inference seconds and peak VRAM are still pending. Original market inputs and historical c1db233c outputs remain preserved. No application code changed, so pnpm code-change gates do not apply. Next run: recheck GPU, then use Wan2GP only; do not resume the obsolete ComfyUI dependency repair.

## Updated GPU gate and Wan2GP launch - 2026-11-21 22:02 +04

The owner's revised utilization gate supersedes the no-Python gate above. Thirteen nvidia-smi samples at approximately five-second intervals, 21:55:10.516 through 21:56:12.039 +04, all showed 0% utilization. Initial memory use was 194 MiB. Elevated read-only process/socket inspection identified PID 24268 as `python.exe main.py` listening on 127.0.0.1:8188, matching the earlier launcher-started ComfyUI. Stopped only that process under the owner's explicit instruction. The final sample showed 0 MiB and no compute process.

Launched the existing Wan2GP through `pterm run` and its existing `start.js`; no launcher/code/package/configuration edits or second runtime. Startup identifies WanGP v19.14 and loads the existing FlashVSR extension. The log reports the UI at http://127.0.0.1:42003; GET /config and /openapi.json succeed, and the Gradio client can discover its API. Pinokio nevertheless continues to report `ready=false`, `probe=false`, `state=starting`; this readiness discrepancy remains unresolved. At 22:01:34, GPU utilization was 0%, memory 200 MiB. Wan2GP is left running.

Concrete execution blocker: a non-submitting Gradio call to `/handle_queue_action` with an empty action failed with `gradio_client.exceptions.AppError: The upstream Gradio app has raised an exception but has not enabled verbose error reporting. To enable, set show_error=True in launch().` No diagnostic security/configuration change was made. The installed docs describe WebUI MCP as off by default; startup did not advertise an MCP address. No MCP service was enabled.

The UI fallback also failed: creating an in-app browser tab returned `The browser access host is unavailable`. Native Computer Use returned `Computer Use was not approved to use Google Chrome` and `Computer Use was not approved to use Pinokio`. No UI input was sent, no postprocessing task was queued, and no inference/model download was requested. These are tool access denials, not an auto-review rejection of a git or shell operation.

Task remains [~]. Resume by restoring approved browser/Pinokio UI access or a working supported Wan2GP API; check the owner's live queue and repeat the GPU gate, then run RIFE + SeedVR2 3B / FlashVSR on the three aafc6412 cuts and produce the labeled comparisons with timing/VRAM evidence. External report.md is updated; raw Gradio discovery is local-only because it includes unrelated saved UI inputs. No production data, portfolio, covers or publication changes. No application code changed; pnpm typecheck/test/build were not required for this documentation-only checkpoint.
