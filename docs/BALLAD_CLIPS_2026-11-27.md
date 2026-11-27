# Two ballad projects — 2026-11-27

მომზადებულია ორი MusicToVideo პროექტი: 53 მოკლე კადრი, წვიმა, პიანინო, ცისფერი-ნაცრისფერი და თბილი ნათურა. პერსონაჟი მხოლოდ ერთი ანონიმური სრულწლოვანია, ზურგიდან; სახე და ტექსტი არ ჩანს. საბოლოო ვიდეოები ჯერ მზად არ არის. სტროფების დროები წინასწარია და სიმღერასთან შემოწმება სჭირდება.

## Projects

| Song | Job | Folder under `D:/Prog/MusicToVideo/Library/outputs/clips/` | Source duration | Shots |
| --- | --- | --- | ---: | ---: |
| როცა ძალიან მოგენატრები | `b127a001` | `rotsa_dzalian_mogenatrebi__b127a001` | 187.439979 s | 25 |
| ხეივანთან ჩავიარე | `b127a002` | `kheivantan_chaviare__b127a002` | 219.919979 s | 28 |

Both have `project.json`, `lyrics.txt`, `image_queue.zip` and its engine guard marker, `stills/prompts.txt`, `stills/meta.json`, `stills/build_settings.json`, `verification.json` and `gpu_preflight.json`. Native jobs are in `Library/outputs/jobs/<job>.json`; matching audio copies are in `Library/uploads/<job>_audio.mp3`. All 20 installed source files were new destinations, with refusal on existing files and SHA-256 verification after copying.

Sources are exactly the two MP3 paths in the task. Both fully decode. SHA-256:

- როცა ძალიან მოგენატრები: `b7ae6fefdfab25d8997c297397760900cd3cba67a5e3373ec95979287448d749`.
- ხეივანთან ჩავიარე: `ce37f474c7a6868fe77547b15f748541c35ec78f91a23f8688cfe62fa0b7a74e`.

Lyrics come from the existing `Library/lyrics_bank/0061_…txt` and `0059_…txt`, respectively, without fetching Suno. Their 20 and 32 nonempty lines define five and six narrative scenes. The first follows longing, the peach-tree path and spring, morning solitude and the final repeated lines. The second follows the rose alley, moon, distant house, wet stone path and repeated question. Rain, piano and warm lamps connect the scenes; no second character or literal face closeup is requested.

**Timing remains review material.** The initial lyric-line-count allocation was refined using recognizable Georgian stanza anchors from cached Whisper large-v3 on CPU. Internal cuts use CPU-detected beats. The opening, vocal tails and instrumental spans still need listening review; no word-level alignment is claimed. Shots cover the complete source without gaps or overlaps; maximum lengths after refinement are 9.659501 and 8.986122 seconds. Both native jobs pass the installed `_load_jobs` loader and retain `ltx23`; queue ZIPs pass integrity, task-count and 1280×704 checks.

## Generation and export

Use LTX-2.3 (`ltx2_22B_distilled_1_1`, eight steps, native 1280×704/24 fps); `wan22` remains the alternate. Keyframes use the installed Z-Image Base model at its configured 30 steps/CFG 4. No Georgian dress LoRA or culture injection. Each prompt contains one primary action, calm-camera and anti-morph instructions, and at most one anonymous adult seen from behind.

Final targets, not yet completed:

- `D:/Prog/MusicToVideo/Library/outputs/final/rotsa_dzalian_mogenatrebi_FHD.mp4`
- `D:/Prog/MusicToVideo/Library/outputs/final/kheivantan_chaviare_FHD.mp4`

The export contract is H.264, 1920×1080, 30 fps, using `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30`. This is an upscale of native generated video. Fit every clip to its reviewed timing, concatenate without overlaps, discard generated audio and stream-copy the original MP3. Verify full decode, duration, dimensions and original audio-packet identity before marking final outputs complete. The generic assemble button does not automatically enforce this FHD contract.

## Runtime checkpoint

Pinokio `pterm search MusicToVideo` returned zero matches in balanced and broad modes. The already-running MusicToVideo API at `127.0.0.1:8000` was reachable, with no busy jobs or active Wan runs. No app restart was needed. Its GPU status endpoint has a Windows `[N/A]` process-memory parsing error, but direct `nvidia-smi` utilization readings and the installed engine guard work. Thirteen samples over 60.594 seconds were all 0%/0 MiB.

Started the first image queue through the existing `/montage/autorun` route with its engine guard sidecar. Run `cefc6a02` began at 17:56:23 +04; the installed runtime is WanGP v20.00. It has loaded the existing Z-Image Base weights and generated its first keyframes. The first two were inspected: rain, piano/lamp and peach-tree path, anonymous back views, no visible face or text. The Base run was cancelled after 11 images when contact-sheet review found an unwanted person standing in the spring. The rejected image was retained. Tightened scenery-only prompts and a three-frame Z-Image Turbo probe passed review; run fd4e9214 completed all three. Run 3ec9bdf2 then completed 40 remaining keyframes in 398 seconds. Two piano images with outdoor settings were retained and replaced by explicit interiors in run a1512cba (2/2, 39 seconds). All 53 final 1280×704 JPEGs fully decode and passed contact-sheet review, including individual review of corrections. Per-project keyframe_verification.json records hashes; keyframe_review.jpg shows the final sequence.

Cached Whisper large-v3 is also being used on CPU with four threads to improve the stanza timings. The speech-VAD pass produced only one fragment for the first song and zero segments for the second. The retry disabled VAD and produced recognizable Georgian lyric timestamps. The first song completed in 220.11 seconds. The second captured the required stanza anchors through 177 seconds, then made no progress for several minutes on the tail; only that CPU analysis process was stopped and its partial evidence retained. Neither pass is treated as owner-approved alignment.

The runtime restores newly added folders without restarting, but this disk-restoration route omits the job's engine value. Keep `stills/build_settings.json`; do not approve the restored job into a default-engine queue. The app's montage builder also lacks the requested LTX-2.3 profile. Current config routes only `ltx2_25`/H3 prefixes to Maestro, whereas the requested `ltx2_22B_distilled_1_1` weights are installed in Maestro, not Wan's checkpoint directories. No model download or manual installed-configuration edits were made. The project-local executor adds the LTX-2.3 routing prefix only to its in-memory config object, uses the installed engine-switch writer and guard, and skips existing clips only after complete decode.

Two calibration attempts exposed a CLI migration: without `settings_version`, legacy conversion strips explicit sliding-window fields and falls back to 129 frames. Their settings/logs are retained under `window129_attempt/` and `window241_unversioned_attempt/`; only the verified calibration process trees were stopped. The helper now reads the installed Maestro schema version (2.58), supplies a 241-frame window, overlap 9 and discard 0, and gives each shot a distinct seed. The installed LTX handler declares 241 as its native window default. The corrected CLI dry-run passed 25/25 tasks; evidence is in `dryrun_validation/`. Runtime confirms single-window generation at the planned durations.

First-song run `6b6a88b9` is in progress. The first two clips fully decode at 1280×704/24 fps, with durations 9.208333 and 9.541667 seconds. Opening/midpoint/ending frames retain the anonymous back views, rain, piano and walking composition without visible face or text. The first task took 242.1 seconds including model startup. Remaining video generation, visual review and FHD verification are pending. Render/export helpers are saved under each project's `tools/` folder. The export helper fits cumulative frame counts to the full song, uses CPU H.264 encoding, copies original MP3 packets and verifies their SHA-256 after muxing.

Repository validation: `pnpm typecheck`, all 456 tests and `pnpm build` pass. Test/build retried with normal subprocess access after sandbox `spawn EPERM`. No application code or configuration changes.
