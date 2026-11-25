# პირველი თოვლი — პროექტის მომზადება, 2026-11-25

მზადაა ექვსსცენიანი MusicToVideo პროექტი: 18 მოკლე კადრი, ღამის ლურჯი და თბილი ოქროსფერი, თოვლი, ნელი კამერა. რეალური სახეები არ გამოიყენება. არჩეულია LTX-2.3; საბოლოო მიზანია 1920×1080. რენდერი და ატვირთვა ჯერ არ შესრულებულა.

## Local project

- Job ID: `f1751125`; title: `პირველი თოვლი`.
- Project folder: `D:\Prog\MusicToVideo\Library\outputs\clips\pirveli_tovli__f1751125\`.
- `project.json`: full six-scene descriptions, English per-shot prompts, lyric excerpts, CPU-detected beats, engine choice, timing and final export specification.
- `image_queue.zip`: 18 keyframe tasks, built by the installed MusicToVideo queue builder. Uses the existing configured Z-Image Base model at 1280×704 with its configured 30 steps/CFG 4; Georgian dress LoRA and cultural prompt injection are disabled for this project only.
- `stills/prompts.txt`, `stills/meta.json`, `stills/build_settings.json`: existing MusicToVideo prompt/timing/build formats; selected engine is `ltx23`.
- Native saved job: `Library\outputs\jobs\f1751125.json`. The installed `_load_jobs` function successfully loads the prepared job and preserves the engine and all 18 prompts.
- Audio working copy: `Library\uploads\f1751125_audio.mp3`; SHA-256 matches the original. The source is untouched.
- `verification.json`: original ffprobe details, source decode and copy-hash evidence.

These are new project files; installation refused pre-existing destinations and verified every copied file's hash. No existing project was replaced. A staging copy remains in ignored `site\tmp\winter_20261125\`.

## Timing and style

| Scene | Time | Content |
| --- | --- | --- |
| 1 | 0–20 s | First flakes in a lamplit town; anonymous adult couple at a window |
| 2 | 20–45 s | Snow curtain hides the world; only two silhouettes remain |
| 3 | 45–65 s | Candle, warm room, frosted window and white moon |
| 4 | 65–85 s | Windblown snow, then swans on a moonlit lake |
| 5 | 85–110 s | Crystal theatre and fictional adult dancer, face hidden |
| 6 | 110–132.36 s | Snowy courtyard, wedding bells, final warm window |

Claude's six scene boundaries are preserved. The actual source is **132.36 seconds**, MP3, 48 kHz stereo; the last scene includes the extra 0.36-second tail. Internal shot boundaries use CPU librosa beat estimates, approximately 161.50 BPM; musical suitability still needs listening review. All 18 shots are contiguous, cover the full source and are at most **8.986122 seconds**. Lyric snippets identify scenes; they are not a claimed word-level alignment.

Each prompt has one primary action, steady-camera language and the shared midnight-blue/gold visual style. People are fictional distant adult silhouettes or seen from behind, with faces hidden. The snow/swan metaphor is separated into shots to avoid asking the model to morph snow into an animal.

## Generation and export contract

Use the existing engine switch: LTX-2.3 (`ltx2_22B_distilled_1_1`, 1280×704, 24 fps, 8 steps), alternate `wan22`. Generate and review a start keyframe for every shot before building the video queue; do not skip missing keyframes into text-to-video mode. No fabricated start-image paths or runnable video tasks with missing references were created.

Requested final output:

`D:\Prog\MusicToVideo\Library\outputs\final\pirveli_tovli_FHD.mp4`

The project records a 1920×1080, 30 fps H.264 export with `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30`. This fills 16:9 without black bars, cropping approximately 1.85% vertically from native LTX. It is an upscale of native generated video. Fit each clip to its planned shot duration before concatenation, with zero overlap, so the six scene boundaries stay fixed. Discard generated audio and stream-copy the original MP3. Check final dimensions, full decode, duration and original audio-packet hashes before calling the output complete.

`project.json`'s final output and timing fields are preparation metadata. The stock image-approval route builds the LTX video queue, but its generic assemble route does not automatically enforce this project's output filename/1080p contract; the final export remains a separate step to verify.

## Resume

**Blocked before inference.** Pinokio discovery timed out at `192.168.100.5:42000`; loopback port 42000 refused connections. As a fallback, launched the existing MusicToVideo `main.py` hidden with its documented shared interpreter. Its own loader restored the winter job, but port 8000 remained unreachable after more than 180 seconds. Stopped only this run's confirmed MusicToVideo process (child 30792, launcher 19840). No WanGP/Maestro process or generation task was started.

The server's existing startup code automatically created `_backups/library_index.2026-11-25.json`, normalized **6,283** local index categories and updated **48,887** local path records (0 new records; 12,550 missing-file records retained). This was application startup maintenance, not a manual catalog edit. Its log also reports automatic background tagging enabled. Ollama `llama-server.exe` PID 30796 subsequently appeared on the GPU; a 60.82-second observation included **71% and 87% GPU utilization**, failing the below-10%-for-60-seconds gate. Ollama and the owner's other processes were left alone. Final sample after stopping our unsuccessful launcher: 0% utilization, 524 MiB used. No claim that the GPU was continuously free is made.

For the owner, once the GPU is idle and the normal MusicToVideo launcher finishes startup:

1. Open `http://127.0.0.1:8000/frames?job=f1751125`. The saved job already contains the prompts and LTX engine choice; do not create a second `/generate` job, which would invent a fresh scene plan.
2. For each of the 18 empty cards press **⟳ ხელახლა**, then the bottom **⟳ მონიშნულების ხელახლა (18)** button to generate keyframes. This is the existing regeneration route; the prebuilt `image_queue.zip` is also available through **⬇ სურათების queue**. Recheck the GPU gate first.
3. Review all keyframes for faces, palette and composition; press **📥 სურათების შეგროვება** if needed. After all 18 are acceptable, press **✓ დამტკიცება და ვიდეოზე გადასვლა** to build the LTX video queue. Do not use **✕ გამოტოვება** for missing frames. Building this queue does not by itself complete the final FHD export.
4. The next Codex continuation should run the resulting queue using the existing launcher/API, fit the clips to the project timings and export/verify the exact FHD output specified above. No keyframes, video queue, generated clips or final MP4 exist yet. Runtime readiness and final render verification remain pending.

Logs and runtime checkpoint evidence are retained with the local project; the preparation scripts are only in ignored `site\tmp`. No application code/configuration, Maestro/WanGP files, production database rows, portfolio/covers or OneDrive checkout were edited. No upload or publishing action was run.

Repository validation: `pnpm typecheck`, `pnpm test` (456 tests) and `pnpm build` pass. PowerShell's unsigned `pnpm.ps1` was avoided using `pnpm.cmd`; test/build needed the normal unsandboxed subprocess retry after Vite reported `spawn EPERM`. Project validation also passes native-job loading, queue ZIP integrity, unique keyframe task tags, six scene boundaries, 18 contiguous shots, duration coverage and matching source-copy SHA-256.
