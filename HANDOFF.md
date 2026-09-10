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

Still unfinished or needing fresh QA: regenerate reviewed per-song Karaoke artifacts outside Git, complete/verify multi-preset FFmpeg MP4 rendering (16:9, 9:16, square and optional guide mix), run a real browser end-to-end playback/seek/guide test, validate a short real MP4 export visually and audibly, and decide the production object-storage delivery path for generated manifests/media. Generated stems, MP3/MIDI/subtitle files, and test videos are ignored and must not be committed.

## Important paths

- App/router: `src/main.ts`
- Public/admin song UI: `src/components/`, `src/data/song-repository.ts`
- Karaoke: `src/karaoke/`
- Learning/score/audio: `src/learning/`, `src/score/`, `src/audio/`
- Importers/preparation: `scripts/import-song.ts`, `scripts/import-batch.ts`, `scripts/prepare-phase6-suno-packages.ts`, `scripts/prepare-vocal-learning.ts`
- Database: `supabase/migrations/`
- Operational docs: `docs/IMPORT_GUIDE.md`, `docs/SONG_PACKAGE_FORMAT.md`, `docs/VOCAL_KARAOKE_PIPELINE.md`

## Known blockers and next task

The installed `@supabase/supabase-js` 2.112.4 package may be missing its declared `dist/index.d.mts` file in a fresh local install; if TypeScript reports that exact package-export error, refresh the package store or pin a corrected upstream release before changing app types. Do not add an `any` shim.

Next recommended task: finish only the Vocal/Karaoke release gate—repair/confirm the dependency install, run the existing real-song preparation into ignored `tmp/`, perform browser playback/seek/Piano/Guitar QA, render and inspect one short FFmpeg MP4 for each layout implementation, then upload reviewed artifacts through an approved owner-only Storage workflow without changing song publication state.
