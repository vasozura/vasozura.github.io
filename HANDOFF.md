# Composer Archive handoff

## Purpose and stack

Zura Alexandria Composer Archive is a Georgian/English public music catalog with an owner-only archive, secure media management, score viewing, interactive learning, and an in-progress Vocal/Karaoke study workflow. The frontend is a static TypeScript/Vite application deployed to GitHub Pages. It uses Supabase Auth, Postgres, Storage, and RLS, plus a separately deployed typed Learning API. Rendering/playback uses OpenSheetMusicDisplay, `@tonejs/midi`, Web Audio, and sampled piano/guitar banks.

## Local development

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm preview
pnpm audit:secrets
pnpm verify:karaoke
pnpm verify:karaoke:browser -- --input=tmp\karaoke\song-slug --audio=C:\path\canonical.mp3
pnpm publish:karaoke:dry-run -- --input=tmp\karaoke\song-slug
```

Copy `.env.example` to the ignored `.env.local` and supply only local public frontend configuration. Never commit secrets or run browser code with a service-role key.

Supabase project ID: `kkigxmippwtyufgtroyl`.

## Data and Storage architecture

- Core `public` tables: `songs`, `song_files`, `instrument_parts`, `playlists`, `playlist_items`, and `admin_profiles`.
- Import/provenance tables: `archive_import_batches`, `archive_import_jobs`, and `suno_generations`.
- Learning-facing tables: `learning_exercises`, `learning_attempts`, and per-user `learning_progress`; the production Learning API also owns derived processing data in its `zura` schema.
- Storage buckets: `covers`, `audio`, `midi`, `musicxml`, `scores`, `lyrics`, and `instrument-parts`.
- Public RLS exposes only published catalog records/resources. Authenticated owner/admin policies protect drafts, writes, imports, and archive media. User attempts/progress are isolated by `auth.uid()`.
- Current public catalog count at handoff: **83 songs** (read-only production count on 2026-09-10).

## Completed features

- Responsive dark public catalog, Georgian/English switching, hash routes, SEO/Open Graph assets, accessible navigation, and the persistent audio player.
- Supabase owner login, protected admin routes, draft preview, song/file CRUD, explicit deletion, upload validation, publishing, Storage cleanup, and RLS.
- Verified package/batch importers, checksum-prefixed Storage paths, Suno/YouTube provenance, duplicate protection, and catalog expansion tooling.
- MusicXML rendering, MIDI transport, score navigation/cursor, piano/guitar/accordion visualizers, exercises, attempts/progress, and production Learning API integration with typed contracts and local mocks.
- Learning Melody selection, continuous/active timing transforms, instrument-specific sample routing, chord inference/voicing/patterns, and extensive unit/regression coverage.

## Vocal/Karaoke status

The Karaoke implementation is intentionally a handoff checkpoint, not a completed production release. Source lives in `src/karaoke/`, `scripts/audio-to-vocal-notes.py`, `scripts/prepare-vocal-learning.ts`, and `docs/VOCAL_KARAOKE_PIPELINE.md`; lazy mounting is wired through `src/main.ts` and `src/components/song-detail.ts`.

Implemented: authoritative `song.lyrics`, basic MP3 fallback, cached offline Demucs/librosa analysis, original and continuous Vocal MIDI models, line/word/syllable alignment with melisma, word-anchored chords, MIDI lyric events, LRC/SRT/ASS/TXT generation, Original/Instrumental/Guide controls, Piano/Guitar guide routing, lyric seek, transpose/target-key display, compact three-line viewport, and a session-only timing editor.

Also implemented since the checkpoint: multi-preset FFmpeg rendering for all three declared layouts (16:9, 9:16, 1:1) with per-layout ASS subtitles that scale to the frame, `image` / `cover-blur` / `dark-gradient` backdrops so a song without artwork still renders, an offline guide mix that reproduces the browser guide engine sample-for-sample and is muxed under the instrumental at unity level, and `pnpm verify:karaoke` as a repeatable release gate covering all nine layout/background combinations plus a Goertzel pitch check of the guide. All of it is additive: `karaoke-render.json` and the 16:9 export key keep their previous shape.

Then, in the delivery pass: the manifest gained `melody`, `guide`, `renders`, `provenance` and `timeline`, so a session needs nothing but `manifest.json`; the melody lane is resolved once during preparation against a documented priority (manual, then a high-confidence extraction, then explicit Vocal MIDI, then a review-grade extraction, then inference) and the browser reads that decision instead of making it; `src/karaoke/timeline.ts` is now the single resolver behind the lyric highlight, the Learning Marker and the visualizer, so a seek from any view moves the others; stem separation became optional (`--stems=auto|require|skip`) so a machine with librosa but no Demucs can still prepare a song, at review grade; and `scripts/publish-karaoke-artifacts.ts` plus the `karaoke` bucket migration deliver artifacts and write `learning_mapping.karaokeManifestUrl`. `pnpm verify:karaoke:browser` drives the panel in a real browser. `docs/VOCAL_KARAOKE_PIPELINE.md` documents all of it.

**Live product correction (branch `fix/karaoke-live-product`):** the owner rejected the live page on two counts, both addressed there. Lyric timing is now built from the vocal stem's phrasing rather than from extracted notes - scored against the real `taflis-tvali` recording, the syllable-count-to-onset correlation moves from -0.23 to +0.49 and per-line rate dispersion from 8.1x to 1.5x - and the song page now leads with a full-width Karaoke workstation, with the old static lyrics block collapsed into a "Full lyrics" disclosure below it. `pnpm verify:karaoke:sync` is the acoustic gate; `pnpm verify:karaoke:browser` now renders the real song page and checks 1440/1280/390 layouts.

**A defect worth knowing about:** every MIDI file generated before 2026-09-10 has a malformed `MThd` header — eight data bytes where the format mandates six — so no conforming parser will open it. The writer is fixed and covered by `src/karaoke/midi-file.test.ts`, which parses the generated bytes with `@tonejs/midi` rather than trusting the serializer. **Any MIDI artifact already published must be regenerated.**

Still unfinished: prepare and publish one real archive song end to end (needs the archive MP3, the song row's lyrics and, for verified grade, Demucs on the owner machine), and apply the `karaoke` bucket migration to production. Generated stems, MP3/MIDI/subtitle files, and test videos are ignored and must not be committed.

## Important paths

- App/router: `src/main.ts`
- Public/admin song UI: `src/components/`, `src/data/song-repository.ts`
- Karaoke: `src/karaoke/`
- Learning/score/audio: `src/learning/`, `src/score/`, `src/audio/`
- Importers/preparation: `scripts/import-song.ts`, `scripts/import-batch.ts`, `scripts/prepare-phase6-suno-packages.ts`, `scripts/prepare-vocal-learning.ts`
- Database: `supabase/migrations/`
- Operational docs: `docs/IMPORT_GUIDE.md`, `docs/SONG_PACKAGE_FORMAT.md`, `docs/VOCAL_KARAOKE_PIPELINE.md`

## Known blockers and next task

The `@supabase/supabase-js` 2.112.4 missing-`dist/index.d.mts` blocker did **not** reproduce on 2026-09-10: `pnpm install --frozen-lockfile` succeeded and `pnpm typecheck` was clean. If the error does return, refresh the package store or pin a corrected upstream release before changing app types. Do not add an `any` shim.

Next recommended task, in order: apply `supabase/migrations/202609100001_karaoke_delivery.sql`; run `pnpm prepare:vocal` for one published song into an ignored `tmp/` directory on a machine that has the archive MP3 and Demucs; review the alignment and chords; run `pnpm verify:karaoke:browser` against that directory; then `pnpm publish:karaoke:dry-run`, and finally `pnpm publish:karaoke` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment. Regenerate any MIDI artifact published before the `MThd` fix.

## Portfolio pass (Claude, 2026-11-18) — read before continuing

Deployed to `main` and live on https://zuraalexandria.com (Pages source is now **GitHub Actions**; `CNAME` stays in the repo; Supabase Site URL is `https://zuraalexandria.com/`).

- **Catalog order and de-duplication** come from `public/data/portfolio.json` (`order`: slug → date the song was written, newest first; `hidden`: duplicate takes kept in the database but not listed). `loadPublishedSongPage` now fetches light rows for the whole filtered catalog, applies `orderForPortfolio`, then loads full rows only for the visible page (`src/data/portfolio.ts`, `src/data/song-repository.ts`). Nothing was deleted from the database.
- **Catalog size:** 172 published unique songs. 57 songs were imported as packages from the owner's library (`D:\Prog\MusicToVideo\Library\_agent\site_import`, run by `ATVIRTVA.bat` with the service-role key stored DPAPI-encrypted in `%LOCALAPPDATA%\ZuraSite`) and published; 30 messy titles were cleaned.
- **New sections:** click-to-load YouTube video grid (`src/components/videos.ts`), services (`services.ts`); YouTube links point to the Zura Alexandria channel; hero has Spotify and Apple Music (`links.ts`).
- **Streaming links and covers:** `portfolio.json` → `spotify`, `apple` (release URLs), `covers` (Spotify artwork ids), `artwork` (`/covers/<slug>.webp`, 59 generated covers). Used by `song-card.ts` / `song-detail.ts` via `spotifyUrlFor`, `appleMusicUrlFor`, `releaseCoverFor`.
- A weekly scheduled agent updates only `public/data/portfolio.json` (new songs, links, covers). Code changes go through the owner.
- CI's `pnpm audit --prod` was already failing before this pass (transitive `picomatch` via `opensheetmusicdisplay > gl > node-gyp`); deploys are unaffected.

## Codex local-library integrity pass (2026-11-18)

Completed the first coordinator task in commit `2270856`. A backup-first local transaction reconciled 34 stale SHA-256 records in `D:\ComposerArchive`, refreshed the affected metadata/hash snapshots, and left audit counts at 0 checksum mismatches and 0 missing song-level metadata records. The 10 affected slugs and evidence locations are documented in `docs/LOCAL_LIBRARY_INTEGRITY_2026-11-18.md`. `pnpm typecheck`, all 456 tests, and `pnpm build` pass. Next Codex task on the board is the dated Suno WAV resume on 2026-11-26.

## Codex video quality test preparation (2026-11-21)

Continued the first Codex task only; it remains [~], blocked by the shared GPU (initial 6,280 MiB used, 100% utilization, Python PID 31920; repeat checks still busy). No GPU workload or publication started, and Wan2GP was not changed. Cloned RIFE, SeedVR2 and FlashVSR node sources into the designated Pinokio ComfyUI; dependencies, weights and runtime verification remain pending. Created three CPU libx264 A baselines with the current MusicToVideo FHD filters in `D:\Prog\MusicToVideo\Library\_agent\upscale_test\`, alongside selection.json, baseline-timings.jsonl and report.md. All three decode cleanly and are 1920x1080, 30 fps, 152 frames; render times were 14.662 / 12.330 / 12.500 seconds. Next: recheck nvidia-smi, finish node/model installation when safe, then render B/C with timing/VRAM measurements and labeled comparisons. No application code changed, so pnpm code-change gates were not required.

## Codex newest-clip baselines and runtime blocker (2026-11-21, evening)

Continued only the first Codex task; it remains [~]. Checkpoint commit `e6b32dd` documents three additional CPU A previews for the owner's c1db233c clips 0005/0016/0031, saved only under `D:\Prog\MusicToVideo\Library\_agent\upscale_test\`. All decode cleanly at 1920x1080/30 fps/223 frames; times are 23.598 / 22.357 / 23.828 seconds. Six A previews now exist. The GPU was free at 20:43 +04, but Pinokio discovery failed with `AxiosError: connect ETIMEDOUT 192.168.1.16:42000`, including an unsandboxed retry; loopback port 42000 refused connections. No GPU work, Wan2GP changes, application code or production data changes. Next: restore Pinokio control-plane access, recheck GPU, finish node/model setup and B/C plus comparisons for all six inputs. See `docs/VIDEO_QUALITY_CHECKPOINT_2026-11-21.md`. No code changes, so pnpm typecheck/test/build were not required.

## Codex scheduled video-quality continuation (2026-11-21, 21:35 +04)

Continued only the first [~] Codex task. Pinokio is reachable again; launcher-started ComfyUI is online. GPU checks before launch were clear (0 MiB/no GPU processes). Built the replacement owner-selected aafc6412 t40s/t125s/t210s CPU A previews: all decode cleanly at 1920x1080/30 fps/150 frames/5 seconds; CPU times 16.461 / 21.079 / 17.098 s. Sources were read-only and outputs/evidence are under the external upscale_test folder. Six A previews now match the current selection; three older c1db233c previews are retained.

Task remains [~], blocked on SeedVR2 installation: Manager's dependency repair installed missing packages but resolved diffusers 0.41.0 with huggingface-hub 0.36.2, producing `ImportError: cannot import name 'resolve_revision' from 'huggingface_hub'`. Its targeted pip-repair endpoint returned HTTP 403 `{"error":"security_level"}`; no security changes or internal-CLI bypass attempted. RIFE/FlashVSR/VHS register; SeedVR2 does not. ComfyUI left online. No inference, weights download, B/C outputs, Wan2GP/MusicToVideo changes, application code, production changes or publication. See updated checkpoint doc, external report/log/schema evidence and reusable app API notes. pnpm gates were not run because only documentation and external CPU-media artifacts changed. Next: resolve compatible SeedVR2 dependencies through an enabled installation route, verify registration, recheck GPU, then finish weights/B/C and labeled comparisons for the original three clips plus the three aafc6412 cuts.

## Codex Wan2GP-only checkpoint (2026-11-21, 21:54 +04)

Continued the first [~] Codex task only under the owner's latest Wan2GP-only decision. Checkpoint commit `89b699f` records read-only inspection of the installed Wan2GP and supported late postprocessing: RIFE x2, SeedVR2 3B/7B and FlashVSR/Turbo. No runtime/model readiness or quality ranking is claimed. Updated the external upscale_test/report.md; the three aafc6412 A baselines already exist and were retained.

Blocked by the explicit no-Python GPU gate: two checks at 21:51 list CUDA Python PID 24268 with 194 MiB used/0% utilization. Exact application identity is unconfirmed (command line python.exe main.py); no process stopped. Wan2GP is offline and was not launched. No Wan2GP/ComfyUI installation, code, configuration, weights, production data or publication changes. B/C, side-by-sides and inference timings/peak VRAM remain pending. Next scheduled run: recheck GPU and use the installed Wan2GP's supported launcher/UI/API on the three aafc6412 inputs; do not resume ComfyUI dependency repair. pnpm typecheck/test/build were not run because this checkpoint changes documentation only.

## Codex Wan2GP runtime/access checkpoint (2026-11-21, 22:02 +04)

Continued only the first [~] task using the owner's revised GPU utilization gate. Thirteen samples over 61.5 seconds showed 0% utilization. Confirmed the earlier ComfyUI PID 24268 by its 8188 listening socket and stopped it as instructed. Launched the existing Wan2GP through pterm/start.js without code, package or configuration edits. WanGP v19.14 serves its Gradio config/API discovery at 127.0.0.1:42003, although Pinokio's readiness probe still says starting/false. Left it running; final GPU check was 0%/200 MiB.

Blocked before inference: Gradio's empty queue-action call raises AppError (upstream exception; verbose reporting disabled). Browser fallback reports `The browser access host is unavailable`; native UI access reports `Computer Use was not approved to use Google Chrome` and `Computer Use was not approved to use Pinokio`. No task submitted, model download, B/C, comparison, production change or publication. Updated docs/VIDEO_QUALITY_CHECKPOINT_2026-11-21.md and external upscale_test/report.md. Next: restore approved UI access or working supported API, inspect the owner's queue, repeat the utilization gate, then finish the three aafc6412 comparisons. Only documentation changed; pnpm code-change checks were not required.

## Codex four-hit Suno WAV checkpoint (2026-11-22)

Synced the clean clone with git pull --ff-only and followed Claude's reordered board: the video task now belongs to Claude; worked only on the first Codex task, the four exact Suno WAV masters. Task remains [~], blocked by access: selecting the existing Suno Chrome window returned `Computer Use was not approved to use Google Chrome`; browser inventory returned `The browser access host is unavailable`. No UI input or session extraction was attempted. These are tool-access failures, not automatic approval-review rejections.

Checkpoint commit `449e621` records local Suno ID/duration candidates, including alternate takes, in docs/SUNO_HIT_MASTERS_CHECKPOINT_2026-11-22.md. Inbox MP3 durations were measured read-only; no exact video/audio match is claimed. The requested WAV directory is empty; no download or completed manifest was created. Next: restore approved access to the existing Suno session, compare each YouTube audio with its take, download original WAVs and validate format/decode before writing the manifest. No code, production data, portfolio/covers, OneDrive checkout or publication changes; pnpm typecheck/test/build were not required for documentation-only changes.


## Codex MusicToVideo engine switch checkpoint (2026-11-22)

Pulled 7de1000 and took the newly inserted first Codex task, the MusicToVideo engine switch. Installed seven local application files with original-hash guards and backups under Program/_engine_switch_backup_20261122. Reviewable patch, engine module, guarded installer and regression checks are under scripts/music-to-video-engine-switch/. The running server has not been restarted yet. Six Python checks and both HTML preference/syntax checks pass; repository typecheck, all 456 tests and build pass. No website source, production data, portfolio/covers, OneDrive checkout or WanGP/Maestro settings changed.

Task remains in progress while the sequential three-shot GPU comparison finishes. LTX calibration rendered all three shots; native 1280x704 keyframe padding corrects the source-aspect resize found in that pass. Wan 2.2 is on its third shot; exact-size LTX will run after it. Next: verify outputs and measurements, restart the idle local MusicToVideo server, finish engine_test.md and mark the task done. WAV source audio exports as MOV with PCM preserved; MP3 is copied into MP4.


## Codex MusicToVideo engine switch completed (2026-11-22)

Completed only the first assigned task. Code checkpoints `ca8abf5` and `33c1ec5` provide the local engine choice and PCM export compatibility; the completion package also removes the stale hard-coded LTX confirmation label. The seven installed application files match the guarded source package in scripts/music-to-video-engine-switch/, with originals preserved in Program/_engine_switch_backup_20261122. Restarted only the confirmed idle MusicToVideo server and left it running hidden. Both /studio and /designer return HTTP 200 with the engine control, OpenAPI includes the new split route, and H3 is rejected with HTTP 400 before upload/generation. Shared last choice, job/restored-build engine persistence, start/end keyframes, beat splitting, GPU gates and source-audio stream copying are covered by seven Python regressions and both HTML checks. MP3 exports remain MP4; PCM WAV uses MOV with history/playback/thumbnail support. Final pnpm typecheck, all 456 tests and build pass.

The sequential three-shot test for the requested song is complete. Wan 2.2: 279.890 / 244.438 / 273.781 seconds, sampled peak 3590 MiB; native LTX-2.3: 162.375 / 117.500 / 117.922 seconds, sampled peak 4292 MiB. Whole-process times are 825.469 versus 425.781 seconds. All six outputs decode cleanly; Wan is 832x480/16 fps and LTX is 1280x704/24 fps. Full paths, telemetry, startup quirks, probe/decode evidence and source-composite quality limitations are recorded in D:/Prog/MusicToVideo/Library/_agent/upscale_test/engine_test.md and docs/MUSICTOVIDEO_ENGINE_SWITCH_2026-11-22.md. Both engines turn the third double-exposure park reference into a stage/guitarist scene: this is evidence for review, not approved media. Maestro/WanGP code and settings, production database rows, portfolio/covers and the OneDrive checkout were not changed. No media upload or publishing command was run. Next open Codex task is Claude's Send timeline to Maestro; it was preserved during rebase and was not started.

The first checkpoint push was rejected because Claude had pushed a new task. Ran git pull --rebase, preserved Claude's new task and this run's status, resolved the task-board conflict, and pushed successfully. Subsequent code-fix push also succeeded. Exact initial push output:

```text
To https://github.com/vasozura/vasozura.github.io.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/vasozura/vasozura.github.io.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```


## Codex KinoStudio analysis completed (2026-11-22)

Pulled 5bc77a5 and completed only the new first Codex task. Analysis commit `1fe3649` adds docs/KINOSTUDIO_ANALYSIS.md in Georgian with a 10-line summary for Claude, verified app inventory, module reuse decisions, one Portal-style web workflow, one proposed project folder format, a 1-2 minute Georgian chapter MVP, a 15-23 working-day estimate and owner questions. Recommendation: CineAudio workspace/audio services plus Maestro Director/Character Studio and MusicToVideo engine adapters; retain useful Aurora contracts and Unified presence/style concepts. No implementation started.

Read-only source inspection plus 110 selected Aurora tests and 34 selected CineAudio tests passed. Unified was copied to ignored site/tmp for smoke: its pinned FastAPI 0.115.12/Starlette 0.46.2 environment returns a 200 home response, creates the 250-scene scaffold and produces prompt text/rewrite tags, with 32 OpenAPI routes. Its TestClient lacks httpx; direct route/service checks were used. System Python's newer Starlette fails the old TemplateResponse call. Hard-coded missing Excel path/override and destructive Excel scene import are documented; no existing DB was opened or modified. Natural Georgian TTS quality and new Maestro integration remain unverified, as stated in the analysis.

All external apps, production data, portfolio/covers and the OneDrive checkout remained untouched. No GPU generation, model/package installation, external provider call or publication. Only documentation changed, so pnpm typecheck/test/build code-change gates were not applicable. Next: Claude reviews the summary and owner questions and assigns implementation; the next existing open Codex task remains Send timeline to Maestro.

## Codex local DistroKid cover implementation (2026-11-22)

Pulled 0c5b4aa and took only the first Codex task. Installed the local Maestro/WanGP Flux cover button, candidate previews/selection and COVERS_NIGHT.bat with hash guards and backups. Package and seven Python/HTTP regressions are in scripts/distrokid-covers/; operational evidence is in docs/DISTROKID_LOCAL_COVERS_2026-11-22.md. Preserved concurrent local batch-selection/needs_cover additions. Restarted the confirmed idle Upload Center; live Georgian labels and controls pass HTTP checks. Typecheck, all 456 tests and build pass. Three May the Eighteenth candidates are being prepared under the external distrokid/covers folder, using installed weights and the 60-second idle gate. Task remains in progress until output validation finishes. No upload, publication, production/portfolio/covers, OneDrive, Maestro code/config or WanGP settings changes.

## Codex local DistroKid covers completed (2026-11-22, 21:13 +04)

Completed only the first assigned Codex task. Code commits `53730fc`, `abbdc3d`, `cafd074` are pushed. The local Upload Center has the Georgian generation button, candidate thumbnails and selection; COVERS_NIGHT.bat prepares missing covers using installed Maestro/WanGP Flux Klein 9B. The program adds the round logo and Georgian/English typography to 3000×3000 RGB JPGs. Hash-guarded installs kept backups and preserved concurrent local needs_cover/batch-selection edits. Seven Python/HTTP regressions, JavaScript syntax, typecheck, all 456 tests and build pass.

Three final May the Eighteenth candidates are in D:/Prog/MusicToVideo/Library/_agent/distrokid/covers/მაისი-თვრამეტი/cand_1.jpg through cand_3.jpg. All decode and match live HTTP responses; validation.json records hashes/seeds and 43.000 / 43.563 / 44.907 second timings excluding idle gates. All were visually reviewed; candidates 2/3 have cleaner title backgrounds, while 1 has a generated dark upper-right panel. Rejected garbled-lettering artwork was archived locally; the final prompt retains visual style and local lyrical motifs without literal lyrics/title copy. Nothing selected: the release cover is still empty. Worker exited successfully, lock cleared, final GPU 0%/194 MiB. Windows GPU Engine counters distinguish the owner's idle ComfyUI from cover generation; ComfyUI was left running. No package/model installation, Maestro code/config or WanGP settings changes, production/portfolio/covers/OneDrive changes, uploads or publication. Commits skip CI to avoid an unrelated website deployment. Details: docs/DISTROKID_LOCAL_COVERS_2026-11-22.md. Next: owner chooses a candidate; Claude can connect COVERS_NIGHT.bat to the existing night scheduler. Next existing open Codex task is Send timeline to Maestro; it was not started.

PC3: 2026-11-23. Completed the first-run inventory in docs/PC3_SETUP.md (e8b4984). Awaiting the next Codex-PC3 assignment.


PC2: 2026-11-24. Completed the first-run inventory in docs/PC2_SETUP.md (03978e4). E:/Generate is a candidate Wan2GP clip location; the full library path remains unverified. Awaiting the next Codex-PC2 assignment.


PC2: 2026-11-25. Completed the archive catalog at 04:58 with 204,951 entries across six drives (2450eb6). The Georgian summary has per-drive and per-folder totals and duration buckets. The CSV, probe cache and five ranked Wan2GP folder paths are local in D:/ZuraCatalog. For r3, start with the top F: entry (14,351 matching clips) in the local JSON report. The existing RUN_CODEX_PC2.bat points to the PC3 prompt and log. Verify the scheduled launcher before relying on it for a future PC2 run.

## Codex winter-song project checkpoint (2026-11-25)

Pulled d43fb18 and worked only on the first laptop Codex task. Checkpoint c45a55a documents the prepared native MusicToVideo job f1751125 in Library/outputs/clips/pirveli_tovli__f1751125/: six scenes, 18 contiguous beat-split shots (maximum 8.986122 s), an image queue, LTX-2.3 selection and the exact pirveli_tovli_FHD.mp4 1080p export specification. Source audio decodes cleanly at 132.36 s, 48 kHz stereo; its working copy matches SHA-256. Native job-loader, queue and timing validations pass. pnpm typecheck, all 456 tests and pnpm build pass.

Remains [~], blocked before inference. Pinokio search timed out at 192.168.100.5:42000. Tried the existing MusicToVideo launcher hidden as a fallback; it restored the new job but never opened port 8000 within 180 seconds. Its existing startup maintenance backed up the local library index, normalized 6,283 categories and updated 48,887 path records (0 new; 12,550 missing-file records retained), then enabled background tagging. A 60.82-second GPU observation recorded 71% and 87% utilization with Ollama PID 30796 on the GPU, so no winter generation was started. Stopped only our confirmed unsuccessful MusicToVideo launcher (30792/19840), leaving Ollama and other apps alone. Final GPU sample 0%/524 MiB. Startup logs, README and runtime_checkpoint.json are saved with the project.

Next: restore normal MusicToVideo readiness, repeat the idle GPU gate, open /frames?job=f1751125, select each card with “⟳ ხელახლა” then press “⟳ მონიშნულების ხელახლა (18)” for keyframes; review all 18 and press “✓ დამტკიცება და ვიდეოზე გადასვლა” to build the LTX video queue. Full instructions and the separate final FHD export contract are in docs/WINTER_FIRST_SNOW_2026-11-25.md. No keyframes/video/final render yet; no application code/config changes, production database writes, portfolio/covers/OneDrive edits, upload or publication. Commits use [skip ci] to avoid a website deployment.


PC3: 2026-11-26. Rendered and verified the local Piper Georgian narrator MP3. KinoStudio remains [~] because neither allowed F5 checkpoint bundles an eligible reference and the MMS Georgian checkpoint could not be verified. The audio is on PC3 and the details are in docs/kino_voices/report.md. Next: identify eligible model inputs or approve substitutes and use private delivery if needed.

PC2: 2026-11-26. Installed the local ClipChain prototype and verified DINOv2 on the RTX 4070 Ti. The 2,000-clip trial found no strict links and one unconfirmed relaxed pair, so calibration and the 30-link review remain [~]. The top F: metadata index resumed as a standalone job from 4,023 cached clips. Preview and index are in D:/ClipChainWork/pilot-storyboard. Claude, please point PC2 to confirmed continuation pairs and the SigLIP taxonomy, and provide a compatible WanGP first/last-frame settings export. Details are in docs/CLIPCHAIN_2026-11-25.md. No media publication or bridge generation.

## Codex new May cover concepts completed (2026-11-26)

Pulled 678cfad and completed only the first laptop Codex task. Pushed code f10a450: UTF-8-safe stdout/stderr, an explicit 6/7/8 concept file and missing-candidate resume, preserving the installed newer photo-style behavior. The worker-only hash-guarded install backed up dk_covers.py under D:/Prog/YT_Upload/DistroKid/_covers_backup_20261126_033037; local UI files were left alone. Nine cover regressions, pnpm typecheck, all 456 tests and pnpm build pass. Commits use [skip ci] to avoid a website deployment.

Three visually reviewed 3000×3000 RGB JPEGs and the numbered side-by-side _choose_cover_new.jpg are ready under D:/Prog/MusicToVideo/Library/_agent/distrokid/covers/მაისი-თვრამეტი/. Concepts: hands/old photograph, woman from behind on a Tbilisi balcony, blank notebook/candle still life. All prompts start with the no-text block; the existing CPU compositor adds the round ZA logo and Georgian title. Each render passed the full 60-second below-10% GPU gate. Candidates 6/7 took 46.750/36.172 s excluding idle waits. Candidate 8 saved its complete image and logged queue success (19.5 s) before the monitor reported interference on a late sample with no process counters. The subsequent GPU check was 0%/0 MiB and listed only ChatGPT. Recovered the already completed image on CPU; no rerender or other-process termination. Candidate 8's full wall time is deliberately not claimed. The historical monitor error remains in telemetry.

validation_new.json and verification_20261126.json record image dimensions, hashes, seeds and telemetry. Existing candidates, the old review sheet and release JSON match their pre-run SHA-256 values. A repeat of the same concept command returned success without generation; the worker lock is cleared. Nothing selected, uploaded or published; no production DB, public/data/portfolio.json, public/covers/, Maestro/WanGP settings or OneDrive checkout edits. Next: owner chooses candidate 6, 7 or 8; Claude handles the release after explicit approval.

The final documentation push was rejected by a concurrent PC2 push. Rebased while retaining PC2's handoff and task progress. Exact initial push error:

```text
To https://github.com/vasozura/vasozura.github.io.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/vasozura/vasozura.github.io.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

PC3: 2026-11-27. Rechecked the KinoStudio narrator models. The first Piper sample is still on PC3. F5 lacks an eligible bundled reference and Meta's Georgian MMS endpoints did not yield a verified checkpoint. Task stays [~]. Next: identify eligible inputs or approve substitutes and arrange private delivery for off-PC listening.

## Codex First Snow cover candidates completed (2026-11-27)

Pulled 5020597 and completed only the first laptop Codex task. Evidence commit c280440 records three visually reviewed 3000×3000 RGB JPEGs and the numbered _choose_cover.jpg in D:/Prog/MusicToVideo/Library/_agent/distrokid/covers/პირველი-თოვლი/. Used the existing UTF-8-fixed local worker, installed Flux Klein 9B and CPU title/logo compositor; no application changes. Candidate 3 is closest to the requested back-view composition. Generation/composition times excluding idle gates: 46.922 / 37.094 / 36.625 seconds.

Every render passed the 60-second idle gate. The initial sandboxed renderer remained on CPU with an empty log; stopped only that renderer, retained attempt evidence, and completed the same worker through approved unrestricted execution. All JPEGs fully decode; local validation.json records dimensions/hashes and unchanged release JSON. Cover remains empty, worker exited successfully, lock cleared, GPU 0%/0 MiB. No upload/publication, production writes, public portfolio/covers, OneDrive checkout, Maestro code/config or model/package changes. Repository changes are documentation only, so pnpm code-change gates were not applicable. Commits use [skip ci] to avoid website deployment. Next: owner chooses a cover; Claude handles the release after explicit approval. No second task started.

## Claude: urgent cover fixes on the site (2026-11-27)

The owner reported unsuitable covers. Replaced three `public/covers/` images that contradicted their songs: `the-frog` (children's song „ბაყაყი“ showed a romantic couple → illustrated frog on a pond), `lashari-cross` („ლაშარის ჯვარი“ showed a dancing couple → night mountain with the shrine and cross) and `the-dagestani-girl` („ლეკის ქალი“ showed a man → frame from the song's own YouTube clip E_CMh1ch2hs). Same layout as the other covers (ZA badge, gold Georgian title, poet). Still weak, not yet changed: `first-snow` (rain, no snow — replace with the owner's chosen DistroKid cover) and `why-are-you-crying-mother` (lone man in rain for a poem about a mother).


## Codex two-ballad project checkpoint (2026-11-27)

Pulled d56872c and took only the newly inserted first Codex task. Installed two new MusicToVideo projects (b127a001/b127a002), 25/27 shots, with unchanged source audio copies and FHD export contracts. Native-job loading, queue integrity, duration coverage and hashes pass; pnpm typecheck, all 456 tests and build pass. The first guarded keyframe run cefc6a02 is in progress; a sequential monitor will start the second image queue after it succeeds. Cached CPU Whisper is refining provisional stanza timings. Details: docs/BALLAD_CLIPS_2026-11-27.md. Final renders are not complete. No publication, production data, public portfolio/covers, OneDrive, app configuration or model changes. This checkpoint uses [skip ci]; next: finish timing/keyframe review, run the installed LTX executor with project-local Maestro routing, then export and verify both FHD files.


## Codex two-ballad keyframes and LTX checkpoint (2026-11-27)

All 53 keyframes (25/28) now fully decode and passed visual review; rejected spring/piano images are retained, with corrected replacements installed. CPU Whisper stanza anchors refined the original timing, with listening review still needed for opening/tails. Both projects retain source MP3 hashes, native jobs, final 1080p30 export contracts, review sheets and resumable render/export helpers. No app source or manual installed-configuration edits.

The first LTX run 6b6a88b9 is in progress; five clips are complete and the first two passed full decode and start/mid/end visual checks. Project-only config routes LTX2.3 to existing Maestro weights. Found and handled legacy settings conversion: stamp installed schema2.58 so the explicit241-frame window survives. Corrected dry-run passes25/25 and runtime uses one window; stopped calibration attempts are retained. Details: docs/BALLAD_CLIPS_2026-11-27.md. Repository typecheck,456 tests and build already pass. No final FHD file yet, upload/publication, production DB, public portfolio/covers or OneDrive changes. Next: finish first render/review, run second sequentially, export and verify both exact final paths. Checkpoint uses [skip ci].


Checkpoint push was rejected by concurrent work. Rebased successfully, preserving the other agent notes. Exact initial push error:

```text
To https://github.com/vasozura/vasozura.github.io.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/vasozura/vasozura.github.io.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```


## Codex first ballad FHD verified (2026-11-27)

First-song native run 6b6a88b9 completed25/25 in4353s. All clips passed decode and sampled visual review. Library/outputs/final/rotsa_dzalian_mogenatrebi_FHD.mp4 is ready:1920x1080,30fps,5623frames,187.44s; full decode and black-gap checks pass, original MP3 packets are identical. A0.33s black tail was trimmed before fitting shot timing. Exact segment-duration directives fixed a6ms concat rounding issue; initial mux retained. Final review images and receipts are saved with the project; public technical receipt:docs/ballad_clips/2026-11-27-first-song.json.

Second-song run55b15529 is active; no second task started. Next:finish its28clips, review/export/verify its FHD file, then close the task. No uploads/publication, production data, protected public assets, OneDrive or app-source/config edits. Typecheck,456tests and build passed. The earlier checkpoint push rejection was resolved by rebase and successful push; its exact output is retained here:

```text
To https://github.com/vasozura/vasozura.github.io.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/vasozura/vasozura.github.io.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```


2026-11-27: the first-FHD checkpoint push was also rejected by concurrent work with the same fetch-first error. Rebased successfully, preserving both agents work. Exact repeated error:

```text
To https://github.com/vasozura/vasozura.github.io.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/vasozura/vasozura.github.io.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```


PC3: 2026-11-28 — Stock-clip factory remains in progress. WanGP, the isolated CUDA environment, and the 80-job worker are on D:. Detached launcher PID 15088 is waiting for dependencies and checkpoint copy before the first clip. No verified renders yet. Next check the launcher log and pilot receipt, then record the completed counts, times and VRAM in docs/PC3_STOCK_2026-11-27.md.


## Codex Composer Archive fill blocked (2026-11-28)

Pulled c94b15d and took only the first open laptop Codex task. Evidence commit a9122de records the archive audit and a Georgian summary. Found an earlier local Claude fill log (516 duplicate moves, 20 new songs, 93 attachments); the task manifest is stale. Counts from the pre-fill backup to current: songs 460 -> 480, songs with WAV 38 -> 85, MP3 385 -> 405, MIDI/ZIP 15 -> 16, lyrics 229 -> 230. These changes predate this run. 262 non-JSON review files remain.

Created the requested consistent SQLite backup without replacing existing backups. Hashed all 1,279 indexed assets; seven MP3 hash mismatches, no missing files. SQLite integrity/foreign keys pass. The tooling's own verifier ran against a snapshot and independently returned the same seven errors (176 warnings). Metadata inventory audit has 460 per-file review findings, including conflicting/shared folders; not a count of corrupt songs. Live database logical dump hashes are identical before/after this run. Local evidence: D:/ComposerArchive/05_LOGS/fill_audit_2026-11-28.json, fill_tool_validation_2026-11-28.json and fill_report_2026-11-28.md.

Task remains [~], blocked: required importer overwrites fixed original.mp3/original.wav destinations, removes source/sidecars, and its ZIP extractor can overwrite stems. UI attachment wrappers call it; lyrics are unsupported by addAsset. Provide collision-safe attachment and reconcile the seven mismatches from preserved sources before importing further; existing row rewrites need owner approval. UI GET on 127.0.0.1:4783 timed out; no UI start/migration against the live database. No source files moved/deleted, database rows changed, protected public assets or OneDrive checkout edited, uploads or publication. Documentation only, so pnpm code-change checks were not applicable. Commits use [skip ci]. No second task started.
