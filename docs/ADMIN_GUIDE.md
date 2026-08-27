# Owner administration guide

The admin route is intentionally absent from public navigation. Open it directly:

```text
https://vasozura.github.io/#/admin
```

For local work use `http://127.0.0.1:5173/#/admin` (development) or `http://127.0.0.1:4173/#/admin` (preview).

## Workflow

1. Sign in with the owner email/password configured in Supabase Auth.
2. Select **New song** or **Edit** an existing song.
3. Complete both titles and a lowercase slug. Unknown fields may remain blank.
4. Paste a supported YouTube URL; its 11-character ID is derived automatically.
5. Enter Georgian/English descriptions and lyrics directly, or load each language from a validated UTF-8 `.txt` file. Selected lyric files are also retained in the versioned `lyrics` bucket.
6. Review cover/audio previews and select **Save song and files**. Each file shows upload progress.
7. Keep new entries in `draft` until verified. Use **Publish** only when public metadata and permissions are ready.

Draft rows and their files are not readable by anonymous visitors. Public catalog queries request published rows only. Missing resources are omitted from public song pages.

## Safety behavior

- Navigation or tab closing prompts before discarding unsaved edits.
- Destructive deletion requires explicit confirmation.
- Failed saves leave the form intact and expose a retry submit action.
- Files are content-checked in the browser before upload and checked again by Storage limits/policies.
- Duplicate file content for a song reuses the prior `song_files` record.
- Song deletion first removes every recorded version from its private Storage bucket, then removes the song and database child rows. If Storage cleanup fails, the database delete is not attempted.

## Guitar and accordion parts

The schema and `instrument_parts` table support piano, guitar, and accordion MusicXML/MIDI/fingering JSON. This version visualizes piano MIDI notes. It does not claim to infer guitar or accordion fingering from MP3 audio; reliable fingering must be entered or imported explicitly.
