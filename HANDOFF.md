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
