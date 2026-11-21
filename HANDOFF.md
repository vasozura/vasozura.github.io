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
